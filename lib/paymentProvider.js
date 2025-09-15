// lib/paymentProvider.js
// Stubbed payment provider integration used for subscription webhook verification.
// TODO(payment-provider): replace with real API client once credentials are provisioned.

import db from "./db.js";

export async function verifySubscriptionSession(sessionId) {
  if (!sessionId) {
    return { ok: false, reason: "missing_session" };
  }

  const record = await db.get(
    `SELECT status FROM subscriptions WHERE sessionId = ? ORDER BY datetime(timestamp) DESC LIMIT 1`,
    sessionId
  );

  if (record && String(record.status).toLowerCase() === "pending") {
    return { ok: true, status: "paid", sessionId };
  }

  return {
    ok: false,
    reason: "unknown_session",
    status: record?.status ?? null,
    sessionId,
  };
}
