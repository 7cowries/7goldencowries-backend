// routes/twitterVerify.js
// LIVE Twitter verify for 7goldencowries
// - follow @7goldencowries
// - retweet pinned tweet
// - quote pinned tweet
//
// This version matches your current db.js on Render
// (db.js exports ONLY a default, no {get, run, all})

import express from "express";
import dbp from "../db.js";

const router = express.Router();

// hardcoded from your project
const REQUIRED_HANDLE = "7goldencowries";
const PINNED_TWEET_ID = "1947595024117502145";

function normalizeAddress(a) {
  if (!a) return null;
  const s = String(a).trim();
  return s.length ? s : null;
}

// get a real db instance once
const db = await dbp;

// make sure user_quests exists (idempotent)
await db.run(`
  CREATE TABLE IF NOT EXISTS user_quests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    quest_id TEXT NOT NULL,
    xp_awarded INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, quest_id)
  );
`);

// materialize user from wallet/address
async function materializeUserByWallet(wallet) {
  const addr = normalizeAddress(wallet);
  if (!addr) return null;

  await db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL UNIQUE,
      twitter_handle TEXT,
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      level_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await db.run(
    `INSERT OR IGNORE INTO users (wallet, level, level_name) VALUES (?, 1, 'Shellborn');`,
    addr
  );

  return await db.get(
    `SELECT id, wallet, xp, level FROM users WHERE wallet = ?;`,
    addr
  );
}

// resolve current user from session/cookie/body
async function resolveUser(req) {
  // session first
  if (req.session?.userId && req.session?.address) {
    return {
      id: req.session.userId,
      wallet: req.session.address,
    };
  }

  // read cookie 7gc.sid → w:<wallet>
  const raw = req.cookies?.["7gc.sid"];
  if (raw && typeof raw === "string" && raw.startsWith("w:")) {
    const wallet = raw.slice(2);
    const row = await db.get(`SELECT id, wallet, xp FROM users WHERE wallet = ?;`, wallet);
    if (row) return row;
    return await materializeUserByWallet(wallet);
  }

  // body
  const bodyWallet =
    normalizeAddress(req.body?.wallet) ||
    normalizeAddress(req.body?.address);
  if (bodyWallet) {
    return await materializeUserByWallet(bodyWallet);
  }

  return null;
}

// award XP once per quest
async function awardQuestOnce(userId, questId, xp) {
  try {
    await db.run(
      `INSERT INTO user_quests (user_id, quest_id, xp_awarded) VALUES (?, ?, ?);`,
      userId,
      questId,
      xp
    );
  } catch (e) {
    // already claimed → UNIQUE constraint
    if (!String(e.message || "").includes("UNIQUE")) {
      console.error("[twitterVerify awardQuestOnce]", e);
    }
  }

  // bump users.xp
  await db.run(
    `UPDATE users SET xp = COALESCE(xp,0) + ?, updated_at = datetime('now') WHERE id = ?;`,
    xp,
    userId
  );
}

function getBearer() {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) {
    console.warn("TWITTER_BEARER_TOKEN missing");
  }
  return token;
}

// basic Twitter GET
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

// ---------------------------------------------------------------------------
// POST /api/twitter/verify/follow
// body: { twitter_id }
// ---------------------------------------------------------------------------
router.post("/verify/follow", async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ ok: false, error: "no-user" });

    const twitterId = req.body?.twitter_id || req.body?.twitterId;
    if (!twitterId) {
      return res.status(400).json({ ok: false, error: "twitter-id-required" });
    }

    // get target (@7goldencowries) id
    const target = await twitterGet(
      `https://api.twitter.com/2/users/by/username/${REQUIRED_HANDLE}`
    );
    const targetId = target?.data?.id;
    if (!targetId) {
      return res.status(500).json({ ok: false, error: "target-not-found" });
    }

    const following = await twitterGet(
      `https://api.twitter.com/2/users/${twitterId}/following?max_results=1000`
    );

    const isFollowing =
      Array.isArray(following?.data) &&
      following.data.some((u) => String(u.id) === String(targetId));

    if (!isFollowing) {
      return res.json({ ok: true, verified: false });
    }

    await awardQuestOnce(user.id, "follow-twitter", 50);
    return res.json({
      ok: true,
      verified: true,
      quest: "follow-twitter",
      xp: 50,
    });
  } catch (e) {
    console.error("/api/twitter/verify/follow", e);
    return res.status(500).json({ ok: false, error: "internal" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/twitter/verify/retweet
// body: { twitter_id }
// ---------------------------------------------------------------------------
router.post("/verify/retweet", async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ ok: false, error: "no-user" });

    const twitterId = req.body?.twitter_id || req.body?.twitterId;
    if (!twitterId) {
      return res.status(400).json({ ok: false, error: "twitter-id-required" });
    }

    const retweetedBy = await twitterGet(
      `https://api.twitter.com/2/tweets/${PINNED_TWEET_ID}/retweeted_by?max_results=1000`
    );

    const didRetweet =
      Array.isArray(retweetedBy?.data) &&
      retweetedBy.data.some((u) => String(u.id) === String(twitterId));

    if (!didRetweet) {
      return res.json({ ok: true, verified: false });
    }

    await awardQuestOnce(user.id, "retweet-pinned", 75);
    return res.json({
      ok: true,
      verified: true,
      quest: "retweet-pinned",
      xp: 75,
    });
  } catch (e) {
    console.error("/api/twitter/verify/retweet", e);
    return res.status(500).json({ ok: false, error: "internal" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/twitter/verify/quote
// body: { twitter_id }
// ---------------------------------------------------------------------------
router.post("/verify/quote", async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ ok: false, error: "no-user" });

    const twitterId = req.body?.twitter_id || req.body?.twitterId;
    if (!twitterId) {
      return res.status(400).json({ ok: false, error: "twitter-id-required" });
    }

    const query = encodeURIComponent(`from:${twitterId} url:"${PINNED_TWEET_ID}"`);
    const search = await twitterGet(
      `https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=10`
    );

    const quoted = Array.isArray(search?.data) && search.data.length > 0;

    if (!quoted) {
      return res.json({ ok: true, verified: false });
    }

    await awardQuestOnce(user.id, "quote-pinned", 90);
    return res.json({
      ok: true,
      verified: true,
      quest: "quote-pinned",
      xp: 90,
    });
  } catch (e) {
    console.error("/api/twitter/verify/quote", e);
    return res.status(500).json({ ok: false, error: "internal" });
  }
});

// IMPORTANT: default export so `import twitterVerifyRouter from "./routes/twitterVerify.js";` works
export default router;
