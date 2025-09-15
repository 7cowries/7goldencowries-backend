import db from "../lib/db.js";

async function hasColumn(table, name) {
  const cols = await db.all(`PRAGMA table_info(${table})`);
  return cols.some(c => c.name === name);
}

async function addColumnIfMissing(table, name, type) {
  const cols = await db.all(`PRAGMA table_info(${table})`);
  if (!cols.some(c => c.name === name)) {
    let t = String(type || "");
    if (t.toUpperCase().startsWith(name.toUpperCase())) t = t.slice(name.length).trim();
    t = t.replace(/DEFAULT.+$/i, "").trim();
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${t}`);
  }
}

export async function ensureQuestsSchema() {
  // 1) Ensure table exists with only constant defaults (SQLite restriction)
  await db.run(`
    CREATE TABLE IF NOT EXISTS quests (
      id         TEXT PRIMARY KEY,
      code       TEXT UNIQUE,
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
  await addColumnIfMissing("quests", "description", `TEXT`);
  await addColumnIfMissing("quests", "category", `TEXT`);
  await addColumnIfMissing("quests", "kind", `TEXT`);
  await addColumnIfMissing("quests", "url", `TEXT`);
  await addColumnIfMissing("quests", "xp", `INTEGER`);
  await addColumnIfMissing("quests", "active", `INTEGER`);
  await addColumnIfMissing("quests", "sort", `INTEGER`);
  await addColumnIfMissing("quests", "createdAt", `INTEGER`);
  await addColumnIfMissing("quests", "updatedAt", `INTEGER`);
  await addColumnIfMissing("quests", "code", `TEXT`);
  await addColumnIfMissing("quests", "requirement", `TEXT`);
  await db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_quests_code ON quests(code)");

  // 3) Backfill timestamps in a separate step (expressions are OK in UPDATE)
  await db.run(`UPDATE quests SET createdAt = COALESCE(createdAt, strftime('%s','now'))`);
  await db.run(`UPDATE quests SET updatedAt = COALESCE(updatedAt, createdAt)`);
  await db.run(`
    UPDATE quests SET description = COALESCE(description, '');
    UPDATE quests SET category    = COALESCE(category, 'All');
    UPDATE quests SET kind        = COALESCE(kind, 'link');
    UPDATE quests SET url         = COALESCE(url, '');
    UPDATE quests SET xp          = COALESCE(xp, 0);
    UPDATE quests SET active      = COALESCE(active, 1);
    UPDATE quests SET sort        = COALESCE(sort, 0);
    UPDATE quests SET requirement = COALESCE(requirement, 'none');
  `);
}

