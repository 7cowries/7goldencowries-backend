import { Router } from "express";
import db from "../db.js";

const router = Router();
const REFERRAL_XP = 1500;

async function ensureTables(){
  await db.exec(`
    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS referral_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrerId INTEGER NOT NULL,
      referredWallet TEXT NOT NULL UNIQUE,
      awardedXP INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function codeFromWallet(wallet){
  return Buffer.from(wallet).toString("base64url").slice(0,12);
}

router.get("/my-code", async (req, res) => {
  try{
    if (!req.session?.userId || !req.session?.wallet){
      return res.status(401).json({ ok:false, error:"not_logged_in" });
    }
    await ensureTables();
    const code = codeFromWallet(req.session.wallet);
    await db.run(
      "INSERT OR IGNORE INTO referrals(userId, code) VALUES (?, ?)",
      req.session.userId, code
    );
    return res.json({ ok:true, code });
  }catch(e){ return res.status(500).json({ ok:false, error:e.message }); }
});

router.get("/stats", async (req, res) => {
  try{
    if (!req.session?.userId) return res.status(401).json({ ok:false, error:"not_logged_in" });
    await ensureTables();
    const total = await db.get("SELECT COUNT(*) as c FROM referral_claims WHERE referrerId=?", req.session.userId);
    const sum = await db.get("SELECT COALESCE(SUM(awardedXP),0) as xp FROM referral_claims WHERE referrerId=?", req.session.userId);
    return res.json({ ok:true, referrals: total?.c ?? 0, xpAwarded: sum?.xp ?? 0 });
  }catch(e){ return res.status(500).json({ ok:false, error:e.message }); }
});

router.post("/claim", async (req, res) => {
  try{
    if (!req.session?.wallet) return res.status(401).json({ ok:false, error:"not_logged_in" });
    await ensureTables();
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ ok:false, error:"code-required" });

    const ref = await db.get("SELECT * FROM referrals WHERE code=?", code);
    if (!ref) return res.status(400).json({ ok:false, error:"invalid-code" });

    const me = req.session.wallet;
    const refUser = await db.get("SELECT id,wallet,subscriptionTier,xp FROM users WHERE id=?", ref.userId);
    if (!refUser || refUser.wallet === me) return res.status(400).json({ ok:false, error:"not-allowed" });

    const existing = await db.get("SELECT id FROM referral_claims WHERE referredWallet=?", me);
    if (existing) return res.json({ ok:true, already:true });

    const t = (refUser.subscriptionTier || "").toLowerCase();
    const mult = t.includes("tier 3") ? 1.5 : t.includes("tier 2") ? 1.25 : 1.0;
    const awarded = Math.round(REFERRAL_XP * mult);

    await db.run("UPDATE users SET xp = xp + ? WHERE id=?", awarded, ref.userId);
    await db.run("INSERT INTO referral_claims(referrerId,referredWallet,awardedXP) VALUES (?,?,?)", ref.userId, me, awarded);

    const updated = await db.get("SELECT id,wallet,xp FROM users WHERE id=?", ref.userId);
    return res.json({ ok:true, awarded, referrer:{ id: ref.userId, wallet: updated?.wallet, xp: updated?.xp } });
  }catch(e){ return res.status(500).json({ ok:false, error:e.message }); }
});

export default router;
