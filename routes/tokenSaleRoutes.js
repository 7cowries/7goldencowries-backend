// routes/tokenSaleRoutes.js
import express from 'express';
import db from '../lib/db.js';

const router = express.Router();

// --- Config (override via env if you like)
const MIN_TON = Number(process.env.TOKEN_SALE_MIN_TON ?? 0.1);
const MAX_TON = Number(process.env.TOKEN_SALE_MAX_TON ?? 10_000);

// --- Schema bootstrap
await db.exec(`
  CREATE TABLE IF NOT EXISTS contributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet TEXT,                 -- optional: user's wallet (string)
    amountTON REAL NOT NULL,     -- TON contributed
    referral TEXT,               -- optional referral code or wallet
    memo TEXT,                   -- optional note from user
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_contrib_createdAt ON contributions(createdAt);
  CREATE INDEX IF NOT EXISTS idx_contrib_referral ON contributions(referral);
`);

// --- Helpers
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

// --- POST /token-sale/contribute
router.post('/token-sale/contribute', async (req, res) => {
  try {
    let { amountTON, referral, memo, wallet } = req.body ?? {};

    // Accept strings from forms and coerce
    amountTON = typeof amountTON === 'string' ? Number(amountTON) : amountTON;

    if (!isNumber(amountTON) || amountTON <= 0) {
      return res.status(400).json({ error: 'Invalid amountTON' });
    }
    if (amountTON < MIN_TON) {
      return res.status(400).json({ error: `Minimum contribution is ${MIN_TON} TON` });
    }
    if (amountTON > MAX_TON) {
      return res.status(400).json({ error: `Maximum contribution is ${MAX_TON} TON` });
    }

    // Normalize short strings
    referral = referral?.toString().trim() || null;
    memo = memo?.toString().trim() || null;
    wallet = wallet?.toString().trim() || null;

    const result = await db.run(
      `INSERT INTO contributions (wallet, amountTON, referral, memo)
       VALUES (?, ?, ?, ?)`,
      wallet, amountTON, referral, memo
    );

    return res.json({
      ok: true,
      id: result?.lastID,
      recorded: { wallet, amountTON, referral, memo }
    });
  } catch (e) {
    console.error('contribute error:', e);
    return res.status(500).json({ error: 'Failed to record contribution' });
  }
});

// --- GET /token-sale/stats
// Aggregate totals for UI widgets
router.get('/token-sale/stats', async (_req, res) => {
  try {
    const row = await db.get(`
      SELECT
        COUNT(*)            AS contributions,
        ROUND(COALESCE(SUM(amountTON), 0), 4) AS totalTON,
        ROUND(COALESCE(AVG(amountTON), 0), 4) AS avgTON
      FROM contributions
    `);

    const recent = await db.all(
      `SELECT id, wallet, amountTON, referral, memo, createdAt
       FROM contributions
       ORDER BY datetime(createdAt) DESC
       LIMIT 10`
    );

    return res.json({ ...row, recent });
  } catch (e) {
    console.error('stats error:', e);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// --- GET /token-sale/contributions (optional: simple list, paginated-ish)
router.get('/token-sale/contributions', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const rows = await db.all(
      `SELECT id, wallet, amountTON, referral, memo, createdAt
       FROM contributions
       ORDER BY datetime(createdAt) DESC
       LIMIT ?`,
      limit
    );
    return res.json({ items: rows });
  } catch (e) {
    console.error('list error:', e);
    return res.status(500).json({ error: 'Failed to fetch contributions' });
  }
});

export default router;
