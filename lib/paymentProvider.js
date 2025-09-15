// lib/paymentProvider.js
// Stubbed payment provider integration used for subscription webhook verification.
// TODO(payment-provider): replace with real API client once credentials are provisioned.

export async function verifySubscriptionSession(sessionId, nonce) {
  if (!sessionId) {
    return { ok: false, status: "invalid", reason: "missing_session" };
  }

  return {
    ok: true,
    status: "paid",
    sessionId,
    nonce,
  };
}
