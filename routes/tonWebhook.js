import express from 'express';
import db from '../db.js';

const router = express.Router();

/**
 * POST /ton-webhook
 * Called by your TON node/middleware when a payment arrives.
 * Expects JSON: { txHash, status, amount: nanoton, to }
 */
router.post('/ton-webhook', (req, res) => {
  const { txHash, status, amount, to } = req.body;

  if (!txHash || !status || typeof amount !== 'number' || !to) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    const sub = db.prepare(`
      SELECT id, wallet, ton_amount
      FROM subscriptions
      WHERE tx_hash = ? AND status = 'pending'
    `).get(txHash);

    if (!sub) {
      return res.status(404).json({ error: 'No matching pending subscription' });
    }

    if (sub.ton_amount !== amount) {
      console.warn('⚠️ Amount mismatch:', {
        expected: sub.ton_amount,
        received: amount
      });
    }

    const newStatus = status === 'success' ? 'active' : 'failed';

    db.prepare(`
      UPDATE subscriptions
      SET status = ?
      WHERE id = ?
    `).run(newStatus, sub.id);

    if (newStatus === 'active') {
      db.prepare(`
        UPDATE users
        SET tier = (SELECT tier FROM subscriptions WHERE id = ?)
        WHERE wallet = ?
      `).run(sub.id, sub.wallet);
    }

    res.json({ message: 'Webhook processed' });
  } catch (err) {
    console.error('❌ Webhook error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
