// server.js — 7 Golden Cowries
// ESM, Render-safe, with inline migrations, live quests, twitter verify, TON, referrals
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import session from "express-session";
import crypto from "node:crypto";
import connectSqlite3 from "connect-sqlite3";

import dbp from "./db.js"; // <- your db.js only exports default (a promise)
import leaderboardRouter from "./routes/leaderboard.js";
import questsRouter from "./routes/quests.js";
import referralsRouter from "./routes/referrals.js";
import twitterVerifyRouter from "./routes/twitterVerify.js"; // must be `export default router` in this file

const app = express();

// ──────────────────────────────────────────────
// 0. get real db
const db = await dbp;

// small helpers that DON'T rely on named exports from db.js
async function dbGet(sql, params = []) {
  return db.get(sql, params);
}
async function dbRun(sql, params = []) {
  return db.run(sql, params);
}
async function dbAll(sql, params = []) {
  return db.all(sql, params);
}

// ──────────────────────────────────────────────
// 1. inline migrations (idempotent, render-safe)
async function columnExists(table, column) {
  const rows = await dbAll(`PRAGMA table_info(${table});`);
  return rows.some((r) => r.name === column);
}

async function ensureUsersTable() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // add columns one by one — NO datatype mismatch
  if (!(await columnExists("users", "twitter_handle"))) {
    await dbRun(`ALTER TABLE users ADD COLUMN twitter_handle TEXT;`);
  }
  if (!(await columnExists("users", "xp"))) {
    await dbRun(`ALTER TABLE users ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;`);
  }
  if (!(await columnExists("users", "level"))) {
    await dbRun(`ALTER TABLE users ADD COLUMN level INTEGER NOT NULL DEFAULT 1;`);
  }
  if (!(await columnExists("users", "level_name"))) {
    await dbRun(`ALTER TABLE users ADD COLUMN level_name TEXT DEFAULT 'Shellborn';`);
  }
  if (!(await columnExists("users", "level_progress"))) {
    await dbRun(`ALTER TABLE users ADD COLUMN level_progress REAL NOT NULL DEFAULT 0;`);
  }
}

async function ensureUserQuestsTable() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS user_quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  if (!(await columnExists("user_quests", "user_id"))) {
    await dbRun(`ALTER TABLE user_quests ADD COLUMN user_id INTEGER;`);
  }
  if (!(await columnExists("user_quests", "wallet"))) {
    await dbRun(`ALTER TABLE user_quests ADD COLUMN wallet TEXT;`);
  }
  if (!(await columnExists("user_quests", "quest_id"))) {
    await dbRun(`ALTER TABLE user_quests ADD COLUMN quest_id TEXT;`);
  }
  if (!(await columnExists("user_quests", "status"))) {
    await dbRun(`ALTER TABLE user_quests ADD COLUMN status TEXT DEFAULT 'claimed';`);
  }
  if (!(await columnExists("user_quests", "proof"))) {
    await dbRun(`ALTER TABLE user_quests ADD COLUMN proof TEXT;`);
  }

  // index + uniqueness for wallet + quest
  await dbRun(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_user_quests_wallet_quest ON user_quests(wallet, quest_id);`
  );
  await dbRun(
    `CREATE INDEX IF NOT EXISTS idx_user_quests_user_id ON user_quests(user_id);`
  );
}

async function ensureSubscriptions() {
  await dbRun(`
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
  await dbRun(
    `CREATE INDEX IF NOT EXISTS idx_subscriptions_wallet ON subscriptions(wallet);`
  );
}

