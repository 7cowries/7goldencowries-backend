import express from "express";
import crypto from "crypto";
import db from "../db.js";

const router = express.Router();

// ---------- Env ----------
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const BOT_ID =
  process.env.TELEGRAM_BOT_ID ||
  (BOT_TOKEN.includes(":") ? BOT_TOKEN.split(":")[0] : "");

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  process.env.CLIENT_URL ||
  "https://www.7goldencowries.com";

// Max age (seconds) to accept Telegram payload to prevent replay
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

/**
 * Verify Telegram OAuth data per official docs:
 * https://core.telegram.org/widgets/login#checking-authorization
 *
 * IMPORTANT: Only the following keys are used in the data_check_string:
 * id, first_name, last_name, username, photo_url, auth_date
 * (Do NOT include custom params like "state".)
 */
function verifyTelegram(query, botToken) {
  const { hash, ...rest } = query;

  // Pick only allowed fields for the check string
  const allowed = ["id", "first_name", "last_name", "username", "photo_url", "auth_date"];
  const filtered = {};
  for (const k of allowed) {
    if (rest[k] !== undefined) filtered[k] = String(rest[k]);
  }

  // Optional replay protection using auth_date
  if (AUTH_MAX_AGE > 0 && filtered.auth_date) {
    const nowSec = Math.floor(Date.now() / 1000);
    const skew = nowSec - Number(filtered.auth_date);
    if (!Number.isFinite(skew) || skew < 0 || skew > AUTH_MAX_AGE) {
      return false;
    }
  }

  const checkString = Object.keys(filtered)
    .sort()
    .map((k) => `${k}=${filtered[k]}`)
    .join("\n");

  const secret = crypto.createHash("sha256").update(botToken).digest();
  const hmac = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
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
// GET /auth/telegram/start → 302 to oauth.telegram.org (same-tab)
// ------------------------------------------------------------------
router.get("/auth/telegram/start", (req, res) => {
  try {
    if (!BOT_TOKEN || !BOT_ID) {
      return res.status(500).send("Telegram not configured properly.");
    }

    const state = String(req.query.state || "");
    const origin = "https://www.7goldencowries.com"; // force frontend domain
    const returnTo = `${origin}/auth/telegram/callback?state=${encodeURIComponent(state)}`;

    // absolutely disable caching so a stale widget page is never served
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    const tp = new URL("https://oauth.telegram.org/auth/push");
    tp.searchParams.set("bot_id", BOT_ID);
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
      return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=nostate`);
    }

    const ok = verifyTelegram(req.query, BOT_TOKEN);
    if (!ok) {
      return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=bad_sig`);
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

    // Final: success → back to profile
    return res.redirect(`${FRONTEND_URL}/profile?linked=telegram`);
  } catch (e) {
    console.error("Telegram callback error:", e);
    return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=server`);
  }
});

export default router;
