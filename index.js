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
import canonicalRouters from "./routes/routerList.js";
import { startTokenSaleSession } from "./routes/apiV1/tokenSaleRoutes.js";
import { migrateOnBoot } from "./scripts/migrate-on-boot.mjs";

dotenv.config();

const DEFAULT_DB_PATH = "/var/data/7gc.sqlite3";
const DB_PATH = process.env.SQLITE_FILE || process.env.DATABASE_URL || DEFAULT_DB_PATH;
process.env.DATABASE_URL ||= DB_PATH;
process.env.SQLITE_FILE ||= DB_PATH;
await migrateOnBoot(DB_PATH);

const app = express();
const PROD = process.env.NODE_ENV === "production";
const IS_TEST = process.env.NODE_ENV === "test";
const DEFAULT_FRONTEND = "https://7goldencowries.com";
const STATIC_ALLOWED = ["https://7goldencowries.com"];
const SESSION_DOMAIN = process.env.SESSION_DOMAIN || (PROD ? "7goldencowries.com" : undefined);
const SESSION_SECURE = process.env.SESSION_SECURE
  ? String(process.env.SESSION_SECURE).toLowerCase() === "true"
  : PROD && !IS_TEST;
const SESSION_SAMESITE = PROD && !IS_TEST ? "none" : "lax";

// FRONTEND_URL can be comma-separated (Vercel prod + previews)
const ALLOWED = Array.from(
  new Set(
    (process.env.FRONTEND_URL || DEFAULT_FRONTEND)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .concat(STATIC_ALLOWED)
  )
);
const ALLOWED_PATTERNS = [/^https:\/\/[a-z0-9-]+\.vercel\.app$/i];

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
      if (ALLOWED_PATTERNS.some((re) => re.test(origin)))
        return callback(null, true);
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
      secure: SESSION_SECURE,
      sameSite: SESSION_SAMESITE,
      domain: SESSION_DOMAIN,
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

// --- Route mounting (canonical list only) ---
for (const { path, router } of canonicalRouters) {
  if (path) {
    app.use(path, router);
  } else {
    app.use(router);
  }
}

// Token sale routes (if present)
app.post("/api/token-sale/start", startTokenSaleSession);

app.get("/", (_req, res) => res.send("7goldencowries backend is running"));

app.get("/session-debug", (req, res) =>
  res.json({ session: req.session || null })
);

// --- Daily subscription expiry cron ---
if (!IS_TEST) {
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
}

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
