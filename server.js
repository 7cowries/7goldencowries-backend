// server.js — 7 Golden Cowries (LIVE, ESM, no stubs, Render-safe)
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import session from "express-session";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import db from "./db.js";                         // <-- you have db.js in root
import leaderboardRouter from "./routes/leaderboard.js";
import questsRouter from "./routes/quests.js";    // <-- your real quests routes (not stub)
import referralsRouter from "./routes/referrals.js";
import twitterVerifyRouter from "./routes/twitterVerify.js"; // <-- you added this in your branch

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// behind Render / Vercel
app.set("trust proxy", 1);

// ────────────────────────────────────────────────────────────────
// Security, parsing, limits
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
    legacyHeaders: false
  })
);

// ────────────────────────────────────────────────────────────────
// Session (keep cookie name — frontend already uses it)
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
      maxAge: 1000 * 60 * 60 * 24 * 30
    }
  })
);

// ────────────────────────────────────────────────────────────────
// Helpers
function normalizeAddress(v) {
  if (!v) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

async function materializeUserByAddress(address) {
  const addr = normalizeAddress(address);
  if (!addr) return null;
  await db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet TEXT NOT NULL UNIQUE,
    xp INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    twitter_handle TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.run(`INSERT OR IGNORE INTO users (wallet) VALUES (?)`, addr);
  return await db.get(`SELECT id, wallet, xp, level, twitter_handle FROM users WHERE wallet = ?`, addr);
}

function extractAddressFromReq(req) {
  if (req.session?.address) return req.session.address;
  const raw = req.cookies?.[SESSION_NAME];
  if (raw && typeof raw === "string" && raw.startsWith("w:")) return raw.slice(2);
  const h = req.get("x-wallet");
  if (h) return h;
  if (req.body?.address) return req.body.address;
  if (req.body?.wallet) return req.body.wallet;
  return null;
}

// copy wallet → address if only wallet provided
app.use((req, _res, next) => {
  try {
    const b = req.body || {};
    if (b.wallet && !b.address) b.address = String(b.wallet).trim();
  } catch {}
  next();
});

// attach user from hints if possible
app.use(async (req, _res, next) => {
  try {
    if (req.session?.userId) {
      req.userId = req.session.userId;
      req.userAddress = req.session.address;
      return next();
    }
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

// ────────────────────────────────────────────────────────────────
// Billing tables (subscriptions + ton_invoices)
async function ensureBillingTables() {
  await db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'Free',
    active INTEGER NOT NULL DEFAULT 0,
    provider TEXT,
    tx_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_sub_wallet ON subscriptions(wallet)`);

  await db.run(`CREATE TABLE IF NOT EXISTS ton_invoices (
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
  )`);
}
await ensureBillingTables();

function priceForTier(tier) {
  const map = {
    Free: 0,
    Explorer: Number(process.env.TON_PRICE_EXPLORER || 0),
    Gold: Number(process.env.TON_PRICE_GOLD || 0),
    "Tier-1": Number(process.env.TON_PRICE_TIER1 || 0),
    "Tier-2": Number(process.env.TON_PRICE_TIER2 || 0),
    "Tier-3": Number(process.env.TON_PRICE_TIER3 || 0)
  };
  return map[tier] ?? map.Explorer ?? 0;
}
function boostForTier(tier) {
  if (tier === "Gold" || tier === "Tier-3") return 2.0;
  if (tier === "Explorer" || tier === "Tier-2") return 1.5;
  return 1.0;
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

// ────────────────────────────────────────────────────────────────
// Health
app.get("/api/health", async (_req, res) => {
  try {
    await db.get("SELECT 1");
    res.json({ ok: true, db: "ok" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Wallet session (used by frontend + curl)
app.post("/api/auth/wallet/session", async (req, res) => {
  const address = normalizeAddress(req.body?.address);
  if (!address) return res.status(400).json({ ok: false, error: "address-required" });
  const user = await materializeUserByAddress(address);
  if (!user) return res.status(500).json({ ok: false, error: "user-create-failed" });

  req.session.userId = user.id;
  req.session.address = user.wallet;

  // readable cookie for curl/dev
  res.cookie(SESSION_NAME, `w:${user.wallet}`, {
    httpOnly: false,
    sameSite: "none",
    secure: true,
    maxAge: 1000 * 60 * 60 * 24 * 30
  });

  res.json({ ok: true, address: user.wallet, session: "set" });
});

app.get("/api/me", (req, res) => {
  const hint = extractAddressFromReq(req);
  if (!hint) return res.json({ ok: true, authed: false });
  res.json({ ok: true, authed: true, wallet: hint });
});

// ────────────────────────────────────────────────────────────────
// TON helpers (fixed braces!)
async function fetchIncomingTxFromToncenter(address, limit = 30) {
  const url = `https://toncenter.com/api/v2/getTransactions?address=${encodeURIComponent(address)}&limit=${limit}`;
  const r = await fetch(url, {
    headers: { "X-Api-Key": process.env.TONCENTER_KEY || "" }
  });
  if (!r.ok) throw new Error(`Toncenter ${r.status}`);
  const j = await r.json();
  const raw = j?.result || j?.transactions || [];

  const transactions = raw.map((t) => ({
    hash: t?.transaction_id?.hash,
    lt: t?.transaction_id?.lt,
    in_msg: t?.in_msg
      ? {
          value: t.in_msg.value,
          message: t.in_msg.message,
          comment: t.in_msg.message,
          destination: t.in_msg.destination,
          source: t.in_msg.source
        }
      : null,
    out_msgs: Array.isArray(t?.out_msgs)
      ? t.out_msgs.map((m) => ({
          value: m.value,
          message: m.message,
          comment: m.message,
          destination: m.destination,
          source: m.source
        }))
      : []
  }));

  return { transactions };
}

async function fetchIncomingTxFromTonApi(address, limit = 30) {
  const r = await fetch(
    `https://tonapi.io/v2/blockchain/accounts/${address}/transactions?limit=${limit}`,
    process.env.TONAPI_KEY
      ? { headers: { Authorization: `Bearer ${process.env.TONAPI_KEY}` } }
      : undefined
  );
  if (!r.ok) throw new Error(`TonAPI ${r.status}`);
  return r.json();
}

// try toncenter, then tonapi
async function fetchIncomingTx(address, limit = 30) {
  try {
    return await fetchIncomingTxFromToncenter(address, limit);
  } catch (e) {
    // ignore
  }
  if (process.env.TONAPI_KEY) {
    try {
      return await fetchIncomingTxFromTonApi(address, limit);
    } catch (e) {
      // ignore
    }
  }
  throw new Error("no-indexer-available");
}

// ────────────────────────────────────────────────────────────────
// TON checkout (no stubs; creates real invoice rows)
app.post("/api/v1/payments/ton/checkout", async (req, res) => {
  const wallet = req.session?.address || extractAddressFromReq(req);
  if (!wallet) return res.status(401).json({ ok: false, error: "wallet-required" });

  const tier = (req.body?.tier || "Explorer").trim();
  const amount = priceForTier(tier);
  if (!amount) return res.status(400).json({ ok: false, error: "bad-tier" });

  const toAddr = process.env.TON_SERVICE_WALLET;
  if (!toAddr) return res.status(500).json({ ok: false, error: "service-wallet-missing" });

  const invoiceId = crypto.randomBytes(6).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  await db.run(
    `INSERT INTO ton_invoices (id, wallet, tier, to_addr, amount, comment, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
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
    messages: [{ address: toAddr, amount: String(amount), payload: "", text: invoiceId }]
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
    tonConnectPayload
  });
});

// Verify invoice by reading chain
app.get("/api/v1/payments/ton/invoice/:id", async (req, res) => {
  const id = req.params.id;
  const inv = await db.get(`SELECT * FROM ton_invoices WHERE id = ?`, id);
  if (!inv) return res.status(404).json({ ok: false, error: "invoice-not-found" });

  // already confirmed?
  if (inv.status === "confirmed") {
    const s = await getSubStatus(inv.wallet);
    return res.json({ ok: true, invoice: inv, subscription: s });
  }

  // expired?
  if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
    await db.run(`UPDATE ton_invoices SET status='expired', updated_at=datetime('now') WHERE id=?`, id);
    return res.json({ ok: false, error: "expired" });
  }

  // poll
  const data = await fetchIncomingTx(inv.to_addr, 30);
  const txs = data?.transactions ?? data ?? [];

  let matched = null;
  for (const t of txs) {
    const msg = t.in_msg || (t.out_msgs ? t.out_msgs.find((m) => m.destination === inv.to_addr) : null);
    if (!msg) continue;

    const text = msg?.message || msg?.comment || "";
    const amount = Number(msg?.value || 0);
    if (text && text.includes(inv.comment) && amount >= Number(inv.amount)) {
      matched = { tx_hash: t.hash || t.transaction_id?.hash || t.lt, amount, text };
      break;
    }
  }

  if (!matched) return res.json({ ok: true, invoice: inv, pending: true });

  await db.run(
    `UPDATE ton_invoices SET status='confirmed', tx_hash=?, updated_at=datetime('now') WHERE id=?`,
    String(matched.tx_hash || ""),
    id
  );
  await db.run(
    `INSERT INTO subscriptions (wallet, tier, active, provider, tx_id, updated_at)
     VALUES (?, ?, 1, 'ton', ?, datetime('now'))`,
    inv.wallet,
    inv.tier,
    String(matched.tx_hash || "")
  );

  const s = await getSubStatus(inv.wallet);
  res.json({
    ok: true,
    invoice: { ...inv, status: "confirmed", tx_hash: matched.tx_hash },
    subscription: s
  });
});

// unified payment status
app.get("/api/v1/payments/status", async (req, res) => {
  const wallet = req.session?.address || extractAddressFromReq(req);
  const s = await getSubStatus(wallet);
  res.json({ ok: true, wallet, active: s.active, provider: s.active ? "ton" : null, tier: s.tier, xpBoost: s.xpBoost });
});
app.get("/api/payments/status", async (req, res) => {
  const wallet = req.session?.address || extractAddressFromReq(req);
  const s = await getSubStatus(wallet);
  res.json({ ok: true, wallet, active: s.active, provider: s.active ? "ton" : null, tier: s.tier, xpBoost: s.xpBoost });
});

// ────────────────────────────────────────────────────────────────
// Leaderboard JSON shape shim
app.use((req, res, next) => {
  const send = res.json.bind(res);
  res.json = (body) => {
    try {
      if (req.path.startsWith("/api/leaderboard") && body && body.ok) {
        const rows = body.results ?? body.rows ?? body.items ?? body.leaderboard ?? body.data ?? body.scores ?? [];
        body.payload = rows;
        if (!body.data) body.data = rows;
      }
    } catch {}
    return send(body);
  };
  next();
});

// ────────────────────────────────────────────────────────────────
// ROUTES — all LIVE (no in-file stubs)
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/v1/leaderboard", leaderboardRouter);

app.use("/api/quests", questsRouter);
app.use("/api/v1/quests", questsRouter);

app.use("/api/referrals", referralsRouter);
app.use("/api/v1/referrals", referralsRouter);

app.use("/api/twitter/verify", twitterVerifyRouter);

// 404 + error
app.use((req, res) => res.status(404).json({ ok: false, error: "not_found" }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: "internal_error" });
});

// ────────────────────────────────────────────────────────────────
// start
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`7GC backend listening on :${PORT}`);
});
