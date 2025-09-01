// routes/telegramRoutes.js
import express from "express";
import crypto from "crypto";
import db from "../db.js";

const router = express.Router();

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  process.env.CLIENT_URL ||
  "https://www.7goldencowries.com";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const BOT_ID =
  process.env.TELEGRAM_BOT_ID ||
  (BOT_TOKEN.includes(":") ? BOT_TOKEN.split(":")[0] : "");
const AUTH_MAX_AGE = Number(process.env.TELEGRAM_AUTH_MAX_AGE ?? 300);

function originOf(u){ try{ return new URL(String(u)).origin; }catch{ return ""; } }
function resolveFrontendOrigin(req){
  const env = originOf(FRONTEND_URL);
  if (env) return env;
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host  = String(req.headers["x-forwarded-host"]  || req.headers.host || "")
    .split(",")[0].trim().replace(/:\d+$/, "");
  return host ? `${proto}://${host}` : "https://www.7goldencowries.com";
}
function decodeState(s){
  try { return decodeURIComponent(Buffer.from(String(s||""),"base64").toString("utf8")); }
  catch { return ""; }
}
async function ensureUser(wallet){
  if (!wallet) return;
  const row = await db.get("SELECT wallet FROM users WHERE wallet = ?", wallet);
  if (!row){
    await db.run(
      `INSERT INTO users (wallet, xp, tier, levelName, levelSymbol, levelProgress, nextXP)
       VALUES (?, 0, 'Free', 'Shellborn', '🐚', 0, 10000)`,
      wallet
    );
  }
}
function verifyTelegram(data, botToken){
  const { hash, ...rest } = data;
  if (AUTH_MAX_AGE > 0 && rest.auth_date){
    const now = Math.floor(Date.now()/1000);
    const skew = now - Number(rest.auth_date);
    if (!Number.isFinite(skew) || skew < 0 || skew > AUTH_MAX_AGE) return false;
  }
  const check = Object.keys(rest).sort().map(k=>`${k}=${rest[k]}`).join("\n");
  const secret = crypto.createHash("sha256").update(botToken).digest();
  const hmac = crypto.createHmac("sha256", secret).update(check).digest("hex");
  return hmac === hash;
}

// SAME-TAB start: send user straight to Telegram OAuth
router.get("/auth/telegram/start", (req, res) => {
  if (!BOT_TOKEN || !BOT_ID){
    return res.status(500).send("Telegram not configured: set TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_ID (or token with ':').");
  }
  const state  = String(req.query.state || "");
  const origin = resolveFrontendOrigin(req); // https://www.7goldencowries.com
  const returnTo = `${origin}/auth/telegram/callback?state=${encodeURIComponent(state)}`;

  const pushUrl =
    `https://oauth.telegram.org/auth/push` +
    `?bot_id=${encodeURIComponent(BOT_ID)}` +
    `&origin=${encodeURIComponent(origin)}` +
    `&embed=1` +
    `&request_access=write` +
    `&return_to=${encodeURIComponent(returnTo)}`;

  res.redirect(302, pushUrl);
});

// Callback: verify & link, then back to profile (same tab)
router.get("/auth/telegram/callback", async (req, res) => {
  try{
    if (!BOT_TOKEN) throw new Error("Missing bot token");
    const wallet = decodeState(req.query.state || "");
    if (!wallet) return res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=nostate`);
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
       ON CONFLICT(wallet) DO UPDATE SET telegram = excluded.telegram, updated_at = CURRENT_TIMESTAMP`,
      wallet, tgUsername
    );
    res.redirect(`${FRONTEND_URL}/profile?linked=telegram`);
  }catch(e){
    console.error("Telegram callback error:", e);
    res.redirect(`${FRONTEND_URL}/profile?linked=telegram&err=server`);
  }
});

export default router;
