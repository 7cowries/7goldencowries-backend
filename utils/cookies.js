const isLocalhost = (host) =>
  /^localhost(:\d+)?$/.test(host || "") || /^127\.0\.0\.1(:\d+)?$/.test(host || "");

export function crossSiteCookieOptions(override = {}) {
  const host = process.env.HOST || "";
  const local = isLocalhost(host) || process.env.NODE_ENV === "development";
  return {
    httpOnly: true,
    sameSite: local ? "Lax" : "none",
    secure: local ? false : true,
    path: "/",
    ...override,
  };
}

export default { crossSiteCookieOptions };
