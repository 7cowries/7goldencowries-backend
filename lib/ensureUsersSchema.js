import db from "../db.js";

export async function getColumns(table) {
  const cols = await db.all(`PRAGMA table_info(${table})`);
  return cols.reduce((m, c) => {
    m[c.name] = true;
    return m;
  }, {});
}

export async function addColumnIfMissing(table, columnDef) {
  const colName = columnDef.trim().split(/\s+/)[0];
  const cols = await getColumns(table);
  if (!cols[colName]) {
    console.log(`Migration: adding ${table}.${colName}`);
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  }
}

export async function backfillUsersDefaults() {
  await db.run(`UPDATE users SET
    xp = COALESCE(xp, 0),
    level = COALESCE(level, 1),
    levelName = COALESCE(levelName, 'Shellborn'),
    levelProgress = COALESCE(levelProgress, 0),
    createdAt = COALESCE(createdAt, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updatedAt = COALESCE(updatedAt, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  `);
}

export async function ensureUsersSchema() {
  const row = await db.get(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
  );
  if (!row) {
    await db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wallet TEXT UNIQUE,
        xp INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        levelName TEXT DEFAULT 'Shellborn',
        levelProgress REAL DEFAULT 0,
        twitter_username TEXT,
        twitter_id TEXT,
        telegram_username TEXT,
        discord_username TEXT,
        discord_id TEXT,
        createdAt TEXT DEFAULT (datetime('now')),
        updatedAt TEXT DEFAULT (datetime('now'))
      );
    `);
    return;
  }

  await addColumnIfMissing('users', 'xp INTEGER');
  await addColumnIfMissing('users', 'level INTEGER');
  await addColumnIfMissing('users', "levelName TEXT");
  await addColumnIfMissing('users', 'levelProgress REAL');
  await addColumnIfMissing('users', 'twitter_username TEXT');
  await addColumnIfMissing('users', 'twitter_id TEXT');
  await addColumnIfMissing('users', 'telegram_username TEXT');
  await addColumnIfMissing('users', 'discord_username TEXT');
  await addColumnIfMissing('users', 'discord_id TEXT');
  await addColumnIfMissing('users', 'createdAt TEXT');
  await addColumnIfMissing('users', 'updatedAt TEXT');
  await backfillUsersDefaults();
}

export default ensureUsersSchema;
