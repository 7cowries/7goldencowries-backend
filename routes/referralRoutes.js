import express from 'express';
import db from '../db.js';
import { getLevelInfo } from '../utils/levelUtils.js';

const router = express.Router();

/**
 * POST /claim-referral
 * Body: { referrer, referred }
 */
router.post('/claim-referral', async (req, res) => {
  const { referrer, referred } = req.body;
  if (!referrer || !referred) return res.status(400).json({ error: 'Missing referrer or referred' });
  if (referrer === referred) return res.status(400).json({ error: 'Cannot refer yourself' });

  try {
    const exists = await db.get('SELECT 1 FROM referrals WHERE referred = ?', referred);
    if (exists) return res.status(409).json({ error: 'Referral already claimed' });

    const XP_BONUS = 50;

    await db.run('INSERT INTO referrals (referrer, referred) VALUES (?, ?)', referrer, referred);
    await db.run('UPDATE users SET xp = xp + ? WHERE wallet = ?', XP_BONUS, referrer);
    await db.run('UPDATE users SET xp = xp + ? WHERE wallet = ?', XP_BONUS, referred);

    const userRow = await db.get('SELECT xp FROM users WHERE wallet = ?', referred);
    const level = getLevelInfo(userRow.xp);

    res.json({ ok: true, newXP: userRow.xp, level });
  } catch (err) {
    console.error('Referral claim error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /referrals/:wallet
 */
router.get('/referrals/:wallet', async (req, res) => {
  const { wallet } = req.params;

  try {
    let list = [];
    try {
      list = await db.all(`
        SELECT referred AS address, completed
        FROM referrals
        WHERE referrer = ?
      `, wallet);
    } catch (err) {
      if (err.message.includes("no such column: completed")) {
        // fallback if `completed` column doesn't exist
        list = await db.all(`
          SELECT referred AS address, 0 as completed
          FROM referrals
          WHERE referrer = ?
        `, wallet);
      } else {
        throw err;
      }
    }

    res.json({ referrals: list });
  } catch (err) {
    console.error('Referral fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch referrals' });
  }
});

/**
 * POST /referral/complete
 * Body: { referred }
 */
router.post('/referral/complete', async (req, res) => {
  const { referred } = req.body;
  if (!referred) return res.status(400).json({ error: 'Missing referred wallet' });

  try {
    await db.run('UPDATE referrals SET completed = 1 WHERE referred = ?', referred);
    res.json({ ok: true });
  } catch (err) {
    if (err.message.includes("no such column: completed")) {
      console.warn("⚠️ Skipping referral completion — column `completed` doesn't exist yet.");
      return res.json({ ok: true, warning: 'Column missing' });
    }

    console.error('Referral complete error:', err);
    res.status(500).json({ error: 'Failed to mark referral as completed' });
  }
});

export default router;
