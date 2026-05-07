import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';
import { default as pool, initDB } from './db/database';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

if (started) {
  app.quit();
}

let loggedInUserId: number | null = null;

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

    return { success: true, message: 'Registrasi berhasil!' };
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
    return { success: true, message: 'Login berhasil!' };
  } catch (err) {
    console.error('Login error:', err);
    return { success: false, message: 'Terjadi kesalahan server.' };
  }
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

    const weight = data.weight !== undefined ? data.weight : current.weight;
    const height = data.height !== undefined ? data.height : current.height;

    await pool.query(
      'UPDATE users SET nama = $1, dob = $2, weight = $3, height = $4 WHERE id = $5',
      [nama, dob, weight, height, loggedInUserId]
    );
    return { success: true };
  } catch (err) {
    console.error('Update profile error:', err);
    return { success: false, message: 'Terjadi kesalahan server.' };
  }
});

ipcMain.handle('getCurrentUser', async () => {
  if (!loggedInUserId) return null;
  try {
    const result = await pool.query('SELECT email, nama, to_char(dob, \'Mon DD, YYYY\') as dob, weight, height, profile_pic FROM users WHERE id = $1', [loggedInUserId]);
    return result.rows[0];
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
        `INSERT INTO jadwal (user_id, day, exercise_name, reps, done, has_kg, kg, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [loggedInUserId, day, item.name, item.reps, item.done, item.hasKg, item.kg || 0, i]
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
      'SELECT exercise_name, reps, done, has_kg, kg FROM jadwal WHERE user_id = $1 AND day = $2 ORDER BY sort_order',
      [loggedInUserId, day]
    );
    return result.rows.map((row: any) => ({
      name: row.exercise_name,
      reps: row.reps,
      done: row.done,
      hasKg: row.has_kg,
      kg: row.kg,
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
  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    splashWindow?.destroy();
    mainWindow?.show();
  });

  mainWindow.webContents.openDevTools();
}

app.on('ready', async () => {
  await initDB();
  createAppWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createAppWindow();
});