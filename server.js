// server.js — 7 Golden Cowries (ESM, Render-safe; live quests + Twitter v2 verify; TON; referrals; subscriptions)
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import session from "express-session";
import crypto from "node:crypto";

// IMPORTANT: we only use the DEFAULT export from db.js and then wrap .get/.run/.all ourselves.
// This avoids the "does not provide an export named 'all/run/get'" errors.
import dbp from "./db.js";

// Optional routers (kept if present); if they’re missing we won’t crash.
let leaderboardRouter = null;
try { ({ default: leaderboardRouter } = await import("./routes/leaderboard.js")); } catch (_) {}

const app = express();
app.set("trust proxy", 1);

// ─────────────────────────────────────────────────────────────────────────────
// Security & basics
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
app.use(rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false }));

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers (resolved once)
const db = await dbp;
const dbGet = (...a) => db.get(...a);
const dbAll = (...a) => db.all(...a);
const dbRun = (...a) => db.run(...a);

// Helpers to add column if missing
async function ensureColumn(table, name, defSql) {
  const cols = await dbAll(`PRAGMA table_info(${table});`);
  const has = cols.some(c => c.name === name);
  if (!has) {
    await dbRun(`ALTER TABLE ${table} ADD COLUMN ${defSql};`);
  }
}
async function ensureIndex(name, sql) {
  await dbRun(`CREATE INDEX IF NOT EXISTS ${name} ${sql};`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Boot migrations (idempotent; handles your “no column named description/quest_id” crashes)
async function migrateOnBoot() {
  // Users
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

  // Subscriptions
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
  await ensureIndex("idx_sub_wallet", "ON subscriptions(wallet)");

  // TON invoices
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

  // Quests (make sure description/link exist)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS quests (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      link TEXT
    );
  `);
  await ensureColumn("quests", "description", "description TEXT");
  await ensureColumn("quests", "link", "link TEXT");

  // User quest progress
  await dbRun(`
    CREATE TABLE IF NOT EXISTS user_quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      quest_slug TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      claimed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, quest_slug)
    );
  `);
  await ensureIndex("idx_uq_user", "ON user_quests(user_id)");
  await ensureIndex("idx_uq_quest", "ON user_quests(quest_slug)");

  // Referrals
  await dbRun(`
    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inviter_wallet TEXT NOT NULL,
      invitee_wallet TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(invitee_wallet)
    );
  `);

  // Seed canonical quests (upsert)
  const seed = [
    {
      slug: "daily-checkin",
      title: "Daily Check-in",
      description: "Open the app today.",
      type: "daily",
      xp: 10,
      link: null
    },
    {
      slug: "follow-twitter",
      title: "Follow @7goldencowries",
      description: "Follow our X account to earn XP.",
      type: "social_follow",
      xp: 50,
      link: "https://x.com/7goldencowries"
    },
    {
      slug: "retweet-pinned",
      title: "Retweet our pinned tweet",
      description: "Retweet the pinned tweet on @7goldencowries.",
      type: "social_retweet",
      xp: 80,
      link: "https://x.com/7goldencowries"
    },
    {
      slug: "quote-pinned",
      title: "Quote our pinned tweet",
      description: "Quote-tweet the pinned tweet with a comment.",
      type: "social_quote",
      xp: 120,
      link: "https://x.com/7goldencowries"
    },
    {
      slug: "invite-a-friend",
      title: "Invite a Friend",
      description: "Share your referral link; 1 friend joins.",
      type: "referral",
      xp: 100,
      link: null
    }
  ];
  for (const q of seed) {
    await dbRun(
      `INSERT INTO quests (slug, title, description, type, xp, link)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
         title=excluded.title,
         description=excluded.description,
         type=excluded.type,
         xp=excluded.xp,
         link=excluded.link;`,
      q.slug, q.title, q.description, q.type, q.xp, q.link
    );
  }
}
await migrateOnBoot();

// ─────────────────────────────────────────────────────────────────────────────
// Sessions
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

// Normalizers
function normalizeAddress(a) {
  if (!a) return null;
  const s = String(a).trim();
  return s.length ? s : null;
}
async function materializeUserByAddress(address) {
  const addr = normalizeAddress(address);
  if (!addr) return null;
  await dbRun(`INSERT OR IGNORE INTO users (wallet) VALUES (?);`, addr);
  return dbGet(`SELECT id, wallet, xp, level FROM users WHERE wallet = ?;`, addr);
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
app.use((req, _res, next) => {
  try { const b = req.body || {}; if (b.wallet && !b.address) b.address = String(b.wallet).trim(); } catch {}
  next();
});
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

// ─────────────────────────────────────────────────────────────────────────────
// Health
app.get("/api/health", async (_req, res) => {
  try { await dbGet("SELECT 1;"); res.json({ ok: true, db: "ok" }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Wallet session bind
app.post("/api/auth/wallet/session", async (req, res) => {
  const address = normalizeAddress(req.body?.address);
  if (!address) return res.status(400).json({ ok: false, error: "address-required" });
  const user = await materializeUserByAddress(address);
  if (!user) return res.status(500).json({ ok: false, error: "user-create-failed" });
  req.session.userId = user.id;
  req.session.address = user.wallet;
  res.cookie(SESSION_NAME, `w:${user.wallet}`, { httpOnly: false, sameSite: "none", secure: true, maxAge: 1000 * 60 * 60 * 24 * 30 });
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
// Subscriptions helpers
function boostForTier(tier) { return tier === "Gold" ? 2.0 : tier === "Explorer" ? 1.5 : 1.0; }
function priceForTier(tier) {
  const map = { Explorer: Number(process.env.TON_PRICE_EXPLORER || 0), Gold: Number(process.env.TON_PRICE_GOLD || 0) };
  return map[tier] || map.Explorer || 0;
}
async function getSubStatus(wallet) {
  if (!wallet) return { active: false, tier: "Free", xpBoost: 1.0 };
  const row = await dbGet(`SELECT tier, active FROM subscriptions WHERE wallet = ? AND active = 1 ORDER BY id DESC LIMIT 1;`, wallet);
  if (!row) return { active: false, tier: "Free", xpBoost: 1.0 };
  return { active: !!row.active, tier: row.tier, xpBoost: boostForTier(row.tier) };
}
app.get("/api/subscriptions/status", async (req, res) => {
  const wallet = req.session?.address || extractAddressFromReq(req);
  const s = await getSubStatus(wallet);
  res.json({ ok: true, wallet, tier: s.tier, xpBoost: s.xpBoost });
});

// ─────────────────────────────────────────────────────────────────────────────
// Quests (live; seeded in migrateOnBoot)
async function userQuestsMap(userId) {
  const rows = await dbAll(`SELECT quest_slug, completed FROM user_quests WHERE user_id = ?;`, userId);
  const m = new Map();
  rows.forEach(r => m.set(r.quest_slug, !!r.completed));
  return m;
}
app.get("/api/quests", async (req, res) => {
  const userId = req.session?.userId || null;
  const quests = await dbAll(`SELECT slug, title, description, type, xp, link FROM quests ORDER BY rowid ASC;`);
  let progress = new Map();
  if (userId) progress = await userQuestsMap(userId);
  const items = quests.map(q => ({ ...q, completed: progress.get(q.slug) || false }));
  res.json({ ok: true, quests: items });
});

// Twitter helpers (v2)
const TW_BEARER = process.env.TWITTER_BEARER_TOKEN || "";
const TARGET_USER = (process.env.TWITTER_TARGET_USERNAME || "7goldencowries").replace(/^@/, "");
const PINNED_TWEET_ID = process.env.TWITTER_PINNED_TWEET_ID || "1947595024117502145"; // user supplied earlier

async function twFetch(path, params={}) {
  if (!TW_BEARER) throw new Error("TWITTER_BEARER_TOKEN missing");
  const u = new URL(`https://api.twitter.com/2/${path}`);
  for (const [k,v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { Authorization: `Bearer ${TW_BEARER}` } });
  if (!r.ok) throw new Error(`twitter ${r.status}`);
  return r.json();
}
const userIdCache = new Map();
async function getUserIdByUsername(un) {
  const k = un.toLowerCase();
  if (userIdCache.has(k)) return userIdCache.get(k);
  const j = await twFetch(`users/by/username/${un}`, { "user.fields": "id" });
  const id = j?.data?.id;
  if (!id) throw new Error("user-not-found");
  userIdCache.set(k, id);
  return id;
}

