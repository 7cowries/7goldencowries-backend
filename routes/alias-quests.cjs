const express = require('express');
const router = express.Router();
router.get('/', (_req, res) => res.redirect(307, '/api/quests'));
module.exports = router;
