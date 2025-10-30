// server.js — 7 Golden Cowries
// ESM, works on Render, does its own SQLITE migrations, no stubs.

import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import session from "express-session";
import crypto from "node:crypto";

import dbp from "./db.js"; // <-- your repo exports ONLY the promise

// routers (all final)
import leaderboardRouter from "./routes/leaderboard.js";
import questsRouter from "./routes/quests.js";
import referralsRouter from "./routes/referrals.js";
// this file in your repo exports a *named* router, not default
import { router as twitterVerifyRouter } from "./routes/twitterVerify.js";

const app = express();

// ─────────────────────────────────────────────────────────────
// 0) open DB and do inline migrations (idempotent)
const db = await dbp;

/**
 * return array of column names for a table
 */
async function getTableCols(table) {
  const rows = await db.all(`PRAGMA table_info(${table});`);
  return rows.map((r) => r.name);
}

/**
 * Inline, render-safe migrations.
 * We DO NOT do "ADD COLUMN user_id INTEGER" twice.
 * We also normalize user_quests to the shape we want.
 */
async function ensureSchema() {
  // base users table
  await db.run(`
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

  // subscriptions
  await db.run(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'Free',
      active INTEGER NOT NULL DEFAULT 0,
      provider TEXT,
      tx_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_sub_wallet ON subscriptions(wallet);`);

  // ton invoices
  await db.run(`
    CREATE TABLE IF NOT EXISTS ton_invoices (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      tier TEXT NOT NULL,
      to_addr TEXT NOT NULL,
      amount BIGINT NOT NULL,
      comment TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      tx_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT
    );
  `);

  // quests (canonical table, with description; this killed earlier deploys)
  await db.run(`
    CREATE TABLE IF NOT EXISTS quests (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT,
      quest_type TEXT,
      xp INTEGER NOT NULL DEFAULT 0,
      link TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // user_quests may already exist from old runs, so patch it carefully
  await db.run(`
    CREATE TABLE IF NOT EXISTS user_quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT,
      quest_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      completed_at TEXT
    );
  `);

  // Now check its columns
  const uqCols = await getTableCols("user_quests");

  // add user_id if missing
  if (!uqCols.includes("user_id")) {
    // safe alter
    await db.run(`ALTER TABLE user_quests ADD COLUMN user_id INTEGER;`);
    console.log("[migrate] user_quests: added column user_id");
  }

  // add wallet if missing (some earlier runs had wallet already; this is safe)
  if (!uqCols.includes("wallet")) {
    await db.run(`ALTER TABLE user_quests ADD COLUMN wallet TEXT;`);
    console.log("[migrate] user_quests: added column wallet");
  }

  // add referral tables if not present
  await db.run(`
    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_wallet TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS referral_uses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      invited_wallet TEXT NOT NULL,
      rewarded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // seed canonical live quests (idempotent)
  const existing = await db.get(`SELECT COUNT(*) AS c FROM quests;`);
  if (!existing || !existing.c) {
    console.log("[migrate] seeding quests");
    const liveQuests = [
      {
        id: "daily-checkin",
        title: "Daily Check-in",
        description: "Open 7 Golden Cowries today.",
        category: "daily",
        quest_type: "daily",
        xp: 25,
        link: null,
      },
      {
        id: "follow-twitter",
        title: "Follow @7goldencowries",
        description: "Follow our X account to unlock social quests.",
        category: "social",
        quest_type: "twitter-follow",
        xp: 120,
        link: "https://x.com/7goldencowries",
      },
      {
        id: "retweet-pinned",
        title: "Retweet the pinned post",
        description: "Retweet our pinned campaign on X.",
        category: "social",
        quest_type: "twitter-retweet",
        xp: 150,
        link: "https://x.com/7goldencowries/status/1947595024117502145",
      },
      {
        id: "quote-tweet",
        title: "Quote tweet with your wallet",
        description: "Quote our pinned tweet and add your TON address.",
        category: "social",
        quest_type: "twitter-quote",
        xp: 180,
        link: "https://x.com/7goldencowries/status/1947595024117502145",
      },
      {
        id: "join-telegram",
        title: "Join the Cowrie Telegram",
        description: "Join the community chat.",
        category: "social",
        quest_type: "telegram-join",
        xp: 90,
        link: "https://t.me/7goldencowries", // adjust to real
      },
    ];

    for (const q of liveQuests) {
      await db.run(
        `INSERT OR IGNORE INTO quests (id, title, description, category, quest_type, xp, link)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        q.id,
        q.title,
        q.description,
        q.category,
        q.quest_type,
        q.xp,
        q.link
      );
    }
  }

  // ton service wallet check (not fatal)
  if (!process.env.TON_SERVICE_WALLET) {
    console.log("WARN: TON_SERVICE_WALLET not set — TON subscribe will return 500");
  }
}

await ensureSchema();
// ─────────────────────────────────────────────────────────────

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
        "upgrade-insecure-requests": [],
      },
    },
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

  await db.run(`
    INSERT OR IGNORE INTO users (wallet) VALUES (?);
  `, addr);

  return await db.get(
    `SELECT id, wallet, xp, level, level_name FROM users WHERE wallet = ?;`,
    addr
  );
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
    await db.get("SELECT 1;");
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

// subscription helpers
function boostForTier(tier) {
  return tier === "Gold" ? 2.0 : tier === "Explorer" ? 1.5 : 1.0;
}
async function getSubStatus(wallet) {
  if (!wallet) return { active: false, tier: "Free", xpBoost: 1.0 };
  const row = await db.get(
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

// ─────────────────────────────────────────────────────────────
// mount real routers
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/v1/leaderboard", leaderboardRouter);
app.use("/api/quests", questsRouter);
app.use("/api/v1/quests", questsRouter);
app.use("/api/referrals", referralsRouter);
app.use("/api/v1/referrals", referralsRouter);
app.use("/api/twitter", twitterVerifyRouter);

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
