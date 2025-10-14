import fs from "fs";
import path from "path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const DB_FILE = process.env.SQLITE_FILE || "./data/7gc.sqlite3";
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = await open({ filename: DB_FILE, driver: sqlite3.Database });

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

  CREATE TABLE IF NOT EXISTS quest_categories (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    xp INTEGER NOT NULL,
    url TEXT,
    partner TEXT,
    isDaily INTEGER DEFAULT 0,
    startsAt TEXT,
    endsAt TEXT,
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS user_quests (
    userId INTEGER NOT NULL,
    questId INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    claimedAt TEXT,
    PRIMARY KEY (userId, questId),
    FOREIGN KEY (userId) REFERENCES users(id),
    FOREIGN KEY (questId) REFERENCES quests(id)
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet TEXT NOT NULL,
    tier TEXT NOT NULL,
    tonPaid REAL,
    usdPaid REAL,
    active INTEGER DEFAULT 1,
    startedAt TEXT DEFAULT (datetime('now')),
    endsAt TEXT
  );

  CREATE TABLE IF NOT EXISTS token_sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet TEXT NOT NULL,
    amountTON REAL NOT NULL,
    tokens REAL,
    txHash TEXT,
    status TEXT DEFAULT 'pending',
    createdAt TEXT DEFAULT (datetime('now'))
  );
`);

const categories = [
  { key: "daily", name: "Daily" },
  { key: "social", name: "Social" },
  { key: "partner", name: "Partner" },
  { key: "insider", name: "Insider" },
  { key: "onchain", name: "On-Chain" }
];
for (const c of categories) {
  await db.run(`INSERT OR IGNORE INTO quest_categories (key, name) VALUES (?,?)`, [c.key, c.name]);
}

const quests = [
  { key: "daily_checkin", title: "Daily Check-in", category: "daily", xp: 500, url: "/quests/daily", isDaily: 1 },
  { key: "follow_x", title: "Follow @7goldencowries on X", category: "social", xp: 1500, url: "https://x.com/7goldencowries" },
  { key: "retweet_pinned", title: "Retweet the pinned post", category: "social", xp: 2000, url: "https://x.com/7goldencowries/status/1947595024117502145" },
  { key: "quote_pinned", title: "Quote the pinned post", category: "social", xp: 2500, url: "https://x.com/7goldencowries/status/1947595024117502145" },
  { key: "join_telegram", title: "Join our Telegram", category: "partner", xp: 1000, url: "https://t.me/GOLDENCOWRIEBOT", partner: "Telegram" },
  { key: "join_discord", title: "Join our Discord", category: "partner", xp: 1200, url: "https://discord.gg/7goldencowries", partner: "Discord" },
  { key: "read_guide", title: "Read the Isles Guide", category: "insider", xp: 800, url: "/guide/isles" },
  { key: "first_tx", title: "Make your first TON tx", category: "onchain", xp: 3000, url: "/onchain/first" }
];
for (const q of quests) {
  await db.run(
    `INSERT OR IGNORE INTO quests (key, title, category, xp, url, partner, isDaily, active) VALUES (?,?,?,?,?,?,?,1)`,
    [q.key, q.title, q.category, q.xp, q.url || null, q.partner || null, q.isDaily ? 1 : 0]
  );
}

await db.close();
console.log("DB bootstrap complete:", DB_FILE);
