import express from "express";
import db from "../lib/db.js";

const router = express.Router();

function startupChecks() {
  const requiredWhenEnabled = [
    { enabled: process.env.NOMBA_ENABLED === "1", name: "NOMBA_SECRET_KEY" },
    { enabled: process.env.TON_PAYMENTS_ENABLED === "1", name: "TON_WALLET_ADDRESS" },
  ];

  const missing = requiredWhenEnabled
    .filter(({ enabled, name }) => enabled && !process.env[name])
    .map(({ name }) => name);

  return {
    ok: missing.length === 0,
    missing,
  };
}

async function healthHandler(_req, res) {
  const checks = {
    db: "ok",
    startup: startupChecks(),
  };

  try {
    await db.get("SELECT 1");
  } catch (err) {
    console.error("Healthcheck DB probe failed", err);
    checks.db = "down";
    return res.status(500).json({
      ok: false,
      service: "7goldencowries-backend",
      version: process.env.RELEASE_VERSION || process.env.npm_package_version || "dev",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      checks,
    });
  }

  const status = checks.startup.ok ? 200 : 503;

  return res.status(status).json({
    ok: checks.startup.ok,
    service: "7goldencowries-backend",
    version: process.env.RELEASE_VERSION || process.env.npm_package_version || "dev",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    checks,
  });
}

router.get("/api/health", healthHandler);
router.get("/api/healthz", healthHandler);
router.get("/health", healthHandler);
router.get("/healthz", healthHandler);

export default router;
