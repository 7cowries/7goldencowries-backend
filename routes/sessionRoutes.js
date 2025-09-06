// routes/sessionRoutes.js
import express from "express";
import db from "../db.js";

const r = express.Router();

/** Ensure the user row exists (first-time visitors) */
async function ensureUser(wallet) {
  const row = await db.get("SELECT wallet FROM users WHERE wallet = ?", wallet);
  if (!row) {
    await db.run(
      `INSERT INTO users (wallet, xp, tier, levelName, levelSymbol, levelProgress, nextXP, updatedAt)
       VALUES (?, 0, 'Free', 'Shellborn', '🐚', 0, 10000, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      wallet
    );
  }
}

/** POST /api/session/bind-wallet  { wallet } */
r.post("/bind-wallet", async (req, res) => {
  try {
    const w = String(req.body?.wallet || "").trim();
    if (!w) return res.status(400).json({ error: "Missing wallet" });

    // store in cookie-session (cross-site cookie already enabled in server.js)
    req.session.wallet = w;
    if (req.session.save) req.session.save(() => {});

    // make sure a user row exists
    await ensureUser(w);

    res.json({ ok: true, wallet: w });
  } catch (e) {
    console.error("bind-wallet error:", e);
    res.status(500).json({ error: "Failed to bind wallet" });
  }
});

export default r;
