import express from "express";
import db from "../db.js";
import { getLevelInfo } from "../utils/levelUtils.js";

const router = express.Router();

// 📘 GET user by wallet — auto-create if missing
router.get("/users/:wallet", (req, res) => {
  const wallet = req.params.wallet;
  if (!wallet) return res.status(400).json({ error: "Missing wallet address" });

  try {
    let user = db.prepare("SELECT * FROM users WHERE wallet = ?").get(wallet);

    if (!user) {
      db.prepare(`
        INSERT INTO users (wallet, xp, tier, levelName, levelProgress)
        VALUES (?, ?, ?, ?, ?)
      `).run(wallet, 0, "Free", "Shellborn", 0);

      user = db.prepare("SELECT * FROM users WHERE wallet = ?").get(wallet);
    }

    const { xp, tier, twitterHandle, levelName, levelProgress } = user;
    const level = getLevelInfo(xp);

    res.json({
      xp,
      tier,
      twitterHandle: twitterHandle || null,
      levelName: level.name,
      levelSymbol: level.symbol,
      levelProgress: level.progress,
      nextXP: level.nextXP
    });
  } catch (err) {
    console.error("❌ Failed to fetch user:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
