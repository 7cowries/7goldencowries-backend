import corsMW from './api/cors.js';
import apiStubs from './api/stubs.js';
// server.js — 7GC backend (Express + SQLite), fixed mounts & JSON endpoints
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import session from "express-session";

import db from "./lib/db.js";                    // async sqlite wrapper used already in the repo
import leaderboardRouter from "./routes/leaderboard.js";

// Optional: these routes can remain no-ops for now
// import referralRoutes from "./routes/referralRoutes.js";
// import saleRoutes from "./routes/saleRoutes.js";

const app = express();
app.set("trust proxy", 1);

app.use(helmet({
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
}));

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false }));

const SESSION_NAME = "7gc.sid";

// Normalize helpers
function normalizeAddress(a) { if (!a) return null; const s = String(a).trim(); return s.length ? s : null; }

// Materialize user on demand
async function materializeUserByAddress(address) {
  const addr = normalizeAddress(address);
  if (!addr) return null;
  await db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet TEXT NOT NULL UNIQUE,
    xp INTEGER NOT NULL DEFAULT 0
  )`);
  await db.run(`INSERT OR IGNORE INTO users (wallet) VALUES (?)`, addr);
  return await db.get(`SELECT id, wallet FROM users WHERE wallet = ?`, addr);
}

// Accept {wallet} or {address} bodies
app.use((req, _res, next) => {
  try { const b = req.body || {}; if (b.wallet && !b.address) b.address = String(b.wallet).trim(); } catch {}
  next();
});

// Session
app.use(session({
  name: SESSION_NAME,
  secret: process.env.SESSION_SECRET || "change-me",
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
}));

// Binder: auto-hydrate session from cookie/header/body
function extractAddressFromReq(req) {
  if (req.session?.address) return req.session.address;
  const raw = req.cookies?.[SESSION_NAME];
  if (raw && typeof raw === "string" && raw.startsWith("w:")) return raw.slice(2);
  const h = req.get("x-wallet"); if (h) return h;
  if (req.body?.address) return req.body.address;
  return null;
}

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
  } catch (e) { console.error("[binder]", e); }
  next();
});

// --- Health ---------------------------------------------------------------
app.get("/api/health", async (_req, res) => {
  try { await db.get("SELECT 1"); return res.json({ ok: true, db: "ok" }); }
  catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

// --- Auth: wallet session -------------------------------------------------
app.post("/api/auth/wallet/session", async (req, res) => {
  const address = normalizeAddress(req.body?.address);
  if (!address) return res.status(400).json({ ok: false, error: "address-required" });

  const user = await materializeUserByAddress(address);
  if (!user) return res.status(500).json({ ok: false, error: "user-create-failed" });

  req.session.userId = user.id;
  req.session.address = user.wallet;

  // legacy readable cookie for curl flows (non-httpOnly by design here)
  res.cookie(SESSION_NAME, `w:${user.wallet}`, {
    httpOnly: false, sameSite: "none", secure: true, maxAge: 1000 * 60 * 60 * 24 * 30
  });

  return res.json({ ok: true, address: user.wallet, session: "set" });
});

// --- Me -------------------------------------------------------------------
app.get("/api/me", (req, res) => {
  if (!req.session?.address) {
    const hint = extractAddressFromReq(req);
    if (!hint) return res.json({ ok: true, authed: false });
    return res.json({ ok: true, authed: true, wallet: hint });
  }
  return res.json({ ok: true, authed: true, wallet: req.session.address });
});

// --- Minimal stubs so pages never crash ----------------------------------
// Quests
app.get("/api/quests", async (_req, res) => res.json({ ok: true, quests: [] }));
app.post("/api/quests/claim", async (_req, res) => res.json({ ok: true, claimed: true }));
app.post("/api/quests/proof", async (_req, res) => res.json({ ok: true }));

// Subscriptions
app.get("/api/subscriptions/status", async (req, res) => {
  const wallet = req.session?.address || extractAddressFromReq(req);
  res.json({ ok: true, wallet, tier: "Free", xpBoost: 1.0 });
});
app.post("/api/subscriptions/subscribe", async (_req, res) => res.json({ ok: true }));
app.post("/api/subscriptions/claim-bonus", async (_req, res) => res.json({ ok: true, bonus: 0 }));

// Token sale
app.post("/api/token-sale/start", async (_req, res) => res.json({ ok: false, error: "not_enabled" }));

// --- Leaderboard (real route) ---------------------------------------------
app.use("/api/leaderboard", leaderboardRouter);

// --- 404 / error ----------------------------------------------------------
app.use((req, res) => res.status(404).json({ ok: false, error: "not_found" }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: "internal_error" });
});

// --- listen ---------------------------------------------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`7GC backend listening on :${PORT}`));

// ---- 7GC stub API mount ----
try {
  const expressJson = (await import('express')).json;
  if (typeof expressJson === 'function') app.use(expressJson());
  app.use(corsMW);
  app.use('/api', apiStubs);
  console.log('7GC stub API mounted');
} catch (e) { console.error('7GC stub mount error', e); }
// ---- end 7GC stub API mount ----
