// lib/db.js – opens DB and ensures all required tables/columns exist (idempotent)
/*
 * TODO(postgres-migration): replace this SQLite helper with a pooled Postgres client
 * once infrastructure is provisioned.
 */
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import fs from "fs";
import path from "path";

let db;

// Add a column if it doesn't exist yet. "type" may include constraints but
// any DEFAULT expressions are stripped to keep migrations idempotent.
async function addColumnIfMissing(table, column, type) {
  const cols = await db.all(`PRAGMA table_info(${table});`);
  const has = cols.some((c) => c.name === column);
  if (!has) {
    let t = String(type || "");
    if (t.toUpperCase().startsWith(column.toUpperCase())) {
      t = t.slice(column.length).trim();
    }
    t = t.replace(/DEFAULT.+$/i, "").trim();
    if (process.env.NODE_ENV !== 'test') {
      console.log(`Migration: added ${table}.${column}`);
    }
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${t};`);
    return true;
  }
  return false;
}

// Create an index if it doesn't exist
async function ensureIndex(name, sql) {
  await db.exec(`CREATE INDEX IF NOT EXISTS ${name} ${sql};`);
}

// Create a unique index if it doesn't exist
async function ensureUniqueIndex(name, sql) {
  await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${name} ${sql};`);
}

const initDB = async () => {
  const DB_FILE = process.env.DATABASE_URL || "/var/data/7go.sqlite";
  try {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  } catch (e) {
    console.error("DB directory creation failed", e);
  }

  db = await open({
    filename: DB_FILE,
    driver: sqlite3.Database,
  });

  // Pragmas for stability/concurrency
  await db.exec(`PRAGMA foreign_keys = ON;`);
  await db.exec(`PRAGMA journal_mode = WAL;`);
  await db.exec(`PRAGMA synchronous = NORMAL;`);
  await db.exec(`PRAGMA busy_timeout = 3000;`);

  // --- Core tables (create if missing) ---
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      wallet TEXT PRIMARY KEY,
      xp INTEGER NOT NULL DEFAULT 0,
      tier TEXT NOT NULL DEFAULT 'Free',
      levelName TEXT DEFAULT 'Shellborn',
      levelSymbol TEXT DEFAULT '🐚',
      levelProgress REAL DEFAULT 0,
      nextXP INTEGER DEFAULT 10000,
      referral_code TEXT,
      referred_by TEXT,
      socials TEXT DEFAULT '{}',
      twitterHandle TEXT,
      -- social / oauth fields
      telegramId TEXT,
      telegramHandle TEXT,
      discordId TEXT,
      discordHandle TEXT,
      discordAccessToken TEXT,
      discordRefreshToken TEXT,
      discordTokenExpiresAt INTEGER,
      discordGuildMember INTEGER DEFAULT 0,
      paid INTEGER DEFAULT 0,
      lastPaymentAt TEXT,
      created_at DATETIME,
      updatedAt DATETIME,
      UNIQUE(referral_code)
    );

    CREATE TABLE IF NOT EXISTS quests (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      category TEXT DEFAULT 'All',
      kind TEXT DEFAULT 'link',            -- 'link' | 'social' | 'onchain' | etc.
      url TEXT DEFAULT '',
      xp INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      sort INTEGER DEFAULT 0,
      createdAt INTEGER DEFAULT (strftime('%s','now')),
      updatedAt INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS completed_quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      quest_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      UNIQUE(wallet, quest_id)
    );

    /* Referrals:
       - referrer invites referred
       - completed = 1 when referred completes first quest (or per admin)
    */
    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer TEXT NOT NULL,
      referred TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME
    );

    -- Social links per wallet (used by Profile page)
    CREATE TABLE IF NOT EXISTS social_links (
      wallet TEXT PRIMARY KEY,
      twitter TEXT,
      telegram TEXT,
      discord TEXT,
      updated_at DATETIME
    );

    -- Quest history feed for Profile page (optional convenience log)
    CREATE TABLE IF NOT EXISTS quest_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      quest_id TEXT,
      title TEXT,
      xp INTEGER DEFAULT 0,
      completed_at TEXT DEFAULT (datetime('now'))
    );

    -- User submitted proofs for off-chain verification
    CREATE TABLE IF NOT EXISTS quest_proofs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      quest_id INTEGER,
      vendor TEXT,
      url TEXT,
      tweet_id TEXT,
      status TEXT,
      details TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now')),
      questId TEXT, -- legacy column
      UNIQUE(wallet, quest_id, url)
    );

    -- Subscriptions (used by daily expiry cron in index.js)
    -- status: active | expired | canceled
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      tier TEXT NOT NULL,                  -- Free | Tier1 | Tier2 | Tier3
      tonAmount REAL DEFAULT 0,
      usdAmount REAL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Token sale contributions (used by tokenSaleRoutes)
    CREATE TABLE IF NOT EXISTS token_sale_contributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      ton_amount REAL NOT NULL,
      usd_amount REAL DEFAULT 0,
      referral_code TEXT,
      tx_hash TEXT,                        -- optional onchain tx id
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS token_sale_events (
      eventId TEXT PRIMARY KEY,
      receivedAt TEXT NOT NULL DEFAULT (datetime('now')),
      raw JSON
    );

    CREATE TABLE IF NOT EXISTS tier_multipliers (
      tier TEXT PRIMARY KEY,
      multiplier REAL DEFAULT 1.0,
      label TEXT
    );
  `);

  // Ensure critical columns exist before creating indices (for older DBs)
  await addColumnIfMissing("completed_quests", "timestamp", "TEXT");
  await db.exec("UPDATE completed_quests SET timestamp = COALESCE(timestamp, datetime('now'))");
  await addColumnIfMissing("subscriptions", "timestamp", "TEXT");
  await db.exec("UPDATE subscriptions SET timestamp = COALESCE(timestamp, datetime('now'))");
  await addColumnIfMissing("quest_proofs", "status", "TEXT");
  await db.exec("UPDATE quest_proofs SET status = COALESCE(status, 'pending')");

  // --- Indices (speed up common lookups) ---
  await ensureIndex("idx_quests_active",    "ON quests(active)");
  await ensureIndex("idx_completed_wallet", "ON completed_quests(wallet)");
  await ensureIndex("idx_completed_qid",    "ON completed_quests(quest_id)");
  await ensureIndex("idx_completed_wallet_qid_time", "ON completed_quests(wallet, quest_id, timestamp)");
  await ensureUniqueIndex("uq_completed_wallet_quest", "ON completed_quests(wallet, quest_id)");
  await ensureIndex("idx_proofs_wallet_quest", "ON quest_proofs(wallet, quest_id)");
  await ensureIndex("idx_proofs_status",    "ON quest_proofs(status)");
  await ensureUniqueIndex("uq_proofs_wallet_quest_url", "ON quest_proofs(wallet, quest_id, url)");
  await ensureIndex("idx_history_wallet",   "ON quest_history(wallet)");
  await ensureIndex("idx_referrals_ref",    "ON referrals(referrer)");
  await ensureIndex("idx_referrals_red",    "ON referrals(referred)");
  await ensureUniqueIndex("uq_referrals_referred", "ON referrals(referred)");
  await ensureIndex("idx_subscriptions_wallet_time", "ON subscriptions(wallet, timestamp)");
  await ensureIndex("idx_tokensale_wallet_time", "ON token_sale_contributions(wallet, created_at)");

  await ensureUniqueIndex("uq_users_wallet", "ON users(wallet)");
  await ensureUniqueIndex("uq_users_referral_code", "ON users(referral_code)");
  await ensureIndex("idx_users_twitter", "ON users(twitterHandle)");
  await ensureIndex("idx_users_levelname", "ON users(levelName)");

  // Ensure uniqueness for social_links upsert logic
  await ensureUniqueIndex("uq_social_links_wallet", "ON social_links(wallet)");

  // --- Backward-compatible column migrations (safe) ---
  // quests
  await addColumnIfMissing("quests", "requirement", "TEXT");
  await db.exec(`
    UPDATE quests SET requirement='none' WHERE requirement IS NULL;
    UPDATE quests SET requirement='x_follow'   WHERE title LIKE 'Follow @% on X%';
    UPDATE quests SET requirement='x_retweet'  WHERE title LIKE 'Retweet%';
    UPDATE quests SET requirement='x_quote'    WHERE title LIKE 'Quote%';
  `);

  // completed_quests legacy additions
  await addColumnIfMissing("completed_quests", "quest_id", "TEXT");
  try {
    await db.exec(
      "UPDATE completed_quests SET quest_id = questId WHERE quest_id IS NULL AND questId IS NOT NULL"
    );
  } catch {}

  // quest_proofs legacy additions
  await addColumnIfMissing("quest_proofs", "vendor", "TEXT");
  await addColumnIfMissing("quest_proofs", "updatedAt", "TEXT");
  await addColumnIfMissing("quest_proofs", "quest_id", "INTEGER");
  await addColumnIfMissing("quest_proofs", "tweet_id", "TEXT");
  try {
    await db.exec(
      "UPDATE quest_proofs SET quest_id = questId WHERE quest_id IS NULL AND questId IS NOT NULL"
    );
  } catch {}

  // ensure quest_proofs has new unique constraint on (wallet, quest_id, url)
  try {
    const indexes = await db.all("PRAGMA index_list('quest_proofs')");
    const hasNewIndex = indexes.some((i) => i.name === 'uq_proofs_wallet_quest_url');
    if (!hasNewIndex) {
      await db.exec(`
        ALTER TABLE quest_proofs RENAME TO quest_proofs_old;
        CREATE TABLE quest_proofs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          wallet TEXT NOT NULL,
          quest_id INTEGER,
          vendor TEXT,
          url TEXT,
          tweet_id TEXT,
          status TEXT,
          details TEXT,
          createdAt TEXT DEFAULT (datetime('now')),
          updatedAt TEXT DEFAULT (datetime('now')),
          questId TEXT,
          UNIQUE(wallet, quest_id, url)
        );
        INSERT INTO quest_proofs (id, wallet, quest_id, vendor, url, tweet_id, status, details, createdAt, updatedAt, questId)
        SELECT id, wallet, quest_id, vendor, url, tweet_id, status, details, createdAt, updatedAt, questId FROM quest_proofs_old;
        DROP TABLE quest_proofs_old;
      `);
      await ensureUniqueIndex('uq_proofs_wallet_quest_url', 'ON quest_proofs(wallet, quest_id, url)');
    }
  } catch (e) {
    console.error('quest_proofs migration failed', e);
  }

  // users
  await addColumnIfMissing("users", "tier",                  `tier TEXT NOT NULL DEFAULT 'Free'`);
  await addColumnIfMissing("users", "levelName",             `levelName TEXT DEFAULT 'Shellborn'`);
  await addColumnIfMissing("users", "levelSymbol",           `levelSymbol TEXT DEFAULT '🐚'`);
  await addColumnIfMissing("users", "levelProgress",         `levelProgress REAL DEFAULT 0`);
  await addColumnIfMissing("users", "nextXP",                `nextXP INTEGER DEFAULT 10000`);
  await addColumnIfMissing("users", "referral_code",         `referral_code TEXT`);
  await addColumnIfMissing("users", "referred_by",           `referred_by TEXT`);
  await addColumnIfMissing("users", "twitterHandle",         `twitterHandle TEXT`);
  await addColumnIfMissing("users", "telegramId",            `telegramId TEXT`);
  await addColumnIfMissing("users", "telegramHandle",        `telegramHandle TEXT`);
  await addColumnIfMissing("users", "discordId",             `discordId TEXT`);
  await addColumnIfMissing("users", "discordHandle",         `discordHandle TEXT`);
  await addColumnIfMissing("users", "discordAccessToken",    `discordAccessToken TEXT`);
  await addColumnIfMissing("users", "discordRefreshToken",   `discordRefreshToken TEXT`);
  await addColumnIfMissing("users", "discordTokenExpiresAt", `discordTokenExpiresAt INTEGER`);
  await addColumnIfMissing("users", "discordGuildMember",    `discordGuildMember INTEGER DEFAULT 0`);
  await addColumnIfMissing("users", "updatedAt",             `updatedAt DATETIME`);
  await db.exec(
    "UPDATE users SET updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE updatedAt IS NULL"
  );
  await addColumnIfMissing("users", "created_at",            `created_at DATETIME`);
  await db.exec(
    "UPDATE users SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE created_at IS NULL"
  );
  await addColumnIfMissing("users", "telegram_username",     `telegram_username TEXT`);
  await addColumnIfMissing("users", "twitter_username",      `twitter_username TEXT`);
  await addColumnIfMissing("users", "twitter_id",            `twitter_id TEXT`);
  await addColumnIfMissing("users", "discord_username",      `discord_username TEXT`);
  await addColumnIfMissing("users", "discord_id",            `discord_id TEXT`);
  await addColumnIfMissing("users", "socials",               `socials TEXT`);
  await db.exec("UPDATE users SET socials = COALESCE(socials, '{}')");
  await addColumnIfMissing("users", "paid",                  `paid INTEGER DEFAULT 0`);
  await db.exec("UPDATE users SET paid = COALESCE(paid, 0)");
  await addColumnIfMissing("users", "lastPaymentAt",         `lastPaymentAt TEXT`);


  // social_links/referrals extras
  await addColumnIfMissing("social_links", "updated_at",     `updated_at DATETIME`);
  await db.exec(
    "UPDATE social_links SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE updated_at IS NULL"
  );
  await addColumnIfMissing("referrals",    "created_at",     `created_at DATETIME`);
  await db.exec(
    "UPDATE referrals SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE created_at IS NULL"
  );

  // subscriptions (ensure any missing columns on older DBs)
  await addColumnIfMissing("subscriptions", "tonAmount",     `tonAmount REAL DEFAULT 0`);
  await addColumnIfMissing("subscriptions", "usdAmount",     `usdAmount REAL DEFAULT 0`);
  await addColumnIfMissing("subscriptions", "sessionId",     `sessionId TEXT`);
  await addColumnIfMissing("subscriptions", "renewalDate",   `renewalDate TEXT`);
  await addColumnIfMissing("subscriptions", "nonce",         `nonce TEXT`);
  await addColumnIfMissing("subscriptions", "sessionCreatedAt", `sessionCreatedAt TEXT`);
  await ensureUniqueIndex("uq_subscriptions_sessionId", "ON subscriptions(sessionId)");

  // token sale (ensure any missing columns on older DBs)
  await addColumnIfMissing("token_sale_contributions", "referral_code",       `referral_code TEXT`);
  await addColumnIfMissing("token_sale_contributions", "tx_hash",             `tx_hash TEXT`);
  await addColumnIfMissing("token_sale_contributions", "checkout_session_id", `checkout_session_id TEXT`);
  await addColumnIfMissing("token_sale_contributions", "status",             `status TEXT`);
  await addColumnIfMissing("token_sale_contributions", "event_id",           `event_id TEXT`);
  await db.exec(`
    DELETE FROM token_sale_contributions
    WHERE checkout_session_id IS NOT NULL
      AND rowid NOT IN (
        SELECT MIN(rowid)
        FROM token_sale_contributions
        WHERE checkout_session_id IS NOT NULL
        GROUP BY checkout_session_id
      );
  `);
  await ensureUniqueIndex("uq_token_sale_event_id", "ON token_sale_contributions(event_id)");
  await ensureUniqueIndex(
    "uq_token_sale_checkout_session",
    "ON token_sale_contributions(checkout_session_id)"
  );

  // --- Normalize legacy NULLs to defaults ---
  await db.exec(`
    UPDATE users SET tier='Free',           updatedAt=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE tier IS NULL;
    UPDATE users SET levelName='Shellborn', updatedAt=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE levelName IS NULL;
    UPDATE users SET levelSymbol='🐚',      updatedAt=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE levelSymbol IS NULL;
    UPDATE users SET levelProgress=0,       updatedAt=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE levelProgress IS NULL;
    UPDATE users SET nextXP=10000,          updatedAt=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE nextXP IS NULL;
    UPDATE users SET discordGuildMember=0,  updatedAt=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE discordGuildMember IS NULL;
    UPDATE subscriptions SET status='active' WHERE status IS NULL;
  `);
};

await initDB();
export default db;
