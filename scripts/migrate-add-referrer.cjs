/**
 * Add users.referrer column if missing (idempotent).
 */
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', '7gc.sqlite3');
const db = new Database(dbPath);

// ensure users table exists (minimal schema in case fresh DB)
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    wallet TEXT UNIQUE,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

const cols = db.prepare(`PRAGMA table_info('users')`).all();
const hasRef = cols.some(c => c.name === 'referrer');

if (!hasRef) {
  db.exec(`ALTER TABLE users ADD COLUMN referrer TEXT`);
  console.log('+ added referrer column on users');
} else {
  console.log('✓ referrer column already present on users');
}

db.close();
