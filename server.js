import express from "express";
import fs from "fs";
import path from "path";
import winston from "winston";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import session from "express-session";
import MemoryStore from "memorystore";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import db from "./lib/db.js";
import { ensureQuestsSchema } from "./lib/ensureQuestsSchema.js";
import { ensureUsersSchema } from "./db/migrateUsers.js";
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
import runSqliteMigrations from "./db/migrateProofs.js";
import proofRoutes from "./routes/proofRoutes.js";
import healthRoutes from "./routes/healthRoutes.js";
import refRedirectRoutes from "./routes/refRedirectRoutes.js";
import tonVerifyRoutes from "./routes/tonVerifyRoutes.js";
import authStartRoutes from "./routes/authStartRoutes.js";
import referralLookupRoutes from "./routes/referralLookupRoutes.js";
import apiV1Routes from "./routes/apiV1/index.js";

dotenv.config();
const logger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()], format: winston.format.combine(winston.format.timestamp(), winston.format.simple()) });


const app = express();
app.set("trust proxy", 1);
app.set("etag", false);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

const defaultOrigins = [
  "https://7goldencowries.com",
  "https://www.7goldencowries.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];
const origins = Array.from(
  new Set([
    ...defaultOrigins,
    ...(process.env.FRONTEND_URL || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    ...(process.env.CORS_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ])
).filter(Boolean);
const originCheck = (origin, cb) => {
  if (!origin) return cb(null, true);
  const ok = origins.some((o) => {
    if (o.includes("*")) {
      const re = new RegExp("^" + o.replace(/\./g, "\.").replace(/\*/g, ".*") + "$");
      return re.test(origin);
    }
    return o === origin;
  });
  if (!ok) logger.warn(`CORS blocked: ${origin}`);
  cb(null, ok);
};

app.use(cors({ origin: originCheck, credentials: true }));
app.options("*", cors({ origin: originCheck, credentials: true }));

app.use(cookieParser());

const rawBodySaver = (req, _res, buf) => {
  if (buf?.length) {
    req.rawBody = buf.toString("utf8");
  }
};

app.use(
  express.json({
    verify: rawBodySaver,
    limit: "2mb",
  })
);
app.use(
  express.urlencoded({
    verify: rawBodySaver,
    limit: "2mb",
    extended: true,
  })
);
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
morgan.token("uid", (req) => req.user?.id || req.session?.userId || "anon");
const morganOpts = {
  skip: (req, res) =>
    req.method === "GET" && req.path === "/api/users/me" && res.statusCode < 400,
};
app.use(
  morgan(
    ":method :url :status :res[content-length] - :response-time ms uid=:uid",
    morganOpts
  )
);

const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

const claimLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
}); // prevent bulk claiming abuse
app.use("/api/quests/claim", claimLimiter);

const SESSION_DIR = process.env.SESSIONS_DIR || "/var/data";
try { fs.mkdirSync(SESSION_DIR, { recursive: true }); } catch (e) { logger.error("Session dir creation failed", e); }
const MemStore = MemoryStore(session);
const store = new MemStore({ checkPeriod: 864e5, path: SESSION_DIR });
store.on("error", (err) => logger.error("Session store error", err));
app.use(
  session({
    name: process.env.COOKIE_NAME || "7gc.sid",
    secret: process.env.SESSION_SECRET || "change-me",
    resave: false,
    saveUninitialized: false,
    store,
    cookie: {
      httpOnly: true,
      sameSite: "none",
      secure: process.env.NODE_ENV !== "test",
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  })
);

// expose session wallet as req.user.wallet for convenience
app.use((req, _res, next) => {
  if (req.session?.wallet && !req.user) {
    req.user = { wallet: req.session.wallet };
  }
  next();
});

async function ensureSchema() {
  try {
    await ensureUsersSchema(db);
  } catch (e) {
    console.error('ensureUsersSchema failed', e);
    throw e;
  }
  try {
    await ensureQuestsSchema();
  } catch (e) {
    console.error('ensureQuestsSchema failed', e);
    throw e;
  }
  try {
    await runSqliteMigrations();
  } catch (e) {
    console.error('runSqliteMigrations failed', e);
    throw e;
  }
}

await ensureSchema();

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
app.use("/api/auth", authStartRoutes);
app.use("/auth", socialRoutes);
app.use("/api/admin", adminRoutes);
app.use("/referrals", referralLookupRoutes);
app.use(tonVerifyRoutes);
app.use(healthRoutes);
app.use(refRedirectRoutes);

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  process.env.CLIENT_URL ||
  "https://7goldencowries.com";

// temporary; keep until clients migrate
app.get("/quests", (_req, res) => res.redirect(307, "/api/quests"));
app.post("/complete", (req, res) => res.redirect(307, "/api/quests/claim"));

// generic error handler
app.use((err, _req, res, _next) => {
  logger.error(err);
  res.status(500).json({ error: "Internal error" });
});
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Listening on ${PORT}`);
  });
}
export default app;
