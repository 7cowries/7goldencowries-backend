const fetch = require('node-fetch');

const T_BEARER = process.env.TWITTER_BEARER_TOKEN;
if (!T_BEARER) console.warn('TWITTER_BEARER_TOKEN missing');

async function tget(url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${T_BEARER}` } });
  if (!r.ok) throw new Error(`Twitter API ${r.status}: ${await r.text()}`);
  return r.json();
}

async function userIdByUsername(username) {
  const j = await tget(`https://api.twitter.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=id,username`);
  return j?.data?.id;
}

async function isFollowing(sourceUsername, targetUsername) {
  const [srcId, tgtId] = await Promise.all([userIdByUsername(sourceUsername), userIdByUsername(targetUsername)]);
  if (!srcId || !tgtId) return false;
  // GET /2/users/:id/following → paginated; we’ll early-return on first page
  const j = await tget(`https://api.twitter.com/2/users/${srcId}/following?max_results=1000`);
  return !!j?.data?.some(u => u.id === tgtId);
}

async function hasRetweeted(username, tweetId) {
  // Check retweeters of the pinned tweet (first page, 100 users)
  const uid = await userIdByUsername(username);
  if (!uid) return false;
  const j = await tget(`https://api.twitter.com/2/tweets/${tweetId}/retweeted_by?max_results=100`);
  return !!j?.data?.some(u => u.id === uid);
}

async function hasQuoted(username, tweetId) {
  // recent search for quote tweets linking the pinned tweet
  // query: url:"https://twitter.com/.../status/<id>" from:<username> is:quote
  const url = `https://twitter.com/7goldencowries/status/${tweetId}`;
  const q = `url:"${url}" from:${username} is:quote`;
  const j = await tget(`https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(q)}&max_results=20&tweet.fields=author_id,created_at`);
  return (j?.meta?.result_count || 0) > 0;
}

module.exports = { isFollowing, hasRetweeted, hasQuoted };
