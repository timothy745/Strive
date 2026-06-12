import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';
import 'dotenv/config';
// Using native global fetch (available in Node 18+ and Electron)
import { default as pool, initDB } from './db/database';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

if (started) {
  app.quit();
}

let loggedInUserId: number | null = null;
let cachedUser: any = null;
let cachedUserId: number | null = null;

function invalidateUserCache() {
  cachedUser = null;
  cachedUserId = null;
}

// ── IPC: REGISTER ───────────────────────────────────────────────
ipcMain.handle('register', async (_event, { email, password }: { email: string; password: string }) => {
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return { success: false, message: 'Email sudah terdaftar.' };
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const insertResult = await pool.query(
      'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id',
      [email, hashedPassword]
    );
    loggedInUserId = insertResult.rows[0].id;
    invalidateUserCache();

    return { success: true, message: 'Registrasi berhasil!', id: loggedInUserId };
  } catch (err) {
    console.error('Register error:', err);
    return { success: false, message: 'Terjadi kesalahan server.' };
  }
});

// ── IPC: LOGIN ──────────────────────────────────────────────────
ipcMain.handle('login', async (_event, { email, password }: { email: string; password: string }) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return { success: false, message: 'Email tidak ditemukan.' };
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return { success: false, message: 'Password salah.' };
    }

    loggedInUserId = user.id;
    invalidateUserCache();
    return { success: true, message: 'Login berhasil!', id: loggedInUserId };
  } catch (err) {
    console.error('Login error:', err);
    return { success: false, message: 'Terjadi kesalahan server.' };
  }
});

// ── IPC: START GOOGLE AUTH (PKCE + client_secret) ────────────────────────
import crypto from 'node:crypto';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

const OAUTH_REDIRECT_PORT = 13579;
const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_REDIRECT_PORT}`;

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function generateCodeVerifier(): string {
  return base64url(crypto.randomBytes(32));
}

function generateCodeChallenge(verifier: string): string {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}

async function exchangeGoogleCode(code: string, codeVerifier: string): Promise<{ success: boolean; id?: number; message?: string; isNewUser?: boolean }> {
  try {
    const body = new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: OAUTH_REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }).toString();

    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      console.error('Token exchange failed. Status:', tokenResp.status, 'Body:', errText);
      return { success: false, message: `Google token error (${tokenResp.status}): ${errText}` };
    }

    const tokenData: any = await tokenResp.json();
    const idToken = tokenData.id_token;
    if (!idToken) return { success: false, message: 'No ID token received from Google.' };

    const verifyResp = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
    if (!verifyResp.ok) return { success: false, message: 'Failed to verify Google ID token.' };

    const userData: any = await verifyResp.json();
    const email = userData.email;
    const googleId = userData.sub;
    if (!email || !googleId) return { success: false, message: 'Failed to retrieve Google account info.' };

    console.log('Google auth successful for:', email);

    const existing = await pool.query('SELECT id FROM users WHERE google_id = $1', [googleId]);
    if (existing.rows.length > 0) {
      loggedInUserId = existing.rows[0].id;
      invalidateUserCache();
      return { success: true, id: loggedInUserId!, isNewUser: false };
    }

    const existingByEmail = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingByEmail.rows.length > 0) {
      const userId = existingByEmail.rows[0].id;
      await pool.query('UPDATE users SET google_id = $1 WHERE id = $2', [googleId, userId]);
      loggedInUserId = userId;
      invalidateUserCache();
      return { success: true, id: loggedInUserId!, isNewUser: false };
    }

    const insertRes = await pool.query(
      'INSERT INTO users (email, google_id) VALUES ($1, $2) RETURNING id',
      [email, googleId]
    );
    loggedInUserId = insertRes.rows[0].id;
    invalidateUserCache();
    return { success: true, id: loggedInUserId!, isNewUser: true };
  } catch (err) {
    console.error('Google auth processing error:', err);
    return { success: false, message: 'An error occurred during Google sign-in.' };
  }
}

ipcMain.handle('startGoogleAuth', async (_event) => {
  return new Promise(async (resolve) => {
    let resolved = false;
    const done = (result: any) => {
      if (!resolved) { resolved = true; resolve(result); }
    };

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: OAUTH_REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'select_account',
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
    });
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    const authWindow = new BrowserWindow({
      width: 500,
      height: 650,
      show: true,
      modal: true,
      parent: mainWindow || undefined,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
      title: 'Sign in with Google',
    });

    const filter = { urls: [`http://localhost:${OAUTH_REDIRECT_PORT}/*`] };
    const onBeforeRequest = (details: Electron.OnBeforeRequestListenerDetails, callback: (response: Electron.CallbackResponse) => void) => {
      const url = new URL(details.url);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      callback({ cancel: true });

      if (error || !code) {
        console.error('Google OAuth error:', error);
        if (authWindow && !authWindow.isDestroyed()) authWindow.close();
        done({ success: false, message: 'Google sign-in was cancelled or failed.' });
        return;
      }

      setTimeout(async () => {
        const result = await exchangeGoogleCode(code, codeVerifier);
        if (authWindow && !authWindow.isDestroyed()) authWindow.close();
        done(result);
      }, 0);
    };

    authWindow.webContents.session.webRequest.onBeforeRequest(filter, onBeforeRequest);

    authWindow.loadURL(authUrl);

    authWindow.on('closed', () => {
      done({ success: false, message: 'Sign-in window was closed.' });
    });
  });
});



