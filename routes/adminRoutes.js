import express from "express";
import { seedQuestsFromFile } from "../lib/seedQuests.js";
import path from "path";
import db from "../db.js";

const router = express.Router();
const mustAuth = (req, res, next) => {
  const header = req.get("X-Admin-Secret");
  if (!process.env.ADMIN_SECRET || header !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
};

router.post("/quests/seed", mustAuth, async (req, res) => {
  try {
    const file = req.body?.file || "data/quests.live.json";
    const full = path.resolve(file);
    const result = await seedQuestsFromFile(full);
    return res.json({ ok: true, ...result, file: full });
  } catch (e) {
    console.error("seed quests error", e);
    return res.status(500).json({ error: "internal" });
  }
});

router.post("/quests/toggle", mustAuth, async (req, res) => {
  try {
    const { id, active } = req.body || {};
    if (!id || typeof active === "undefined") {
      return res.status(400).json({ error: "id and active required" });
    }
    await db.run(`UPDATE quests SET active=? WHERE id=?`, [active ? 1 : 0, id]);
    return res.json({ ok: true, id, active: !!active });
  } catch (e) {
    console.error("toggle quest error", e);
    return res.status(500).json({ error: "internal" });
  }
});

// Update a user's tier
router.post("/users/tier", mustAuth, async (req, res) => {
  try {
    const { wallet, tier } = req.body || {};
    const map = {
      free: "Free",
      tier1: "Tier 1",
      tier2: "Tier 2",
      tier3: "Tier 3",
    };
    const normalized = map[String(tier).toLowerCase()];
    if (!wallet || !normalized) {
      return res.status(400).json({ error: "wallet and valid tier required" });
    }
    await db.run(
      `UPDATE users SET tier = ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE wallet = ?`,
      normalized,
      wallet
    );
    return res.json({ ok: true, wallet, tier: normalized });
  } catch (e) {
    console.error("update user tier error", e);
    return res.status(500).json({ error: "internal" });
  }
});

// List available tiers and multipliers
router.get("/tiers", mustAuth, async (_req, res) => {
  try {
    const tiers = await db.all(
      `SELECT tier, multiplier, label FROM tier_multipliers ORDER BY tier`
    );
    return res.json({ tiers });
  } catch (e) {
    console.error("list tiers error", e);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;

