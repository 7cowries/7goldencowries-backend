// routes/authRoutes.js (Backend) — FINAL
// Twitter/X + Discord auth. Telegram handled in routes/telegramRoutes.js

import express from "express";
import passport from "passport";
import db from "../db.js";

const router = express.Router();

const CLIENT_URL =
  process.env.CLIENT_URL ||
  process.env.FRONTEND_URL ||
  "https://www.7goldencowries.com"; // production default

/* ----------------------------- helpers ----------------------------- */

/** Accept state as base64 or plain text wallet */
function parseWalletFromState(state) {
  if (!state) return null;
  try {
    const decoded = Buffer.from(state, "base64").toString("utf-8");
    if (decoded && decoded.length >= 10) return decoded;
  } catch {}
  return state; // fallback: treat as raw wallet
}

/** Ensure user exists (for first-time linkers/reads) */
async function ensureUser(wallet, extra = {}) {
  if (!wallet) return;
  const row = await db.get("SELECT wallet FROM users WHERE wallet = ?", wallet);
  if (!row) {
    await db.run(
      `INSERT INTO users (
         wallet, xp, tier, levelName, levelSymbol, levelProgress, nextXP,
         twitterHandle, telegramId, telegramHandle,
         discordId, discordHandle, discordGuildMember,
         updatedAt
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      wallet,
      extra.xp ?? 0,
      extra.tier ?? "Free",
      extra.levelName ?? "Shellborn",
      extra.levelSymbol ?? "🐚",
      extra.levelProgress ?? 0,
      extra.nextXP ?? 10000,
      extra.twitterHandle ?? null,
      extra.telegramId ?? null,
      extra.telegramHandle ?? null,
      extra.discordId ?? null,
      extra.discordHandle ?? null,
      extra.discordGuildMember ?? 0
    );
  }
}

/* ------------------------- TWITTER (X) ------------------------- */

// Start Twitter OAuth — store wallet state (base64 or raw)
router.get("/auth/twitter", (req, res, next) => {
  const incoming = req.query.state;
  if (!incoming) return res.status(400).send("Missing wallet state");
  req.session.state = incoming;
  req.session.save((err) => {
    if (err) return res.status(500).send("Session save failed");
    passport.authenticate("twitter")(req, res, next);
  });
});

// Twitter callback — link wallet → twitter handle
router.get("/auth/twitter/callback", (req, res, next) => {
  passport.authenticate("twitter", { failureRedirect: "/" }, (err, user) => {
    if (err || !user) {
      console.error("❌ Twitter Auth Failed:", err);
      return res.redirect("/");
    }
    req.logIn(user, async (err2) => {
      if (err2) {
        console.error("❌ Login error after Twitter auth:", err2);
        return res.redirect("/");
      }
      try {
        const twitterHandle = req.user?.username;
        const wallet =
          parseWalletFromState(req.query.state) ||
          parseWalletFromState(req.session?.state) ||
          parseWalletFromState(req.query.wallet);

        if (!wallet || !twitterHandle) {
          return res.status(400).send("Missing wallet or Twitter handle");
        }

        await ensureUser(wallet, { twitterHandle });
        await db.run(
          `UPDATE users SET twitterHandle = ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE wallet = ?`,
          twitterHandle,
          wallet
        );
        await db.run(
          `INSERT INTO social_links (wallet, twitter) VALUES (?, ?)
           ON CONFLICT(wallet) DO UPDATE SET twitter = excluded.twitter`,
          [wallet, twitterHandle]
        );

        req.session.state = null;
        if (req.session.save) req.session.save(() => {});
        return res.redirect(`${CLIENT_URL}/profile?linked=twitter`);
      } catch (e) {
        console.error("❌ Twitter callback error:", e);
        return res
          .status(500)
          .send("Internal server error during Twitter linking");
      }
    });
  })(req, res, next);
});

// Manual twitter linking fallback
router.post("/link-twitter", async (req, res) => {
  const { wallet, twitter } = req.body || {};
  if (!wallet || !twitter)
    return res.status(400).json({ error: "Missing wallet or twitter" });
  try {
    await ensureUser(wallet, { twitterHandle: twitter });
    await db.run(
      `UPDATE users SET twitterHandle = ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE wallet = ?`,
      twitter,
      wallet
    );
    await db.run(
      `INSERT INTO social_links (wallet, twitter) VALUES (?, ?)
       ON CONFLICT(wallet) DO UPDATE SET twitter = excluded.twitter`,
      [wallet, twitter]
    );
    res.json({ message: "Twitter handle linked" });
  } catch (e) {
    console.error("❌ Link Twitter error:", e);
    res.status(500).json({ error: "Database error" });
  }
});

/* ------------------------- TELEGRAM (alias only) ------------------------- */
/** Safe alias so /auth/telegram → /auth/telegram/start.
 *  Real Telegram logic lives in routes/telegramRoutes.js
 */
router.get("/auth/telegram", (req, res) => {
  const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  return res.redirect(302, `/auth/telegram/start${qs}`);
});

/* ------------------------- DISCORD ------------------------- */

const DISCORD_SCOPES = process.env.DISCORD_SCOPES || "identify guilds";
const DISCORD_REDIRECT =
  process.env.DISCORD_REDIRECT_URI ||
  process.env.DISCORD_REDIRECT ||
  "https://sevengoldencowries-backend.onrender.com/auth/discord/callback";

// Frontend helper: return OAuth URL
router.get("/api/discord/login", (req, res) => {
  const cid = process.env.DISCORD_CLIENT_ID;
  if (!cid || !DISCORD_REDIRECT) {
    return res.status(500).json({ error: "Discord env vars not set" });
  }
  const state = String(req.query.state || "");
  const url =
    `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(
      cid
    )}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT)}` +
    `&scope=${encodeURIComponent(DISCORD_SCOPES)}` +
    (state ? `&state=${encodeURIComponent(state)}` : "");
  res.json({ url });
});

router.get("/auth/discord", (req, res) => {
  const incoming = req.query.state;
  if (!incoming) return res.status(400).send("Missing wallet state");
  req.session.state = incoming;

  const cid = process.env.DISCORD_CLIENT_ID;
  if (!cid || !DISCORD_REDIRECT)
    return res.status(500).send("Discord env vars not set");

  const url =
    `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(
      cid
    )}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT)}` +
    `&scope=${encodeURIComponent(DISCORD_SCOPES)}` +
    `&state=${encodeURIComponent(incoming)}`;
  res.redirect(url);
});

router.get("/auth/discord/callback", async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send("Missing code");

    const wallet =
      parseWalletFromState(req.query.state) ||
      parseWalletFromState(req.session?.state) ||
      parseWalletFromState(req.query.wallet);
    if (!wallet) return res.status(400).send("Missing wallet state");

    const cid = process.env.DISCORD_CLIENT_ID;
    const secret = process.env.DISCORD_CLIENT_SECRET;
    if (!cid || !secret || !DISCORD_REDIRECT) {
      return res.status(500).send("Discord env vars not set");
    }

    // 1) token
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cid,
        client_secret: secret,
        grant_type: "authorization_code",
        code,
        redirect_uri: DISCORD_REDIRECT,
      }),
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error("Discord token error:", body);
      return res.status(502).send("Discord token exchange failed");
    }
    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;
    const refreshToken = tokenJson.refresh_token || null;
    const expiresIn = Number(tokenJson.expires_in || 0);
    const tokenExpiresAt =
      Math.floor(Date.now() / 1000) +
      (Number.isFinite(expiresIn) ? expiresIn : 0);

    // 2) me
    const meRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!meRes.ok) {
      const body = await meRes.text();
      console.error("Discord /@me error:", body);
      return res.status(502).send("Discord user fetch failed");
    }
    const me = await meRes.json();
    const discordId = me.id ? String(me.id) : null;
    const display =
      me.global_name ||
      (me.username &&
      me.discriminator &&
      me.discriminator !== "0"
        ? `${me.username}#${me.discriminator}`
        : me.username) ||
      "discord-user";

    // 3) guild membership (if scope allows)
    let isMember = false;
    const guildId = process.env.DISCORD_GUILD_ID;
    if (guildId && DISCORD_SCOPES.split(/\s+/).includes("guilds")) {
      const guildsRes = await fetch("https://discord.com/api/users/@me/guilds", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (guildsRes.ok) {
        const guilds = await guildsRes.json();
        isMember =
          Array.isArray(guilds) &&
          guilds.some((g) => String(g.id) === String(guildId));
      } else {
        const body = await guildsRes.text();
        console.error("Discord guilds fetch error:", body);
      }
    }

    // 4) persist
    await ensureUser(wallet, {
      discordId,
      discordHandle: display,
      discordGuildMember: isMember ? 1 : 0,
    });
    await db.run(
      `UPDATE users
         SET discordId = ?, discordHandle = ?, discordAccessToken = ?, discordRefreshToken = ?, discordTokenExpiresAt = ?, discordGuildMember = ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE wallet = ?`,
      discordId,
      display,
      accessToken,
      refreshToken,
      tokenExpiresAt,
      isMember ? 1 : 0,
      wallet
    );
    await db.run(
      `INSERT INTO social_links (wallet, discord) VALUES (?, ?)
       ON CONFLICT(wallet) DO UPDATE SET discord = excluded.discord`,
      [wallet, display]
    );

    req.session.state = null;
    if (req.session.save) req.session.save(() => {});
    const redirectUrl = isMember
      ? `${CLIENT_URL}/profile?linked=discord&guildMember=true`
      : `${CLIENT_URL}/profile?linked=discord&guildMember=false`;
    return res.redirect(redirectUrl);
  } catch (e) {
    console.error("❌ Discord callback error:", e);
    res.status(500).send("Discord link failed");
  }
});

