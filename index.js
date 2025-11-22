import compatApi from "./routes/compat-api.js";

console.log(
  "[PRD] v1.2 → https://github.com/7cowries/7goldencowries-backend/blob/main/README_PRD.md"
);

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
import db from "./lib/db.js";

// Core routes
import questRoutes from "./routes/questRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import verifyRoutes from "./routes/verifyRoutes.js";
import tonWebhook from "./routes/tonWebhook.js";
import referralRoutes from "./routes/referralRoutes.js";
import refRedirectRoutes from "./routes/refRedirectRoutes.js";
import subscriptionRoutes from "./routes/subscriptionRoutes.js";
import twitterRoutes from "./routes/twitterRoutes.js";
import telegramRoutes from "./routes/telegramRoutes.js";
import tokenSaleRoutes from "./routes/tokenSaleRoutes.js";

// New quest/social helpers
import questLinkRoutes from "./routes/questLinkRoutes.js";
import questTelegramRoutes from "./routes/questTelegramRoutes.js";
import questDiscordRoutes from "./routes/questDiscordRoutes.js";
import socialLinkRoutes from "./routes/socialLinkRoutes.js";
import proofRoutes from "./routes/proofRoutes.js";

// Health + API v1
import healthRoutes from "./routes/healthRoutes.js";
import apiV1Routes from "./routes/apiV1/index.js";
import { startTokenSaleSession } from "./routes/apiV1/tokenSaleRoutes.js";

// History + leaderboard
import historyRoutes from "./routes/historyRoutes.js";
import leaderboardRoutes from "./routes/leaderboardRoutes.js";

dotenv.config();

const app = express();
const PROD = process.env.NODE_ENV === "production";
const DEFAULT_FRONTEND = "http://localhost:3000";

// FRONTEND_URL can be comma-separated (Vercel prod + previews)
const ALLOWED = (process.env.FRONTEND_URL || DEFAULT_FRONTEND)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Trust Render / proxies so secure cookies & req.protocol work
app.set("trust proxy", 1);

// --- Security headers ---
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
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
const captureRawBody = (req, _res, buf) => {
  if (buf?.length) {
    req.rawBody = buf;
  }
};

app.use(express.json({ verify: captureRawBody }));
app.use(express.urlencoded({ extended: false, verify: captureRawBody }));
app.use(cookieParser());

// --- Sessions (popup-friendly cookies) ---
const Store = MemoryStore(session);
app.use(
  session({
    name: process.env.SESSION_NAME || "7gc.sid",
    secret: process.env.SESSION_SECRET || "cowrie-secret",
    resave: false,
    saveUninitialized: true,
    store: new Store({ checkPeriod: 86400000 }), // 24h
    cookie: {
      httpOnly: true,
      secure: PROD,
      sameSite: PROD ? "none" : "lax",
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

// --- Session helpers used by frontend + tests ---
app.post("/api/session/bind-wallet", async (req, res) => {
  try {
    const wallet = String(req.body?.wallet || req.body?.address || "").trim();
    if (!wallet) return res.status(400).json({ ok: false, error: "wallet_required" });

    await db.run(
      `INSERT OR IGNORE INTO users (wallet, xp, tier, levelName, levelSymbol, levelProgress, nextXP, socials, updatedAt)
       VALUES (?, 0, 'Free', 'Shellborn', '🐚', 0, 10000, '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      wallet
    );
    req.session.wallet = wallet;
    res.json({ ok: true, wallet });
  } catch (err) {
    console.error("bind-wallet error", err);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.post("/api/session/disconnect", (req, res) => {
  if (req.session) {
    req.session.wallet = null;
    req.session.userId = null;
    req.session.referral_code = null;
  }
  res.json({ ok: true });
});

// --- Auth routes (order matters for popups / callbacks) ---
app.use(telegramRoutes); // /auth/telegram/*
app.use(authRoutes); // /auth/twitter, /auth/discord, etc.

// --- Secure quest + social routes ---
app.use(questLinkRoutes); // /api/quests/:id/link/start, /r/:nonce, /finish
app.use(questTelegramRoutes); // /api/quests/telegram/join/verify
app.use(questDiscordRoutes); // /api/quests/discord/join/verify
app.use(socialLinkRoutes); // /api/social/:provider/unlink|resync

// --- Existing app APIs ---
app.use(questRoutes);
app.use(userRoutes);
app.use(verifyRoutes);
app.use(tonWebhook);
app.get("/quests", (_req, res) => res.redirect(307, "/api/quests"));
app.use(referralRoutes);
app.use(refRedirectRoutes);
app.use("/api/proofs", proofRoutes);

// Legacy mount; /api/subscribe/* used by some old flows
app.use("/api/subscribe", subscriptionRoutes);

// Twitter API wrapper under /api/*
app.use("/api", twitterRoutes);

// Token sale routes (if present)
app.use(tokenSaleRoutes);
app.post("/api/token-sale/start", startTokenSaleSession);

// API v1 surface
app.use("/api/v1", apiV1Routes);

// History APIs (XP + quest history)
app.use(historyRoutes);
app.use("/api/leaderboard", leaderboardRoutes);

// --- Health checks ---
app.use(healthRoutes);
app.get("/", (_req, res) => res.send("7goldencowries backend is running"));

app.get("/session-debug", (req, res) =>
  res.json({ session: req.session || null })
);

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
      await db.run(
        `UPDATE users SET tier = 'Free', updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE wallet = ?`,
        wallet
      );
      await db.run(
        `UPDATE subscriptions SET status = 'expired' WHERE id = ?`,
        id
      );
      console.log(` → Downgraded ${wallet}, sub#${id}`);
    }
  } catch (err) {
    console.error("❌ Cron error:", err);
  }
});

// === Legacy compatibility routes ===
app.get("/api/user/me", (req, res) => res.redirect(307, "/api/me"));
app.get("/api/user/quests", (req, res) => res.redirect(307, "/api/quests"));
app.get("/api/user/leaderboard", (req, res) =>
  res.redirect(307, "/api/leaderboard")
);

// Old frontend payments status -> canonical /subscriptions/status
app.get("/api/v1/payments/status", (req, res) =>
  res.redirect(307, "/subscriptions/status")
);

// Mount compat API under /api (includes /api/me, /api/session, etc.)
app.use("/api", compatApi);

// --- Error handler (keep LAST before listen) ---
app.use((err, _req, res, _next) => {
  if (err && String(err.message || "").startsWith("CORS blocked for origin:")) {
    return res.status(401).json({ error: err.message, allowed: ALLOWED });
  }
  console.error("Unhandled error:", err);
  return res.status(500).json({ error: "Server error" });
});

// --- Start server ---
if (process.env.NODE_ENV !== "test") {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log("Allowed CORS origins:", ALLOWED.join(", "));
  });
}

export default app;
