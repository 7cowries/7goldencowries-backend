import { Router } from "express";
import db from "../db.js";

const router = Router();

router.post("/auth/wallet/session", async (req, res) => {
  try {
    const address = String(req.body?.address || req.body?.wallet || "").trim();
    if (!address) return res.status(400).json({ ok: false, error: "address-required" });

    // Ensure user exists
    await db.run("INSERT OR IGNORE INTO users(wallet) VALUES(?)", address);
    const row = await db.get("SELECT wallet FROM users WHERE wallet=?", address);
    if (!row?.wallet) {
      return res.status(500).json({ ok: false, error: "user-not-materialized" });
    }

    // Set real session (use wallet as identifier; users table has no numeric id)
    req.session.userId = row.wallet;
    req.session.wallet = row.wallet;

    return res.json({ ok: true, address: row.wallet, session: "set", userId: row.wallet });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
