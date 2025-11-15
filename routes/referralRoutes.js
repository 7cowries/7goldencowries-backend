import { Router } from "express";
import db from "../lib/db.js";

const router = Router();
const REFERRAL_BASE_XP = 1500;

function codeFromWallet(wallet) {
  return Buffer.from(String(wallet)).toString("base64url").slice(0, 12);
}
function tierMultiplier(t) {
  if (t === "Tier 3") return 1.5;
  if (t === "Tier 2") return 1.25;
  return 1.0;
}

async function getAuthedUser(session) {
  if (!session?.userId) throw new Error("not_logged_in");
  const u = await db.get(
    `SELECT id, wallet, subscriptionTier FROM users WHERE id=?`,
    session.userId
  );
  if (!u?.wallet) throw new Error("wallet-required");
  return u;
}

async function ensureReferralClaims() {
  // Safe CREATE (no ALTER with non-constant defaults)
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

async function referralsHasColumn(name) {
  const cols = await db.all(`PRAGMA table_info(referrals)`);
  return (cols || []).some((c) => c.name === name);
}

/* ================== Handlers ================== */

async function myCodeHandler(req, res) {
  try {
    const user = await getAuthedUser(req.session);
    const desired = codeFromWallet(user.wallet);

    // Try legacy (referrer=wallet) path first
    const hasReferrer = await referralsHasColumn("referrer");
    const hasUserId = await referralsHasColumn("userId");

    if (hasReferrer) {
      // UPSERT via UPDATE-then-INSERT to avoid ALTER quirks
      const r = await db.run(
        `UPDATE referrals SET code=? WHERE referrer=?`,
        desired,
        user.wallet
      );
      if (!r.changes) {
        try {
          await db.run(
            `INSERT INTO referrals (referrer, code) VALUES (?, ?)`,
            user.wallet,
            desired
          );
        } catch (e) {
          // If race/unique, force update
          await db.run(
            `UPDATE referrals SET code=? WHERE referrer=?`,
            desired,
            user.wallet
          );
        }
      }
      return res.json({ ok: true, code: desired });
    }

    // Fallback to new schema keyed by userId
    if (hasUserId) {
      const r = await db.run(
        `UPDATE referrals SET code=? WHERE userId=?`,
        desired,
        user.id
      );
      if (!r.changes) {
        try {
          await db.run(
            `INSERT INTO referrals (userId, code) VALUES (?, ?)`,
            user.id,
            desired
          );
        } catch (e) {
          await db.run(
            `UPDATE referrals SET code=? WHERE userId=?`,
            desired,
            user.id
          );
        }
      }
      return res.json({ ok: true, code: desired });
    }

    // If table exists but neither column present, create minimal legacy shape
    await db.exec(`
      CREATE TABLE IF NOT EXISTS referrals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer TEXT UNIQUE,
        code TEXT,
        createdAt TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await db.run(
      `INSERT OR IGNORE INTO referrals (referrer, code) VALUES (?, ?)`,
      user.wallet,
      desired
    );
    await db.run(
      `UPDATE referrals SET code=? WHERE referrer=?`,
      desired,
      user.wallet
    );
    return res.json({ ok: true, code: desired });
  } catch (e) {
    return res
      .status(400)
      .json({ ok: false, error: String(e.message || e) });
  }
}

async function claimHandler(req, res) {
  try {
    const claimant = await getAuthedUser(req.session);
    const { code } = req.body || {};
    if (!code || String(code).length < 6)
      return res.status(400).json({ ok: false, error: "invalid-code" });

    await ensureReferralClaims();

    // Prefer legacy mapping: referrals.referrer = users.wallet
    let refRow = null;
    const hasReferrer = await referralsHasColumn("referrer");
    if (hasReferrer) {
      refRow = await db.get(
        `
        SELECT u.id AS referrerId, u.subscriptionTier
        FROM referrals r
        JOIN users u ON u.wallet = r.referrer
        WHERE r.code = ?`,
        code
      );
    } else {
      // fallback to new schema: referrals.userId
      refRow = await db.get(
        `
        SELECT r.userId AS referrerId, u.subscriptionTier
        FROM referrals r
        JOIN users u ON u.id = r.userId
        WHERE r.code = ?`,
        code
      );
    }
    if (!refRow?.referrerId)
      return res.status(400).json({ ok: false, error: "invalid-code" });
    if (refRow.referrerId === claimant.id)
      return res
        .status(400)
        .json({ ok: false, error: "self-referral-disallowed" });

    const dup = await db.get(
      `SELECT id FROM referral_claims WHERE referredWallet=?`,
      claimant.wallet
    );
    if (dup) return res.json({ ok: true, already: true });

    const mult = tierMultiplier(refRow.subscriptionTier);
    const awarded = Math.round(REFERRAL_BASE_XP * mult);

    await db.run(
      `UPDATE users SET xp = COALESCE(xp,0) + ? WHERE id=?`,
      awarded,
      refRow.referrerId
    );
    await db.run(
      `INSERT INTO referral_claims (referrerId, referredWallet, awardedXP)
       VALUES (?, ?, ?)`,
      refRow.referrerId,
      claimant.wallet,
      awarded
    );

    const refUser = await db.get(
      `SELECT id, wallet, xp, subscriptionTier FROM users WHERE id=?`,
      refRow.referrerId
    );
    return res.json({ ok: true, awarded, referrer: refUser });
  } catch (e) {
    return res
      .status(400)
      .json({ ok: false, error: String(e.message || e) });
  }
}

async function statsHandler(req, res) {
  try {
    if (!req.session?.userId)
      return res.status(401).json({ ok: false, error: "not_logged_in" });
    await ensureReferralClaims();
    const rows = await db.all(
      `
      SELECT referredWallet, awardedXP, createdAt
      FROM referral_claims
      WHERE referrerId = ?
      ORDER BY id DESC
      LIMIT 50`,
      req.session.userId
    );
    const xp = (rows || []).reduce((s, r) => s + (r.awardedXP || 0), 0);
    return res.json({
      ok: true,
      referrals: { total: rows?.length || 0, xp, recent: rows || [] },
    });
  } catch (e) {
    return res
      .status(400)
      .json({ ok: false, error: String(e.message || e) });
  }
}

/* ========== Canonical API paths (for current frontend) ========== */

// GET /api/referrals/my-code
router.get("/api/referrals/my-code", myCodeHandler);

// POST /api/referrals/claim
router.post("/api/referrals/claim", claimHandler);

// GET /api/referrals/stats
router.get("/api/referrals/stats", statsHandler);

/* ========== Legacy aliases (older builds / manual testing) ========== */

// Old short routes (kept for safety)
router.get("/my-code", myCodeHandler);
router.post("/claim", claimHandler);
router.get("/stats", statsHandler);

export default router;
