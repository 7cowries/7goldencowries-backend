import { Router } from 'express';

const r = Router();

/**
 * POST /api/auth/wallet/session
 * body: { address: string }
 * Sets a secure, host-only cookie so FE (via Vercel /api proxy) sees the session.
 */
r.post('/session', async (req, res) => {
  const address = (req.body?.address || '').trim();
  if (!address) return res.status(400).json({ ok:false, error:'address required' });

  res.cookie(process.env.COOKIE_NAME || '7gc_sess', address, {
    httpOnly: true,
    secure: true,          // required in TLS
    sameSite: 'none',      // required across proxy
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 7  // 7 days
  });

  res.json({ ok:true });
});

export default r;
