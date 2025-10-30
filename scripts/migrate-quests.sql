PRAGMA foreign_keys=off;
BEGIN;

-- Ensure users table (minimal columns used by server)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL UNIQUE,
  xp INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Rebuild quests with full schema (safe if old columns differ)
-- If old table exists, copy over what we can, filling defaults for new cols
CREATE TABLE IF NOT EXISTS quests_new (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'oneoff',      -- oneoff | daily | referral | partner | onchain
  category TEXT NOT NULL DEFAULT 'general', -- ui buckets
  xp INTEGER NOT NULL DEFAULT 0,
  link TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- If an old quests table exists, migrate rows into new shape
INSERT INTO quests_new (id, title, description, type, category, xp, link, is_active, created_at)
SELECT
  id,
  COALESCE(title, id),
  COALESCE(description, ''),
  COALESCE(type, 'oneoff'),
  COALESCE(category, 'general'),
  COALESCE(xp, 0),
  link,
  COALESCE(is_active, 1),
  COALESCE(created_at, datetime('now'))
FROM quests
ON CONFLICT(id) DO NOTHING;

DROP TABLE IF EXISTS quests;
ALTER TABLE quests_new RENAME TO quests;

-- user_quests to track completions/proofs and avoid "no such column: quest_id"
CREATE TABLE IF NOT EXISTS user_quests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  quest_id TEXT NOT NULL,
  proof TEXT,
  completed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, quest_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(quest_id) REFERENCES quests(id) ON DELETE CASCADE
);

-- subscriptions table used by /api/subscriptions/status
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
CREATE INDEX IF NOT EXISTS idx_sub_wallet ON subscriptions(wallet);

-- TON invoices table used by /api/v1/payments/ton/*
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

COMMIT;
PRAGMA foreign_keys=on;

-- Seed core quests if they don't exist (idempotent)
INSERT OR IGNORE INTO quests (id, title, description, type, category, xp, link, is_active)
VALUES
  ('daily-checkin','Daily Check-in','Open the app today.','daily','daily',10,NULL,1),
  ('follow-twitter','Follow @7goldencowries','Follow our X account to earn XP.','oneoff','social',50,'https://x.com/7goldencowries',1),
  ('retweet-pin','Retweet the pinned post','Retweet the pinned tweet on X.','oneoff','social',50,'https://x.com/7goldencowries/status/1947595024117502145',1),
  ('invite-a-friend','Invite a Friend','Share your referral link; 1 friend joins.','referral','referral',100,NULL,1);
