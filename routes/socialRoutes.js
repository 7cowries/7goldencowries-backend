import express from "express";
import crypto from "crypto";
import db from "../lib/db.js";
import passport from "../passport.js";
import { getSessionWallet } from "../utils/session.js";

async function upsertSocial(wallet, provider, data) {
  try {
    const row = await db.get("SELECT socials FROM users WHERE wallet = ?", [wallet]);
    let socials = {};
    if (row?.socials) {
      try { socials = JSON.parse(row.socials); } catch {}
    }
    socials[provider] = { ...(socials[provider] || {}), ...data, connected: true };
    await db.run("UPDATE users SET socials=? WHERE wallet=?", [JSON.stringify(socials), wallet]);
  } catch (e) {
    console.error("socials update error", e);
  }
}

const router = express.Router();
router.use(passport.initialize());
router.use(passport.session());

const BACKEND_URL =
  process.env.BACKEND_URL || "https://sevengoldencowries-backend.onrender.com";
const FRONTEND_URL =
  process.env.CLIENT_URL ||
  process.env.FRONTEND_URL ||
  "https://7goldencowries.com";
const PROFILE_URL = process.env.PROFILE_URL || "https://7goldencowries.com/profile";

function safelyDecodeBase64(value) {
  if (!value) return null;
  try {
    return Buffer.from(String(value), "base64").toString("utf8");
  } catch {
    return null;
  }
}

function verifyTelegramLogin(query, botToken) {
  const { hash } = query;
  if (!hash || !botToken) return false;

  const TELEGRAM_FIELDS = [
    "id",
    "first_name",
    "last_name",
    "username",
    "photo_url",
    "auth_date",
  ];

  const parts = TELEGRAM_FIELDS
    .filter((k) => query[k] !== undefined)
    .map((k) => `${k}=${query[k]}`)
    .sort();

  if (process.env.NODE_ENV !== "production") {
    console.log("[telegram] fields", parts);
  }

  const dataCheckString = parts.join("\n");

  const secret = crypto.createHash("sha256").update(botToken).digest();
  const computed = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(String(hash), "hex");
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (process.env.NODE_ENV !== "production") {
    console.log("[telegram] verify", ok ? "success" : "fail");
  }

  return ok;
}

/** ---------- Twitter OAuth ---------- */
router.get("/twitter", (req, res, next) => {
  const wallet = getSessionWallet(req);
  if (!wallet) return res.status(400).json({ error: "Missing wallet address" });
  passport.authenticate("twitter")(req, res, next);
});

router.get("/twitter/callback", (req, res, next) => {
  passport.authenticate("twitter", async (err, user) => {
    if (err || !user) {
      console.error("twitter auth error", err);
      return res.redirect(FRONTEND_URL + "/profile?error=twitter");
    }
    const wallet = getSessionWallet(req);
    if (!wallet) return res.status(400).send("Missing wallet address");
    try {
      await db.run(
        `INSERT INTO users (wallet, twitter_username, twitter_id, twitterHandle, updatedAt)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(wallet) DO UPDATE SET
             twitter_username=excluded.twitter_username,
             twitter_id=excluded.twitter_id,
             twitterHandle=excluded.twitterHandle,
             updatedAt=CURRENT_TIMESTAMP`,
        [wallet, user.username, String(user.id), user.username]
      );
      await upsertSocial(wallet, "twitter", { handle: user.username, id: String(user.id) });
    } catch (e) {
      console.error("twitter db error", e);
    }
    return res.redirect(`${PROFILE_URL}?connected=twitter`);
  })(req, res, next);
});

/** ---------- Discord OAuth ---------- */
router.get("/discord", (req, res) => {
  const wallet = getSessionWallet(req);
  if (!wallet) return res.status(400).json({ error: "Missing wallet address" });
  const state = crypto.randomBytes(16).toString("hex");
  req.session.discord_state = state;
  const cid = process.env.DISCORD_CLIENT_ID;
  const redirectUri =
    process.env.DISCORD_REDIRECT_URI ||
    `${BACKEND_URL}/api/auth/discord/callback`;
  const url =
    `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(cid)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=identify` +
    `&state=${encodeURIComponent(state)}`;
  return res.redirect(url);
});

