import { Router } from 'express';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const router = Router();
async function getDb() {
  return open({
    filename: process.env.DATABASE_URL || './data.db',
    driver: sqlite3.Database,
  });
}

let didInit = false;
async function ensureSchema(db) {
  if (didInit) return;
  await db.exec(`
    PRAGMA journal_mode=WAL;

    CREATE TABLE IF NOT EXISTS leaderboard_scores(
      address TEXT PRIMARY KEY,
      score   INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_leaderboard_score
      ON leaderboard_scores(score DESC, address ASC);
  `);
  didInit = true;
}

router.get('/', async (req, res) => {
  const limit  = Math.max(1, Math.min(100, parseInt(req.query.limit  ?? '50', 10)));
  const offset = Math.max(0,                  parseInt(req.query.offset ?? '0', 10));
  try {
    const db = await getDb();
    await ensureSchema(db);

    const { c: total } = await db.get(`SELECT COUNT(*) AS c FROM leaderboard_scores;`);

    const rows = await db.all(
      `
      SELECT
        address,
        score,
        RANK() OVER (ORDER BY score DESC, address ASC) AS rank
      FROM leaderboard_scores
      ORDER BY score DESC, address ASC
      LIMIT ? OFFSET ?;
      `,
      limit, offset
    );

    res.json({ ok:true, total, results:rows, rows, items:rows, leaderboard:rows });
  } catch (e) {
    console.error('leaderboard error:', e);
    res.status(500).json({ ok:false, error:'internal_error' });
  }
});

router.post('/award', async (req, res) => {
  try {
    const { address, delta } = req.body || {};
    const addr = String(address || '').trim();
    const inc  = Number.isFinite(+delta) ? +delta : 0;
    if (!addr || !inc) return res.status(400).json({ ok:false, error:'bad_request' });

    const db = await getDb();
    await ensureSchema(db);

    await db.exec('BEGIN;');
    const existing = await db.get(`SELECT score FROM leaderboard_scores WHERE address=?;`, addr);
    if (existing) {
      await db.run(`UPDATE leaderboard_scores SET score = score + ? WHERE address = ?;`, inc, addr);
    } else {
      await db.run(`INSERT INTO leaderboard_scores(address, score) VALUES(?, ?);`, addr, inc);
    }
    await db.exec('COMMIT;');

    const row = await db.get(
      `
      SELECT address, score,
             RANK() OVER (ORDER BY score DESC, address ASC) AS rank
      FROM leaderboard_scores
      WHERE address = ?;
      `,
      addr
    );
    res.json({ ok:true, updated: row });
  } catch (e) {
    try { await (await getDb()).exec('ROLLBACK;'); } catch {}
    console.error('award error:', e);
    res.status(500).json({ ok:false, error:'internal_error' });
  }
});

export default router;
