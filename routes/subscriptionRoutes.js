// routes/subscriptionRoutes.js
import express from "express";
import db from "../lib/db.js";

const router = express.Router();

/**
 * Ensure subscriptions table exists (safe if already migrated).
 * NOTE: If the real table with more columns already exists (as in your migrations),
 * this CREATE TABLE IF NOT EXISTS is a no-op in SQLite.
 */
async function ensureSubscriptionSchema() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'Free',
      active INTEGER NOT NULL DEFAULT 0,
      provider TEXT,
      tx_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      timestamp TEXT,
      tonAmount REAL,
      usdAmount REAL,
      sessionId TEXT,
      renewalDate TEXT,
      nonce TEXT,
      sessionCreatedAt TEXT,
      status TEXT DEFAULT 'pending'
    );
  `);
}

function normalizeTier(row) {
  const tier =
    row?.subscriptionTier ||
    row?.tier ||
    "Free";
  return tier || "Free";
}

/**
 * GET /subscriptions/status
 * Returns the user's current subscription tier and whether it's active.
 *
 * Response:
 *   { ok: true, active: boolean, tier: "Free" | "Tier 1" | "Tier 2" | "Tier 3" }
 */
router.get("/subscriptions/status", async (req, res) => {
  try {
    await ensureSubscriptionSchema();

    const uid = req.session?.userId;
    if (!uid) {
      // Not logged in: treat as Free, not active
      return res.json({ ok: true, active: false, tier: "Free" });
    }

    const user = await db.get(
      "SELECT subscriptionTier, tier FROM users WHERE id = ?",
      uid
    );
    const tier = normalizeTier(user);
    const active = tier !== "Free";

    return res.json({ ok: true, active, tier });
  } catch (e) {
    console.error("GET /subscriptions/status error", e);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/**
 * POST /subscriptions/subscribe
 * Body: { tier, txHash, tonPaid, usdPaid }
 *
 * Writes into subscriptions table and updates users.subscriptionTier.
 */
router.post("/subscriptions/subscribe", async (req, res) => {
  try {
    await ensureSubscriptionSchema();

    const uid = req.session?.userId;
    if (!uid) {
      return res.status(401).json({ ok: false, error: "not_logged_in" });
    }

    const user = await db.get(
      "SELECT id, wallet, subscriptionTier, tier FROM users WHERE id = ?",
      uid
    );
    if (!user?.wallet) {
      return res.status(404).json({ ok: false, error: "user_not_found" });
    }

    const {
      tier: rawTier = "Tier 1",
      txHash = null,
      tonPaid = null,
      usdPaid = null,
    } = req.body || {};

    const tier = String(rawTier || "Tier 1");

    // Upsert into subscriptions table keyed by wallet
    const existing = await db.get(
      "SELECT id FROM subscriptions WHERE wallet = ?",
      user.wallet
    );

    if (existing?.id) {
      await db.run(
        `
        UPDATE subscriptions
           SET tier        = ?,
               active      = 1,
               provider    = COALESCE(provider, 'ton'),
               tx_id       = ?,
               tonAmount   = ?,
               usdAmount   = ?,
               status      = 'active',
               updated_at  = datetime('now')
         WHERE id = ?`,
        tier,
        txHash,
        tonPaid,
        usdPaid,
        existing.id
      );
    } else {
      await db.run(
        `
        INSERT INTO subscriptions
          (wallet, tier, active, provider, tx_id, tonAmount, usdAmount, status, created_at, updated_at)
        VALUES
          (?,      ?,    1,      'ton',   ?,     ?,        ?,        'active', datetime('now'), datetime('now'))`,
        user.wallet,
        tier,
        txHash,
        tonPaid,
        usdPaid
      );
    }

    // Also reflect tier on users table (subscriptionTier is canonical)
    await db.run(
      "UPDATE users SET subscriptionTier = ?, tier = ? WHERE id = ?",
      tier,
      tier,
      uid
    );

    return res.json({ ok: true, tier });
  } catch (e) {
    console.error("POST /subscriptions/subscribe error", e);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/**
 * POST /subscriptions/claim-bonus
 * Simple idempotent bonus marker for subscribers.
 * For now we:
 *   - Require logged in + non-Free tier
 *   - Mark subscriptionClaimedAt on users
 *   - Return shape the frontend can handle
 *
 * Response (examples):
 *   { ok: true, awarded: 0, already: true }
 *   { ok: true, awarded: 0 }
 *   { ok: false, error: "no_active_subscription" }
 */
router.post("/subscriptions/claim-bonus", async (req, res) => {
  try {
    const uid = req.session?.userId;
    if (!uid) {
      return res.status(401).json({ ok: false, error: "not_logged_in" });
    }

    const user = await db.get(
      `
      SELECT id, wallet, subscriptionTier, tier, subscriptionClaimedAt
        FROM users
       WHERE id = ?`,
      uid
    );
    const tier = normalizeTier(user);

    if (!user?.wallet || tier === "Free") {
      return res
        .status(400)
        .json({ ok: false, error: "no_active_subscription" });
    }

    if (user.subscriptionClaimedAt) {
      // Already claimed; keep idempotent
      return res.json({ ok: true, awarded: 0, already: true });
    }

    // Mark claimed; XP bonus can be added here later if desired
    await db.run(
      `UPDATE users
          SET subscriptionClaimedAt = datetime('now')
        WHERE id = ?`,
      uid
    );

    return res.json({ ok: true, awarded: 0 });
  } catch (e) {
    console.error("POST /subscriptions/claim-bonus error", e);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
