const { Router } = require('express');

const r = Router();

r.post('/session', async (req, res) => {
  const address = (req.body && req.body.address || '').trim();
  if (!address) return res.status(400).json({ ok:false, error:'address required' });

  res.cookie(process.env.COOKIE_NAME || '7gc_sess', address, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 7
  });

  res.json({ ok:true });
});

module.exports = r;
