// routes/twitterVerify.js — ESM, works with default db export, live Twitter checks
import express from "express";
import dbp from "../db.js";

const router = express.Router();
const TW_BEARER =
  process.env.TWITTER_BEARER_TOKEN ||
  "AAAAAAAAAAAAAAAAAAAAAIxG3AEAAAAAlaSl7FDcA1PBH8GscvvCavtPD%2BU%3DlzjUx07zch0zYHZtgbBhTAFl6AuLY1AlbmoIGdy6jjunWswiJS";

const TARGET_HANDLE = "7goldencowries";

async function getDb() {
  return await dbp;
}

async function twitterGetUserByHandle(handle) {
  const url = `https://api.twitter.com/2/users/by/username/${handle}?user.fields=id,username,name`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${TW_BEARER}` }
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j?.data || null;
}

async function twitterGetUserFollows(sourceId, targetId) {
  const url = `https://api.twitter.com/2/users/${sourceId}/following?max_results=1000`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${TW_BEARER}` }
  });
  if (!r.ok) return false;
  const j = await r.json();
  const data = j?.data || [];
  return data.some((x) => x.id === targetId);
}

async function twitterHasRetweeted(userId, tweetId) {
  const url = `https://api.twitter.com/2/tweets/${tweetId}/retweeted_by`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${TW_BEARER}` }
  });
  if (!r.ok) return false;
  const j = await r.json();
  const data = j?.data || [];
  return data.some((x) => x.id === userId);
}

async function twitterHasQuoted(userId, tweetId) {
  const url = `https://api.twitter.com/2/tweets/search/recent?query=url:${tweetId} is:quote author_id:${userId}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${TW_BEARER}` }
  });
  if (!r.ok) return false;
  const j = await r.json();
  const data = j?.data || [];
  return data.length > 0;
}

// helper: mark quest completed
async function markQuestCompleted(wallet, questId, xp) {
  const db = await getDb();
  // get/create user
  await db.run(
    `INSERT OR IGNORE INTO users (wallet) VALUES (?);`,
    wallet
  );
  const user = await db.get(`SELECT id, xp FROM users WHERE wallet = ?;`, wallet);

  // insert into user_quests
  await db.run(
    `INSERT INTO user_quests (user_id, wallet, quest_id, status, xp_awarded)
     VALUES (?, ?, ?, 'completed', ?);`,
    user.id,
    wallet,
    questId,
    xp
  );

  // bump xp
  await db.run(
    `UPDATE users SET xp = xp + ?, updated_at = datetime('now') WHERE id = ?;`,
    xp,
    user.id
  );

  return { userXp: user.xp + xp };
}

// GET /api/twitter/verify/health
router.get("/health", (_req, res) => {
  res.json({ ok: true, twitter: !!TW_BEARER });
});

// POST /api/twitter/verify/follow
router.post("/follow", async (req, res) => {
  try {
    const wallet = req.body?.wallet || req.body?.address || null;
    const handle = req.body?.handle || req.body?.twitter || null;
    if (!wallet) return res.status(400).json({ ok: false, error: "wallet-required" });
    if (!handle) return res.status(400).json({ ok: false, error: "handle-required" });

    const targetUser = await twitterGetUserByHandle(TARGET_HANDLE);
    const sourceUser = await twitterGetUserByHandle(handle);
    if (!targetUser || !sourceUser) {
      return res.status(400).json({ ok: false, error: "twitter-user-not-found" });
    }

    const isFollowing = await twitterGetUserFollows(sourceUser.id, targetUser.id);
    if (!isFollowing) {
      return res.json({ ok: false, verified: false });
    }

    const { userXp } = await markQuestCompleted(wallet, "follow-x-7goldencowries", 50);
    res.json({ ok: true, verified: true, xp: 50, totalXp: userXp });
  } catch (e) {
    console.error("[twitter/follow]", e);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// POST /api/twitter/verify/retweet
router.post("/retweet", async (req, res) => {
  try {
    const wallet = req.body?.wallet || req.body?.address || null;
    const handle = req.body?.handle || req.body?.twitter || null;
    const tweetId =
      req.body?.tweetId || "1947595024117502145"; // your pinned tweet
    if (!wallet) return res.status(400).json({ ok: false, error: "wallet-required" });
    if (!handle) return res.status(400).json({ ok: false, error: "handle-required" });

    const user = await twitterGetUserByHandle(handle);
    if (!user) return res.status(400).json({ ok: false, error: "twitter-user-not-found" });

    const hasRt = await twitterHasRetweeted(user.id, tweetId);
    if (!hasRt) {
      return res.json({ ok: false, verified: false });
    }

    const { userXp } = await markQuestCompleted(wallet, "retweet-pinned", 70);
    res.json({ ok: true, verified: true, xp: 70, totalXp: userXp });
  } catch (e) {
    console.error("[twitter/retweet]", e);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// POST /api/twitter/verify/quote
router.post("/quote", async (req, res) => {
  try {
    const wallet = req.body?.wallet || req.body?.address || null;
    const handle = req.body?.handle || req.body?.twitter || null;
    const tweetId =
      req.body?.tweetId || "1947595024117502145";
    if (!wallet) return res.status(400).json({ ok: false, error: "wallet-required" });
    if (!handle) return res.status(400).json({ ok: false, error: "handle-required" });

    const user = await twitterGetUserByHandle(handle);
    if (!user) return res.status(400).json({ ok: false, error: "twitter-user-not-found" });

    const hasQuote = await twitterHasQuoted(user.id, tweetId);
    if (!hasQuote) {
      return res.json({ ok: false, verified: false });
    }

    const { userXp } = await markQuestCompleted(wallet, "quote-pinned", 90);
    res.json({ ok: true, verified: true, xp: 90, totalXp: userXp });
  } catch (e) {
    console.error("[twitter/quote]", e);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
