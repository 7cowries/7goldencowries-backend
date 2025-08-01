// routes/twitterRoutes.js
import express from "express";
import fetch from "node-fetch";
import db from "../db.js";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

const BEARER = process.env.TWITTER_BEARER;
const VERIFY_TARGET_ID = "1749440852192760064"; // @7goldencowries user ID
const ANNOUNCEMENT_TWEET_ID = "1945021057003401354"; // pinned tweet ID

// Get Twitter handle from wallet
function getTwitterHandle(wallet) {
  const row = db.prepare("SELECT twitterHandle FROM users WHERE wallet = ?").get(wallet);
  return row?.twitterHandle || null;
}

// ✅ Follow verification
router.get("/verify/follow/:wallet", async (req, res) => {
  const wallet = req.params.wallet;
  const username = getTwitterHandle(wallet);
  if (!username) return res.status(404).json({ error: "No linked Twitter." });

  try {
    const userRes = await fetch(`https://api.twitter.com/2/users/by/username/${username}`, {
      headers: { Authorization: `Bearer ${BEARER}` }
    });
    const user = await userRes.json();
    const userId = user.data?.id;
    if (!userId) return res.status(404).json({ error: "User not found on Twitter" });

    const followingRes = await fetch(
      `https://api.twitter.com/2/users/${userId}/following?max_results=1000`,
      { headers: { Authorization: `Bearer ${BEARER}` } }
    );
    const following = await followingRes.json();
    const follows = following.data?.some((u) => u.id === VERIFY_TARGET_ID);

    res.json({ follows });
  } catch (err) {
    console.error("❌ Twitter follow check failed:", err);
    res.status(500).json({ error: "Twitter API error" });
  }
});

// ✅ Retweet verification
router.get("/verify/retweet/:wallet", async (req, res) => {
  const wallet = req.params.wallet;
  const username = getTwitterHandle(wallet);
  if (!username) return res.status(404).json({ error: "No linked Twitter." });

  try {
    const userRes = await fetch(`https://api.twitter.com/2/users/by/username/${username}`, {
      headers: { Authorization: `Bearer ${BEARER}` }
    });
    const user = await userRes.json();
    const userId = user.data?.id;

    const historyRes = await fetch(
      `https://api.twitter.com/2/users/${userId}/tweets?tweet.fields=referenced_tweets`,
      { headers: { Authorization: `Bearer ${BEARER}` } }
    );
    const result = await historyRes.json();

    const retweeted = result.data?.some((tweet) =>
      tweet.referenced_tweets?.some(rt => rt.type === "retweeted" && rt.id === ANNOUNCEMENT_TWEET_ID)
    );

    res.json({ retweeted });
  } catch (err) {
    console.error("❌ Retweet check failed:", err);
    res.status(500).json({ error: "Twitter API error" });
  }
});

// ✅ Quote tweet verification
router.get("/verify/quote/:wallet", async (req, res) => {
  const wallet = req.params.wallet;
  const username = getTwitterHandle(wallet);
  if (!username) return res.status(404).json({ error: "No linked Twitter." });

  try {
    const userRes = await fetch(`https://api.twitter.com/2/users/by/username/${username}`, {
      headers: { Authorization: `Bearer ${BEARER}` }
    });
    const user = await userRes.json();
    const userId = user.data?.id;

    const historyRes = await fetch(
      `https://api.twitter.com/2/users/${userId}/tweets?tweet.fields=referenced_tweets`,
      { headers: { Authorization: `Bearer ${BEARER}` } }
    );
    const result = await historyRes.json();

    const quoted = result.data?.some((tweet) =>
      tweet.referenced_tweets?.some(rt => rt.type === "quoted" && rt.id === ANNOUNCEMENT_TWEET_ID)
    );

    res.json({ quoted });
  } catch (err) {
    console.error("❌ Quote check failed:", err);
    res.status(500).json({ error: "Twitter API error" });
  }
});

export default router;
