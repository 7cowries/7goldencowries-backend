import express from 'express';
import * as DB from '../db.js';
import Database from 'better-sqlite3';

const r = express.Router();

// Normalize whatever ../db.js exports
function resolveDb() {
  // prefer explicit fields if present
  if (DB && typeof DB.db !== 'undefined') return DB.db;
  if (DB && typeof DB.default !== 'undefined') return DB.default;
  return DB; // might be a function or object
}

async function runQuery(sql, params = []) {
  const db = resolveDb();

  // 1) better-sqlite3 style
  if (db && typeof db.prepare === 'function') {
    return db.prepare(sql).all(params);
  }

  // 2) sqlite/promises style
  if (db && typeof db.all === 'function') {
    return await db.all(sql, params);
  }

  // 3) pool-like
  if (db && typeof db.query === 'function') {
    const res = await db.query(sql, params);
    return Array.isArray(res) ? res : (res?.rows ?? []);
  }

  // 4) callable wrapper
  if (typeof db === 'function') {
    const out = db.length >= 2 ? await db(sql, params) : await db(sql);
    return Array.isArray(out) ? out : (out?.rows ?? []);
  }

  // 5) Fallback: open the file directly (read-only) using better-sqlite3
  const dbPath = process.env.DB_PATH || '/var/data/7gc.sqlite3';
  const ro = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const stmt = ro.prepare(sql);
    return stmt.all(params);
  } finally {
    ro.close();
  }
}

/** GET /api/me */
r.get('/me', (_req, res) => {
  res.json({ ok: true, user: null });
});

/** GET /api/user/me (legacy alias) */
r.get('/user/me', (_req, res) => {
  res.redirect(307, '/api/me');
});

/** GET /api/leaderboard */
r.get('/leaderboard', async (_req, res) => {
  const SQL = 'SELECT address AS wallet, score FROM leaderboard_scores ORDER BY score DESC LIMIT 100';
  try {
    const rows = await runQuery(SQL, []);
    res.json({ ok: true, leaderboard: rows ?? [] });
  } catch (e) {
    console.error('[compat-api] /api/leaderboard failed:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/** GET /api/v1/payments/status */
r.get('/v1/payments/status', (_req, res) => {
});

// non-v1 alias for old clients
r.get('/payments/status', (_req, res) => {
  res.json({ ok: true, status: 'ready' });
});

export default r;
