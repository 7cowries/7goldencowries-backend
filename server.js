// server.js — 7 Golden Cowries (ESM, Render-safe, live quests, TON, referrals)
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import session from "express-session";
import crypto from "node:crypto";

import dbp, { get as dbGet, run as dbRun, all as dbAll } from "./db.js";
import migrateOnBoot from "./scripts/migrate-on-boot.mjs";

import leaderboardRouter from "./routes/leaderboard.js";
import questsRouter from "./routes/quests.js";
import referralsRouter from "./routes/referrals.js";

const app = express();

// run DB migrations first (idempotent)
await migrateOnBoot(console);

// get real db if we need it
const db = await dbp;

// behind Render
app.set("trust proxy", 1);

// security + basics
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "img-src": ["'self'", "data:"],
        "font-src": ["'self'", "https:", "data:"],
        "style-src": ["'self'", "https:", "'unsafe-inline'"],
        "script-src-attr": ["'none'"],
        "object-src": ["'none'"],
        "upgrade-insecure-requests": []
      }
    }
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// sessions
const SESSION_NAME = "7gc.sid";
app.use(
  session({
    name: SESSION_NAME,
    secret: process.env.SESSION_SECRET || "change-me",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "none",
      secure: true,
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  })
);

// helpers
function normalizeAddress(a) {
  if (!a) return null;
  const s = String(a).trim();
  return s.length ? s : null;
}

async function materializeUserByAddress(address) {
  const addr = normalizeAddress(address);
  if (!addr) return null;

  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL UNIQUE,
      twitter_handle TEXT,
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      level_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await dbRun(`INSERT OR IGNORE INTO users (wallet) VALUES (?);`, addr);
  return await dbGet(`SELECT id, wallet, xp, level FROM users WHERE wallet = ?;`, addr);
}

function extractAddressFromReq(req) {
  if (req.session?.address) return req.session.address;
  const raw = req.cookies?.[SESSION_NAME];
  if (raw && typeof raw === "string" && raw.startsWith("w:")) return raw.slice(2);
  const h = req.get("x-wallet");
  if (h) return h;
  if (req.body?.address) return req.body.address;
  return null;
}

// body normalizer
app.use((req, _res, next) => {
  const b = req.body || {};
  if (b.wallet && !b.address) b.address = String(b.wallet).trim();
  next();
});

// session binder
app.use(async (req, _res, next) => {
  try {
    if (req.session?.userId) return next();
    const hint = extractAddressFromReq(req);
    if (!hint) return next();
    const user = await materializeUserByAddress(hint);
    if (user) {
      req.session.userId = user.id;
      req.session.address = user.wallet;
      req.userId = user.id;
      req.userAddress = user.wallet;
    }
  } catch (e) {
    console.error("[binder]", e);
  }
  next();
});

// health
app.get("/api/health", async (_req, res) => {
  try {
    await dbGet("SELECT 1;");
    res.json({ ok: true, db: "ok" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// wallet session bind
app.post("/api/auth/wallet/session", async (req, res) => {
  const address = normalizeAddress(req.body?.address);
  if (!address) return res.status(400).json({ ok: false, error: "address-required" });

  const user = await materializeUserByAddress(address);
  if (!user) return res.status(500).json({ ok: false, error: "user-create-failed" });

  req.session.userId = user.id;
  req.session.address = user.wallet;

  res.cookie(SESSION_NAME, `w:${user.wallet}`, {
    httpOnly: false,
    sameSite: "none",
    secure: true,
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });

  res.json({ ok: true, address: user.wallet, session: "set" });
});

// me
app.get("/api/me", (req, res) => {
  if (!req.session?.address) {
    const hint = extractAddressFromReq(req);
    if (!hint) return res.json({ ok: true, authed: false });
    return res.json({ ok: true, authed: true, wallet: hint });
  }
  res.json({ ok: true, authed: true, wallet: req.session.address });
});

// subscriptions helper
function boostForTier(tier) {
  return tier === "Gold" ? 2.0 : tier === "Explorer" ? 1.5 : 1.0;
}
async function getSubStatus(wallet) {
  if (!wallet) return { active: false, tier: "Free", xpBoost: 1.0 };
  const row = await dbGet(
    `SELECT tier, active FROM subscriptions WHERE wallet = ? AND active = 1 ORDER BY id DESC LIMIT 1`,
    wallet
  );
  if (!row) return { active: false, tier: "Free", xpBoost: 1.0 };
  return { active: !!row.active, tier: row.tier, xpBoost: boostForTier(row.tier) };
}

// subscriptions status
app.get("/api/subscriptions/status", async (req, res) => {
  const wallet = req.session?.address || extractAddressFromReq(req);
  const s = await getSubStatus(wallet);
  res.json({ ok: true, wallet, tier: s.tier, xpBoost: s.xpBoost });
});

// mount real routers
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/v1/leaderboard", leaderboardRouter);
app.use("/api/quests", questsRouter);
app.use("/api/v1/quests", questsRouter);
app.use("/api/referrals", referralsRouter);
app.use("/api/v1/referrals", referralsRouter);

// 404
app.use((req, res) => res.status(404).json({ ok: false, error: "not_found" }));

// error
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: "internal_error" });
});

// start
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`7GC backend listening on :${PORT}`);
  if (!process.env.TWITTER_BEARER_TOKEN) {
    console.log("TWITTER_BEARER_TOKEN missing");
  }
});
