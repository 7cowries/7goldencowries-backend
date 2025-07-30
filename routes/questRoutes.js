import express from 'express';
import db from '../db.js';
import { getLevelInfo } from '../utils/levelUtils.js';

const router = express.Router();

// 📜 Get all quests
router.get('/quests', (req, res) => {
  try {
    const quests = db.prepare(`SELECT * FROM quests ORDER BY id`).all();
    res.json(quests);
  } catch (err) {
    console.error('Failed to fetch quests:', err);
    res.status(500).json({ error: 'Failed to load quests' });
  }
});

// ✅ Return completed quest IDs
router.get('/completed/:wallet', (req, res) => {
  const wallet = req.params.wallet;
  if (!wallet) return res.status(400).json({ error: 'Missing wallet' });

  try {
    const rows = db.prepare(`SELECT questId FROM completed_quests WHERE wallet = ?`).all(wallet);
    const ids = rows.map(row => row.questId);
    res.json({ completed: ids });
  } catch (err) {
    console.error('Fetch completed error:', err);
    res.status(500).json({ error: 'Failed to fetch completed quests' });
  }
});

// 📘 Quest journal log
router.get('/journal/:wallet', (req, res) => {
  const wallet = req.params.wallet;
  if (!wallet) return res.status(400).json({ error: 'Missing wallet' });

  try {
    const journal = db.prepare(`
      SELECT q.title, q.xp, c.timestamp
      FROM completed_quests c
      JOIN quests q ON q.id = c.questId
      WHERE c.wallet = ?
      ORDER BY c.timestamp DESC
    `).all(wallet);

    res.json({ journal });
  } catch (err) {
    console.error('Journal fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch journal' });
  }
});

// 🧠 Complete a quest
router.post('/complete', (req, res) => {
  const { wallet, questId } = req.body;
  if (!wallet || !questId) return res.status(400).json({ error: 'Missing wallet or questId' });

  try {
    const already = db.prepare(`SELECT 1 FROM completed_quests WHERE wallet = ? AND questId = ?`).get(wallet, questId);
    if (already) return res.status(400).json({ error: 'Quest already completed' });

    const user = db.prepare('SELECT * FROM users WHERE wallet = ?').get(wallet);
    const quest = db.prepare('SELECT * FROM quests WHERE id = ?').get(questId);
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

    // ✅ Add XP
    db.prepare('UPDATE users SET xp = xp + ? WHERE wallet = ?').run(xpGain, wallet);

    // 🧠 Re-fetch user XP and update level
    const { xp } = db.prepare('SELECT xp FROM users WHERE wallet = ?').get(wallet);
    const level = getLevelInfo(xp);

    db.prepare(`
      UPDATE users
      SET levelName = ?, levelSymbol = ?, levelProgress = ?, nextXP = ?
      WHERE wallet = ?
    `).run(level.name, level.symbol, level.levelProgress, level.nextXP, wallet);

    // 📘 Insert completed quest
    const timestamp = new Date().toISOString();
    db.prepare(`
      INSERT INTO completed_quests (wallet, questId, timestamp)
      VALUES (?, ?, ?)
    `).run(wallet, questId, timestamp);

    // ✅ Auto-claim referral if first quest
    const completedCount = db.prepare(`
      SELECT COUNT(*) AS count FROM completed_quests WHERE wallet = ?
    `).get(wallet).count;

    const ref = db.prepare(`
      SELECT * FROM referrals WHERE referred = ? AND completed = 0
    `).get(wallet);

    if (completedCount === 1 && ref) {
      db.prepare('UPDATE referrals SET completed = 1 WHERE referred = ?').run(wallet);
      db.prepare('UPDATE users SET xp = xp + 50 WHERE wallet = ?').run(ref.referrer);

      const refXp = db.prepare('SELECT xp FROM users WHERE wallet = ?').get(ref.referrer).xp;
      const refLevel = getLevelInfo(refXp);

      db.prepare(`
        UPDATE users
        SET levelName = ?, levelSymbol = ?, levelProgress = ?, nextXP = ?
        WHERE wallet = ?
      `).run(refLevel.name, refLevel.symbol, refLevel.levelProgress, refLevel.nextXP, ref.referrer);

      console.log(`✨ Referral XP awarded to ${ref.referrer}`);
    }

    res.json({ message: `+${xpGain} XP gained!`, xpGain });
  } catch (err) {
    console.error('Quest complete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
