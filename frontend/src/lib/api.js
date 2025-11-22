const RETRY_STATUS = new Set([502, 503, 504]);
const MAX_ATTEMPTS = 3;

function normalizeBase(base) {
  if (!base) return "";
  const trimmed = base.trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/?$/, "");
}

export const API_BASE = normalizeBase(process.env.API_BASE);

const inflight = new Map();

function buildUrl(path) {
  if (/^https?:/i.test(path)) {
    return path;
  }
  if (!API_BASE) {
    return path;
  }
  if (path.startsWith("/")) {
    return `${API_BASE}${path}`;
  }
  return `${API_BASE}/${path}`;
}

function buildKey(url, init) {
  const method = (init.method || "GET").toUpperCase();
  const body = init.body;
  let bodyKey = "";
  if (typeof body === "string") {
    bodyKey = body;
  } else if (body && typeof body === "object") {
    try {
      bodyKey = JSON.stringify(body);
    } catch {
      bodyKey = "[object]";
    }
  }
  return `${method}:${url}:${bodyKey}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function normalizeError(err) {
  if (err instanceof ApiError) return err;
  if (err instanceof Error) {
    const apiErr = new ApiError(err.message);
    return apiErr;
  }
  return new ApiError("Request failed");
}

export async function fetchJson(path, options = {}) {
  const url = buildUrl(path);
  const init = {
    credentials: "include",
    ...options,
  };

  if (options.headers) {
    init.headers = { ...options.headers };
  }

  const cacheKey = buildKey(url, init);
  if (inflight.has(cacheKey)) {
    return inflight.get(cacheKey);
  }

  const exec = async () => {
    let attempt = 0;
    let lastError;
    while (attempt < MAX_ATTEMPTS) {
      try {
        const response = await fetch(url, init);
        if (RETRY_STATUS.has(response.status) && attempt < MAX_ATTEMPTS - 1) {
          attempt += 1;
          await delay(200 * attempt);
          continue;
        }

        if (response.status === 204 || response.status === 304) {
          return null;
        }

        const text = await response.text();
        let parsed = null;
        if (text) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = text;
          }
        }

        if (!response.ok) {
          throw new ApiError(`HTTP ${response.status}`, response.status, parsed);
        }

        return parsed ?? null;
      } catch (err) {
        lastError = err;
        if (err instanceof SyntaxError) {
          throw new ApiError("Invalid JSON response");
        }
        if (err instanceof ApiError) {
          if (RETRY_STATUS.has(err.status ?? 0) && attempt < MAX_ATTEMPTS - 1) {
            attempt += 1;
            await delay(200 * attempt);
            continue;
          }
          throw err;
        }
        if (attempt >= MAX_ATTEMPTS - 1) {
          throw normalizeError(err);
        }
        attempt += 1;
        await delay(200 * attempt);
      }
    }
    throw normalizeError(lastError);
  };

  const promise = exec();
  inflight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(cacheKey);
  }
}

export default { fetchJson };
