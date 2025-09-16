import express from "express";
import db from "../lib/db.js";
import { deriveLevel } from "../config/progression.js";
import { getCache, setCache } from "../utils/cache.js";

const router = express.Router();
const TTL = 30_000;

async function fetchUser(wallet, res) {
  if (!wallet) return res.status(400).json({ error: "Missing wallet address" });

  const key = `user:${wallet}`;
  const cached = getCache(key);
  if (cached) return res.json(cached);

  try {
    let user = await db.get("SELECT * FROM users WHERE wallet = ?", wallet);

    if (!user) {
      await db.run(
        `INSERT INTO users (wallet, xp, tier, levelName, levelProgress, updatedAt)\n         VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
        wallet, 0, "Free", "Shellborn", 0
      );
      user = await db.get("SELECT * FROM users WHERE wallet = ?", wallet);
    }

    const totalXP = user?.xp ?? 0;
    const { tier, twitterHandle } = user;
    const lvl = deriveLevel(totalXP);
    const data = {
      totalXP,
      xp: Math.max(0, lvl.xpIntoLevel ?? 0),
      nextXP: lvl.nextNeed,
      tier,
      twitter: twitterHandle || null,
      levelName: lvl.levelName,
      levelSymbol: lvl.levelSymbol,
      levelTier: lvl.levelTier,
      levelProgress: Math.max(0, Math.min(1, lvl.progress ?? 0)),
    };
    setCache(key, data, TTL);
    res.json(data);
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
