// routes/telegramRoutes.js
import express from "express";
import crypto from "crypto";
import db from "../db.js";

const router = express.Router();

/* ===== Env ===== */
const BOT_ID = process.env.TELEGRAM_BOT_ID || "";             // <— numeric
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  process.env.CLIENT_URL ||
  "https://www.7goldencowries.com";

// Optional replay protection (seconds). Set 0 to disable.
const AUTH_MAX_AGE = Number(process.env.TELEGRAM_AUTH_MAX_AGE ?? 300);

/* ===== Helpers ===== */
function decodeState(s) {
  try {
    return decodeURIComponent(Buffer.from(String(s || ""), "base64").toString("utf8"));
  } catch {
    return "";
  }
}

async function ensureUser(wallet) {
  if (!wallet) return;
  const row = await db.get("SELECT wallet FROM users WHERE wallet = ?", wallet);
  if (!row) {
    await db.run(
      `INSERT INTO users (wallet, xp, tier, levelName, levelSymbol, levelProgress, nextXP)
       VALUES (?, 0, 'Free', 'Shellborn', '🐚', 0, 10000)`,
      wallet
    );
  }
}

/** Verify Telegram OAuth payload (per docs) */
function verifyTelegram(data, botToken) {
  const { hash, ...rest } = data;

  if (AUTH_MAX_AGE > 0 && rest.auth_date) {
    const nowSec = Math.floor(Date.now() / 1000);
    const skew = nowSec - Number(rest.auth_date);
    if (!Number.isFinite(skew) || skew < 0 || skew > AUTH_MAX_AGE) {
      return false;
    }
  }

  const checkString = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("\n");

  const secret = crypto.createHash("sha256").update(botToken).digest();
  const hmac = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  return hmac === hash;
}

function originOf(urlStr) {
  try {
    return new URL(String(urlStr)).origin;
  } catch {
    return "";
  }
}

/* ===== Routes ===== */

/**
 * GET /auth/telegram/start
 * Hard-redirect directly to Telegram OAuth (no widget, no extra popup)
 */
router.get("/auth/telegram/start", (req, res) => {
  try {
    if (!BOT_ID || !BOT_TOKEN) {
      return res.status(500).send("Telegram not configured: set TELEGRAM_BOT_ID and TELEGRAM_BOT_TOKEN");
    }

    const state = String(req.query.state || "");
    // Final landing after Telegram -> our callback:
    const returnTo = `${FRONTEND_URL}/auth/telegram/callback?state=${encodeURIComponent(state)}`;

    // Telegram auth/push URL
    const params = new URLSearchParams({
      bot_id: String(BOT_ID),
      origin: originOf(FRONTEND_URL) || "https://www.7goldencowries.com",
      embed: "1",
      request_access: "write",
      return_to: returnTo,
    });

    const tgUrl = `https://oauth.telegram.org/auth/push?${params.toString()}`;

    // 302 straight to Telegram
    return res.redirect(302, tgUrl);
  } catch (e) {
    console.error("Telegram start error:", e);
    return res.status(500).send("Telegram start failed.");
  }
});

/**
 * (legacy alias) /auth/telegram/verify -> /auth/telegram/callback
 * kept for any old links/cache
 */
router.get("/auth/telegram/verify", (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  res.redirect(302, `/auth/telegram/callback${qs ? `?${qs}` : ""}`);
});

/**
 * GET /auth/telegram/callback
 * Verifies payload, saves link, and sends user to profile.
 */
router.get("/auth/telegram/callback", async (req, res) => {
  try {
    if (!BOT_TOKEN) throw new Error("Missing bot token");

    const wallet = decodeState(req.query.state || "");
    if (!wallet) {
      return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=nostate`);
    }

    if (!verifyTelegram(req.query, BOT_TOKEN)) {
      return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=bad_sig`);
    }

    const tgId = String(req.query.id || "");
    const tgUsername = String(req.query.username || "");

    await ensureUser(wallet);

    // Update users
    await db.run(
      `UPDATE users SET telegramId = ?, telegramHandle = ? WHERE wallet = ?`,
      tgId,
      tgUsername,
      wallet
    );

    // Upsert social_links
    await db.run(
      `INSERT INTO social_links (wallet, twitter, telegram, discord)
       VALUES (?, NULL, ?, NULL)
       ON CONFLICT(wallet) DO UPDATE SET
         telegram = excluded.telegram,
         updated_at = CURRENT_TIMESTAMP`,
      wallet,
      tgUsername
    );

    // All good — go back to profile
    return res.redirect(`${FRONTEND_URL}/profile?linked=telegram`);
  } catch (e) {
    console.error("Telegram callback error:", e);
    return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=server`);
  }
});

export default router;