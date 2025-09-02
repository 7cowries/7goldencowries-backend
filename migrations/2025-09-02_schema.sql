-- ============================================
-- 7goldencowries — SAFE schema (no duplicate ALTERs)
-- Run with:
--   sqlite3 database.sqlite < migrations/2025-09-02_schema.sql
-- ============================================

BEGIN;

-- ---------------------------
-- Quests master table
-- ---------------------------
CREATE TABLE IF NOT EXISTS quests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT UNIQUE,                 -- e.g. 'JOIN_TELEGRAM', 'JOIN_DISCORD', 'LINK_TWITTER'
  type       TEXT,                        -- 'link' | 'join_telegram' | 'join_discord' | ...
  xp         INTEGER DEFAULT 0,
  meta       TEXT,                        -- JSON blob (target_url, min_seconds, etc)
  is_active  INTEGER DEFAULT 1
);

-- ---------------------------
-- Link-quest attempts (anti-abuse)
-- ---------------------------
CREATE TABLE IF NOT EXISTS quest_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  quest_id    INTEGER NOT NULL,
  nonce       TEXT NOT NULL UNIQUE,
  target_url  TEXT NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  clicked_at  DATETIME,
  finished_at DATETIME,
  ip          TEXT,
  ua          TEXT
);

-- ---------------------------
-- Quest completions (idempotent)
-- NOTE: If you already had an older table with different columns,
-- this CREATE IF NOT EXISTS will do nothing (keeps your old table).
-- That’s okay for now; we can upgrade it later if needed.
-- ---------------------------
CREATE TABLE IF NOT EXISTS quest_completions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  quest_id    INTEGER NOT NULL,
  xp_awarded  INTEGER NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, quest_id)
);

-- ---------------------------
-- XP history ledger (for UI/audit)
-- ---------------------------
CREATE TABLE IF NOT EXISTS xp_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  delta      INTEGER NOT NULL,
  reason     TEXT NOT NULL,               -- e.g. 'QUEST:JOIN_TELEGRAM', 'REFERRAL:referrer_bonus'
  meta       TEXT,                         -- JSON (questId, referral ids, etc.)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------
-- Referrals (new schema — idempotent)
-- If you had an older table with referrer/referred wallets,
-- this will NOT override it. We can migrate later if needed.
-- ---------------------------
CREATE TABLE IF NOT EXISTS referrals (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_user_id   INTEGER NOT NULL,
  referee_user_id    INTEGER NOT NULL,
  code               TEXT NOT NULL,       -- referrer's referral_code at time of link
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(referee_user_id)
);

-- ---------------------------
-- Referral events (first quest marker)
-- ---------------------------
CREATE TABLE IF NOT EXISTS referral_events (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  referee_user_id             INTEGER NOT NULL,
  first_quest_completed_at    DATETIME
);

COMMIT;

-- ============================================
-- OPTIONAL SEED DATA (uncomment to insert)
-- ============================================
-- INSERT OR IGNORE INTO quests (key, type, xp, meta, is_active)
-- VALUES
--   ('JOIN_TELEGRAM', 'join_telegram', 30, '{}', 1),
--   ('JOIN_DISCORD',  'join_discord',  30, '{}', 1),
--   ('LINK_TWITTER',  'link',          10, '{"target_url":"https://x.com/7goldencowries","min_seconds":8}', 1);
