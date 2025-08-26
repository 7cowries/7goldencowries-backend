// server.js — resilient Express setup for 7goldencowries backend
import "dotenv/config"; // loads .env
import express from "express";
import cors from "cors";
import cookieSession from "cookie-session"; // ⬅️ replace express-session
import passport from "passport";
import "./passportConfig.js";

// Importing db initializes tables (top-level await in db.js)
import db from "./db.js";

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
  ...splitEnvList(process.env.ALLOWED_ORIGINS),
  vercelUrl,
].filter(Boolean);

const ALLOWED_ORIGINS = [...new Set([...baseAllowed, ...envAllowed])];

// On Render/behind proxy we need this so secure cookies work
if (process.env.RENDER || process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

/* =========================
   MIDDLEWARE
   ========================= */
const corsOptions = {
  origin(origin, cb) {
    // allow same-origin requests, curl, health checks (no Origin)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // preflight

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Telegram fallback forms, etc.

// Cookie-based session (no MemoryStore warning, works with Passport)
const isProd = process.env.NODE_ENV === "production";
app.use(
  cookieSession({
    name: "7gc.sid",
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    maxAge: 1000 * 60 * 60, // 1 hour
    httpOnly: true,
    secure: !!isProd,                   // requires HTTPS in prod
    sameSite: isProd ? "none" : "lax",  // "none" for cross-site with secure cookies
  })
);

app.use(passport.initialize());
app.use(passport.session());

/* =========================
   HEALTH & ROOT
   ========================= */
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/", (_req, res) => {
  res.send("7goldencowries backend is running 🚀");
});

/* =========================
   ROUTES (your existing modules)
   ========================= */
import profileRoutes from "./routes/profileRoutes.js"; // /api/profile
import authRoutes from "./routes/authRoutes.js";       // /auth/*

let questRoutes = null;
let questsRoutes = null;
let leaderboardRoutes = null;

try {
  const mod = await import("./routes/questRoutes.js"); // singular
  questRoutes = mod.default;
  console.log("➡️  Loaded routes/questRoutes.js");
} catch {}

if (!questRoutes) {
  try {
    const mod = await import("./routes/questsRoutes.js"); // plural fallback
    questsRoutes = mod.default;
    console.log("➡️  Loaded routes/questsRoutes.js");
  } catch {}
}

try {
  const mod = await import("./routes/leaderboardRoutes.js");
  leaderboardRoutes = mod.default;
  console.log("➡️  Loaded routes/leaderboardRoutes.js");
} catch {
  console.log("ℹ️  No routes/leaderboardRoutes.js (skipping leaderboard mount)");
}

/* =========================
   MOUNT
   ========================= */
app.use("/", authRoutes);
if (questRoutes) app.use("/", questRoutes);
if (questsRoutes) app.use("/", questsRoutes);
if (leaderboardRoutes) app.use("/", leaderboardRoutes);
app.use("/api/profile", profileRoutes);

/* =========================
   404 + ERROR HANDLERS
   ========================= */
app.use((req, res, next) => {
  if (req.path === "/favicon.ico") return res.sendStatus(204);
  res.status(404).json({ error: "Not Found" });
});

app.use((err, _req, res, _next) => {
  console.error("❌ Server error:", err?.message || err);
  const code = err.status || 500;
  res.status(code).json({ error: err?.message || "Server error" });
});

/* =========================
   START
   ========================= */
app.listen(PORT, () => {
  console.log(`✅  7goldencowries backend on :${PORT}`);
  console.log(`   CORS allowed origins:`, ALLOWED_ORIGINS.join(", "));
});
