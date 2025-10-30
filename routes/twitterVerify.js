// routes/twitterVerify.js
// Live Twitter verification for 7goldencowries
// - follow @7goldencowries
// - retweet pinned tweet
// - quote pinned tweet
//
// Requires: TWITTER_BEARER_TOKEN in Render env
// Uses the same sqlite helpers exported from ../db.js

import express from "express";
import dbp, { get as dbGet, run as dbRun } from "../db.js";

const router = express.Router();

const REQUIRED_HANDLE = "7goldencowries"; // the account users must follow
const PINNED_TWEET_ID = "1947595024117502145"; // from your earlier message

function normalizeAddress(a) {
  if (!a) return null;
  const s = String(a).trim();
  return s.length ? s : null;
}

// ensure user_quests table exists (user_id, quest_id, xp_awarded)
async function ensureUserQuestsTable() {
  const db = await dbp;
  await dbRun(`
    CREATE TABLE IF NOT EXISTS user_quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      quest_id TEXT NOT NULL,
      xp_awarded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, quest_id)
    );
  `);
}

// small helper to award XP once per quest
async function awardQuestOnce(userId, questId, xp) {
  await ensureUserQuestsTable();
  try {
    await dbRun(
      `INSERT INTO user_quests (user_id, quest_id, xp_awarded) VALUES (?, ?, ?);`,
      userId,
      questId,
      xp
    );
  } catch (e) {
    // UNIQUE hit → already awarded → do nothing
    if (!String(e.message || "").includes("UNIQUE")) {
      console.error("[twitterVerify awardQuestOnce]", e);
    }
  }

  // also bump users.xp if present
  await dbRun(
    `UPDATE users SET xp = COALESCE(xp,0) + ?, updated_at = datetime('now') WHERE id = ?;`,
    xp,
    userId
  );
}

// pull user from session/cookie/body
async function resolveUser(req) {
  // session first
  if (req.session?.userId && req.session?.address) {
    return {
      id: req.session.userId,
      wallet: req.session.address,
    };
  }

  // fallback to cookie
  const raw = req.cookies?.["7gc.sid"];
  if (raw && raw.startsWith("w:")) {
    const wallet = raw.slice(2);
    const row = await dbGet(
      `SELECT id, wallet, xp FROM users WHERE wallet = ?;`,
      wallet
    );
    if (row) return row;
  }

  // fallback to body
  const bodyWallet =
    normalizeAddress(req.body?.wallet) || normalizeAddress(req.body?.address);
  if (bodyWallet) {
    // materialize user if missing
    await dbRun(
      `
      INSERT OR IGNORE INTO users (wallet, xp, level, level_name)
      VALUES (?, 0, 1, 'Shellborn');
    `,
      bodyWallet
    );
    const row = await dbGet(
      `SELECT id, wallet, xp FROM users WHERE wallet = ?;`,
      bodyWallet
    );
    if (row) return row;
  }

  return null;
}

function getBearer() {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) {
    console.warn("TWITTER_BEARER_TOKEN missing");
  }
  return token;
}

// call twitter API
async function twitterGet(url) {
  const bearer = getBearer();
  if (!bearer) throw new Error("no-bearer");
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      "User-Agent": "7goldencowries-verifier",
    },
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`twitter ${r.status}: ${txt}`);
  }
  return r.json();
}

/**
 * POST /api/twitter/verify/follow
 * body: { twitter_id?: string, wallet?: string }
 * checks if twitter_id follows @7goldencowries
 */
router.post("/verify/follow", async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ ok: false, error: "no-user" });

    const twitterId = req.body?.twitter_id || req.body?.twitterId;
    if (!twitterId)
      return res.status(400).json({ ok: false, error: "twitter-id-required" });

    // get target user id for @7goldencowries
    // we can hardcode, but let's keep it live:
    const target = await twitterGet(
      `https://api.twitter.com/2/users/by/username/${REQUIRED_HANDLE}`
    );
    const targetId = target?.data?.id;
    if (!targetId)
      return res
        .status(500)
        .json({ ok: false, error: "target-handle-not-found" });

    // check if source follows target
    const rel = await twitterGet(
      `https://api.twitter.com/2/users/${twitterId}/following?max_results=1000`
    );
    const follows =
      Array.isArray(rel?.data) &&
      rel.data.some((u) => String(u.id) === String(targetId));

    if (!follows) {
      return res.json({ ok: true, verified: false });
    }

    // award
    await awardQuestOnce(user.id, "follow-twitter", 50);
    res.json({ ok: true, verified: true, quest: "follow-twitter", xp: 50 });
  } catch (e) {
    console.error("/api/twitter/verify/follow", e);
    res.status(500).json({ ok: false, error: "internal" });
  }
});

/**
 * POST /api/twitter/verify/retweet
 * body: { twitter_id?: string }
 * we check if user retweeted the pinned tweet
 */
router.post("/verify/retweet", async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ ok: false, error: "no-user" });

    const twitterId = req.body?.twitter_id || req.body?.twitterId;
    if (!twitterId)
      return res.status(400).json({ ok: false, error: "twitter-id-required" });

    // check tweet engagements
    const rtData = await twitterGet(
      `https://api.twitter.com/2/tweets/${PINNED_TWEET_ID}/retweeted_by?max_results=1000`
    );
    const didRt =
      Array.isArray(rtData?.data) &&
      rtData.data.some((u) => String(u.id) === String(twitterId));

    if (!didRt) {
      return res.json({ ok: true, verified: false });
    }

    await awardQuestOnce(user.id, "retweet-pinned", 75);
    res.json({ ok: true, verified: true, quest: "retweet-pinned", xp: 75 });
  } catch (e) {
    console.error("/api/twitter/verify/retweet", e);
    res.status(500).json({ ok: false, error: "internal" });
  }
});

/**
 * POST /api/twitter/verify/quote
 * check if user quoted the pinned tweet
 * we search tweets from that user referencing the tweet id
 */
router.post("/verify/quote", async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ ok: false, error: "no-user" });

    const twitterId = req.body?.twitter_id || req.body?.twitterId;
    if (!twitterId)
      return res.status(400).json({ ok: false, error: "twitter-id-required" });

    // search recent tweets from that user that quote our tweet
    // Twitter v2 recent search:
    // query=from:<id> url:"https://x.com/.../<tweetId>"
    const q = encodeURIComponent(
      `from:${twitterId} url:"${PINNED_TWEET_ID}"`
    );
    const search = await twitterGet(
      `https://api.twitter.com/2/tweets/search/recent?query=${q}&max_results=10`
    );
    const quoted = Array.isArray(search?.data) && search.data.length > 0;

    if (!quoted) {
      return res.json({ ok: true, verified: false });
    }

    await awardQuestOnce(user.id, "quote-pinned", 90);
    res.json({ ok: true, verified: true, quest: "quote-pinned", xp: 90 });
  } catch (e) {
    console.error("/api/twitter/verify/quote", e);
    res.status(500).json({ ok: false, error: "internal" });
  }
});

// export default so server.js import works
export default router;
