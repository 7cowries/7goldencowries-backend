import express from "express";
import db from "../lib/db.js";
import { deriveLevel } from "../config/progression.js";
import { getCache, setCache } from "../utils/cache.js";

const router = express.Router();
const TTL = 30_000;

async function referralsTableHasColumn(name) {
  try {
    const cols = await db.all("PRAGMA table_info(referrals)");
    return Array.isArray(cols) && cols.some((c) => c.name === name);
  } catch {
    return false;
  }
}

async function countReferralsForWallet(wallet) {
  let count = 0;
  if (!wallet) return count;

  try {
    const hasReferrerUserId = await referralsTableHasColumn("referrer_user_id");
    if (hasReferrerUserId) {
      const row = await db.get(
        "SELECT COUNT(*) AS c FROM referrals WHERE referrer_user_id = (SELECT id FROM users WHERE wallet = ?)",
        wallet
      );
      count = Math.max(count, Number(row?.c || 0));
    }
  } catch {}

  try {
    const hasLegacyReferrer = await referralsTableHasColumn("referrer");
    if (hasLegacyReferrer) {
      const row = await db.get(
        "SELECT COUNT(*) AS c FROM referrals WHERE referrer = ?",
        wallet
      );
      count = Math.max(count, Number(row?.c || 0));
    }
  } catch {}

  return count;
}

function parseSocials(raw, user) {
  let parsed = {};
  try {
    parsed = JSON.parse(raw || "{}") || {};
  } catch {
    parsed = {};
  }

  const twitterHandle = user?.twitterHandle || user?.twitter_username;
  const twitterId = user?.twitter_id || null;
  const telegramHandle = user?.telegramHandle || user?.telegram_username;
  const telegramId = user?.telegramId || null;
  const discordHandle = user?.discordHandle || user?.discord_username || null;
  const discordId = user?.discordId || user?.discord_id || null;
  const discordGuildMember = user?.discordGuildMember;

  const socials = {
    twitter: {
      connected:
        (parsed.twitter && typeof parsed.twitter.connected !== "undefined"
          ? parsed.twitter.connected
          : Boolean(twitterHandle || twitterId)),
      ...parsed.twitter,
      ...(parsed.twitter?.handle ? {} : twitterHandle ? { handle: twitterHandle } : {}),
      ...(parsed.twitter?.id ? {} : twitterId ? { id: twitterId } : {}),
    },
    telegram: {
      connected:
        (parsed.telegram && typeof parsed.telegram.connected !== "undefined"
          ? parsed.telegram.connected
          : Boolean(telegramHandle || telegramId)),
      ...parsed.telegram,
      ...(parsed.telegram?.username
        ? {}
        : telegramHandle
        ? { username: telegramHandle }
        : {}),
      ...(parsed.telegram?.id ? {} : telegramId ? { id: telegramId } : {}),
    },
    discord: {
      connected:
        (parsed.discord && typeof parsed.discord.connected !== "undefined"
          ? parsed.discord.connected
          : Boolean(discordId || discordHandle)),
      ...parsed.discord,
      ...(parsed.discord?.handle ? {} : discordHandle ? { handle: discordHandle } : {}),
      ...(parsed.discord?.id ? {} : discordId ? { id: discordId } : {}),
      ...(parsed.discord?.guildMember
        ? {}
        : typeof discordGuildMember !== "undefined"
        ? { guildMember: Boolean(discordGuildMember) }
        : {}),
    },
  };

  return socials;
}

