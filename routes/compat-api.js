import express from 'express';
import { db } from '../db.js';

const r = express.Router();

/** GET /api/me – minimal shape so the frontend doesn’t 404 */
r.get('/me', (_req, res) => {
  res.json({ ok: true, user: null });
});

/** GET /api/user/me – legacy alias */
r.get('/user/me', (_req, res) => {
  res.redirect(307, '/api/me');
});

/** GET /api/leaderboard – reads leaderboard_scores(address, score) */
r.get('/leaderboard', async (_req, res) => {
  try {
    const rows = await db.all(
      'SELECT address AS wallet, score FROM leaderboard_scores ORDER BY score DESC LIMIT 100'
    );
    res.json({ ok: true, leaderboard: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/** GET /api/v1/payments/status – simple OK placeholder */
r.get('/v1/payments/status', (_req, res) => {
  res.json({ ok: true, status: 'ready' });
});

export default r;
