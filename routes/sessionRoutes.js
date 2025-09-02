import express from 'express';
import db from '../db.js';

const r = express.Router();

// Bind TON wallet to the current session (idempotent)
r.post('/bind-wallet', async (req, res) => {
  try {
    const { wallet } = req.body || {};
    const w = String(wallet || '').trim();
    if (!w) return res.status(400).json({ error: 'Missing wallet' });

    // attach to session
    req.session.wallet = w;

    // ensure user row exists (ignore if already present)
    await db.run(
      `INSERT INTO users (wallet, xp, tier, levelName, levelSymbol, levelProgress, nextXP)
       VALUES (?, 0, 'Free', 'Shellborn', '🐚', 0, 10000)
       ON CONFLICT(wallet) DO NOTHING`,
      w
    );

    res.json({ ok: true, wallet: w });
  } catch (e) {
    console.error('bind-wallet error', e);
    res.status(500).json({ error: 'Failed to bind wallet' });
  }
});

export default r;
