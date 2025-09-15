import { randomUUID } from "crypto";
import dayjs from "dayjs";
import express from "express";
import db from "../../lib/db.js";

const router = express.Router();

const TIERS = new Map([
  ["free", "Free"],
  ["tier 1", "Tier 1"],
  ["tier1", "Tier 1"],
  ["tier 2", "Tier 2"],
  ["tier2", "Tier 2"],
  ["tier 3", "Tier 3"],
  ["tier3", "Tier 3"],
]);

const SUBSCRIPTION_CHECKOUT_URL =
  process.env.SUBSCRIPTION_CHECKOUT_URL || "https://pay.7goldencowries.com/subscription";
const SUBSCRIPTION_CALLBACK_REDIRECT =
  process.env.SUBSCRIPTION_CALLBACK_REDIRECT ||
  `${process.env.FRONTEND_URL || "https://7goldencowries.com"}/subscription/callback`;

function normalizeTier(input) {
  if (!input) return null;
  const key = String(input).trim().toLowerCase();
  return TIERS.get(key) || null;
}

function buildCheckoutUrl(sessionId) {
  try {
    const url = new URL(SUBSCRIPTION_CHECKOUT_URL);
    url.searchParams.set("session", sessionId);
    return url.toString();
  } catch {
    return `https://pay.7goldencowries.com/subscription?session=${encodeURIComponent(sessionId)}`;
  }
}

function buildRedirectUrl(status, params = {}) {
  try {
    const url = new URL(SUBSCRIPTION_CALLBACK_REDIRECT);
    url.searchParams.set("status", status);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  } catch {
    const fallback = new URL("https://7goldencowries.com/subscription/callback");
    fallback.searchParams.set("status", status);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        fallback.searchParams.set(key, value);
      }
    }
    return fallback.toString();
  }
}

router.post("/subscribe", async (req, res) => {
  try {
    const wallet = req.body?.wallet ? String(req.body.wallet).trim() : "";
    const tier = normalizeTier(req.body?.tier);
    if (!wallet) {
      return res.status(400).json({ error: "wallet_required" });
    }
    if (!tier) {
      return res.status(400).json({ error: "invalid_tier" });
    }

    const sessionId = `sub_${randomUUID()}`;
    const sessionUrl = buildCheckoutUrl(sessionId);

    await db.run(
      `INSERT INTO subscriptions (wallet, tier, status, sessionId, timestamp)
       VALUES (?, ?, 'pending', ?, datetime('now'))`,
      wallet,
      tier,
      sessionId
    );

    return res.json({ sessionUrl, sessionId });
  } catch (err) {
    console.error("subscription subscribe error", err);
    return res.status(500).json({ error: "subscription_failed" });
  }
});

router.get("/callback", async (req, res) => {
  try {
    const sessionId = req.query.sessionId ? String(req.query.sessionId).trim() : "";
    if (!sessionId) {
      return res.redirect(buildRedirectUrl("error", { reason: "missing_session" }));
    }

    const record = await db.get(
      `SELECT id, wallet, tier FROM subscriptions WHERE sessionId = ? ORDER BY datetime(timestamp) DESC LIMIT 1`,
      sessionId
    );
    if (!record || !record.wallet) {
      return res.redirect(buildRedirectUrl("error", { sessionId, reason: "unknown_session" }));
    }

    const renewalDate = dayjs().add(30, "day").toISOString();

    await db.run(
      `UPDATE subscriptions SET status = 'active', renewalDate = ?, timestamp = datetime('now') WHERE id = ?`,
      renewalDate,
      record.id
    );

    await db.run(
      `INSERT INTO users (wallet, tier, updatedAt)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(wallet) DO UPDATE SET tier = excluded.tier, updatedAt = excluded.updatedAt`,
      record.wallet,
      record.tier
    );

    return res.redirect(
      buildRedirectUrl("success", {
        sessionId,
        wallet: record.wallet,
        tier: record.tier,
        renewalDate,
      })
    );
  } catch (err) {
    console.error("subscription callback error", err);
    return res.redirect(buildRedirectUrl("error", { reason: "callback_failed" }));
  }
});

export default router;
