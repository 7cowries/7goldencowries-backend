const express = require('express');
const router = express.Router();

// Quests
router.get('/quests', (_req, res) => res.json({ quests: [] }));

// User (both paths are used by the FE)
const me = (_req, res) => res.status(401).json({ error: 'Not authenticated' });
router.get('/me', me);
router.get('/users/me', me);

// Profile
router.get('/profile', (_req, res) => res.json({ xp: 0, level: 'Shellborn' }));

// Payments
router.get('/v1/payments/status', (_req, res) => res.json({ status: 'none' }));

module.exports = router;
