// index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import session from "express-session";
import passport from "passport";
import MemoryStore from "memorystore";
import cookieParser from "cookie-parser";
import cron from "node-cron";
import dayjs from "dayjs";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import "./passport.js";
import db from "./db.js";
import { getLevelInfo } from "./utils/levelUtils.js";

// ✅ Core routes already in your repo
import questRoutes from "./routes/questRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import verifyRoutes from "./routes/verifyRoutes.js";
import tonWebhook from "./routes/tonWebhook.js";
import referralRoutes from "./routes/referralRoutes.js";
import subscriptionRoutes from "./routes/subscriptionRoutes.js";
import twitterRoutes from "./routes/twitterRoutes.js";
import telegramRoutes from "./routes/telegramRoutes.js";
import tokenSaleRoutes from "./routes/tokenSaleRoutes.js"; // keep if used

// ✅ New routes for secure quests & socials
import questLinkRoutes from "./routes/questLinkRoutes.js";
import questTelegramRoutes from "./routes/questTelegramRoutes.js";
import questDiscordRoutes from "./routes/questDiscordRoutes.js";
import socialLinkRoutes from "./routes/socialLinkRoutes.js";

// ✅ New XP/Quest history endpoints
import historyRoutes from "./routes/historyRoutes.js";

dotenv.config();

const app = express();
const PROD = process.env.NODE_ENV === "production";
const DEFAULT_FRONTEND = "http://localhost:3000";

// FRONTEND_URL can be comma-separated list to allow Vercel + preview domains
const ALLOWED = (process.env.FRONTEND_URL || DEFAULT_FRONTEND)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Trust Render/Proxies so req.protocol & secure cookies work
app.set("trust proxy", 1);

// --- Security headers ---
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // you serve assets next to API
  })
);

// --- CORS (credentials on) ---
app.use(
  cors({
    origin(origin, callback) {
      // Allow same-origin / curl / server-to-server with no Origin header
      if (!origin) return callback(null, true);
      if (ALLOWED.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    credentials: true,
    optionsSuccessStatus: 204,
  })
);

// --- Body parsers & cookies ---
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// --- Sessions (popup-friendly cookies) ---
const Store = MemoryStore(session);
app.use(
  session({
    name: "7gc.sid",
    secret: process.env.SESSION_SECRET || "cowrie-secret",
    resave: false,
    saveUninitialized: true,
    store: new Store({ checkPeriod: 86400000 }), // 24h
    cookie: {
      httpOnly: true,
      secure: PROD, // secure cookies on https in prod
      sameSite: PROD ? "none" : "lax", // allow cross-site OAuth popups in prod
      maxAge: 1000 * 60 * 60, // 1h
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// --- Rate limiting ---
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600 });
app.use("/api", apiLimiter);

const questLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });
app.use("/api/quests", questLimiter);
app.use("/api/verify", questLimiter);

// --- Mount order matters for auth popups/callbacks ---
app.use(telegramRoutes); // /auth/telegram/*
app.use(authRoutes);     // /auth/twitter, /auth/discord, etc.

// --- Secure quest + social routes (new) ---
app.use(questLinkRoutes);     // /api/quests/:id/link/start, /r/:nonce, /finish
app.use(questTelegramRoutes); // /api/quests/telegram/join/verify
app.use(questDiscordRoutes);  // /api/quests/discord/join/verify
app.use(socialLinkRoutes);    // /api/social/:provider/unlink|resync

// --- Existing app APIs ---
app.use(questRoutes);
app.use(userRoutes);
app.use(verifyRoutes);
app.use(tonWebhook);
app.use(referralRoutes);
app.use("/api/subscribe", subscriptionRoutes);
app.use("/api", twitterRoutes);
app.use(tokenSaleRoutes); // mounts /token-sale/contribute (if present)

// --- History APIs (XP + quest history) ---
app.use(historyRoutes); // /api/xp/history, /api/quests/history

// --- Health checks ---
app.get("/", (_req, res) => res.send("7goldencowries backend is running"));
app.get("/healthz", async (_req, res) => {
  try {
    await db.get("SELECT 1 AS ok");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: "db" });
  }
});
app.get("/session-debug", (req, res) => res.json({ session: req.session }));

// --- Leaderboard (frontend expects /api/leaderboard) ---
app.get("/api/leaderboard", async (_req, res) => {
  try {
    const users = await db.all(
      `
      SELECT wallet, twitterHandle, xp, tier
      FROM users
      ORDER BY xp DESC
      LIMIT 20
    `
    );

    const ranked = users.map((u, i) => {
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
        progress: level?.progress || 0, // 0..1 (frontend multiplies to %)
        badge: `/images/badges/${badgeSlug}`,
      };
    });

    res.json({ top: ranked });
  } catch (err) {
    console.error("Leaderboard error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Daily subscription expiry cron ---
cron.schedule("0 0 * * *", async () => {
  console.log("🔄 Running daily subscription expiry check…");
  const now = dayjs().toISOString();

  try {
    const expired = await db.all(
      `
      SELECT id, wallet
      FROM subscriptions
      WHERE status = 'active'
        AND datetime(timestamp, '+30 days') <= ?
    `,
      now
    );

    for (const { id, wallet } of expired) {
      await db.run(`UPDATE users SET tier = 'Free' WHERE wallet = ?`, wallet);
      await db.run(`UPDATE subscriptions SET status = 'expired' WHERE id = ?`, id);
      console.log(` → Downgraded ${wallet}, sub#${id}`);
    }
  } catch (err) {
    console.error("❌ Cron error:", err);
  }
});

// --- CORS error handler (nice dev feedback) ---
app.use((err, _req, res, _next) => {
  if (err && String(err.message || "").startsWith("CORS blocked for origin:")) {
    return res.status(401).json({ error: err.message, allowed: ALLOWED });
  }
  return res.status(500).json({ error: "Server error" });
});

// --- Start server ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log("Allowed CORS origins:", ALLOWED.join(", "));
});
