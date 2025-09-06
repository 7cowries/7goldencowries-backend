import express from "express";
import db from "../db.js";
import { deriveLevel } from "../config/progression.js";
import { getSessionWallet } from "../utils/session.js";

const router = express.Router();

/**
 * GET /api/users/me
 * Reads wallet from session; falls back to ?wallet=.
 * Returns the same shape as /api/profile?wallet=... so frontend "getMe" works.
 */
router.get("/me", async (req, res) => {
  try {
    const wallet =
      getSessionWallet(req) || (req.query.wallet ? String(req.query.wallet) : null);
    if (!wallet) return res.status(400).json({ error: "Missing wallet address" });

    // ensure user row exists
    await db.run(
      `INSERT INTO users (wallet, updatedAt) VALUES (?, CURRENT_TIMESTAMP)
         ON CONFLICT(wallet) DO NOTHING`,
      wallet
    );

    const row = await db.get(
      `SELECT u.wallet, u.xp, u.tier,
              COALESCE(m.label, u.tier, 'Free') AS tierLabel,
              COALESCE(m.multiplier, 1.0) AS multiplier,
              u.telegram_username, u.twitter_username, u.twitter_id,
              u.discord_username, u.discord_id
         FROM users u
         LEFT JOIN tier_multipliers m ON m.tier = u.tier
        WHERE u.wallet = ?`,
      wallet
    );

    const xp = row?.xp || 0;
    const lvl = deriveLevel(xp);
    const socials = {
      telegram: {
        connected: !!row?.telegram_username,
        username: row?.telegram_username || null,
      },
      twitter: {
        connected: !!row?.twitter_username,
        username: row?.twitter_username || null,
        id: row?.twitter_id || null,
      },
      discord: {
        connected: !!row?.discord_username,
        username: row?.discord_username || null,
        id: row?.discord_id || null,
      },
    };

    return res.json({
      wallet,
      xp,
      level: lvl.levelName,
      levelProgress: lvl.progress,
      tier: row?.tier || 'Free',
      tierLabel: row?.tierLabel || (row?.tier || 'Free'),
      multiplier: row?.multiplier ?? 1.0,
      socials,
    });
  } catch (e) {
    console.error("GET /api/users/me error", e);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
