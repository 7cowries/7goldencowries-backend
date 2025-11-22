import express from 'express';
import db from '../lib/db.js';

const router = express.Router();

/**
 * GET /subscriptions/:wallet
 * Returns every subscription record for the wallet,
 * including nanoton, human TON, txHash, status,
 * startDate (timestamp) and expiryDate (+30 days).
 */
router.get('/subscriptions/:wallet', async (req, res) => {
  const { wallet } = req.params;
  if (!wallet) return res.status(400).json({ error: 'Missing wallet param' });

  try {
    const rows = await db.all(
      `
        SELECT
          tier,
          COALESCE(ton_amount, tonAmount, 0)        AS nanoton,
          COALESCE(ton_amount, tonAmount, 0) / 1e9  AS ton,         -- human TON value
          COALESCE(tx_hash, txHash)                 AS txHash,
          status,
          timestamp         AS startDate,
          datetime(timestamp, '+30 days') AS expiryDate
        FROM subscriptions
        WHERE wallet = ?
        ORDER BY timestamp DESC
      `,
      wallet
    );

    res.json({ subscriptions: rows });
  } catch (err) {
    console.error('Fetch subscriptions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /subscribe
 * Record a new subscription tier for a user and log a pending payment
 * Body: { wallet: string, tier: string, tonAmount: number, txHash: string }
 */
router.post('/subscribe', (req, res) => {
  const { wallet, tier, tonAmount, txHash } = req.body;

  if (!wallet || !tier || typeof tonAmount !== 'number') {
    return res.status(400).json({ error: 'wallet, tier and tonAmount are required' });
  }

  try {
    // Ensure user exists
    const user = db.prepare('SELECT * FROM users WHERE wallet = ?').get(wallet);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Optionally update their tier immediately
    db.prepare(`UPDATE users SET tier = ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE wallet = ?`).run(tier, wallet);

    // Insert a pending subscription
    db.prepare(`
      INSERT INTO subscriptions (wallet, tier, ton_amount, tx_hash, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(wallet, tier, tonAmount, txHash || '');

    res.json({ message: 'Subscription recorded, awaiting TON payment confirmation' });
  } catch (err) {
    console.error('Subscription error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
