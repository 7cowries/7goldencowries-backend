// server.js — resilient Express setup for 7goldencowries backend
import "dotenv/config.js";
import express from "express";
import cors from "cors";
import session from "express-session";
import passport from "passport";
import "./passportConfig.js";

// Importing db initializes tables (top-level await in db.js)
import db from "./db.js";

// ---- ENV & APP ----
const app = express();
const PORT = process.env.PORT || 5000;
const CLIENT_URL =
  process.env.CLIENT_URL || process.env.FRONTEND_URL || "http://localhost:3000";

// ---- MIDDLEWARE ----
app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // needed for Telegram fallback form

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60, // 1 hour
      httpOnly: true,
      secure: false,
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// ---- HEALTHCHECK ----
app.get("/health", (_req, res) => res.json({ ok: true }));

// ---- ROUTES ----
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

// ---- MOUNT ----
app.use("/", authRoutes);
if (questRoutes) app.use("/", questRoutes);
if (questsRoutes) app.use("/", questsRoutes);
if (leaderboardRoutes) app.use("/", leaderboardRoutes);

app.use("/api/profile", profileRoutes);

// ---- START ----
app.listen(PORT, () => {
  console.log(`✅  7goldencowries backend running on http://localhost:${PORT}`);
  console.log(`   CORS allowed: ${CLIENT_URL}`);
});
