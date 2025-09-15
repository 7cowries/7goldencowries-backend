import express from 'express';
import db from '../lib/db.js';

const router = express.Router();

// ✅ /quests - return correct fields
router.get('/quests', async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM quests');

    const quests = rows.map(row => ({
      id: row.id,
      title: row.title,
      type: row.type,
      url: row.url, // ❗️ No fallback — must match DB column exactly
      xp: row.xp
    }));

    res.json(quests);
  } catch (err) {
    console.error('Error fetching quests:', err);
    res.status(500).json({ error: 'Failed to load quests' });
  }
});

export default router;
