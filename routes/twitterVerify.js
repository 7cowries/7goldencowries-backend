// routes/twitterVerify.js — verify follow/retweet/quote on X
import { Router } from "express";

const router = Router();
const BEARER = process.env.TWITTER_BEARER_TOKEN || "";

function needBearer(res) {
  res.status(500).json({ ok: false, error: "TWITTER_BEARER_TOKEN missing" });
}

// GET /api/twitter/verify-follow?wallet=...&target=@7goldencowries
router.get("/verify-follow", async (req, res) => {
  if (!BEARER) return needBearer(res);
  const target = req.query.target || "7goldencowries";
  const wallet = req.query.wallet || req.get("x-wallet") || null;
  const userHandle = req.query.handle;

  if (!wallet && !userHandle) {
    return res.status(400).json({ ok: false, error: "wallet-or-handle-required" });
  }

  // in real flow you would map wallet -> twitter_handle from DB
  // here we accept ?handle=...
  const handle = userHandle || "7goldencowries"; // placeholder user

  const r = await fetch(
    `https://api.twitter.com/2/users/by/username/${encodeURIComponent(handle)}`,
    {
      headers: { Authorization: `Bearer ${BEARER}` },
    }
  );
  if (!r.ok) return res.status(500).json({ ok: false, error: "twitter-lookup-failed" });
  const user = await r.json();
  const userId = user?.data?.id;
  if (!userId) return res.status(404).json({ ok: false, error: "twitter-user-not-found" });

  const r2 = await fetch(
    `https://api.twitter.com/2/users/${userId}/following?max_results=1000`,
    {
      headers: { Authorization: `Bearer ${BEARER}` },
    }
  );
  if (!r2.ok) return res.status(500).json({ ok: false, error: "twitter-following-failed" });
  const following = await r2.json();
  const followed = (following.data || []).some(
    (f) => f.username?.toLowerCase() === String(target).toLowerCase()
  );

  res.json({ ok: true, followed, wallet, target });
});

// you can add verify-retweet, verify-quote here the same way

export default router;
