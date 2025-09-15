import express from "express";
import db from "../lib/db.js";

const router = express.Router();

router.get("/:code", async (req, res) => {
  try {
    const code = String(req.params.code || "").trim();
    const CODE_RE = /^[A-Z0-9_-]{4,64}$/i;
    if (!code || !CODE_RE.test(code)) return res.json({ entries: [] });
    const rows = await db.all(
      `SELECT u.wallet, COALESCE(u.xp,0) AS xp, r.created_at AS joinedAt
         FROM referrals r
         JOIN users u ON u.id = r.referee_user_id
        WHERE r.code = ?
        ORDER BY r.created_at DESC
        LIMIT 100`,
      [code]
    );
    res.json({ entries: rows });
  } catch (e) {
    console.error("referral lookup error", e);
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
