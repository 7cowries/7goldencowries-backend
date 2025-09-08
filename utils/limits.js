const buckets = new Map();

/**
 * Simple in-memory rate limiter. Returns true if the key has exceeded limit.
 * @param {string} key unique key (ip:wallet:bucket)
 * @param {number} limit number of allowed actions per window
 * @param {number} windowMs window size in milliseconds (default 60000)
 */
export function isRateLimited(key, limit, windowMs = 60000) {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || now - entry.ts > windowMs) {
    buckets.set(key, { ts: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

export default isRateLimited;