// Verify types
async function verifyFollow(handle) {
  const follower = await getUserIdByUsername(handle);
  const target = await getUserIdByUsername(TARGET_USER);
  // Check following relationship
  const j = await twFetch(`users/${follower}/following`, { "max_results":"1000" });
  const arr = j?.data || [];
  return arr.some(u => String(u.id) === String(target));
}
async function verifyRetweet(handle, tweetId) {
  const user = await getUserIdByUsername(handle);
  const j = await twFetch(`users/${user}/retweeted_tweets`, { "max_results":"100" });
  const arr = j?.data || [];
  return arr.some(t => String(t.id) === String(tweetId));
}
async function verifyQuote(handle, tweetId) {
  // Basic check via recent tweets that reference the pinned tweet ID
  const user = await getUserIdByUsername(handle);
  const j = await twFetch(`users/${user}/tweets`, { "max_results":"100", "tweet.fields":"referenced_tweets" });
  const arr = j?.data || [];
  return arr.some(t => (t.referenced_tweets||[]).some(ref => ref.type === "quoted" && String(ref.id) === String(tweetId)));
}

// Claim endpoint (daily, follow, retweet, quote, referral trigger)
app.post("/api/quests/claim", async (req, res) => {
  try {
    const userId = req.session?.userId;
    const wallet = req.session?.address || extractAddressFromReq(req);
    if (!userId || !wallet) return res.status(401).json({ ok: false, error: "not-authed" });

    const slug = String(req.body?.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, error: "slug-required" });

    const q = await dbGet(`SELECT slug, type, xp FROM quests WHERE slug = ?;`, slug);
    if (!q) return res.status(404).json({ ok: false, error: "quest-not-found" });

    // Social proofs (when applicable)
    const handle = (req.body?.twitterHandle || req.body?.handle || "").replace(/^@/,"");
    if (q.type === "social_follow") {
      const ok = await verifyFollow(handle);
      if (!ok) return res.status(400).json({ ok: false, error: "not-following" });
    } else if (q.type === "social_retweet") {
      const ok = await verifyRetweet(handle, PINNED_TWEET_ID);
      if (!ok) return res.status(400).json({ ok: false, error: "not-retweeted" });
    } else if (q.type === "social_quote") {
      const ok = await verifyQuote(handle, PINNED_TWEET_ID);
      if (!ok) return res.status(400).json({ ok: false, error: "not-quoted" });
    }

    // Mark completion (idempotent)
    await dbRun(
      `INSERT INTO user_quests (user_id, quest_slug, completed, claimed_at, updated_at)
       VALUES (?, ?, 1, datetime('now'), datetime('now'))
       ON CONFLICT(user_id, quest_slug) DO UPDATE SET completed=1, claimed_at=datetime('now'), updated_at=datetime('now');`,
      userId, slug
    );

    // XP award
    await dbRun(`UPDATE users SET xp = xp + ?, updated_at=datetime('now') WHERE id = ?;`, q.xp, userId);

    res.json({ ok: true, slug, xpDelta: q.xp });
  } catch (e) {
    console.error("claim error", e);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Referrals (minimal live)
app.post("/api/referrals/claim", async (req, res) => {
  try {
    const invitee = req.session?.address || extractAddressFromReq(req);
    const inviter = String(req.body?.inviter || "").trim();
    if (!invitee || !inviter) return res.status(400).json({ ok: false, error: "params" });
    if (invitee === inviter) return res.status(400).json({ ok: false, error: "self" });
    await dbRun(`INSERT OR IGNORE INTO referrals (inviter_wallet, invitee_wallet) VALUES (?, ?);`, inviter, invitee);
    // Optional XP bonus
    const bonus = 100;
    const invUser = await dbGet(`SELECT id FROM users WHERE wallet = ?;`, inviter);
    if (invUser) await dbRun(`UPDATE users SET xp = xp + ? WHERE id = ?;`, bonus, invUser.id);
    res.json({ ok: true, inviter, invitee, xpDelta: bonus });
  } catch (e) { res.status(500).json({ ok: false, error: "internal_error" }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// TON payments (Toncenter → TonAPI fallback)
async function fetchIncomingTxFromToncenter(address, limit = 30) {
  const url = `https://toncenter.com/api/v2/getTransactions?address=${encodeURIComponent(address)}&limit=${limit}`;
  const r = await fetch(url, { headers: { "X-Api-Key": process.env.TONCENTER_KEY || "" } });
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
          value: m.value, message: m.message, comment: m.message,
          destination: m.destination, source: m.source
        }))
      : []
  }));
  return { transactions };
}
async function fetchIncomingTxFromTonApi(address, limit = 30) {
  const r = await fetch(`https://tonapi.io/v2/blockchain/accounts/${address}/transactions?limit=${limit}`, {
    headers: { Authorization: `Bearer ${process.env.TONAPI_KEY || ""}` }
  });
  if (!r.ok) throw new Error(`TonAPI ${r.status}`);
  return r.json();
}
async function fetchIncomingTx(address, limit=30) {
  try { return await fetchIncomingTxFromToncenter(address, limit); } catch {}
  if (process.env.TONAPI_KEY) try { return await fetchIncomingTxFromTonApi(address, limit); } catch {}
  throw new Error("no-indexer-available");
}

