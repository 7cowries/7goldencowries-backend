const Database = require('better-sqlite3');

const DB_PATH = process.env.DATABASE_PATH || '/var/data/7gc.sqlite3';
const db = new Database(DB_PATH);

function colnames(rows) { return rows.map(r => r.name).join(', '); }

const userVersion = db.pragma('user_version', { simple: true });
const usersInfo   = db.prepare('PRAGMA table_info(users)').all();
const hasReferrer = usersInfo.some(c => c.name === 'referrer');

console.log('[db] Using DB_PATH:', DB_PATH);
console.log('[db] PRAGMA user_version =', userVersion);
console.log('[db] users columns =', colnames(usersInfo));
console.log('[db] users has referrer =', hasReferrer);

// Also dump table DDL lines to confirm what SQLite thinks exists
const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all();
for (const t of tables) {
  console.log(`[db] DDL ${t.name}:`, t.sql);
}
