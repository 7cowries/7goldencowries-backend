import express from "express";
import db from "../db.js";
import { deriveLevel } from "../config/progression.js";
import { getSessionWallet } from "../utils/session.js";

const router = express.Router();

function makeRefCode(id) {
  return (id.toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
}

/**
 * GET /api/users/me
 * Reads wallet from session; falls back to ?wallet=.
 * Returns basic profile info for current session wallet.
 */
router.get("/me", async (req, res) => {
  try {
    const wallet =
      getSessionWallet(req) || (req.query.wallet ? String(req.query.wallet) : null);
    if (!wallet) return res.json({ user: null });

    await db.run(
      `INSERT INTO users (wallet, updatedAt) VALUES (?, CURRENT_TIMESTAMP)
         ON CONFLICT(wallet) DO NOTHING`,
      wallet
    );

    let row = await db.get(
      `SELECT id, wallet, xp, referral_code, twitterHandle, telegramHandle, telegramId, discordId, discordHandle
         FROM users WHERE wallet = ?`,
      wallet
    );

    if (!row.referral_code) {
      const code = makeRefCode(row.id);
      await db.run(
        `UPDATE users SET referral_code=?, updatedAt=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
        code,
        row.id
      );
      row.referral_code = code;
    }

    const xp = row.xp ?? 0;
    const lvl = deriveLevel(xp);
    const socials = {
      twitter: {
        connected: !!row.twitterHandle,
        ...(row.twitterHandle ? { handle: row.twitterHandle } : {}),
      },
      telegram: {
        connected: !!row.telegramHandle,
        ...(row.telegramHandle ? { username: row.telegramHandle } : {}),
        ...(row.telegramId ? { id: row.telegramId } : {}),
      },
      discord: {
        connected: !!row.discordId,
        ...(row.discordId ? { id: row.discordId } : {}),
      },
    };

    return res.json({
      user: {
        wallet: row.wallet,
        xp,
        level: lvl.levelIndex,
        referral_code: row.referral_code,
        socials,
      },
    });
  } catch (e) {
    console.error("GET /api/users/me error", e);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
