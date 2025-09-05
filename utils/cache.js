const cache = new Map();

export function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expire <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

export function setCache(key, value, ttl = 30000) {
  cache.set(key, { value, expire: Date.now() + ttl });
}

export function delCache(key) {
  cache.delete(key);
}
