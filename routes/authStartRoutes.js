import express from "express";
import crypto from "crypto";
import passport from "../passport.js";
import { getSessionWallet } from "../utils/session.js";

const router = express.Router();

router.get("/twitter/start", (req, res, next) => {
  const wallet = getSessionWallet(req);
  if (!wallet) return res.status(400).json({ error: "Missing wallet address" });
  passport.authenticate("twitter")(req, res, next);
});

router.get("/discord/start", (req, res) => {
  const wallet = getSessionWallet(req);
  if (!wallet) return res.status(400).json({ error: "Missing wallet address" });
  const state = crypto.randomBytes(16).toString("hex");
  req.session.discord_state = state;
  const cid = process.env.DISCORD_CLIENT_ID;
  const redirectUri =
    process.env.DISCORD_REDIRECT_URI ||
    "https://sevengoldencowries-backend.onrender.com/auth/discord/callback";
  const url =
    `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(cid)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=identify` +
    `&state=${encodeURIComponent(state)}`;
  return res.redirect(url);
});

router.get("/telegram/start", (req, res) => {
  const wallet = getSessionWallet(req);
  if (!wallet) return res.status(400).json({ error: "Missing wallet address" });
  const bot = process.env.TELEGRAM_BOT_USERNAME;
  if (!bot) return res.status(500).json({ error: "telegram_not_configured" });
  const url = `https://t.me/${bot}?start=login`;
  return res.redirect(url);
});

export default router;
