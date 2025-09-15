export type ClaimUiStatus = "idle" | "loading" | "claimed" | "gated" | "error";

export interface ClaimUiState {
  status: ClaimUiStatus;
  tooltip?: string | null;
  reason?: string | null;
  shouldOpenProof?: boolean;
}

export interface ClaimResponseBody {
  ok?: boolean;
  error?: string | null;
  message?: string | null;
  reason?: string | null;
}

export function isProofRequiredError(error?: string | null): boolean;
export function mapClaimResponseToUi(result?: ClaimResponseBody | null): ClaimUiState;
export function getInitialClaimUiState(): ClaimUiState;
