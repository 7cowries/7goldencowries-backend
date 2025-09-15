import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { Buffer } from "node:buffer";
import express from "express";
import rateLimit from "express-rate-limit";
import { getWebhookRateLimitOptions } from "../../config/rateLimits.js";
import db from "../../lib/db.js";

const router = express.Router();

const TOKEN_SALE_WEBHOOK_SECRET = process.env.TOKEN_SALE_WEBHOOK_SECRET || "";

const webhookLimiter = rateLimit({
  ...getWebhookRateLimitOptions(),
  standardHeaders: true,
  legacyHeaders: false,
});

const PAYMENT_BASE_URL =
  process.env.TOKEN_SALE_PAYMENT_BASE_URL || "https://pay.7goldencowries.com/checkout";

function buildPaymentLink(sessionId) {
  try {
    const url = new URL(PAYMENT_BASE_URL);
    url.searchParams.set("session", sessionId);
    return url.toString();
  } catch {
    return `https://pay.7goldencowries.com/checkout?session=${encodeURIComponent(sessionId)}`;
  }
}

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

function parseNonNegativeNumber(value, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    return required ? null : 0;
  }
  const num = typeof value === "string" ? Number(value) : Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return null;
  }
  return num;
}

function deriveStatus(eventType, paymentStatus) {
  const type = String(eventType || "").toLowerCase();
  const payment = String(paymentStatus || "").toLowerCase();
  if (type.includes("fail") || type.includes("cancel") || payment.includes("fail")) {
    return "failed";
  }
  if (type.includes("refund") || payment.includes("refund")) {
    return "refunded";
  }
  if (
    type.includes("paid") ||
    type.includes("complete") ||
    type.includes("success") ||
    payment.includes("paid") ||
    payment.includes("success") ||
    payment.includes("succeed")
  ) {
    return "paid";
  }
  return "pending";
}

router.post("/purchase", async (req, res) => {
  try {
    const wallet = req.body?.wallet ? String(req.body.wallet).trim() : "";
    const amountRaw = req.body?.amount;
    const amount = typeof amountRaw === "string" ? Number(amountRaw) : Number(amountRaw ?? 0);
    const referralCode = req.body?.referralCode ? String(req.body.referralCode).trim() : null;
    const usdAmountRaw = req.body?.usdAmount;
    const usdAmountParsed =
      typeof usdAmountRaw === "string" ? Number(usdAmountRaw) : Number(usdAmountRaw ?? 0);

    if (!wallet) {
      return res.status(400).json({ error: "wallet_required" });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "invalid_amount" });
    }

    const sessionId = randomUUID();
    const paymentLink = buildPaymentLink(sessionId);

    await db.run(
      `INSERT INTO token_sale_contributions (wallet, ton_amount, usd_amount, referral_code, checkout_session_id, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      wallet,
      amount,
      Number.isFinite(usdAmountParsed) && usdAmountParsed > 0 ? usdAmountParsed : 0,
      referralCode,
      sessionId
    );

    return res.json({ paymentLink, sessionId });
  } catch (err) {
    console.error("token-sale purchase error", err);
    return res.status(500).json({ error: "purchase_failed" });
  }
});

router.post("/webhook", webhookLimiter, async (req, res) => {
  const correlationId = randomUUID().slice(0, 8);
  try {
    if (!TOKEN_SALE_WEBHOOK_SECRET) {
      console.error(
        `[token-sale-webhook:${correlationId}] TOKEN_SALE_WEBHOOK_SECRET is not configured`
      );
      return res.status(500).json({ error: "webhook_not_configured", correlationId });
    }

    const signature = req.get("x-signature") || req.get("X-Signature") || "";
    if (!signature) {
      console.warn(`[token-sale-webhook:${correlationId}] missing X-Signature header`);
      return res.status(401).json({ error: "signature_required", correlationId });
    }

    const rawBody = req.rawBody || "";
    if (!verifySignature(rawBody, signature, TOKEN_SALE_WEBHOOK_SECRET)) {
      console.warn(`[token-sale-webhook:${correlationId}] invalid signature`);
      return res.status(401).json({ error: "invalid_signature", correlationId });
    }

    const payload = req.body ?? {};
    const eventId = payload.eventId ? String(payload.eventId).trim() : "";
    if (!eventId) {
      console.warn(`[token-sale-webhook:${correlationId}] missing eventId`);
      return res.status(400).json({ error: "eventId_required", correlationId });
    }

    const eventType = payload.eventType || payload.type || "";
    const data =
      payload.data && typeof payload.data === "object" ? payload.data : { ...payload };

    const sessionId =
      data.sessionId || data.checkoutSessionId || payload.sessionId || payload.checkoutSessionId;
    const normalizedSessionId = sessionId ? String(sessionId).trim() : null;
    const wallet = data.wallet ? String(data.wallet).trim() : null;
    const tonAmountValue =
      parseNonNegativeNumber(data.tonAmount ?? data.amount ?? payload.amount ?? payload.tonAmount, {
        required: false,
      });
    if (tonAmountValue === null) {
      console.warn(`[token-sale-webhook:${correlationId}] invalid ton amount`);
      return res.status(400).json({ error: "invalid_amount", correlationId });
    }
    const usdAmountValue = parseNonNegativeNumber(data.usdAmount ?? payload.usdAmount, {
      required: false,
    });
    if (usdAmountValue === null) {
      console.warn(`[token-sale-webhook:${correlationId}] invalid usd amount`);
      return res.status(400).json({ error: "invalid_usd_amount", correlationId });
    }

    const referralCode = data.referralCode ? String(data.referralCode).trim() : null;
    const txHash = data.txHash ? String(data.txHash).trim() : null;
    const derivedStatus = deriveStatus(eventType, data.paymentStatus ?? payload.paymentStatus);

    await db.run(
      `INSERT INTO token_sale_contributions (event_id, wallet, ton_amount, usd_amount, referral_code, tx_hash, checkout_session_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET
         wallet = COALESCE(excluded.wallet, token_sale_contributions.wallet),
         ton_amount = excluded.ton_amount,
         usd_amount = excluded.usd_amount,
         referral_code = COALESCE(excluded.referral_code, token_sale_contributions.referral_code),
         tx_hash = COALESCE(excluded.tx_hash, token_sale_contributions.tx_hash),
         checkout_session_id = COALESCE(excluded.checkout_session_id, token_sale_contributions.checkout_session_id),
         status = excluded.status`,
      eventId,
      wallet,
      tonAmountValue,
      usdAmountValue,
      referralCode,
      txHash,
      normalizedSessionId,
      derivedStatus
    );

    return res.json({ ok: true, eventId, status: derivedStatus });
  } catch (err) {
    console.error(`token-sale webhook error [${correlationId}]`, err);
    return res.status(500).json({ error: "webhook_failed", correlationId });
  }
});

export default router;
