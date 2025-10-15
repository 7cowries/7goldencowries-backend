import "dotenv/config";
import express from "express";
import referralRoutes from "./routes/referralRoutes.js";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import session from "express-session";
import path from "node:path";
import db from "./lib/db.js";                 // will be rewritten below if ./lib/db.js doesn't exist
import saleRoutes from "./routes/saleRoutes.js";
import leaderboardRouter from './routes/leaderboard.js';

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

app.use(rateLimit({
  windowMs: 60000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false
}));

// accept {wallet} or {address}
app.use((req, _res, next) => {
  try {
    const b = req.body || {};
    if (b.wallet && !b.address) b.address = String(b.wallet).trim();
  } catch {}
  next();
});

const SESSION_NAME = "7gc.sid";
const isProd = process.env.NODE_ENV === "production";

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

function normalizeAddress(a){ if(!a) return null; const s=String(a).trim(); return s.length?s:null; }

async function materializeUserByAddress(address){
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

function extractAddressFromReq(req){
  if (req.session?.address) return req.session.address;
  const raw = req.cookies?.[SESSION_NAME];
  if (raw && typeof raw === "string" && raw.startsWith("w:")) return raw.slice(2);
  const h = req.get("x-wallet"); if (h) return h;
  if (req.body?.address) return req.body.address;
  return null;
}

// lazy binder: hydrate session from any wallet hint
app.use(async (req, _res, next) => {
  try{
    if (req.session?.userId) return next();
    const address = extractAddressFromReq(req);
    if (!address) return next();
    const user = await materializeUserByAddress(address);
    if (user) {
      req.session.userId = user.id;
      req.session.address = user.wallet;
      req.userId = user.id;
      req.userAddress = user.wallet;
    }
  }catch(e){ console.error("[binder]", e); }
  next();
});

// health
app.get("/api/health", async (_req, res) => {
  try { await db.get("SELECT 1"); res.json({ ok:true, db:"ok" }); }
  catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});

// login
app.post("/api/auth/wallet/session", async (req, res) => {
  const address = normalizeAddress(req.body?.address);
  if (!address) return res.status(400).json({ ok:false, error:"address-required" });
  const user = await materializeUserByAddress(address);
  if (!user) return res.status(500).json({ ok:false, error:"user-create-failed" });

  req.session.userId = user.id;
  req.session.address = user.wallet;

  // legacy readable cookie for existing curl flows
  res.cookie(SESSION_NAME, `w:${user.wallet}`, {
    httpOnly: false,
    sameSite: "none",
    secure: true,
    maxAge: 1000 * 60 * 60 * 24 * 30
  });

  res.json({ ok:true, address:user.wallet, session:"set" });
});

// simple me
app.get("/api/me", (req, res) => {
  if (!req.session?.address) {
    const a = extractAddressFromReq(req);
    if (!a) return res.json({ ok:true, authed:false });
    return res.json({ ok:true, authed:true, wallet:a });
  }
  res.json({ ok:true, authed:true, wallet:req.session.address });
});

// guard
function requireLogin(req, res, next){
  if (req.session?.userId) return next();
  return res.status(401).json({ ok:false, error:"not_logged_in" });
}

// protected routes
app.use("/api/referrals", requireLogin, referralRoutes);
app.use("/api/sale",      requireLogin, saleRoutes);

// 404
  // --- Leaderboard mount (ESM) ---

// --- Leaderboard (ESM) ---

// --- 404 ---
// --- error last ---
});

// --- listen ---

// --- 7GC fixed tail (auto) ---
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`7GC backend listening on :${PORT}`));

// --- 7GC normalized tail (auto) ---
app.use('/api/leaderboard', leaderboardRouter);

app.use((req, res) => {
  res.status(404).json({ ok:false, error:'not_found' });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok:false, error:'internal_error' });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`7GC backend listening on :${PORT}`));
