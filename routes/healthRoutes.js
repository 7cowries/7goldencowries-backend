import express from "express";
import db from "../db.js";

const router = express.Router();

async function healthHandler(_req, res) {
  let dbStatus = "ok";
  try {
    await db.get("SELECT 1");
  } catch {
    dbStatus = "down";
  }
  res.json({ ok: true, db: dbStatus });
}

router.get("/health", healthHandler);
router.get("/api/health", healthHandler); // alias for backward compatibility

export default router;
