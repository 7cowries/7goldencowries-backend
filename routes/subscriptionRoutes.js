// routes/subscriptionRoutes.js
import express from "express";
import db from "../lib/db.js";

const router = express.Router();

/**
 * Helper: load the current user by session.userId
 */
async function getAuthedUser(req) {
  const uid = req.session?.userId;
  if (!uid) throw new Error("not_logged_in");
  const user = await db.get(
    "SELECT id, wallet, subscriptionTier, tier FROM users WHERE id = ?",
    uid
  );
  if (!user || !user.wallet) throw new Error("user_not_found");
  return user;
}

/**
 * Normalize tier string to canonical labels
 */
function normalizeTier(raw) {
  const t = String(raw || "").trim().toLowerCase();
  if (t === "tier 3" || t === "3" || t === "t3") return "Tier 3";
  if (t === "tier 2" || t === "2" || t === "t2") return "Tier 2";
  if (t === "tier 1" || t === "1" || t === "t1") return "Tier 1";
  if (t === "free" || t === "0") return "Free";
  return "Tier 1";
}

/**
 * POST /subscriptions/subscribe
 * Mounted under /api/subscribe in index.js:
 *   → POST /api/subscribe/subscriptions/subscribe
 *
 * Body: { tier, txHash, tonPaid, usdPaid }
 */
router.post("/subscriptions/subscribe", async (req, res) => {
  try {
    const user = await getAuthedUser(req);
    const { tier, txHash = null, tonPaid = null, usdPaid = null } = req.body || {};
    const finalTier = normalizeTier(tier);

    // Best-effort write into new subscriptions table
    try {
      await db.run(
        `
        INSERT INTO subscriptions (wallet, tier, tonAmount, usdAmount, status, tx_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', ?, datetime('now'), datetime('now'))
      `,
        user.wallet,
        finalTier,
        tonPaid,
        usdPaid,
        txHash
      );
    } catch (subErr) {
      console.warn(
        "subscriptions table write failed (non-fatal):",
        subErr?.message || subErr
      );
    }

    // Canonical: users.subscriptionTier
    try {
      await db.run(
        "UPDATE users SET subscriptionTier = ?, updatedAt = datetime('now') WHERE id = ?",
        finalTier,
        user.id
      );
    } catch (userErr) {
      console.error("Failed to update users.subscriptionTier:", userErr);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }

    return res.json({
      ok: true,
      tier: finalTier,
      wallet: user.wallet,
    });
  } catch (e) {
    const msg = String(e.message || "");
    if (msg.includes("not_logged_in")) {
      return res.status(401).json({ ok: false, error: "not_logged_in" });
    }
    if (msg.includes("user_not_found")) {
      return res.status(404).json({ ok: false, error: "user_not_found" });
    }
    console.error("POST /subscriptions/subscribe error", e);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
