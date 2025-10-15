const { Router } = require('express');
const router = Router();

// GET /api/leaderboard
router.get('/', async (_req, res) => {
  try {
    const results = []; // TODO: replace with real aggregation
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
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

module.exports = router;
