import express from "express";
import db from "../db.js";

const router = express.Router();

router.get("/api/health/db", async (_req, res) => {
  try {
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    const counts = {};
    for (const t of tables) {
      try {
        const row = await db.get(`SELECT COUNT(*) AS c FROM ${t.name}`);
        counts[t.name] = row.c;
      } catch (e) {
        counts[t.name] = null;
      }
    }
    res.json({ ok: true, tables: tables.map(t => t.name), counts });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
