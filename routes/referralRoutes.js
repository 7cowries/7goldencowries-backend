import { Router } from "express";
import db from "../lib/db.js";

const router = Router();
const REFERRAL_BASE_XP = 1500;

function codeFromWallet(wallet){
  return Buffer.from(String(wallet)).toString("base64url").slice(0,12);
}
function tierMultiplier(tier){
  if (tier === "Tier 3") return 1.5;
  if (tier === "Tier 2") return 1.25;
  return 1.0;
}

async function ensureReferralSchema(){
  await db.exec(`
    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const cols = await db.all(`PRAGMA table_info(referrals)`);
  const hasUserId = cols?.some(c => c.name === "userId");
  if (!hasUserId) await db.exec(`ALTER TABLE referrals ADD COLUMN userId INTEGER;`);
  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_userId ON referrals(userId);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_code   ON referrals(code);
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS referral_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrerId INTEGER NOT NULL,
      referredWallet TEXT NOT NULL UNIQUE,
      awardedXP INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

async function upsertUserReferral(userId){
  const user = await db.get(`SELECT id, wallet, subscriptionTier FROM users WHERE id = ?`, userId);
  if (!user?.wallet) throw new Error("user-wallet-missing");
  const code = codeFromWallet(user.wallet);

  const byCode = await db.get(`SELECT id, userId FROM referrals WHERE code = ?`, code);
  if (byCode){
    if (!byCode.userId) await db.run(`UPDATE referrals SET userId=? WHERE id=?`, userId, byCode.id);
    else if (byCode.userId !== userId) throw new Error("code-owned-by-different-user");
    return { code, user };
  }
  const byUser = await db.get(`SELECT id, code FROM referrals WHERE userId = ?`, userId);
  if (byUser) return { code: byUser.code, user };
  await db.run(`INSERT INTO referrals (userId, code) VALUES (?, ?)`, userId, code);
  return { code, user };
}

router.get("/my-code", async (req, res) => {
  try{
    if (!req.session?.userId) return res.status(401).json({ ok:false, error:"not_logged_in" });
    await ensureReferralSchema();
    const { code } = await upsertUserReferral(req.session.userId);
    return res.json({ ok:true, code });
  }catch(e){
    return res.status(400).json({ ok:false, error: String(e.message || e) });
  }
});

router.post("/claim", async (req, res) => {
  try{
    if (!req.session?.userId) return res.status(401).json({ ok:false, error:"not_logged_in" });
    const { code } = req.body || {};
    if (!code || String(code).length < 6) return res.status(400).json({ ok:false, error:"invalid-code" });

    await ensureReferralSchema();

    const claimant = await db.get(`SELECT id, wallet FROM users WHERE id = ?`, req.session.userId);
    if (!claimant?.wallet) return res.status(400).json({ ok:false, error:"wallet-required" });

    const refRow = await db.get(`
      SELECT r.userId AS referrerId, u.wallet AS referrerWallet, u.subscriptionTier
      FROM referrals r
      JOIN users u ON u.id = r.userId
      WHERE r.code = ?
    `, code);
    if (!refRow?.referrerId) return res.status(400).json({ ok:false, error:"invalid-code" });
    if (refRow.referrerId === claimant.id) return res.status(400).json({ ok:false, error:"self-referral-disallowed" });

    const already = await db.get(`SELECT id FROM referral_claims WHERE referredWallet = ?`, claimant.wallet);
    if (already) return res.json({ ok:true, already:true });

    const mult = tierMultiplier(refRow.subscriptionTier);
    const awarded = Math.round(REFERRAL_BASE_XP * mult);

    await db.run(`UPDATE users SET xp = COALESCE(xp,0) + ? WHERE id = ?`, awarded, refRow.referrerId);
    await db.run(`
      INSERT INTO referral_claims (referrerId, referredWallet, awardedXP)
      VALUES (?, ?, ?)
    `, refRow.referrerId, claimant.wallet, awarded);

    const refUser = await db.get(`SELECT id, wallet, xp, subscriptionTier FROM users WHERE id = ?`, refRow.referrerId);
    return res.json({ ok:true, awarded, referrer: refUser });
  }catch(e){
    return res.status(400).json({ ok:false, error: String(e.message || e) });
  }
});

router.get("/stats", async (req, res) => {
  try{
    if (!req.session?.userId) return res.status(401).json({ ok:false, error:"not_logged_in" });
    await ensureReferralSchema();
    const rows = await db.all(`
      SELECT referredWallet, awardedXP, createdAt
      FROM referral_claims
      WHERE referrerId = ?
      ORDER BY id DESC
      LIMIT 50
    `, req.session.userId);
    const totalXp = rows.reduce((s,r) => s + (r.awardedXP || 0), 0);
    return res.json({ ok:true, referrals:{ total: rows.length, xp: totalXp, recent: rows } });
  }catch(e){
    return res.status(400).json({ ok:false, error: String(e.message || e) });
  }
});

export default router;
