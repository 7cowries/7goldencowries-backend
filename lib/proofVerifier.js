import { createHash } from "crypto";

// Simple stubs for future integrations with social graph providers.
export async function verifyTwitterFollow(_context = {}) {
  return { ok: true };
}

export async function verifyTelegramMember(_context = {}) {
  return { ok: true };
}

const requirementHandlers = new Map([
  ["x_follow", verifyTwitterFollow],
  ["twitter_follow", verifyTwitterFollow],
  ["join_telegram", verifyTelegramMember],
  ["telegram_member", verifyTelegramMember],
]);

export async function verifyQuestRequirement(requirement, context = {}) {
  if (!requirement || String(requirement).toLowerCase() === "none") {
    return { ok: true };
  }
  const handler = requirementHandlers.get(String(requirement).toLowerCase());
  if (!handler) {
    return { ok: true };
  }
  try {
    const result = await handler(context);
    if (!result || typeof result.ok !== "boolean") {
      return { ok: false, reason: "invalid_verifier_response" };
    }
    return result.ok ? { ok: true } : { ok: false, reason: result.reason || "verification_failed" };
  } catch (err) {
    const hash = createHash("sha1").update(`${Date.now()}-${requirement}`).digest("hex").slice(0, 8);
    console.error(`proofVerifier:${hash}`, err);
    return { ok: false, reason: "verifier_error" };
  }
}
