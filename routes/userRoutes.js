import express from "express";
import db from "../db.js";

const router = express.Router();

router.get("/users/:wallet", async (req, res) => {
  const wallet = req.params.wallet;
  if (!wallet) return res.status(400).json({ error: "Missing wallet address" });

  try {
    let user = await db.get("SELECT * FROM users WHERE wallet = ?", wallet);

    if (!user) {
      await db.run(
        `INSERT INTO users (wallet, xp, tier, levelName, levelProgress)
         VALUES (?, ?, ?, ?, ?)`,
        wallet, 0, "Free", "Shellborn", 0
      );
      user = await db.get("SELECT * FROM users WHERE wallet = ?", wallet);
    }

    const { xp, tier, twitterHandle, levelName, levelProgress } = user;
    const levels = ["Shellborn", "Wave Seeker", "Tide Whisperer", "Current Binder", "Pearl Bearer", "Isle Champion", "Cowrie Ascendant"];
    const nextXP = [10000, 30000, 60000, 100000, 170000, 250000];
    const levelIndex = levels.indexOf(levelName);
    const next = nextXP[levelIndex] || 100;

    res.json({
      xp,
      tier,
      twitter: twitterHandle || null,
      levelName,
      levelSymbol: "🐚",
      levelProgress: levelProgress || 0,
      nextXP: next
    });
  } catch (err) {
    console.error("Failed to fetch user:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
