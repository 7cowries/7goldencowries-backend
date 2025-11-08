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

function baseSocials() {
  return {
    twitter: { connected: false },
    telegram: { connected: false },
    discord: { connected: false },
  };
}

function defaultPayload() {
  return {
    wallet: null,
    authed: false,
    totalXP: 0,
    xp: 0,
    nextXP: 10000,
    levelName: "Shellborn",
    levelSymbol: "🐚",
    levelTier: "shellborn",
    levelProgress: 0,
    tier: "Free",
    socials: baseSocials(),
    referralCount: 0,
    questHistory: [],
  };
}

async function fetchReferralCount(wallet) {
  let count = 0;
  if (!wallet) return count;
  try {
    const row = await db.get(
      "SELECT COUNT(*) AS c FROM referrals WHERE referrer = ?",
      wallet
    );
    if (row?.c) count = Math.max(count, Number(row.c) || 0);
  } catch {}
  try {
    const row = await db.get(
      "SELECT COUNT(*) AS c FROM referrals WHERE referrer_user_id = (SELECT id FROM users WHERE wallet = ?)",
      wallet
    );
    if (row?.c) count = Math.max(count, Number(row.c) || 0);
  } catch {}
  return count;
}

/**
 * GET /api/users/me
 * Reads wallet from session; falls back to ?wallet=.
 * Returns basic profile info for current session wallet.
 */
async function referralsTableHasColumn(db, name) {
  try {
    const cols = await db.all('PRAGMA table_info(referrals)');
    return Array.isArray(cols) && cols.some(c => c.name === name);
  } catch (e) { return false; }
}

async function countReferralsForWallet(db, wallet) {
  // Prefer new schema (referrer_user_id -> users.id)
  const hasReferrerUserId = await referralsTableHasColumn(db, 'referrer_user_id');
  if (hasReferrerUserId) {
    const row = await db.get(
      "SELECT COUNT(*) AS c FROM referrals WHERE referrer_user_id = (SELECT id FROM users WHERE wallet = ?)",
      wallet
    );
    return row?.c || 0;
  }

  // Legacy fallback: referrals.referrer stores referrer WALLET directly
  const hasLegacyReferrer = await referralsTableHasColumn(db, 'referrer');
  if (hasLegacyReferrer) {
    const row = await db.get(
      "SELECT COUNT(*) AS c FROM referrals WHERE referrer = ?",
      wallet
    );
    return row?.c || 0;
  }

  // No recognizable schema -> 0
  return 0;
}

router.get("/me", async (req, res) => {
  try {
    const sessionWallet = getSessionWallet(req);
    const queryWallet = req.query.wallet ? String(req.query.wallet).trim() : "";
    const wallet = sessionWallet || (queryWallet ? queryWallet : null);

    if (!wallet) {
      return res.json(defaultPayload());
    }

    await db.run(
      `INSERT INTO users (wallet, updatedAt) VALUES (?, CURRENT_TIMESTAMP)
         ON CONFLICT(wallet) DO NOTHING`,
      wallet
    );

    let row = await db.get(
      `SELECT id, wallet, xp, tier, referral_code, referred_by, socials,
              twitterHandle, twitter_username, twitter_id,
              telegramHandle, telegram_username, telegramId,
              discordId, discord_id, discordHandle, discord_username
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

    const xpTotal = row.xp ?? 0;
    const lvl = deriveLevel(xpTotal);
    const rawProgress = lvl.progress > 1 ? lvl.progress / 100 : lvl.progress;
    const progress = Math.max(0, Math.min(1, rawProgress));
    const xpIntoLevel = Math.max(0, lvl.xpIntoLevel ?? 0);
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
    const socials = baseSocials();
    if (twitterHandle || twitterId) {
      socials.twitter = {
        connected: true,
        ...(twitterHandle ? { handle: twitterHandle } : {}),
        ...(twitterId ? { id: twitterId } : {}),
      };
    }
    if (telegramHandle || telegramId) {
      socials.telegram = {
        connected: true,
        ...(telegramHandle ? { username: telegramHandle } : {}),
        ...(telegramId ? { id: telegramId } : {}),
      };
    }
    if (discordId) {
      socials.discord = {
        connected: true,
        id: discordId,
      };
    }

    const questHistory = await fetchHistory(row.wallet);
    const referralCount = await fetchReferralCount(row.wallet);
    const authed =
      typeof sessionWallet === "string" &&
      sessionWallet.toLowerCase() === String(row.wallet || "").toLowerCase();

    const payload = {
      wallet: row.wallet,
      authed,
      totalXP: lvl.totalXP,
      xp: xpIntoLevel,
      nextXP: lvl.nextNeed,
      levelName: lvl.levelName,
      levelSymbol: lvl.levelSymbol,
      levelTier: lvl.levelTier,
      levelProgress: progress,
      tier: row.tier || "Free",
      socials,
      referralCount,
      questHistory,
      referral_code: row.referral_code,
      referred_by: row.referred_by || null,
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
