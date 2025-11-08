const Database = require('better-sqlite3');
const DB_PATH = process.env.DATABASE_PATH || "/var/data/7gc.sqlite3";
const db = new Database(DB_PATH);

function columnExists(table, name) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === name);
}

try {
  if (!columnExists('users','levelName')) {
    db.exec(`ALTER TABLE users ADD COLUMN levelName TEXT;`);
    console.log('+ users.levelName added');
  } else {
    console.log('✓ users.levelName already present');
  }

  // Backfill camelCase from snake_case
  const r1 = db.prepare(`
    UPDATE users
       SET levelName = level_name
     WHERE (levelName IS NULL OR levelName = '')
       AND level_name IS NOT NULL AND level_name <> ''
  `).run();
  console.log(`✓ backfill levelName from level_name (${r1.changes} rows updated)`);

  // Optional: backfill snake_case from camelCase if empty
  const r2 = db.prepare(`
    UPDATE users
       SET level_name = levelName
     WHERE (level_name IS NULL OR level_name = '')
       AND levelName IS NOT NULL AND levelName <> ''
  `).run();
  console.log(`✓ backfill level_name from levelName (${r2.changes} rows updated)`);
} catch (e) {
  console.error('! migrate-add-levelName failed:', e.message);
  process.exit(1);
}
