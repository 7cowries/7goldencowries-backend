// server.js — 7 Golden Cowries (final, with leaderboard payload shim)
// Requires package.json { "type": "module" }
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import session from "express-session";

import db from "./lib/db.js";
import leaderboardRouter from "./routes/leaderboard.js";

const app = express();

// Trust proxy (Render/Vercel) so secure cookies work
app.set("trust proxy", 1);

// ─────────────────────────────────────────────────────────────────────────────
// Security / parsing / limits
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
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Session
const SESSION_NAME = "7gc.sid";
app.use(
  session({
    name: SESSION_NAME,
    secret: process.env.SESSION_SECRET || "change-me",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: "none", secure: true, maxAge: 1000 * 60 * 60 * 24 * 30 }
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
function normalizeAddress(a) {
  if (!a) return null;
  const s = String(a).trim();
  return s.length ? s : null;
}

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

// copy wallet → address if only wallet provided
app.use((req, _res, next) => {
  try {
    const b = req.body || {};
    if (b.wallet && !b.address) b.address = String(b.wallet).trim();
  } catch {}
  next();
});

function extractAddressFromReq(req) {
  if (req.session?.address) return req.session.address;
  const raw = req.cookies?.[SESSION_NAME];
  if (raw && typeof raw === "string" && raw.startsWith("w:")) return raw.slice(2);
  const h = req.get("x-wallet");
  if (h) return h;
  if (req.body?.address) return req.body.address;
  return null;
}

// attach user from hints if possible
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

// ─────────────────────────────────────────────────────────────────────────────
// Health
app.get("/api/health", async (_req, res) => {
  try {
    await db.get("SELECT 1");
    res.json({ ok: true, db: "ok" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Wallet session
app.post("/api/auth/wallet/session", async (req, res) => {
  const address = normalizeAddress(req.body?.address);
  if (!address) return res.status(400).json({ ok: false, error: "address-required" });

  const user = await materializeUserByAddress(address);
  if (!user) return res.status(500).json({ ok: false, error: "user-create-failed" });

  req.session.userId = user.id;
  req.session.address = user.wallet;

  // readable cookie for curl/dev flows
  res.cookie(SESSION_NAME, `w:${user.wallet}`, {
    httpOnly: false,
    sameSite: "none",
    secure: true,
    maxAge: 1000 * 60 * 60 * 24 * 30
  });

  res.json({ ok: true, address: user.wallet, session: "set" });
});

// Me
app.get("/api/me", (req, res) => {
  if (!req.session?.address) {
    const hint = extractAddressFromReq(req);
    if (!hint) return res.json({ ok: true, authed: false });
    return res.json({ ok: true, authed: true, wallet: hint });
  }
  res.json({ ok: true, authed: true, wallet: req.session.address });
});

// ─────────────────────────────────────────────────────────────────────────────
// Quests (seed so UI isn’t empty)
app.get("/api/quests", async (_req, res) => {
  const quests = [
    { id: "daily-checkin",  title: "Daily Check-in",      description: "Open the app today.",                             type: "daily",   xp: 10,  completed: false },
    { id: "follow-twitter", title: "Follow @7goldencowries", description: "Follow our X (Twitter) account to earn XP.",   type: "oneoff",  xp: 50,  completed: false, link: "https://x.com/7goldencowries" },
    { id: "invite-a-friend",title: "Invite a Friend",     description: "Share your referral link and have 1 friend join.", type: "referral",xp: 100, completed: false }
  ];
  res.json({ ok: true, quests });
});
app.post("/api/quests/claim", async (_req, res) => res.json({ ok: true, claimed: true }));
app.post("/api/quests/proof", async (_req, res) => res.json({ ok: true }));

// Subscriptions (safe defaults)
app.get("/api/subscriptions/status", async (req, res) => {
  const wallet = req.session?.address || extractAddressFromReq(req);
  res.json({ ok: true, wallet, tier: "Free", xpBoost: 1.0 });
});
app.post("/api/subscriptions/subscribe", async (_req, res) => res.json({ ok: true }));
app.post("/api/subscriptions/claim-bonus", async (_req, res) => res.json({ ok: true, bonus: 0 }));

// Referrals (harmless stub)
app.post("/api/referrals/claim", async (_req, res) => res.json({ ok: true, xpDelta: 0 }));

// ─────────────────────────────────────────────────────────────────────────────
// Leaderboard compatibility shim (adds `payload`, optional deep nesting)
app.use((req, res, next) => {
  const send = res.json.bind(res);
  res.json = (body) => {
    try {
      if (req.path.startsWith("/api/leaderboard") && req.query?.compat === "deep" && body && body.ok) {
        body = { ok: true, data: { results: body.results ?? body.rows ?? body.items ?? body.leaderboard ?? [] } };
      } else if (req.path.startsWith("/api/leaderboard") && body && body.ok) {
        const rows = body.results ?? body.rows ?? body.items ?? body.leaderboard ?? body.data ?? body.scores ?? [];
        body.payload = rows;               // for UIs expecting `payload`
        if (!body.data) body.data = rows;  // ensure `data` exists too
      }
    } catch {}
    return send(body);
  };
  next();
});

// Leaderboard routes (mount multiple paths for FE compatibility)
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/v1/leaderboard", leaderboardRouter);

// 404 + error handlers (always JSON)
app.use((req, res) => res.status(404).json({ ok: false, error: "not_found" }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: "internal_error" });
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`7GC backend listening on :${PORT}`));
