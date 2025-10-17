// Fixed Express server for 7 Golden Cowries backend
// This server replaces the existing server.js used by Render. It exposes health,
// wallet-session auth, user profile, quests, subscriptions, token sale and
// leaderboard endpoints. It uses SQLite for persistence and cookie-based
// sessions. See README for env vars.

import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import session from "express-session";

import db from "./lib/db.js";
import leaderboardRouter from "./routes/leaderboard.js";

const app = express();
// Trust proxy is required when running behind Render/Vercel so secure cookies
// are correctly set when the original request is HTTPS.
app.set("trust proxy", 1);

// Basic security headers via helmet. Content Security Policy is relaxed to
// allow inline styles used by the frontend.
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "img-src": ["'self'", "data:"],
        "font-src": ["'self'", "https:", "data:"],
        "style-src": ["'self'", "https:", "'unsafe-inline'"] ,
        "script-src-attr": ["'none'"],
        "object-src": ["'none'"],
        "upgrade-insecure-requests": []
      }
    }
  })
);

// Parse JSON bodies and cookies, with a small body limit to avoid abuse.
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// Rate limiting: allow up to 200 requests per minute per IP.
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Name of the session cookie used to store wallet sessions.
const SESSION_NAME = "7gc.sid";

/**
 * Normalize a candidate wallet address into a trimmed string or null.
 * @param {string|undefined|null} a
 */
function normalizeAddress(a) {
  if (!a) return null;
  const s = String(a).trim();
  return s.length ? s : null;
}

/**
 * Materialize a user by wallet address. Creates the user row if it does not
 * already exist. Returns the user record.
 *
 * @param {string} address
 */
async function materializeUserByAddress(address) {
  const addr = normalizeAddress(address);
  if (!addr) return null;
  // Ensure the users table exists and insert the row if needed.
  await db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet TEXT NOT NULL UNIQUE,
    xp INTEGER NOT NULL DEFAULT 0
  )`);
  await db.run(`INSERT OR IGNORE INTO users (wallet) VALUES (?)`, addr);
  return await db.get(`SELECT id, wallet FROM users WHERE wallet = ?`, addr);
}

// Pre-process incoming JSON bodies: if a wallet field is provided but not an
// address field, copy it to address for convenience.
app.use((req, _res, next) => {
  try {
    const b = req.body || {};
    if (b.wallet && !b.address) b.address = String(b.wallet).trim();
  } catch {
    /* ignore */
  }
  next();
});

// Configure session middleware. Sessions are stored in memory; swap this
// implementation for a persistent store (e.g., connect-sqlite3) in production.
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
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    },
  })
);

/**
 * Extract a wallet address from the request. Checks the session, a cookie,
 * header (x-wallet) or the request body.
 *
 * @param {import('express').Request} req
 */
function extractAddressFromReq(req) {
  if (req.session?.address) return req.session.address;
  const raw = req.cookies?.[SESSION_NAME];
  if (raw && typeof raw === "string" && raw.startsWith("w:")) return raw.slice(2);
  const h = req.get("x-wallet");
  if (h) return h;
  if (req.body?.address) return req.body.address;
  return null;
}

// Populate req.userId and req.userAddress if a session or hint is available.
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

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health check: returns database status
app.get("/api/health", async (_req, res) => {
  try {
    await db.get("SELECT 1");
    return res.json({ ok: true, db: "ok" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Wallet session endpoint: bind a wallet address to a session and set a
// non-httpOnly cookie (for curl flows).
app.post("/api/auth/wallet/session", async (req, res) => {
  const address = normalizeAddress(req.body?.address);
  if (!address) return res.status(400).json({ ok: false, error: "address-required" });
  const user = await materializeUserByAddress(address);
  if (!user) return res.status(500).json({ ok: false, error: "user-create-failed" });
  req.session.userId = user.id;
  req.session.address = user.wallet;
  // Write a readable cookie with prefix w:
  res.cookie(SESSION_NAME, `w:${user.wallet}`, {
    httpOnly: false,
    sameSite: "none",
    secure: true,
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
  return res.json({ ok: true, address: user.wallet, session: "set" });
});

// Return the current user (if any) bound to the session or via hints.
app.get("/api/me", (req, res) => {
  if (!req.session?.address) {
    const hint = extractAddressFromReq(req);
    if (!hint) return res.json({ ok: true, authed: false });
    return res.json({ ok: true, authed: true, wallet: hint });
  }
  return res.json({ ok: true, authed: true, wallet: req.session.address });
});

// Quests endpoints. These are stubbed for now; replace with real logic
// when quests are ready.
app.get("/api/quests", async (_req, res) => res.json({ ok: true, quests: [] }));
app.post("/api/quests/claim", async (_req, res) => res.json({ ok: true, claimed: true }));
app.post("/api/quests/proof", async (_req, res) => res.json({ ok: true }));

// Subscription endpoints. These are minimal; integrate with subscriptionRoutes
// for full functionality.
app.get("/api/subscriptions/status", async (req, res) => {
  const wallet = req.session?.address || extractAddressFromReq(req);
  res.json({ ok: true, wallet, tier: "Free", xpBoost: 1.0 });
});
app.post("/api/subscriptions/subscribe", async (_req, res) => res.json({ ok: true }));
app.post("/api/subscriptions/claim-bonus", async (_req, res) => res.json({ ok: true, bonus: 0 }));

// Token sale endpoint (disabled until ready).
app.post("/api/token-sale/start", async (_req, res) => res.json({ ok: false, error: "not_enabled" }));

// Mount leaderboard router at /api/leaderboard
app.use("/api/leaderboard", leaderboardRouter);

// 404 for all other API requests
app.use((req, res) => res.status(404).json({ ok: false, error: "not_found" }));

// Error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: "internal_error" });
});

// Start the HTTP server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`7GC backend listening on :${PORT}`));
