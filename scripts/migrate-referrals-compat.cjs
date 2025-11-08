const Database = require('better-sqlite3');

const DB_PATH = process.env.DATABASE_PATH || "/var/data/7gc.sqlite3";
const db = new Database(DB_PATH);

function tableInfo(name) {
  return db.prepare(`PRAGMA table_info(${name})`).all();
}
function hasCol(cols, name) {
  return cols.some(c => c.name === name);
}

try {
  const cols = tableInfo('referrals');
  if (!cols.length) {
    console.log('! referrals: table missing (skipping compat migration)');
    process.exit(0);
  }

  const hasOwner   = hasCol(cols, 'owner_wallet');
  const hasInvited = hasCol(cols, 'invited_wallet');
  const hasReferrer  = hasCol(cols, 'referrer');
  const hasReferred  = hasCol(cols, 'referred');

  // if the DB uses owner_wallet/invited_wallet but lacks referrer/referred, add & backfill
  if (hasOwner && !hasReferrer) {
    db.exec(`ALTER TABLE referrals ADD COLUMN referrer TEXT;`);
    db.exec(`UPDATE referrals SET referrer = owner_wallet WHERE referrer IS NULL OR referrer = ''`);
    console.log('+ referrals.referrer added & backfilled from owner_wallet');
  } else {
    console.log('✓ referrals.referrer already present (or no owner_wallet)');
  }

  if (hasInvited && !hasReferred) {
    db.exec(`ALTER TABLE referrals ADD COLUMN referred TEXT;`);
    db.exec(`UPDATE referrals SET referred = invited_wallet WHERE referred IS NULL OR referred = ''`);
    console.log('+ referrals.referred added & backfilled from invited_wallet');
  } else {
    console.log('✓ referrals.referred already present (or no invited_wallet)');
  }
} catch (e) {
  console.error('! compat migration failed:', e.message);
  process.exit(1);
}
