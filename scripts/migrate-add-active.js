const Database = require('better-sqlite3');
const path = require('path');

// use same DB path as the app
const dbPath = path.join(__dirname, '..', 'data', '7gc.sqlite3');
const db = new Database(dbPath);

function ensureActive(table) {
  const cols = db.prepare(`PRAGMA table_info(${table});`).all();
  const has = cols.some(c => c.name === 'active');
  if (!has) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN active INTEGER NOT NULL DEFAULT 1;`).run();
    console.log(`+ added active to ${table}`);
  } else {
    console.log(`= ${table}.active already exists`);
  }
}

// Tables that commonly reference `active`
[
  'quests',
  'quest_tasks',
  'quest_groups',
  'token_sale_phases',
  'tiers',
  'subscriptions'
].forEach(t => {
  try { ensureActive(t); } catch (e) { console.error(`! ${t}: ${e.message}`); }
});

db.close();
