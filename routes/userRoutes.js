import express from "express";
import db from "../lib/db.js";
import { deriveLevel } from "../config/progression.js";
import { getCache, setCache } from "../utils/cache.js";

const router = express.Router();
const TTL = 30_000;

function parseSocials(raw, user) {
  try {
    const parsed = JSON.parse(raw || "{}") || {};
    const twitterConnected = Boolean(user?.twitterHandle || user?.twitter_username);
    parsed.twitter = parsed.twitter || { connected: twitterConnected };
    if (parsed.twitter && typeof parsed.twitter.connected === "undefined") {
      parsed.twitter.connected = twitterConnected;
    }
    return parsed;
  } catch {
    return { twitter: { connected: Boolean(user?.twitterHandle || user?.twitter_username) } };
  }
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
        totalXP: 0,
        xp: 0,
        nextXP: deriveLevel(0).nextNeed,
        levelTier: "shellborn",
        levelProgress: 0,
        socials: { twitter: { connected: false } },
        referral_code: null,
        questHistory: [],
      });
    }

    let user = await db.get(
      `SELECT wallet, xp, tier, referral_code, socials, twitterHandle, twitter_username, levelName, levelSymbol, levelProgress
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
        `SELECT wallet, xp, tier, referral_code, socials, twitterHandle, twitter_username, levelName, levelSymbol, levelProgress
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

    return res.json({
      wallet,
      totalXP: lvl.totalXP,
      xp: lvl.xpIntoLevel,
      nextXP: lvl.nextNeed,
      levelTier: lvl.levelTier,
      levelName: lvl.levelName,
      levelSymbol: lvl.levelSymbol,
      levelProgress: lvl.progress,
      referral_code: user?.referral_code || null,
      socials,
      questHistory,
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
