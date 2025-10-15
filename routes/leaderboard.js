import { Router } from 'express';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const router = Router();

async function getDb() {
  return open({
    filename: process.env.DATABASE_URL || './data.db',
    driver: sqlite3.Database
  });
}

async function tableExists(db, name) {
  const row = await db.get(
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1;",
    name
  );
  return !!row;
}

router.get('/', async (req, res) => {
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '50', 10)));
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10));

  try {
    const db = await getDb();

    // Prefer scores(address, score) > xp(address, xp) > fallback placeholder
    let src = null;
    if (await tableExists(db, 'scores')) src = { table: 'scores', col: 'score' };
    else if (await tableExists(db, 'xp')) src = { table: 'xp', col: 'xp' };
    else {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS leaderboard_scores(
          address TEXT PRIMARY KEY,
          score   INTEGER NOT NULL DEFAULT 0
        );
      `);
      src = { table: 'leaderboard_scores', col: 'score' };
    }

    const totalRow = await db.get(
      \`SELECT COUNT(*) AS c FROM (SELECT address, SUM(\${src.col}) AS score FROM \${src.table} GROUP BY address)\`
    );
    const total = totalRow?.c || 0;

    const rows = await db.all(
      \`
      SELECT
        address,
        score,
        RANK() OVER (ORDER BY score DESC, address ASC) AS rank
      FROM (
        SELECT address, SUM(\${src.col}) AS score
        FROM \${src.table}
        GROUP BY address
      )
      ORDER BY score DESC, address ASC
      LIMIT ? OFFSET ?;
      \`,
      limit, offset
    );

    res.json({
      ok: true,
      total,
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
