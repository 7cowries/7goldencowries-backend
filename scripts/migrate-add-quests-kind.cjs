/**
 * Adds quests.kind (TEXT) if missing and backfills from quests.type.
 * Safe to run repeatedly (idempotent).
 */
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || process.env.DB_FILE || '/var/data/7gc.sqlite3';

function columnExists(db, table, col) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some(r => r.name === col);
}

(function main() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  console.log(`[migrate] DB_PATH = ${DB_PATH}`);

  const hasKind = columnExists(db, 'quests', 'kind');

  db.transaction(() => {
    if (!hasKind) {
      console.log('[migrate] Adding quests.kind TEXT ...');
      db.prepare(`ALTER TABLE quests ADD COLUMN kind TEXT`).run();
      console.log('[migrate] Backfilling quests.kind from quests.type (if present) ...');
      try {
        db.prepare(`UPDATE quests SET kind = type WHERE kind IS NULL AND type IS NOT NULL`).run();
      } catch (e) {
        // If quests.type doesn't exist, ignore; column still added and nullable.
        console.log('[migrate] quests.type not found during backfill (ok).');
      }
    } else {
      console.log('[migrate] quests.kind already present');
    }
  })();

  console.log('[migrate] migrate-add-quests-kind complete');
})();
