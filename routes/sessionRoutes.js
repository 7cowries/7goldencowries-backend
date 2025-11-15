// routes/sessionRoutes.js
import express from "express";
import { bindWalletSession, logoutSession } from "../lib/session.js";
import { getProfile } from "../lib/user.js";

const router = express.Router();

// POST /api/auth/wallet/session
router.post("/api/auth/wallet/session", async (req, res, next) => {
  try {
    const address = (req.body.address || "").trim();
    if (!address) {
      return res.status(400).json({ ok: false, error: "wallet address required" });
    }
    const result = await bindWalletSession(address);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/wallet/logout
router.post("/api/auth/wallet/logout", async (req, res, next) => {
  try {
    const wallet = (req.body.wallet || "").trim();
    if (!wallet) {
      return res.status(400).json({ ok: false, error: "wallet required" });
    }
    await logoutSession(wallet);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/session/logout
router.post("/api/auth/session/logout", async (req, res, next) => {
  try {
    const wallet = (req.body.wallet || "").trim();
    if (!wallet) {
      return res.status(400).json({ ok: false, error: "wallet required" });
    }
    await logoutSession(wallet);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/me
router.get("/api/me", async (req, res, next) => {
  try {
    const profile = await getProfile(req.session.userId);
    if (!profile) {
      return res.status(404).json({ ok: false, error: "user_not_found" });
    }
    res.json({ ok: true, user: profile });
  } catch (err) {
    next(err);
  }
});

export default router;