/* ------------------------- DEV QUEST HELPER ------------------------- */
// Disable on prod unless you explicitly enable it
const DEV_COMPLETE_ENABLED = process.env.DEV_COMPLETE_ENABLED === "1";

router.post("/api/quest/complete", async (req, res) => {
  if (!DEV_COMPLETE_ENABLED) {
    return res.status(403).json({ error: "Disabled on this deployment" });
  }
  const wallet = req.body?.wallet;
  const questId = req.body?.questId ?? req.body?.quest_id;
  const { title, xp } = req.body || {};
  if (!wallet || !questId || xp == null) {
    return res.status(400).json({ error: "Missing wallet, questId, or xp" });
  }
  try {
    const xpInt = Math.max(0, Math.min(100000, Number(xp) || 0));

    await ensureUser(wallet);
    const user = await db.get("SELECT xp FROM users WHERE wallet = ?", wallet);
    const newXp = (user?.xp || 0) + xpInt;
    const progress = Math.max(0, Math.min(1, newXp / 10000));

    await db.run(
      "UPDATE users SET xp = COALESCE(?,0), levelProgress = ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE wallet = ?",
      newXp,
      progress,
      wallet
    );
    await db.run(
      "INSERT INTO quest_history (wallet, quest_id, title, xp) VALUES (?, ?, ?, ?)",
      wallet,
      questId,
      title || `Quest ${questId}`,
      xpInt
    );
    await db.run(
      "INSERT OR IGNORE INTO completed_quests (wallet, quest_id, timestamp) VALUES (?, ?, ?)",
      wallet,
      questId,
      new Date().toISOString()
    );
    res.json({ message: `Quest ${questId} completed, ${xpInt} XP added` });
  } catch (err) {
    console.error("Quest completion error:", err);
    res.status(500).json({ error: "Failed to complete quest" });
  }
});

