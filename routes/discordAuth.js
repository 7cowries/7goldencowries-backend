// routes/discordAuth.js
import express from "express";
import fetch from "node-fetch";
import db from "../db.js";

const router = express.Router();

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

function b64d(s){ try { return Buffer.from(String(s||""), "base64").toString("utf8"); } catch { return ""; } }

// Step 1: redirect to Discord (scope: identify + guilds)
router.get("/discord", (req, res) => {
  const state = String(req.query.state || ""); // base64(wallet)
  const scope = encodeURIComponent("identify guilds");
  const url =
    `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code&scope=${scope}&state=${encodeURIComponent(state)}`;
  res.redirect(url);
});

// Step 2: callback -> exchange code -> fetch user -> save tokens
router.get("/discord/callback", async (req, res) => {
  try {
    const code = req.query.code;
    const wallet = b64d(req.query.state || "").trim();
    if (!code || !wallet) return res.status(400).send("Missing code or wallet");

    const tokRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });
    const tok = await tokRes.json();
    if (!tokRes.ok || !tok.access_token) {
      console.error("discord token error:", tok);
      return res.status(400).send("Discord token exchange failed");
    }

    const accessToken = tok.access_token;
    const refreshToken = tok.refresh_token || null;
    const expiresIn = Number(tok.expires_in || 3600);
    const tokenExpiresAt = Math.floor(Date.now()/1000) + expiresIn;

    const meRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const me = await meRes.json();
    if (!meRes.ok) {
      console.error("discord me error:", me);
      return res.status(400).send("Discord profile fetch failed");
    }

    const discordId = String(me.id);
    const discriminator = me.discriminator && me.discriminator !== "0" ? `#${me.discriminator}` : "";
    const discordHandle = me.username ? `${me.username}${discriminator}` : "";

    await db.run(
      `INSERT INTO users (wallet, discordId, discordHandle, discordAccessToken, discordRefreshToken, discordTokenExpiresAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(wallet) DO UPDATE SET
         discordId=excluded.discordId,
         discordHandle=excluded.discordHandle,
         discordAccessToken=excluded.discordAccessToken,
         discordRefreshToken=excluded.discordRefreshToken,
         discordTokenExpiresAt=excluded.discordTokenExpiresAt`,
      wallet, discordId, discordHandle, accessToken, refreshToken, tokenExpiresAt
    );

    res.redirect(`${FRONTEND_URL}/profile?linked=discord`);
  } catch (e) {
    console.error(e);
    res.status(500).send("Discord auth failed");
  }
});

export default router;
