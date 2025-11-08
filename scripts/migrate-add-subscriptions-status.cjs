const Database = require('better-sqlite3');
const DB_PATH = process.env.DATABASE_PATH || "/var/data/7gc.sqlite3";
const db = new Database(DB_PATH);

function columnExists(table, name) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === name);
}

try {
  if (!columnExists('subscriptions','status')) {
    db.exec(`ALTER TABLE subscriptions ADD COLUMN status TEXT DEFAULT 'pending';`);
    console.log('Migration: added subscriptions.status');
  } else {
    console.log('✓ subscriptions.status already present');
  }

  // Backfill null/empty to a safe value
  const r = db.prepare(`
    UPDATE subscriptions
       SET status = 'pending'
     WHERE status IS NULL OR status = ''
  `).run();
  console.log(`✓ subscriptions.status backfill -> 'pending' (${r.changes} rows updated)`);
} catch (e) {
  console.error('! migrate-add-subscriptions-status failed:', e.message);
  process.exit(1);
}
