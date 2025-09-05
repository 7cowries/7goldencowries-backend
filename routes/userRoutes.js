import express from "express";
import db from "../db.js";
import { deriveLevel } from "../config/progression.js";

const router = express.Router();

async function fetchUser(wallet, res) {
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

    const { xp, tier, twitterHandle } = user;
    const lvl = deriveLevel(xp);
    res.json({
      xp,
      tier,
      twitter: twitterHandle || null,
      levelName: lvl.levelName,
      levelProgress: lvl.progress,
      nextXP: lvl.nextNeed,
    });
  } catch (err) {
    console.error("Failed to fetch user:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

router.get("/api/users/:wallet", async (req, res) => {
  const wallet = req.params.wallet;
  await fetchUser(wallet, res);
});

export default router;