// Checkout
app.post("/api/v1/payments/ton/checkout", async (req, res) => {
  try {
    const wallet = req.session?.address || extractAddressFromReq(req);
    if (!wallet) return res.status(401).json({ ok: false, error: "wallet-required" });

    const tier = (req.body?.tier || "Explorer").trim();
    const amount = priceForTier(tier);
    if (!amount || amount <= 0) return res.status(400).json({ ok: false, error: "bad-tier" });

    const toAddr = process.env.TON_SERVICE_WALLET;
    if (!toAddr) return res.status(500).json({ ok: false, error: "service-wallet-missing" });

    const invoiceId = crypto.randomBytes(6).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    await dbRun(
      `INSERT INTO ton_invoices (id, wallet, tier, to_addr, amount, comment, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      invoiceId, wallet, tier, toAddr, amount, invoiceId, expiresAt
    );

    const tonDeepLink = `ton://transfer/${toAddr}?amount=${amount}&text=${invoiceId}`;
    const tonConnectPayload = {
      validUntil: Math.floor(Date.now() / 1000) + 60 * 30,
      messages: [{ address: toAddr, amount: String(amount) }]
    };

    res.json({ ok: true, provider: "ton", invoiceId, tier, amount, to: toAddr, comment: invoiceId, expiresAt, tonDeepLink, tonConnectPayload });
  } catch (e) { console.error("ton checkout error", e); res.status(500).json({ ok: false, error: "internal_error" }); }
});

// Invoice poll
app.get("/api/v1/payments/ton/invoice/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const inv = await dbGet(`SELECT * FROM ton_invoices WHERE id = ?;`, id);
    if (!inv) return res.status(404).json({ ok: false, error: "invoice-not-found" });
    if (inv.status === "confirmed") {
      const s = await getSubStatus(inv.wallet);
      return res.json({ ok: true, invoice: inv, subscription: s });
    }
    if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
      await dbRun(`UPDATE ton_invoices SET status='expired', updated_at=datetime('now') WHERE id=?;`, id);
      return res.json({ ok: false, error: "expired" });
    }

    const data = await fetchIncomingTx(inv.to_addr, 30);
    const txs = data?.transactions ?? data ?? [];
    let matched = null;
    for (const t of txs) {
      const msg = t.in_msg || (t.out_msgs ? t.out_msgs.find(m => m.destination === inv.to_addr) : null);
      if (!msg) continue;
      const text = msg?.message || msg?.comment || "";
      const amount = Number(msg?.value || 0);
      if (text && text.includes(inv.comment) && amount >= Number(inv.amount)) {
        matched = { tx_hash: t.hash || t.transaction_id?.hash || t.lt, amount, text };
        break;
      }
    }
    if (!matched) return res.json({ ok: true, invoice: inv, pending: true });

    await dbRun(`UPDATE ton_invoices SET status='confirmed', tx_hash=?, updated_at=datetime('now') WHERE id=?;`, String(matched.tx_hash || ""), id);
    await dbRun(`INSERT INTO subscriptions (wallet, tier, active, provider, tx_id, updated_at) VALUES (?, ?, 1, 'ton', ?, datetime('now'));`, inv.wallet, inv.tier, String(matched.tx_hash || ""));
    const s = await getSubStatus(inv.wallet);
    res.json({ ok: true, invoice: { ...inv, status: "confirmed", tx_hash: matched.tx_hash }, subscription: s });
  } catch (e) { console.error("ton invoice verify error", e); res.status(500).json({ ok: false, error: "internal_error" }); }
});
app.get("/api/v1/payments/status", async (req, res) => {
  const wallet = req.session?.address || req.get("x-wallet") || null;
  const s = await getSubStatus(wallet);
  res.json({ ok: true, wallet, active: s.active, provider: s.active ? "ton" : null, tier: s.tier, xpBoost: s.xpBoost });
});
app.get("/api/payments/status", async (req, res) => {
  const wallet = req.session?.address || req.get("x-wallet") || null;
  const s = await getSubStatus(wallet);
  res.json({ ok: true, wallet, active: s.active, provider: s.active ? "ton" : null, tier: s.tier, xpBoost: s.xpBoost });
});

// ─────────────────────────────────────────────────────────────────────────────
// Leaderboard shim (if router exists)
if (leaderboardRouter) {
  app.use((req, res, next) => {
    const send = res.json.bind(res);
    res.json = (body) => {
      try {
        if (req.path.startsWith("/api/leaderboard") && req.query?.compat === "deep" && body && body.ok) {
          body = { ok: true, data: { results: body.results ?? body.rows ?? body.items ?? body.leaderboard ?? [] } };
        } else if (req.path.startsWith("/api/leaderboard") && body && body.ok) {
          const rows = body.results ?? body.rows ?? body.items ?? body.leaderboard ?? body.data ?? body.scores ?? [];
          body.payload = rows;
          if (!body.data) body.data = rows;
        }
      } catch {}
      return send(body);
    };
    next();
  });
  app.use("/api/leaderboard", leaderboardRouter);
  app.use("/api/v1/leaderboard", leaderboardRouter);
}

// 404 + error
app.use((req, res) => res.status(404).json({ ok: false, error: "not_found" }));
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ ok: false, error: "internal_error" }); });

// Start
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`7GC backend listening on :${PORT}`);
  if (!process.env.TWITTER_BEARER_TOKEN) console.log("TWITTER_BEARER_TOKEN missing");
});
