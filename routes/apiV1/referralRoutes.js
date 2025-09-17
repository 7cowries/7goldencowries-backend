import express from "express";
import rateLimit from "express-rate-limit";
import db from "../../lib/db.js";
import { getSessionWallet } from "../../utils/session.js";
import { grantXP } from "../../lib/grantXP.js";
import { crossSiteCookieOptions } from "../../utils/cookies.js";

const router = express.Router();
const REFERRAL_BONUS_QUEST_PREFIX = "REFERRAL_BONUS:";
const claimLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

function normalizeCode(code) {
  if (!code) return null;
  const trimmed = String(code).trim();
  const re = /^[A-Z0-9_-]{4,64}$/i;
  return re.test(trimmed) ? trimmed : null;
}

router.post("/claim", claimLimiter, async (req, res) => {
  try {
    const wallet = getSessionWallet(req);
    if (!wallet) {
      return res.status(401).json({ error: "wallet_required" });
    }

    const rawCode =
      req.cookies?.referral_code ||
      req.session?.referral_code ||
      null;
    const code = normalizeCode(rawCode);
    if (!code) {
      if (req.session?.referralClaimed) {
        return res.json({ ok: true, xpDelta: 0 });
      }
      return res.status(400).json({ error: "referral_code_missing" });
    }

    const referrer = await db.get(
      "SELECT wallet FROM users WHERE referral_code = ?",
      code
    );
    if (!referrer?.wallet) {
      res.clearCookie("referral_code", crossSiteCookieOptions());
      req.session.referral_code = null;
      return res.status(404).json({ error: "referrer_not_found" });
    }

    if (referrer.wallet === wallet) {
      res.clearCookie("referral_code", crossSiteCookieOptions());
      req.session.referral_code = null;
      return res.status(400).json({ error: "self_referral" });
    }

    await db.run(
      `UPDATE users SET referred_by = COALESCE(referred_by, ?), updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE wallet = ?`,
      referrer.wallet,
      wallet
    );

    const questId = `${REFERRAL_BONUS_QUEST_PREFIX}${referrer.wallet}:${wallet}`;
    const inserted = await db.run(
      `INSERT OR IGNORE INTO completed_quests (wallet, quest_id, timestamp)
         VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      referrer.wallet,
      questId
    );

    res.clearCookie("referral_code", crossSiteCookieOptions());
    req.session.referral_code = null;

    if (inserted.changes === 0) {
      req.session.referralClaimed = true;
      return res.json({ ok: true, xpDelta: 0 });
    }

    const result = await grantXP({ wallet: referrer.wallet }, 50);
    req.session.referralClaimed = true;
    return res.json({ ok: true, xpDelta: result.delta ?? 50 });
  } catch (err) {
    console.error("referral claim error", err);
    return res.status(500).json({ error: "claim_failed" });
  }
});

export default router;
