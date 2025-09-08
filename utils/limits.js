const buckets = new Map();

/**
 * Increment usage for a key and check if limit exceeded.
 * @param {string} key e.g. `${ip}:${wallet}:proof`
 * @param {object} opts { limit=10, windowMs=60000 }
 * @returns {boolean} true if rate limited
 */
export function bump(key, opts = {}) {
  const limit = Number(opts.limit ?? 10);
  const windowMs = Number(opts.windowMs ?? 60000);
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || now - entry.ts > windowMs) {
    buckets.set(key, { ts: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

export const isRateLimited = (key, limit, windowMs = 60000) =>
  bump(key, { limit, windowMs });

export default bump;
