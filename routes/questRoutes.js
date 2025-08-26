// routes/questRoutes.js
import express from "express";
import db from "../db.js";
import { getLevelInfo } from "../utils/levelUtils.js";

const router = express.Router();

/**
 * GET /api/quest/quests
 * Return all quests (normalized fields)
 */
router.get("/quests", async (_req, res) => {
  try {
    const rows = await db.all(
      `SELECT
          id,
          title,
          type,
          url,
          xp,
          COALESCE(requiredTier, 'Free')        AS requiredTier,
          COALESCE(requiresTwitter, 0)          AS requiresTwitter,
          COALESCE(target_handle, NULL)         AS target_handle
       FROM quests
       ORDER BY id`
    );

    const quests = rows.map((q) => ({
      id: q.id,
      title: q.title || "",
      type: (q.type || "daily").toLowerCase(),
      url: q.url || "#",
      xp: Number(q.xp || 0),
      requiredTier: q.requiredTier || "Free",
      requiresTwitter: !!q.requiresTwitter,
      target_handle: q.target_handle || null,
    }));

    res.json(quests);
  } catch (err) {
    console.error("Failed to fetch quests:", err);
    res.status(500).json({ error: "Failed to load quests" });
  }
});

/**
 * GET /api/quest/completed/:wallet
 * List of completed quest IDs for a given wallet
 */
router.get("/completed/:wallet", async (req, res) => {
  const wallet = (req.params.wallet || "").trim();
  if (!wallet) return res.status(400).json({ error: "Missing wallet" });

  try {
    const rows = await db.all(
      `SELECT questId FROM completed_quests WHERE wallet = ? ORDER BY timestamp DESC`,
      wallet
    );

    // ensure numeric IDs
    const completed = rows.map((r) => Number(r.questId)).filter((n) => Number.isFinite(n));
    res.json({ completed });
  } catch (err) {
    console.error("Fetch completed error:", err);
    res.status(500).json({ error: "Failed to fetch completed quests" });
  }
});

/**
 * GET /api/quest/journal/:wallet
 * Recent quest journal entries for a wallet
 */
router.get("/journal/:wallet", async (req, res) => {
  const wallet = (req.params.wallet || "").trim();
  if (!wallet) return res.status(400).json({ error: "Missing wallet" });

  try {
    const journal = await db.all(
      `SELECT q.title, q.xp, c.timestamp
         FROM completed_quests c
         JOIN quests q ON q.id = c.questId
        WHERE c.wallet = ?
        ORDER BY c.timestamp DESC
        LIMIT 200`,
      wallet
    );
    res.json({ journal });
  } catch (err) {
    console.error("Journal fetch error:", err);
    res.status(500).json({ error: "Failed to fetch journal" });
  }
});

/**
 * POST /api/quest/complete
 * Body: { wallet, questId, title? }
 * - Validates quest exists
 * - Enforces required tier
 * - Enforces Twitter link when required
 * - Applies tier multiplier
 * - Updates xp, level fields, and inserts completed_quests
 * - First completion triggers referral bonus (50 XP to referrer)
 */
router.post("/complete", async (req, res) => {
  try {
    const rawWallet = req.body?.wallet;
    const rawQuestId = req.body?.questId;

    const wallet = (rawWallet || "").trim();
    const questId = Number(rawQuestId);

    if (!wallet || !Number.isFinite(questId)) {
      return res.status(400).json({ success: false, message: "Missing wallet or questId" });
    }

    // Already completed?
    const dup = await db.get(
      `SELECT 1 FROM completed_quests WHERE wallet = ? AND questId = ?`,
      wallet,
      questId
    );
    if (dup) {
      return res.status(400).json({ success: false, message: "Quest already completed" });
    }

    // Load user & quest
    const user = await db.get(`SELECT wallet, xp, tier, twitterHandle FROM users WHERE wallet = ?`, wallet);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const quest = await db.get(
      `SELECT
          id,
          title,
          type,
          url,
          xp,
          COALESCE(requiresTwitter, 0)  AS requiresTwitter,
          COALESCE(requiredTier, 'Free') AS requiredTier,
          COALESCE(target_handle, NULL)  AS target_handle
        FROM quests
       WHERE id = ?`,
      questId
    );
    if (!quest) return res.status(404).json({ success: false, message: "Quest not found" });

    // Enforce Twitter link if needed
    if (quest.requiresTwitter) {
      const link = await db.get(`SELECT twitter FROM social_links WHERE wallet = ?`, wallet);
      const hasTwitter = link?.twitter || user?.twitterHandle;
      if (!hasTwitter) {
        return res.status(403).json({
          success: false,
          message: "This quest requires a linked Twitter account.",
        });
      }
      // (Optional) future verification: check quest.target_handle follow/retweet/etc.
    }

    // Enforce tier gate
    const tierOrder = { Free: 0, "Tier 1": 1, "Tier 2": 2, "Tier 3": 3 };
    const userTier = user.tier || "Free";
    const requiredTier = quest.requiredTier || "Free";
    if ((tierOrder[userTier] ?? 0) < (tierOrder[requiredTier] ?? 0)) {
      return res.status(403).json({
        success: false,
        message: `This quest requires ${requiredTier}`,
      });
    }

    // XP with multipliers
    const multiplierByTier = { Free: 1.0, "Tier 1": 1.2, "Tier 2": 1.5, "Tier 3": 2.0 };
    const xpGain = Math.max(0, Math.round(Number(quest.xp || 0) * (multiplierByTier[userTier] ?? 1)));

    // Update XP
    await db.run(`UPDATE users SET xp = xp + ? WHERE wallet = ?`, xpGain, wallet);

    // Recompute level
    const { xp } = await db.get(`SELECT xp FROM users WHERE wallet = ?`, wallet);
    const lvl = getLevelInfo(xp);

    await db.run(
      `UPDATE users
          SET levelName = ?, levelSymbol = ?, levelProgress = ?, nextXP = ?
        WHERE wallet = ?`,
      lvl.name,
      lvl.symbol,
      lvl.progress,
      lvl.nextXP,
      wallet
    );

    // Mark completed
    await db.run(
      `INSERT INTO completed_quests (wallet, questId, timestamp)
       VALUES (?, ?, ?)`,
      wallet,
      questId,
      new Date().toISOString()
    );

    // Referral bonus on first completion: +50 XP to referrer
    const { count } = await db.get(
      `SELECT COUNT(*) AS count FROM completed_quests WHERE wallet = ?`,
      wallet
    );
    if (Number(count) === 1) {
      const ref = await db.get(
        `SELECT referrer FROM referrals WHERE referred = ? AND completed = 0`,
        wallet
      );
      if (ref?.referrer) {
        await db.run(`UPDATE referrals SET completed = 1 WHERE referred = ?`, wallet);
        await db.run(`UPDATE users SET xp = xp + 50 WHERE wallet = ?`, ref.referrer);

        const { xp: refXp } = await db.get(`SELECT xp FROM users WHERE wallet = ?`, ref.referrer);
        const refLvl = getLevelInfo(refXp);
        await db.run(
          `UPDATE users
              SET levelName = ?, levelSymbol = ?, levelProgress = ?, nextXP = ?
            WHERE wallet = ?`,
          refLvl.name,
          refLvl.symbol,
          refLvl.progress,
          refLvl.nextXP,
          ref.referrer
        );
        console.log(`✨ Referral XP awarded to ${ref.referrer}`);
      }
    }

    return res.json({ success: true, message: `+${xpGain} XP gained!`, xpGain });
  } catch (err) {
    console.error("Quest complete error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;
