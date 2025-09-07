import express from "express";
import db from "../db.js";

const router = express.Router();

const healthHandler = (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), timestamp: Date.now() });
};

router.get(["/api/health", "/health"], healthHandler);

router.get("/api/health/db", async (_req, res) => {
  try {
    await db.get("SELECT 1");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

export default router;
