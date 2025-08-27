// db.js – opens DB and ensures all required tables/columns exist (idempotent)
import sqlite3 from "sqlite3";
import { open } from "sqlite";

let db;

// Add a column if it doesn't exist yet (defSql MUST include the column name)
async function addColumnIfMissing(table, column, defSql) {
  const cols = await db.all(`PRAGMA table_info(${table});`);
  const has = cols.some((c) => c.name === column);
  if (!has) {
    console.log(`Migration: adding ${table}.${column}`);
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${defSql};`);
  }
}

// Create an index if it doesn't exist
async function ensureIndex(name, sql) {
  await db.exec(`CREATE INDEX IF NOT EXISTS ${name} ${sql};`);
}

const initDB = async () => {
  db = await open({
    filename: "./database.sqlite", // keep in sync with your CLI usage
    driver: sqlite3.Database,
  });

  // Pragmas for stability/concurrency
  await db.exec(`PRAGMA foreign_keys = ON;`);
  await db.exec(`PRAGMA journal_mode = WAL;`);
  await db.exec(`PRAGMA busy_timeout = 3000;`);

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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      type TEXT NOT NULL,         -- daily | social | onchain | etc
      url TEXT NOT NULL,
      xp INTEGER NOT NULL,
      requiredTier TEXT DEFAULT 'Free',
      requiresTwitter INTEGER NOT NULL DEFAULT 0,
      -- flexible gating
      code TEXT UNIQUE,           -- stable code for admin/seed
      requirement TEXT,           -- e.g. none | x_follow | tg_channel_member | tg_group_member | tg_bot_linked | discord_member
      target TEXT,                -- e.g. @handle, invite link, group username
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS completed_quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      questId INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      UNIQUE(wallet, questId)
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Social links per wallet (used by Profile page)
    CREATE TABLE IF NOT EXISTS social_links (
      wallet TEXT PRIMARY KEY,
      twitter TEXT,
      telegram TEXT,
      discord TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  `);

  // --- Indices (speed up common lookups) ---
  await ensureIndex("idx_quests_code",      "ON quests(code)");
  await ensureIndex("idx_quests_active",    "ON quests(active)");
  await ensureIndex("idx_completed_wallet", "ON completed_quests(wallet)");
  await ensureIndex("idx_completed_qid",    "ON completed_quests(questId)");
  await ensureIndex("idx_history_wallet",   "ON quest_history(wallet)");
  await ensureIndex("idx_referrals_ref",    "ON referrals(referrer)");
  await ensureIndex("idx_referrals_red",    "ON referrals(referred)");
  // If you want uniqueness so a wallet can't be referred twice, uncomment:
  // await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_referrals_referred ON referrals(referred);");

  // --- Columns (safe migrations for older DBs) ---
  // users
  await addColumnIfMissing("users", "tier",                  `tier TEXT NOT NULL DEFAULT 'Free'`);
  await addColumnIfMissing("users", "levelName",             `levelName TEXT DEFAULT 'Shellborn'`);
  await addColumnIfMissing("users", "levelSymbol",           `levelSymbol TEXT DEFAULT '🐚'`);
  await addColumnIfMissing("users", "levelProgress",         `levelProgress REAL DEFAULT 0`);
  await addColumnIfMissing("users", "nextXP",                `nextXP INTEGER DEFAULT 10000`);
  await addColumnIfMissing("users", "twitterHandle",         `twitterHandle TEXT`);
  await addColumnIfMissing("users", "telegramId",            `telegramId TEXT`);
  await addColumnIfMissing("users", "telegramHandle",        `telegramHandle TEXT`);
  await addColumnIfMissing("users", "discordId",             `discordId TEXT`);
  await addColumnIfMissing("users", "discordHandle",         `discordHandle TEXT`);
  await addColumnIfMissing("users", "discordAccessToken",    `discordAccessToken TEXT`);
  await addColumnIfMissing("users", "discordRefreshToken",   `discordRefreshToken TEXT`);
  await addColumnIfMissing("users", "discordTokenExpiresAt", `discordTokenExpiresAt INTEGER`);
  await addColumnIfMissing("users", "discordGuildMember",    `discordGuildMember INTEGER DEFAULT 0`);
  await addColumnIfMissing("users", "created_at",            `created_at DATETIME DEFAULT CURRENT_TIMESTAMP`);

  // quests
  await addColumnIfMissing("quests", "requiredTier",         `requiredTier TEXT DEFAULT 'Free'`);
  await addColumnIfMissing("quests", "requiresTwitter",      `requiresTwitter INTEGER NOT NULL DEFAULT 0`);
  await addColumnIfMissing("quests", "code",                 `code TEXT UNIQUE`);
  await addColumnIfMissing("quests", "requirement",          `requirement TEXT`);
  await addColumnIfMissing("quests", "target",               `target TEXT`);
  await addColumnIfMissing("quests", "active",               `active INTEGER DEFAULT 1`);

  // social_links/referrals extras
  await addColumnIfMissing("social_links", "updated_at",     `updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`);
  await addColumnIfMissing("referrals",    "created_at",     `created_at DATETIME DEFAULT CURRENT_TIMESTAMP`);

  // --- Normalize legacy NULLs to defaults ---
  await db.exec(`
    UPDATE users SET tier='Free'           WHERE tier IS NULL;
    UPDATE users SET levelName='Shellborn' WHERE levelName IS NULL;
    UPDATE users SET levelSymbol='🐚'      WHERE levelSymbol IS NULL;
    UPDATE users SET levelProgress=0       WHERE levelProgress IS NULL;
    UPDATE users SET nextXP=10000          WHERE nextXP IS NULL;
    UPDATE users SET discordGuildMember=0  WHERE discordGuildMember IS NULL;
  `);
};

await initDB();
export default db;
