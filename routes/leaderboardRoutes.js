import express from "express";
import db from "../lib/db.js";
import { deriveLevel } from "../config/progression.js";

const router = express.Router();

/** GET /leaderboard  -> top 100 users by xp */
router.get("/", async (_req, res) => {
  try {
    const rows = await db.all(
      `SELECT wallet, xp, twitterHandle, levelName, levelSymbol
         FROM users
        WHERE wallet IS NOT NULL
        ORDER BY xp DESC, datetime(updatedAt) DESC
        LIMIT 100`
    );
    const entries = rows.map((r, i) => {
      const lvl = deriveLevel(r?.xp || 0);
      return {
        rank: i + 1,
        wallet: r.wallet,
        xp: lvl.totalXP,
        totalXP: lvl.totalXP,
        progress: lvl.progress,
        levelTier: lvl.levelTier,
        levelName: r.levelName || lvl.levelName,
        levelSymbol: r.levelSymbol || lvl.levelSymbol,
        nextXP: lvl.nextNeed,
        twitterHandle: r.twitterHandle || null,
      };
    });
    return res.json({ ok: true, entries, total: entries.length });
  } catch (e) {
    console.error("GET /leaderboard error", e);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
