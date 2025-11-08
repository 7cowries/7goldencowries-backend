import express from 'express';
import db from '../db.js';

const r = express.Router();

/**
 * GET /api/me
 * Minimal "not logged in" shape that won’t 404 the frontend.
 */
r.get('/me', (_req, res) => {
  res.json({ ok: true, user: null });
});

/**
 * GET /api/user/me  (legacy alias)
 */
r.get('/user/me', (_req, res) => {
  res.redirect(307, '/api/me');
});

/**
 * GET /api/leaderboard
 * Tries better-sqlite3 first (prepare().all()), otherwise falls back to db.all or db.query.
 */
r.get('/leaderboard', async (_req, res) => {
  const SQL = 'SELECT address AS wallet, score FROM leaderboard_scores ORDER BY score DESC LIMIT 100';
  try {
    let rows;

    // better-sqlite3
    if (db && typeof db.prepare === 'function') {
      rows = db.prepare(SQL).all();
    }
    // sqlite/promises-ish
    else if (db && typeof db.all === 'function') {
      rows = await db.all(SQL);
    }
    // generic pool.query style
    else if (db && typeof db.query === 'function') {
      const qres = await db.query(SQL, []);
      rows = Array.isArray(qres) ? qres : qres?.rows ?? [];
    } else {
      throw new Error('Unsupported DB interface: no prepare/all/query on db');
    }

    res.json({ ok: true, leaderboard: rows ?? [] });
  } catch (e) {
    console.error('[compat-api] /api/leaderboard failed:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/**
 * GET /api/v1/payments/status
 * Simple health/placeholder endpoint for the client.
 */
r.get('/v1/payments/status', (_req, res) => {
  res.json({ ok: true, status: 'ready' });
});

export default r;
