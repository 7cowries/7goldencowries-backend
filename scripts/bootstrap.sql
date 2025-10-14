PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT UNIQUE NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  subscriptionTier TEXT NOT NULL DEFAULT 'Tier 1',
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quests_v2(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  type TEXT NOT NULL,
  requirement TEXT NOT NULL DEFAULT 'none',
  url TEXT NOT NULL DEFAULT '',
  xp INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  isDaily INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_quests_v2(
  userId INTEGER NOT NULL,
  questId INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  claimedAt TEXT,
  PRIMARY KEY(userId, questId)
);

CREATE TABLE IF NOT EXISTS subscriptions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL UNIQUE,
  tier TEXT NOT NULL,
  txHash TEXT,
  tonPaid REAL,
  usdPaid REAL,
  active INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_quests_v2_user ON user_quests_v2(userId);
CREATE INDEX IF NOT EXISTS idx_user_quests_v2_quest ON user_quests_v2(questId);
CREATE INDEX IF NOT EXISTS idx_quests_v2_active ON quests_v2(active);

INSERT OR IGNORE INTO quests_v2 (key,title,category,type,requirement,url,xp,active,isDaily) VALUES
('daily_checkin','Daily Check-in','Daily','daily','none','',500,1,1),
('follow_x','Follow @7goldencowries on X','Social','link','none','',1500,1,0),
('retweet_pinned','Retweet the pinned post','Social','link','none','',2000,1,0),
('quote_pinned','Quote the pinned post','Social','link','none','',2500,1,0),
('join_telegram','Join our Telegram','Partner','link','none','',1000,1,0),
('join_discord','Join our Discord','Partner','link','none','',1200,1,0),
('read_guide','Read the newcomer guide','Insider','link','none','',800,1,0),
('first_tx','First on-chain action','Onchain','link','none','',3000,1,0),
('probe_1000','Probe Quest (internal)','Insider','link','none','',1000,0,0);
