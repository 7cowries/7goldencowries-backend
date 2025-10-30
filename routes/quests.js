// routes/quests.js — live, uses DB quests table
import express from "express";
import dbp from "../db.js";

const router = express.Router();

async function getDb() {
  return dbp;
}

// list quests
router.get("/", async (req, res) => {
  const db = await getDb();
  const rows = await db.all(`SELECT id, title, description, category, type, xp, link FROM quests ORDER BY created_at DESC;`);
  res.json({ ok: true, quests: rows });
});

// claim quest (idempotent)
router.post("/claim", async (req, res) => {
  const db = await getDb();
  const wallet = req.session?.address || req.body?.wallet || req.body?.address;
  const questId = req.body?.id;
  if (!wallet) return res.status(401).json({ ok: false, error: "wallet-required" });
  if (!questId) return res.status(400).json({ ok: false, error: "quest-id-required" });

  // get quest
  const quest = await db.get(`SELECT * FROM quests WHERE id = ?`, questId);
  if (!quest) return res.status(404).json({ ok: false, error: "quest-not-found" });

  // check if already claimed
  const already = await db.get(
    `SELECT id FROM user_quests WHERE wallet = ? AND quest_id = ? LIMIT 1`,
    wallet,
    questId
  );
  if (already) {
    return res.json({ ok: true, claimed: false, reason: "already-claimed" });
  }

  // insert completion
  await db.run(
    `INSERT INTO user_quests (wallet, quest_id, status, xp_awarded)
     VALUES (?, ?, 'completed', ?)`,
    wallet,
    questId,
    quest.xp || 0
  );

  // add xp to user
  await db.run(
    `INSERT OR IGNORE INTO users (wallet, xp, level, level_name) VALUES (?, 0, 1, 'Shellborn')`,
    wallet
  );
  await db.run(
    `UPDATE users SET xp = COALESCE(xp,0) + ? WHERE wallet = ?`,
    quest.xp || 0,
    wallet
  );

  res.json({ ok: true, claimed: true, xp: quest.xp || 0 });
});

export default router;
