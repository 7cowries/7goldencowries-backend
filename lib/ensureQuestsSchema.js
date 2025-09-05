import db from "../db.js";

/** Adds a column if it's missing. */
async function addColumnIfMissing(table, name, defSql) {
  const cols = await db.all(`PRAGMA table_info(${table})`);
  const has = cols.some((c) => c.name === name);
  if (!has) {
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${defSql}`);
  }
}

export async function ensureQuestsSchema() {
  // Make sure table exists
  await db.run(`
    CREATE TABLE IF NOT EXISTS quests (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      category TEXT DEFAULT 'All',
      kind TEXT DEFAULT 'link',
      url TEXT DEFAULT '',
      xp INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      sort INTEGER DEFAULT 0,
      createdAt INTEGER DEFAULT (strftime('%s','now')),
      updatedAt INTEGER DEFAULT (strftime('%s','now'))
    );
  `);

  // Backfill columns if this DB had an older schema
  await addColumnIfMissing("quests", "description", `TEXT DEFAULT ''`);
  await addColumnIfMissing("quests", "category", `TEXT DEFAULT 'All'`);
  await addColumnIfMissing("quests", "kind", `TEXT DEFAULT 'link'`);
  await addColumnIfMissing("quests", "url", `TEXT DEFAULT ''`);
  await addColumnIfMissing("quests", "xp", `INTEGER DEFAULT 0`);
  await addColumnIfMissing("quests", "active", `INTEGER DEFAULT 1`);
  await addColumnIfMissing("quests", "sort", `INTEGER DEFAULT 0`);
  await addColumnIfMissing("quests", "createdAt", `INTEGER DEFAULT (strftime('%s','now'))`);
  await addColumnIfMissing("quests", "updatedAt", `INTEGER DEFAULT (strftime('%s','now'))`);
}

