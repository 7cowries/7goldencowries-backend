const Database = require('better-sqlite3');
const DB_PATH = process.env.DATABASE_PATH || '/var/data/7gc.sqlite3';
const db = new Database(DB_PATH);

const cols = db.prepare('PRAGMA table_info(users)').all();
const hasRef = cols.some(c => c.name === 'referrer');
if (!hasRef) {
  db.exec('ALTER TABLE users ADD COLUMN referrer TEXT;');
  console.log('+ added missing referrer column on users');
} else {
  console.log('✓ users.referrer already present');
}
