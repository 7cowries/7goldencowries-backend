// routes/sessionRoutes.js
import express from "express";
import { bindWalletSession, logoutSession } from "../lib/session.js";
import { getProfile } from "../lib/user.js";

const router = express.Router();

// POST /api/auth/wallet/session
router.post("/api/auth/wallet/session", async (req, res, next) => {
  try {
    const address = (req.body.address || req.body.wallet || "").trim();
    if (!address) {
      return res.status(400).json({ ok: false, error: "wallet address required" });
    }

    const result = await bindWalletSession(req, address);
    return req.session.save((err) => {
      if (err) return next(err);
      res.json({ ok: true, ...result });
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/wallet/logout
router.post("/api/auth/wallet/logout", async (req, res, next) => {
  try {
    const wallet = (req.body.wallet || req.session?.wallet || "").trim();
    await logoutSession(wallet);
    if (req.session) {
      req.session.wallet = null;
      req.session.userId = null;
    }
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
    const wallet = req.session?.userId || req.session?.wallet;
    if (!wallet) {
      return res.json({ ok: true, authed: false, user: null });
    }
    const profile = await getProfile(wallet);
    if (!profile) {
      return res.status(404).json({ ok: false, error: "user_not_found" });
    }
    res.json({ ok: true, authed: true, user: profile });
  } catch (err) {
    next(err);
  }
});

export default router;
