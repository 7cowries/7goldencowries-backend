const express = require('express');
const router = express.Router();

// GET /api/leaderboard
router.get('/', async (_req, res) => {
  try {
    const results = []; // TODO: replace with real DB aggregation
    res.json({
      ok: true,
      total: results.length,
      results,
      rows: results,
      items: results,
      leaderboard: results,
    });
  } catch (e) {
    console.error('leaderboard error:', e);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

module.exports = router;
