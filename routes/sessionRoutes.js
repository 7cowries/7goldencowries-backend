// routes/sessionRoutes.js
import express from "express";
import db from "../db.js";

const router = express.Router();

async function ensureUserByWallet(wallet) {
  let user = await db.get("SELECT * FROM users WHERE wallet = ?", [wallet]);
  if (!user) {
    await db.run("INSERT INTO users (wallet, xp) VALUES (?, ?)", [wallet, 0]);
    user = await db.get("SELECT * FROM users WHERE wallet = ?", [wallet]);
  }
  return user;
}

/** POST /auth/wallet/session  (we'll mount under /api and /) */
router.post("/auth/wallet/session", async (req, res) => {
  try {
    const wallet = (req.body?.wallet || "").trim();
    if (!wallet) return res.status(400).json({ ok: false, error: "wallet required" });

    const user = await ensureUserByWallet(wallet);
    req.session.userId = user.id;

    return res.json({
      ok: true,
      user: {
        id: user.id,
        wallet: user.wallet,
        xp: user.xp,
        levelName: user.levelName,
        levelProgress: user.levelProgress,
        subscriptionTier: user.subscriptionTier,
      },
    });
  } catch (e) {
    console.error("wallet/session error:", e);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/** GET /me  (we'll mount under /api and /) */
router.get("/me", async (req, res) => {
  try {
    const uid = req.session?.userId;
    if (!uid) return res.status(401).json({ ok: false, error: "not_logged_in" });

    const user = await db.get("SELECT * FROM users WHERE id = ?", [uid]);
    if (!user) return res.status(404).json({ ok: false, error: "user_not_found" });

    return res.json({
      ok: true,
      user: {
        id: user.id,
        wallet: user.wallet,
        xp: user.xp,
        levelName: user.levelName,
        levelProgress: user.levelProgress,
        subscriptionTier: user.subscriptionTier,
      },
    });
  } catch (e) {
    console.error("/me error:", e);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
