import express from "express";
import db from "../db.js";
import { deriveLevel } from "../config/progression.js";
import { getSessionWallet } from "../utils/session.js";

const router = express.Router();

const DEFAULT_ME = {
  wallet: null,
  xp: 0,
  level: "Shellborn",
  levelName: "Shellborn",
  levelSymbol: "🐚",
  nextXP: 100,
  twitterHandle: null,
  telegramId: null,
  discordId: null,
  subscriptionTier: "Free",
  questHistory: [],
};

/**
 * GET /api/users/me
 * Reads wallet from session; falls back to ?wallet=.
 * Returns basic profile info for current session wallet.
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
      `SELECT wallet, xp, tier, levelName, levelSymbol, nextXP,
              twitterHandle, telegramId, discordId
         FROM users
        WHERE wallet = ?`,
      wallet
    );

    const xp = row?.xp ?? 0;
    const lvl = deriveLevel(xp);
    const levelName = row?.levelName || lvl.levelName || "Shellborn";
    const levelSymbol = row?.levelSymbol || "🐚";
    const nextXP = row?.nextXP ?? lvl.nextNeed ?? 100;
    const subscriptionTier = row?.tier || "Free";

    const history = await fetchHistory(wallet);

    return res.json({
      ...DEFAULT_ME,
      wallet,
      xp,
      level: levelName,
      levelName,
      levelSymbol,
      nextXP,
      twitterHandle: row?.twitterHandle ?? null,
      telegramId: row?.telegramId ?? null,
      discordId: row?.discordId ?? null,
      subscriptionTier,
      questHistory: history,
    });
  } catch (e) {
    console.error("GET /api/users/me error", e);
    return res.status(500).json({ error: "internal" });
  }
});

async function fetchHistory(wallet) {
  try {
    const rows = await db.all(
      `SELECT
          c.rowid AS id,
          c.quest_id AS questId,
          q.title AS title,
          q.xp AS xp,
          c.timestamp AS completed_at
         FROM completed_quests c
         JOIN quests q ON q.id = c.quest_id
        WHERE c.wallet = ?
        ORDER BY c.timestamp DESC
        LIMIT 50`,
      wallet
    );
    if (Array.isArray(rows)) return rows;
  } catch {}
  return [];
}

export default router;
