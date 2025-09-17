import express from "express";
import db from "../lib/db.js";
import { deriveLevel } from "../config/progression.js";
import { getSessionWallet } from "../utils/session.js";

// Fetch recent quest history for a wallet
async function fetchHistory(wallet) {
  try {
    const rows = await db.all(
      `SELECT c.quest_id AS id, q.title, q.xp, c.timestamp AS ts
         FROM completed_quests c
         JOIN quests q ON q.id = c.quest_id
        WHERE c.wallet = ?
        ORDER BY c.timestamp DESC
        LIMIT 50`,
      wallet
    );
    if (Array.isArray(rows))
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        xp: r.xp,
        ts: r.ts,
        status: "claimed",
      }));
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

    if (!wallet) {
      return res.json({
        wallet: null,
        xp: 0,
        level: 1,
        nextXP: 10000,
        levelName: "Shellborn",
        levelSymbol: "🐚",
        levelProgress: 0,
        tier: "Free",
        socials: {
          twitter: { connected: false },
          telegram: { connected: false },
          discord: { connected: false },
        },
        questHistory: [],
      });
    }

    await db.run(
      `INSERT INTO users (wallet, updatedAt) VALUES (?, CURRENT_TIMESTAMP)
         ON CONFLICT(wallet) DO NOTHING`,
      wallet
    );

    let row = await db.get(
      `SELECT id, wallet, xp, tier, referral_code, twitterHandle, twitter_username, twitter_id, telegramHandle, telegram_username, telegramId, discordId, discord_id, discordHandle, discord_username, socials
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
    const rawProgress = lvl.progress > 1 ? lvl.progress / 100 : lvl.progress;
    const progress = Math.max(0, Math.min(1, rawProgress));
    let socialsData = {};
    try {
      socialsData = row.socials ? JSON.parse(row.socials) : {};
    } catch {}
    const twitterHandle =
      row.twitterHandle || row.twitter_username || socialsData.twitter?.handle;
    const twitterId = row.twitter_id || socialsData.twitter?.id;
    const telegramHandle =
      row.telegramHandle || row.telegram_username || socialsData.telegram?.username;
    const telegramId = row.telegramId || socialsData.telegram?.id;
    const discordId = row.discordId || row.discord_id || socialsData.discord?.id;
    const socials = {
      twitter: {
        connected: !!(twitterHandle || twitterId),
        ...(twitterHandle ? { handle: twitterHandle } : {}),
        ...(twitterId ? { id: twitterId } : {}),
      },
      telegram: {
        connected: !!(telegramHandle || telegramId),
        ...(telegramHandle ? { username: telegramHandle } : {}),
        ...(telegramId ? { id: telegramId } : {}),
      },
      discord: {
        connected: !!discordId,
        ...(discordId ? { id: discordId } : {}),
      },
    };

    const questHistory = await fetchHistory(row.wallet);

    const payload = {
      wallet: row.wallet,
      xp,
      level: lvl.level,
      levelName: lvl.levelName,
      levelSymbol: lvl.levelSymbol,
      levelProgress: progress,
      nextXP: lvl.nextNeed,
      tier: row.tier || "Free",
      socials,
      questHistory,
      referral_code: row.referral_code,
      twitterHandle: twitterHandle || null,
      telegramHandle: telegramHandle || null,
      discordId: discordId || null,
    };

    if (String(req.query.flat || "") === "1") return res.json(payload);
    return res.json(payload);
  } catch (e) {
    console.error("GET /api/users/me error", e);
    return res.status(500).json({ error: "Failed to load user" });
  }
});

export default router;
