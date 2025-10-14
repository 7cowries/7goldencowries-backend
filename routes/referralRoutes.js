import { Router } from "express";
import db from "../lib/db.js"; // if your db is at ../db.js, server.js already normalizes path

const router = Router();
const REFERRAL_XP = 1500;

function b64url(s){ return Buffer.from(String(s)).toString("base64url"); }
function codeFromWallet(wallet){ return b64url(wallet).slice(0, 12); }

async function columnSet(table){
  try {
    const rows = await db.all(`PRAGMA table_info(${table})`);
    return new Set(rows.map(r => r.name));
  } catch { return new Set(); }
}

async function ensureReferralsSchema(){
  // base tables (create if missing)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER,
      code TEXT,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS referral_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrerId INTEGER,
      referredWallet TEXT,
      awardedXP INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // add missing columns if table existed with legacy shape
  const rcols = await columnSet("referrals");
  if (!rcols.has("userId")) await db.exec(`ALTER TABLE referrals ADD COLUMN userId INTEGER;`);
  if (!rcols.has("code"))   await db.exec(`ALTER TABLE referrals ADD COLUMN code TEXT;`);
  if (!rcols.has("createdAt")) await db.exec(`ALTER TABLE referrals ADD COLUMN createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;`);

  const ccols = await columnSet("referral_claims");
  if (!ccols.has("referrerId"))     await db.exec(`ALTER TABLE referral_claims ADD COLUMN referrerId INTEGER;`);
  if (!ccols.has("referredWallet")) await db.exec(`ALTER TABLE referral_claims ADD COLUMN referredWallet TEXT;`);
  if (!ccols.has("awardedXP"))      await db.exec(`ALTER TABLE referral_claims ADD COLUMN awardedXP INTEGER NOT NULL DEFAULT 0;`);
  if (!ccols.has("createdAt"))      await db.exec(`ALTER TABLE referral_claims ADD COLUMN createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;`);

  // indices/uniques (partial to avoid legacy NULLs exploding)
  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_userId ON referrals(userId) WHERE userId IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_code   ON referrals(code)   WHERE code   IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_refclaims_referred ON referral_claims(referredWallet) WHERE referredWallet IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_refclaims_referrer ON referral_claims(referrerId);
  `);
}

async function getOrCreateCode(userId, wallet){
  const row = await db.get(`SELECT code FROM referrals WHERE userId = ?`, userId);
  if (row?.code) return row.code;

  const code = codeFromWallet(wallet);
  // prefer to fill (userId, code). Use INSERT OR IGNORE then UPDATE fallback.
  await db.run(`INSERT OR IGNORE INTO referrals (userId, code) VALUES (?, ?)`, userId, code);
  const after = await db.get(`SELECT code FROM referrals WHERE userId = ?`, userId);
  if (after?.code) return after.code;

  // last resort: set code where null
  await db.run(`UPDATE referrals SET code = ? WHERE userId = ?`, code, userId);
  const final = await db.get(`SELECT code FROM referrals WHERE userId = ?`, userId);
  return final?.code || code;
}

// GET /api/referrals/my-code
router.get("/my-code", async (req, res) => {
  try{
    if (!req.session?.userId) return res.status(401).json({ ok:false, error:"not_logged_in" });
    await ensureReferralsSchema();
    const userId = req.session.userId;
    const wallet = req.session.address;
    const code = await getOrCreateCode(userId, wallet);
    return res.json({ ok:true, code });
  }catch(e){
    console.error("[referrals/my-code]", e);
    return res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});

// POST /api/referrals/claim  { code }
router.post("/claim", async (req, res) => {
  try{
    if (!req.session?.userId) return res.status(401).json({ ok:false, error:"not_logged_in" });
    await ensureReferralsSchema();

    const referredWallet = String(req.session.address || "").trim();
    if (!referredWallet) return res.status(400).json({ ok:false, error:"wallet-required" });

    const code = String(req.body?.code || "").trim();
    if (!code) return res.status(400).json({ ok:false, error:"code-required" });

    const refRow = await db.get(`SELECT userId FROM referrals WHERE code = ?`, code);
    if (!refRow?.userId) return res.status(400).json({ ok:false, error:"invalid-code" });

    const referrerId = refRow.userId;
    const claimantId = req.session.userId;

    if (referrerId === claimantId) {
      // claiming own code => idempotent "already"
      return res.json({ ok:true, already:true });
    }

    // idempotent by referred wallet
    const existing = await db.get(`SELECT id, awardedXP, createdAt FROM referral_claims WHERE referredWallet = ?`, referredWallet);
    if (existing) {
      return res.json({ ok:true, already:true, claim: existing });
    }

    const award = REFERRAL_XP; // keep simple; multiplier can be added if needed
    await db.run(`INSERT INTO referral_claims (referrerId, referredWallet, awardedXP) VALUES (?,?,?)`,
                 referrerId, referredWallet, award);

    await db.run(`UPDATE users SET xp = COALESCE(xp,0) + ? WHERE id = ?`, award, referrerId);

    return res.json({ ok:true, awarded: award });
  }catch(e){
    console.error("[referrals/claim]", e);
    return res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});

// GET /api/referrals/stats
router.get("/stats", async (req, res) => {
  try{
    if (!req.session?.userId) return res.status(401).json({ ok:false, error:"not_logged_in" });
    await ensureReferralsSchema();
    const referrerId = req.session.userId;

    const agg = await db.get(`
      SELECT COUNT(*) AS total, COALESCE(SUM(awardedXP),0) AS xp
      FROM referral_claims WHERE referrerId = ?
    `, referrerId);

    const recent = await db.all(`
      SELECT referredWallet, awardedXP, createdAt
      FROM referral_claims
      WHERE referrerId = ?
      ORDER BY id DESC LIMIT 20
    `, referrerId);

    return res.json({ ok:true, referrals: { total: agg?.total || 0, xp: agg?.xp || 0, recent: recent || [] } });
  }catch(e){
    console.error("[referrals/stats]", e);
    return res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});

export default router;
