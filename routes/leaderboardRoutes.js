import express from "express";
import db from "../db.js";

const router = express.Router();

/** GET /leaderboard  -> top 100 users by xp */
router.get("/leaderboard", async (_req, res) => {
  try {
    const rows = await db.all(
      "SELECT wallet, xp FROM users ORDER BY xp DESC LIMIT 100"
    );
    const leaderboard = rows.map((r, i) => ({ rank: i + 1, wallet: r.wallet, xp: r.xp }));
    return res.json({ ok: true, leaderboard });
  } catch (e) {
    console.error("GET /leaderboard error", e);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
