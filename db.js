// db.js (ESM)
import fs from "fs";
import path from "path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const DB_FILE = process.env.SQLITE_FILE || "./data/7gc.sqlite3";

// Ensure folder exists (works on Render and locally)
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

// Open DB (top-level await is fine in Node 22 ESM)
const db = await open({ filename: DB_FILE, driver: sqlite3.Database });

// Basic pragmas + ensure 'users' table exists (safe idempotent)
await db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet TEXT UNIQUE,
    twitterHandle TEXT,
    xp INTEGER DEFAULT 0,
    levelName TEXT,
    levelProgress REAL DEFAULT 0,
    subscriptionTier TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );
`);

export default db;
