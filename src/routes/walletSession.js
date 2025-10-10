import { Router } from 'express';

const router = Router();

/**
 * POST /api/auth/wallet/session
 * Body: { address: string }
 * Sets cookie 7gc.sid and returns a minimal profile-ish payload.
 */
router.post('/auth/wallet/session', async (req, res) => {
  try {
    const address = String(req.body?.address || '').trim();
    if (!address) {
      return res.status(400).json({ ok: false, error: 'address-required' });
    }

    // Minimal token: prefix so we can see it’s wallet-based (replace with real sign/verify later)
    const token = `w:${address}`;

    // Set cookie exactly as requested: 7gc.sid
    res.cookie('7gc.sid', token, {
      httpOnly: true,       // JS cannot read it
      secure: true,         // required for SameSite=None
      sameSite: 'none',     // FE <-> BE across domains
      path: '/',            // send to all routes
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    });

    return res.json({
      ok: true,
      address,
      session: 'set',
    });
  } catch (e) {
    console.error('[wallet-session] error:', e);
    return res.status(500).json({ ok: false, error: 'session-failed' });
  }
});

/**
 * GET /api/me
 * Reads cookie and returns basic info.
 */
router.get('/me', async (req, res) => {
  const raw = req.cookies?.['7gc.sid'] || '';
  const address = raw.startsWith('w:') ? raw.slice(2) : null;

  return res.json({
    ok: true,
    authed: Boolean(address),
    wallet: address,
  });
});

/**
 * Simple health endpoint we used earlier
 */
router.get('/health', (_req, res) => {
  res.json({ ok: true, db: 'ok' });
});

export default router;
