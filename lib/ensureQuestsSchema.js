import db from "../db.js";

async function hasColumn(table, name) {
  const cols = await db.all(`PRAGMA table_info(${table})`);
  return cols.some(c => c.name === name);
}

async function addColumnIfMissing(table, name, typeAndDefaultSql) {
  if (!(await hasColumn(table, name))) {
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${typeAndDefaultSql}`);
  }
}

export async function ensureQuestsSchema() {
  // 1) Ensure table exists with only constant defaults (SQLite restriction)
  await db.run(`
    CREATE TABLE IF NOT EXISTS quests (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      description TEXT DEFAULT '',
      category    TEXT DEFAULT 'All',
      kind        TEXT DEFAULT 'link',
      url         TEXT DEFAULT '',
      xp          INTEGER DEFAULT 0,
      active      INTEGER DEFAULT 1,
      sort        INTEGER DEFAULT 0,
      createdAt   INTEGER,
      updatedAt   INTEGER
    );
  `);

  // 2) Columns that might be missing on older DBs (ONLY constant defaults here)
  await addColumnIfMissing("quests", "description", `TEXT DEFAULT ''`);
  await addColumnIfMissing("quests", "category", `TEXT DEFAULT 'All'`);
  await addColumnIfMissing("quests", "kind", `TEXT DEFAULT 'link'`);
  await addColumnIfMissing("quests", "url", `TEXT DEFAULT ''`);
  await addColumnIfMissing("quests", "xp", `INTEGER DEFAULT 0`);
  await addColumnIfMissing("quests", "active", `INTEGER DEFAULT 1`);
  await addColumnIfMissing("quests", "sort", `INTEGER DEFAULT 0`);
  await addColumnIfMissing("quests", "createdAt", `INTEGER`);
  await addColumnIfMissing("quests", "updatedAt", `INTEGER`);

  // 3) Backfill timestamps in a separate step (expressions are OK in UPDATE)
  await db.run(`UPDATE quests SET createdAt = COALESCE(createdAt, strftime('%s','now'))`);
  await db.run(`UPDATE quests SET updatedAt = COALESCE(updatedAt, createdAt)`);
}

