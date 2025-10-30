// server.js — 7 Golden Cowries
// FINAL: render-safe, inline migrations, live quests, TON, referrals, twitter verify
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import session from "express-session";
import crypto from "node:crypto";

import dbp from "./db.js";                        // <- default export ONLY
import leaderboardRouter from "./routes/leaderboard.js";
import questsRouter from "./routes/quests.js";
import referralsRouter from "./routes/referrals.js";
import twitterVerifyRouter from "./routes/twitterVerify.js";

const app = express();
const db = await dbp;                             // real sqlite db

// ───────────────────────────────────────────────────────────────
// 1) very safe, idempotent, render-friendly migrations
//    NO risky backfill, NO datatype tricks
async function runMigrations() {
  // users
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
  await db.run(`CREATE INDEX IF NOT EXISTS idx_sub_wallet ON subscriptions (wallet);`);

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

  // quests master
  await db.run(`
    CREATE TABLE IF NOT EXISTS quests (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      category TEXT DEFAULT 'general',
      xp INTEGER NOT NULL DEFAULT 10,
      link TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `);

  // per-user quest completion (we will ALTER very carefully)
  await db.run(`
    CREATE TABLE IF NOT EXISTS user_quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quest_id TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT (datetime('now'))
      -- we will add wallet/user_id safely below
    );
  `);

  // now: add wallet / user_id ONLY IF MISSING
  const uqCols = await db.all(`PRAGMA table_info(user_quests);`);
  const hasWallet = uqCols.some((c) => c.name === "wallet");
  const hasUserId = uqCols.some((c) => c.name === "user_id");

  if (!hasWallet) {
    await db.run(`ALTER TABLE user_quests ADD COLUMN wallet TEXT;`);
    console.log("[migrate] user_quests: added column wallet");
  }
  if (!hasUserId) {
    await db.run(`ALTER TABLE user_quests ADD COLUMN user_id INTEGER;`);
    console.log("[migrate] user_quests: added column user_id");
  }

  // seed base quests ONLY if empty
  const qCountRow = await db.get(`SELECT COUNT(*) AS c FROM quests;`);
  if (!qCountRow || qCountRow.c === 0) {
    const baseQuests = [
      {
        id: "daily-checkin",
        title: "Daily Check-in",
        description: "Open 7 Golden Cowries today.",
        category: "daily",
        xp: 10,
        link: null,
        sort_order: 1,
      },
      {
        id: "follow-on-x",
        title: "Follow @7goldencowries on X",
        description: "Follow the official X account.",
        category: "social",
        xp: 50,
        link: "https://x.com/7goldencowries",
        sort_order: 2,
      },
      {
        id: "retweet-pinned",
        title: "Retweet the pinned post",
        description: "Retweet the pinned quest tweet.",
        category: "social",
        xp: 80,
        link: "https://x.com/7goldencowries/status/1947595024117502145",
        sort_order: 3,
      },
      {
        id: "quote-pinned",
        title: "Quote the pinned post",
        description: "Add your own words and quote it.",
        category: "social",
        xp: 90,
        link: "https://x.com/7goldencowries/status/1947595024117502145",
        sort_order: 4,
      },
      {
        id: "join-telegram",
        title: "Join the Telegram bot",
        description: "Connect to GigiP2Bot / GOLDENCOWRIEBOT.",
        category: "social",
        xp: 60,
        link: "https://t.me/GOLDENCOWRIEBOT",
        sort_order: 5,
      },
      {
        id: "invite-1-friend",
        title: "Invite 1 Friend",
        description: "Share your referral link and have 1 friend join.",
        category: "referral",
        xp: 100,
        link: null,
        sort_order: 6,
      },
    ];

    const insertStmt = await db.prepare(`
      INSERT OR IGNORE INTO quests (id, title, description, category, xp, link, sort_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1);
    `);

    for (const q of baseQuests) {
      await insertStmt.run(
        q.id,
        q.title,
        q.description,
        q.category,
        q.xp,
        q.link,
        q.sort_order
      );
    }
    await insertStmt.finalize();
    console.log("[migrate] seeded base quests");
  }
}
await runMigrations();
// ───────────────────────────────────────────────────────────────

// behind Render
app.set("trust proxy", 1);

// security + basics
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "img-src": ["'self'", "data:", "https:"],
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

// normalize body wallet → address
app.use((req, _res, next) => {
  const b = req.body || {};
  if (b.wallet && !b.address) b.address = String(b.wallet).trim();
  next();
});

