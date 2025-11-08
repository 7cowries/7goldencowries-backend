import express from 'express';
import { getDB } from '../db.js';

const r = express.Router();
const COOKIE = 'gc_wallet';

function readWalletFromCookie(req) {
  const raw = req.headers.cookie || '';
  const m = raw.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

/** GET /api/me -> reflects wallet from cookie, or null */
r.get('/me', (req, res) => {
  const wallet = readWalletFromCookie(req);
  res.json({ ok: true, user: wallet ? { wallet } : null });
});

/** Legacy alias */
r.get('/user/me', (_req, res) => res.redirect(307, '/api/me'));

/** GET /api/leaderboard (kept working) */
r.get('/leaderboard', async (_req, res) => {
  try {
    const db = await getDB();
    if (!db || !(db.prepare || db.all || db.query)) {
      throw new Error('Unsupported DB interface: no prepare/all/query/function on db');
    }
    const rows =
      db.all
        ? await db.all('SELECT address AS wallet, score FROM leaderboard_scores ORDER BY score DESC LIMIT 100')
        : db.prepare
        ? db.prepare('SELECT address AS wallet, score FROM leaderboard_scores ORDER BY score DESC LIMIT 100').all()
        : (await db.query('SELECT address AS wallet, score FROM leaderboard_scores ORDER BY score DESC LIMIT 100')).all();
    res.json({ ok: true, leaderboard: rows });
  } catch (e) {
    console.error('[compat-api] /api/leaderboard failed:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/** POST /api/session  {wallet} -> set session cookie */
r.post('/session', express.json(), (req, res) => {
  const wallet = (req.body && String(req.body.wallet || '').trim()) || '';
  if (!wallet) return res.status(400).json({ ok: false, error: 'wallet required' });
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${encodeURIComponent(wallet)}; Path=/; Max-Age=${30 * 24 * 3600}; HttpOnly; Secure; SameSite=None`
  );
  res.json({ ok: true });
});

/** POST /api/logout -> clear session cookie */
r.post('/logout', (_req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`);
  res.json({ ok: true });
});

/** v1 payments health */
r.get('/v1/payments/status', (_req, res) => res.json({ ok: true, status: 'ready' }));

export default r;
