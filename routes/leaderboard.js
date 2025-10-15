import { Router } from 'express';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const router = Router();

async function getDb(){
  return open({ filename: process.env.DATABASE_URL || './data.db', driver: sqlite3.Database });
}

router.get('/', async (req, res) => {
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '50', 10)));
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10));
  try {
    const db = await getDb();

    // Placeholder table. Replace with your aggregation later if you have other tables.
    await db.exec(`
      CREATE TABLE IF NOT EXISTS leaderboard_scores(
        address TEXT PRIMARY KEY,
        score   INTEGER NOT NULL DEFAULT 0
      );
    `);

    const totalRow = await db.get(`SELECT COUNT(*) AS c FROM leaderboard_scores;`);
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

    res.json({
      ok: true,
      total: totalRow?.c || 0,
      results: rows,
      rows,
      items: rows,
      leaderboard: rows
    });
  } catch (e) {
    console.error('leaderboard error:', e);
    res.status(500).json({ ok:false, error:'internal_error' });
  }
});

export default router;
