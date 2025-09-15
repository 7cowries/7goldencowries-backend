const PROOF_REQUIRED_ERRORS = new Set(["proof-required", "proof_required"]);

export function isProofRequiredError(error) {
  if (!error || typeof error !== "string") return false;
  return PROOF_REQUIRED_ERRORS.has(error);
}

export function mapClaimResponseToUi(result) {
  if (!result || typeof result !== "object") {
    return {
      status: "error",
      tooltip: "Claim failed. Please try again.",
    };
  }

  if (result.ok) {
    return { status: "claimed" };
  }

  const error = typeof result.error === "string" ? result.error : "";

  if (isProofRequiredError(error)) {
    return {
      status: "gated",
      tooltip:
        typeof result.message === "string" && result.message.trim()
          ? result.message
          : "Connect your proof provider to unlock this quest.",
      reason: typeof result.reason === "string" ? result.reason : null,
      shouldOpenProof: true,
    };
  }

  if (error) {
    return {
      status: "error",
      tooltip:
        typeof result.message === "string" && result.message.trim()
          ? result.message
          : "Claim failed. Please try again.",
    };
  }

  return {
    status: "error",
    tooltip: "Claim failed. Please try again.",
  };
}

export function getInitialClaimUiState() {
  return { status: "idle", tooltip: null, reason: null, shouldOpenProof: false };
}
