/**
 * Bootstrap migration: create base tables if missing and set PRAGMA user_version.
 * Idempotent (safe to run multiple times).
 */
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', '7gc.sqlite3');
const db = new Database(dbPath);

// Speed up batch DDL
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    wallet TEXT UNIQUE,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    referrer TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS quest_groups (
    id INTEGER PRIMARY KEY,
    key TEXT UNIQUE,
    title TEXT
  );

  CREATE TABLE IF NOT EXISTS quests (
    id INTEGER PRIMARY KEY,
    slug TEXT UNIQUE,
    title TEXT,
    description TEXT,
    group_id INTEGER,
    active INTEGER DEFAULT 1,
    FOREIGN KEY (group_id) REFERENCES quest_groups(id)
  );

  CREATE TABLE IF NOT EXISTS quest_tasks (
    id INTEGER PRIMARY KEY,
    quest_id INTEGER,
    kind TEXT,
    payload TEXT,
    xp INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    FOREIGN KEY (quest_id) REFERENCES quests(id)
  );

  CREATE TABLE IF NOT EXISTS tiers (
    id INTEGER PRIMARY KEY,
    key TEXT UNIQUE,
    title TEXT,
    threshold INTEGER
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY,
    wallet TEXT UNIQUE,
    plan TEXT,
    status TEXT,
    started_at TEXT,
    expires_at TEXT
  );

  CREATE TABLE IF NOT EXISTS token_sale_phases (
    id INTEGER PRIMARY KEY,
    name TEXT,
    ton_price REAL,
    usd_price REAL,
    starts_at TEXT,
    ends_at TEXT,
    supply INTEGER,
    sold INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1
  );
`);

// Correct PRAGMA line (no stray backtick)
db.exec('PRAGMA user_version = 1;');

console.log(`✓ bootstrap migration complete at ${dbPath}`);
db.close();
