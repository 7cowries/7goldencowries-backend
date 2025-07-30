import express from 'express';
import db from '../db.js';
import { getLevelInfo } from '../utils/levelUtils.js';

const router = express.Router();

// 📜 Get all quests
router.get('/quests', async (req, res) => {
  try {
    const quests = await db.all(`SELECT * FROM quests ORDER BY id`);
    res.json(quests);
  } catch (err) {
    console.error('Failed to fetch quests:', err);
    res.status(500).json({ error: 'Failed to load quests' });
  }
});

// ✅ Return completed quest IDs
router.get('/completed/:wallet', async (req, res) => {
  const wallet = req.params.wallet;
  if (!wallet) return res.status(400).json({ error: 'Missing wallet' });

  try {
    const rows = await db.all(`SELECT questId FROM completed_quests WHERE wallet = ?`, wallet);
    const ids = rows.map(row => row.questId);
    res.json({ completed: ids });
  } catch (err) {
    console.error('Fetch completed error:', err);
    res.status(500).json({ error: 'Failed to fetch completed quests' });
  }
});

// 📘 Quest journal log
router.get('/journal/:wallet', async (req, res) => {
  const wallet = req.params.wallet;
  if (!wallet) return res.status(400).json({ error: 'Missing wallet' });

  try {
    const journal = await db.all(`
      SELECT q.title, q.xp, c.timestamp
      FROM completed_quests c
      JOIN quests q ON q.id = c.questId
      WHERE c.wallet = ?
      ORDER BY c.timestamp DESC
    `, wallet);

    res.json({ journal });
  } catch (err) {
    console.error('Journal fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch journal' });
  }
});

// 🧠 Complete a quest
router.post('/complete', async (req, res) => {
  const { wallet, questId } = req.body;
  if (!wallet || !questId) return res.status(400).json({ error: 'Missing wallet or questId' });

  try {
    const already = await db.get(`SELECT 1 FROM completed_quests WHERE wallet = ? AND questId = ?`, wallet, questId);
    if (already) return res.status(400).json({ error: 'Quest already completed' });

    const user = await db.get('SELECT * FROM users WHERE wallet = ?', wallet);
    const quest = await db.get('SELECT * FROM quests WHERE id = ?', questId);
    if (!user || !quest) return res.status(404).json({ error: 'User or quest not found' });

    if (quest.requiresTwitter && !user.twitterHandle) {
      return res.status(403).json({ error: 'This quest requires a linked Twitter account.' });
    }

    const tierOrder = { 'Free': 0, 'Tier 1': 1, 'Tier 2': 2, 'Tier 3': 3 };
    const userTier = user.tier || 'Free';
    const required = quest.requiredTier || 'Free';
    if (tierOrder[userTier] < tierOrder[required]) {
      return res.status(403).json({ error: `This quest requires ${required}` });
    }

    const multiplier = {
      'Free': 1.0,
      'Tier 1': 1.2,
      'Tier 2': 1.5,
      'Tier 3': 2.0
    }[userTier];

    const xpGain = Math.round(quest.xp * multiplier);

    await db.run('UPDATE users SET xp = xp + ? WHERE wallet = ?', xpGain, wallet);

    const userData = await db.get('SELECT xp FROM users WHERE wallet = ?', wallet);
    const level = getLevelInfo(userData.xp);

    await db.run(`
      UPDATE users
      SET levelName = ?, levelSymbol = ?, levelProgress = ?, nextXP = ?
      WHERE wallet = ?
    `, level.name, level.symbol, level.progress, level.nextXP, wallet);

    const timestamp = new Date().toISOString();
    await db.run(`
      INSERT INTO completed_quests (wallet, questId, timestamp)
      VALUES (?, ?, ?)
    `, wallet, questId, timestamp);

    const completedCount = await db.get(`
      SELECT COUNT(*) AS count FROM completed_quests WHERE wallet = ?
    `, wallet);

    const ref = await db.get(`
      SELECT * FROM referrals WHERE referred = ? AND completed = 0
    `, wallet);

    if (completedCount.count === 1 && ref) {
      await db.run('UPDATE referrals SET completed = 1 WHERE referred = ?', wallet);
      await db.run('UPDATE users SET xp = xp + 50 WHERE wallet = ?', ref.referrer);

      const refXp = await db.get('SELECT xp FROM users WHERE wallet = ?', ref.referrer);
      const refLevel = getLevelInfo(refXp.xp);

      await db.run(`
        UPDATE users
        SET levelName = ?, levelSymbol = ?, levelProgress = ?, nextXP = ?
        WHERE wallet = ?
      `, refLevel.name, refLevel.symbol, refLevel.progress, refLevel.nextXP, ref.referrer);

      console.log(`✨ Referral XP awarded to ${ref.referrer}`);
    }

    res.json({ message: `+${xpGain} XP gained!`, xpGain });
  } catch (err) {
    console.error('Quest complete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
