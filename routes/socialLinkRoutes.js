import express from 'express';
import db from '../lib/db.js';

const router = express.Router();

router.post('/api/social/:provider/unlink', async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Auth required' });

  const p = req.params.provider; // 'telegram'|'twitter'|'discord'
  const maps = {
    telegram: ['telegram_id','telegram_username'],
    twitter:  ['twitter_id','twitter_handle'],
    discord:  ['discord_id','discord_username']
  };
  const cols = maps[p];
  if (!cols) return res.status(400).json({ error: 'Unknown provider' });

  const sets = cols.map(c => `${c}=NULL`).join(',');
  await db.run(
    `UPDATE users SET ${sets}, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
    [userId]
  );

  res.json({ status: 'unlinked', provider: p });
});

router.post('/api/social/:provider/resync', async (req, res) => {
  // NOTE: This assumes you have stored oauth tokens or session links to fetch fresh data.
  // If you don't, keep this endpoint as-is and handle re-auth on frontend.
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Auth required' });

  const p = req.params.provider;
  if (p === 'telegram') {
    return res.status(400).json({ error: 'telegram_resync_requires_widget' });
  }

  // For now, tell client to re-auth through normal OAuth for twitter/discord
  return res.status(400).json({ error: 'resync_via_oauth' });
});

export default router;
