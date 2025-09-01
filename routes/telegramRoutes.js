// routes/telegramRoutes.js
import express from "express";
import crypto from "crypto";
import db from "../db.js";

const router = express.Router();

// ---------- Env ----------
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const BOT_ID =
  process.env.TELEGRAM_BOT_ID ||
  (BOT_TOKEN.includes(":") ? BOT_TOKEN.split(":")[0] : ""); // derive from token if not provided

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  process.env.CLIENT_URL ||
  "https://www.7goldencowries.com";

// Max age for telegram login payload (seconds). Prevents replay.
const AUTH_MAX_AGE = Number(process.env.TELEGRAM_AUTH_MAX_AGE ?? 300); // 5 min

// ---------- Helpers ----------
function decodeState(s) {
  try {
    return decodeURIComponent(
      Buffer.from(String(s || ""), "base64").toString("utf8")
    );
  } catch {
    return "";
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
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(checkString)
    .digest("hex");
  return hmac === hash;
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

// ------------------------------------------------------------------
// UPDATED: GET /auth/telegram/start → 302 redirect to oauth.telegram.org
//          with no-cache headers and inline botId resolution
// ------------------------------------------------------------------
router.get("/auth/telegram/start", (req, res) => {
  try {
    if (!BOT_TOKEN && !process.env.TELEGRAM_BOT_TOKEN) {
      return res.status(500).send("Telegram not configured properly.");
    }

    const state = String(req.query.state || "");
    const origin = "https://www.7goldencowries.com"; // force frontend domain
    const returnTo = `${origin}/auth/telegram/callback?state=${encodeURIComponent(
      state
    )}`;

    // absolutely disable caching so you never get the old widget page from a cache/CDN
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
    );

    const tp = new URL("https://oauth.telegram.org/auth/push");
    const botId =
      process.env.TELEGRAM_BOT_ID ||
      (process.env.TELEGRAM_BOT_TOKEN || "").split(":")[0] ||
      BOT_ID;

    tp.searchParams.set("bot_id", botId);
    tp.searchParams.set("origin", origin);
    tp.searchParams.set("embed", "1");
    tp.searchParams.set("request_access", "write");
    tp.searchParams.set("return_to", returnTo);

    return res.redirect(302, tp.toString());
  } catch (e) {
    console.error("Telegram /start error:", e);
    return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=start`);
  }
});

// ------------------------------------------------------------------
// Legacy alias: /auth/telegram/verify → redirect to /callback
// ------------------------------------------------------------------
router.get("/auth/telegram/verify", (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  res.redirect(302, `/auth/telegram/callback${qs ? `?${qs}` : ""}`);
});

// ------------------------------------------------------------------
// GET /auth/telegram/callback — verify payload, save links, land on profile
// ------------------------------------------------------------------
router.get("/auth/telegram/callback", async (req, res) => {
  try {
    if (!BOT_TOKEN) throw new Error("Missing bot token");

    const wallet = decodeState(req.query.state || "");
    if (!wallet) {
      return res.redirect(
        `${FRONTEND_URL}/profile?linked=telegram&err=nostate`
      );
    }

    if (!verifyTelegram(req.query, BOT_TOKEN)) {
      return res.redirect(
        `${FRONTEND_URL}/profile?linked=telegram&err=bad_sig`
      );
    }

    const tgId = String(req.query.id || "");
    const tgUsername = String(req.query.username || "");

    await ensureUser(wallet);

    // Update users
    await db.run(
      `UPDATE users
         SET telegramId = ?, telegramHandle = ?
       WHERE wallet = ?`,
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

    // Final success redirect
    return res.redirect(`${FRONTEND_URL}/profile?linked=telegram`);
  } catch (e) {
    console.error("Telegram callback error:", e);
    return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=server`);
  }
});

export default router;