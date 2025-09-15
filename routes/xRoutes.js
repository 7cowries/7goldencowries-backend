// routes/xRoutes.js
import express from 'express';
import db from '../lib/db.js';

const r = express.Router();

const X_HANDLE = process.env.X_HANDLE || '@SevenGoldenCowries';
const X_TARGET_URL = process.env.X_TARGET_URL || 'https://7goldencowries.com';

function makeNonce() {
  return '7GC-' + Math.random().toString(36).slice(2, 8);
}

// Issue a nonce for a specific questId
// POST /api/x/nonce { questId }
r.post('/nonce', async (req, res) => {
  try {
    const wallet = req.session?.wallet;
    if (!wallet) return res.status(401).json({ error: 'Login & bind wallet first' });

    const questId = Number(req.body?.questId ?? req.body?.quest_id);
    if (!Number.isFinite(questId)) return res.status(400).json({ error: 'Invalid questId' });

    // Optional: ensure quest type is 'x_nonce'
    const q = await db.get('SELECT id, type FROM quests WHERE id = ?', questId);
    if (!q) return res.status(404).json({ error: 'Quest not found' });

    const nonce = makeNonce();
    await db.run(
      `INSERT INTO x_nonces (wallet, quest_id, nonce, status, createdAt)
       VALUES (?, ?, ?, 'issued', ?)`,
      wallet, questId, nonce, Date.now()
    );

    const tweetText =
      `I found the Seven Golden Cowries! ${nonce} ${X_HANDLE} ${X_TARGET_URL}`;
    const intentUrl =
      'https://twitter.com/intent/tweet?text=' + encodeURIComponent(tweetText);

    res.json({ nonce, intentUrl, tweetText });
  } catch (e) {
    console.error('x/nonce error', e);
    res.status(500).json({ error: 'Failed to create nonce' });
  }
});

// Submit the user’s tweet URL for review (no scraping)
// POST /api/x/submit { questId, tweetUrl }
r.post('/submit', async (req, res) => {
  try {
    const wallet = req.session?.wallet;
    if (!wallet) return res.status(401).json({ error: 'Login & bind wallet first' });

    const questId = Number(req.body?.questId ?? req.body?.quest_id);
    const tweetUrl = String(req.body?.tweetUrl || '').trim();
    if (!Number.isFinite(questId)) return res.status(400).json({ error: 'Invalid questId' });
    if (!/^https:\/\/(x|twitter)\.com\/[^/]+\/status\/\d+/.test(tweetUrl))
      return res.status(400).json({ error: 'Invalid tweet URL' });

    const last = await db.get(
      `SELECT id, nonce FROM x_nonces
       WHERE wallet = ? AND quest_id = ? AND status = 'issued'
       ORDER BY createdAt DESC LIMIT 1`,
      wallet, questId
    );
    if (!last) return res.status(400).json({ error: 'No nonce issued' });

    await db.run(
      `UPDATE x_nonces
         SET status = 'submitted', tweetUrl = ?, submittedAt = ?
       WHERE id = ?`,
      tweetUrl, Date.now(), last.id
    );

    res.json({ ok: true, status: 'pending_review' });
  } catch (e) {
    console.error('x/submit error', e);
    res.status(500).json({ error: 'Failed to submit proof' });
  }
});

export default r;
