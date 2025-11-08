/**
 * Guarantee quests table exists and ensure an "active" column (idempotent).
 */
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', '7gc.sqlite3');
const db = new Database(dbPath);

// create a minimal quests table if missing (full schema will be created by bootstrap)
db.exec(`
  CREATE TABLE IF NOT EXISTS quests (
    id INTEGER PRIMARY KEY,
    slug TEXT UNIQUE,
    title TEXT,
    description TEXT
  );
`);

const cols = db.prepare(`PRAGMA table_info('quests')`).all();
const hasActive = cols.some(c => c.name === 'active');

if (!hasActive) {
  db.exec(`ALTER TABLE quests ADD COLUMN active INTEGER DEFAULT 1`);
  console.log('+ added active column on quests');
} else {
  console.log('✓ active column already present on quests');
}

db.close();
