// scripts/backfill-referrals-ids.cjs
// Idempotent: add referee_user_id/referrer_user_id to referrals and backfill from users(wallet)
// Usage: DATABASE_PATH=/var/data/7gc.sqlite3 node scripts/backfill-referrals-ids.cjs

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

(async () => {
  try {
    const DB_PATH = process.env.DATABASE_PATH || process.env.SQLITE_FILE || '/var/data/7gc.sqlite3';
    console.log('[backfill] db path:', DB_PATH);
    if (!fs.existsSync(DB_PATH)) {
      console.error('[backfill] DB file not found:', DB_PATH);
      process.exit(1);
    }

    const db = new sqlite3.Database(DB_PATH);
    const run = (sql, params=[]) => new Promise((res, rej) => db.run(sql, params, function(err){ if (err) rej(err); else res(this); }));
    const all = (sql, params=[]) => new Promise((res, rej) => db.all(sql, params, (err, rows) => { if (err) rej(err); else res(rows); }));

    // ensure referrals table exists
    const tbls = await all("SELECT name FROM sqlite_master WHERE type='table' AND name='referrals'");
    if (!tbls || tbls.length === 0) {
      console.error('[backfill] referrals table not found — aborting');
      db.close();
      process.exit(1);
    }

    // check columns
    const cols = await all("PRAGMA table_info('referrals')");
    const names = cols.map(c => c.name || c[1]);
    const needReferee = !names.includes('referee_user_id');
    const needReferrer = !names.includes('referrer_user_id');

    if (!needReferee && !needReferrer) {
      console.log('[backfill] both id columns already present — nothing to do');
      db.close();
      process.exit(0);
    }

    console.log('[backfill] starting transaction to add missing columns and backfill');

    await run('BEGIN TRANSACTION;');

    if (needReferee) {
      await run("ALTER TABLE referrals ADD COLUMN referee_user_id INTEGER;");
      console.log('[backfill] added referee_user_id');
    }
    if (needReferrer) {
      await run("ALTER TABLE referrals ADD COLUMN referrer_user_id INTEGER;");
      console.log('[backfill] added referrer_user_id');
    }

    // backfill: set referee_user_id = users.id where users.wallet = referrals.referred
    // and similarly set referrer_user_id
    console.log('[backfill] attempting to backfill ids from users table (wallet matching)');

    await run(`
      UPDATE referrals
         SET referee_user_id = (
           SELECT id FROM users WHERE users.wallet = referrals.referred LIMIT 1
         )
       WHERE COALESCE(referee_user_id, '') = '';
    `);

    await run(`
      UPDATE referrals
         SET referrer_user_id = (
           SELECT id FROM users WHERE users.wallet = referrals.referrer LIMIT 1
         )
       WHERE COALESCE(referrer_user_id, '') = '';
    `);

    // create indexes for joins if not exist (SQLite requires conditional logic, we check sqlite_master)
    const idxs = await all("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_referrals_%'");
    const idxNames = idxs.map(r => r.name);
    if (!idxNames.includes('idx_referrals_referee_user_id')) {
      await run('CREATE INDEX idx_referrals_referee_user_id ON referrals(referee_user_id);');
      console.log('[backfill] created index idx_referrals_referee_user_id');
    }
    if (!idxNames.includes('idx_referrals_referrer_user_id')) {
      await run('CREATE INDEX idx_referrals_referrer_user_id ON referrals(referrer_user_id);');
      console.log('[backfill] created index idx_referrals_referrer_user_id');
    }

    await run('COMMIT;');
    console.log('[backfill] migration+backfill completed successfully');
    db.close();
    process.exit(0);
  } catch (err) {
    console.error('[backfill] error:', err && (err.stack || err.message || err));
    try { await new Promise(r => setTimeout(r, 100)); } catch(e){}
    process.exit(1);
  }
})();