/* ------------------------- TIER/UTILITY ------------------------- */

router.post("/assign-tier", async (req, res) => {
  const { wallet, tier } = req.body || {};
  if (!wallet || !tier)
    return res.status(400).json({ error: "Missing wallet or tier" });
  try {
    await ensureUser(wallet);
    await db.run(
      `UPDATE users SET tier = ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE wallet = ?`,
      tier,
      wallet
    );
    res.json({ message: `Tier '${tier}' assigned to ${wallet}` });
  } catch (err) {
    console.error("❌ Assign tier error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/set-subscription", async (req, res) => {
  const { wallet, tier } = req.body || {};
  if (!wallet || !tier)
    return res.status(400).json({ error: "Missing wallet or tier" });
  try {
    const row = await db.get("SELECT * FROM users WHERE wallet = ?", wallet);
    if (!row) return res.status(404).json({ error: "User not found" });
    await db.run(
      `UPDATE users SET tier = ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE wallet = ?`,
      tier,
      wallet
    );
    res.json({ message: `Subscription updated to ${tier}` });
  } catch (err) {
    console.error("❌ Subscription update error:", err);
    res.status(500).json({ error: "Failed to update subscription" });
  }
});

router.get("/session-debug", (req, res) => {
  res.json({ session: req.session });
});

export default router;
