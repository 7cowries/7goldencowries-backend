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

async function detectReferralsMode(){
  await db.exec(`
    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer TEXT,
      userId INTEGER,
      code TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const cols = await db.all(`PRAGMA table_info(referrals)`);
  const names = (cols||[]).map(c => c.name);
  const hasReferrer = names.includes("referrer");
  const hasUserId   = names.includes("userId");
  if (!names.includes("code")) await db.exec(`ALTER TABLE referrals ADD COLUMN code TEXT;`);
  await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_code ON referrals(code);`);
  if (hasReferrer) await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer);`);
  if (hasUserId)   await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_userId   ON referrals(userId);`);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS referral_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrerId INTEGER NOT NULL,
      referredWallet TEXT NOT NULL UNIQUE,
      awardedXP INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return { hasReferrer, hasUserId };
}

async function getAuthedUser(session){
  const u = await db.get(`SELECT id, wallet, subscriptionTier FROM users WHERE id = ?`, session.userId);
  if (!u?.wallet) throw new Error("wallet-required");
  return u;
}

router.get("/my-code", async (req, res) => {
  try{
    if (!req.session?.userId) return res.status(401).json({ ok:false, error:"not_logged_in" });
    const mode = await detectReferralsMode();
    const user = await getAuthedUser(req.session);
    const desired = codeFromWallet(user.wallet);

    if (mode.hasReferrer) {
      // Legacy schema: key is wallet in `referrer`
      await db.run(
        `INSERT INTO referrals (referrer, code)
         VALUES (?, ?)
         ON CONFLICT(referrer) DO UPDATE SET code=excluded.code`,
        user.wallet, desired
      );
    } else {
      // New schema: key is numeric `userId`
      await db.run(
        `INSERT INTO referrals (userId, code)
         VALUES (?, ?)
         ON CONFLICT(userId) DO UPDATE SET code=excluded.code`,
        user.id, desired
      );
    }
    return res.json({ ok:true, code: desired });
  }catch(e){
    return res.status(400).json({ ok:false, error:String(e.message||e) });
  }
});

router.post("/claim", async (req, res) => {
  try{
    if (!req.session?.userId) return res.status(401).json({ ok:false, error:"not_logged_in" });
    const { code } = req.body || {};
    if (!code || String(code).length < 6) return res.status(400).json({ ok:false, error:"invalid-code" });

    const mode = await detectReferralsMode();
    const claimant = await getAuthedUser(req.session);

    let refRow;
    if (mode.hasReferrer) {
      refRow = await db.get(`
        SELECT u.id AS referrerId, u.subscriptionTier
        FROM referrals r
        JOIN users u ON u.wallet = r.referrer
        WHERE r.code = ?`, code);
    } else {
      refRow = await db.get(`
        SELECT r.userId AS referrerId, u.subscriptionTier
        FROM referrals r
        JOIN users u ON u.id = r.userId
        WHERE r.code = ?`, code);
    }
    if (!refRow?.referrerId) return res.status(400).json({ ok:false, error:"invalid-code" });
    if (refRow.referrerId === claimant.id) return res.status(400).json({ ok:false, error:"self-referral-disallowed" });

    const dup = await db.get(`SELECT id FROM referral_claims WHERE referredWallet = ?`, claimant.wallet);
    if (dup) return res.json({ ok:true, already:true });

    const mult = tierMultiplier(refRow.subscriptionTier);
    const awarded = Math.round(REFERRAL_BASE_XP * mult);

    await db.run(`UPDATE users SET xp = COALESCE(xp,0) + ? WHERE id = ?`, awarded, refRow.referrerId);
    await db.run(`INSERT INTO referral_claims (referrerId, referredWallet, awardedXP) VALUES (?, ?, ?)`,
      refRow.referrerId, claimant.wallet, awarded);

    const refUser = await db.get(`SELECT id, wallet, xp, subscriptionTier FROM users WHERE id = ?`, refRow.referrerId);
    return res.json({ ok:true, awarded, referrer: refUser });
  }catch(e){
    return res.status(400).json({ ok:false, error:String(e.message||e) });
  }
});

router.get("/stats", async (req, res) => {
  try{
    if (!req.session?.userId) return res.status(401).json({ ok:false, error:"not_logged_in" });
    const rows = await db.all(`
      SELECT referredWallet, awardedXP, createdAt
      FROM referral_claims
      WHERE referrerId = ?
      ORDER BY id DESC
      LIMIT 50`, req.session.userId);
    const totalXp = (rows||[]).reduce((s,r)=>s+(r.awardedXP||0),0);
    return res.json({ ok:true, referrals:{ total: rows?.length||0, xp: totalXp, recent: rows||[] } });
  }catch(e){
    return res.status(400).json({ ok:false, error:String(e.message||e) });
  }
});

export default router;
