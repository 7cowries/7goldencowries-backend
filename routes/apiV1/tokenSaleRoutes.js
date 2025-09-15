import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { Buffer } from "node:buffer";
import express from "express";
import rateLimit from "express-rate-limit";
import { getWebhookRateLimitOptions } from "../../config/rateLimits.js";
import { getRequiredEnv } from "../../config/env.js";
import db from "../../lib/db.js";

const router = express.Router();

const TOKEN_SALE_WEBHOOK_SECRET = getRequiredEnv("TOKEN_SALE_WEBHOOK_SECRET");

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
    const signature = req.get("x-signature") || req.get("X-Signature") || "";
    if (!signature) {
      console.warn(`[token-sale-webhook:${correlationId}] missing X-Signature header`);
      return res.status(401).json({ error: "signature_required", correlationId });
    }

    const rawBodyBuffer = Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : Buffer.from(req.rawBody || "", "utf8");

    if (!verifySignature(rawBodyBuffer, signature, TOKEN_SALE_WEBHOOK_SECRET)) {
      console.warn(`[token-sale-webhook:${correlationId}] invalid signature`);
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
        `[token-sale-webhook:${correlationId}] invalid JSON payload (${err?.message || err})`
      );
      return res.status(400).json({ error: "invalid_payload", correlationId });
    }

    const data =
      payload && typeof payload.data === "object" && payload.data !== null
        ? payload.data
        : { ...payload };

    const txHashCandidate =
      data.txHash || data.tx_hash || payload.txHash || payload.tx_hash || null;
    const txHash = txHashCandidate ? String(txHashCandidate).trim() : null;
    const normalizedTxHash = txHash ? txHash.toLowerCase() : null;

    const rawEventId =
      payload.eventId ||
      payload.event_id ||
      data.eventId ||
      data.event_id ||
      null;
    let eventId = rawEventId ? String(rawEventId).trim() : null;
    if (!eventId && normalizedTxHash) {
      eventId = normalizedTxHash;
    }
    if (!eventId) {
      console.warn(`[token-sale-webhook:${correlationId}] missing eventId/txHash`);
      return res.status(400).json({ error: "eventId_required", correlationId });
    }

    const eventType = payload.eventType || payload.type || data.eventType || data.type || "";

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
    const derivedStatus = deriveStatus(eventType, data.paymentStatus ?? payload.paymentStatus);
    const receivedAt = new Date().toISOString();

    await db.exec("BEGIN IMMEDIATE");
    try {
      const eventInsert = await db.run(
        `INSERT OR IGNORE INTO token_sale_events (eventId, receivedAt, raw) VALUES (?, ?, ?)`,
        eventId,
        receivedAt,
        JSON.stringify(payload)
      );

      if (eventInsert.changes === 0) {
        await db.exec("ROLLBACK");
        return res.json({ ok: true, eventId, idempotent: true });
      }

      await db.run(
        `INSERT INTO token_sale_contributions (event_id, wallet, ton_amount, usd_amount, referral_code, tx_hash, checkout_session_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(checkout_session_id) DO UPDATE SET
           wallet = COALESCE(excluded.wallet, token_sale_contributions.wallet),
           ton_amount = excluded.ton_amount,
           usd_amount = excluded.usd_amount,
           referral_code = COALESCE(excluded.referral_code, token_sale_contributions.referral_code),
           tx_hash = COALESCE(excluded.tx_hash, token_sale_contributions.tx_hash),
           status = excluded.status,
           event_id = excluded.event_id`,
        eventId,
        wallet,
        tonAmountValue,
        usdAmountValue,
        referralCode,
        txHash,
        normalizedSessionId,
        derivedStatus
      );

      await db.exec("COMMIT");
    } catch (err) {
      await db.exec("ROLLBACK");
      throw err;
    }

    return res.json({ ok: true, eventId, status: derivedStatus });
  } catch (err) {
    console.error(`token-sale webhook error [${correlationId}]`, err);
    return res.status(500).json({ error: "webhook_failed", correlationId });
  }
});

export default router;
