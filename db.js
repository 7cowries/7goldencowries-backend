// db.js – opens DB and ensures all required tables/columns exist
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let db;

async function addColumnIfMissing(table, column, defSql) {
  const cols = await db.all(`PRAGMA table_info(${table});`);
  const has = cols.some(c => c.name === column);
  if (!has) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${defSql};`);
  }
}

const initDB = async () => {
  db = await open({
    filename: './database.db',          // <— your DB path
    driver: sqlite3.Database
  });

  // --- Tables (create if missing) ---
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      wallet TEXT PRIMARY KEY,
      xp INTEGER NOT NULL DEFAULT 0,
      tier TEXT NOT NULL DEFAULT 'Free',
      levelName TEXT DEFAULT 'Shellborn',
      levelSymbol TEXT DEFAULT '🐚',
      levelProgress REAL DEFAULT 0,
      nextXP INTEGER DEFAULT 10000,
      twitterHandle TEXT
    );

    CREATE TABLE IF NOT EXISTS quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      url TEXT NOT NULL,
      xp INTEGER NOT NULL,
      requiredTier TEXT DEFAULT 'Free',
      requiresTwitter INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS completed_quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      questId INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      UNIQUE(wallet, questId)
    );

    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer TEXT NOT NULL,
      referred TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0
    );

    -- NEW: social links per wallet
    CREATE TABLE IF NOT EXISTS social_links (
      wallet TEXT PRIMARY KEY,
      twitter TEXT,
      telegram TEXT,
      discord TEXT
    );

    -- NEW: quest history feed for Profile page
    CREATE TABLE IF NOT EXISTS quest_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      quest_id TEXT,
      title TEXT,
      xp INTEGER DEFAULT 0,
      completed_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // --- Columns (add if the table exists but column is missing) ---
  await addColumnIfMissing('users', 'tier',           `tier TEXT NOT NULL DEFAULT 'Free'`);
  await addColumnIfMissing('users', 'levelName',      `levelName TEXT DEFAULT 'Shellborn'`);
  await addColumnIfMissing('users', 'levelSymbol',    `levelSymbol TEXT DEFAULT '🐚'`);
  await addColumnIfMissing('users', 'levelProgress',  `levelProgress REAL DEFAULT 0`);
  await addColumnIfMissing('users', 'nextXP',         `nextXP INTEGER DEFAULT 10000`);
  await addColumnIfMissing('users', 'twitterHandle',  `twitterHandle TEXT`);

  await addColumnIfMissing('quests', 'requiredTier',   `requiredTier TEXT DEFAULT 'Free'`);
  await addColumnIfMissing('quests', 'requiresTwitter',`requiresTwitter INTEGER NOT NULL DEFAULT 0`);

  // Make sure existing rows have non-null defaults (older rows)
  await db.exec(`
    UPDATE users SET tier='Free'            WHERE tier IS NULL;
    UPDATE users SET levelName='Shellborn'  WHERE levelName IS NULL;
    UPDATE users SET levelSymbol='🐚'       WHERE levelSymbol IS NULL;
    UPDATE users SET levelProgress=0        WHERE levelProgress IS NULL;
    UPDATE users SET nextXP=10000           WHERE nextXP IS NULL;
  `);
};

await initDB();
export default db;

