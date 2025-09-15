// routes/historyRoutes.js
import express from "express";
import db from "../lib/db.js";

const router = express.Router();

/**
 * GET /api/xp/history
 * - If session user exists, uses that wallet (req.user.wallet)
 * - Else, allow ?wallet=TON_ADDRESS
 * - Optional: ?limit=100&offset=0
 */
router.get("/api/xp/history", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);

    // Prefer session-bound wallet
    let wallet = req.user?.wallet;
    if (!wallet && req.query.wallet) wallet = String(req.query.wallet);

    if (!wallet) {
      return res.status(400).json({ error: "Missing wallet (connect or pass ?wallet=…)" });
    }

    // Map wallet -> user_id
    const user = await db.get("SELECT rowid AS id, * FROM users WHERE wallet = ?", wallet);
    if (!user) return res.json({ wallet, rows: [] });

    // Return newest first
    const rows = await db.all(
      `
      SELECT id, delta, reason, meta, created_at
      FROM xp_history
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `,
      user.id, limit, offset
    );

    // Parse meta JSON safely
    const parsed = rows.map((r) => {
      let meta = null;
      if (r.meta) {
        try { meta = JSON.parse(r.meta); } catch { meta = r.meta; }
      }
      return { ...r, meta };
    });

    res.json({ wallet, rows: parsed, limit, offset });
  } catch (e) {
    console.error("xp/history error:", e);
    res.status(500).json({ error: "Failed to load XP history" });
  }
});

/**
 * (Optional) Quest history (compat with your existing quest_history table)
 * GET /api/quests/history
 */
router.get("/api/quests/history", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);

    let wallet = req.user?.wallet;
    if (!wallet && req.query.wallet) wallet = String(req.query.wallet);
    if (!wallet) return res.status(400).json({ error: "Missing wallet" });

    const rows = await db.all(
      `
      SELECT id, quest_id, title, xp, completed_at, timestamp
      FROM quest_history
      WHERE wallet = ?
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `,
      wallet, limit, offset
    );

    res.json({ wallet, rows, limit, offset });
  } catch (e) {
    console.error("quests/history error:", e);
    res.status(500).json({ error: "Failed to load quest history" });
  }
});

export default router;
