import express from "express";
import db from "../lib/db.js";
import { getSessionWallet } from "../utils/session.js";

const router = express.Router();

function normalizeTier(raw) {
  const t = String(raw || "").trim().toLowerCase();
  if (["tier3", "tier 3", "3", "t3"].includes(t)) return "Tier 3";
  if (["tier2", "tier 2", "2", "t2"].includes(t)) return "Tier 2";
  if (["tier1", "tier 1", "1", "t1"].includes(t)) return "Tier 1";
  if (["free", "0"].includes(t)) return "Free";
  return "Tier 1";
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return 0;
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

router.get("/status", async (req, res) => {
  try {
    const wallet = getSessionWallet(req);
    if (!wallet) {
      return res.json({ ok: true, active: false, tier: "Free", paid: false });
    }

    const user = await db.get(
      `SELECT tier, subscriptionTier, paid, lastPaymentAt, subscriptionPaidAt, subscriptionClaimedAt
         FROM users WHERE wallet = ?`,
      wallet
    );
    const latestSub = await db.get(
      `SELECT tier, status, renewalDate, timestamp
         FROM subscriptions WHERE wallet = ?
         ORDER BY datetime(timestamp) DESC LIMIT 1`,
      wallet
    );

    const tier = user?.subscriptionTier || latestSub?.tier || "Free";
    const paid = Boolean(user?.paid) || (latestSub?.status || "").toLowerCase() === "active";
    const active = tier !== "Free" && paid;

    return res.json({
      ok: true,
      active,
      tier,
      subscriptionTier: tier,
      paid,
      renewalDate: latestSub?.renewalDate || null,
      lastPaymentAt: user?.subscriptionPaidAt || user?.lastPaymentAt || null,
      claimedAt: user?.subscriptionClaimedAt || null,
    });
  } catch (err) {
    console.error("GET /api/subscriptions/status error", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.post("/subscribe", async (req, res) => {
  try {
    const sessionWallet = getSessionWallet(req);
    const wallet = sessionWallet || (req.body?.wallet ? String(req.body.wallet).trim() : "");
    if (!wallet) {
      return res.status(401).json({ ok: false, error: "wallet_required" });
    }

    const tier = normalizeTier(req.body?.tier);
    const tonAmount = toNumber(req.body?.tonAmount ?? req.body?.tonPaid);
    const usdAmount = toNumber(req.body?.usdAmount ?? req.body?.usdPaid);
    const txHash = req.body?.txHash ? String(req.body.txHash).trim() : null;

    await db.run(
      `INSERT INTO users (wallet, subscriptionTier, tier, paid, lastPaymentAt, subscriptionPaidAt, updatedAt)
         VALUES (?, ?, ?, 1, datetime('now'), datetime('now'), datetime('now'))
         ON CONFLICT(wallet) DO UPDATE SET
           subscriptionTier = excluded.subscriptionTier,
           tier = excluded.tier,
           paid = 1,
           lastPaymentAt = excluded.lastPaymentAt,
           subscriptionPaidAt = excluded.subscriptionPaidAt,
           updatedAt = excluded.updatedAt`,
      wallet,
      tier,
      tier
    );

    await db.run(
      `INSERT INTO subscriptions (wallet, tier, tonAmount, usdAmount, status, tx_hash, timestamp)
         VALUES (?, ?, ?, ?, 'active', ?, datetime('now'))`,
      wallet,
      tier,
      tonAmount,
      usdAmount,
      txHash
    );

    if (!sessionWallet) {
      req.session.wallet = wallet;
    }

    return res.json({ ok: true, tier, wallet });
  } catch (err) {
    console.error("POST /api/subscriptions/subscribe error", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.get("/:wallet", async (req, res) => {
  const { wallet } = req.params;
  if (!wallet) return res.status(400).json({ ok: false, error: "wallet_required" });

  try {
    const rows = await db.all(
      `SELECT
          tier,
          COALESCE(ton_amount, tonAmount, 0)          AS tonAmount,
          COALESCE(usdAmount, 0)                      AS usdAmount,
          COALESCE(tx_hash, txHash, tx_id)            AS txHash,
          status,
          timestamp                                   AS startDate,
          datetime(timestamp, '+30 days')             AS expiryDate,
          renewalDate
        FROM subscriptions
        WHERE wallet = ?
        ORDER BY datetime(timestamp) DESC`,
      wallet
    );

    return res.json({ ok: true, subscriptions: rows });
  } catch (err) {
    console.error("GET /api/subscriptions/:wallet error", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
