/**
 * Ensures quests.createdAt and quests.updatedAt (camelCase, INTEGER unix seconds) exist.
 * Backfills from legacy created_at/updated_at (TEXT), else from now.
 */
const Database = require('better-sqlite3');

const DB_PATH =
  process.env.DATABASE_PATH ||
  process.env.DB_PATH ||
  '/var/data/7gc.sqlite3';

const db = new Database(DB_PATH);

function hasColumn(table, col) {
  return db.prepare(`PRAGMA table_info(${table});`).all().some(r => r.name === col);
}
function tableHasColumn(table, col) {
  return hasColumn(table, col);
}

try {
  db.pragma('foreign_keys = OFF');

  // Add columns if missing
  if (!hasColumn('quests','createdAt')) {
    console.log('[migrate] Adding quests.createdAt INTEGER ...');
    db.prepare(`ALTER TABLE quests ADD COLUMN createdAt INTEGER`).run();
  } else {
    console.log('[migrate] quests.createdAt already present');
  }

  if (!hasColumn('quests','updatedAt')) {
    console.log('[migrate] Adding quests.updatedAt INTEGER ...');
    db.prepare(`ALTER TABLE quests ADD COLUMN updatedAt INTEGER`).run();
  } else {
    console.log('[migrate] quests.updatedAt already present');
  }

  // Backfill from legacy snake_case if present, else now()
  const nowSec = Math.floor(Date.now()/1000);

  const has_created_at = tableHasColumn('quests','created_at');
  const has_updated_at = tableHasColumn('quests','updated_at');

  if (has_created_at) {
    // convert legacy TEXT to unix seconds where possible
    db.prepare(`
      UPDATE quests
         SET createdAt = COALESCE(
               createdAt,
               NULLIF(CAST(strftime('%s', created_at) AS INTEGER), 0),
               ?
             )
    `).run(nowSec);
  } else {
    db.prepare(`UPDATE quests SET createdAt = COALESCE(createdAt, ?)`).run(nowSec);
  }

  if (has_updated_at) {
    db.prepare(`
      UPDATE quests
         SET updatedAt = COALESCE(
               updatedAt,
               NULLIF(CAST(strftime('%s', updated_at) AS INTEGER), 0),
               createdAt,
               ?
             )
    `).run(nowSec);
  } else {
    db.prepare(`UPDATE quests SET updatedAt = COALESCE(updatedAt, createdAt, ?)`).run(nowSec);
  }

  console.log('[migrate] migrate-add-quests-updatedAt complete');
  process.exit(0);
} catch (e) {
  console.error('[migrate] migrate-add-quests-updatedAt failed:', e);
  process.exit(1);
}