async function ensureTonInvoices() {
  await dbRun(`
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
}

async function ensureAllSchema() {
  await ensureUsersTable();
  await ensureUserQuestsTable();
  await ensureSubscriptions();
  await ensureTonInvoices();
  // you also have leaderboard / quests own migrations in their own files — but this keeps core tables alive
}
await ensureAllSchema();

// ──────────────────────────────────────────────
// 2. express basics
app.set("trust proxy", 1);

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

// ──────────────────────────────────────────────
// 3. session (SQLite store so Render stops warning)
const SQLiteStore = connectSqlite3(session);
const SESSION_NAME = "7gc.sid";

app.use(
  session({
    name: SESSION_NAME,
    secret: process.env.SESSION_SECRET || "change-me",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: new SQLiteStore({
      db: "sessions.sqlite",
      dir: "./var",
    }),
    cookie: {
      httpOnly: true,
      sameSite: "none",
      secure: true,
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  })
);

// ──────────────────────────────────────────────
// 4. helpers
function normalizeAddress(a) {
  if (!a) return null;
  const s = String(a).trim();
  return s.length ? s : null;
}

async function materializeUserByAddress(address) {
  const addr = normalizeAddress(address);
  if (!addr) return null;

  // users table is guaranteed by ensureAllSchema()
  await dbRun(`INSERT OR IGNORE INTO users (wallet) VALUES (?);`, [addr]);

  return dbGet(
    `SELECT id, wallet, xp, level, level_name, level_progress FROM users WHERE wallet = ?;`,
    [addr]
  );
}

function extractAddressFromReq(req) {
  if (req.session?.address) return req.session.address;
  const raw = req.cookies?.[SESSION_NAME];
  if (raw && typeof raw === "string" && raw.startsWith("w:")) return raw.slice(2);
  const hdr = req.get("x-wallet");
  if (hdr) return hdr;
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

// ──────────────────────────────────────────────
// 5. health
app.get("/api/health", async (_req, res) => {
  try {
    await dbGet("SELECT 1;");
    res.json({ ok: true, db: "ok" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ──────────────────────────────────────────────
// 6. wallet session
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

// ──────────────────────────────────────────────
// 7. subscriptions helpers
function boostForTier(tier) {
  return tier === "Gold" ? 2.0 : tier === "Explorer" ? 1.5 : 1.0;
}
async function getSubStatus(wallet) {
  if (!wallet) return { active: false, tier: "Free", xpBoost: 1.0 };
  const row = await dbGet(
    `SELECT tier, active FROM subscriptions WHERE wallet = ? AND active = 1 ORDER BY id DESC LIMIT 1;`,
    [wallet]
  );
  if (!row) return { active: false, tier: "Free", xpBoost: 1.0 };
  return { active: !!row.active, tier: row.tier, xpBoost: boostForTier(row.tier) };
}

app.get("/api/subscriptions/status", async (req, res) => {
  const wallet = req.session?.address || extractAddressFromReq(req);
  const s = await getSubStatus(wallet);
  res.json({ ok: true, wallet, tier: s.tier, xpBoost: s.xpBoost });
});

// ──────────────────────────────────────────────
// 8. TON checkout + verify (same as earlier but uses our helpers)
function priceForTier(tier) {
  const map = {
    Explorer: Number(process.env.TON_PRICE_EXPLORER || 0),
    Gold: Number(process.env.TON_PRICE_GOLD || 0),
  };
  return map[tier] || map.Explorer || 0;
}

async function fetchIncomingTxFromToncenter(address, limit = 30) {
  const url = `https://toncenter.com/api/v2/getTransactions?address=${encodeURIComponent(
    address
  )}&limit=${limit}`;
  const r = await fetch(url, {
    headers: { "X-Api-Key": process.env.TONCENTER_KEY || "" },
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
          source: t.in_msg.source,
        }
      : null,
    out_msgs: Array.isArray(t?.out_msgs)
      ? t.out_msgs.map((m) => ({
          value: m.value,
          message: m.message,
          comment: m.message,
          destination: m.destination,
          source: m.source,
        }))
      : [],
  }));

  return { transactions };
}

async function fetchIncomingTx(address, limit = 30) {
  try {
    return await fetchIncomingTxFromToncenter(address, limit);
  } catch (e) {
    if (process.env.TONAPI_KEY) {
      const r = await fetch(
        `https://tonapi.io/v2/blockchain/accounts/${address}/transactions?limit=${limit}`,
        {
          headers: { Authorization: `Bearer ${process.env.TONAPI_KEY}` },
        }
      );
      if (!r.ok) throw new Error(`TonAPI ${r.status}`);
      return await r.json();
    }
    throw e;
  }
}

