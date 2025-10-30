// routes/twitterVerify.js — ESM, default export
import express from "express";
import dbp from "../db.js";

const router = express.Router();

const TW_BEARER = process.env.TWITTER_BEARER_TOKEN || "";

async function getDb() {
  return dbp;
}

// make sure user exists
async function ensureUser(wallet) {
  const db = await getDb();
  await db.run(
    `INSERT OR IGNORE INTO users (wallet, xp, level, level_name)
     VALUES (?, 0, 1, 'Shellborn')`,
    wallet
  );
  return db.get(`SELECT * FROM users WHERE wallet = ?`, wallet);
}

async function awardQuest(wallet, questId, xp) {
  const db = await getDb();
  if (!wallet) return;
  // check if already awarded
  const already = await db.get(
    `SELECT id FROM user_quests WHERE wallet = ? AND quest_id = ? LIMIT 1`,
    wallet,
    questId
  );
  if (already) return;

  await db.run(
    `INSERT INTO user_quests (wallet, quest_id, status, xp_awarded)
     VALUES (?, ?, 'completed', ?)`,
    wallet,
    questId,
    xp
  );
  await db.run(
    `UPDATE users SET xp = COALESCE(xp,0) + ? WHERE wallet = ?`,
    xp,
    wallet
  );
}

async function twitterGet(path) {
  if (!TW_BEARER) {
    return { ok: false, error: "TWITTER_BEARER_TOKEN missing" };
  }
  const r = await fetch(`https://api.twitter.com/2${path}`, {
    headers: {
      Authorization: `Bearer ${TW_BEARER}`,
    },
  });
  if (!r.ok) {
    const text = await r.text();
    return { ok: false, error: text || r.statusText };
  }
  return { ok: true, data: await r.json() };
}

// verify follow
router.post("/follow", async (req, res) => {
  const wallet = req.session?.address || req.body?.wallet || req.body?.address;
  const userToCheck = req.body?.user_id; // twitter user id of the player
  const targetHandle = "7goldencowries";

  if (!wallet) return res.status(401).json({ ok: false, error: "wallet-required" });
  if (!userToCheck) return res.status(400).json({ ok: false, error: "twitter-user-id-required" });

  // get our account id
  const me = await twitterGet(`/users/by/username/${targetHandle}`);
  if (!me.ok) return res.status(500).json(me);
  const targetId = me.data?.data?.id;
  if (!targetId) return res.status(500).json({ ok: false, error: "target-id-missing" });

  // check if userToCheck follows targetId
  const flw = await twitterGet(`/users/${userToCheck}/following`);
  if (!flw.ok) return res.status(500).json(flw);
  const arr = flw.data?.data || [];
  const isFollowing = arr.some((x) => x.id === targetId);

  if (!isFollowing) {
    return res.json({ ok: false, followed: false });
  }

  await ensureUser(wallet);
  await awardQuest(wallet, "follow-twitter", 50);

  res.json({ ok: true, followed: true, xp: 50 });
});

// verify retweet of pinned tweet
router.post("/retweet", async (req, res) => {
  const wallet = req.session?.address || req.body?.wallet || req.body?.address;
  const userToCheck = req.body?.user_id; // twitter user id of the player
  const tweetId = "1947595024117502145";

  if (!wallet) return res.status(401).json({ ok: false, error: "wallet-required" });
  if (!userToCheck) return res.status(400).json({ ok: false, error: "twitter-user-id-required" });

  const rts = await twitterGet(`/tweets/${tweetId}/retweeted_by`);
  if (!rts.ok) return res.status(500).json(rts);
  const arr = rts.data?.data || [];
  const hasRt = arr.some((x) => x.id === userToCheck);

  if (!hasRt) {
    return res.json({ ok: false, retweeted: false });
  }

  await ensureUser(wallet);
  await awardQuest(wallet, "retweet-pinned", 75);

  res.json({ ok: true, retweeted: true, xp: 75 });
});

// verify quote
router.post("/quote", async (req, res) => {
  const wallet = req.session?.address || req.body?.wallet || req.body?.address;
  const userToCheck = req.body?.user_id;
  const tweetId = "1947595024117502145";

  if (!wallet) return res.status(401).json({ ok: false, error: "wallet-required" });
  if (!userToCheck) return res.status(400).json({ ok: false, error: "twitter-user-id-required" });

  // get quote tweets
  const qt = await twitterGet(`/tweets/${tweetId}/quote_tweets`);
  if (!qt.ok) return res.status(500).json(qt);
  const arr = qt.data?.data || [];
  const hasQuote = arr.some((x) => x.author_id === userToCheck);

  if (!hasQuote) {
    return res.json({ ok: false, quoted: false });
  }

  await ensureUser(wallet);
  await awardQuest(wallet, "quote-tweet", 100);

  res.json({ ok: true, quoted: true, xp: 100 });
});

export default router;
