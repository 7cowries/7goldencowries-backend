// routes/adminXRoutes.js
import express from 'express';
import db from '../lib/db.js';
import { awardQuest } from '../lib/quests.js';

const r = express.Router();
const ADMIN_KEY = process.env.ADMIN_KEY || '';

function assertAdmin(req, res) {
  const key = req.get('x-admin-key') || '';
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// List pending submissions
// GET /api/admin/x/pending
r.get('/pending', async (req, res) => {
  if (!assertAdmin(req, res)) return;
  try {
    const rows = await db.all(
      `SELECT id, wallet, quest_id AS questId, nonce, tweetUrl, createdAt, submittedAt
         FROM x_nonces
        WHERE status = 'submitted'
        ORDER BY submittedAt ASC
        LIMIT 500`
    );
    res.json({ pending: rows || [] });
  } catch (e) {
    console.error('admin x pending', e);
    res.status(500).json({ error: 'Failed to load pending' });
  }
});

// Approve a submission and award XP
// POST /api/admin/x/approve { wallet, questId }
r.post('/approve', async (req, res) => {
  if (!assertAdmin(req, res)) return;
  try {
    const wallet = String(req.body?.wallet || '').trim();
    const questId = Number(req.body?.questId ?? req.body?.quest_id);
    const reviewer = req.get('x-admin-user') || 'admin';

    if (!wallet || !Number.isFinite(questId))
      return res.status(400).json({ error: 'Bad args' });

    // find most recent submitted nonce for this wallet+quest
    const row = await db.get(
      `SELECT id FROM x_nonces
        WHERE wallet = ? AND quest_id = ? AND status = 'submitted'
        ORDER BY submittedAt DESC LIMIT 1`,
      wallet, questId
    );
    if (!row) return res.status(404).json({ error: 'No submitted record' });

    // approve + record reviewer
    await db.run(
      `UPDATE x_nonces
          SET status = 'approved', approvedAt = ?, reviewer = ?
        WHERE id = ?`,
      Date.now(), reviewer, row.id
    );

    const result = await awardQuest(wallet, questId);
    if (!result.ok && result.error) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ ok: true, xpGain: result.xpGain || 0, already: !!result.already });
  } catch (e) {
    console.error('admin x approve', e);
    res.status(500).json({ error: 'Approve failed' });
  }
});

// Reject a submission
// POST /api/admin/x/reject { wallet, questId, reason? }
r.post('/reject', async (req, res) => {
  if (!assertAdmin(req, res)) return;
  try {
    const wallet = String(req.body?.wallet || '').trim();
    const questId = Number(req.body?.questId ?? req.body?.quest_id);
    if (!wallet || !Number.isFinite(questId))
      return res.status(400).json({ error: 'Bad args' });

    const row = await db.get(
      `SELECT id FROM x_nonces
        WHERE wallet = ? AND quest_id = ? AND status = 'submitted'
        ORDER BY submittedAt DESC LIMIT 1`,
      wallet, questId
    );
    if (!row) return res.status(404).json({ error: 'No submitted record' });

    await db.run(
      `UPDATE x_nonces
          SET status = 'rejected'
        WHERE id = ?`,
      row.id
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('admin x reject', e);
    res.status(500).json({ error: 'Reject failed' });
  }
});

export default r;
