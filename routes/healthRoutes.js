import express from "express";
import db from "../lib/db.js";

const router = express.Router();

async function healthHandler(_req, res) {
  try {
    await db.get("SELECT 1");
  } catch (err) {
    console.error("Healthcheck DB probe failed", err);
    return res.status(500).json({ ok: false, db: "down" });
  }

  res.json({ ok: true, db: "ok" });
}

router.get("/api/health", healthHandler);
router.get("/health", healthHandler);
router.get("/healthz", healthHandler);

export default router;
