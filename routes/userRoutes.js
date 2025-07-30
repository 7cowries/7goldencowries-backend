import express from "express";
import db from "../db.js";

const router = express.Router();

// GET /users/:wallet
router.get("/users/:wallet", (req, res) => {
  const wallet = req.params.wallet;
  if (!wallet) return res.status(400).json({ error: "Missing wallet address" });

  try {
    let user = db.prepare("SELECT * FROM users WHERE wallet = ?").get(wallet);

    if (!user) {
      // 👇 If user doesn't exist, create with default values
      db.prepare(`
        INSERT INTO users (wallet, xp, tier, levelName, levelProgress)
        VALUES (?, ?, ?, ?, ?)
      `).run(wallet, 0, "Free", "Shellborn", 0);

      user = db.prepare("SELECT * FROM users WHERE wallet = ?").get(wallet);
    }

    const { xp, tier, twitterHandle, levelName, levelProgress } = user;
    const nextXP = 100 * Math.pow(
      ["Shellborn","Wave Seeker","Tide Whisperer","Current Binder","Pearl Bearer","Isle Champion","Cowrie Ascendant"].indexOf(levelName) + 1,
      2
    );

    res.json({
      xp,
      tier,
      twitter: twitterHandle || null,
      levelName,
      levelSymbol: "🐚",
      levelProgress: levelProgress || 0,
      nextXP
    });
  } catch (err) {
    console.error("Failed to fetch user:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
