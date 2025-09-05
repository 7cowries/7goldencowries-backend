// routes/telegramRoutes.js
import express from "express";
import crypto from "crypto";
import db from "../db.js";

const router = express.Router();

/* ========= ENV ========= */
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
// derive numeric bot_id from token like "8197436765:AAAA..."
const BOT_ID =
  process.env.TELEGRAM_BOT_ID ||
  (BOT_TOKEN.includes(":") ? BOT_TOKEN.split(":")[0] : "");

const BOT_NAME = (process.env.TELEGRAM_BOT_NAME || "").replace(/^@/, ""); // used for embed ONLY

// Force the frontend origin that Telegram should trust/redirect back to
const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  process.env.CLIENT_URL ||
  "https://www.7goldencowries.com";

// Optional: max age for auth_date (0 disables)
const AUTH_MAX_AGE = Number(process.env.TELEGRAM_AUTH_MAX_AGE ?? 0); // disabled by default

/* ========= HELPERS ========= */
function decodeState(s) {
  try {
    return decodeURIComponent(
      Buffer.from(String(s || ""), "base64").toString("utf8")
    );
  } catch {
    return "";
  }
}

/** Check signature per official docs:
 * https://core.telegram.org/widgets/login#checking-authorization
 * IMPORTANT: Only include Telegram-provided fields in data_check_string
 * (id, first_name, last_name, username, photo_url, auth_date). Exclude 'hash'
 * and any custom params like 'state'.
 */
function verifyTelegram(query, botToken) {
  const allowed = new Set([
    "id",
    "first_name",
    "last_name",
    "username",
    "photo_url",
    "auth_date",
  ]);

  const providedHash = String(query.hash || "");
  if (!providedHash) return false;

  // Optional replay protection
  if (AUTH_MAX_AGE > 0 && query.auth_date) {
    const nowSec = Math.floor(Date.now() / 1000);
    const skew = nowSec - Number(query.auth_date);
    if (!Number.isFinite(skew) || skew < 0 || skew > AUTH_MAX_AGE) {
      return false;
    }
  }

  // Build data_check_string with ONLY allowed keys
  const pairs = Object.keys(query)
    .filter((k) => allowed.has(k))
    .sort()
    .map((k) => `${k}=${query[k]}`);

  const checkString = pairs.join("\n");
  const secret = crypto.createHash("sha256").update(botToken).digest();
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(checkString)
    .digest("hex");

  return hmac === providedHash;
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

/* =========================================================================
   GET /auth/telegram/start
   Default: 302 to Telegram hosted login (recommended).
   Optional: ?mode=embed just for testing on a page that matches /setdomain.
   ========================================================================= */
router.get("/auth/telegram/start", (req, res) => {
  try {
    if (!BOT_TOKEN || !BOT_ID) {
      return res
        .status(500)
        .send(
          "Telegram not configured: set TELEGRAM_BOT_TOKEN (and TELEGRAM_BOT_ID or use a standard token)."
        );
    }

    const state = String(req.query.state || "");
    const origin = "https://www.7goldencowries.com"; // must match BotFather /setdomain
    const returnTo = `${origin}/auth/telegram/callback?state=${encodeURIComponent(
      state
    )}`;

    // no cache at all
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    // If you explicitly want the on-page button (only on the SAME domain as /setdomain)
    if ((req.query.mode || "").toString() === "embed") {
      if (!BOT_NAME) {
        return res
          .status(500)
          .send("Set TELEGRAM_BOT_NAME (without @) to use embed mode.");
      }
      // NOTE: This page must be served from https://www.7goldencowries.com to work.
      // On Render you'll see "Bot domain invalid" — that's expected.
      const authUrl = `/auth/telegram/callback?state=${encodeURIComponent(
        state
      )}`;
      return res
        .type("html")
        .send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Connect Telegram</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:24px;background:#0b1220;color:#e7eef3}
    .card{max-width:520px;margin:40px auto;padding:24px;border-radius:16px;background:#0f1a2b;box-shadow:0 10px 30px rgba(0,0,0,.35)}
    h1{font-size:22px;margin:0 0 12px}
    .muted{opacity:.7}
    .warn{display:inline-block;margin-top:10px;padding:8px 10px;border-radius:8px;background:#2b3448}
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect your Telegram</h1>
    <p class="muted">Click the button below to authorize with Telegram.</p>
    <script async src="https://telegram.org/js/telegram-widget.js?22"
      data-telegram-login="${BOT_NAME}"
      data-size="large"
      data-request-access="write"
      data-auth-url="${authUrl}"></script>
    <p class="warn">If the widget shows "Bot domain invalid", open the non-embed URL instead.</p>
  </div>
</body>
</html>`);
    }

    // Recommended default: hosted page on oauth.telegram.org
    const tp = new URL("https://oauth.telegram.org/auth/push");
    tp.searchParams.set("bot_id", BOT_ID);
    tp.searchParams.set("origin", origin); // must equal /setdomain
    tp.searchParams.set("embed", "1");
    tp.searchParams.set("request_access", "write");
    tp.searchParams.set("return_to", returnTo);

    return res.redirect(302, tp.toString());
  } catch (e) {
    console.error("Telegram /start error:", e);
    return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=start`);
  }
});

/* -----------------------------------------------------------
   Legacy alias: /auth/telegram/verify → redirect to /callback
   ----------------------------------------------------------- */
router.get("/auth/telegram/verify", (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  res.redirect(302, `/auth/telegram/callback${qs ? `?${qs}` : ""}`);
});

/* =========================================================================
   GET /auth/telegram/callback — verify payload, save, go to profile
   ========================================================================= */
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
      console.error("[TG] HMAC mismatch (exclude non-telegram params like state)");
      return res.redirect(
        `${FRONTEND_URL}/profile?linked=telegram&err=bad_sig`
      );
    }

    const tgId = String(req.query.id || "");
    const tgUsername = String((req.query.username || "").replace(/^@/, ""));

    await ensureUser(wallet);

    await db.run(
      `UPDATE users
         SET telegramId = ?, telegramHandle = ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE wallet = ?`,
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

    return res.redirect(`${FRONTEND_URL}/profile?linked=telegram`);
  } catch (e) {
    console.error("Telegram callback error:", e);
    return res.redirect(
      `${FRONTEND_URL}/profile?linked=telegram&err=server`
    );
  }
});

export default router;
