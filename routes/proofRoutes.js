import express from "express";
import db from "../lib/db.js";
import { awardQuest } from "../lib/quests.js";
import { delCache } from "../utils/cache.js";
import { deriveLevel } from "../config/progression.js";

const BASE_LEVEL = deriveLevel(0);

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const quest_id = req.body?.quest_id ?? req.body?.questId;
    const wallet = String(req.body?.wallet || "").trim();
    const url = String(req.body?.url || "").trim();
    if (!quest_id || !wallet || !url) {
      return res.status(400).json({ error: "bad-args" });
    }

    const quest = await db.get("SELECT id FROM quests WHERE id = ?", quest_id);
    if (!quest) {
      return res.status(404).json({ error: "quest-not-found" });
    }

    const existing = await db.get(
      "SELECT id FROM quest_proofs WHERE wallet = ? AND quest_id = ?",
      wallet,
      quest_id
    );
    if (existing) {
      return res.status(409).json({ error: "already-submitted" });
    }

    await db.run(
      `INSERT INTO quest_proofs (quest_id, wallet, url, createdAt, updatedAt)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
      quest_id,
      wallet,
      url
    );

    await db.run(
      `INSERT OR IGNORE INTO users (wallet, xp, tier, level, levelName, levelSymbol, levelProgress, nextXP, updatedAt)
       VALUES (?, 0, 'Free', ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      wallet,
      BASE_LEVEL.level,
      BASE_LEVEL.levelName,
      BASE_LEVEL.levelSymbol,
      BASE_LEVEL.progress,
      BASE_LEVEL.nextNeed
    );

    const result = await awardQuest(wallet, quest_id);
    delCache(`user:${wallet}`);
    delCache('leaderboard');
    const row = await db.get("SELECT xp FROM users WHERE wallet = ?", wallet);
    const newTotalXp = row?.xp ?? 0;

    res.json({
      ok: true,
      quest_id,
      xp: newTotalXp,
      alreadyClaimed: result.already ? true : undefined,
    });
  } catch (e) {
    console.error("manual proof submission error", e);
    res.status(500).json({ error: "server-error" });
  }
});

export default router;
