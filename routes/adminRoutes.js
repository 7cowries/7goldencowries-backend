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

export default router;

