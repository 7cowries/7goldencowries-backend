import db from '../db.js';

// runSqliteMigrations ensures proof-related tables exist and are up to date.
export async function runSqliteMigrations() {
  // legacy proofs table (kept for backward compatibility)
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

  // new quest_proofs table
  await db.exec(`CREATE TABLE IF NOT EXISTS quest_proofs(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quest_id INT NOT NULL,
    wallet TEXT NOT NULL,
    vendor TEXT,
    url TEXT,
    status TEXT DEFAULT 'pending',
    tweet_id TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );`);
  const qcols = await db.all(`PRAGMA table_info(quest_proofs);`);
  const qnames = new Set(qcols.map(c => c.name));
  const qensure = async (name, def) => {
    if (!qnames.has(name)) {
      await db.exec(`ALTER TABLE quest_proofs ADD COLUMN ${name} ${def}`);
    }
  };
  await qensure('vendor', 'TEXT');
  await qensure('url', 'TEXT');
  await qensure('status', "TEXT DEFAULT 'pending'");
  await qensure('tweet_id', 'TEXT');
  await qensure('createdAt', 'TEXT');
  await qensure('updatedAt', 'TEXT');

  // completed_quests extra columns
  const ccols = await db.all(`PRAGMA table_info(completed_quests);`);
  const cnames = new Set(ccols.map(c => c.name));
  if (!cnames.has('quest_id')) {
    await db.exec(`ALTER TABLE completed_quests ADD COLUMN quest_id INT;`);
  }
  if (!cnames.has('timestamp')) {
    await db.exec(`ALTER TABLE completed_quests ADD COLUMN timestamp TEXT DEFAULT (datetime('now'));`);
  }
  await db.exec(`UPDATE completed_quests SET timestamp = COALESCE(timestamp, datetime('now'))`);
}

export default runSqliteMigrations;
