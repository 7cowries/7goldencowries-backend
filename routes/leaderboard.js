module.exports = function (app) {
  app.get('/api/leaderboard', async (req, res) => {
    try {
      const results = []; // TODO: replace with real aggregation later
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
};
