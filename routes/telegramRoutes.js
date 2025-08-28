// routes/telegramRoutes.js
import express from "express";
import crypto from "crypto";
import db from "../db.js";

const router = express.Router();

const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME; // e.g. GOLDENCOWRIEBOT
const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN;    // from @BotFather
const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  process.env.CLIENT_URL ||
  "https://7goldencowries.com";

function baseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}
function decodeState(s) {
  try { return decodeURIComponent(Buffer.from(String(s || ""), "base64").toString("utf8")); }
  catch { return ""; }
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
function verifyTelegram(data, botToken) {
  const { hash, ...rest } = data;
  const checkString = Object.keys(rest).sort().map((k) => `${k}=${rest[k]}`).join("\n");
  const secret = crypto.createHash("sha256").update(botToken).digest();
  const hmac   = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  return hmac === hash;
}

/* GET /auth/telegram/start — widget page */
router.get("/auth/telegram/start", async (req, res) => {
  if (!BOT_USERNAME || !BOT_TOKEN) {
    return res.status(500).send("Telegram not configured: set TELEGRAM_BOT_USERNAME and TELEGRAM_BOT_TOKEN");
  }
  const state = req.query.state || "";
  const authUrl = `${baseUrl(req)}/auth/telegram/callback?state=${encodeURIComponent(state)}`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Connect Telegram</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Arial,sans-serif;background:#0a1620;color:#e6fff6;display:flex;min-height:100vh;align-items:center;justify-content:center}
    .box{background:#0f1f2b;border:1px solid #173344;padding:24px 20px;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.35);text-align:center}
    small{opacity:.8}
  </style>
</head>
<body>
  <div class="box">
    <h2>Connect Telegram</h2>
    <p>Tap the button to authorize with Telegram. You’ll be sent back automatically.</p>
    <script async src="https://telegram.org/js/telegram-widget.js?22"
      data-telegram-login="${BOT_USERNAME}"
      data-size="large"
      data-auth-url="${authUrl}"
      data-request-access="write"></script>
    <p><small>If nothing happens after auth, please close this tab.</small></p>
  </div>
</body>
</html>`);
});

/* GET /auth/telegram/callback — verify, save, redirect/popup-close */
router.get("/auth/telegram/callback", async (req, res) => {
  try {
    if (!BOT_TOKEN) throw new Error("Missing bot token");
    const wallet = decodeState(req.query.state || "");
    if (!wallet) return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=nostate`);

    if (!verifyTelegram(req.query, BOT_TOKEN)) {
      return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=bad_sig`);
    }

    const tgId       = String(req.query.id || "");
    const tgUsername = String(req.query.username || "");

    await ensureUser(wallet);

    await db.run(
      `UPDATE users
         SET telegramId = ?, telegramHandle = ?
       WHERE wallet = ?`,
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

    // ✅ On success, close popup and notify opener, else fallback to redirect
    return res.send(`
      <script>
        if (window.opener) {
          window.opener.postMessage('telegram-linked', '*');
          window.close();
        } else {
          window.location = "${FRONTEND_URL}/profile?linked=telegram";
        }
      </script>
      <p style="font-family:sans-serif;text-align:center;margin-top:2em;">Telegram linked! You may close this window.</p>
    `);

  } catch (e) {
    console.error("Telegram callback error:", e);
    return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=server`);
  }
});

export default router;