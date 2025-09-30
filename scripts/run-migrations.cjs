// scripts/run-migrations.cjs
// Idempotent migration runner for SQLite that searches multiple candidate paths.
// It will act on the first DB file it finds. Logs every step so Render logs show what's happening.

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

(async function main() {
  try {
    // candidates in order (can be extended)
    const repoRoot = path.resolve(process.cwd());
    const candidates = [];

    // allow explicit override
    if (process.env.DATABASE_PATH) candidates.push(process.env.DATABASE_PATH);

    // common repo/data locations
    candidates.push(path.join(repoRoot, 'data', 'database.sqlite'));
    candidates.push(path.join(repoRoot, 'data', 'dev.sqlite'));
    candidates.push(path.join(repoRoot, 'data', 'db.sqlite'));
    candidates.push(path.join(repoRoot, 'data', 'production.sqlite'));

    // Render persistent disk typical mount
    candidates.push('/var/data/database.sqlite');
    candidates.push('/var/data/dev.sqlite');
    candidates.push('/var/data/data.sqlite');

    // fallback: any .sqlite file under ./data
    try {
      const files = fs.readdirSync(path.join(repoRoot, 'data')).filter(f => f.endsWith('.sqlite') || f.endsWith('.db') || f.endsWith('.sqlite3'));
      files.forEach(f => candidates.push(path.join(repoRoot, 'data', f)));
    } catch (e) {
      // ignore if ./data doesn't exist
    }

    console.log('[migrations] candidate DB paths to check:', JSON.stringify(candidates, null, 2));

    // find first existing candidate
    let DB_PATH = null;
    for (const c of candidates) {
      if (!c) continue;
      try {
        if (fs.existsSync(c)) {
          DB_PATH = c;
          break;
        }
      } catch (e) { /* ignore */ }
    }

    if (!DB_PATH) {
      console.warn('[migrations] no candidate DB file found — listing ./data (if present):');
      try {
        const list = fs.readdirSync(path.join(repoRoot, 'data')).map(f => path.join(repoRoot, 'data', f));
        console.warn('[migrations] ./data contents:', JSON.stringify(list, null, 2));
      } catch(e) {
        console.warn('[migrations] ./data not present or unreadable:', e && e.message);
      }
      console.warn('[migrations] skipping migrations (no DB located)');
      return;
    }

    console.log('[migrations] selected DB path:', DB_PATH);

    // backup DB (safe local copy)
    try {
      const bakPath = DB_PATH + '.bak.' + Date.now();
      fs.copyFileSync(DB_PATH, bakPath);
      console.log('[migrations] backup created at', bakPath);
    } catch (bkErr) {
      console.warn('[migrations] backup failed (non-fatal):', bkErr && bkErr.message);
    }

    const db = new sqlite3.Database(DB_PATH);
    const run = (sql) => new Promise((res, rej) => db.run(sql, function(err) { if (err) rej(err); else res(this); }));
    const all = (sql) => new Promise((res, rej) => db.all(sql, (err, rows) => { if (err) rej(err); else res(rows); }));

    const tbl = await all("SELECT name FROM sqlite_master WHERE type='table' AND name='referrals';");
    if (!tbl || tbl.length === 0) {
      console.warn("[migrations] table 'referrals' not found in " + DB_PATH + " — skipping referrals migration");
      db.close();
      return;
    }

    const cols = await all("PRAGMA table_info('referrals');");
    const hasCode = cols.some(c => (c.name && c.name === 'code') || (c[1] && c[1] === 'code'));
    if (hasCode) {
      console.log("[migrations] column 'code' already exists in referrals — nothing to do");
      db.close();
      return;
    }

    console.log("[migrations] adding column 'code' to referrals (TEXT NULL allowed)");
    try {
      await run("BEGIN TRANSACTION;");
      await run("ALTER TABLE referrals ADD COLUMN code TEXT;");
      await run("COMMIT;");
      console.log("[migrations] ALTER TABLE successful — 'code' column added in " + DB_PATH);
    } catch (alterErr) {
      console.error("[migrations] ALTER TABLE failed:", alterErr && alterErr.message ? alterErr.message : alterErr);
      try { await run("ROLLBACK;"); } catch(e) { /* ignore */ }
    }

    db.close();
  } catch (err) {
    console.error('[migrations] migration failed:', err && err.message ? err.message : err);
    try { process.exitCode = 0; } catch(e) { /* ignore */ }
  }
})();
