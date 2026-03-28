// scripts/migrate-on-boot.mjs
// Mandatory Postgres startup initialization + idempotent schema guards.

import { fileURLToPath } from "node:url";
import db from "../lib/db.js";

const REQUIRED_TABLES = [
  "users",
  "quests",
  "completed_quests",
  "subscriptions",
  "referrals",
  "arenas",
  "arena_participants",
  "arena_quests",
  "arena_claims",
  "payments",
  "payment_events",
  "reward_rules",
  "reward_payouts",
  "sponsor_applications",
  "sponsors",
  "sponsor_campaigns",
  "audit_logs",
];

const IS_SQLITE = db.dialect === "sqlite";

const SQLITE_BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT UNIQUE NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  tier TEXT NOT NULL DEFAULT 'Free',
  subscriptionTier TEXT DEFAULT 'Free',
  levelName TEXT DEFAULT 'Shellborn',
  levelSymbol TEXT DEFAULT '🐚',
  levelProgress REAL DEFAULT 0,
  nextXP INTEGER DEFAULT 10000,
  referral_code TEXT UNIQUE,
  referred_by TEXT,
  socials TEXT DEFAULT '{}',
  twitterHandle TEXT,
  twitter_username TEXT,
  twitter_id TEXT,
  telegramId TEXT,
  telegramHandle TEXT,
  telegram_username TEXT,
  discordId TEXT,
  discord_id TEXT,
  discordHandle TEXT,
  discord_username TEXT,
  discordAccessToken TEXT,
  discordRefreshToken TEXT,
  discordTokenExpiresAt INTEGER,
  discordGuildMember INTEGER DEFAULT 0,
  paid INTEGER DEFAULT 0,
  lastPaymentAt TEXT,
  subscriptionPaidAt TEXT,
  subscriptionClaimedAt TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quests (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT 'All',
  kind TEXT DEFAULT 'link',
  requirement TEXT DEFAULT 'none',
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
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(wallet, quest_id)
);

CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer TEXT NOT NULL,
  referred TEXT NOT NULL,
  code TEXT UNIQUE,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(referred)
);


CREATE TABLE IF NOT EXISTS social_links (
  wallet TEXT PRIMARY KEY,
  twitter TEXT,
  telegram TEXT,
  discord TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quest_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  quest_id TEXT,
  title TEXT,
  xp INTEGER DEFAULT 0,
  completed_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quest_proofs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  quest_id INTEGER,
  vendor TEXT,
  url TEXT,
  tweet_id TEXT,
  status TEXT,
  details TEXT,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
  questId TEXT,
  UNIQUE(wallet, quest_id, url)
);

CREATE TABLE IF NOT EXISTS proofs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  url TEXT,
  provider TEXT,
  status TEXT,
  reason TEXT,
  tweet_id TEXT,
  handle TEXT,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(wallet, quest_id)
);

CREATE TABLE IF NOT EXISTS token_sale_contributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  ton_amount REAL NOT NULL,
  usd_amount REAL DEFAULT 0,
  referral_code TEXT,
  tx_hash TEXT,
  checkout_session_id TEXT UNIQUE,
  status TEXT,
  event_id TEXT UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS token_sale_events (
  eventId TEXT PRIMARY KEY,
  receivedAt TEXT DEFAULT CURRENT_TIMESTAMP,
  raw TEXT
);

CREATE TABLE IF NOT EXISTS tier_multipliers (
  tier TEXT PRIMARY KEY,
  multiplier REAL DEFAULT 1.0,
  label TEXT
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'Free',
  tonAmount REAL DEFAULT 0,
  usdAmount REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  sessionId TEXT UNIQUE,
  nonce TEXT,
  sessionCreatedAt TEXT,
  txHash TEXT,
  renewalDate TEXT,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sponsors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  billing_mode TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS arenas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  arena_type TEXT NOT NULL DEFAULT 'standard',
  entry_fee_amount REAL NOT NULL DEFAULT 0,
  entry_fee_currency TEXT NOT NULL DEFAULT 'TON',
  prize_pool_amount REAL NOT NULL DEFAULT 0,
  prize_pool_currency TEXT NOT NULL DEFAULT 'TON',
  status TEXT NOT NULL DEFAULT 'draft',
  start_time TEXT,
  end_time TEXT,
  max_participants INTEGER,
  visibility TEXT NOT NULL DEFAULT 'public',
  scoring_mode TEXT NOT NULL DEFAULT 'xp',
  payout_mode TEXT NOT NULL DEFAULT 'manual',
  sponsor_id INTEGER,
  created_by TEXT,
  settled_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_wallet TEXT NOT NULL,
  arena_id INTEGER,
  payment_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_reference TEXT,
  external_order_id TEXT,
  external_transaction_id TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  amount_usd_equiv REAL,
  status TEXT NOT NULL DEFAULT 'pending',
  checkout_url TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS arena_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arena_id INTEGER NOT NULL,
  user_wallet TEXT NOT NULL,
  wallet TEXT NOT NULL,
  joined_via TEXT NOT NULL DEFAULT 'free',
  join_payment_id INTEGER,
  arena_xp INTEGER NOT NULL DEFAULT 0,
  rank_cached INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(arena_id, user_wallet)
);

CREATE TABLE IF NOT EXISTS arena_quests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arena_id INTEGER NOT NULL,
  quest_id TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(arena_id, quest_id)
);