app.post("/api/v1/payments/ton/checkout", async (req, res) => {
  const wallet =
    req.session?.address ||
    normalizeAddress(req.body?.address) ||
    normalizeAddress(req.body?.wallet);
  if (!wallet) return res.status(400).json({ ok: false, error: "wallet-required" });

  const tier = (req.body?.tier || "Explorer").trim();
  const amount = priceForTier(tier);
  if (!amount || amount <= 0) return res.status(400).json({ ok: false, error: "bad-tier" });

  const toAddr = process.env.TON_SERVICE_WALLET;
  if (!toAddr) return res.status(500).json({ ok: false, error: "service-wallet-missing" });

  const invoiceId = crypto.randomBytes(6).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  await dbRun(
    `INSERT INTO ton_invoices (id, wallet, tier, to_addr, amount, comment, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?);`,
    [invoiceId, wallet, tier, toAddr, amount, invoiceId, expiresAt]
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

app.get("/api/v1/payments/ton/invoice/:id", async (req, res) => {
  const id = req.params.id;
  const inv = await dbGet(`SELECT * FROM ton_invoices WHERE id = ?;`, [id]);
  if (!inv) return res.status(404).json({ ok: false, error: "invoice-not-found" });

  if (inv.status === "confirmed") {
    const s = await getSubStatus(inv.wallet);
    return res.json({ ok: true, invoice: inv, subscription: s });
  }

  if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
    await dbRun(
      `UPDATE ton_invoices SET status='expired', updated_at=datetime('now') WHERE id=?;`,
      [id]
    );
    return res.json({ ok: false, error: "expired" });
  }

  const data = await fetchIncomingTx(inv.to_addr, 30);
  const txs = data?.transactions ?? data ?? [];

  let matched = null;
  for (const t of txs) {
    const msg = t.in_msg || (t.out_msgs ? t.out_msgs.find((m) => m.destination === inv.to_addr) : null);
    if (!msg) continue;
    const text = msg.message || msg.comment || "";
    const amount = Number(msg.value || 0);
    if (text && text.includes(inv.comment) && amount >= Number(inv.amount)) {
      matched = {
        tx_hash: t.hash || t.transaction_id?.hash || t.lt,
        amount,
        text,
      };
      break;
    }
  }

  if (!matched) return res.json({ ok: true, invoice: inv, pending: true });

  await dbRun(
    `UPDATE ton_invoices SET status='confirmed', tx_hash=?, updated_at=datetime('now') WHERE id=?;`,
    [String(matched.tx_hash || ""), id]
  );
  await dbRun(
    `INSERT INTO subscriptions (wallet, tier, active, provider, tx_id, updated_at)
     VALUES (?, ?, 1, 'ton', ?, datetime('now'));`,
    [inv.wallet, inv.tier, String(matched.tx_hash || "")]
  );

  const s = await getSubStatus(inv.wallet);
  res.json({
    ok: true,
    invoice: { ...inv, status: "confirmed", tx_hash: matched.tx_hash },
    subscription: s,
  });
});

// alias
app.get("/api/v1/payments/status", async (req, res) => {
  const wallet = req.session?.address || req.get("x-wallet") || null;
  const s = await getSubStatus(wallet);
  res.json({
    ok: true,
    wallet,
    active: s.active,
    provider: s.active ? "ton" : null,
    tier: s.tier,
    xpBoost: s.xpBoost,
  });
});
app.get("/api/payments/status", async (req, res) => {
  const wallet = req.session?.address || req.get("x-wallet") || null;
  const s = await getSubStatus(wallet);
  res.json({
    ok: true,
    wallet,
    active: s.active,
    provider: s.active ? "ton" : null,
    tier: s.tier,
    xpBoost: s.xpBoost,
  });
});

// ──────────────────────────────────────────────
// 9. mount real routers (ALL LIVE, NO STUBS)
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/v1/leaderboard", leaderboardRouter);
app.use("/api/quests", questsRouter);
app.use("/api/v1/quests", questsRouter);
app.use("/api/referrals", referralsRouter);
app.use("/api/v1/referrals", referralsRouter);
app.use("/api/twitter", twitterVerifyRouter); // <- /api/twitter/verify/* whatever you put inside the route

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