async function fetchUser(wallet, res) {
  if (!wallet) return res.status(400).json({ error: "Missing wallet address" });

  const key = `user:${wallet}`;
  const cached = getCache(key);
  if (cached) return res.json(cached);

  try {
    let user = await db.get("SELECT * FROM users WHERE wallet = ?", wallet);

    if (!user) {
      await db.run(
        `INSERT INTO users (wallet, xp, tier, levelName, levelProgress, updatedAt)\n         VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
        wallet, 0, "Free", "Shellborn", 0
      );
      user = await db.get("SELECT * FROM users WHERE wallet = ?", wallet);
    }

    const totalXP = user?.xp ?? 0;
    const { tier, twitterHandle } = user;
    const lvl = deriveLevel(totalXP);
    const data = {
      totalXP,
      xp: Math.max(0, lvl.xpIntoLevel ?? 0),
      nextXP: lvl.nextNeed,
      tier,
      twitter: twitterHandle || null,
      levelName: lvl.levelName,
      levelSymbol: lvl.levelSymbol,
      levelTier: lvl.levelTier,
      levelProgress: Math.max(0, Math.min(1, lvl.progress ?? 0)),
    };
    setCache(key, data, TTL);
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch user:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

router.get("/api/users/me", async (req, res) => {
  try {
    const wallet = String(req.query.wallet || req.session?.wallet || "").trim();
    if (!wallet) {
      return res.json({
        wallet: null,
        authed: false,
        totalXP: 0,
        xp: 0,
        nextXP: deriveLevel(0).nextNeed,
        levelTier: "shellborn",
        levelName: "Shellborn",
        levelSymbol: "🐚",
        levelProgress: 0,
        tier: "Free",
        socials: { twitter: { connected: false } },
        referralCount: 0,
        referral_code: null,
        questHistory: [],
        twitterHandle: null,
        telegramHandle: null,
        discordId: null,
      });
    }

    let user = await db.get(
      `SELECT wallet, xp, tier, referral_code, socials, twitterHandle, twitter_username, twitter_id,
              telegramHandle, telegram_username, telegramId,
              discordId, discord_id, discordHandle, discord_username, discordGuildMember,
              levelName, levelSymbol, levelProgress
         FROM users WHERE wallet = ?`,
      wallet
    );

    if (!user) {
      await db.run(
        `INSERT INTO users (wallet, xp, tier, referral_code, socials, levelName, levelSymbol, levelProgress, nextXP, updatedAt)
         VALUES (?, 0, 'Free', NULL, '{}', 'Shellborn', '🐚', 0, 10000, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
        wallet
      );
      user = await db.get(
        `SELECT wallet, xp, tier, referral_code, socials, twitterHandle, twitter_username, twitter_id,
                telegramHandle, telegram_username, telegramId,
                discordId, discord_id, discordHandle, discord_username, discordGuildMember,
                levelName, levelSymbol, levelProgress
           FROM users WHERE wallet = ?`,
        wallet
      );
    }

    const lvl = deriveLevel(user?.xp || 0);
    const socials = parseSocials(user?.socials, user);
    const history = await db.all(
      `SELECT id, quest_id, title, xp, completed_at FROM quest_history WHERE wallet = ? ORDER BY datetime(completed_at) DESC`,
      wallet
    );
    const questHistory = history.map((h) => ({
      id: h.id,
      questId: h.quest_id,
      title: h.title,
      xp: h.xp,
      ts: h.completed_at,
      status: "completed",
    }));

    const referralCount = await countReferralsForWallet(wallet);

    const authed =
      typeof req.session?.wallet === "string" &&
      req.session.wallet.toLowerCase() === wallet.toLowerCase();

    return res.json({
      wallet,
      authed,
      totalXP: lvl.totalXP,
      xp: lvl.xpIntoLevel,
      nextXP: lvl.nextNeed,
      levelTier: lvl.levelTier,
      levelName: lvl.levelName,
      levelSymbol: lvl.levelSymbol,
      levelProgress: lvl.progress,
      tier: user?.tier || "Free",
      referral_code: user?.referral_code || null,
      referralCount,
      socials,
      questHistory,
      twitterHandle: user?.twitterHandle || user?.twitter_username || null,
      telegramHandle: user?.telegramHandle || user?.telegram_username || null,
      discordId: user?.discordId || user?.discord_id || null,
    });
  } catch (err) {
    console.error("/api/users/me error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

router.get("/api/users/:wallet", async (req, res) => {
  if (req.params.wallet === "me") return res.redirect(307, "/api/users/me");
  const wallet = req.params.wallet;
  await fetchUser(wallet, res);
});

export default router;
