import express from "express";
import passport from "passport";
import db from "../db.js";

const router = express.Router();

const CLIENT_URL =
  process.env.CLIENT_URL ||
  process.env.FRONTEND_URL ||
  "https://7goldencowries.vercel.app"; // fallback; override via env

/** Accept state as base64 or plain text wallet */
function parseWalletFromState(state) {
  if (!state) return null;
  try {
    const decoded = Buffer.from(state, "base64").toString("utf-8");
    if (decoded && decoded.length >= 10) return decoded;
  } catch {}
  return state; // fallback: treat as raw wallet
}

/** Ensure user exists (for first-time linkers) */
async function ensureUser(wallet, extra = {}) {
  const row = await db.get("SELECT wallet FROM users WHERE wallet = ?", wallet);
  if (!row) {
    await db.run(
      `INSERT INTO users (
         wallet, xp, tier, levelName, levelSymbol, levelProgress, nextXP,
         twitterHandle, telegramId, telegramHandle,
         discordId, discordHandle, discordGuildMember
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

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
          "UPDATE users SET twitterHandle = ? WHERE wallet = ?",
          twitterHandle,
          wallet
        );
        await db.run(
          `INSERT INTO social_links (wallet, twitter) VALUES (?, ?)
           ON CONFLICT(wallet) DO UPDATE SET twitter=excluded.twitter`,
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
      "UPDATE users SET twitterHandle = ? WHERE wallet = ?",
      twitter,
      wallet
    );
    await db.run(
      `INSERT INTO social_links (wallet, twitter) VALUES (?, ?)
       ON CONFLICT(wallet) DO UPDATE SET twitter=excluded.twitter`,
      [wallet, twitter]
    );
    res.json({ message: "Twitter handle linked" });
  } catch (e) {
    console.error("❌ Link Twitter error:", e);
    res.status(500).json({ error: "Database error" });
  }
});

/* ------------------------- TELEGRAM (linking via oauth.telegram.org/push) ------------------------- */

/** Hard-force the origin to the exact domain you set with @BotFather /setdomain */
const FRONTEND_ORIGIN = "https://www.7goldencowries.com";

/** Extract bot_id from env */
const TELEGRAM_BOT_ID =
  process.env.TELEGRAM_BOT_ID ||
  (process.env.TELEGRAM_BOT_TOKEN || "").split(":")[0] ||
  "";

// Tiny alias (kept for existing links)
router.get("/auth/telegram", (req, res) => {
  const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  res.redirect(`/auth/telegram/start${qs}`);
});

/** NEW: Always 302 to Telegram’s push endpoint (no widget HTML, no popup) */
router.get("/auth/telegram/start", (req, res) => {
  const state = String(req.query.state || "");

  if (!TELEGRAM_BOT_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN/ID");
    return res.status(500).send("Telegram not configured");
  }

  // absolutely disable caching so you never get the old widget HTML from cache/CDN
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
  );

  const returnTo = `${FRONTEND_ORIGIN}/auth/telegram/callback?state=${encodeURIComponent(
    state
  )}`;

  const tp = new URL("https://oauth.telegram.org/auth/push");
  tp.searchParams.set("bot_id", TELEGRAM_BOT_ID);
  tp.searchParams.set("origin", FRONTEND_ORIGIN);
  tp.searchParams.set("embed", "1");
  tp.searchParams.set("request_access", "write");
  tp.searchParams.set("return_to", returnTo);

  return res.redirect(302, tp.toString());
});

/** Legacy widget verifier path — now just a shim to the shared callback */
router.get("/auth/telegram/verify", (req, res) => {
  const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  // Let routes/telegramRoutes.js handle signature verify + DB update
  res.redirect(`/auth/telegram/callback${qs}`);
});

/** Optional: Fallback username form (kept as-is) */
router.post("/auth/telegram/manual", async (req, res) => {
  try {
    const wallet = parseWalletFromState(req.session?.state);
    if (!wallet) return res.status(400).send("Missing wallet state");
    const username = (req.body?.username || "").trim().replace(/^@/, "");
    if (!username) return res.status(400).send("Missing Telegram username");

    await ensureUser(wallet, { telegramHandle: username });
    await db.run(
      `UPDATE users SET telegramHandle = ? WHERE wallet = ?`,
      username,
      wallet
    );
    await db.run(
      `INSERT INTO social_links (wallet, telegram) VALUES (?, ?)
       ON CONFLICT(wallet) DO UPDATE SET telegram=excluded.telegram`,
      [wallet, username]
    );
    req.session.state = null;
    if (req.session.save) req.session.save(() => {});
    return res.redirect(`${CLIENT_URL}/profile?linked=telegram`);
  } catch (e) {
    console.error("❌ Telegram manual link error:", e);
    res.status(500).send("Telegram link failed");
  }
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
      (me.username && me.discriminator && me.discriminator !== "0"
        ? `${me.username}#${me.discriminator}`
        : me.username) ||
      "discord-user";

    // 3) guild membership (if scope allows)
    let isMember = false;
    const guildId = process.env.DISCORD_GUILD_ID;
    if (guildId && DISCORD_SCOPES.split(/\s+/).includes("guilds")) {
      const guildsRes = await fetch(
        "https://discord.com/api/users/@me/guilds",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
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
       SET discordId = ?, discordHandle = ?, discordAccessToken = ?, discordRefreshToken = ?, discordTokenExpiresAt = ?, discordGuildMember = ?
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
       ON CONFLICT(wallet) DO UPDATE SET discord=excluded.discord`,
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

/* ------------------------- PROFILE ------------------------- */
router.get("/api/profile", async (req, res) => {
  const { wallet } = req.query;
  if (!wallet) return res.status(400).json({ error: "Missing wallet" });
  try {
    const profile = await db.get("SELECT * FROM users WHERE wallet = ?", wallet);
    const links = await db.get("SELECT * FROM social_links WHERE wallet = ?", wallet);
    const history = await db.all(
      "SELECT id, quest_id AS questId, title, xp, completed_at FROM quest_history WHERE wallet = ? ORDER BY id DESC LIMIT 200",
      wallet
    );
    if (!profile) return res.status(404).json({ error: "User not found" });
    res.json({
      profile: {
        ...profile,
        links: links || { twitter: null, telegram: null, discord: null },
      },
      history: history || [],
    });
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

/* ------------------------- QUESTS (DEV-ONLY helper) ------------------------- */
const DEV_COMPLETE_ENABLED = process.env.DEV_COMPLETE_ENABLED === "1";

router.post("/api/quest/complete", async (req, res) => {
  if (!DEV_COMPLETE_ENABLED) {
    return res.status(403).json({ error: "Disabled on this deployment" });
  }
  const { wallet, questId, title, xp } = req.body || {};
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
      "UPDATE users SET xp = ?, levelProgress = ? WHERE wallet = ?",
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
      "INSERT OR IGNORE INTO completed_quests (wallet, questId, timestamp) VALUES (?, ?, ?)",
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
  if (!wallet || !tier) return res.status(400).json({ error: "Missing wallet or tier" });
  try {
    await ensureUser(wallet);
    await db.run("UPDATE users SET tier = ? WHERE wallet = ?", tier, wallet);
    res.json({ message: `Tier '${tier}' assigned to ${wallet}` });
  } catch (err) {
    console.error("❌ Assign tier error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/set-subscription", async (req, res) => {
  const { wallet, tier } = req.body || {};
  if (!wallet || !tier) return res.status(400).json({ error: "Missing wallet or tier" });
  try {
    const row = await db.get("SELECT * FROM users WHERE wallet = ?", wallet);
    if (!row) return res.status(404).json({ error: "User not found" });
    await db.run("UPDATE users SET tier = ? WHERE wallet = ?", tier, wallet);
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
