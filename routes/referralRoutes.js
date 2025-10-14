import { Router } from "express";
import db from "../lib/db.js";

const router = Router();
const REFERRAL_XP = 1500;

async function ensureTables(){
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL UNIQUE,
      xp INTEGER NOT NULL DEFAULT 0
    );
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
    CREATE INDEX IF NOT EXISTS idx_ref_claims_referrer ON referral_claims(referrerId);
  `);
}

function codeFromWallet(wallet){
  return Buffer.from(String(wallet)).toString("base64url").slice(0,12);
}

async function getOrCreateUserIdByWallet(wallet){
  if(!wallet) return null;
  const found = await db.get("SELECT id FROM users WHERE wallet = ?", wallet);
  if(found?.id) return found.id;
  const ins = await db.run("INSERT OR IGNORE INTO users(wallet,xp) VALUES(?,0)", wallet);
  if(ins.lastID) return ins.lastID;
  const again = await db.get("SELECT id FROM users WHERE wallet = ?", wallet);
  return again?.id ?? null;
}

async function tierMultiplier(userId){
  try{
    const tExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='subscriptions'");
    if(tExists){
      const row = await db.get("SELECT tier FROM subscriptions WHERE userId=? ORDER BY id DESC LIMIT 1", userId);
      if(row?.tier === "Tier 3") return 1.5;
      if(row?.tier === "Tier 2") return 1.25;
    }
  }catch(_) {}
  return 1.0;
}

function requireWallet(req, res){
  const w = (req.session?.wallet||req.session?.address);
  if(!w){
    res.status(401).json({ ok:false, error:"not_logged_in" });
    return null;
  }
  return w;
}

/** GET /api/referrals/my-code */
router.get("/my-code", async (req, res) => {
  try{
    const wallet = requireWallet(req,res); if(!wallet) return;
    await ensureTables();
    const userId = await getOrCreateUserIdByWallet(wallet);
    const existing = await db.get("SELECT code FROM referrals WHERE userId=?", userId);
    if(existing?.code) return res.json({ ok:true, code: existing.code });

    let code = codeFromWallet(wallet);
    // ensure uniqueness if collision
    let n = 0;
    while(await db.get("SELECT 1 FROM referrals WHERE code=?", code)){
      code = codeFromWallet(wallet + ":" + (++n));
    }
    await db.run("INSERT INTO referrals(userId,code) VALUES(?,?)", userId, code);
    return res.json({ ok:true, code });
  }catch(e){
    return res.status(500).json({ ok:false, error:e.message });
  }
});

/** GET /api/referrals/stats */
router.get("/stats", async (req,res) => {
  try{
    const wallet = requireWallet(req,res); if(!wallet) return;
    await ensureTables();
    const userId = await getOrCreateUserIdByWallet(wallet);
    const agg = await db.get(
      "SELECT COUNT(*) AS count, COALESCE(SUM(awardedXP),0) AS xp FROM referral_claims WHERE referrerId=?",
      userId
    );
    const recent = await db.all(
      "SELECT referredWallet, awardedXP, createdAt FROM referral_claims WHERE referrerId=? ORDER BY id DESC LIMIT 20",
      userId
    );
    return res.json({ ok:true, referrals: { total:(agg?.count||0), xp:(agg?.xp||0), recent: recent||[] }});
  }catch(e){
    return res.status(500).json({ ok:false, error:e.message });
  }
});

/** POST /api/referrals/claim {code} — idempotent */
router.post("/claim", async (req,res) => {
  try{
    const referredWallet = requireWallet(req,res); if(!referredWallet) return;
    await ensureTables();
    const { code } = req.body || {};
    if(!code) return res.status(400).json({ ok:false, error:"code-required" });

    const ref = await db.get("SELECT userId FROM referrals WHERE code=?", String(code).trim());
    if(!ref?.userId) return res.status(400).json({ ok:false, error:"invalid-code" });

    const referrerId = ref.userId;
    const self = await db.get("SELECT id FROM users WHERE id=? AND wallet=?", referrerId, referredWallet);
    if(self) return res.status(400).json({ ok:false, error:"cannot-self-refer" });

    const existing = await db.get("SELECT id FROM referral_claims WHERE referredWallet=?", referredWallet);
    if(existing?.id){
      return res.json({ ok:true, already:true });
    }

    const mult = await tierMultiplier(referrerId);
    const awarded = Math.round(REFERRAL_XP * mult);

    await db.run("UPDATE users SET xp = xp + ? WHERE id=?", awarded, referrerId);
    await db.run(
      "INSERT INTO referral_claims(referrerId,referredWallet,awardedXP) VALUES(?,?,?)",
      referrerId, referredWallet, awarded
    );
    return res.json({ ok:true, awarded });
  }catch(e){
    return res.status(500).json({ ok:false, error:e.message });
  }
});

export default router;
