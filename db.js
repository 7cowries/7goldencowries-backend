import sqlite3 from "sqlite3";
import { open } from "sqlite";

const DB_URL = process.env.DATABASE_URL || "./data.db";

/**
 * Single shared connection (Render-safe, ESM-safe)
 */
const dbPromise = open({
  filename: DB_URL,
  driver: sqlite3.Database,
});

/**
 * Ensure base tables that the rest of the app expects.
 * We keep it tiny here because server.js also ensures billing tables.
 */
async function ensureCore() {
  const db = await dbPromise;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL UNIQUE,
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      twitter_handle TEXT,
      level_name TEXT,
      level_progress REAL DEFAULT 0
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS quests (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT,
      xp INTEGER NOT NULL DEFAULT 0,
      target_url TEXT,
      twitter_action TEXT,
      twitter_target TEXT
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      quest_id TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, quest_id)
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inviter_wallet TEXT NOT NULL,
      invitee_wallet TEXT,
      code TEXT NOT NULL,
      claimed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

await ensureCore();

export default dbPromise;

/**
 * convenience wrappers (so server.js can do: await db.get(...) )
 */
export async function get(sql, ...params) {
  const db = await dbPromise;
  return db.get(sql, ...params);
}

export async function all(sql, ...params) {
  const db = await dbPromise;
  return db.all(sql, ...params);
}

export async function run(sql, ...params) {
  const db = await dbPromise;
  return db.run(sql, ...params);
}
