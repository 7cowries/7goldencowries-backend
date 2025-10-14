import express from "express";
import db from "../db.js";

const router = express.Router();

function tierMultiplier(tier) {
  if (!tier) return 1.0;
  const t = String(tier).toLowerCase();
  if (t === "tier 3") return 1.5;
  if (t === "tier 2") return 1.25;
  if (t === "tier 1") return 1.10;
  return 1.0;
}

function computeLevel(xp) {
  const levels = [
    { name: "Shellborn", base: 0, size: 10000 },
    { name: "Seafarer", base: 10000, size: 15000 },
    { name: "Navigator", base: 25000, size: 25000 },
    { name: "Captain", base: 50000, size: 50000 },
    { name: "Admiral", base: 100000, size: 100000 },
    { name: "Legend", base: 200000, size: 150000 },
  ];
  let current = levels[0];
  for (let i = levels.length - 1; i >= 0; i--) {
    if (xp >= levels[i].base) { current = levels[i]; break; }
  }
  const progress = Math.max(0, Math.min(1, (xp - current.base) / (current.size || 1)));
  return { levelName: current.name, levelProgress: Number(progress.toFixed(3)) };
}

/**
 * GET /quests
 * Returns active quests with per-user status: pending|completed|claimed
 */
router.get("/quests", async (req, res) => {
  try {
    const uid = req.session?.userId || -1;
    const rows = await db.all(`
      SELECT
        q.*,
        COALESCE(uq.status, 'pending') as status,
        uq.claimedAt as claimedAt
      FROM quests q
      LEFT JOIN user_quests uq
        ON uq.questId = q.id AND uq.userId = ?
      WHERE q.active = 1
      ORDER BY
        CASE q.category
          WHEN 'daily' THEN 1
          WHEN 'social' THEN 2
          WHEN 'partner' THEN 3
          WHEN 'insider' THEN 4
          WHEN 'onchain' THEN 5
          ELSE 6
        END, q.id ASC
    `, [uid]);
    return res.json({ ok: true, quests: rows });
  } catch (e) {
    console.error("GET /quests error", e);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/**
 * POST /quests/claim  { key }
 * Requires session; awards XP (with subscription multiplier), marks quest claimed.
 */
router.post("/quests/claim", async (req, res) => {
  const uid = req.session?.userId;
  if (!uid) return res.status(401).json({ ok: false, error: "not_logged_in" });
  try {
    const key = (req.body?.key || "").trim();
    if (!key) return res.status(400).json({ ok: false, error: "key_required" });

    const quest = await db.get("SELECT * FROM quests WHERE key = ? AND active = 1", [key]);
    if (!quest) return res.status(404).json({ ok: false, error: "quest_not_found" });

    const uq = await db.get("SELECT status FROM user_quests WHERE userId = ? AND questId = ?", [uid, quest.id]);
    if (uq?.status === "claimed") {
      const user = await db.get("SELECT * FROM users WHERE id = ?", [uid]);
      return res.json({ ok: true, already: true, quest, user: {
        id: user.id, wallet: user.wallet, xp: user.xp,
        levelName: user.levelName, levelProgress: user.levelProgress, subscriptionTier: user.subscriptionTier
      }});
    }

    const user = await db.get("SELECT * FROM users WHERE id = ?", [uid]);
    const mult = tierMultiplier(user?.subscriptionTier);
    const award = Math.round((quest.xp || 0) * mult);

    await db.run(`
      INSERT INTO user_quests (userId, questId, status, claimedAt)
      VALUES (?,?, 'claimed', datetime('now'))
      ON CONFLICT(userId, questId) DO UPDATE SET status='claimed', claimedAt=datetime('now')
    `, [uid, quest.id]);

    const newXp = (user?.xp || 0) + award;
    const { levelName, levelProgress } = computeLevel(newXp);
    await db.run(
      "UPDATE users SET xp = ?, levelName = ?, levelProgress = ? WHERE id = ?",
      [newXp, levelName, levelProgress, uid]
    );
    const updated = await db.get("SELECT * FROM users WHERE id = ?", [uid]);

    return res.json({
      ok: true,
      quest: { key: quest.key, xp: quest.xp, category: quest.category },
      awarded: award,
      user: {
        id: updated.id, wallet: updated.wallet, xp: updated.xp,
        levelName: updated.levelName, levelProgress: updated.levelProgress, subscriptionTier: updated.subscriptionTier
      }
    });
  } catch (e) {
    console.error("POST /quests/claim error", e);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
