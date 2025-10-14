import { Router } from "express";
import db from "../db.js";

const router = Router();

router.post("/auth/wallet/session", async (req, res) => {
  try {
    const address = String(req.body?.address || req.body?.wallet || "").trim();
    if (!address) return res.status(400).json({ ok: false, error: "address-required" });

    // Ensure user exists
    await db.run("INSERT OR IGNORE INTO users(wallet) VALUES(?)", address);
    const row = await db.get("SELECT id FROM users WHERE wallet=?", address);
    if (!row?.id) return res.status(500).json({ ok:false, error:"user-not-materialized" });

    // Set real session
    req.session.userId = row.id;
    req.session.wallet = address;

    return res.json({ ok: true, address, session: "set", userId: row.id });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