CREATE TABLE IF NOT EXISTS arena_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arena_id INTEGER NOT NULL,
  quest_id TEXT NOT NULL,
  user_wallet TEXT NOT NULL,
  awarded_xp INTEGER NOT NULL DEFAULT 0,
  verification_status TEXT NOT NULL DEFAULT 'approved',
  proof_payload TEXT,
  source TEXT DEFAULT 'quest_claim',
  claimed_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(arena_id, user_wallet, quest_id)
);

CREATE TABLE IF NOT EXISTS payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  external_reference TEXT,
  payload TEXT NOT NULL,
  processed INTEGER NOT NULL DEFAULT 0,
  processed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reward_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arena_id INTEGER NOT NULL,
  rank_from INTEGER NOT NULL,
  rank_to INTEGER NOT NULL,
  reward_type TEXT NOT NULL DEFAULT 'token',
  reward_amount REAL NOT NULL,
  reward_currency TEXT NOT NULL DEFAULT 'TON',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reward_payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arena_id INTEGER NOT NULL,
  user_wallet TEXT NOT NULL,
  rank_final INTEGER NOT NULL,
  payout_amount REAL NOT NULL,
  payout_currency TEXT NOT NULL DEFAULT 'TON',
  payout_provider TEXT NOT NULL DEFAULT 'manual',
  payout_status TEXT NOT NULL DEFAULT 'pending',
  payout_reference TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(arena_id, user_wallet, rank_final)
);

CREATE TABLE IF NOT EXISTS sponsor_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  telegram_handle TEXT,
  twitter_handle TEXT,
  website_url TEXT,
  campaign_type TEXT NOT NULL,
  target_audience TEXT,
  desired_start_date TEXT,
  budget REAL DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sponsor_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sponsor_id INTEGER NOT NULL,
  sponsor_application_id INTEGER,
  campaign_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  slot_type TEXT NOT NULL,
  placement TEXT,
  arena_id INTEGER,
  quest_id TEXT,
  budget REAL DEFAULT 0,
  payment_id INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  start_time TEXT,
  end_time TEXT,
  report_payload TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT,
  actor_id TEXT,
  actor_wallet TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  data TEXT,
  payload TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

const STARTUP_GUARDS_SQL = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS socials TEXT DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS levelName TEXT DEFAULT 'Shellborn';
ALTER TABLE users ADD COLUMN IF NOT EXISTS levelSymbol TEXT DEFAULT '🐚';
ALTER TABLE users ADD COLUMN IF NOT EXISTS levelProgress DOUBLE PRECISION DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS nextXP INTEGER DEFAULT 10000;

ALTER TABLE quests ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'All';
ALTER TABLE quests ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'link';
ALTER TABLE quests ADD COLUMN IF NOT EXISTS requirement TEXT DEFAULT 'none';
ALTER TABLE quests ADD COLUMN IF NOT EXISTS url TEXT DEFAULT '';
ALTER TABLE quests ADD COLUMN IF NOT EXISTS active INTEGER DEFAULT 1;
ALTER TABLE quests ADD COLUMN IF NOT EXISTS sort INTEGER DEFAULT 0;
ALTER TABLE quests ADD COLUMN IF NOT EXISTS updatedAt BIGINT DEFAULT EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::bigint;

ALTER TABLE completed_quests ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS completed INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_wallet ON users(wallet);
CREATE UNIQUE INDEX IF NOT EXISTS uq_quests_code ON quests(code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_completed_wallet_quest ON completed_quests(wallet, quest_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_referrals_referred ON referrals(referred);
CREATE UNIQUE INDEX IF NOT EXISTS uq_arena_participants_arena_wallet ON arena_participants(arena_id, user_wallet);
CREATE UNIQUE INDEX IF NOT EXISTS uq_arena_quests_arena_quest ON arena_quests(arena_id, quest_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_arena_claims_unique ON arena_claims(arena_id, user_wallet, quest_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reward_payouts_rank ON reward_payouts(arena_id, user_wallet, rank_final);
`;

async function verifyRequiredTablesExist() {
  const missing = [];

  for (const table of REQUIRED_TABLES) {
    let row;
    if (IS_SQLITE) {
      row = await db.get(
        `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
        table
      );
    } else {
      row = await db.get(
        `SELECT to_regclass($1) AS table_name`,
        `public.${table}`
      );
    }

    const exists = IS_SQLITE ? row?.name : row?.table_name;
    if (!exists) {
      missing.push(table);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required tables after migration: ${missing.join(", ")}`);
  }
}

export async function migrateOnBoot() {
  if (!IS_SQLITE && !process.env.DATABASE_URL && !process.env.PGHOST) {
    throw new Error("DATABASE_URL is missing for Postgres runtime. Startup aborted.");
  }

  try {
    await db.get("SELECT 1 AS ok");
    console.log(IS_SQLITE ? "SQLite connected" : "Postgres connected");
  } catch (error) {
    throw new Error(`${IS_SQLITE ? "SQLite" : "Postgres"} connection failed: ${error.message}`);
  }

  try {
    if (IS_SQLITE) {
      await db.exec(SQLITE_BOOTSTRAP_SQL);
    } else {
      await db.initializePostgresSchema();
      await db.exec(STARTUP_GUARDS_SQL);
    }
    await verifyRequiredTablesExist();
    console.log("Migrations complete");
  } catch (error) {
    throw new Error(`Migration failed during startup: ${error.message}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await migrateOnBoot();
}
