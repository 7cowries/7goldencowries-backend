// routes/quests.js — live quests, NO schema changes here
import { Router } from "express";
import dbp from "../db.js";

const router = Router();
const dbPromise = dbp;

// GET /api/quests
router.get("/", async (req, res) => {
  const db = await dbPromise;
  const rows = await db.all(
    `SELECT id, title, description, category, xp, link, sort_order, is_active
     FROM quests
     WHERE is_active = 1
     ORDER BY sort_order, title;`
  );
  res.json({ ok: true, quests: rows });
});

// POST /api/quests/claim
router.post("/claim", async (req, res) => {
  const db = await dbPromise;
  const wallet =
    req.session?.address || req.get("x-wallet") || req.body?.address || req.body?.wallet || null;
  if (!wallet) return res.status(401).json({ ok: false, error: "wallet-required" });

  const questId = (req.body?.questId || req.body?.id || "").trim();
  if (!questId) return res.status(400).json({ ok: false, error: "quest-id-required" });

  const quest = await db.get(`SELECT * FROM quests WHERE id = ? AND is_active = 1;`, questId);
  if (!quest) return res.status(404).json({ ok: false, error: "quest-not-found" });

  // ensure user exists
  await db.run(`INSERT OR IGNORE INTO users (wallet) VALUES (?);`, wallet);
  const user = await db.get(`SELECT id, xp FROM users WHERE wallet = ?;`, wallet);

  // insert completion
  await db.run(
    `INSERT OR IGNORE INTO user_quests (user_id, wallet, quest_id, completed_at)
     VALUES (?, ?, ?, datetime('now'));`,
    user.id,
    wallet,
    questId
  );

  // award XP
  await db.run(
    `UPDATE users SET xp = xp + ?, updated_at = datetime('now') WHERE id = ?;`,
    quest.xp,
    user.id
  );

  // soft leaderboard bump (ignore errors)
  try {
    await db.run(
      `INSERT INTO leaderboard (wallet, xp, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(wallet) DO UPDATE SET
         xp = xp + excluded.xp,
         updated_at = datetime('now');`,
      wallet,
      quest.xp
    );
  } catch (_) {
    // ignore if leaderboard table not present
  }

  res.json({
    ok: true,
    claimed: true,
    questId,
    xpDelta: quest.xp,
  });
});

// optional proof
router.post("/proof", async (_req, res) => {
  res.json({ ok: true });
});

export default router;
