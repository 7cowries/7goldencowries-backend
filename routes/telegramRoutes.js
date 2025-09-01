// routes/telegramRoutes.js
import express from "express";
import crypto from "crypto";
import db from "../db.js";

const router = express.Router();

/* ========= ENV ========= */
const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  process.env.CLIENT_URL ||
  "https://www.7goldencowries.com";

const BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || ""; // e.g. "8197436765:AA...."

const BOT_USERNAME =
  process.env.TELEGRAM_BOT_USERNAME ||
  process.env.TELEGRAM_BOT_NAME ||
  ""; // optional, not required for this flow

// You may provide TELEGRAM_BOT_ID explicitly. If not, we'll derive it from token (numbers before ':').
const BOT_ID =
  process.env.TELEGRAM_BOT_ID ||
  (BOT_TOKEN.includes(":") ? BOT_TOKEN.split(":")[0] : "");

// Optional replay-protection: max age for Telegram auth payload (seconds).
const AUTH_MAX_AGE = Number(process.env.TELEGRAM_AUTH_MAX_AGE ?? 300); // 5m default

/* ========= HELPERS ========= */
function originOf(urlStr) {
  try {
    return new URL(String(urlStr)).origin;
  } catch {
    return "";
  }
}

function resolveFrontendOrigin(req) {
  // Prefer explicit FRONTEND_URL (should be https://www.7goldencowries.com)
  const envOrigin = originOf(FRONTEND_URL);
  if (envOrigin) return envOrigin;

  // Fallback: infer from forwarded headers (behind proxy)
  const proto = String(req.headers["x-forwarded-proto"] || "https")
    .split(",")[0]
    .trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim()
    .replace(/:\d+$/, "");
  return host ? `${proto}://${host}` : "https://www.7goldencowries.com";
}

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

/** Verify Telegram OAuth data per official docs:
 * https://core.telegram.org/widgets/login#checking-authorization
 */
function verifyTelegram(data, botToken) {
  const { hash, ...rest } = data;

  // Optional replay protection using auth_date
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

/* ========= ROUTES ========= */

/**
 * GET /auth/telegram/start
 * Same-tab redirect → Telegram OAuth "push" endpoint.
 * After auth, Telegram will return to /auth/telegram/callback with the payload in the query string.
 */
router.get("/auth/telegram/start", (req, res) => {
  if (!BOT_TOKEN || !BOT_ID) {
    return res
      .status(500)
      .send("Telegram not configured: set TELEGRAM_BOT_TOKEN (and TELEGRAM_BOT_ID or a token with ':' so we can derive it).");
  }

  const state = String(req.query.state || "");
  const origin = resolveFrontendOrigin(req); // should resolve to https://www.7goldencowries.com

  // Where Telegram should send the signed user payload after login:
  const returnTo = `${origin}/auth/telegram/callback?state=${encodeURIComponent(state)}`;

  // Telegram "push" URL (embed=1 + request_access=write to match widget behavior)
  const pushUrl =
    `https://oauth.telegram.org/auth/push` +
    `?bot_id=${encodeURIComponent(BOT_ID)}` +
    `&origin=${encodeURIComponent(origin)}` +
    `&embed=1` +
    `&request_access=write` +
    `&return_to=${encodeURIComponent(returnTo)}`;

  // Same-tab redirect
  res.redirect(302, pushUrl);
});

/**
 * GET /auth/telegram/callback
 * Verify Telegram signature, upsert links, then redirect the user to Profile.
 */
router.get("/auth/telegram/callback", async (req, res) => {
  try {
    if (!BOT_TOKEN) throw new Error("Missing bot token");

    // The wallet we encoded in state (base64) on the client
    const wallet = decodeState(req.query.state || "");
    if (!wallet) {
      return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=nostate`);
    }

    // Verify payload from Telegram
    if (!verifyTelegram(req.query, BOT_TOKEN)) {
      return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=bad_sig`);
    }

    const tgId = String(req.query.id || "");
    const tgUsername = String(req.query.username || "");

    // Ensure user exists in DB; then save Telegram linkage
    await ensureUser(wallet);

    await db.run(
      `UPDATE users SET telegramId = ?, telegramHandle = ? WHERE wallet = ?`,
      tgId,
      tgUsername,
      wallet
    );

    await db.run(
      `INSERT INTO social_links (wallet, twitter, telegram, discord)
       VALUES (?, NULL, ?, NULL)
       ON CONFLICT(wallet) DO UPDATE SET
         telegram = excluded.telegram,
         updated_at = CURRENT_TIMESTAMP`,
      wallet,
      tgUsername
    );

    // Done — return user to their profile (no popup)
    return res.redirect(`${FRONTEND_URL}/profile?linked=telegram`);
  } catch (e) {
    console.error("Telegram callback error:", e);
    return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=server`);
  }
});

export default router;
