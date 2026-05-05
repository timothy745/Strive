import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function initDB(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Tambah kolom profile jika belum ada (safe to re-run)
    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS nama VARCHAR(255);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS dob DATE;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS weight NUMERIC;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS height NUMERIC;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_pic TEXT;
      END $$;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedules (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day VARCHAR(10) NOT NULL,
        exercise_name VARCHAR(100) NOT NULL,
        reps INTEGER NOT NULL DEFAULT 1,
        done BOOLEAN NOT NULL DEFAULT true,
        has_kg BOOLEAN NOT NULL DEFAULT false,
        kg INTEGER DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        UNIQUE(user_id, day, exercise_name)
      )
    `);

    console.log('✅ Database ready (users + schedules)');
  } catch (err) {
    console.error('❌ DB init error:', err);
  }
}

export default pool;