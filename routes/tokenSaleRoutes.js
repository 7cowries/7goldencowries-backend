// routes/tokenSaleRoutes.js
import express from 'express';
import db from '../lib/db.js';

const router = express.Router();

// --- Config (override via env if you like)
const MIN_TON = Number(process.env.TOKEN_SALE_MIN_TON ?? 0.1);
const MAX_TON = Number(process.env.TOKEN_SALE_MAX_TON ?? 10_000);

// --- Schema bootstrap
await db.exec(`
  CREATE TABLE IF NOT EXISTS token_sale_contributions (
    id BIGSERIAL PRIMARY KEY,
    wallet TEXT,                 -- optional: user's wallet (string)
    ton_amount DOUBLE PRECISION NOT NULL, -- TON contributed
    referral_code TEXT,                   -- optional referral code or wallet
    memo TEXT,                            -- optional note from user
    status TEXT DEFAULT 'recorded',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_contrib_createdAt ON token_sale_contributions(created_at);
  CREATE INDEX IF NOT EXISTS idx_contrib_referral ON token_sale_contributions(referral_code);
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
      `INSERT INTO token_sale_contributions (wallet, ton_amount, referral_code, memo, status)
       VALUES (?, ?, ?, ?, ?)`,
      wallet, amountTON, referral, memo, 'recorded'
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
        ROUND(COALESCE(SUM(ton_amount), 0), 4) AS "totalTON",
        ROUND(COALESCE(AVG(ton_amount), 0), 4) AS "avgTON"
      FROM token_sale_contributions
    `);

    const recent = await db.all(
      `SELECT id,
              wallet,
              ton_amount AS "amountTON",
              referral_code AS referral,
              memo,
              created_at AS "createdAt"
       FROM token_sale_contributions
       ORDER BY created_at DESC
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
      `SELECT id,
              wallet,
              ton_amount AS "amountTON",
              referral_code AS referral,
              memo,
              created_at AS "createdAt"
       FROM token_sale_contributions
       ORDER BY created_at DESC
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