router.get("/discord/callback", async (req, res) => {
  try {
    const wallet = getSessionWallet(req);
    if (!wallet) return res.status(400).send("Missing wallet address");
    const state = req.query.state;
    if (!state || state !== req.session.discord_state) {
      return res.status(400).send("Invalid state");
    }
    const code = req.query.code;
    if (!code) return res.status(400).send("Missing code");
    const cid = process.env.DISCORD_CLIENT_ID;
    const secret = process.env.DISCORD_CLIENT_SECRET;
    const redirectUri =
      process.env.DISCORD_REDIRECT_URI ||
      `${BACKEND_URL}/api/auth/discord/callback`;
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cid,
        client_secret: secret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error("discord token error", body);
      return res.redirect(`${PROFILE_URL}?error=discord`);
    }
    const tokenJson = await tokenRes.json();
    const access = tokenJson.access_token;
    const meRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${access}` },
    });
    if (!meRes.ok) {
      const body = await meRes.text();
      console.error("discord user error", body);
      return res.redirect(`${PROFILE_URL}?error=discord`);
    }
    const me = await meRes.json();
    const username =
      me.discriminator && me.discriminator !== "0"
        ? `${me.username}#${me.discriminator}`
        : me.username;
    const did = String(me.id);
    let guildMember = false;
    if (process.env.DISCORD_GUILD_ID) {
      try {
        const gRes = await fetch("https://discord.com/api/users/@me/guilds", {
          headers: { Authorization: `Bearer ${access}` },
        });
        if (gRes.ok) {
          const guilds = await gRes.json();
          guildMember = Array.isArray(guilds) && guilds.some((g) => String(g.id) === String(process.env.DISCORD_GUILD_ID));
        }
      } catch {}
    }
    await db.run(
      `INSERT INTO users (wallet, discord_username, discord_id, discordHandle, discordId, discordGuildMember, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(wallet) DO UPDATE SET
           discord_username=excluded.discord_username,
           discord_id=excluded.discord_id,
           discordHandle=excluded.discordHandle,
           discordId=excluded.discordId,
           discordGuildMember=excluded.discordGuildMember,
           updatedAt=CURRENT_TIMESTAMP`,
      [wallet, username, did, username, did, guildMember ? 1 : 0]
    );
    await upsertSocial(wallet, "discord", { id: did });
    req.session.discord_state = null;
    if (req.session.save) req.session.save(() => {});
    return res.redirect(
      `${PROFILE_URL}?connected=discord&guildMember=${guildMember ? "true" : "false"}`
    );
  } catch (e) {
    console.error("discord callback error", e);
    return res.redirect(`${PROFILE_URL}?error=discord`);
  }
});

/** ---------- Telegram callback ----------
 * Verify HMAC and store telegram_username for the session wallet.
 */
router.get("/telegram/callback", async (req, res) => {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return res.status(500).send("Missing TELEGRAM_BOT_TOKEN");
    if (!verifyTelegramLogin(req.query, token)) {
      return res.status(401).send("Invalid Telegram login");
    }
    const maxAge = Number(process.env.TELEGRAM_AUTH_MAX_AGE || 60);
    const authDate = Number(req.query.auth_date || 0);
    if (maxAge && authDate && Math.floor(Date.now() / 1000) - authDate > maxAge) {
      return res.status(401).send("Telegram login expired");
    }
    const wallet =
      getSessionWallet(req) || safelyDecodeBase64(req.query.state) || null;
    const username = req.query.username || null;
    const tid = req.query.id ? String(req.query.id) : null;
    if (wallet && username) {
      await db.run(
        `INSERT INTO users (wallet, telegram_username, telegramHandle, telegramId, updatedAt)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(wallet) DO UPDATE SET
             telegram_username=excluded.telegram_username,
             telegramHandle=excluded.telegramHandle,
             telegramId=excluded.telegramId,
             updatedAt=CURRENT_TIMESTAMP`,
        [wallet, username, username, tid]
      );
      await upsertSocial(wallet, "telegram", { username, id: tid });
    }
    return res.redirect(`${PROFILE_URL}?connected=telegram`);
  } catch (e) {
    console.error("telegram/callback error", e);
    return res.redirect(`${PROFILE_URL}?error=telegram`);
  }
});

export default router;
