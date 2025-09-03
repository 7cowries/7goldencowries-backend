// server.js  (production entrypoint on Render)
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import session from "express-session";
import passport from "passport";
import MemoryStore from "memorystore";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dayjs from "dayjs";

import "./passport.js";
import db from "./db.js";
import { getLevelInfo } from "./utils/levelUtils.js";

/* --- Core routes you already had --- */
import questRoutes from "./routes/questRoutes.js";
import leaderboardRoutes from "./routes/leaderboardRoutes.js";   // if present
import adminRoutes from "./routes/adminRoutes.js";               // if present
import authRoutes from "./routes/authRoutes.js";                 // /auth/twitter, /auth/discord, etc.
import telegramRoutes from "./routes/telegramRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import verifyRoutes from "./routes/verifyRoutes.js";
import referralRoutes from "./routes/referralRoutes.js";
import subscriptionRoutes from "./routes/subscriptionRoutes.js";
import twitterRoutes from "./routes/twitterRoutes.js";
import tonWebhook from "./routes/tonWebhook.js";
import tokenSaleRoutes from "./routes/tokenSaleRoutes.js";       // if present

/* --- NEW: secure quest/social routes --- */
import questLinkRoutes from "./routes/questLinkRoutes.js";         // /api/quests/:id/link/start|finish, /r/:nonce
import questTelegramRoutes from "./routes/questTelegramRoutes.js"; // /api/quests/telegram/join/verify
import questDiscordRoutes from "./routes/questDiscordRoutes.js";   // /api/quests/discord/join/verify
import socialLinkRoutes from "./routes/socialLinkRoutes.js";       // /api/social/:provider/unlink|resync

dotenv.config();

const app = express();
const PROD = process.env.NODE_ENV === "production";
const DEFAULT_FRONTEND = "http://localhost:3000";

/* CORS allow-list (comma separated in FRONTEND_URL) */
const ALLOWED = (process.env.FRONTEND_URL || DEFAULT_FRONTEND)
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

/* Trust proxy (Render) */
app.set("trust proxy", 1);

/* Security headers */
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

/* CORS (with credentials) */
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);           // curl / same-origin
    if (ALLOWED.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked for origin: ${origin}`), false);
  },
  credentials: true,
  optionsSuccessStatus: 204
}));

/* Parsers & cookies */
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

/* Sessions (popup-friendly) */
const Store = MemoryStore(session);
app.use(session({
  name: "7gc.sid",
  secret: process.env.SESSION_SECRET || "cowrie-secret",
  resave: false,
  saveUninitialized: true,
  store: new Store({ checkPeriod: 86400000 }), // 24h
  cookie: {
    httpOnly: true,
    secure: PROD,
    sameSite: PROD ? "none" : "lax",
    maxAge: 1000 * 60 * 60, // 1h
  }
}));

app.use(passport.initialize());
app.use(passport.session());

/* Rate limits */
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600 });
app.use("/api", apiLimiter);

const questLimiter = rateLimit({ windowMs: 60 * 1000, max: 40 });
app.use("/api/quests", questLimiter);
app.use("/api/verify", questLimiter);

/* --- Mount order matters for OAuth popups/callbacks --- */
app.use(telegramRoutes);   // /auth/telegram/*
app.use(authRoutes);       // /auth/twitter, /auth/discord, etc.

/* --- Secure routes --- */
app.use(questLinkRoutes);        // /api/quests/:id/link/start  /r/:nonce  /finish
app.use(questTelegramRoutes);    // /api/quests/telegram/join/verify
app.use(questDiscordRoutes);     // /api/quests/discord/join/verify
app.use(socialLinkRoutes);       // /api/social/:provider/unlink|resync

/* --- Existing app APIs --- */
app.use(questRoutes);
app.use(userRoutes);
app.use(verifyRoutes);
app.use(tonWebhook);
app.use(referralRoutes);
app.use("/api/subscribe", subscriptionRoutes);
app.use("/api", twitterRoutes);
if (tokenSaleRoutes) app.use(tokenSaleRoutes);
if (leaderboardRoutes) app.use(leaderboardRoutes);
if (adminRoutes) app.use(adminRoutes);

/* -------------------------------
   Boot seed: live quests (idempotent)
----------------------------------*/

function normalizeQuestRow(row = {}) {
  return {
    id: Number(row.id),
    title: row.title || "",
    type: (row.type || "daily").toLowerCase(),
    url: row.url || "#",
    xp: Number(row.xp || 0),
    requiredTier: row.requiredTier || "Free",
    requiresTwitter: !!(row.requiresTwitter || false),
    requirement: row.requirement || (row.requiresTwitter ? "x_follow" : "none"),
    target: row.target || row.target_handle || null,
    active: Number(row.active ?? 1),
  };
}

async function seedLiveQuests() {
  try {
    const row = await db.get(`SELECT COUNT(*) AS c FROM quests`);
    const empty = Number(row?.c || 0) === 0;
    const force = String(process.env.AUTO_SEED || "0") === "1";
    if (!empty && !force) return;

    // wipe & seed (only when empty or forced)
    await db.run(`DELETE FROM quests`);
    await db.run(`VACUUM`);

    const live = [
      { id: 1, title: "Follow us on X",       type: "social", url: "https://x.com/7goldencowries",          xp: 50, active: 1, requirement: "x_follow" },
      { id: 2, title: "Join our Telegram",    type: "social", url: "https://t.me/GOLDENCOWRIE",             xp: 50, active: 1, requirement: "tg_channel_member" },
      { id: 3, title: "Join our Discord",     type: "social", url: "https://discord.gg/wdKntDQf",           xp: 75, active: 1, requirement: "discord_member" },
      { id: 4, title: "Daily Check-in",       type: "daily",  url: "#",                                     xp: 10, active: 1, requirement: "none" },
    ];

    const stmt = await db.prepare(
      `INSERT INTO quests (id, title, type, url, xp, active, requirement) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const q of live) {
      await stmt.run(q.id, q.title, q.type, q.url, q.xp, q.active, q.requirement);
    }
    await stmt.finalize();
    console.log(`✅ Seeded live quests: ${live.length}`);
  } catch (e) {
    console.error("❌ Seed live quests failed:", e);
  }
}

