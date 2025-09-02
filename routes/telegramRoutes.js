// routes/telegramRoutes.js
import express from "express";
import crypto from "crypto";
import db from "../db.js";

const router = express.Router();

/* ========= ENV ========= */
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
// Derive bot_id from token "123456789:ABC..."
const BOT_ID =
  process.env.TELEGRAM_BOT_ID ||
  (BOT_TOKEN.includes(":") ? BOT_TOKEN.split(":")[0] : "");
const BOT_NAME = (process.env.TELEGRAM_BOT_NAME || "").replace(/^@/, ""); // for embed
const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  process.env.CLIENT_URL ||
  "https://www.7goldencowries.com";

// AUTH_MAX_AGE (seconds). 0 disables time check (safe while you debug).
const AUTH_MAX_AGE = Number(process.env.TELEGRAM_AUTH_MAX_AGE ?? 0); // default: OFF

/* ========= HELPERS ========= */
function decodeState(s) {
  try {
    return decodeURIComponent(Buffer.from(String(s || ""), "base64").toString("utf8"));
  } catch {
    return String(s || "");
  }
}

/** HMAC check per Telegram docs:
 * https://core.telegram.org/widgets/login#checking-authorization
 */
function verifyTelegram(query, botToken) {
  const { hash, ...rest } = query;

  // Optional replay protection
  if (AUTH_MAX_AGE > 0 && rest.auth_date) {
    const nowSec = Math.floor(Date.now() / 1000);
    const skew = nowSec - Number(rest.auth_date);
    if (!Number.isFinite(skew) || skew < 0 || skew > AUTH_MAX_AGE) {
      console.warn(`[TG] auth_date too old or invalid. now=${nowSec} auth_date=${rest.auth_date} skew=${skew}s`);
      return false;
    }
  }

  const checkString = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("\n");

  const secret = crypto.createHash("sha256").update(botToken).digest();
  const hmac = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  const ok = hmac === hash;

  if (!ok) {
    console.error("[TG] HMAC mismatch: computed != provided hash");
  }
  return ok;
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
   → Default: 302 to Telegram hosted OAuth (best reliability)
   → Optional: ?mode=embed renders the JS widget on our page
   ========================================================================= */
router.get("/auth/telegram/start", (req, res) => {
  try {
    if (!BOT_TOKEN || !BOT_ID) {
      console.error("[TG] Missing TELEGRAM_BOT_TOKEN or unable to derive BOT_ID.");
      return res.status(500).send("Telegram not configured on server.");
    }

    // Wallet state (base64)
    const state = String(req.query.state || "");
    // Force origin to your production site (must match @BotFather /setdomain)
    const origin = "https://www.7goldencowries.com";
    // Telegram will return to the FRONTEND first (bridge), then the bridge redirects to backend verify
    const returnTo = `${origin}/auth/telegram/callback?state=${encodeURIComponent(state)}`;

    // no-cache headers for the widget page
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    // Embed mode (optional): render Telegram JS widget on our page
    if ((req.query.mode || "").toString() === "embed") {
      if (!BOT_NAME) {
        return res.status(500).send("Set TELEGRAM_BOT_NAME (without @) to use embed mode.");
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

    // Hosted OAuth (recommended)
    const tp = new URL("https://oauth.telegram.org/auth/push");
    tp.searchParams.set("bot_id", BOT_ID);
    tp.searchParams.set("origin", origin);
    tp.searchParams.set("embed", "1");
    tp.searchParams.set("request_access", "write");
    tp.searchParams.set("return_to", returnTo);

    console.log(`[TG] Start → bot_id=${BOT_ID}, origin=${origin}, return_to=${returnTo}`);
    return res.redirect(302, tp.toString());
  } catch (e) {
    console.error("Telegram /start error:", e);
    return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=start`);
  }
});

/* -----------------------------------------------------------
   Legacy alias: /auth/telegram/verify → redirect to /callback
   (Telegram widget can still point here; we just bounce it)
   ----------------------------------------------------------- */
router.get("/auth/telegram/verify", (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  res.redirect(302, `/auth/telegram/callback${qs ? `?${qs}` : ""}`);
});

/* =========================================================================
   GET /auth/telegram/callback — backend verification (from bridge)
   ========================================================================= */
router.get("/auth/telegram/callback", async (req, res) => {
  try {
    if (!BOT_TOKEN) {
      console.error("[TG] Missing TELEGRAM_BOT_TOKEN on server.");
      return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=server`);
    }

    // 1) Verify Telegram signature
    const ok = verifyTelegram(req.query, BOT_TOKEN);
    if (!ok) {
      // Helpful logs for setup issues (do not log secrets)
      console.error("[TG] Bad signature. Check that:");
      console.error("  - TELEGRAM_BOT_TOKEN matches the bot used in widget.");
      console.error("  - @BotFather /setdomain is exactly https://www.7goldencowries.com");
      console.error("  - You're not stripping query params in the frontend bridge.");
      return res.redirect(`${FRONTEND_URL}/profile?err=bad_sig`);
    }

    // 2) Resolve wallet state
    const wallet = decodeState(req.query.state || "");
    if (!wallet) {
      console.error("[TG] Missing/invalid state → cannot map to wallet");
      return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=nostate`);
    }

    // 3) Persist
    const tgId = String(req.query.id || "");
    const tgUsername = String(req.query.username || "").replace(/^@/, "");
    await ensureUser(wallet);

    await db.run(
      `UPDATE users SET telegramId = ?, telegramHandle = ? WHERE wallet = ?`,
      tgId || null,
      tgUsername || null,
      wallet
    );

    await db.run(
      `INSERT INTO social_links (wallet, twitter, telegram, discord)
       VALUES (?, NULL, ?, NULL)
       ON CONFLICT(wallet) DO UPDATE SET
         telegram = excluded.telegram,
         updated_at = CURRENT_TIMESTAMP`,
      wallet,
      tgUsername || null
    );

    console.log(`[TG] Linked wallet=${wallet} ← tgId=${tgId} username=${tgUsername || "(none)"}`);
    return res.redirect(`${FRONTEND_URL}/profile?linked=telegram`);
  } catch (e) {
    console.error("Telegram callback error:", e);
    return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=server`);
  }
});

export default router;
