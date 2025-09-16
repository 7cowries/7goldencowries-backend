// routes/sessionRoutes.js
import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import db from "../lib/db.js";

const r = express.Router();
const bindLimiter = rateLimit({
  windowMs: 4000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req)}:${req.sessionID || ""}`,
  handler: (_req, res) => res.status(429).json({ error: "Too many requests" }),
});

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
r.post("/bind-wallet", bindLimiter, async (req, res) => {
  try {
    const w = String(req.body?.wallet || "").trim();
    if (!w) return res.status(400).json({ error: "Missing wallet" });

    if (req.session.wallet && req.session.wallet === w) {
      return res.json({ ok: true, bound: true });
    }

    req.session.wallet = w;
    if (req.session.save) req.session.save(() => {});

    await ensureUser(w);

    const refCode = req.cookies?.referral_code || req.session?.referral_code;
    const codeRe = /^[A-Z0-9_-]{4,64}$/i;
    if (refCode && codeRe.test(refCode)) {
      try {
        await db.exec("BEGIN");
        const existing = await db.get(
          "SELECT referred_by FROM users WHERE wallet = ?",
          w
        );
        if (!existing?.referred_by) {
          const referrer = await db.get(
            "SELECT wallet FROM users WHERE referral_code = ?",
            refCode
          );
          if (referrer && referrer.wallet !== w) {
            await db.run(
              "UPDATE users SET referred_by=?, updatedAt=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE wallet=? AND referred_by IS NULL",
              [referrer.wallet, w]
            );
          }
        }
        await db.exec("COMMIT");
      } catch (err) {
        await db.exec("ROLLBACK");
        console.error("referral bind error", err);
      }
      req.session.referral_code = refCode;
    }

    res.json({ ok: true, wallet: w, bound: true });
  } catch (e) {
    console.error("bind-wallet error:", e);
    res.status(500).json({ error: "Failed to bind wallet" });
  }
});

r.post("/disconnect", (req, res) => {
  if (req.session) {
    req.session.wallet = null;
    if (req.session.user) {
      delete req.session.user;
    }
    if (req.session.save) {
      req.session.save(() => {});
    }
  }
  res.json({ ok: true });
});

export default r;
