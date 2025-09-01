// routes/telegramRoutes.js
import express from "express";
import crypto from "crypto";
import db from "../db.js";

const router = express.Router();

/* =========================
   ENV
   ========================= */
const BOT_ID = process.env.TELEGRAM_BOT_ID || "";           // e.g. "8197436765"  ← REQUIRED
const BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "";                     // ← REQUIRED
const BOT_USERNAME =
  process.env.TELEGRAM_BOT_USERNAME ||
  process.env.TELEGRAM_BOT_NAME ||
  "";                                                       // optional (for logs)

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  process.env.CLIENT_URL ||
  "https://www.7goldencowries.com";

// Max age for telegram login payload (seconds). Prevents replay.
// Set TELEGRAM_AUTH_MAX_AGE=0 to disable.
const AUTH_MAX_AGE = Number(process.env.TELEGRAM_AUTH_MAX_AGE ?? 300); // 5 min

/* =========================
   HELPERS
   ========================= */
function safeOrigin(urlStr) {
  try { return new URL(String(urlStr)).origin; } catch { return ""; }
}

function resolveOrigin(req) {
  // Prefer explicit env origin
  const envOrigin = safeOrigin(FRONTEND_URL);
  if (envOrigin) return envOrigin;

  // Fallback to forwarded headers (Vercel/Render in front)
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host  = String(req.headers["x-forwarded-host"]  || req.headers.host || "").split(",")[0].trim().replace(/:\d+$/, "");
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
  const hmac   = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  return hmac === hash;
}

/* =========================
   ROUTES
   ========================= */

/**
 * GET /auth/telegram/start
 *
 * Full-page login flow (no widget, no popup):
 *  1) If no Telegram params yet → 302 redirect to oauth.telegram.org/auth/push
 *  2) After user taps "Login as …", Telegram returns to THIS SAME URL (/start)
 *     with id, hash, auth_date, username, etc. We detect that and forward to /callback.
 */
router.get("/auth/telegram/start", async (req, res) => {
  try {
    if (!BOT_ID || !BOT_TOKEN) {
      return res.status(500).send("Telegram is not configured: set TELEGRAM_BOT_ID and TELEGRAM_BOT_TOKEN");
    }

    const origin = resolveOrigin(req);

    // If Telegram already returned here with auth params, forward to /callback to verify/link.
    const hasTelegramPayload =
      typeof req.query.id !== "undefined" &&
      typeof req.query.hash !== "undefined" &&
      typeof req.query.auth_date !== "undefined";

    if (hasTelegramPayload) {
      const qs = new URLSearchParams(req.query).toString();
      return res.redirect(302, `/auth/telegram/callback${qs ? `?${qs}` : ""}`);
    }

    // First visit: build the push auth URL and redirect user to Telegram
    const state = String(req.query.state || ""); // base64 wallet from frontend
    // After Telegram login, it should return to THIS /start (with the same state),
    // then we forward to /callback for verification.
    const returnTo = `${origin}/auth/telegram/start?state=${encodeURIComponent(state)}`;

    const oauthUrl =
      `https://oauth.telegram.org/auth/push` +
      `?bot_id=${encodeURIComponent(BOT_ID)}` +
      `&origin=${encodeURIComponent(origin)}` +
      `&request_access=write` +
      `&embed=1` +
      `&return_to=${encodeURIComponent(returnTo)}`;

    return res.redirect(302, oauthUrl);
  } catch (err) {
    console.error("Telegram start error:", err);
    return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=start`);
  }
});

/**
 * Legacy alias: /auth/telegram/verify → redirect to /callback
 */
router.get("/auth/telegram/verify", (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  res.redirect(302, `/auth/telegram/callback${qs ? `?${qs}` : ""}`);
});

/**
 * GET /auth/telegram/callback
 * Verifies payload, upserts DB, and redirects to /profile.
 */
router.get("/auth/telegram/callback", async (req, res) => {
  try {
    if (!BOT_TOKEN) throw new Error("Missing bot token");

    // state is the base64 wallet passed through the flow
    const wallet = decodeState(req.query.state || "");
    if (!wallet) {
      return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=nostate`);
    }

    if (!verifyTelegram(req.query, BOT_TOKEN)) {
      return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=bad_sig`);
    }

    const tgId       = String(req.query.id || "");
    const tgUsername = String(req.query.username || "");

    await ensureUser(wallet);

    // Update primary users table
    await db.run(
      `UPDATE users
         SET telegramId = ?, telegramHandle = ?
       WHERE wallet = ?`,
      tgId, tgUsername, wallet
    );

    // Upsert social_links
    await db.run(
      `INSERT INTO social_links (wallet, twitter, telegram, discord)
       VALUES (?, NULL, ?, NULL)
       ON CONFLICT(wallet) DO UPDATE SET
         telegram = excluded.telegram,
         updated_at = CURRENT_TIMESTAMP`,
      wallet, tgUsername
    );

    // Success → go to profile page
    return res.redirect(`${FRONTEND_URL}/profile?linked=telegram`);
  } catch (e) {
    console.error("Telegram callback error:", e);
    return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=server`);
  }
});

export default router;
