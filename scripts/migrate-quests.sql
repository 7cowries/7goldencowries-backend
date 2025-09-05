PRAGMA foreign_keys=off;
BEGIN TRANSACTION;

-- Ensure a quests table exists with required columns
CREATE TABLE IF NOT EXISTS quests (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  title TEXT,
  xp INTEGER,
  type TEXT,
  active INTEGER DEFAULT 1,
  requiredTier TEXT,
  requiresTwitter INTEGER,
  requirement TEXT,
  target TEXT
);

-- Rebuild to guarantee schema
CREATE TABLE IF NOT EXISTS quests_tmp (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  title TEXT,
  xp INTEGER,
  type TEXT,
  active INTEGER DEFAULT 1,
  requiredTier TEXT,
  requiresTwitter INTEGER,
  requirement TEXT,
  target TEXT
);
INSERT OR IGNORE INTO quests_tmp (id, code, title, xp, type, active, requiredTier, requiresTwitter, requirement, target)
  SELECT id, code, title, xp, type, COALESCE(active,1), requiredTier, requiresTwitter, requirement, target FROM quests;
DROP TABLE quests;
ALTER TABLE quests_tmp RENAME TO quests;

CREATE UNIQUE INDEX IF NOT EXISTS quests_code_unique ON quests(code);

-- Seed/Upsert canonical quests by code
INSERT INTO quests (code, title, xp, type) VALUES
  ('follow_x_7goldencowries','Follow @7goldencowries on X',50,'insider'),
  ('retweet_pinned','Retweet the pinned post',80,'partner'),
  ('quote_pinned','Quote the pinned post',100,'partner'),
  ('join_telegram','Join our Telegram',40,'daily'),
  ('onchain_first','First on-chain action',120,'onchain')
ON CONFLICT(code) DO UPDATE SET
  title=excluded.title, xp=excluded.xp, type=excluded.type;

COMMIT;
PRAGMA foreign_keys=on;
