const express = require('express');
const router = express.Router();

/**
 * Temporary stub — prevents 404s on FE.
 * Replace `leaderboard: []` with real data later.
 */
router.get('/', async (req, res) => {
  try {
    return res.json({
      ok: true,
      leaderboard: [],
      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'leaderboard_failed' });
  }
});

module.exports = router;
