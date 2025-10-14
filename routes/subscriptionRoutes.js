import express from "express";
import db from "../db.js";

const router = express.Router();

async function ensureSubscriptionSchema() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      wallet TEXT PRIMARY KEY,
      tier   TEXT NOT NULL,
      tonPaid REAL,
      usdPaid REAL,
      createdAt TEXT DEFAULT (datetime('now'))
    );
  `);
}

/** GET /subscriptions/status */
router.get("/subscriptions/status", async (req, res) => {
  try {
    await ensureSubscriptionSchema();
    const uid = req.session?.userId;
    if (!uid) return res.json({ ok: true, active: false, tier: "Free" });
    const user = await db.get("SELECT subscriptionTier FROM users WHERE id = ?", [uid]);
    const tier = user?.subscriptionTier || "Free";
    return res.json({ ok: true, active: tier !== "Free", tier });
  } catch (e) {
    console.error("GET /subscriptions/status error", e);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/** POST /subscriptions/subscribe  { tier, txHash, tonPaid, usdPaid } */
router.post("/subscriptions/subscribe", async (req, res) => {
  try {
    await ensureSubscriptionSchema();
    const uid = req.session?.userId;
    if (!uid) return res.status(401).json({ ok: false, error: "not_logged_in" });

    const user = await db.get("SELECT wallet FROM users WHERE id = ?", [uid]);
    if (!user) return res.status(404).json({ ok: false, error: "user_not_found" });

    const { tier = "Tier 1", txHash = null, tonPaid = null, usdPaid = null } = req.body || {};

    await db.run(
      `INSERT INTO subscriptions (wallet, tier, tonPaid, usdPaid)
       VALUES (?,?,?,?)
       ON CONFLICT(wallet) DO UPDATE SET tier=excluded.tier, tonPaid=excluded.tonPaid, usdPaid=excluded.usdPaid, createdAt=datetime('now')`,
      [user.wallet, tier, tonPaid, usdPaid]
    );

    await db.run("UPDATE users SET subscriptionTier = ? WHERE id = ?", [tier, uid]);

    return res.json({ ok: true, tier });
  } catch (e) {
    console.error("POST /subscriptions/subscribe error", e);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
