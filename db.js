import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// Prefer DATABASE_URL, then DATABASE_PATH, then SQLITE_FILE, then *hard* default to 7gc.sqlite3
const DB_FILE =
  process.env.DATABASE_URL ||
  process.env.DATABASE_PATH ||
  process.env.SQLITE_FILE ||
  '/var/data/7gc.sqlite3';

const dbp = open({ filename: DB_FILE, driver: sqlite3.Database }).then(async (db) => {
  await db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  console.log('[db] opened sqlite at', DB_FILE);
  return db;
});

export default dbp;
