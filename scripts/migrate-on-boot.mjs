// scripts/migrate-on-boot.mjs
// Run on server start to be idempotent on Render
import dbp, { run as dbRun } from "../db.js";

export default async function migrateOnBoot(log = console) {
  const db = await dbp;

  // users
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL UNIQUE,
      twitter_handle TEXT,
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      level_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // quests (NEW: description column included)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS quests (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT,
      xp INTEGER NOT NULL DEFAULT 0,
      url TEXT,
      kind TEXT DEFAULT 'offchain'
    );
  `);

  // user_quests (for claims)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS user_quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      quest_id TEXT NOT NULL,
      claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, quest_id)
    );
  `);

  // subscriptions
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

  // ton invoices
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

  // leaderboard
  await dbRun(`
    CREATE TABLE IF NOT EXISTS leaderboard (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      twitter_handle TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // seed real quests if empty
  const row = await db.get(`SELECT COUNT(*) AS c FROM quests;`);
  if (!row || row.c === 0) {
    log.log("[migrate-on-boot] seeding quests...");
    const quests = [
      {
        id: "follow-x",
        title: "Follow @7goldencowries",
        description: "Follow us on X to unlock the tides.",
        category: "twitter",
        xp: 50,
        url: "https://x.com/7goldencowries",
        kind: "twitter-follow"
      },
      {
        id: "retweet-pinned",
        title: "Retweet the pinned post",
        description: "RT our pinned quest call.",
        category: "twitter",
        xp: 70,
        url: "https://x.com/7goldencowries/status/1947595024117502145",
        kind: "twitter-retweet"
      },
      {
        id: "daily-checkin",
        title: "Daily Check-in",
        description: "Open 7 Golden Cowries today.",
        category: "daily",
        xp: 10,
        url: null,
        kind: "offchain"
      }
    ];
    for (const q of quests) {
      await dbRun(
        `INSERT OR IGNORE INTO quests (id, title, description, category, xp, url, kind)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        q.id,
        q.title,
        q.description,
        q.category,
        q.xp,
        q.url,
        q.kind
      );
    }
  }

  log.log("[migrate-on-boot] done");
}
