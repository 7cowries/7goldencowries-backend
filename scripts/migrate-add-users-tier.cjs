const Database = require('better-sqlite3');
const DB_PATH = process.env.DATABASE_PATH || "/var/data/7gc.sqlite3";
const db = new Database(DB_PATH);

function columnExists(table, name) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === name);
}

try {
  // Add column with DEFAULT so SQLite accepts it; omit NOT NULL to avoid table rebuilds.
  if (!columnExists('users','tier')) {
    db.exec(`ALTER TABLE users ADD COLUMN tier TEXT DEFAULT 'Free';`);
    console.log('Migration: added users.tier');
  } else {
    console.log('✓ users.tier already present');
  }

  // Backfill existing NULL/empty to the default
  const r = db.prepare(`
    UPDATE users
       SET tier = 'Free'
     WHERE tier IS NULL OR tier = ''
  `).run();
  console.log(`✓ users.tier backfill -> 'Free' (${r.changes} rows updated)`);
} catch (e) {
  console.error('! migrate-add-users-tier failed:', e.message);
  process.exit(1);
}