// ── IPC: GOOGLE LOGIN (legacy token-based) ────────────────────────────────────────
ipcMain.handle('googleLogin', async (_event, idToken: string) => {
  console.log('🔗 [Main Process] googleLogin called with token length:', idToken?.length);
  try {
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`;
    console.log('Verifying token with Google tokeninfo endpoint...');
    const resp = await fetch(url);
    console.log('Google tokeninfo status:', resp.status);
    if (!resp.ok) {
      const errText = await resp.text();
      console.error('Google tokeninfo error details:', errText);
      return { success: false, message: 'Invalid Google token' };
    }
    const data: any = await resp.json();
    console.log('Token data verification successful. Email:', data.email);
    const email = data.email;
    const googleId = data.sub;

    // Look for existing user by google_id
    const existing = await pool.query('SELECT id FROM users WHERE google_id = $1', [googleId]);
    if (existing.rows.length > 0) {
      loggedInUserId = existing.rows[0].id;
      invalidateUserCache();
      console.log('Existing user found. ID:', loggedInUserId);
      return { success: true, id: loggedInUserId, isNewUser: false };
    }

    // If not exists, create a new user (password can be null)
    console.log('New user. Inserting into database...');
    const insertRes = await pool.query(
      'INSERT INTO users (email, google_id) VALUES ($1, $2) RETURNING id',
      [email, googleId]
    );
    loggedInUserId = insertRes.rows[0].id;
    invalidateUserCache();
    console.log('Successfully registered new user. ID:', loggedInUserId);
    return { success: true, id: loggedInUserId, isNewUser: true };
  } catch (err) {
    console.error('Google login error in main process:', err);
    return { success: false, message: 'Google login failed' };
  }
});

// ── IPC: RESET PASSWORD ──────────────────────────────────────────
ipcMain.handle('resetPassword', async (_event, { email, password }: { email: string; password: string }) => {
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length === 0) {
      return { success: false, message: 'Email tidak ditemukan.' };
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query('UPDATE users SET password = $1 WHERE email = $2', [hashedPassword, email]);

    return { success: true, message: 'Password berhasil direset!' };
  } catch (err) {
    console.error('Reset password error:', err);
    return { success: false, message: 'Terjadi kesalahan server.' };
  }
});

// ── IPC: SESSION ────────────────────────────────────────────────
ipcMain.handle('autoLogin', (_event, userId: number) => {
  loggedInUserId = userId;
  invalidateUserCache();
  return { success: true };
});

ipcMain.handle('logout', () => {
  loggedInUserId = null;
  invalidateUserCache();
  return { success: true };
});


// ── IPC: PROFILE ────────────────────────────────────────────────
ipcMain.handle('updateProfile', async (_event, data) => {
  if (!loggedInUserId) return { success: false, message: 'Not logged in' };
  try {
    // Ambil data user saat ini untuk partial update
    const currentRes = await pool.query('SELECT nama, dob, weight, height FROM users WHERE id = $1', [loggedInUserId]);
    const current = currentRes.rows[0];

    // Merge data baru dengan data lama
    const nama = data.nama !== undefined ? data.nama : current.nama;
    let dob = current.dob; // default to existing dob (Date object or string from DB)

    // Jika ada data tgl/bulan/tahun (format lama), konstruksi dob baru
    if (data.tgl && data.bulan && data.tahun) {
      const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
      const m = months.indexOf(data.bulan) + 1;
      const mm = m < 10 ? '0' + m : m;
      const dd = data.tgl < 10 ? '0' + data.tgl : data.tgl;
      dob = `${data.tahun}-${mm}-${dd}`;
    }
    // Jika data.dob dikirim langsung (format baru dari profile.html)
    else if (data.dob !== undefined) {
      dob = data.dob;
    }

    const weight = data.weight !== undefined ? parseFloat(String(data.weight).replace(/ KG$/, '')) : current.weight;
    const height = data.height !== undefined ? parseFloat(String(data.height).replace(/ Cm$/, '')) : current.height;

    await pool.query(
      'UPDATE users SET nama = $1, dob = $2, weight = $3, height = $4 WHERE id = $5',
      [nama, dob, weight, height, loggedInUserId]
    );
    invalidateUserCache();
    return { success: true };
  } catch (err) {
    console.error('Update profile error:', err);
    return { success: false, message: 'Terjadi kesalahan server.' };
  }
});

ipcMain.handle('getCurrentUser', async () => {
  if (!loggedInUserId) return null;
  if (cachedUserId === loggedInUserId && cachedUser) return cachedUser;
  try {
    const result = await pool.query('SELECT email, nama, to_char(dob, \'Mon DD, YYYY\') as dob, weight, height, profile_pic FROM users WHERE id = $1', [loggedInUserId]);
    cachedUser = result.rows[0];
    cachedUserId = loggedInUserId;
    return cachedUser;
  } catch (err) {
    console.error('Get profile error:', err);
    return null;
  }
});

// ── IPC: PROFILE PICTURE ────────────────────────────────────────
ipcMain.handle('uploadProfilePic', async () => {
  if (!loggedInUserId) return { success: false, message: 'Not logged in' };
  try {
    const result = await dialog.showOpenDialog({
      title: 'Pilih Foto Profil',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, message: 'Cancelled' };
    }

    const filePath = result.filePaths[0];
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const imageBuffer = fs.readFileSync(filePath);
    const base64 = imageBuffer.toString('base64');
    const dataUrl = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${base64}`;

    await pool.query('UPDATE users SET profile_pic = $1 WHERE id = $2', [dataUrl, loggedInUserId]);
    invalidateUserCache();
    return { success: true, dataUrl };
  } catch (err) {
    console.error('Upload profile pic error:', err);
    return { success: false, message: 'Gagal upload foto.' };
  }
});

