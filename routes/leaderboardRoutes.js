// routes/leaderboardRoutes.js
import express from "express";
import db from "../db.js";
import { deriveLevel } from "../config/progression.js";

const router = express.Router();

/**
 * GET /api/leaderboard
 * Optional query: ?limit=50&offset=0
 * Response:
 *   { top: [{ rank, wallet, xp, tier, name, progress, twitter }] }
 */
router.get("/", async (req, res) => {
  try {
    // sanitize pagination
    const maxLimit = 100;
    const limit = Math.min(
      maxLimit,
      Math.max(1, parseInt(req.query.limit ?? "50", 10) || 50)
    );
    const offset = Math.max(0, parseInt(req.query.offset ?? "0", 10) || 0);

    const rows = await db.all(
      `
      SELECT
        u.wallet,
        COALESCE(u.xp, 0)                      AS xp,
        COALESCE(u.tier, 'Free')               AS tier,
        COALESCE(sl.twitter, u.twitterHandle)  AS twitter
      FROM users u
      LEFT JOIN social_links sl ON sl.wallet = u.wallet
      WHERE u.wallet IS NOT NULL
      ORDER BY COALESCE(u.xp, 0) DESC, u.wallet ASC
      LIMIT ? OFFSET ?
      `,
      limit,
      offset
    );

    const top = (rows || []).map((r, i) => {
      const lvl = deriveLevel(Number(r.xp ?? 0));
      return {
        rank: offset + i + 1,
        wallet: r.wallet || "",
        xp: Number(r.xp ?? 0),
        tier: r.tier || "Free",
        name: lvl.levelName,
        progress: Math.round(lvl.progress * 100),
        twitter: r.twitter || null,
      };
    });

    res.json({ top });
  } catch (err) {
    console.error("Leaderboard error:", err);
    res.status(500).json({ top: [] });
  }
});

export default router;
