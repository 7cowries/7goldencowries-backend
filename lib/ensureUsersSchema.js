import db from "../db.js";

export async function getColumns(table) {
  const rows = await db.all(`PRAGMA table_info(${table})`);
  return new Set(rows.map((r) => r.name));
}

export async function addColumnIfMissing(table, colName, colSql) {
  const cols = await getColumns(table);
  if (!cols.has(colName)) {
    console.log(`Migration: added ${table}.${colName}`);
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${colSql};`);
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
  console.log("Migration: ensuring users schema");
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

  await addColumnIfMissing('users', 'xp', 'xp INTEGER');
  await addColumnIfMissing('users', 'level', 'level INTEGER');
  await addColumnIfMissing('users', 'levelName', 'levelName TEXT');
  await addColumnIfMissing('users', 'levelProgress', 'levelProgress REAL');
  await addColumnIfMissing('users', 'twitter_username', 'twitter_username TEXT');
  await addColumnIfMissing('users', 'twitter_id', 'twitter_id TEXT');
  await addColumnIfMissing('users', 'telegram_username', 'telegram_username TEXT');
  await addColumnIfMissing('users', 'discord_username', 'discord_username TEXT');
  await addColumnIfMissing('users', 'discord_id', 'discord_id TEXT');
  await addColumnIfMissing('users', 'createdAt', 'createdAt TEXT');
  await addColumnIfMissing('users', 'updatedAt', 'updatedAt TEXT');
  await backfillUsersDefaults();
}

export default ensureUsersSchema;
