import express from "express";
import db from "../db.js";
import { deriveLevel } from "../config/progression.js";
import { getSessionWallet } from "../utils/session.js";

const router = express.Router();

const DEFAULT_ME = {
  anon: true,
  wallet: null,
  xp: 0,
  level: 1,
  levelSymbol: "Shellborn",
  nextXP: 100,
  subscriptionTier: "Free",
  socials: {
    twitterHandle: null,
    telegramId: null,
    discordId: null,
    discordGuildMember: false,
  },
  referral_code: null,
};

function makeRefCode(id) {
  return (id.toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
}

/**
 * GET /api/users/me
 * Reads wallet from session; falls back to ?wallet=.
 * Returns the same shape as /api/profile?wallet=... so frontend "getMe" works.
 */
router.get("/me", async (req, res) => {
  try {
    const wallet =
      getSessionWallet(req) || (req.query.wallet ? String(req.query.wallet) : null);
    if (!wallet) return res.json({ ...DEFAULT_ME });

    // ensure user row exists
    await db.run(
      `INSERT INTO users (wallet, updatedAt) VALUES (?, CURRENT_TIMESTAMP)
         ON CONFLICT(wallet) DO NOTHING`,
      wallet
    );

    const row = await db.get(
      `SELECT u.id, u.wallet, u.xp, u.tier, u.levelSymbol, u.nextXP,
              u.telegramId, u.discordId, u.discordGuildMember, u.referral_code,
              u.twitterHandle
         FROM users u
        WHERE u.wallet = ?`,
      wallet
    );

    const xp = row?.xp ?? 0;
    const lvl = deriveLevel(xp);
    const level = lvl.levelIndex ?? 1;
    const levelSymbol = row?.levelSymbol ?? "Shellborn";
    const nextXP = row?.nextXP ?? 100;
    const subscriptionTier = row?.tier ?? "Free";
    const socials = {
      twitterHandle: row?.twitterHandle ?? null,
      telegramId: row?.telegramId ?? null,
      discordId: row?.discordId ?? null,
      discordGuildMember: !!row?.discordGuildMember,
    };

    let referral_code = row?.referral_code ?? null;
    if (!referral_code && row?.id) {
      referral_code = makeRefCode(row.id);
      await db.run(
        `UPDATE users SET referral_code=?, updatedAt=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
        [referral_code, row.id],
      );
    }

    return res.json({
      anon: false,
      wallet,
      xp,
      level,
      levelSymbol,
      nextXP,
      subscriptionTier,
      socials,
      referral_code,
    });
  } catch (e) {
    console.error("GET /api/users/me error", e);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
