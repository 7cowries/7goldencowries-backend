// routes/profileRoutes.js
import express from "express";
import db from "../db.js";
import { deriveLevel } from "../config/progression.js";

const router = express.Router();

/* ---------------------------- helpers ---------------------------- */

/** Normalize/trim the wallet string so inserts & queries match */
function normalizeWallet(w) {
  return String(w || "").trim();
}

/** Resolve wallet from several places (query/param/header/cookie/body) */
function resolveWallet(req) {
  const w =
    (req.params && (req.params.wallet || req.params.address)) ||
    (req.query && (req.query.wallet || req.query.address)) ||
    req.get("x-wallet") ||
    (req.cookies && (req.cookies.wallet || req.cookies.address)) ||
    (req.body && (req.body.wallet || req.body.address)) ||
    "";
  return normalizeWallet(w);
}

/** Ensure there is a users row so the UI always has sane defaults */
async function ensureUserRow(wallet) {
  if (!wallet) return;
  const row = await db.get("SELECT wallet FROM users WHERE wallet = ?", wallet);
  if (!row) {
    await db.run(
      `INSERT INTO users (wallet, xp, tier, levelName, levelSymbol, levelProgress, nextXP, updatedAt)
       VALUES (?, 0, 'Free', 'Shellborn', '🐚', 0, 10000, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      wallet
    );
  }
}

/** Get recent history; prefer quest_history, else fall back to completed_quests+quests */
async function fetchHistory(wallet) {
  // Preferred: quest_history (if present)
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
    // table may not exist; ignore
  }

  // Fallback: join completed_quests with quests
  try {
    const rows = await db.all(
      `SELECT
          c.rowid AS id,               -- use rowid to be schema-safe
          c.quest_id AS questId,
          q.title AS title,
          q.xp     AS xp,
          c.timestamp AS completed_at
         FROM completed_quests c
         JOIN quests q ON q.id = c.quest_id
        WHERE c.wallet = ?
        ORDER BY c.timestamp DESC
        LIMIT 50`,
      wallet
    );
    if (Array.isArray(rows)) return rows;
  } catch {
    // also optional
  }

  return [];
}

/** Build the full profile payload (core stats + socials + history) */
async function buildProfile(wallet) {
  await ensureUserRow(wallet);

  // Join users with social_links so we always return latest socials
  const u = await db.get(
    `
    SELECT
      u.wallet,
      u.xp, u.tier, u.levelName, u.levelSymbol, u.levelProgress, u.nextXP,
      u.twitterHandle, u.telegramHandle, u.discordHandle, u.discordGuildMember,
      sl.twitter  AS linkTwitter,
      sl.telegram AS linkTelegram,
      sl.discord  AS linkDiscord
    FROM users u
    LEFT JOIN social_links sl ON sl.wallet = u.wallet
    WHERE u.wallet = ?
    `,
    wallet
  );

  // Compute level info/fallbacks
  const lvl = deriveLevel(u?.xp ?? 0);
  const levelName     = lvl.levelName;
  const levelProgress = lvl.progress;
  const nextXP        = lvl.nextNeed;

  // Merge links: prefer social_links table, then users.*Handle
  const links = {
    twitter:  u?.linkTwitter  || u?.twitterHandle  || null,
    telegram: u?.linkTelegram || u?.telegramHandle || null,
    discord:  u?.linkDiscord  || u?.discordHandle  || null,
  };

  const history = await fetchHistory(wallet);

  return {
    profile: {
      wallet: u?.wallet || wallet,
      xp: u?.xp ?? 0,
      tier: u?.tier || "Free",
      levelName,
      levelProgress,
      nextXP,
      twitterHandle:  u?.twitterHandle  || null,
      telegramHandle: u?.telegramHandle || null,
      discordHandle:  u?.discordHandle  || null,
      discordGuildMember: !!(u?.discordGuildMember),
      links,
    },
    history,
  };
}

/* ----------------------------- routes ----------------------------- */

/** GET /api/profile?wallet=...  (query/header/body/cookie accepted) */
router.get("/", async (req, res) => {
  try {
    const wallet = resolveWallet(req);
    if (!wallet) {
      return res.status(400).json({
        error: "Missing wallet",
        hint: "Provide ?wallet=ADDRESS, or send 'x-wallet' header, or use /api/profile/:wallet",
      });
    }
    const data = await buildProfile(wallet);
    const p = data.profile;
    res.json({
      wallet: p.wallet,
      levelName: p.levelName,
      xp: p.xp,
      levelProgress: p.levelProgress,
      tier: p.tier,
      twitterHandle: p.twitterHandle || undefined,
    });
  } catch (e) {
    console.error("Profile route error:", e);
    // Typo fixed: previously used non-existent `njson`,
    // which would throw and prevent a proper error response.
    // Use `json` to send the 500 error payload correctly so
    // clients like the profile page can handle failures.
    res.status(500).json({ error: "Failed to load profile" });
  }
});

/** GET /api/profile/:wallet  (path variant) */
router.get("/:wallet", async (req, res) => {
  try {
    const wallet = resolveWallet(req);
    if (!wallet) return res.status(400).json({ error: "Missing wallet" });
    const data = await buildProfile(wallet);
    const p = data.profile;
    res.json({
      wallet: p.wallet,
      levelName: p.levelName,
      xp: p.xp,
      levelProgress: p.levelProgress,
      tier: p.tier,
      twitterHandle: p.twitterHandle || undefined,
    });
  } catch (e) {
    console.error("Profile route error:", e);
    res.status(500).json({ error: "Failed to load profile" });
  }
});

/** Optional debug helper to inspect what’s stored */
router.get("/_debug/links", async (req, res) => {
  const wallet = resolveWallet(req);
  if (!wallet) return res.status(400).json({ error: "Missing wallet" });
  try {
    const sl = await db.get(
      "SELECT wallet,twitter,telegram,discord,updated_at FROM social_links WHERE wallet = ?",
      wallet
    );
    const u = await db.get(
      "SELECT wallet,twitterHandle,telegramHandle,discordHandle,discordGuildMember FROM users WHERE wallet = ?",
      wallet
    );
    res.json({ social_links: sl || null, users: u || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
