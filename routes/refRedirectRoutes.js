import express from "express";
import db from "../lib/db.js";
import { crossSiteCookieOptions } from "../utils/cookies.js";

const router = express.Router();

router.get("/ref/:code", async (req, res) => {
  try {
    const code = String(req.params.code || "").trim();
    if (!code) return res.status(404).json({ error: "Invalid code" });
    const row = await db.get("SELECT wallet FROM users WHERE referral_code = ?", [code]);
    if (!row) return res.status(404).json({ error: "Invalid code" });
    res.cookie(
      "referral_code",
      code,
      crossSiteCookieOptions({ maxAge: 2592000 * 1000 })
    );
    req.session.referral_code = code;
    const redirectUrl =
      process.env.FRONTEND_URL || "https://7goldencowries.com";
    return res.redirect(302, redirectUrl);
  } catch (e) {
    return res.status(500).json({ error: "Internal error" });
  }
});

router.get("/api/referral/status", async (req, res) => {
  try {
    const wallet = req.session?.wallet;
    if (!wallet) {
      return res.json({
        referral_code: null,
        referred_by: null,
        referrerWallet: null,
      });
    }
    const row = await db.get(
      "SELECT referral_code, referred_by FROM users WHERE wallet = ?",
      [wallet]
    );
    return res.json({
      referral_code: row?.referral_code || null,
      referred_by: row?.referred_by || null,
      referrerWallet: row?.referred_by || null,
    });
  } catch (e) {
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
