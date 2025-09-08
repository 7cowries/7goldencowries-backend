import express from "express";
import db from "../db.js";
import { deriveLevel } from "../config/progression.js";
import { getSessionWallet } from "../utils/session.js";

// Fetch recent quest history for a wallet
async function fetchHistory(wallet) {
  try {
    const rows = await db.all(
      `SELECT id, quest_id, title, xp, completed_at
         FROM quest_history
        WHERE wallet = ?
        ORDER BY id DESC
        LIMIT 50`,
      wallet
    );
    if (Array.isArray(rows))
      return rows.map((r) => ({
        questId: r.quest_id,
        title: r.title,
        xp: r.xp,
        completed_at: r.completed_at,
      }));
  } catch {
    /* table may not exist */
  }
  try {
    const rows = await db.all(
      `SELECT c.rowid AS id, c.quest_id, q.title AS title, q.xp AS xp, c.timestamp AS completed_at
         FROM completed_quests c
         JOIN quests q ON q.id = c.quest_id
        WHERE c.wallet = ?
        ORDER BY c.timestamp DESC
        LIMIT 50`,
      wallet
    );
    if (Array.isArray(rows))
      return rows.map((r) => ({
        questId: r.quest_id,
        title: r.title,
        xp: r.xp,
        completed_at: r.completed_at,
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
    if (!wallet) return res.json({ user: null });

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
    const twitterHandle = row.twitterHandle || row.twitter_username || socialsData.twitter?.handle;
    const twitterId = row.twitter_id || socialsData.twitter?.id;
    const telegramHandle = row.telegramHandle || row.telegram_username || socialsData.telegram?.username;
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
      levelName: lvl.levelName,
      levelProgress: progress,
      nextXP: lvl.nextNeed,
      subscriptionTier: row.tier || "Free",
      tier: row.tier || "Free",
      referral_code: row.referral_code,
      questHistory,
      socials,
    };

    if (String(req.query.flat || "") === "1") return res.json(payload);
    return res.json({ user: payload });
  } catch (e) {
    console.error("GET /api/users/me error", e);
    return res.json({ user: null });
  }
});

export default router;
