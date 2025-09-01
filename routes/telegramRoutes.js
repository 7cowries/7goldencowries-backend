// routes/telegramRoutes.js
import express from "express";
import crypto from "crypto";
import db from "../db.js";

const router = express.Router();

/* ========= ENV ========= */
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
// You can omit TELEGRAM_BOT_ID; we'll derive it from the token "123456:abc..."
const BOT_ID =
  process.env.TELEGRAM_BOT_ID ||
  (BOT_TOKEN.includes(":") ? BOT_TOKEN.split(":")[0] : "");

const BOT_NAME = (process.env.TELEGRAM_BOT_NAME || "").replace(/^@/, ""); // used only for embed mode

// Force the frontend origin that Telegram should trust/redirect back to
const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  process.env.CLIENT_URL ||
  "https://www.7goldencowries.com";

// Max age (seconds) for Telegram login payload to avoid replay
const AUTH_MAX_AGE = Number(process.env.TELEGRAM_AUTH_MAX_AGE ?? 300); // 5 minutes

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
   GET /auth/telegram/start  → 
   Default: 302 redirect to Telegram's hosted login page (no popups/iframes).
   Optional: add ?mode=embed to render the button on our page using Telegram's JS.
   ========================================================================= */
router.get("/auth/telegram/start", (req, res) => {
  try {
    if (!BOT_TOKEN || !BOT_ID) {
      return res.status(500).send("Telegram not configured: set TELEGRAM_BOT_TOKEN (and TELEGRAM_BOT_ID or use a standard token).");
    }

    const state = String(req.query.state || "");
    const origin = "https://www.7goldencowries.com"; // force the trusted origin
    const returnTo = `${origin}/auth/telegram/callback?state=${encodeURIComponent(state)}`;

    // Absolutely disable caching so you never get a stale widget page
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    // If you explicitly want the in-page embed, call .../start?state=...&mode=embed
    if ((req.query.mode || "").toString() === "embed") {
      if (!BOT_NAME) {
        return res
          .status(500)
          .send("Set TELEGRAM_BOT_NAME (without @) to use embed mode.");
      }
      const authUrl = `/auth/telegram/callback?state=${encodeURIComponent(state)}`;
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
    .card{max-width:520px;margin:0 auto;padding:24px;border-radius:16px;background:#0f1a2b;box-shadow:0 10px 30px rgba(0,0,0,.35)}
    h1{font-size:22px;margin:0 0 12px}
    p{opacity:.85}.muted{opacity:.6}
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
    <p class="muted">If the widget doesn't appear, set your bot domain to this origin in @BotFather via <b>/setdomain</b>.</p>
  </div>
</body>
</html>`);
    }

    // Recommended default: send user straight to Telegram's hosted page
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

/* -----------------------------------------------------------
   Legacy alias: /auth/telegram/verify → redirect to /callback
   ----------------------------------------------------------- */
router.get("/auth/telegram/verify", (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  res.redirect(302, `/auth/telegram/callback${qs ? `?${qs}` : ""}`);
});

/* =========================================================================
   GET /auth/telegram/callback — verify payload, save links, land on profile
   ========================================================================= */
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

    // Update users table
    await db.run(
      `UPDATE users
         SET telegramId = ?, telegramHandle = ?
       WHERE wallet = ?`,
      tgId,
      tgUsername,
      wallet
    );

    // Upsert social_links table
    await db.run(
      `INSERT INTO social_links (wallet, twitter, telegram, discord)
       VALUES (?, NULL, ?, NULL)
       ON CONFLICT(wallet) DO UPDATE SET
         telegram = excluded.telegram,
         updated_at = CURRENT_TIMESTAMP`,
      wallet,
      tgUsername
    );

    // Final success: back to profile (same tab)
    return res.redirect(`${FRONTEND_URL}/profile?linked=telegram`);
  } catch (e) {
    console.error("Telegram callback error:", e);
    return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=server`);
  }
});

export default router;
