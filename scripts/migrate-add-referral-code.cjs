const Database = require('better-sqlite3');

const DB_PATH = process.env.DATABASE_PATH || "/var/data/7gc.sqlite3";
const db = new Database(DB_PATH);

function columnExists(table, col) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some(r => r.name === col);
}

function genCode(seed) {
  // stable-ish short code: base36 of a hash-like number from seed + random salt
  const n = Math.abs([...seed].reduce((a,c)=>((a<<5)-a)+c.charCodeAt(0)|0, 0)) + Math.floor(Math.random()*1e9);
  return n.toString(36).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
}

try {
  // add column if missing
  if (!columnExists('users','referral_code')) {
    db.exec(`ALTER TABLE users ADD COLUMN referral_code TEXT;`);
    console.log('+ users.referral_code added');
  } else {
    console.log('✓ users.referral_code already present');
  }

  // enforce uniqueness with an index (safe if column is null for some rows)
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);`);
  console.log('✓ unique index on users.referral_code ensured');

  // backfill empty codes
  const selectEmpty = db.prepare(`SELECT id, wallet FROM users WHERE referral_code IS NULL OR referral_code = ''`);
  const getByCode   = db.prepare(`SELECT id FROM users WHERE referral_code = ?`);
  const setCode     = db.prepare(`UPDATE users SET referral_code = ? WHERE id = ?`);

  const tx = db.transaction(() => {
    const rows = selectEmpty.all();
    for (const r of rows) {
      let code, attempts = 0;
      do {
        code = genCode(r.wallet || String(r.id));
        attempts++;
        if (attempts > 20) throw new Error('could not generate unique referral_code');
      } while (getByCode.get(code));
      setCode.run(code, r.id);
    }
  });
  tx();

  console.log('✓ referral_code backfill complete');
} catch (e) {
  console.error('! migrate-add-referral-code failed:', e.message);
  process.exit(1);
}
