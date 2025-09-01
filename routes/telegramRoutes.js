// routes/telegramRoutes.js
import express from "express";
import crypto from "crypto";
import db from "../db.js";

const router = express.Router();

// --- Env ---
const BOT_USERNAME =
  process.env.TELEGRAM_BOT_USERNAME ||
  process.env.TELEGRAM_BOT_NAME || "";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  process.env.CLIENT_URL ||
  "https://www.7goldencowries.com";

// Max age for telegram login payload (seconds). Prevents replay.
const AUTH_MAX_AGE = Number(process.env.TELEGRAM_AUTH_MAX_AGE ?? 300); // 5 min default

// --- Helpers ---
function decodeState(s) {
  try {
    return decodeURIComponent(
      Buffer.from(String(s || ""), "base64").toString("utf8")
    );
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

  const proto = String(req.headers["x-forwarded-proto"] || "https")
    .split(",")[0]
    .trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim()
    .replace(/:\d+$/, "");
  return host ? `${proto}://${host}` : "";
}

const FRONTEND_ORIGIN = originOf(FRONTEND_URL);

// ------------------------------------------------------------------
// GET /auth/telegram/start — serve Telegram widget page
// ------------------------------------------------------------------
router.get("/auth/telegram/start", async (req, res) => {
  if (!BOT_USERNAME || !BOT_TOKEN) {
    return res
      .status(500)
      .send("Telegram not configured: set TELEGRAM_BOT_USERNAME/NAME and TELEGRAM_BOT_TOKEN");
  }

  const state = req.query.state || "";
  const origin = resolveFrontendOrigin(req) || "https://www.7goldencowries.com";
  const authUrl = `${origin}/auth/telegram/callback?state=${encodeURIComponent(state)}`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Connect Telegram</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Arial,sans-serif;background:#0a1620;color:#e6fff6;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
    .box{background:#0f1f2b;border:1px solid #173344;padding:24px 20px;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.35);text-align:center;max-width:520px}
    h2{margin:0 0 10px}
    small{opacity:.8}
  </style>
</head>
<body>
  <div class="box">
    <h2>Connect Telegram</h2>
    <p>Tap the button to authorize with Telegram. You’ll be sent back automatically.</p>
    <script async src="https://telegram.org/js/telegram-widget.js?22"
      data-telegram-login="${BOT_USERNAME}"
      data-size="medium"
      data-radius="14"
      data-auth-url="${authUrl}"
      data-request-access="write"></script>
    <p><small>If nothing happens after auth, you can close this tab.</small></p>
  </div>

  <script>
    // Ensure opener always gets message even if Telegram auto-closes fast
    window.addEventListener("message", (ev) => {
      if (ev.data === "telegram-linked" && window.opener) {
        try {
          window.opener.postMessage("telegram-linked", ${JSON.stringify(FRONTEND_ORIGIN || "*")});
          window.close();
        } catch (e) {
          console.error("PostMessage error", e);
        }
      }
    });
  </script>
</body>
</html>`);
});

// ------------------------------------------------------------------
// Legacy alias: /auth/telegram/verify → redirect to /callback
// ------------------------------------------------------------------
router.get("/auth/telegram/verify", (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  res.redirect(302, `/auth/telegram/callback${qs ? `?${qs}` : ""}`);
});

// ------------------------------------------------------------------
// GET /auth/telegram/callback — verify payload, save links, notify opener
// ------------------------------------------------------------------
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

    await db.run(
      `UPDATE users SET telegramId = ?, telegramHandle = ? WHERE wallet = ?`,
      tgId, tgUsername, wallet
    );

    await db.run(
      `INSERT INTO social_links (wallet, twitter, telegram, discord)
       VALUES (?, NULL, ?, NULL)
       ON CONFLICT(wallet) DO UPDATE SET
         telegram = excluded.telegram,
         updated_at = CURRENT_TIMESTAMP`,
      wallet, tgUsername
    );

    const targetOrigin = FRONTEND_ORIGIN || "*";
    return res.send(`
      <script>
        try {
          if (window.opener) {
            window.opener.postMessage('telegram-linked', ${JSON.stringify(targetOrigin)});
            window.close();
          } else {
            window.location = ${JSON.stringify(`${FRONTEND_URL}/profile?linked=telegram`)};
          }
        } catch (e) {
          window.location = ${JSON.stringify(`${FRONTEND_URL}/profile?linked=telegram`)};
        }
      </script>
      <noscript>
        <meta http-equiv="refresh" content="0;url=${FRONTEND_URL.replace(/"/g, "&quot;")}/profile?linked=telegram" />
      </noscript>
      <p style="font-family:sans-serif;text-align:center;margin-top:2em;">Telegram linked! You may close this window.</p>
    `);
  } catch (e) {
    console.error("Telegram callback error:", e);
    return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=server`);
  }
});

export default router;
