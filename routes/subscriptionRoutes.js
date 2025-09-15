import express from "express";
import db from "../lib/db.js";

const router = express.Router();

/**
 * POST /api/subscribe
 * Records a new subscription, adds XP, and updates user tier.
 * Body: { wallet, tier, ton, usd }
 */
router.post("/", (req, res) => {
  const { wallet, tier, ton, usd } = req.body;

  if (!wallet || !tier || !ton || !usd) {
    return res.status(400).json({ error: "Missing fields in subscription." });
  }

  const timestamp = new Date().toISOString();

  // Define XP multiplier per tier
  const boostMap = {
    Free: 1.0,
    "Tier 1": 1.1,
    "Tier 2": 1.25,
    "Tier 3": 1.5,
  };

  const multiplier = boostMap[tier] || 1.0;
  const baseXP = 100;
  const earnedXP = Math.floor(baseXP * multiplier);

  try {
    // Insert new subscription
    db.prepare(`
      INSERT INTO subscriptions (wallet, tier, ton, usd, timestamp, status)
      VALUES (?, ?, ?, ?, ?, 'active')
    `).run(wallet, tier, ton, usd, timestamp);

    // Update user tier and XP
    db.prepare(`
      UPDATE users
      SET tier = ?, xp = COALESCE(xp, 0) + ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE wallet = ?
    `).run(tier, earnedXP, wallet);

    console.log(`✅ ${wallet} subscribed to ${tier} → +${earnedXP} XP`);
    res.json({ success: true, earnedXP });
  } catch (err) {
    console.error("❌ Subscription error:", err);
    res.status(500).json({ error: "Failed to process subscription" });
  }
});

/**
 * GET /api/subscribe
 * Returns all subscription records.
 */
router.get("/", (req, res) => {
  try {
    const subs = db.prepare(`
      SELECT * FROM subscriptions
      ORDER BY timestamp DESC
    `).all();
    res.json(subs);
  } catch (err) {
    console.error("❌ Fetch subscriptions error:", err);
    res.status(500).json({ error: "Failed to fetch subscriptions" });
  }
});

export default router;
