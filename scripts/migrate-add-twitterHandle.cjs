const Database = require('better-sqlite3');
const DB_PATH = process.env.DATABASE_PATH || "/var/data/7gc.sqlite3";
const db = new Database(DB_PATH);

function columnExists(table, name) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === name);
}

try {
  if (!columnExists('users','twitterHandle')) {
    db.exec(`ALTER TABLE users ADD COLUMN twitterHandle TEXT;`);
    console.log('+ users.twitterHandle added');
  } else {
    console.log('✓ users.twitterHandle already present');
  }

  // Backfill from snake_case to camelCase if empty
  const res = db.prepare(`
    UPDATE users
       SET twitterHandle = twitter_handle
     WHERE (twitterHandle IS NULL OR twitterHandle = '')
       AND twitter_handle IS NOT NULL AND twitter_handle <> ''
  `).run();
  console.log(`✓ backfill twitterHandle from twitter_handle (${res.changes} rows updated)`);

  // (Optional) also backfill the other direction if camelCase exists but snake_case is empty
  const res2 = db.prepare(`
    UPDATE users
       SET twitter_handle = twitterHandle
     WHERE (twitter_handle IS NULL OR twitter_handle = '')
       AND twitterHandle IS NOT NULL AND twitterHandle <> ''
  `).run();
  console.log(`✓ backfill twitter_handle from twitterHandle (${res2.changes} rows updated)`);
} catch (e) {
  console.error('! migrate-add-twitterHandle failed:', e.message);
  process.exit(1);
}
