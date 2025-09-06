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
    if (!wallet) return res.json({ anon: true });

    // ensure user row exists
    await db.run(
      `INSERT INTO users (wallet, updatedAt) VALUES (?, CURRENT_TIMESTAMP)
         ON CONFLICT(wallet) DO NOTHING`,
      wallet
    );

    const row = await db.get(
      `SELECT u.wallet, u.xp, u.tier, u.levelSymbol, u.nextXP,
              u.telegramId, u.discordId, u.discordGuildMember, u.referral_code,
              u.twitterHandle
         FROM users u
        WHERE u.wallet = ?`,
      wallet
    );

    const xp = row?.xp || 0;
    const lvl = deriveLevel(xp);
    const socials = {
      twitter: row?.twitterHandle || null,
      telegramId: row?.telegramId || null,
      discordId: row?.discordId || null,
      discordGuildMember: !!row?.discordGuildMember,
    };

    return res.json({
      wallet,
      xp,
      level: lvl.levelName,
      levelSymbol: row?.levelSymbol || '🐚',
      nextXP: lvl.nextNeed,
      subscriptionTier: row?.tier || 'Free',
      socials,
      referral_code: row?.referral_code || null,
    });
  } catch (e) {
    console.error("GET /api/users/me error", e);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
