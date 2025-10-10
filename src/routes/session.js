const express = require('express');
const router = express.Router();

const COOKIE_NAME = '7gc.sid';

// POST /api/auth/wallet/session
router.post('/auth/wallet/session', (req, res) => {
  try {
    const address = String(req.body?.address || '').trim();
    if (!address) return res.status(400).json({ ok:false, error:'address_required' });

    res.cookie(COOKIE_NAME, address, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: 1000*60*60*24*7
    });
    return res.json({ ok:true, wallet: address });
  } catch {
    return res.status(500).json({ ok:false, error:'server_error' });
  }
});

// GET /api/me
router.get('/me', (req, res) => {
  const address = req.cookies?.[COOKIE_NAME] || null;
  if (!address) return res.json({ ok:true, authed:false });
  return res.json({ ok:true, authed:true, wallet: address, xp:0, level:'Shellborn', levelProgress:0 });
});

module.exports = router;
