import express from 'express';
import db from '../db.js';
import { getLevelInfo } from '../utils/levelUtils.js';

const router = express.Router();

router.get('/leaderboard', (req, res) => {
  try {
    const users = db.prepare(`
      SELECT wallet, xp, tier, twitterHandle
      FROM users
      ORDER BY xp DESC
      LIMIT 100
    `).all();

    const top = users.map((user, i) => {
      const level = getLevelInfo(user.xp);
      return {
        rank: i + 1,
        wallet: user.wallet,
        xp: user.xp,
        tier: user.tier || 'Free',
        twitter: user.twitterHandle || null,
        name: level.name,
        symbol: level.symbol,
        progress: level.progress / 100,
        badge: `/images/badges/level-${level.name.toLowerCase().replace(/\s+/g, '-')}.png`
      };
    });

    res.json({ top });
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

export default router;
