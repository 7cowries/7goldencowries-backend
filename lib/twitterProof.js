import { getCache, setCache } from '../utils/cache.js';

// Parse https://x.com/{user}/status/{id} or twitter.com
export function parseTweetUrl(url) {
  const m = /^https:\/\/(?:x|twitter)\.com\/([^/]+)\/status\/(\d+)/i.exec(url);
  if (!m) return null;
  return { username: m[1], tweetId: m[2] };
}

async function fetchOEmbed(url, tweetId, fetchFn) {
  const cacheKey = `oembed:${tweetId}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;
  try {
    const res = await fetchFn(`https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(url)}`);
    if (res && res.ok) {
      const data = await res.json();
      setCache(cacheKey, data, 5 * 60 * 1000);
      return data;
    }
  } catch {}
  try {
    const res = await fetchFn(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (res && res.ok) {
      const html = await res.text();
      const ogTitleMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i);
      const ogDescMatch = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i);
      const data = { html, author_name: ogTitleMatch?.[1], ogDescription: ogDescMatch?.[1] };
      setCache(cacheKey, data, 5 * 60 * 1000);
      return data;
    }
  } catch {}
  return null;
}

export async function verifyTwitterProof({ user, quest, url }, fetchFn = fetch) {
  const parsed = parseTweetUrl(url);
  if (!parsed) return { ok: false, details: 'Invalid tweet URL' };
  const handle = (user?.twitter_username || user?.twitterHandle || '').toLowerCase();
  if (!handle) return { ok: false, details: 'Twitter not linked' };
  if (handle !== parsed.username.toLowerCase()) {
    return { ok: false, details: 'Tweet user mismatch' };
  }
  const data = await fetchOEmbed(url, parsed.tweetId, fetchFn);
  if (!data) return { ok: false, details: 'Tweet fetch failed' };
  const html = (data.html || '').toLowerCase();
  const meta = [(data.author_name || ''), (data.author_url || ''), (data.ogDescription || '')]
    .join(' ')
    .toLowerCase();
  const text = html + ' ' + meta;
  const targetUrl = (process.env.X_TARGET_TWEET_URL || '').toLowerCase();
  const hashtag = (process.env.X_REQUIRED_HASHTAG || '').toLowerCase();
  const handleTarget = (process.env.X_TARGET_HANDLE || '').toLowerCase();
  const followPhrase = handleTarget ? `i'm following @${handleTarget}` : "";
  const followHash = '#7gcfollow';
  let verified = false;
  if (targetUrl && html.includes(targetUrl.toLowerCase())) verified = true;
  if (!verified && hashtag && text.includes(hashtag)) verified = true;
  if (!verified && followPhrase && text.includes(followPhrase) && text.includes(followHash)) {
    verified = true;
  }
  if (!verified) {
    return { ok: false, details: 'Tweet does not meet quest rules' };
  }
  return { ok: true };
}
