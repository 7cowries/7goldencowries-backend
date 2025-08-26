// routes/profileRoutes.js
import express from "express";
import db from "../db.js";
import { getLevelInfo } from "../utils/levelUtils.js";

const router = express.Router();

/* ------------------------------ helpers ------------------------------ */
function resolveWallet(req) {
  // priority: explicit param > query > header > cookie > body
  return (
    (req.params && req.params.wallet) ||
    (req.query && (req.query.wallet || req.query.address)) ||
    req.get("x-wallet") ||
    (req.cookies && (req.cookies.wallet || req.cookies.address)) ||
    (req.body && (req.body.wallet || req.body.address)) ||
    ""
  ).trim();
}

/* Small utility so we don’t duplicate the main logic */
async function buildProfileResponse(wallet) {
  // 1) User core stats
  let user = await db.get(
    `SELECT wallet, xp, tier, levelName, levelSymbol, levelProgress, nextXP, twitterHandle
       FROM users WHERE wallet = ?`,
    wallet
  );

  // If user doesn’t exist yet, create a minimal row so UI has something sane to show
  if (!user) {
    await db.run(
      `INSERT INTO users (wallet, xp, tier, levelName, levelSymbol, levelProgress, nextXP)
       VALUES (?, 0, 'Free', 'Shellborn', '🐚', 0, 10000)`,
      wallet
    );
    user = await db.get(
      `SELECT wallet, xp, tier, levelName, levelSymbol, levelProgress, nextXP, twitterHandle
         FROM users WHERE wallet = ?`,
      wallet
    );
  }

  // 2) Social links
  const links = await db.get(
    `SELECT twitter, telegram, discord
       FROM social_links WHERE wallet = ?`,
    wallet
  );

  // 3) Compute level info if missing/outdated
  const lvl = getLevelInfo(user.xp ?? 0);
  const levelName = user.levelName || lvl.name;
  const levelSymbol = user.levelSymbol || lvl.symbol;
  const levelProgress =
    typeof user.levelProgress === "number" ? user.levelProgress : lvl.progress;
  const nextXP = typeof user.nextXP === "number" ? user.nextXP : lvl.nextXP;

  // 4) History (most recent first)
  const history = await db.all(
    `SELECT q.title, q.xp, c.timestamp
       FROM completed_quests c
       JOIN quests q ON q.id = c.questId
      WHERE c.wallet = ?
      ORDER BY c.timestamp DESC
      LIMIT 100`,
    wallet
  );

  return {
    profile: {
      wallet: user.wallet,
      xp: user.xp ?? 0,
      tier: user.tier || "Free",
      levelName,
      levelSymbol,
      levelProgress,
      nextXP,
      twitterHandle: user.twitterHandle || null,
      links: {
        twitter: links?.twitter || user.twitterHandle || "",
        telegram: links?.telegram || "",
        discord: links?.discord || "",
      },
    },
    history: history || [],
  };
}

/* ------------------------------- routes ------------------------------ */
/**
 * GET /api/profile?wallet=...  (also supports header/cookie/body)
 */
router.get("/", async (req, res) => {
  try {
    const wallet = resolveWallet(req);
    if (!wallet) {
      return res.status(400).json({
        error: "Missing wallet",
        hint:
          "Provide ?wallet=ADDRESS, or send 'x-wallet' header, or use /api/profile/:wallet.",
      });
    }
    const data = await buildProfileResponse(wallet);
    return res.json(data);
  } catch (e) {
    console.error("Profile route error:", e);
    return res.status(500).json({ error: "Failed to load profile" });
  }
});

/**
 * GET /api/profile/:wallet
 * Path alternative to make calling simpler from clients.
 */
router.get("/:wallet", async (req, res) => {
  try {
    const wallet = resolveWallet(req);
    if (!wallet) {
      return res.status(400).json({ error: "Missing wallet" });
    }
    const data = await buildProfileResponse(wallet);
    return res.json(data);
  } catch (e) {
    console.error("Profile route error:", e);
    return res.status(500).json({ error: "Failed to load profile" });
  }
});

export default router;
