// routes/sessionRoutes.js
import express from "express";
import db from "../db.js";

const r = express.Router();
const cooldown = new Map();

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

    if (req.session.wallet && req.session.wallet === w) {
      return res.json({ ok: true, bound: true });
    }

    const key = req.sessionID || req.ip;
    const now = Date.now();
    const last = cooldown.get(key) || 0;
    if (now - last < 4000) {
      return res.json({ ok: true, bound: true });
    }
    cooldown.set(key, now);

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
            const upd = await db.run(
              "UPDATE users SET referred_by=?, updatedAt=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE wallet=? AND referred_by IS NULL",
              [referrer.wallet, w]
            );
            if (upd.changes > 0) {
              const ins = await db.run(
                "INSERT OR IGNORE INTO completed_quests (wallet, quest_id, timestamp) VALUES (?, 'REFERRAL_BONUS', strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                referrer.wallet
              );
              if (ins.changes > 0) {
                await db.run(
                  "UPDATE users SET xp = COALESCE(xp,0) + 50, updatedAt=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE wallet = ?",
                  referrer.wallet
                );
              }
            }
          }
        }
        await db.exec("COMMIT");
      } catch (err) {
        await db.exec("ROLLBACK");
        console.error("referral bind error", err);
      }
      res.clearCookie("referral_code", {
        httpOnly: true,
        sameSite: "none",
        secure: true,
      });
      req.session.referral_code = null;
    }

    res.json({ ok: true, wallet: w, bound: true });
  } catch (e) {
    console.error("bind-wallet error:", e);
    res.status(500).json({ error: "Failed to bind wallet" });
  }
});

export default r;
