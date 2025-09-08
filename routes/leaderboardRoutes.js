// routes/leaderboardRoutes.js
import express from "express";
import db from "../db.js";
import { deriveLevel } from "../config/progression.js";
import { getCache, setCache } from "../utils/cache.js";

const router = express.Router();

/**
 * GET /api/leaderboard
 * Optional query: ?limit=50&offset=0
 * Response:
 *   {
 *     entries: [
 *       {
 *         rank,
 *         wallet,
 *         xp,
 *         twitterHandle,
 *         levelName,
 *         progress,
 *       },
 *     ],
 *     total: number,
 *   }
 */
router.get("/", async (req, res) => {
  try {
    const cached = getCache("leaderboard");
    if (cached) return res.json(cached);

    const maxLimit = 100;
    const limit = Math.min(
      maxLimit,
      Math.max(1, parseInt(req.query.limit ?? "50", 10) || 50)
    );
    const offset = Math.max(0, parseInt(req.query.offset ?? "0", 10) || 0);

    const rows = await db.all(
      `SELECT u.wallet, COALESCE(u.xp,0) AS xp, u.twitterHandle, u.tier
         FROM users u
        WHERE u.wallet IS NOT NULL
        ORDER BY COALESCE(u.xp,0) DESC, u.wallet ASC
        LIMIT ? OFFSET ?`,
      limit,
      offset
    );

    const totalRow = await db.get(
      `SELECT COUNT(*) AS c FROM users WHERE wallet IS NOT NULL`
    );
    const entries = (rows || []).map((r, i) => {
      const lvl = deriveLevel(r.xp || 0);
      return {
        wallet: r.wallet || "",
        xp: Number(r.xp ?? 0),
        twitterHandle: r.twitterHandle || undefined,
        levelName: lvl.levelName,
        progress: Math.min(1, Math.max(0, lvl.progress)),
        rank: offset + i + 1,
        tier: r.tier || undefined,
      };
    });

    const data = { entries, total: totalRow?.c ?? 0 };
    setCache("leaderboard", data, 60000);
    res.json(data);
  } catch (err) {
    console.error("Leaderboard error:", err);
    res.status(500).json({ entries: [], total: 0 });
  }
});

export default router;
