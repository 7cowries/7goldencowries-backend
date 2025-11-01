// server.js — 7 Golden Cowries (production)
// Robust preflight, idempotent schema reshape, live routes (health, auth,
// quests, leaderboard, referrals, TON checkout/verify).

import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import session from "express-session";
import crypto from "node:crypto";

// ─────────────────────────────────────────────────────────────
// 0) PRE-FLIGHT: open sqlite BEFORE importing ./db.js
const DB_FILE =
  process.env.DATABASE_URL ||
  process.env.DATABASE_PATH ||
  process.env.SQLITE_FILE ||
  "/var/data/7gc.sqlite3";

const sqlite3 = (await import("sqlite3")).default;
const { open } = await import("sqlite");

// preflight open (same file used by db.js)
const predb = await open({ filename: DB_FILE, driver: sqlite3.Database });
console.log("[preflight] opened", DB_FILE);
await predb.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS subscriptions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet      TEXT NOT NULL,
    tier        TEXT NOT NULL DEFAULT 'Free'
  );
`);
await predb.close();
console.log("[preflight] done, closing preflight DB");

// ─────────────────────────────────────────────────────────────
// 1) import the real DB connection (must use same precedence)
const { default: dbp } = await import("./db.js");

let db;
try {
  db = await dbp;
  console.log("[db] opened sqlite at", DB_FILE);
} catch (err) {
  console.error("[db/open] failed, falling back to in-memory:", err);
  db = await open({ filename: ":memory:", driver: sqlite3.Database });
  console.warn("[db/open] using in-memory sqlite — non persistent");
}

// utility
async function tableCols(db, table) {
  try {
    const rows = await db.all(`PRAGMA table_info(${table});`);
    return Array.isArray(rows) ? rows.map((r) => r.name) : [];
  } catch {
    return [];
  }
}
function hasAll(cols, req) {
  return req.every((c) => cols.includes(c));
}

// ─────────────────────────────────────────────────────────────
// 2) idempotent migrations
async function ensureSubscriptionsShape() {
  const required = [
    "id", "wallet", "tier", "active", "provider", "tx_id",
    "created_at", "updated_at", "timestamp"
  ];

  const cols = await tableCols(db, "subscriptions");
  if (hasAll(cols, required)) {
    console.log("[migrate] subscriptions: shape ok");
    return;
  }

  console.log("[migrate] subscriptions: reshaping (adding missing columns)…");
  await db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN IMMEDIATE;

    DROP TABLE IF EXISTS subscriptions_new;
    CREATE TABLE subscriptions_new (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet      TEXT    NOT NULL,
      tier        TEXT    NOT NULL DEFAULT 'Free',
      active      INTEGER NOT NULL DEFAULT 0,
      provider    TEXT,
      tx_id       TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      timestamp   TEXT
    );

    INSERT INTO subscriptions_new (
      id, wallet, tier, active, provider, tx_id, created_at, updated_at, timestamp
    )
    SELECT
      id,
      wallet,
      COALESCE(tier, 'Free')                              AS tier,
      CASE
        WHEN EXISTS (SELECT 1 FROM pragma_table_info('subscriptions') WHERE name='active')
          THEN COALESCE(active, 0)
        ELSE CASE WHEN COALESCE(tier,'Free') <> 'Free' THEN 1 ELSE 0 END
      END                                                 AS active,
      CASE
        WHEN EXISTS (SELECT 1 FROM pragma_table_info('subscriptions') WHERE name='provider')
          THEN provider ELSE NULL
      END                                                 AS provider,
      CASE
        WHEN EXISTS (SELECT 1 FROM pragma_table_info('subscriptions') WHERE name='tx_id')
          THEN tx_id ELSE NULL
      END                                                 AS tx_id,
      CASE
        WHEN EXISTS (SELECT 1 FROM pragma_table_info('subscriptions') WHERE name='created_at')
          THEN COALESCE(created_at, datetime('now'))
        ELSE datetime('now')
      END                                                 AS created_at,
      CASE
        WHEN EXISTS (SELECT 1 FROM pragma_table_info('subscriptions') WHERE name='updated_at')
          THEN COALESCE(updated_at, datetime('now'))
        ELSE datetime('now')
      END                                                 AS updated_at,
      CASE
        WHEN EXISTS (SELECT 1 FROM pragma_table_info('subscriptions') WHERE name='timestamp')
          THEN timestamp
        ELSE NULL
      END                                                 AS timestamp
    FROM subscriptions;

    DROP TABLE subscriptions;
    ALTER TABLE subscriptions_new RENAME TO subscriptions;
    CREATE INDEX IF NOT EXISTS idx_sub_wallet ON subscriptions(wallet);

    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
  console.log("[migrate] subscriptions: reshape complete");
}

async function ensureCoreTablesAndSeeds() {
  // users
  await db.exec(`
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

  // ton_invoices
  await db.exec(`
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

  // quests
  await db.exec(`
    CREATE TABLE IF NOT EXISTS quests (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT,
      type TEXT,
      xp INTEGER NOT NULL DEFAULT 0,
      link TEXT,
      meta TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // user_quests
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      wallet TEXT,
      quest_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      xp_awarded INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // referrals
  await db.exec(`
    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      owner_wallet TEXT NOT NULL,
      invited_wallet TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // seed quests (only if empty)
  const row = await db.get(`SELECT COUNT(*) AS c FROM quests;`);
  if (!row || !row.c) {
    const Q = [
      { id:"daily-checkin",  title:"Daily Check-in", description:"Open the 7 Golden Cowries app today.", category:"daily",  type:"daily",  xp:10,  link:null },
      { id:"follow-twitter", title:"Follow @7goldencowries", description:"Follow our X account to earn XP.", category:"social", type:"oneoff", xp:50,  link:"https://x.com/7goldencowries" },
      { id:"retweet-pinned", title:"Retweet pinned quest tweet", description:"Retweet the pinned quest tweet.", category:"social", type:"oneoff", xp:75,  link:"https://x.com/7goldencowries/status/1947595024117502145" },
      { id:"quote-tweet",    title:"Quote our announcement", description:"Quote our pinned tweet with your ton wallet.", category:"social", type:"oneoff", xp:100, link:"https://x.com/7goldencowries/status/1947595024117502145" },
      { id:"join-telegram",  title:"Join Telegram tide", description:"Join the GOLDENCOWRIEBOT channel.", category:"social", type:"oneoff", xp:60,  link:"https://t.me/GOLDENCOWRIEBOT" },
      { id:"invite-a-friend",title:"Invite a Friend", description:"Share your referral link; get XP when friend joins.", category:"referral",type:"referral", xp:120, link:"https://7goldencowries.com/ref" }
    ];
    const stmt = await db.prepare(`
      INSERT INTO quests (id, title, description, category, type, xp, link, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL);
    `);
    for (const q of Q) await stmt.run(q.id, q.title, q.description, q.category, q.type, q.xp, q.link);
    await stmt.finalize();
    console.log("[seed] quests: inserted 6 live quests");
  }
}

// run migrations + seeds
await ensureSubscriptionsShape();
await ensureCoreTablesAndSeeds();

// ─────────────────────────────────────────────────────────────
// 3) express base + middleware
const app = express();
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
app.use(rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false }));

// sessions (cookie for Vercel/Render combo)
const SESSION_NAME = "7gc.sid";
app.use(session({
  name: SESSION_NAME,
  secret: process.env.SESSION_SECRET || "change-me",
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: "none", secure: true, maxAge: 1000 * 60 * 60 * 24 * 30 },
}));

// helpers
function normalizeAddress(a){ if(!a) return null; const s=String(a).trim(); return s.length?s:null; }
async function materializeUserByAddress(address){
  const addr = normalizeAddress(address); if(!addr) return null;
  try {
    await db.run(`INSERT OR IGNORE INTO users (wallet, xp, level, level_name) VALUES (?, 0, 1, 'Shellborn');`, addr);
    return await db.get(`SELECT id, wallet, xp, level, level_name FROM users WHERE wallet = ?;`, addr);
  } catch(e){ console.warn("[materializeUserByAddress]", e.message); return null; }
}
function extractAddressFromReq(req){
  if (req.session?.address) return req.session.address;
  const raw = req.cookies?.[SESSION_NAME];
  if (raw && typeof raw === "string" && raw.startsWith("w:")) return raw.slice(2);
  const h = req.get("x-wallet"); if (h) return h;
  if (req.body?.address) return req.body.address;
  return null;
}
app.use((req,_res,next)=>{ const b=req.body||{}; if(b.wallet && !b.address) b.address=String(b.wallet).trim(); next(); });
app.use(async (req,_res,next)=>{
  try{
    if (req.session?.userId) return next();
    const hint = extractAddressFromReq(req); if (!hint) return next();
    const user = await materializeUserByAddress(hint);
    if (user){ req.session.userId = user.id; req.session.address = user.wallet; req.userId=user.id; req.userAddress=user.wallet; }
  }catch(e){ console.error("[binder]", e); }
  next();
});

// HEALTH
app.get("/api/health", async (_req, res) => {
  try { await db.get("SELECT 1;"); res.json({ ok: true, db: "ok" }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// AUTH (wallet session)
app.post("/api/auth/wallet/session", async (req,res)=>{
  const address = normalizeAddress(req.body?.address);
  if (!address) return res.status(400).json({ ok:false, error:"address-required" });
  const user = await materializeUserByAddress(address);
  if (!user)  return res.status(500).json({ ok:false, error:"user-create-failed" });
  req.session.userId = user.id;
  req.session.address = user.wallet;
  res.cookie(SESSION_NAME, `w:${user.wallet}`, { httpOnly:false, sameSite:"none", secure:true, maxAge: 1000*60*60*24*30 });
  res.json({ ok:true, address:user.wallet, session:"set" });
});

// SUBSCRIPTIONS
function boostForTier(tier){ return tier==="Gold"?2.0 : tier==="Explorer"?1.5 : 1.0; }

async function getSubStatus(wallet){
  const def = { active:false, tier:"Free", xpBoost:1.0 };
  if (!wallet) return def;
  try {
    const row = await db.get(
      `SELECT COALESCE(tier,'Free') AS tier, COALESCE(active, CASE WHEN COALESCE(tier,'Free')<>'Free' THEN 1 ELSE 0 END) AS active
       FROM subscriptions WHERE wallet = ? ORDER BY id DESC LIMIT 1`,
      wallet
    );
    if (!row) return def;
    return { active: !!row.active, tier: row.tier, xpBoost: boostForTier(row.tier) };
  } catch (e) {
    // extreme fallback if legacy read hits older shape during first boot
    const r2 = await db.get(`SELECT COALESCE(tier,'Free') AS tier FROM subscriptions WHERE wallet = ? ORDER BY id DESC LIMIT 1`, wallet);
    if (!r2) return def;
    const act2 = r2.tier && r2.tier !== "Free";
    return { active: act2, tier: r2.tier, xpBoost: boostForTier(r2.tier) };
  }
}

app.get("/api/subscriptions/status", async (req,res)=>{
  const wallet = req.session?.address || extractAddressFromReq(req);
  const s = await getSubStatus(wallet);
  res.json({ ok:true, wallet, tier:s.tier, xpBoost:s.xpBoost });
});

// ───── TON Payments (live) ─────
async function fetchIncomingTxFromToncenter(address, limit=30){
  const url = `https://toncenter.com/api/v2/getTransactions?address=${encodeURIComponent(address)}&limit=${limit}`;
  const r = await fetch(url, { headers:{ "X-Api-Key": process.env.TONCENTER_KEY || "" }});
  if (!r.ok) throw new Error(`Toncenter ${r.status}`);
  const j = await r.json();
  const raw = j?.result || j?.transactions || [];
  return { transactions: raw.map(t=>({
    hash: t?.transaction_id?.hash,
    lt: t?.transaction_id?.lt,
    in_msg: t?.in_msg ? {
      value:t.in_msg.value, message:t.in_msg.message, comment:t.in_msg.message,
      destination:t.in_msg.destination, source:t.in_msg.source
    } : null,
    out_msgs: Array.isArray(t?.out_msgs) ? t.out_msgs.map(m=>({
      value:m.value, message:m.message, comment:m.message,
      destination:m.destination, source:m.source
    })) : [],
  })) };
}
async function fetchIncomingTxFromTonApi(address, limit=30){
  const r = await fetch(`https://tonapi.io/v2/blockchain/accounts/${address}/transactions?limit=${limit}`, {
    headers:{ Authorization:`Bearer ${process.env.TONAPI_KEY || ""}` }
  });
  if (!r.ok) throw new Error(`TonAPI ${r.status}`);
  return r.json();
}
async function fetchIncomingTx(address, limit=30){
  try { return await fetchIncomingTxFromToncenter(address, limit); }
  catch { if (process.env.TONAPI_KEY) try { return await fetchIncomingTxFromTonApi(address, limit); } catch {} }
  throw new Error("no-indexer-available");
}
function priceForTier(tier){
  const map = {
    Explorer: Number(process.env.TON_PRICE_EXPLORER || 0),
    Gold:     Number(process.env.TON_PRICE_GOLD || 0),
  };
  return map[tier] || map.Explorer || 0;
}

// create invoice
app.post("/api/v1/payments/ton/checkout", async (req,res)=>{
  const wallet = req.session?.address || req.get("x-wallet") || req.body?.wallet || req.body?.address;
  if (!wallet) return res.status(401).json({ ok:false, error:"wallet-required" });

  const tier = (req.body?.tier || "Explorer").trim();
  const amount = priceForTier(tier);
  if (!amount) return res.status(400).json({ ok:false, error:"bad-tier" });

  const toAddr = process.env.TON_SERVICE_WALLET;
  if (!toAddr) return res.status(500).json({ ok:false, error:"service-wallet-missing" });

  const invoiceId = crypto.randomBytes(6).toString("hex");
  const expiresAt = new Date(Date.now() + 30*60*1000).toISOString();

  await db.run(
    `INSERT INTO ton_invoices (id, wallet, tier, to_addr, amount, comment, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    invoiceId, wallet, tier, toAddr, amount, invoiceId, expiresAt
  );

  const tonDeepLink = `ton://transfer/${toAddr}?amount=${amount}&text=${invoiceId}`;
  const tonConnectPayload = { validUntil: Math.floor(Date.now()/1000)+60*30, messages:[{ address: toAddr, amount: String(amount) }] };

  res.json({ ok:true, provider:"ton", invoiceId, tier, amount, to:toAddr, comment:invoiceId, expiresAt, tonDeepLink, tonConnectPayload });
});

// verify invoice
app.get("/api/v1/payments/ton/invoice/:id", async (req,res)=>{
  const id = req.params.id;
  const inv = await db.get(`SELECT * FROM ton_invoices WHERE id = ?`, id);
  if (!inv) return res.status(404).json({ ok:false, error:"invoice-not-found" });

  if (inv.status === "confirmed") {
    const s = await getSubStatus(inv.wallet);
    return res.json({ ok:true, invoice:inv, subscription:s });
  }

  if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
    await db.run(`UPDATE ton_invoices SET status='expired', updated_at=datetime('now') WHERE id=?`, id);
    return res.json({ ok:false, error:"expired" });
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

  if (!matched) return res.json({ ok:true, invoice:inv, pending:true });

  await db.run(`UPDATE ton_invoices SET status='confirmed', tx_hash=?, updated_at=datetime('now') WHERE id=?`, String(matched.tx_hash||""), id);
  await db.run(`INSERT INTO subscriptions (wallet, tier, active, provider, tx_id, updated_at) VALUES (?, ?, 1, 'ton', ?, datetime('now'))`, inv.wallet, inv.tier, String(matched.tx_hash||""));

  const s = await getSubStatus(inv.wallet);
  res.json({ ok:true, invoice:{ ...inv, status:"confirmed", tx_hash: matched.tx_hash }, subscription:s });
});

// unified alias
app.get("/api/v1/payments/status", async (req,res)=>{
  const wallet = req.session?.address || req.get("x-wallet") || null;
  const s = await getSubStatus(wallet);
  res.json({ ok:true, wallet, active:s.active, provider: s.active ? "ton" : null, tier:s.tier, xpBoost:s.xpBoost });
});
app.get("/api/payments/status", async (req,res)=>{
  const wallet = req.session?.address || req.get("x-wallet") || null;
  const s = await getSubStatus(wallet);
  res.json({ ok:true, wallet, active:s.active, provider: s.active ? "ton" : null, tier:s.tier, xpBoost:s.xpBoost });
});

// routes (live)
app.use("/api/leaderboard", (await import("./routes/leaderboard.js")).default);
app.use("/api/v1/leaderboard", (await import("./routes/leaderboard.js")).default);
app.use("/api/quests", (await import("./routes/quests.js")).default);
app.use("/api/v1/quests", (await import("./routes/quests.js")).default);
app.use("/api/referrals", (await import("./routes/referrals.js")).default);
app.use("/api/v1/referrals", (await import("./routes/referrals.js")).default);
app.use("/api/twitter", (await import("./routes/twitterVerify.js")).default);

// 404 + error
app.use((req,res)=>res.status(404).json({ ok:false, error:"not_found" }));
app.use((err,_req,res,_next)=>{ console.error(err); res.status(500).json({ ok:false, error:"internal_error" }); });

// start
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`7GC backend listening on :${PORT}`);
  if (!process.env.TWITTER_BEARER_TOKEN) console.log("TWITTER_BEARER_TOKEN missing");
});
