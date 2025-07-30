import express from "express";
import db from "../db.js";

const router = express.Router();

router.post("/", (req, res) => {
  const { wallet, tier, ton, usd } = req.body;

  if (!wallet || !tier || !ton || !usd) {
    return res.status(400).json({ error: "Missing fields in subscription." });
  }

  const timestamp = new Date().toISOString();

  // XP multiplier based on tier
  const boostMap = {
    Free: 1.0,
    "Tier 1": 1.1,
    "Tier 2": 1.25,
    "Tier 3": 1.5,
  };

  const multiplier = boostMap[tier] || 1.0;
  const baseXP = 100;
  const earnedXP = Math.floor(baseXP * multiplier);

  // Insert into subscriptions table
  db.prepare(`
    INSERT INTO subscriptions (wallet, tier, ton, usd, timestamp, status)
    VALUES (?, ?, ?, ?, ?, 'active')
  `).run(wallet, tier, ton, usd, timestamp);

  // Update user's tier and XP
  db.prepare(`
    UPDATE users
    SET tier = ?, xp = xp + ?
    WHERE wallet = ?
  `).run(tier, earnedXP, wallet);

  console.log(`✅ ${wallet} subscribed to ${tier} → +${earnedXP} XP`);
  res.json({ success: true, earnedXP });
});

router.get("/", (req, res) => {
  const subs = db.prepare(`SELECT * FROM subscriptions ORDER BY timestamp DESC`).all();
  res.json(subs);
});

export default router;
