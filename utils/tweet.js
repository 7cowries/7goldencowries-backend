export function parseTweetId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (!['twitter.com','www.twitter.com','x.com','www.x.com'].includes(host)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >=3 && parts[1].toLowerCase() === 'status' && /^\d+$/.test(parts[2])) {
      return parts[2];
    }
    return null;
  } catch {
    return null;
  }
}

export function isValidTweetUrl(url) {
  return parseTweetId(url) !== null;
}
