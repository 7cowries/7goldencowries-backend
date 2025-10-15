import { Router } from 'express';
const router = Router();

router.get('/', async (_req, res) => {
  try {
    const results = []; // TODO: plug real data/aggregation here later
    res.json({
      ok: true,
      total: results.length,
      results,
      rows: results,
      items: results,
      leaderboard: results
    });
  } catch (e) {
    console.error('leaderboard error:', e);
    res.status(500).json({ ok:false, error:'internal_error' });
  }
});

export default router;
