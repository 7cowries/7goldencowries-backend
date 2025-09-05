import express from "express";
import crypto from "crypto";
import db from "../db.js";

const router = express.Router();
const FRONTEND_URL = process.env.FRONTEND_URL || "https://7goldencowries.com";

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

    const entries = Object.entries(req.query)
      .filter(([k]) => k !== "hash")
      .map(([k, v]) => `${k}=${v}`)
      .sort();
    const dataCheckString = entries.join("\n");

    const secret = crypto.createHash("sha256").update(token).digest();
    const hmac = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

    if (hmac !== String(req.query.hash)) {
      return res.status(401).send("Invalid Telegram login");
    }

    const maxAge = Number(process.env.TELEGRAM_AUTH_MAX_AGE || 60);
    const authDate = Number(req.query.auth_date || 0);
    if (maxAge && authDate && Math.floor(Date.now() / 1000) - authDate > maxAge) {
      return res.status(401).send("Telegram login expired");
    }

    const wallet = req.session?.wallet || null;
    if (!wallet) {
      req.session.telegram_username = req.query.username || null;
      return res.redirect(FRONTEND_URL + "/profile?telegram=pending");
    }

    const username = req.query.username || null;

    try {
      await db.run(
        `UPDATE users SET telegram = COALESCE(?, telegram) WHERE wallet = ?`,
        [username, wallet]
      );
    } catch {
      /* ignore if column doesn't exist */
    }

    req.session.telegram_username = username;
    return res.redirect(FRONTEND_URL + "/profile?telegram=connected");
  } catch (e) {
    console.error("telegram/callback error", e);
    return res.redirect(FRONTEND_URL + "/profile?telegram=error");
  }
});

export default router;
