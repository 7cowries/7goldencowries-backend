const express = require('express');
const router = express.Router();

const COOKIE_NAME = '7gc.sid';

// POST /api/auth/wallet/session  { address: "..." }
router.post('/auth/wallet/session', (req, res) => {
  try {
    const address = String(req.body?.address || '').trim();
    if (!address) return res.status(400).json({ ok: false, error: 'address_required' });

    // Store ONLY the wallet address as the session cookie value (no PII).
    // Cookie is httpOnly + SameSite=None + Secure so it can be sent across FE<->BE.
    res.cookie(COOKIE_NAME, address, {
      httpOnly: true,
      secure: true,          // required with SameSite=None
      sameSite: 'none',      // cross-site cookie for FE (Vercel) -> BE (Render)
      path: '/',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    });

    return res.json({ ok: true, wallet: address });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// GET /api/me  -> echo minimal profile from cookie (BE can enrich later)
router.get('/me', (req, res) => {
  const address = req.cookies?.[COOKIE_NAME] || null;
  if (!address) return res.status(200).json({ ok: true, authed: false });

  return res.json({
    ok: true,
    authed: true,
    wallet: address,
    // placeholders; BE can fill with real user data if available
    xp: 0,
    level: 'Shellborn',
    levelProgress: 0,
  });
});

module.exports = router;
