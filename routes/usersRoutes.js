import express from "express";
import db from "../db.js";

const router = express.Router();

/**
 * GET /api/users/me
 * Reads wallet from session; falls back to ?wallet=.
 * Returns the same shape as /api/profile?wallet=... so frontend "getMe" works.
 */
router.get("/me", async (req, res) => {
  try {
    const wallet =
      req.session?.wallet || (req.query.wallet ? String(req.query.wallet) : null);
    if (!wallet) return res.status(400).json({ error: "Missing wallet address" });

    const profile = await db.get(
      `SELECT wallet, xp, levelName as level, levelProgress
         FROM users WHERE wallet = ?`,
      [wallet]
    );

    const data = profile || { wallet, xp: 0, level: "Shellborn", levelProgress: 0 };
    return res.json(data);
  } catch (e) {
    console.error("GET /api/users/me error", e);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
