import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { Buffer } from "node:buffer";
import dayjs from "dayjs";
import express from "express";
import db from "../../lib/db.js";
import { verifySubscriptionSession } from "../../lib/paymentProvider.js";

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

const DEFAULT_CHECKOUT_URL = "https://pay.7goldencowries.com/subscription";
const DEFAULT_CALLBACK_REDIRECT = `${
  process.env.FRONTEND_URL || "https://7goldencowries.com"
}/subscription/callback`;

const DEFAULT_CHECKOUT_ALLOWLIST = [
  "https://pay.7goldencowries.com",
  "https://payments.7goldencowries.com",
  "https://checkout.7goldencowries.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const DEFAULT_CALLBACK_ALLOWLIST = [
  "https://7goldencowries.com",
  "https://www.7goldencowries.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function buildAllowlist(base, extraEnv) {
  const extras = (extraEnv || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...base, ...extras]);
}

const CHECKOUT_ALLOWLIST = buildAllowlist(
  DEFAULT_CHECKOUT_ALLOWLIST,
  process.env.SUBSCRIPTION_CHECKOUT_ALLOWLIST
);
const CALLBACK_ALLOWLIST = buildAllowlist(
  DEFAULT_CALLBACK_ALLOWLIST,
  process.env.SUBSCRIPTION_CALLBACK_ALLOWLIST
);

function sanitizeUrl(candidate, fallback, allowlist, label) {
  if (!candidate) return fallback;
  try {
    const url = new URL(candidate);
    if (allowlist.has(url.origin)) {
      return url.toString();
    }
    console.warn(
      `subscription ${label} url rejected (untrusted origin ${url.origin}), falling back to default`
    );
  } catch (err) {
    console.warn(`subscription ${label} url parse failed: ${err?.message}`);
  }
  return fallback;
}

const SUBSCRIPTION_CHECKOUT_URL = sanitizeUrl(
  process.env.SUBSCRIPTION_CHECKOUT_URL,
  DEFAULT_CHECKOUT_URL,
  CHECKOUT_ALLOWLIST,
  "checkout"
);
const SUBSCRIPTION_CALLBACK_REDIRECT = sanitizeUrl(
  process.env.SUBSCRIPTION_CALLBACK_REDIRECT,
  DEFAULT_CALLBACK_REDIRECT,
  CALLBACK_ALLOWLIST,
  "callback"
);

function normalizeTier(input) {
  if (!input) return null;
  const key = String(input).trim().toLowerCase();
  return TIERS.get(key) || null;
}

function buildCheckoutUrl(sessionId, nonce) {
  try {
    const url = new URL(SUBSCRIPTION_CHECKOUT_URL);
    url.searchParams.set("session", sessionId);
    if (nonce) {
      url.searchParams.set("nonce", nonce);
    }
    return url.toString();
  } catch {
    const base = new URL(DEFAULT_CHECKOUT_URL);
    base.searchParams.set("session", sessionId);
    if (nonce) {
      base.searchParams.set("nonce", nonce);
    }
    return base.toString();
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
    const nonce = randomUUID().replace(/-/g, "");
    const sessionCreatedAt = new Date().toISOString();
    const sessionUrl = buildCheckoutUrl(sessionId, nonce);

    await db.run(
      `INSERT INTO subscriptions (wallet, tier, status, sessionId, nonce, sessionCreatedAt, timestamp)
       VALUES (?, ?, 'pending', ?, ?, ?, datetime('now'))`,
      wallet,
      tier,
      sessionId,
      nonce,
      sessionCreatedAt
    );

    return res.json({ sessionUrl, sessionId });
  } catch (err) {
    console.error("subscription subscribe error", err);
    return res.status(500).json({ error: "subscription_failed" });
  }
});

const SUBSCRIPTION_WEBHOOK_SECRET = process.env.SUBSCRIPTION_WEBHOOK_SECRET || "";

function normalizeSignature(signature) {
  return signature.replace(/^sha256=/i, "").trim();
}

function verifySignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;
  const normalized = normalizeSignature(signature);
  let provided;
  try {
    provided = Buffer.from(normalized, "hex");
  } catch {
    return false;
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (expectedBuf.length !== provided.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, provided);
}

function isPaidStatus(status) {
  const normalized = String(status || "").toLowerCase();
  return ["paid", "succeeded", "success", "active", "complete", "completed"].some((token) =>
    normalized.includes(token)
  );
}

router.post("/callback", async (req, res) => {
  const correlationId = randomUUID().slice(0, 8);
  try {
    if (!SUBSCRIPTION_WEBHOOK_SECRET) {
      console.error(
        `[subscription-callback:${correlationId}] SUBSCRIPTION_WEBHOOK_SECRET is not configured`
      );
      return res.status(500).json({ error: "webhook_not_configured", correlationId });
    }

    const signature = req.get("x-signature") || req.get("X-Signature") || "";
    if (!signature) {
      console.warn(`[subscription-callback:${correlationId}] missing X-Signature header`);
      return res.status(401).json({ error: "signature_required", correlationId });
    }

    const rawBody = req.rawBody || "";
    if (!verifySignature(rawBody, signature, SUBSCRIPTION_WEBHOOK_SECRET)) {
      console.warn(`[subscription-callback:${correlationId}] invalid signature`);
      return res.status(401).json({ error: "invalid_signature", correlationId });
    }

    const sessionId = req.body?.sessionId ? String(req.body.sessionId).trim() : "";
    if (!sessionId) {
      console.warn(`[subscription-callback:${correlationId}] missing sessionId in payload`);
      return res.status(400).json({ error: "session_required", correlationId });
    }

    const record = await db.get(
      `SELECT id, wallet, tier, status, nonce FROM subscriptions WHERE sessionId = ? ORDER BY datetime(timestamp) DESC LIMIT 1`,
      sessionId
    );

    if (!record || !record.wallet) {
      console.warn(`[subscription-callback:${correlationId}] unknown session ${sessionId}`);
      return res.status(400).json({ error: "unknown_session", correlationId });
    }

    const payloadNonce = req.body?.nonce ? String(req.body.nonce).trim() : null;
    if (payloadNonce && record.nonce && payloadNonce !== record.nonce) {
      console.warn(`[subscription-callback:${correlationId}] nonce mismatch for ${sessionId}`);
      return res.status(400).json({ error: "nonce_mismatch", correlationId });
    }

    if (record.status === "active") {
      return res.json({
        ok: true,
        sessionId,
        status: "active",
        alreadyProcessed: true,
        redirect: buildRedirectUrl("success", {
          sessionId,
          wallet: record.wallet,
          tier: record.tier,
        }),
      });
    }

    const verification = await verifySubscriptionSession(sessionId, record.nonce);
    if (!verification?.ok || !isPaidStatus(verification.status)) {
      console.warn(
        `[subscription-callback:${correlationId}] provider status not ready (${verification?.status || "unknown"})`
      );
      return res.status(202).json({
        ok: false,
        status: verification?.status || "pending",
        correlationId,
      });
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

    return res.json({
      ok: true,
      sessionId,
      status: "active",
      wallet: record.wallet,
      tier: record.tier,
      renewalDate,
      redirect: buildRedirectUrl("success", {
        sessionId,
        wallet: record.wallet,
        tier: record.tier,
        renewalDate,
      }),
    });
  } catch (err) {
    console.error(`subscription callback error [${correlationId}]`, err);
    return res.status(500).json({ error: "callback_failed", correlationId });
  }
});

export default router;
