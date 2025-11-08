/* Ensures quests.url exists and backfills from quests.link (idempotent) — CommonJS */
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH =
  process.env.DATABASE_PATH ||
  process.env.DB_PATH ||
  '/var/data/7gc.sqlite3';

const db = new Database(DB_PATH);

function hasColumn(table, col) {
  const rows = db.prepare(`PRAGMA table_info(${table});`).all();
  return rows.some(r => r.name === col);
}

try {
  if (!hasColumn('quests', 'url')) {
    console.log('[migrate] Adding quests.url TEXT ...');
    db.prepare(`ALTER TABLE quests ADD COLUMN url TEXT`).run();
  } else {
    console.log('[migrate] quests.url already present');
  }

  // Backfill: if url is NULL, copy link; if still NULL, set empty string
  db.prepare(`UPDATE quests SET url = COALESCE(url, link, '') WHERE url IS NULL`).run();

  console.log('[migrate] migrate-add-quests-url complete');
  process.exit(0);
} catch (e) {
  console.error('[migrate] migrate-add-quests-url failed:', e);
  process.exit(1);
}
