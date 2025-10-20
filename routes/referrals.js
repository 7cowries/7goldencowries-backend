import { Router } from "express";
import db from "../lib/db.js";
import { createHash } from "crypto";

const router = Router();
const XP_REFERRAL_INVITER = Number(process.env.XP_REFERRAL_INVITER || 200);
const XP_REFERRAL_INVITEE = Number(process.env.XP_REFERRAL_INVITEE || 100);

function normalizeAddress(a) {
  const s = String(a || "").trim();
  return s.length ? s : null;
}
function codeForWallet(wallet) {
  return createHash("sha256").update(String(wallet)).digest("hex").slice(0, 10);
}

async function ensureReferralSchema() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users(
      wallet TEXT PRIMARY KEY,
      xp INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS leaderboard_scores(
      address TEXT PRIMARY KEY,
      score   INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS referrals(
      code TEXT PRIMARY KEY,
      inviter_wallet TEXT UNIQUE NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS referral_claims(
      code TEXT NOT NULL,
      inviter_wallet TEXT NOT NULL,
      invitee_wallet TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      PRIMARY KEY(code, invitee_wallet)
    );
  `);
}

async function awardXp(wallet, delta) {
  const addr = normalizeAddress(wallet);
  const inc  = Number.isFinite(+delta) ? +delta : 0;
  if (!addr || inc <= 0) return;

  await db.exec("BEGIN;");
  await db.run(`INSERT OR IGNORE INTO users(wallet, xp) VALUES(?, 0);`, addr);

  const u = await db.get(`SELECT xp FROM users WHERE wallet=?;`, addr);
  if (u) {
    await db.run(`UPDATE users SET xp = xp + ? WHERE wallet = ?;`, inc, addr);
  } else {
    await db.run(`INSERT INTO users(wallet, xp) VALUES(?, ?);`, addr, inc);
  }

  const l = await db.get(`SELECT score FROM leaderboard_scores WHERE address=?;`, addr);
  if (l) {
    await db.run(`UPDATE leaderboard_scores SET score = score + ? WHERE address = ?;`, inc, addr);
  } else {
    await db.run(`INSERT INTO leaderboard_scores(address, score) VALUES(?, ?);`, addr, inc);
  }
  await db.exec("COMMIT;");
}

// GET /api/referrals/me  -> { code, invitedCount }
router.get("/me", async (req, res) => {
  try {
    await ensureReferralSchema();
    const wallet = normalizeAddress(req?.session?.wallet);
    if (!wallet) return res.status(401).json({ ok: false, error: "not_authed" });

    // ensure mapping exists
    const code = codeForWallet(wallet);
    await db.run(`INSERT OR IGNORE INTO referrals(code, inviter_wallet) VALUES(?,?);`, code, wallet);

    const { c: invitedCount } = await db.get(
      `SELECT COUNT(*) AS c FROM referral_claims WHERE inviter_wallet=?;`, wallet
    );

    res.json({ ok: true, code, invitedCount, results: [{ code, invitedCount }] });
  } catch (e) {
    console.error("referrals me error:", e);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// POST /api/referrals/claim  { code }
router.post("/claim", async (req, res) => {
  try {
    await ensureReferralSchema();
    const invitee = normalizeAddress(req?.session?.wallet);
    if (!invitee) return res.status(401).json({ ok: false, error: "not_authed" });

    const code = String((req.body?.code || "")).trim();
    if (!code) return res.status(400).json({ ok: false, error: "bad_request" });

    const row = await db.get(`SELECT inviter_wallet FROM referrals WHERE code=?;`, code);
    if (!row?.inviter_wallet) return res.status(404).json({ ok: false, error: "code_not_found" });

    const inviter = normalizeAddress(row.inviter_wallet);
    if (!inviter || inviter === invitee) return res.status(400).json({ ok: false, error: "invalid_claim" });

    const dup = await db.get(`SELECT 1 FROM referral_claims WHERE code=? AND invitee_wallet=?;`, code, invitee);
    if (dup) return res.json({ ok: true, claimed: false, message: "already_claimed" });

    await db.exec("BEGIN;");
    await db.run(
      `INSERT INTO referral_claims(code, inviter_wallet, invitee_wallet) VALUES(?,?,?);`,
      code, inviter, invitee
    );
    await db.exec("COMMIT;");

    // Award XP to both
    await awardXp(inviter, XP_REFERRAL_INVITER);
    await awardXp(invitee, XP_REFERRAL_INVITEE);

    res.json({
      ok: true,
      claimed: true,
      inviter,
      invitee,
      xp: { inviter: XP_REFERRAL_INVITER, invitee: XP_REFERRAL_INVITEE }
    });
  } catch (e) {
    try { await db.exec("ROLLBACK;"); } catch {}
    console.error("referrals claim error:", e);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
