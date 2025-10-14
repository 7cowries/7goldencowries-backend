import sessionRouter from "./src/routes/walletSession.js";
import cookieParser from "cookie-parser";
import cors from 'cors';
/* Auto-run migrations on startup (ESM/CJS compatible wrapper).
   - If running under CommonJS, attempt require('./scripts/run-migrations.cjs')
   - Otherwise spawn a child Node process to execute the CJS script.
   This avoids `require is not defined` in ESM environments.
*/
(async () => {
  try {
    // If require exists (CJS environment), use it.
    if (typeof require === 'function') {
      try {
        require('./scripts/run-migrations.cjs');
        console.log('[migrations] run-migrations.cjs required via CJS');
      } catch (e) {
        console.warn('[migrations] require(./scripts/run-migrations.cjs) failed:', e && e.message);
      }
      return;
    }

    // ESM runtime: spawn a child Node process to run the CJS migration script
    try {
      // dynamic import of child_process
      const { spawn } = await import('node:child_process');
      const nodeBin = process.execPath;
      // convert relative path to absolute using import.meta.url
      const scriptPath = new URL('./scripts/run-migrations.cjs', import.meta.url).pathname;
      console.log('[migrations] running migration child:', nodeBin, scriptPath);
      const child = spawn(nodeBin, [scriptPath], { stdio: 'inherit' });
      child.on('error', (err) => console.warn('[migrations] child process error:', err && err.message));
      child.on('exit', (code, signal) => console.log('[migrations] child exited with code', code, 'signal', signal));
    } catch (err2) {
      console.warn('[migrations] ESM spawn/import failed:', err2 && err2.message);
    }
  } catch (outerErr) {
    console.warn('[migrations] migration wrapper failed:', outerErr && outerErr.message);
  }
})();
/* This is idempotent — if the migrations script has already run it will exit quickly. */
// server.js
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import winston from "winston";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import session from "express-session";
import MemoryStore from "memorystore";
import morgan from "morgan";

import db from "./lib/db.js";
import { ensureQuestsSchema } from "./lib/ensureQuestsSchema.js";
import { ensureUsersSchema } from "./db/migrateUsers.js";
import runSqliteMigrations from "./db/migrateProofs.js";

// Routes
import metaRoutes from "./routes/metaRoutes.js";
import questRoutes from "./routes/questRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";
import leaderboardRoutes from "./routes/leaderboardRoutes.js";
import referralRoutes, { admin as referralAdminRoutes } from "./routes/referralRoutes.js";
import sessionRoutes from "./routes/sessionRoutes.js";
import usersRoutes from "./routes/usersRoutes.js";
import socialRoutes from "./routes/socialRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import questTelegramRoutes from "./routes/questTelegramRoutes.js";
import questDiscordRoutes from "./routes/questDiscordRoutes.js";
import proofRoutes from "./routes/proofRoutes.js";
import healthRoutes from "./routes/healthRoutes.js";
import refRedirectRoutes from "./routes/refRedirectRoutes.js";
import tonVerifyRoutes from "./routes/tonVerifyRoutes.js";
import authStartRoutes from "./routes/authStartRoutes.js";
import referralLookupRoutes from "./routes/referralLookupRoutes.js";
import apiV1Routes from "./routes/apiV1/index.js";
import socialApiRoutes from "./routes/socialApiRoutes.js";

dotenv.config();

const logger = winston.createLogger({
  level: "info",
  transports: [new winston.transports.Console()],
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.simple()
  ),
});

const app = express();
app.use(cookieParser());
app.set('trust proxy', 1);
app.set("trust proxy", 1);
app.set("etag", false);

// Security headers
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// Raw body saver
const rawBodySaver = (req, _res, buf) => {
  if (buf?.length) req.rawBody = buf;
};

// Body parsers
app.use(express.json({ limit: "1mb", verify: rawBodySaver }));
app.use(express.urlencoded({ extended: true, limit: "1mb", verify: rawBodySaver }));
app.use(express.raw({ type: "application/octet-stream", limit: "2mb", verify: rawBodySaver }));
app.use(express.text({ type: "text/*", limit: "2mb", verify: rawBodySaver }));

/* ---------------- CORS CONFIG ---------------- */
const DEV_CORS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function parseOrigins(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, "")) // normalize trailing slashes
    .filter(Boolean);
}

const PROD_CORS = [
  "https://7goldencowries.com",
  "https://www.7goldencowries.com",
];

