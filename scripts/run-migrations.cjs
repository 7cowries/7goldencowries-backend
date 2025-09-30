// scripts/run-migrations.js
// Idempotent migration runner for SQLite: add 'code' column to referrals if missing.
// Uses env DATABASE_PATH (default ./data/database.sqlite).
// Safe to call repeatedly; logs actions.

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

(async function main() {
  try {
    const DB_PATH = process.env.DATABASE_PATH || process.env.DB_PATH || path.resolve(process.cwd(), './data/database.sqlite');
    console.log('[migrations] using DB path:', DB_PATH);

    if (!fs.existsSync(DB_PATH)) {
      console.warn('[migrations] database file not found at', DB_PATH, '— skipping migrations (this may be expected in some envs)');
      return;
    }

    // create a timestamped backup in same directory if possible
    try {
      const bakPath = DB_PATH + '.bak.' + Date.now();
      fs.copyFileSync(DB_PATH, bakPath);
      console.log('[migrations] backup created at', bakPath);
    } catch (bkErr) {
      console.warn('[migrations] backup failed (non-fatal):', bkErr && bkErr.message);
    }

    const db = new sqlite3.Database(DB_PATH);

    // helper to run SQL as promise
    const run = (sql) => new Promise((res, rej) => db.run(sql, function(err) { if (err) rej(err); else res(this); }));
    const all = (sql) => new Promise((res, rej) => db.all(sql, (err, rows) => { if (err) rej(err); else res(rows); }));

    // check if referrals table exists
    const tbl = await all("SELECT name FROM sqlite_master WHERE type='table' AND name='referrals';");
    if (!tbl || tbl.length === 0) {
      console.warn("[migrations] table 'referrals' not found — skipping referrals migration");
      db.close();
      return;
    }

    // check columns
    const cols = await all("PRAGMA table_info('referrals');");
    // unify col name access for different sqlite3 versions
    const hasCode = cols.some(c => (c.name && c.name === 'code') || (c[1] && c[1] === 'code') );
    if (hasCode) {
      console.log("[migrations] column 'code' already exists — nothing to do");
      db.close();
      return;
    }

    console.log("[migrations] adding column 'code' to referrals (TEXT NULL allowed)");
    // perform alter within transaction
    try {
      await run("BEGIN TRANSACTION;");
      await run("ALTER TABLE referrals ADD COLUMN code TEXT;");
      await run("COMMIT;");
      console.log("[migrations] ALTER TABLE successful — 'code' column added");
    } catch (alterErr) {
      console.error("[migrations] ALTER TABLE failed:", alterErr && alterErr.message ? alterErr.message : alterErr);
      try { await run("ROLLBACK;"); } catch(e) { /* ignore */ }
    }

    db.close();
  } catch (err) {
    console.error('[migrations] migration failed:', err && err.message ? err.message : err);
    // do not crash the process; migrations should be best-effort
    try { process.exitCode = 0; } catch(e) { /* ignore */ }
  }
})();
