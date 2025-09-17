const TRUTHY = new Set(["1", "true", "yes", "on"]); 
const FALSY = new Set(["0", "false", "no", "off"]);

function normalizeBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (TRUTHY.has(normalized)) return true;
    if (FALSY.has(normalized)) return false;
  }
  return fallback;
}

export function cookieSecureEnabled() {
  const fallback = process.env.NODE_ENV === "production";
  return normalizeBoolean(process.env.COOKIE_SECURE, fallback);
}

export function baseCookieOptions() {
  const secure = cookieSecureEnabled();
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? "none" : "lax",
    path: "/",
  };
}

export function crossSiteCookieOptions(override = {}) {
  return {
    ...baseCookieOptions(),
    ...override,
  };
}

export function appendSetCookie(res, cookieValue) {
  if (!res || !cookieValue) return res;
  const existing = res.getHeader("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", cookieValue);
    return res;
  }
  if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, cookieValue]);
    return res;
  }
  res.setHeader("Set-Cookie", [existing, cookieValue]);
  return res;
}

export default { crossSiteCookieOptions, appendSetCookie, baseCookieOptions, cookieSecureEnabled };
