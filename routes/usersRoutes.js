import express from "express";
import db from "../db.js";
import { deriveLevel } from "../config/progression.js";
import { getSessionWallet } from "../utils/session.js";

// Fetch recent quest history for a wallet
async function fetchHistory(wallet) {
  try {
    const rows = await db.all(
      `SELECT id, quest_id AS questId, title, xp, completed_at
         FROM quest_history
        WHERE wallet = ?
        ORDER BY id DESC
        LIMIT 50`,
      wallet
    );
    if (Array.isArray(rows)) return rows;
  } catch {
    /* table may not exist */
  }
  try {
    const rows = await db.all(
      `SELECT c.rowid AS id, c.quest_id AS questId, q.title AS title, q.xp AS xp, c.timestamp AS completed_at
         FROM completed_quests c
         JOIN quests q ON q.id = c.quest_id
        WHERE c.wallet = ?
        ORDER BY c.timestamp DESC
        LIMIT 50`,
      wallet
    );
    if (Array.isArray(rows)) return rows;
  } catch {
    /* ignore */
  }
  return [];
}

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
      `SELECT id, wallet, xp, tier, referral_code, twitterHandle, telegramHandle, telegramId, discordId, discordHandle
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

    const questHistory = await fetchHistory(row.wallet);

    return res.json({
      user: {
        wallet: row.wallet,
        xp,
        levelName: lvl.levelName,
        levelProgress: lvl.progress,
        nextXP: lvl.nextNeed,
        subscriptionTier: row.tier || "Free",
        referral_code: row.referral_code,
        questHistory,
        socials,
      },
    });
  } catch (e) {
    console.error("GET /api/users/me error", e);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
