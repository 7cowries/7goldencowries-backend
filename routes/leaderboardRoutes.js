// routes/leaderboardRoutes.js
import express from "express";
import db from "../db.js";

const router = express.Router();

/**
 * GET /leaderboard
 * Response shape the frontend expects:
 * { top: [{ rank, wallet, xp, tier, name, progress, twitter }] }
 */
router.get("/leaderboard", async (_req, res) => {
  try {
    const rows = await db.all(
      `
      SELECT
        u.wallet,
        COALESCE(u.xp, 0)                      AS xp,
        COALESCE(u.tier, 'Free')               AS tier,
        COALESCE(u.levelName, 'Shellborn')     AS levelName,
        COALESCE(u.levelProgress, 0.0)         AS levelProgress, -- 0..1 in DB
        COALESCE(u.nextXP, 10000)              AS nextXP,
        COALESCE(sl.twitter, u.twitterHandle)  AS twitter
      FROM users u
      LEFT JOIN social_links sl ON sl.wallet = u.wallet
      WHERE u.wallet IS NOT NULL
      ORDER BY xp DESC
      LIMIT 50
      `
    );

    const top = (rows || []).map((r, i) => ({
      rank: i + 1,
      wallet: r.wallet,
      xp: r.xp,
      tier: r.tier,
      name: r.levelName,                               // frontend uses .name
      progress: Math.round((r.levelProgress ?? 0) * 100), // percent 0..100
      twitter: r.twitter || null,
    }));

    res.json({ top });
  } catch (err) {
    console.error("Leaderboard error:", err);
    res.status(500).json({ top: [] });
  }
});

export default router;
