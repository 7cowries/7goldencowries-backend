import db from '../db.js';

// runSqliteMigrations ensures the proofs table exists and has all required columns.
export async function runSqliteMigrations() {
  await db.exec(`CREATE TABLE IF NOT EXISTS proofs(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet TEXT NOT NULL,
    quest_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL,
    reason TEXT,
    tweet_id TEXT,
    handle TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')),
    UNIQUE(wallet, quest_id)
  );`);
  // add missing columns without volatile defaults
  const cols = await db.all(`PRAGMA table_info(proofs);`);
  const names = new Set(cols.map(c => c.name));
  const ensure = async (name, def) => {
    if (!names.has(name)) {
      const type = String(def).replace(/DEFAULT.+$/i, '').trim();
      await db.exec(`ALTER TABLE proofs ADD COLUMN ${name} ${type};`);
    }
  };
  await ensure('status', "TEXT NOT NULL DEFAULT 'pending'");
  await ensure('reason', 'TEXT');
  await ensure('tweet_id', 'TEXT');
  await ensure('handle', 'TEXT');
  await ensure('createdAt', 'TEXT');
  await ensure('updatedAt', 'TEXT');

  await db.exec(`CREATE INDEX IF NOT EXISTS idx_proofs_status ON proofs(status);`);
}

export default runSqliteMigrations;