// attach session user if possible
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

// ───────────────────────────────────────────────────────────────
// health
app.get("/api/health", async (_req, res) => {
  try {
    await db.get("SELECT 1;");
    res.json({ ok: true, db: "ok" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// bind wallet session
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

// subscription status route
app.get("/api/subscriptions/status", async (req, res) => {
  const wallet = req.session?.address || extractAddressFromReq(req);
  const s = await getSubStatus(wallet);
  res.json({ ok: true, wallet, tier: s.tier, xpBoost: s.xpBoost });
});

// ───────────────────────────────────────────────────────────────
// TON payments — same logic as before, just using this db
async function fetchIncomingTxFromTonApi(address, limit = 30) {
  const r = await fetch(
    `https://tonapi.io/v2/blockchain/accounts/${address}/transactions?limit=${limit}`,
    {
      headers: { Authorization: `Bearer ${process.env.TONAPI_KEY || ""}` },
    }
  );
  if (!r.ok) throw new Error(`TonAPI ${r.status}`);
  return r.json();
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
    /* ignore */
  }
  if (process.env.TONAPI_KEY) {
    try {
      return await fetchIncomingTxFromTonApi(address, limit);
    } catch (e) {
      /* ignore */
    }
  }
  throw new Error("no-indexer-available");
}

function priceForTier(tier) {
  const map = {
    Explorer: Number(process.env.TON_PRICE_EXPLORER || 0),
    Gold: Number(process.env.TON_PRICE_GOLD || 0),
  };
  return map[tier] || map.Explorer || 0;
}

app.post("/api/v1/payments/ton/checkout", async (req, res) => {
  const wallet =
    req.session?.address ||
    req.get("x-wallet") ||
    req.body?.address ||
    req.body?.wallet ||
    null;
  if (!wallet) return res.status(400).json({ ok: false, error: "wallet-required" });

  const tier = (req.body?.tier || "Explorer").trim();
  const amount = priceForTier(tier);
  if (!amount || amount <= 0) return res.status(400).json({ ok: false, error: "bad-tier" });

  const toAddr = process.env.TON_SERVICE_WALLET;
  if (!toAddr) return res.status(500).json({ ok: false, error: "service-wallet-missing" });

  const invoiceId = crypto.randomBytes(6).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  await db.run(
    `INSERT INTO ton_invoices (id, wallet, tier, to_addr, amount, comment, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?);`,
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

app.get("/api/v1/payments/ton/invoice/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const inv = await db.get(`SELECT * FROM ton_invoices WHERE id = ?;`, id);
    if (!inv) return res.status(404).json({ ok: false, error: "invoice-not-found" });

    if (inv.status === "confirmed") {
      const s = await getSubStatus(inv.wallet);
      return res.json({ ok: true, invoice: inv, subscription: s });
    }
    if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
      await db.run(
        `UPDATE ton_invoices SET status='expired', updated_at=datetime('now') WHERE id=?;`,
        id
      );
      return res.json({ ok: false, error: "expired" });
    }

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
      `UPDATE ton_invoices SET status='confirmed', tx_hash=?, updated_at=datetime('now') WHERE id=?;`,
      String(matched.tx_hash || ""),
      id
    );
    await db.run(
      `INSERT INTO subscriptions (wallet, tier, active, provider, tx_id, updated_at)
       VALUES (?, ?, 1, 'ton', ?, datetime('now'));`,
      inv.wallet,
      inv.tier,
      String(matched.tx_hash || "")
    );

    const s = await getSubStatus(inv.wallet);
    res.json({
      ok: true,
      invoice: { ...inv, status: "confirmed", tx_hash: matched.tx_hash },
      subscription: s,
    });
  } catch (e) {
    console.error("ton invoice verify error", e);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// unified payments status
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

// ───────────────────────────────────────────────────────────────
// actual routers (all LIVE, no stubs)
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/v1/leaderboard", leaderboardRouter);
app.use("/api/quests", questsRouter);             // uses DB, no DDL
app.use("/api/v1/quests", questsRouter);
app.use("/api/referrals", referralsRouter);
app.use("/api/v1/referrals", referralsRouter);
app.use("/api/twitter", twitterVerifyRouter);     // /api/twitter/verify-follow etc

// 404 + error
app.use((req, res) => res.status(404).json({ ok: false, error: "not_found" }));
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
