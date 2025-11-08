const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', '7gc.sqlite3');

// make sure data dir exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// helper: does a column exist?
function columnExists(table, col) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some(r => r.name === col);
}

// helper: run many statements
function exec(sql) {
  db.exec(sql);
}

// create tables if not exist (minimal schema for app to boot)
exec(`
CREATE TABLE IF NOT EXISTS quest_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE,
  title TEXT,
  sort_order INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS quests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE,
  title TEXT,
  description TEXT,
  group_id INTEGER REFERENCES quest_groups(id),
  xp INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS quest_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quest_id INTEGER REFERENCES quests(id),
  kind TEXT,                -- e.g., 'twitter_follow','discord_join','telegram_join','visit','custom'
  config_json TEXT,         -- JSON string with provider/config details
  xp INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS token_sale_phases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  starts_at INTEGER,        -- unix seconds
  ends_at INTEGER,          -- unix seconds
  price_usd_cents INTEGER,  -- 0.02 USD => 2
  supply INTEGER,           -- tokens allocated to this phase
  active INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS tiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE,
  title TEXT,
  min_xp INTEGER DEFAULT 0,
  benefits_json TEXT,
  active INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT,
  plan TEXT,                -- e.g., 'starter','pro'
  status TEXT,              -- 'active','canceled','past_due'
  current_period_end INTEGER,
  active INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);
`);

// for safety on existing DBs: add "active" if it doesn't exist
['quest_groups','quests','quest_tasks','token_sale_phases','tiers','subscriptions'].forEach(t => {
  if (!columnExists(t, 'active')) {
    db.exec(`ALTER TABLE ${t} ADD COLUMN active INTEGER DEFAULT 1;`);
    console.log(`+ added active column on ${t}`);
  }
});

// optional: set a user_version for future migrations
db.exec(`PRAGMA user_version = 1;\`);

// users table (wallet + referrer)
exec(`\
CREATE TABLE IF NOT EXISTS users (\
  id INTEGER PRIMARY KEY AUTOINCREMENT,\
  wallet TEXT UNIQUE,\
  referrer TEXT,\
  created_at INTEGER DEFAULT (strftime('%s','now')),\
  updated_at INTEGER DEFAULT (strftime('%s','now'))\
);\
`);

// ensure referrer column exists (for older DBs)
if (!columnExists('users','referrer')) { db.exec('ALTER TABLE users ADD COLUMN referrer TEXT;'); console.log('+ added referrer column on users'); }

console.log(`✓ bootstrap migration complete at ${DB_PATH}`);
