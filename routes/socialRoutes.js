import express from "express";
import crypto from "crypto";
import db from "../db.js";

const router = express.Router();
const FRONTEND_URL = process.env.FRONTEND_URL || "https://7goldencowries.com";

function safelyDecodeBase64(value) {
  if (!value) return null;
  try {
    return Buffer.from(String(value), "base64").toString("utf8");
  } catch {
    return null;
  }
}

function verifyTelegramLogin(query, botToken) {
  const { hash } = query;
  if (!hash || !botToken) return false;

  const TELEGRAM_FIELDS = [
    "id",
    "first_name",
    "last_name",
    "username",
    "photo_url",
    "auth_date",
  ];

  const parts = TELEGRAM_FIELDS
    .filter((k) => query[k] !== undefined)
    .map((k) => `${k}=${query[k]}`)
    .sort();

  if (process.env.NODE_ENV !== "production") {
    console.log("[telegram] fields", parts);
  }

  const dataCheckString = parts.join("\n");

  const secret = crypto.createHash("sha256").update(botToken).digest();
  const computed = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(String(hash), "hex");
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (process.env.NODE_ENV !== "production") {
    console.log("[telegram] verify", ok ? "success" : "fail");
  }

  return ok;
}

/** ---------- Twitter (temporary stub) ---------- */
router.get("/twitter", (_req, res) => {
  return res.status(501).json({ error: "Twitter OAuth not yet enabled on server" });
});
router.get("/twitter/callback", (_req, res) => {
  return res.redirect(FRONTEND_URL + "/profile?twitter=disabled");
});

/** ---------- Discord (temporary stub) ---------- */
router.get("/discord", (_req, res) => {
  return res.status(501).json({ error: "Discord OAuth not yet enabled on server" });
});
router.get("/discord/callback", (_req, res) => {
  return res.redirect(FRONTEND_URL + "/profile?discord=disabled");
});

/** ---------- Telegram (real callback) ----------
 * Telegram Login Widget sends GET with query params.
 * Verify HMAC per Telegram docs using TELEGRAM_BOT_TOKEN.
 * On success, attach telegram_username to the session user (by wallet) and redirect back.
 */
router.get("/telegram/callback", async (req, res) => {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return res.status(500).send("Missing TELEGRAM_BOT_TOKEN");

    if (!verifyTelegramLogin(req.query, token)) {
      return res.status(401).send("Invalid Telegram login");
    }

    const maxAge = Number(process.env.TELEGRAM_AUTH_MAX_AGE || 60);
    const authDate = Number(req.query.auth_date || 0);
    if (maxAge && authDate && Math.floor(Date.now() / 1000) - authDate > maxAge) {
      return res.status(401).send("Telegram login expired");
    }

    const wallet =
      req.session?.wallet || safelyDecodeBase64(req.query.state) || null;
    const username = req.query.username || null;

    if (wallet) {
      try {
        await db.run(
          `UPDATE users SET telegram = COALESCE(?, telegram) WHERE wallet = ?`,
          [username, wallet]
        );
      } catch {
        /* ignore if column doesn't exist */
      }
    }

    if (req.session) {
      req.session.telegram_username = username;
    }

    return res.redirect(FRONTEND_URL + "/profile");
  } catch (e) {
    console.error("telegram/callback error", e);
    return res.redirect(FRONTEND_URL + "/profile");
  }
});

export default router;
