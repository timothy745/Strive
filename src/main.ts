import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { default as pool, initDB } from './db/database';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

if (started) {
  app.quit();
}

// ── IPC: REGISTER ───────────────────────────────────────────────
ipcMain.handle('register', async (_event, { email, password }: { email: string; password: string }) => {
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return { success: false, message: 'Email sudah terdaftar.' };
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (email, password) VALUES ($1, $2)',
      [email, hashedPassword]
    );

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

    return { success: true, message: 'Login berhasil!' };
  } catch (err) {
    console.error('Login error:', err);
    return { success: false, message: 'Terjadi kesalahan server.' };
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