import { Router } from "express";
import db from "../db.js";

const router = Router();
export const admin = Router(); // (kept for parity; no admin endpoints yet)
const REFERRAL_XP = 1500;

async function ensureTables() {
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
  `);
}

function codeFromWallet(wallet) {
  return Buffer.from(String(wallet)).toString("base64url").slice(0, 12);
}
function walletFromCode(code) {
  try {
    // pad to multiple of 4 for base64url
    const pad = "=".repeat((4 - (code.length % 4)) % 4);
    return Buffer.from(code + pad, "base64url").toString();
  } catch { return null; }
}

async function getOrCreateUserIdFromSession(req) {
  const wallet = req.session?.address;
  if (!wallet) return null;
  let row = await db.get("SELECT id FROM users WHERE wallet=?", wallet);
  if (!row) {
    await db.run("INSERT INTO users (wallet, xp) VALUES (?, 0)", wallet);
    row = await db.get("SELECT id FROM users WHERE wallet=?", wallet);
  }
  return row?.id ?? null;
}

router.get("/my-code", async (req, res) => {
  try {
    await ensureTables();
    const userId = await getOrCreateUserIdFromSession(req);
    if (!userId) return res.status(401).json({ ok:false, error:"not_logged_in" });

    const me = await db.get("SELECT wallet FROM users WHERE id=?", userId);
    const code = codeFromWallet(me.wallet);

    // persist once for uniqueness / visibility
    await db.run("INSERT OR IGNORE INTO referrals (userId, code) VALUES (?,?)", userId, code);
    return res.json({ ok:true, code });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});

router.get("/stats", async (req, res) => {
  try {
    await ensureTables();
    const userId = await getOrCreateUserIdFromSession(req);
    if (!userId) return res.status(401).json({ ok:false, error:"not_logged_in" });

    const total = await db.get("SELECT COUNT(*) AS c FROM referral_claims WHERE referrerId=?", userId);
    const last5 = await db.all("SELECT referredWallet, awardedXP, createdAt FROM referral_claims WHERE referrerId=? ORDER BY id DESC LIMIT 5", userId);
    return res.json({ ok:true, total: total?.c ?? 0, recent: last5 || [] });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});

router.post("/claim", async (req, res) => {
  try {
    await ensureTables();
    const referredWallet = req.session?.address;
    if (!referredWallet) return res.status(401).json({ ok:false, error:"not_logged_in" });

    const { code } = req.body || {};
    if (!code) return res.status(400).json({ ok:false, error:"code_required" });

    const referrerWallet = walletFromCode(String(code));
    if (!referrerWallet) return res.status(400).json({ ok:false, error:"invalid_code" });
    if (referrerWallet === referredWallet) return res.json({ ok:true, already:true });

    // get/create referrer
    let referrer = await db.get("SELECT id FROM users WHERE wallet=?", referrerWallet);
    if (!referrer) {
      await db.run("INSERT INTO users (wallet, xp) VALUES (?,0)", referrerWallet);
      referrer = await db.get("SELECT id FROM users WHERE wallet=?", referrerWallet);
    }

    // idempotent by referredWallet
    const exists = await db.get("SELECT id FROM referral_claims WHERE referredWallet=?", referredWallet);
    if (exists) return res.json({ ok:true, already:true });

    const awarded = REFERRAL_XP; // (multiplier can be added later)
    await db.run("INSERT INTO referral_claims (referrerId, referredWallet, awardedXP) VALUES (?,?,?)",
                 referrer.id, referredWallet, awarded);
    await db.run("UPDATE users SET xp = xp + ? WHERE id=?", awarded, referrer.id);

    return res.json({ ok:true, awarded, referrer: { wallet: referrerWallet } });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});

export default router;
