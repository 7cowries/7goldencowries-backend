import express from 'express';
import db from '../db.js';

const r = express.Router();

/**
 * GET /api/me
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
 * Supports:
 *  - better-sqlite3: db.prepare(...).all()
 *  - sqlite/promises-like: db.all(...)
 *  - pool-like: db.query(...)
 *  - callable wrapper: db(sql[, params]) -> rows
 */
r.get('/leaderboard', async (_req, res) => {
  const SQL = 'SELECT address AS wallet, score FROM leaderboard_scores ORDER BY score DESC LIMIT 100';
  try {
    let rows;

    if (db && typeof db.prepare === 'function') {
      rows = db.prepare(SQL).all();
    } else if (db && typeof db.all === 'function') {
      rows = await db.all(SQL);
    } else if (db && typeof db.query === 'function') {
      const qres = await db.query(SQL, []);
      rows = Array.isArray(qres) ? qres : (qres?.rows ?? []);
    } else if (typeof db === 'function') {
      // handle callable wrappers (sync or async)
      const out = db.length >= 2 ? await db(SQL, []) : await db(SQL);
      rows = Array.isArray(out) ? out : (out?.rows ?? []);
    } else {
      throw new Error('Unsupported DB interface: no prepare/all/query/function on db');
    }

    res.json({ ok: true, leaderboard: rows ?? [] });
  } catch (e) {
    console.error('[compat-api] /api/leaderboard failed:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/**
 * GET /api/v1/payments/status
 */
r.get('/v1/payments/status', (_req, res) => {
  res.json({ ok: true, status: 'ready' });
});

export default r;
