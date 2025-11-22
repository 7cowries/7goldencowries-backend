import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { Buffer } from "node:buffer";
import dayjs from "dayjs";
import express from "express";
import rateLimit from "express-rate-limit";
import db from "../../lib/db.js";
import { getWebhookRateLimitOptions } from "../../config/rateLimits.js";
import { getRequiredEnv } from "../../config/env.js";
import { verifySubscriptionSession } from "../../lib/paymentProvider.js";
import { getSessionWallet } from "../../utils/session.js";
import { grantXP } from "../../lib/grantXP.js";
import { jsonError, jsonOk } from "../../utils/apiResponse.js";

const router = express.Router();

const SUBSCRIPTION_BONUS_XP = Math.max(0, Number(process.env.SUBSCRIPTION_BONUS_XP || 120));
const DEFAULT_SUBSCRIPTION_TIER = "Tier 1";

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
  }
  return false;
}

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
    const sessionWallet = getSessionWallet(req);
    const walletFromBody = req.body?.wallet ? String(req.body.wallet).trim() : "";
    const wallet = sessionWallet || walletFromBody;
    const tier = normalizeTier(req.body?.tier) || DEFAULT_SUBSCRIPTION_TIER;
    if (!wallet) {
      return jsonError(res, "wallet_required", "Wallet session required.", {
        status: 401,
      });
    }
    if (!tier) {
      return jsonError(res, "invalid_tier", "Invalid subscription tier.", {
        status: 400,
      });
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

    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO users (wallet, subscriptionTier, updatedAt)
       VALUES (?, ?, ?)
       ON CONFLICT(wallet) DO UPDATE SET subscriptionTier = excluded.subscriptionTier, updatedAt = excluded.updatedAt`,
      wallet,
      tier,
      now
    );

    if (!sessionWallet) {
      req.session.wallet = wallet;
    }

    return jsonOk(res, "subscription_session_created", "Subscription checkout created.", {
      sessionUrl,
      sessionId,
      tier,
    });
  } catch (err) {
    console.error("subscription subscribe error", err);
    return jsonError(res, "subscription_failed", "Subscription subscribe failed.", {
      status: 500,
    });
  }

});

function getSubscriptionWebhookSecret() {
  try {
    return getRequiredEnv("SUBSCRIPTION_WEBHOOK_SECRET");
  } catch (err) {
    console.warn(
      "SUBSCRIPTION_WEBHOOK_SECRET not set (subscription webhook disabled)",
      err?.message || err
    );
    return null;
  }
}
const subscriptionCallbackLimiter = rateLimit({
  ...getWebhookRateLimitOptions(),
  standardHeaders: true,
  legacyHeaders: false,
});

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

router.post("/callback", subscriptionCallbackLimiter, async (req, res) => {
  const correlationId = randomUUID().slice(0, 8);
  try {
    const signature = req.get("x-signature") || req.get("X-Signature") || "";
    if (!signature) {
      console.warn(`[subscription-callback:${correlationId}] missing X-Signature header`);
      return res.status(401).json({ error: "signature_required", correlationId });
    }

    const rawBodyBuffer = Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : Buffer.from(req.rawBody || "", "utf8");

    const webhookSecret = getSubscriptionWebhookSecret();
    if (!webhookSecret) {
      return jsonError(res, "webhook_secret_missing", "Subscription webhook is not configured.", {
        status: 503,
        correlationId,
      });
    }

    if (!verifySignature(rawBodyBuffer, signature, webhookSecret)) {
      console.warn(`[subscription-callback:${correlationId}] invalid signature`);
      return res.status(401).json({ error: "invalid_signature", correlationId });
    }

    let payload;
    try {
      if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
        payload = req.body;
      } else if (rawBodyBuffer.length > 0) {
        payload = JSON.parse(rawBodyBuffer.toString("utf8"));
      } else {
        payload = {};
      }
      req.body = payload;
    } catch (err) {
      console.warn(
        `[subscription-callback:${correlationId}] invalid JSON payload (${err?.message || err})`
      );
      return res.status(400).json({ error: "invalid_payload", correlationId });
    }

    const sessionId = payload?.sessionId ? String(payload.sessionId).trim() : "";
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

    const payloadNonce = payload?.nonce ? String(payload.nonce).trim() : null;
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

    const verification = await verifySubscriptionSession(sessionId);
    if (!verification?.ok || !isPaidStatus(verification.status)) {
      const status = verification?.status || "pending";
      console.warn(
        `[subscription-callback:${correlationId}] provider status not ready (${status}) reason=${verification?.reason || "unknown"}`
      );
      return jsonError(res, "session_unverified", "Subscription session not verified.", {
        status: 400,
        correlationId,
        providerStatus: status,
        reason: verification?.reason || "unverified",
      });
    }

    const paidAt = dayjs().toISOString();
    const renewalDate = dayjs(paidAt).add(30, "day").toISOString();

    await db.run(
      `UPDATE subscriptions SET status = 'active', renewalDate = ?, timestamp = datetime('now') WHERE id = ?`,
      renewalDate,
      record.id
    );

    await db.run(
      `INSERT INTO users (wallet, tier, subscriptionTier, paid, lastPaymentAt, subscriptionPaidAt, updatedAt)
       VALUES (?, ?, ?, 1, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(wallet) DO UPDATE SET
         tier = excluded.tier,
         subscriptionTier = excluded.subscriptionTier,
         paid = 1,
         lastPaymentAt = excluded.lastPaymentAt,
         subscriptionPaidAt = excluded.subscriptionPaidAt,
         updatedAt = excluded.updatedAt`,
      record.wallet,
      record.tier,
      record.tier,
      paidAt,
      paidAt
    );

    return jsonOk(res, "subscription_activated", "Subscription activated.", {
      sessionId,
      status: "active",
      wallet: record.wallet,
      tier: record.tier,
      renewalDate,
      paidAt,
      redirect: buildRedirectUrl("success", {
        sessionId,
        wallet: record.wallet,
        tier: record.tier,
        renewalDate,
      }),
    });
  } catch (err) {
    console.error(`subscription callback error [${correlationId}]`, err);
    return jsonError(res, "callback_failed", "Subscription callback failed.", {
      status: 500,
      correlationId,
    });
  }
});

const SUBSCRIPTION_CLAIM_QUEST_ID = "SUBSCRIPTION_CLAIM_BONUS";
const claimLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/claim", claimLimiter, async (req, res) => {
  try {
    const wallet = getSessionWallet(req);
    if (!wallet) {
      return res.status(401).json({ error: "wallet_required" });
    }

    await db.run(
      `INSERT OR IGNORE INTO users (wallet, xp, tier, levelName, levelSymbol, levelProgress, nextXP, updatedAt)
         VALUES (?, 0, 'Free', 'Shellborn', '🐚', 0, 10000, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      wallet
    );

    const paymentRow = await db.get(
      "SELECT paid FROM users WHERE wallet = ?",
      wallet
    );
    if (!toBoolean(paymentRow?.paid)) {
      return res.status(402).json({ error: "payment_required" });
    }

    const inserted = await db.run(
      `INSERT OR IGNORE INTO completed_quests (wallet, quest_id, timestamp)
         VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      wallet,
      SUBSCRIPTION_CLAIM_QUEST_ID
    );

    if (inserted.changes === 0) {
      const existing = await db.get(
        `SELECT timestamp FROM completed_quests WHERE wallet = ? AND quest_id = ?`,
        wallet,
        SUBSCRIPTION_CLAIM_QUEST_ID
      );
      return jsonOk(res, "subscription_bonus_exists", "Subscription bonus already claimed.", {
        xpDelta: 0,
        claimedAt: existing?.timestamp || null,
      });
    }

    const result = await grantXP({ wallet }, SUBSCRIPTION_BONUS_XP);
    if ((result.delta ?? 0) > 0) {
      try {
        await db.run(
          `INSERT INTO quest_history (wallet, quest_id, title, xp)
             VALUES (?, ?, ?, ?)`,
          wallet,
          SUBSCRIPTION_CLAIM_QUEST_ID,
          "Subscription Bonus",
          result.delta ?? SUBSCRIPTION_BONUS_XP
        );
      } catch (err) {
        console.warn("subscription quest_history insert failed", err);
      }
    }

    const claimed = await db.get(
      `SELECT timestamp FROM completed_quests WHERE wallet = ? AND quest_id = ?`,
      wallet,
      SUBSCRIPTION_CLAIM_QUEST_ID
    );

    const claimedAt = claimed?.timestamp || null;
    if (claimedAt) {
      try {
        await db.run(
          `UPDATE users SET subscriptionClaimedAt = ?, updatedAt = ? WHERE wallet = ?`,
          claimedAt,
          claimedAt,
          wallet
        );
      } catch (err) {
        console.warn("subscription claimedAt update failed", err);
      }
    }

    const xpDelta = result.delta ?? SUBSCRIPTION_BONUS_XP;
    const alreadyClaimed = xpDelta <= 0;
    const claimCode = alreadyClaimed
      ? "subscription_bonus_exists"
      : "subscription_bonus_granted";
    const claimMessage = alreadyClaimed
      ? "Subscription bonus already claimed."
      : "Subscription bonus granted.";

    return jsonOk(res, claimCode, claimMessage, {
      xpDelta,
      claimedAt,
    });
  } catch (err) {
    console.error("subscription claim error", err);
    return jsonError(res, "claim_failed", "Subscription claim failed.", {
      status: 500,
    });
  }
});

router.get("/status", async (req, res) => {
  try {
    const wallet = getSessionWallet(req);
    const bonus = SUBSCRIPTION_BONUS_XP;
    if (!wallet) {
      return jsonOk(res, "subscription_status", "Subscription status retrieved.", {
        tier: "Free",
        subscriptionTier: "Free",
        paid: false,
        canClaim: false,
        bonusXp: bonus,
        claimedAt: null,
        lastPaymentAt: null,
        subscriptionPaidAt: null,
      });
    }

    const user = await db.get(
      `SELECT tier, subscriptionTier, subscriptionPaidAt, subscriptionClaimedAt, levelName, levelSymbol, levelProgress, nextXP, xp, paid, lastPaymentAt
         FROM users WHERE wallet = ?`,
      wallet
    );
    const completed = await db.get(
      `SELECT timestamp FROM completed_quests WHERE wallet = ? AND quest_id = ?`,
      wallet,
      SUBSCRIPTION_CLAIM_QUEST_ID
    );

    const paid = toBoolean(user?.paid);
    const claimedAt = user?.subscriptionClaimedAt || completed?.timestamp || null;
    const canClaim = paid && !claimedAt;
    const subscriptionTier = user?.subscriptionTier || user?.tier || "Free";
    const paidAt = user?.subscriptionPaidAt || user?.lastPaymentAt || null;

    return jsonOk(res, "subscription_status", "Subscription status retrieved.", {
      tier: subscriptionTier,
      subscriptionTier,
      levelName: user?.levelName || "Shellborn",
      levelSymbol: user?.levelSymbol || "🐚",
      levelProgress: user?.levelProgress ?? 0,
      nextXP: user?.nextXP ?? 10000,
      xp: user?.xp ?? 0,
      paid,
      canClaim,
      bonusXp: bonus,
      lastPaymentAt: paidAt,
      subscriptionPaidAt: paidAt,
      claimedAt,
    });
  } catch (err) {
    console.error("subscription status error", err);
    return jsonError(res, "status_failed", "Unable to fetch subscription status.", {
      status: 500,
    });
  }
});

router.get("/", (_req, res) => {
  res.redirect(301, "/api/v1/subscription/status");
});

export default router;
