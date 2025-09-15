// routes/quests.js
import express from 'express';
import db from '../lib/db.js';
import { deriveCategory } from '../utils/quests.js';

const router = express.Router();

// ✅ Get all quests
router.get('/quests', async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM quests ORDER BY id ASC');

    const quests = rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description || '',
      type: row.type || 'link',
      url: row.url || '',
      xp: row.xp || 0,
      active: row.active ?? 1,
      sort: row.sort ?? 0,
      category: deriveCategory(row)
    }));

    res.json(quests);
  } catch (err) {
    console.error('Error fetching quests:', err);
    res.status(500).json({ error: 'Failed to load quests' });
  }
});

export default router;
