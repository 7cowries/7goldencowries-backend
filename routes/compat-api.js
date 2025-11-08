import express from 'express';

const r = express.Router();

// /api/session: set/clear the gc_wallet cookie used by /api/me
r.post('/session', (req, res) => {
  const { wallet } = req.body || {};
  if (!wallet) return res.status(400).json({ ok: false, error: 'wallet required' });
  res.cookie('gc_wallet', wallet, {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30d
    path: '/',
  });
  res.json({ ok: true });
});

r.delete('/session', (_req, res) => {
  res.clearCookie('gc_wallet', { path: '/', sameSite: 'none', secure: true });
  res.json({ ok: true });
});

// /api/me: read wallet from cookie
r.get('/me', (req, res) => {
  const wallet = req.cookies?.gc_wallet || null;
  res.json({ ok: true, user: wallet ? { wallet } : null });
});

// Legacy alias
r.get('/user/me', (_req, res) => res.redirect(307, '/api/me'));

// Leaderboard placeholder (empty list until real data)
r.get('/leaderboard', async (_req, res) => {
  try {
    res.json({ ok: true, leaderboard: [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Payments status placeholder
r.get('/v1/payments/status', (_req, res) => res.json({ ok: true, status: 'ready' }));

export default r;
