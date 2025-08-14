// routes/questsRoutes.js
import express from 'express';
import db from '../db.js';
import { getLevelInfo } from '../utils/levelUtils.js';

const router = express.Router();

/**
 * 📜 Get all quests (id, title, type, url, xp, requiredTier, requiresTwitter, target_handle)
 * Return shape must match the frontend exactly.
 */
router.get('/quests', async (_req, res) => {
  try {
    const rows = await db.all(
      `SELECT
          id,
          title,
          type,
          url,
          xp,
          COALESCE(requiredTier, 'Free')       AS requiredTier,
          COALESCE(requiresTwitter, 0)         AS requiresTwitter,
          COALESCE(target_handle, NULL)        AS target_handle
       FROM quests
       ORDER BY id`
    );

    // normalize booleans
    const quests = rows.map(q => ({
      id: q.id,
      title: q.title,
      type: q.type,
      url: q.url,
      xp: q.xp,
      requiredTier: q.requiredTier || 'Free',
      requiresTwitter: !!q.requiresTwitter,
      target_handle: q.target_handle || null
    }));

    res.json(quests);
  } catch (err) {
    console.error('Failed to fetch quests:', err);
    res.status(500).json({ error: 'Failed to load quests' });
  }
});

/**
 * ✅ Get completed quest IDs for a wallet
 */
router.get('/completed/:wallet', async (req, res) => {
  const { wallet } = req.params;
  if (!wallet) return res.status(400).json({ error: 'Missing wallet' });

  try {
    const rows = await db.all(
      `SELECT questId FROM completed_quests WHERE wallet = ?`,
      wallet
    );
    res.json({ completed: rows.map(r => r.questId) });
  } catch (err) {
    console.error('Fetch completed error:', err);
    res.status(500).json({ error: 'Failed to fetch completed quests' });
  }
});

/**
 * 📘 Quest journal log for a wallet (from completed_quests)
 */
router.get('/journal/:wallet', async (req, res) => {
  const { wallet } = req.params;
  if (!wallet) return res.status(400).json({ error: 'Missing wallet' });

  try {
    const journal = await db.all(
      `SELECT q.title, q.xp, c.timestamp
         FROM completed_quests c
         JOIN quests q ON q.id = c.questId
        WHERE c.wallet = ?
        ORDER BY c.timestamp DESC`,
      wallet
    );
    res.json({ journal });
  } catch (err) {
    console.error('Journal fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch journal' });
  }
});

/**
 * 🧠 Complete a quest
 * - Enforces required tier
 * - Enforces Twitter linking if quest.requiresTwitter = 1
 * - (Keeps target_handle available for future verification if you add it)
 */
router.post('/complete', async (req, res) => {
  const { wallet, questId } = req.body || {};
  if (!wallet || !questId) {
    return res.status(400).json({ error: 'Missing wallet or questId' });
  }

  try {
    // Already completed?
    const already = await db.get(
      `SELECT 1 FROM completed_quests WHERE wallet = ? AND questId = ?`,
      wallet,
      questId
    );
    if (already) return res.status(400).json({ error: 'Quest already completed' });

    // Load user & quest (now including target_handle)
    const user = await db.get(`SELECT * FROM users WHERE wallet = ?`, wallet);

    const quest = await db.get(
      `SELECT
          id,
          title,
          type,
          url,
          xp,
          COALESCE(requiresTwitter, 0) AS requiresTwitter,
          COALESCE(requiredTier, 'Free') AS requiredTier,
          COALESCE(target_handle, NULL)  AS target_handle
         FROM quests
        WHERE id = ?`,
      questId
    );

    if (!user || !quest) {
      return res.status(404).json({ error: 'User or quest not found' });
    }

    // Optional constraints
    if (quest.requiresTwitter) {
      // Confirm the user has linked Twitter before claiming XP
      const link = await db.get(`SELECT twitter FROM social_links WHERE wallet = ?`, [wallet]);
      const hasTwitter = link?.twitter || user?.twitterHandle;
      if (!hasTwitter) {
        return res.status(403).json({ error: 'This quest requires a linked Twitter account.' });
      }
      // NOTE: For true verification (e.g., "follows @target_handle"), you’ll add a dedicated
      // verification step here using user-auth Twitter tokens and quest.target_handle.
    }

    // Tier gate
    const tierOrder = { Free: 0, 'Tier 1': 1, 'Tier 2': 2, 'Tier 3': 3 };
    const userTier = user.tier || 'Free';
    const required = quest.requiredTier || 'Free';
    if ((tierOrder[userTier] ?? 0) < (tierOrder[required] ?? 0)) {
      return res.status(403).json({ error: `This quest requires ${required}` });
    }

    // XP with tier multiplier
    const multiplierByTier = { Free: 1.0, 'Tier 1': 1.2, 'Tier 2': 1.5, 'Tier 3': 2.0 };
    const xpGain = Math.round(quest.xp * (multiplierByTier[userTier] ?? 1.0));

    await db.run(`UPDATE users SET xp = xp + ? WHERE wallet = ?`, xpGain, wallet);

    // Recompute level
    const { xp } = await db.get(`SELECT xp FROM users WHERE wallet = ?`, wallet);
    const level = getLevelInfo(xp);

    await db.run(
      `UPDATE users
          SET levelName = ?, levelSymbol = ?, levelProgress = ?, nextXP = ?
        WHERE wallet = ?`,
      level.name, level.symbol, level.progress, level.nextXP, wallet
    );

    // Mark completed
    await db.run(
      `INSERT INTO completed_quests (wallet, questId, timestamp)
       VALUES (?, ?, ?)`,
      wallet, questId, new Date().toISOString()
    );

    // Simple referral bonus on first completion
    const { count } = await db.get(
      `SELECT COUNT(*) AS count FROM completed_quests WHERE wallet = ?`,
      wallet
    );

    if (count === 1) {
      const ref = await db.get(
        `SELECT * FROM referrals WHERE referred = ? AND completed = 0`,
        wallet
      );
      if (ref) {
        await db.run(`UPDATE referrals SET completed = 1 WHERE referred = ?`, wallet);
        await db.run(`UPDATE users SET xp = xp + 50 WHERE wallet = ?`, ref.referrer);

        const { xp: refXp } = await db.get(
          `SELECT xp FROM users WHERE wallet = ?`,
          ref.referrer
        );
        const refLevel = getLevelInfo(refXp);

        await db.run(
          `UPDATE users
              SET levelName = ?, levelSymbol = ?, levelProgress = ?, nextXP = ?
            WHERE wallet = ?`,
          refLevel.name, refLevel.symbol, refLevel.progress, refLevel.nextXP, ref.referrer
        );
        console.log(`✨ Referral XP awarded to ${ref.referrer}`);
      }
    }

    res.json({ message: `+${xpGain} XP gained!`, xpGain });
  } catch (err) {
    console.error('Quest complete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
