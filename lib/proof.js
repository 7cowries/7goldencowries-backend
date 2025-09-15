import crypto from 'crypto';
import fetch from 'node-fetch';
import db from '../lib/db.js';

export function normalizeTweetUrl(u) {
  let url;
  try {
    url = new URL(u);
  } catch {
    const err = new Error('Invalid URL');
    err.status = 400;
    throw err;
  }
  const host = url.hostname.toLowerCase();
  if (!['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com'].includes(host)) {
    const err = new Error('Invalid URL');
    err.status = 400;
    throw err;
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 3 || parts[1].toLowerCase() !== 'status' || !/^\d+$/.test(parts[2])) {
    const err = new Error('Invalid URL');
    err.status = 400;
    throw err;
  }
  const handle = parts[0];
  const tweetId = parts[2];
  return { url: `https://x.com/${handle}/status/${tweetId}`, handle, tweetId };
}

export function proofToken(wallet, questId) {
  const raw = `${wallet}:${questId}:${process.env.PROOF_SECRET || ''}`;
  const digest = crypto.createHash('sha256').update(raw).digest('base64url');
  return digest.slice(0, 10);
}

export async function safeFetch(u) {
  const start = new URL(u);
  const host = start.hostname.toLowerCase();
  const allowed = ['x.com', 'twitter.com'];
  if (!allowed.includes(host) && !allowed.includes(host.replace(/^www\./, ''))) {
    throw new Error('invalid-host');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(u, {
      redirect: 'follow',
      follow: 2,
      signal: controller.signal,
      headers: { 'user-agent': '7gc-verifier/1.0' },
    });
    const finalHost = new URL(res.url).hostname.toLowerCase();
    if (finalHost !== host) {
      throw new Error('redirect-host');
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export function extractTweetTextFromHtml(html) {
  let text = String(html || '');
  text = text.replace(/<[^>]*>/g, ' ');
  text = text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text.replace(/\s+/g, ' ').trim();
}

export async function verifyProofRow(id, fetcher = safeFetch) {
  const row = await db.get('SELECT * FROM proofs WHERE id = ?', id);
  if (!row) return;
  const token = proofToken(row.wallet, row.quest_id);
  let attempt = 0;
  async function run() {
    attempt += 1;
    let res;
    try {
      res = await fetcher(row.url);
    } catch {
      res = null;
    }
    if (!res || !res.ok) {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 2000));
        return run();
      }
      await db.run(
        "UPDATE proofs SET status='rejected', reason='Tweet not accessible/public', updatedAt=datetime('now') WHERE id=?",
        id
      );
      return;
    }
    const html = await res.text();
    const text = extractTweetTextFromHtml(html);
    if (text.includes(`#7GC-${token}`)) {
      await db.run(
        "UPDATE proofs SET status='verified', reason=NULL, updatedAt=datetime('now') WHERE id=?",
        id
      );
    } else if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000));
      return run();
    } else {
      await db.run(
        "UPDATE proofs SET status='rejected', reason='Token not found in tweet', updatedAt=datetime('now') WHERE id=?",
        id
      );
    }
  }
  await run();
}

export default {
  normalizeTweetUrl,
  proofToken,
  safeFetch,
  extractTweetTextFromHtml,
  verifyProofRow,
};
