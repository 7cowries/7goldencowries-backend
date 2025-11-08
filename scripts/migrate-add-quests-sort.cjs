/* Ensures quests.sort exists and is an INTEGER with default 0 (idempotent). */
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
  if (!hasColumn('quests', 'sort')) {
    console.log('[migrate] Adding quests.sort INTEGER DEFAULT 0 ...');
    db.prepare(`ALTER TABLE quests ADD COLUMN sort INTEGER DEFAULT 0`).run();
  } else {
    console.log('[migrate] quests.sort already present');
  }

  // Backfill any NULLs (older rows created before DEFAULT applied)
  db.prepare(`UPDATE quests SET sort = COALESCE(sort, 0)`).run();

  console.log('[migrate] migrate-add-quests-sort complete');
  process.exit(0);
} catch (e) {
  console.error('[migrate] migrate-add-quests-sort failed:', e);
  process.exit(1);
}
