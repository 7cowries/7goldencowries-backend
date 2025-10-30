// scripts/migrate-on-boot.mjs
// runs at boot from server.js — make tables, add missing columns, seed live quests

import dbPromise, { dbRun, dbGet, dbAll } from "../db.js";

async function ensureQuests() {
  // main quests table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL DEFAULT 'general',
      xp INTEGER NOT NULL DEFAULT 0,
      link TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // per-user claims
  await dbRun(`
    CREATE TABLE IF NOT EXISTS user_quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_wallet TEXT NOT NULL,
      quest_code TEXT NOT NULL,
      claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_wallet, quest_code)
    );
  `);

  // if empty -> seed live social quests
  const row = await dbGet(`SELECT COUNT(*) AS c FROM quests;`);
  if (!row || !row.c) {
    await dbRun(
      `INSERT OR IGNORE INTO quests (code, title, description, category, xp, link)
       VALUES
        ('follow_x', 'Follow @7goldencowries', 'Follow our official X account to earn XP.', 'social', 50, 'https://x.com/7goldencowries'),
        ('rt_pinned', 'Retweet our pinned tweet', 'Boost our pinned post, then come back to verify.', 'social', 75, 'https://x.com/7goldencowries/status/1947595024117502145'),
        ('quote_post', 'Quote our pinned tweet', 'Quote the pinned post with your comment.', 'social', 90, 'https://x.com/7goldencowries/status/1947595024117502145');
      `
    );
  }
}

async function ensureSubscriptions() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'Free',
      active INTEGER NOT NULL DEFAULT 0,
      provider TEXT,
      tx_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS ton_invoices (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      tier TEXT NOT NULL,
      to_addr TEXT NOT NULL,
      amount BIGINT NOT NULL,
      comment TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      tx_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT
    );
  `);
}

export default async function migrateOnBoot(logger = console) {
  await dbPromise; // wait for DB to open

  logger.log("[migrate-on-boot] starting…");

  await ensureQuests();
  await ensureSubscriptions();

  logger.log("[migrate-on-boot] done.");
}

// auto-run if called directly (Render does this)
await migrateOnBoot(console);

