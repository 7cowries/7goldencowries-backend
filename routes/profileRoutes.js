// routes/profileRoutes.js
import express from "express";
import db from "../db.js";
import { getLevelInfo } from "../utils/levelUtils.js";

const router = express.Router();

/**
 * GET /api/profile?wallet=...
 * Returns:
 * {
 *   profile: {
 *     wallet, xp, tier,
 *     levelName, levelSymbol, levelProgress, nextXP,
 *     links: { twitter, telegram, discord }
 *   },
 *   history: [{ title, xp, timestamp }]
 * }
 */
router.get("/", async (req, res) => {
  try {
    const wallet = (req.query.wallet || "").trim();
    if (!wallet) return res.status(400).json({ error: "Missing wallet" });

    // 1) User core stats
    let user = await db.get(
      `SELECT wallet, xp, tier, levelName, levelSymbol, levelProgress, nextXP, twitterHandle
         FROM users WHERE wallet = ?`,
      wallet
    );

    // If user doesn’t exist yet, create a minimal row so UI has something sane to show
    if (!user) {
      await db.run(
        `INSERT INTO users (wallet, xp, tier, levelName, levelSymbol, levelProgress, nextXP)
         VALUES (?, 0, 'Free', 'Shellborn', '🐚', 0, 10000)`,
        wallet
      );
      user = await db.get(
        `SELECT wallet, xp, tier, levelName, levelSymbol, levelProgress, nextXP, twitterHandle
           FROM users WHERE wallet = ?`,
        wallet
      );
    }

    // 2) Social links
    const links = await db.get(
      `SELECT twitter, telegram, discord
         FROM social_links WHERE wallet = ?`,
      wallet
    );

    // 3) Compute level info if missing/outdated
    const lvl = getLevelInfo(user.xp ?? 0);
    const levelName   = user.levelName   || lvl.name;
    const levelSymbol = user.levelSymbol || lvl.symbol;
    const levelProgress = typeof user.levelProgress === "number" ? user.levelProgress : lvl.progress;
    const nextXP = typeof user.nextXP === "number" ? user.nextXP : lvl.nextXP;

    // 4) History (most recent first)
    const history = await db.all(
      `SELECT q.title, q.xp, c.timestamp
         FROM completed_quests c
         JOIN quests q ON q.id = c.questId
        WHERE c.wallet = ?
        ORDER BY c.timestamp DESC
        LIMIT 100`,
      wallet
    );

    return res.json({
      profile: {
        wallet: user.wallet,
        xp: user.xp ?? 0,
        tier: user.tier || "Free",
        levelName,
        levelSymbol,
        levelProgress,
        nextXP,
        twitterHandle: user.twitterHandle || null,
        links: {
          twitter: links?.twitter || user.twitterHandle || "",
          telegram: links?.telegram || "",
          discord: links?.discord || "",
        },
      },
      history: history || [],
    });
  } catch (e) {
    console.error("Profile route error:", e);
    res.status(500).json({ error: "Failed to load profile" });
  }
});

export default router;

