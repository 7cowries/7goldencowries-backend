import express from "express";
import db from "../../lib/db.js";
import { verifyTonPayment } from "../../lib/ton.js";
import { getSessionWallet } from "../../utils/session.js";

const router = express.Router();

const RECEIVE_ADDRESS = process.env.TON_RECEIVE_ADDRESS || "";
const COMMENT_TOKEN = "7GC-SUB";
const DEFAULT_TIER = "Tier 1";
const TIER_LABELS = new Map([
  ["free", "Free"],
  ["tier1", "Tier 1"],
  ["tier 1", "Tier 1"],
  ["tier2", "Tier 2"],
  ["tier 2", "Tier 2"],
  ["tier3", "Tier 3"],
  ["tier 3", "Tier 3"],
]);
const CONFIGURED_MIN = Number(
  process.env.TON_MIN_PAYMENT_TON ||
    process.env.SUBSCRIPTION_MIN_TON ||
    process.env.TON_MIN_TON ||
    0
);

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value === "1" || value.toLowerCase() === "true";
  return false;
}

function normalizeTier(input) {
  if (!input) return null;
  const normalized = String(input).trim().toLowerCase();
  return TIER_LABELS.get(normalized) || null;
}

router.get("/status", async (req, res) => {
  try {
    const wallet = getSessionWallet(req);
    if (!wallet) {
      return res.json({ paid: false });
    }
    const row = await db.get("SELECT paid FROM users WHERE wallet = ?", wallet);
    return res.json({ paid: toBoolean(row?.paid) });
  } catch (err) {
    console.error("payments status error", err);
    return res.status(500).json({ error: "status_failed" });
  }
});

router.post("/verify", async (req, res) => {
  try {
    const wallet = getSessionWallet(req);
    if (!wallet) {
      return res.status(401).json({ error: "wallet_required" });
    }

    const txHash = String(req.body?.txHash || req.body?.hash || "").trim();
    if (!txHash) {
      return res.status(400).json({ error: "tx_required" });
    }

    const minAmount = CONFIGURED_MIN > 0 ? CONFIGURED_MIN : Number(req.body?.amount || 0);
    const tier = normalizeTier(req.body?.tier) || DEFAULT_TIER;
    const verification = await verifyTonPayment({
      txHash,
      to: RECEIVE_ADDRESS,
      from: wallet,
      minAmount,
      comment: COMMENT_TOKEN,
    });

    if (!verification?.verified) {
      const status = verification?.reason || "unverified";
      return res.status(422).json({ verified: false, reason: status });
    }

    const normalizedWallet = verification.from || wallet;
    if (normalizedWallet && normalizedWallet !== wallet) {
      req.session.wallet = normalizedWallet;
    }

    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO users (wallet, paid, lastPaymentAt, subscriptionTier, subscriptionPaidAt, updatedAt)
       VALUES (?, 1, ?, ?, ?, ?)
       ON CONFLICT(wallet) DO UPDATE SET
         paid = 1,
         lastPaymentAt = excluded.lastPaymentAt,
         subscriptionTier = excluded.subscriptionTier,
         subscriptionPaidAt = excluded.subscriptionPaidAt,
         updatedAt = excluded.updatedAt`,
      normalizedWallet,
      now,
      tier,
      now,
      now
    );

    return res.json({
      verified: true,
      amount: verification.amount,
      to: verification.to,
      from: verification.from,
      comment: verification.comment,
      tier,
    });
  } catch (err) {
    console.error("payments verify error", err);
    return res.status(500).json({ error: "verification_failed" });
  }
});

export default router;
