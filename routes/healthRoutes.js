import express from "express";
import db from "../db.js";
import logger from "../lib/logger.js";

const router = express.Router();

router.get(["/api/health", "/health"], async (_req, res) => {
  const status = { ok: true, uptime: process.uptime() };
  try {
    await db.get("SELECT 1");
    status.db = "up";
  } catch (e) {
    status.db = "down";
    status.ok = false;
    logger.error({ action: "health-db-error", err: e.message });
  }
  status.queue = "ok";
  res.status(status.ok ? 200 : 500).json(status);
});

router.get("/api/health/db", async (_req, res) => {
  try {
    await db.get("SELECT 1");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

export default router;
