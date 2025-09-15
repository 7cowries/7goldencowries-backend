import { randomUUID } from "crypto";
import express from "express";
import db from "../../lib/db.js";

const router = express.Router();

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

router.post("/purchase", async (req, res) => {
  try {
    const wallet = req.body?.wallet ? String(req.body.wallet).trim() : "";
    const amountRaw = req.body?.amount;
    const amount = typeof amountRaw === "string" ? Number(amountRaw) : Number(amountRaw ?? 0);
    const referralCode = req.body?.referralCode ? String(req.body.referralCode).trim() : null;
    const usdAmountRaw = req.body?.usdAmount;
    const usdAmount =
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
      Number.isFinite(usdAmount) && usdAmount > 0 ? usdAmount : 0,
      referralCode,
      sessionId
    );

    return res.json({ paymentLink, sessionId });
  } catch (err) {
    console.error("token-sale purchase error", err);
    return res.status(500).json({ error: "purchase_failed" });
  }
});

router.post("/webhook", async (req, res) => {
  try {
    const payload = req.body ?? {};
    const sessionId = payload.sessionId || payload.checkoutSessionId;
    const normalizedSessionId = sessionId ? String(sessionId).trim() : "";
    if (!normalizedSessionId) {
      return res.status(400).json({ error: "missing_session" });
    }

    const wallet = payload.wallet ? String(payload.wallet).trim() : null;
    const tonAmountRaw = payload.amount ?? payload.tonAmount;
    const tonAmount =
      typeof tonAmountRaw === "string" ? Number(tonAmountRaw) : Number(tonAmountRaw ?? 0);
    const usdAmountRaw = payload.usdAmount;
    const usdAmount =
      typeof usdAmountRaw === "string" ? Number(usdAmountRaw) : Number(usdAmountRaw ?? 0);
    const txHash = payload.txHash ? String(payload.txHash).trim() : null;
    const status = payload.status ? String(payload.status).trim() : "paid";
    const referralCode = payload.referralCode ? String(payload.referralCode).trim() : null;

    const update = await db.run(
      `UPDATE token_sale_contributions
         SET wallet = COALESCE(?, wallet),
             ton_amount = CASE WHEN ? > 0 THEN ? ELSE ton_amount END,
             usd_amount = CASE WHEN ? > 0 THEN ? ELSE usd_amount END,
             tx_hash = COALESCE(?, tx_hash),
             status = ?,
             referral_code = COALESCE(?, referral_code)
       WHERE checkout_session_id = ?`,
      wallet,
      tonAmount,
      tonAmount,
      usdAmount,
      usdAmount,
      txHash,
      status,
      referralCode,
      normalizedSessionId
    );

    if (!update.changes) {
      await db.run(
        `INSERT INTO token_sale_contributions (wallet, ton_amount, usd_amount, referral_code, tx_hash, checkout_session_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        wallet,
        tonAmount > 0 ? tonAmount : 0,
        usdAmount > 0 ? usdAmount : 0,
        referralCode,
        txHash,
        normalizedSessionId,
        status
      );
    }

    return res.json({ ok: true, sessionId: normalizedSessionId });
  } catch (err) {
    console.error("token-sale webhook error", err);
    return res.status(500).json({ error: "webhook_failed" });
  }
});

export default router;
