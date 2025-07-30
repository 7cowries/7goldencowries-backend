// routes/referralRoutes.js
import express from 'express';
import db from '../db.js';
import { getLevelInfo } from '../utils/levelUtils.js';

const router = express.Router();

/**
 * POST /claim-referral
 * Body: { referrer, referred }
 * Gives +50 XP to both wallets (only once per referred wallet)
 */
router.post('/claim-referral', (req, res) => {
  const { referrer, referred } = req.body;
  if (!referrer || !referred) {
    return res.status(400).json({ error: 'Missing referrer or referred' });
  }
  if (referrer === referred) {
    return res.status(400).json({ error: 'Cannot refer yourself' });
  }

  const exists = db.prepare('SELECT 1 FROM referrals WHERE referred = ?').get(referred);
  if (exists) return res.status(409).json({ error: 'Referral already claimed' });

  const XP_BONUS = 50;

  const trx = db.transaction(() => {
    db.prepare(`INSERT INTO referrals (referrer, referred) VALUES (?, ?)`).run(referrer, referred);
    db.prepare('UPDATE users SET xp = xp + ? WHERE wallet = ?').run(XP_BONUS, referrer);
    db.prepare('UPDATE users SET xp = xp + ? WHERE wallet = ?').run(XP_BONUS, referred);
  });

  try {
    trx();
  } catch (err) {
    console.error('Referral transaction error:', err);
    return res.status(500).json({ error: 'Database error during referral claim' });
  }

  const userRow = db.prepare('SELECT xp FROM users WHERE wallet = ?').get(referred);
  const level = getLevelInfo(userRow.xp);

  res.json({ ok: true, newXP: userRow.xp, level });
});

/**
 * GET /referrals/:wallet
 * Returns all referred explorers and their completed status
 */
router.get('/referrals/:wallet', (req, res) => {
  const { wallet } = req.params;

  try {
    const list = db.prepare(`
      SELECT referred AS address, completed
      FROM referrals
      WHERE referrer = ?
      ORDER BY timestamp DESC
    `).all(wallet);

    res.json({ referrals: list });
  } catch (err) {
    console.error('Referral fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch referrals' });
  }
});

/**
 * POST /referral/complete
 * Body: { referred }
 * Marks a referral as completed (when referred user finishes their first quest)
 */
router.post('/referral/complete', (req, res) => {
  const { referred } = req.body;
  if (!referred) return res.status(400).json({ error: 'Missing referred wallet' });

  try {
    db.prepare(`UPDATE referrals SET completed = 1 WHERE referred = ?`).run(referred);
    res.json({ ok: true });
  } catch (err) {
    console.error('Referral complete error:', err);
    res.status(500).json({ error: 'Failed to mark referral as completed' });
  }
});

export default router;
