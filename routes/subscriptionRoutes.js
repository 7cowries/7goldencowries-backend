// routes/subscriptionRoutes.js
import express from "express";
import db from "../lib/db.js";
import { getStatus, subscribeToTier, claimBonus } from "../lib/subscriptions.js";

const router = express.Router();

// GET /subscriptions/status
router.get("/subscriptions/status", async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.json({ ok: true, active: false, tier: "Free" });
    }
    const user = await db.get("SELECT subscriptionTier FROM users WHERE id = ?", [userId]);
    const tier = user?.subscriptionTier || "Free";
    res.json({ ok: true, active: tier !== "Free", tier });
  } catch (e) {
    console.error("GET /subscriptions/status error", e);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// POST /subscriptions/subscribe
router.post("/subscriptions/subscribe", async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: "not_logged_in" });
    }
    const { tier = "Tier 1", txHash = null, tonPaid = null, usdPaid = null } = req.body || {};
    const user = await db.get("SELECT wallet FROM users WHERE id = ?", [userId]);
    if (!user) {
      return res.status(404).json({ ok: false, error: "user_not_found" });
    }
    const result = await subscribeToTier({ wallet: user.wallet, tier, txHash, tonPaid, usdPaid });
    res.json({ ok: true, tier: result.tier });
  } catch (e) {
    console.error("POST /subscriptions/subscribe error", e);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// POST /subscriptions/claim-bonus
router.post("/subscriptions/claim-bonus", async (req, res) => {
  try {
    const wallet = req.session?.user?.wallet;
    if (!wallet) {
      return res.status(401).json({ ok: false, error: "not_logged_in" });
    }
    const result = await claimBonus(wallet);
    res.json({ ok: true, bonus: result.bonus });
  } catch (e) {
    console.error("POST /subscriptions/claim-bonus error", e);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
