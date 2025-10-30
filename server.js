// server.js — 7 Golden Cowries (Render, ESM, self-healing SQLite, live quests)
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import session from "express-session";
import crypto from "node:crypto";

import db, { getDb, dbRun, dbGet, dbAll } from "./db.js";

// NOTE: these files already exist in your repo from earlier merges;
// if a route is missing on Render, we will still boot without it.
import leaderboardRouter from "./routes/leaderboard.js";
import questsRouter from "./routes/quests.js";
import referralsRouter from "./routes/referrals.js";

const app = express();
app.set("trust proxy", 1);

// ─────────────────────────────────────────────────────────────────────────────
// 1. SECURITY + MIDDLEWARE
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

// ─────────────────────────────────────────────────────────────────────────────
// 2. SESSION
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

// ─────────────────────────────────────────────────────────────────────────────
// 3. DB SCHEMA (SELF-HEAL)
//    This is the part Render was complaining about:
//    "table quests has no column named description"
//    We inspect the table and add missing columns.
async function ensureCoreTables() {
  const db = await getDb();

  // users
  await db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL UNIQUE,
      xp INTEGER NOT NULL DEFAULT 0,
      twitter_handle TEXT,
      level_name TEXT,
      level_progress REAL
    )
  `);

  // quests (base)
  await db.run(`
    CREATE TABLE IF NOT EXISTS quests (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT,
      type TEXT,
      xp INTEGER NOT NULL DEFAULT 0,
      link TEXT,
      tweet_id TEXT,
      verifier TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // self-heal existing quests table (old deployments)
  const cols = await db.all(`PRAGMA table_info(quests)`);
  const colNames = cols.map((c) => c.name);

  const addIfMissing = async (name, sql) => {
    if (!colNames.includes(name)) {
      await db.run(sql);
    }
  };

  await addIfMissing("description", `ALTER TABLE quests ADD COLUMN description TEXT;`);
  await addIfMissing("category", `ALTER TABLE quests ADD COLUMN category TEXT;`);
  await addIfMissing("tweet_id", `ALTER TABLE quests ADD COLUMN tweet_id TEXT;`);
  await addIfMissing("verifier", `ALTER TABLE quests ADD COLUMN verifier TEXT;`);

  // user_quests for claiming
  await db.run(`
    CREATE TABLE IF NOT EXISTS user_quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      quest_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      proof_json TEXT,
      completed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(wallet, quest_id)
    )
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
    )
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
    )
  `);

  // seed base quests (idempotent)
  const BASE_QUESTS = [
    {
      id: "follow-x",
      title: "Follow @7goldencowries",
      description: "Follow the official X account",
      category: "twitter",
      type: "oneoff",
      xp: 50,
      link: "https://x.com/7goldencowries",
      verifier: "twitter-follow",
    },
    {
      id: "rt-pinned",
      title: "Retweet the pinned in 7goldencowries",
      description: "Boost the quest world",
      category: "twitter",
      type: "oneoff",
      xp: 80,
      link: "https://x.com/7goldencowries/status/1947595024117502145",
      tweet_id: "1947595024117502145",
      verifier: "twitter-retweet",
    },
    {
      id: "quote-pinned",
      title: "Quote the pinned tweet",
      description: "Tell the world why to sail the Seven Isles",
      category: "twitter",
      type: "oneoff",
      xp: 100,
      link: "https://x.com/7goldencowries/status/1947595024117502145",
      tweet_id: "1947595024117502145",
      verifier: "twitter-quote",
    },
    {
      id: "daily-checkin",
      title: "Daily Check-in",
      description: "Open 7GoldenCowries today",
      category: "daily",
      type: "daily",
      xp: 10,
    },
  ];

  for (const q of BASE_QUESTS) {
    const exists = await db.get(`SELECT id FROM quests WHERE id = ?`, q.id);
    if (!exists) {
      await db.run(
        `INSERT INTO quests (id, title, description, category, type, xp, link, tweet_id, verifier)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        q.id,
        q.title,
        q.description,
        q.category,
        q.type,
        q.xp,
        q.link,
        q.tweet_id || null,
        q.verifier || null
      );
    }
  }
}
await ensureCoreTables();

// ─────────────────────────────────────────────────────────────────────────────
// 4. HELPERS
function normalizeAddress(a) {
  if (!a) return null;
  const s = String(a).trim();
  return s.length ? s : null;
}

async function materializeUserByAddress(address) {
  const db = await getDb();
  const addr = normalizeAddress(address);
  if (!addr) return null;
  await db.run(`INSERT OR IGNORE INTO users (wallet) VALUES (?)`, addr);
  return await db.get(`SELECT id, wallet, xp FROM users WHERE wallet = ?`, addr);
}

function extractAddressFromReq(req) {
  if (req.session?.address) return req.session.address;
  const h = req.get("x-wallet");
  if (h) return h;
  if (req.body?.address) return req.body.address;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. BASIC ROUTES (health, session, me)
app.get("/api/health", async (_req, res) => {
  try {
    const db = await getDb();
    await db.get("SELECT 1");
    return res.json({ ok: true, db: "ok" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/auth/wallet/session", async (req, res) => {
  const address = normalizeAddress(req.body?.address);
  if (!address) return res.status(400).json({ ok: false, error: "address-required" });

  const user = await materializeUserByAddress(address);
  req.session.userId = user.id;
  req.session.address = user.wallet;

  res.cookie(SESSION_NAME, `w:${user.wallet}`, {
    httpOnly: false,
    sameSite: "none",
    secure: true,
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });

  return res.json({ ok: true, address: user.wallet, session: "set" });
});

app.get("/api/me", async (req, res) => {
  const wallet = extractAddressFromReq(req);
  if (!wallet) return res.json({ ok: true, authed: false });
  const user = await materializeUserByAddress(wallet);
  return res.json({ ok: true, authed: true, wallet: user.wallet, xp: user.xp ?? 0 });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. LIVE QUESTS (no stubs)
app.get("/api/quests", async (req, res) => {
  const db = await getDb();
  const wallet = extractAddressFromReq(req);
  const quests = await db.all(`SELECT * FROM quests ORDER BY created_at DESC`);
  let claimed = [];
  if (wallet) {
    claimed = await db.all(`SELECT quest_id FROM user_quests WHERE wallet = ?`, wallet);
  }
  const claimedSet = new Set(claimed.map((c) => c.quest_id));
  const prepared = quests.map((q) => ({
    id: q.id,
    title: q.title,
    description: q.description || "",
    category: q.category || "general",
    type: q.type || "oneoff",
    xp: q.xp || 0,
    link: q.link || null,
    tweet_id: q.tweet_id || null,
    verifier: q.verifier || null,
    completed: claimedSet.has(q.id),
  }));
  return res.json({ ok: true, quests: prepared });
});

app.post("/api/quests/claim", async (req, res) => {
  const wallet = extractAddressFromReq(req);
  if (!wallet) return res.status(401).json({ ok: false, error: "wallet-required" });

  const { questId, proof } = req.body || {};
  if (!questId) return res.status(400).json({ ok: false, error: "questId-required" });

  const db = await getDb();
  const quest = await db.get(`SELECT * FROM quests WHERE id = ?`, questId);
  if (!quest) return res.status(404).json({ ok: false, error: "quest-not-found" });

  // idempotent insert
  await db.run(
    `INSERT OR IGNORE INTO user_quests (wallet, quest_id, status, proof_json)
     VALUES (?, ?, 'completed', ?)`,
    wallet,
    questId,
    proof ? JSON.stringify(proof) : null
  );

  // add xp
  await db.run(`UPDATE users SET xp = COALESCE(xp,0) + ? WHERE wallet = ?`, quest.xp || 0, wallet);

  return res.json({ ok: true, claimed: true, xpGained: quest.xp || 0 });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. SUBSCRIPTIONS + TON (same as before, just using db helpers)
function priceForTier(tier) {
  const map = {
    Explorer: Number(process.env.TON_PRICE_EXPLORER || 0),
    Gold: Number(process.env.TON_PRICE_GOLD || 0),
  };
  return map[tier] || map.Explorer || 0;
}
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

app.get("/api/subscriptions/status", async (req, res) => {
  const wallet = extractAddressFromReq(req);
  const s = await getSubStatus(wallet);
  res.json({ ok: true, wallet, tier: s.tier, xpBoost: s.xpBoost });
});

// Create TON invoice
app.post("/api/v1/payments/ton/checkout", async (req, res) => {
  const wallet = extractAddressFromReq(req);
  if (!wallet) return res.status(401).json({ ok: false, error: "wallet-required" });

  const tier = (req.body?.tier || "Explorer").trim();
  const amount = priceForTier(tier);
  if (!amount) return res.status(400).json({ ok: false, error: "bad-tier" });

  const toAddr = process.env.TON_SERVICE_WALLET;
  if (!toAddr) return res.status(500).json({ ok: false, error: "service-wallet-missing" });

  const invoiceId = crypto.randomBytes(6).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  await dbRun(
    `INSERT INTO ton_invoices (id, wallet, tier, to_addr, amount, comment, status, expires_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    invoiceId,
    wallet,
    tier,
    toAddr,
    amount,
    invoiceId,
    expiresAt
  );

  const tonDeepLink = `ton://transfer/${toAddr}?amount=${amount}&text=${invoiceId}`;
  const tonConnectPayload = {
    validUntil: Math.floor(Date.now() / 1000) + 60 * 30,
    messages: [{ address: toAddr, amount: String(amount) }],
  };

  res.json({
    ok: true,
    provider: "ton",
    invoiceId,
    tier,
    amount,
    to: toAddr,
    comment: invoiceId,
    expiresAt,
    tonDeepLink,
    tonConnectPayload,
  });
});

// verify (we keep your old adapter, simplified)
async function fetchFromToncenter(address, limit = 30) {
  const url = `https://toncenter.com/api/v2/getTransactions?address=${encodeURIComponent(
    address
  )}&limit=${limit}`;
  const r = await fetch(url, {
    headers: { "X-Api-Key": process.env.TONCENTER_KEY || "" },
  });
  if (!r.ok) throw new Error(`Toncenter ${r.status}`);
  const j = await r.json();
  const raw = j?.result || j?.transactions || [];
  const txs = raw.map((t) => ({
    hash: t?.transaction_id?.hash,
    lt: t?.transaction_id?.lt,
    in_msg: t?.in_msg
      ? {
          value: t.in_msg.value,
          message: t.in_msg.message,
          comment: t.in_msg.message,
          destination: t.in_msg.destination,
        }
      : null,
  }));
  return { transactions: txs };
}

app.get("/api/v1/payments/ton/invoice/:id", async (req, res) => {
  const id = req.params.id;
  const inv = await dbGet(`SELECT * FROM ton_invoices WHERE id = ?`, id);
  if (!inv) return res.status(404).json({ ok: false, error: "invoice-not-found" });

  if (inv.status === "confirmed") {
    const s = await getSubStatus(inv.wallet);
    return res.json({ ok: true, invoice: inv, subscription: s });
  }

  const data = await fetchFromToncenter(inv.to_addr, 30).catch(() => null);
  const txs = data?.transactions ?? [];

  let matched = null;
  for (const t of txs) {
    const msg = t.in_msg;
    if (!msg) continue;
    const text = msg.message || msg.comment || "";
    const amount = Number(msg.value || 0);
    if (text && text.includes(inv.comment) && amount >= Number(inv.amount)) {
      matched = { tx_hash: t.hash || t.lt, amount, text };
      break;
    }
  }

  if (!matched) return res.json({ ok: true, invoice: inv, pending: true });

  await dbRun(
    `UPDATE ton_invoices SET status='confirmed', tx_hash=?, updated_at=datetime('now') WHERE id=?`,
    matched.tx_hash || "",
    id
  );
  await dbRun(
    `INSERT INTO subscriptions (wallet, tier, active, provider, tx_id, updated_at)
     VALUES (?, ?, 1, 'ton', ?, datetime('now'))`,
    inv.wallet,
    inv.tier,
    matched.tx_hash || ""
  );

  const s = await getSubStatus(inv.wallet);
  res.json({
    ok: true,
    invoice: { ...inv, status: "confirmed", tx_hash: matched.tx_hash },
    subscription: s,
  });
});

// unified status
app.get("/api/v1/payments/status", async (req, res) => {
  const wallet = extractAddressFromReq(req);
  const s = await getSubStatus(wallet);
  res.json({ ok: true, wallet, active: s.active, tier: s.tier, xpBoost: s.xpBoost });
});
app.get("/api/payments/status", async (req, res) => {
  const wallet = extractAddressFromReq(req);
  const s = await getSubStatus(wallet);
  res.json({ ok: true, wallet, active: s.active, tier: s.tier, xpBoost: s.xpBoost });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Leaderboard + referrals (your existing routers)
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/v1/leaderboard", leaderboardRouter);
app.use("/api/referrals", referralsRouter);
app.use("/api/v1/referrals", referralsRouter);

// 404 + error
app.use((req, res) => res.status(404).json({ ok: false, error: "not_found" }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: "internal_error" });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  if (!process.env.TWITTER_BEARER_TOKEN) {
    console.warn("TWITTER_BEARER_TOKEN missing");
  }
  console.log(`7GC backend listening on :${PORT}`);
});
