// server.js — resilient Express setup for 7goldencowries backend
import "dotenv/config"; // loads .env
import express from "express";
import cors from "cors";
import cookieSession from "cookie-session";
import cookieParser from "cookie-parser"; // ✨ NEW: parse cookies for /debug
import passport from "passport";
import "./passportConfig.js";

// Importing db initializes tables (top-level await in db.js)
import db from "./db.js";

import helmet from "helmet";
import compression from "compression";

/* =========================
   ENV
   ========================= */
const app = express();
const PORT = process.env.PORT || 5000;

// Build an allowed-origins list (env may contain single or comma-separated)
function splitEnvList(v) {
  return (v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Derive Vercel URL from env if present
const vercelUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : null;

const baseAllowed = [
  "http://localhost:3000",
  "https://7goldencowries.vercel.app",
  "https://7goldencowries.com",
];

const envAllowed = [
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL,
  ...splitEnvList(process.env.ALLOWED_ORIGINS), // e.g. "https://site1,https://site2"
  vercelUrl,
].filter(Boolean);

const ALLOWED_ORIGINS = [...new Set([...baseAllowed, ...envAllowed])];

// Render / production: trust proxy so secure cookies & SameSite=None work
if (process.env.RENDER || process.env.NODE_ENV === "production") {
  app.set("trust proxy", "loopback, linklocal, uniquelocal");
}

/* =========================
   MIDDLEWARE
   ========================= */
const corsOptions = {
  origin(origin, cb) {
    // allow same-origin tools, curl, and no-Origin health checks
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    console.warn(`CORS blocked for origin: ${origin}`);
    return cb(Object.assign(new Error("CORS not allowed"), { status: 403 }));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // Preflight

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(compression());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // ✨ ensure req.cookies exists

const isProd = process.env.NODE_ENV === "production";
app.use(
  cookieSession({
    name: "7gc.sid",
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    maxAge: 1000 * 60 * 60 * 24, // 24h
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
  })
);

// Ensure session methods exist (some proxies strip them)
app.use((req, _res, next) => {
  if (req.session && !req.session.regenerate) req.session.regenerate = (cb) => cb();
  if (req.session && !req.session.save) req.session.save = (cb) => cb();
  next();
});

app.use(passport.initialize());
app.use(passport.session());

/* =========================
   HEALTH & ROOT
   ========================= */
app.get("/health", (_req, res) =>
  res.json({ ok: true, env: process.env.NODE_ENV })
);
app.get("/", (_req, res) => {
  res.send("7goldencowries backend is running 🚀");
});

// Debug endpoint to verify CORS/cookies/session
app.get("/debug/cors", (req, res) => {
  res.json({
    origin: req.get("origin"),
    allowedOrigins: ALLOWED_ORIGINS,
    cookies: req.cookies,
    sessionPresent: !!req.session,
  });
});

/* =========================
   ROUTES
   ========================= */
import profileRoutes from "./routes/profileRoutes.js";
import authRoutes from "./routes/authRoutes.js";

let questRoutes = null;
let questsRoutes = null;
let leaderboardRoutes = null;

try {
  const mod = await import("./routes/questRoutes.js"); // singular
  questRoutes = mod.default;
  console.log("➡️  Loaded routes/questRoutes.js");
} catch (e) {
  console.error("Failed to load questRoutes.js:", e.message);
}

if (!questRoutes) {
  try {
    const mod = await import("./routes/questsRoutes.js"); // plural fallback
    questsRoutes = mod.default;
    console.log("➡️  Loaded routes/questsRoutes.js");
  } catch (e) {
    console.error("Failed to load questsRoutes.js:", e.message);
  }
}

try {
  const mod = await import("./routes/leaderboardRoutes.js");
  leaderboardRoutes = mod.default;
  console.log("➡️  Loaded routes/leaderboardRoutes.js");
} catch (e) {
  console.error("Failed to load leaderboardRoutes.js:", e.message);
}

/* =========================
   MOUNT
   ========================= */
// IMPORTANT: If authRoutes defines paths beginning with '/auth/...',
// mount at '/' to avoid double '/auth/auth/...'
app.use("/", authRoutes);

if (questRoutes) app.use("/api/quest", questRoutes);
if (questsRoutes) app.use("/api/quests", questsRoutes);
if (leaderboardRoutes) app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/profile", profileRoutes);

/* =========================
   404 + ERROR HANDLERS
   ========================= */
app.use((req, res) => {
  if (req.path === "/favicon.ico") return res.sendStatus(204);
  console.warn(`404: ${req.method} ${req.path}`);
  res.status(404).json({ error: "Not Found" });
});

app.use((err, req, res, _next) => {
  console.error(`❌ Server error [${req.method} ${req.path}]:`, err.stack || err);
  const code = err.status || 500;
  res.status(code).json({ error: err.message || "Server error" });
});

/* =========================
   START
   ========================= */
app.listen(PORT, () => {
  console.log(`✅  7goldencowries backend on :${PORT}`);
  console.log(`   CORS allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
  console.log(`   Environment: ${process.env.NODE_ENV || "development"}`);
});
