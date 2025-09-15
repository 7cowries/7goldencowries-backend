const DEFAULT_WEBHOOK_WINDOW_MS = 60_000;
const DEFAULT_WEBHOOK_MAX_EVENTS = 120;

function parsePositiveInt(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function getWebhookRateLimitOptions() {
  return {
    windowMs: parsePositiveInt(process.env.WEBHOOK_WINDOW_MS, DEFAULT_WEBHOOK_WINDOW_MS),
    max: parsePositiveInt(process.env.WEBHOOK_MAX_EVENTS, DEFAULT_WEBHOOK_MAX_EVENTS),
  };
}

export { DEFAULT_WEBHOOK_MAX_EVENTS, DEFAULT_WEBHOOK_WINDOW_MS };
