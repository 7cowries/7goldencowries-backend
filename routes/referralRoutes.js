import { Router } from "express";
import db from "../lib/db.js";

const router = Router();
const REFERRAL_XP = 1500;

function b64url(s){ return Buffer.from(String(s)).toString("base64url"); }
function codeFromWallet(wallet){ return b64url(wallet).slice(0, 12); }

async function tableCols(table){
  try {
    const rows = await db.all(`PRAGMA table_info(${table})`);
    return new Set(rows.map(r => r.name));
  } catch { return new Set(); }
}

async function ensureReferralsSchema(){
  // Create tables if missing (CREATE supports DEFAULT CURRENT_TIMESTAMP safely)
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

  // Add missing columns WITHOUT non-constant defaults, then backfill
  const r = await tableCols("referrals");
  if (!r.has("userId"))   await db.exec(`ALTER TABLE referrals ADD COLUMN userId INTEGER;`);
  if (!r.has("code"))     await db.exec(`ALTER TABLE referrals ADD COLUMN code TEXT;`);
  if (!r.has("createdAt")) {
    await db.exec(`ALTER TABLE referrals ADD COLUMN createdAt TEXT;`);
    await db.exec(`UPDATE referrals SET createdAt = COALESCE(createdAt, CURRENT_TIMESTAMP);`);
  }

  const c = await tableCols("referral_claims");
  if (!c.has("referrerId"))     await db.exec(`ALTER TABLE referral_claims ADD COLUMN referrerId INTEGER;`);
  if (!c.has("referredWallet")) await db.exec(`ALTER TABLE referral_claims ADD COLUMN referredWallet TEXT;`);
  if (!c.has("awardedXP"))      await db.exec(`ALTER TABLE referral_claims ADD COLUMN awardedXP INTEGER NOT NULL DEFAULT 0;`);
  if (!c.has("createdAt")) {
    await db.exec(`ALTER TABLE referral_claims ADD COLUMN createdAt TEXT;`);
    await db.exec(`UPDATE referral_claims SET createdAt = COALESCE(createdAt, CURRENT_TIMESTAMP);`);
  }

  // Indices/uniques (partial where appropriate)
  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_userId ON referrals(userId) WHERE userId IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_code   ON referrals(code)   WHERE code   IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_refclaims_referred ON referral_claims(referredWallet) WHERE referredWallet IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_refclaims_referrer ON referral_claims(referrerId);
  `);
}

async function getOrCreateCode(userId, wallet){
  const existing = await db.get(`SELECT code FROM referrals WHERE userId = ?`, userId);
  if (existing?.code) return existing.code;

  const code = codeFromWallet(wallet);
  // Insert with explicit createdAt to work on legacy tables (no DEFAULT on added column)
  await db.run(
    `INSERT OR IGNORE INTO referrals (userId, code, createdAt) VALUES (?,?,CURRENT_TIMESTAMP)`,
    userId, code
  );
  const after = await db.get(`SELECT code FROM referrals WHERE userId = ?`, userId);
  if (after?.code) return after.code;

  await db.run(`UPDATE referrals SET code = ? WHERE userId = ?`, code, userId);
  const final = await db.get(`SELECT code FROM referrals WHERE userId = ?`, userId);
  return final?.code || code;
}

router.get("/my-code", async (req, res) => {
  try{
    if (!req.session?.userId) return res.status(401).json({ ok:false, error:"not_logged_in" });
    await ensureReferralsSchema();
    const code = await getOrCreateCode(req.session.userId, req.session.address);
    return res.json({ ok:true, code });
  }catch(e){
    console.error("[referrals/my-code]", e);
    return res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});

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

    if (referrerId === claimantId) return res.json({ ok:true, already:true });

    const existing = await db.get(
      `SELECT id, awardedXP, createdAt FROM referral_claims WHERE referredWallet = ?`,
      referredWallet
    );
    if (existing) return res.json({ ok:true, already:true, claim: existing });

    const award = REFERRAL_XP;
    await db.run(
      `INSERT INTO referral_claims (referrerId, referredWallet, awardedXP, createdAt) VALUES (?,?,?,CURRENT_TIMESTAMP)`,
      referrerId, referredWallet, award
    );
    await db.run(`UPDATE users SET xp = COALESCE(xp,0) + ? WHERE id = ?`, award, referrerId);

    return res.json({ ok:true, awarded: award });
  }catch(e){
    console.error("[referrals/claim]", e);
    return res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});

router.get("/stats", async (req, res) => {
  try{
    if (!req.session?.userId) return res.status(401).json({ ok:false, error:"not_logged_in" });
    await ensureReferralsSchema();

    const referrerId = req.session.userId;
    const agg = await db.get(
      `SELECT COUNT(*) AS total, COALESCE(SUM(awardedXP),0) AS xp FROM referral_claims WHERE referrerId = ?`,
      referrerId
    );
    const recent = await db.all(
      `SELECT referredWallet, awardedXP, createdAt FROM referral_claims WHERE referrerId = ? ORDER BY id DESC LIMIT 20`,
      referrerId
    );
    return res.json({ ok:true, referrals: { total: agg?.total || 0, xp: agg?.xp || 0, recent: recent || [] } });
  }catch(e){
    console.error("[referrals/stats]", e);
    return res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});

export default router;