/* Kick seeding shortly after boot (so DB is ready) */
setTimeout(() => { seedLiveQuests(); }, 250);

/* -------------------------------
   Quests API (modern + legacy)
----------------------------------*/

// Modern: /api/quests  -> { quests: [ ...normalized ] }
app.get("/api/quests", async (_req, res) => {
  try {
    const rows = await db.all(`SELECT * FROM quests WHERE COALESCE(active,1)=1 ORDER BY id`);
    const quests = rows.map(normalizeQuestRow);
    res.json({ quests });
  } catch (err) {
    console.error("Failed to fetch quests:", err);
    res.status(500).json({ error: "Failed to load quests" });
  }
});

// Legacy alias: /quests?flat=1 -> [ ...normalized ]
app.get("/quests", async (req, res) => {
  try {
    const rows = await db.all(`SELECT * FROM quests WHERE COALESCE(active,1)=1 ORDER BY id`);
    const quests = rows.map(normalizeQuestRow);
    if (String(req.query.flat || "") === "1") return res.json(quests);
    return res.json({ quests });
  } catch (err) {
    console.error("Failed to fetch quests (legacy):", err);
    res.status(500).json({ error: "Failed to load quests" });
  }
});

/* --- Health & debug --- */
app.get("/", (_req, res) => res.send("7goldencowries backend is running"));
app.get("/healthz", async (_req, res) => {
  try { await db.get("SELECT 1"); res.json({ ok: true }); }
  catch { res.status(500).json({ ok: false, error: "db" }); }
});
app.get("/session-debug", (req, res) => res.json({ session: req.session }));

/* --- Leaderboard (frontend hits /api/leaderboard) --- */
app.get("/api/leaderboard", async (_req, res) => {
  try {
    const users = await db.all(`
      SELECT wallet, twitterHandle, xp, tier
      FROM users
      ORDER BY xp DESC
      LIMIT 20
    `);

    const top = users.map((u, i) => {
      const level = getLevelInfo(u.xp || 0);
      const badgeSlug = level?.name
        ? `level-${level.name.toLowerCase().replace(/\s+/g, "-")}.png`
        : "unranked.png";
      return {
        rank: i + 1,
        wallet: u.wallet,
        twitter: u.twitterHandle || null,
        xp: u.xp,
        tier: u.tier || "Free",
        name: level?.name || "Unranked",
        progress: level?.progress || 0,
        badge: `/images/badges/${badgeSlug}`,
      };
    });

    res.json({ top });
  } catch (e) {
    console.error("Leaderboard error:", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* --- Nice 404 logger so you can spot missing mounts --- */
app.use((req, res, next) => {
  if (res.headersSent) return next();
  console.warn(`404: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: "Not found" });
});

/* --- CORS error helper --- */
app.use((err, _req, res, _next) => {
  if (err && String(err.message || "").startsWith("CORS blocked for origin:")) {
    return res.status(401).json({ error: err.message, allowed: ALLOWED });
  }
  console.error(err);
  return res.status(500).json({ error: "Server error" });
});

/* --- Start server (Render injects PORT) --- */
const PORT = process.env.PORT || 10000; // Render detected :10000 in your logs
app.listen(PORT, () => {
  console.log(`✅  7goldencowries backend on :${PORT}`);
  console.log("   CORS allowed origins:", ALLOWED.join(", "));
  console.log("   Environment:", process.env.NODE_ENV || "dev");
});