const corsAllowlist = Array.from(
  new Set([
    ...DEV_CORS,
    ...PROD_CORS,
    ...parseOrigins(process.env.FRONTEND_URL),
    ...parseOrigins(process.env.CLIENT_URL),
    ...parseOrigins(process.env.CORS_ORIGINS),
  ])
);

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true); // SSR / curl
    const normalized = origin.replace(/\/+$/, "");
    const ok = corsAllowlist.includes(normalized);
    return callback(null, ok || false);
  },
  credentials: true,
};

app.use(cors(corsOptions));

app.options("*", cors(corsOptions));
/* ---------------- END CORS CONFIG ---------------- */


// No caching
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// Logging
morgan.token("uid", (req) => req.user?.id || req.session?.userId || "anon");
app.use(morgan(":method :url :status :res[content-length] - :response-time ms uid=:uid", {
  skip: (req, res) => req.method === "GET" && req.path === "/api/users/me" && res.statusCode < 400,
}));

// Rate limits
app.use(rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false }));
app.use("/api/quests/claim", rateLimit({ windowMs: 60_000, max: 30 }));

// Session setup
const SESSION_DIR = process.env.SESSIONS_DIR || "/var/data";
const isProd = process.env.NODE_ENV === "production";
try { fs.mkdirSync(SESSION_DIR, { recursive: true }); } catch (e) { logger.error("Session dir creation failed", e); }

const MemStore = MemoryStore(session);
const store = new MemStore({ checkPeriod: 864e5, path: SESSION_DIR });
store.on("error", (err) => logger.error("Session store error", err));

function resolveSecureCookieFlag() {
  const flag = process.env.COOKIE_SECURE;
  if (typeof flag === "string") {
    const normalized = flag.trim().toLowerCase();
    if (["1", "true", "yes"].includes(normalized)) return true;
    if (["0", "false", "no"].includes(normalized)) return false;
  }
  return isProd;
}

function buildSessionCookieOptions() {
  const secure = resolveSecureCookieFlag();
  return {
    httpOnly: true,
    sameSite: secure ? "none" : "lax",
    secure,
    maxAge: 1000 * 60 * 60 * 24 * 30,
  };
}

app.use(session({
  name: process.env.COOKIE_NAME || "7gc.sid",
  secret: process.env.SESSION_SECRET || "change-me",
  resave: false,
  saveUninitialized: false,
  store,
  cookie: buildSessionCookieOptions(),
}));

// Session wallet convenience
app.use((req, _res, next) => {
  if (req.session?.wallet && !req.user) {
    req.user = { wallet: req.session.wallet };
  }
  next();
});

// Ensure DB schemas
await (async function ensureSchema() {
  await ensureUsersSchema(db);
  await ensureQuestsSchema();
  await runSqliteMigrations();
})();

// Routes
app.use("/api/v1", apiV1Routes);
app.use(metaRoutes);
app.use(questRoutes);
app.use(questTelegramRoutes);
app.use(questDiscordRoutes);
app.use("/api/proofs", proofRoutes);
app.use("/api/users", usersRoutes);
app.use(userRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/referrals", referralRoutes);
app.use("/api/admin/referrals", referralAdminRoutes);
app.use("/api/session", sessionRoutes);
app.use("/api/social", socialApiRoutes);
app.use("/api/auth", authStartRoutes);
app.use("/auth", socialRoutes);
app.use("/api/admin", adminRoutes);
app.use("/referrals", referralLookupRoutes);
app.use(tonVerifyRoutes);
app.use(healthRoutes);
app.use(refRedirectRoutes);

// Service root
app.get("/", (_req, res) => {
  res.json({
    service: "7goldencowries-backend",
    banner: "7goldencowries Render API ready",
    routes: {
      health: "/healthz",
      apiHealth: "/api/health",
      paymentsStatus: "/api/v1/payments/status",
      subscriptionStatus: "/api/v1/subscription/status",
    },
  });
});

// Temporary redirects
app.get("/quests", (_req, res) => res.redirect(307, "/api/quests"));
app.post("/complete", (req, res) => res.redirect(307, "/api/quests/claim"));

// Error handler
app.use((err, _req, res, _next) => {
  logger.error(err);
  res.status(500).json({ error: "Internal error" });
});

const port = process.env.PORT || 4000;
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentPath = fileURLToPath(import.meta.url);

if (entryPath && entryPath === currentPath) {
app.use('/api', sessionRouter);
app.use(["/api", "/"], sessionRoutes);
  app.listen(port, () => {
    logger.info(`API listening on ${port}`);
  });
}

export default app;

// register placeholder auth routes (auto-added)
import registerAuthPlaceholders from './routes/auth-placeholders.js';
registerAuthPlaceholders(app);
