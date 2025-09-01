// routes/telegramRoutes.js
import express from "express";
import crypto from "crypto";
import db from "../db.js";

const router = express.Router();

/* =========================
   ENV
   ========================= */
const BOT_USERNAME =
  process.env.TELEGRAM_BOT_USERNAME ||
  process.env.TELEGRAM_BOT_NAME ||
  "";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

/** IMPORTANT: you must set this to your bot id (numbers only), e.g. 8197436765 */
const BOT_ID = process.env.TELEGRAM_BOT_ID || "";

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  process.env.CLIENT_URL ||
  "https://www.7goldencowries.com";

/** Replay guard (seconds). 0 disables. */
const AUTH_MAX_AGE = Number(process.env.TELEGRAM_AUTH_MAX_AGE ?? 300);

/* =========================
   Helpers
   ========================= */
function b64Decode(s) {
  try {
    return decodeURIComponent(Buffer.from(String(s || ""), "base64").toString("utf8"));
  } catch {
    return "";
  }
}
function originOf(urlStr) {
  try {
    return new URL(String(urlStr)).origin;
  } catch {
    return "";
  }
}
function resolveFrontendOrigin(req) {
  const envOrigin = originOf(FRONTEND_URL);
  if (envOrigin) return envOrigin;

  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim()
    .replace(/:\d+$/, "");
  return host ? `${proto}://${host}` : "";
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

/** Verify per Telegram docs */
function verifyTelegram(data, botToken) {
  const { hash, ...rest } = data;

  if (AUTH_MAX_AGE > 0 && rest.auth_date) {
    const nowSec = Math.floor(Date.now() / 1000);
    const skew = nowSec - Number(rest.auth_date);
    if (!Number.isFinite(skew) || skew < 0 || skew > AUTH_MAX_AGE) return false;
  }

  const checkString = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("\n");

  const secret = crypto.createHash("sha256").update(botToken).digest();
  const hmac = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  return hmac === hash;
}

/* =========================
   Routes
   ========================= */

/**
 * START (no widget): immediately 302 to Telegram push OAuth
 * Same-tab experience; no popups.
 *
 * Example target:
 * https://oauth.telegram.org/auth/push?bot_id=8197436765
 *   &origin=https%3A%2F%2Fwww.7goldencowries.com
 *   &embed=1
 *   &request_access=write
 *   &return_to=https%3A%2F%2Fwww.7goldencowries.com%2Fauth%2Ftelegram%2Fcallback%3Fstate%3D...
 */
router.get("/auth/telegram/start", (req, res) => {
  if (!BOT_TOKEN || !BOT_ID) {
    return res
      .status(500)
      .send("Telegram not configured: set TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_ID");
  }

  const state = String(req.query.state || "");
  const origin = resolveFrontendOrigin(req) || "https://www.7goldencowries.com";
  const returnTo = `${origin}/auth/telegram/callback?state=${encodeURIComponent(state)}`;

  // go straight to OAuth "push" (no widget, no nested window)
  const tgUrl = `https://oauth.telegram.org/auth/push` +
    `?bot_id=${encodeURIComponent(BOT_ID)}` +
    `&origin=${encodeURIComponent(origin)}` +
    `&embed=1` +
    `&request_access=write` +
    `&return_to=${encodeURIComponent(returnTo)}`;

  res.redirect(302, tgUrl);
});

/** Legacy alias just in case something hits /verify directly */
router.get("/auth/telegram/verify", (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  res.redirect(302, `/auth/telegram/callback${qs ? `?${qs}` : ""}`);
});

/**
 * CALLBACK: verify payload, persist link, and land on profile with toast.
 */
router.get("/auth/telegram/callback", async (req, res) => {
  try {
    if (!BOT_TOKEN) throw new Error("Missing bot token");

    const wallet = b64Decode(req.query.state || "");
    if (!wallet) {
      return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=nostate`);
    }

    // verify Telegram signature
    if (!verifyTelegram(req.query, BOT_TOKEN)) {
      return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=bad_sig`);
    }

    const tgId = String(req.query.id || "");
    const tgUsername = String(req.query.username || "");

    await ensureUser(wallet);

    // update main user
    await db.run(
      `UPDATE users
         SET telegramId = ?, telegramHandle = ?
       WHERE wallet = ?`,
      tgId,
      tgUsername,
      wallet
    );

    // upsert social_links
    await db.run(
      `INSERT INTO social_links (wallet, twitter, telegram, discord)
       VALUES (?, NULL, ?, NULL)
       ON CONFLICT(wallet) DO UPDATE SET
         telegram = excluded.telegram,
         updated_at = CURRENT_TIMESTAMP`,
      wallet,
      tgUsername
    );

    // Land back on profile (toast is handled by frontend query param)
    return res.redirect(`${FRONTEND_URL}/profile?linked=telegram`);
  } catch (e) {
    console.error("Telegram callback error:", e);
    return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=server`);
  }
});

export default router;
