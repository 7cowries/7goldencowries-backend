// scripts/migrate-on-boot.mjs
// Mandatory Postgres startup initialization + idempotent schema guards.

import { fileURLToPath } from "node:url";
import db from "../lib/db.js";

const REQUIRED_TABLES = [
  "users",
  "quests",
  "completed_quests",
  "xp_ledger",
  "leaderboard_snapshots",
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

CREATE TABLE IF NOT EXISTS xp_ledger (
  id BIGSERIAL PRIMARY KEY,
  wallet TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  xp_delta INTEGER NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
  id BIGSERIAL PRIMARY KEY,
  period_key TEXT NOT NULL,
  wallet TEXT NOT NULL,
  xp_total INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(period_key, wallet)
);

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
    const row = await db.get(
      `SELECT to_regclass($1) AS table_name`,
      `public.${table}`
    );

    if (!row?.table_name) {
      missing.push(table);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required tables after migration: ${missing.join(", ")}`);
  }
}

export async function migrateOnBoot() {
  if (!process.env.DATABASE_URL && !process.env.PGHOST) {
    throw new Error("DATABASE_URL is missing for Postgres runtime. Startup aborted.");
  }

  try {
    await db.get("SELECT 1 AS ok");
    console.log("Postgres connected");
  } catch (error) {
    throw new Error(`Postgres connection failed: ${error.message}`);
  }

  try {
    await db.initializePostgresSchema();
    await db.exec(STARTUP_GUARDS_SQL);
    await verifyRequiredTablesExist();
    console.log("Migrations complete");
  } catch (error) {
    throw new Error(`Migration failed during startup: ${error.message}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await migrateOnBoot();
}
