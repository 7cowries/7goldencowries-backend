/* Adds quests.url TEXT if missing and backfills from quests.link */
import fs from 'fs';
import path from 'path';
import sqlite3 from 'better-sqlite3';

const DB_PATH =
  process.env.DATABASE_PATH ||
  process.env.DB_PATH ||
  path.resolve(process.cwd(), './data/7gc.sqlite3') ||
  '/var/data/7gc.sqlite3';

const db = sqlite3(DB_PATH);

function hasColumn(table, col) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some(r => r.name === col);
}

try {
  if (!hasColumn('quests', 'url')) {
    console.log('[migrate] Adding quests.url TEXT ...');
    db.prepare(`ALTER TABLE quests ADD COLUMN url TEXT`).run();
  } else {
    console.log('[migrate] quests.url already present');
  }

  // Backfill url from link when url is NULL and link is not NULL
  db.prepare(`UPDATE quests SET url = COALESCE(url, link, '') WHERE url IS NULL`).run();

  console.log('[migrate] migrate-add-quests-url complete');
} catch (e) {
  console.error('[migrate] migrate-add-quests-url failed:', e);
  process.exit(1);
}