// ── IPC: SCHEDULE ───────────────────────────────────────────────
ipcMain.handle('saveSchedule', async (_event, { day, items }: { day: string; items: any[] }) => {
  if (!loggedInUserId) return { success: false, message: 'Not logged in' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Hapus data lama untuk hari ini
    await client.query(
      'DELETE FROM jadwal WHERE user_id = $1 AND day = $2',
      [loggedInUserId, day]
    );

    // Insert data baru
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await client.query(
        `INSERT INTO jadwal (user_id, day, exercise_name, reps, done, has_kg, kg, sort_order, completed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [loggedInUserId, day, item.name, item.reps, item.done, item.hasKg, item.kg || 0, i, item.completed || false]
      );
    }

    await client.query('COMMIT');
    return { success: true };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Save schedule error:', err);
    return { success: false, message: 'Gagal menyimpan jadwal.' };
  } finally {
    client.release();
  }
});

ipcMain.handle('getSchedule', async (_event, { day }: { day: string }) => {
  if (!loggedInUserId) return [];
  try {
    const result = await pool.query(
      'SELECT exercise_name, reps, done, has_kg, kg, completed FROM jadwal WHERE user_id = $1 AND day = $2 ORDER BY sort_order',
      [loggedInUserId, day]
    );
    return result.rows.map((row: any) => ({
      name: row.exercise_name,
      reps: row.reps,
      done: row.done,
      hasKg: row.has_kg,
      kg: row.kg,
      completed: row.completed,
    }));
  } catch (err) {
    console.error('Get schedule error:', err);
    return [];
  }
});

// ── Windows ─────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;

function createAppWindow() {
  splashWindow = new BrowserWindow({
    width: 500,
    height: 300,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
  });
  splashWindow.loadFile('splash.html');

  mainWindow = new BrowserWindow({
    width: 1535,
    height: 864,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  mainWindow.once('ready-to-show', () => {
    splashWindow?.destroy();
    mainWindow?.show();
  });

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
}

app.on('ready', async () => {
  createAppWindow();
  initDB().catch(err => console.error('DB init failed:', err));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createAppWindow();
});