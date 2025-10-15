import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

const DB_FILE = process.env.DATABASE_URL || './data.sqlite';

export async function getDb() {
  const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
  await db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;

    CREATE TABLE IF NOT EXISTS leaderboard_scores (
      address    TEXT PRIMARY KEY,
      score      INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}
