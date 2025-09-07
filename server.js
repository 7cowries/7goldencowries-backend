import express from "express";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import session from "express-session";
import MemoryStore from "memorystore";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import connectRedis from "connect-redis";
import { createClient } from "redis";
import db from "./db.js";
import logger from "./lib/logger.js";
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

dotenv.config();


const app = express();
app.set("trust proxy", 1);
app.set("etag", false);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

function buildCorsOptions() {
  const list = [];
  if (process.env.FRONTEND_URL) list.push(process.env.FRONTEND_URL);
  if (process.env.NODE_ENV !== "production") {
    list.push("http://localhost:3000", "http://localhost:5173");
  }
  return {
    origin(origin, cb) {
      if (!origin || list.includes(origin)) return cb(null, true);
      logger.warn({ msg: "CORS blocked", origin });
      return cb(null, false);
    },
    credentials: true,
  };
}
const corsOptions = buildCorsOptions();
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(cookieParser());

app.use(express.json());
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
morgan.token("uid", (req) => req.user?.id || req.session?.userId || "anon");
app.use(
  morgan(function (tokens, req, res) {
    return JSON.stringify({
      method: tokens.method(req, res),
      url: tokens.url(req, res),
      status: Number(tokens.status(req, res)),
      length: tokens.res(req, res, "content-length"),
      responseTime: Number(tokens["response-time"](req, res)),
      uid: tokens.uid(req, res),
    });
  }, {
    stream: {
      write: (msg) => {
        try {
          logger.info(JSON.parse(msg));
        } catch {
          logger.info({ msg: msg.trim() });
        }
      },
    },
  })
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
let store;
if (process.env.REDIS_URL) {
  const RedisStore = connectRedis(session);
  const redisClient = createClient({ url: process.env.REDIS_URL });
  redisClient.on("error", (err) => logger.error("Redis error", err));
  await redisClient.connect();
  store = new RedisStore({ client: redisClient, prefix: process.env.SESSION_PREFIX || "sess:" });
} else {
  try { fs.mkdirSync(SESSION_DIR, { recursive: true }); } catch (e) { logger.error("Session dir creation failed", e); }
  const MemStore = MemoryStore(session);
  store = new MemStore({ checkPeriod: 864e5, path: SESSION_DIR });
  store.on("error", (err) => logger.error("Session store error", err));
}

const sessionSecret = process.env.SESSION_SECRET || (process.env.NODE_ENV === "test" ? "test-secret" : null);
if (!sessionSecret) throw new Error("SESSION_SECRET must be set");
const isProd = process.env.NODE_ENV === "production";
app.use(
  session({
    name: process.env.SESSION_NAME || "7gc.sid",
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store,
    cookie: {
      httpOnly: true,
      sameSite: isProd ? "none" : "lax",
      secure: isProd,
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
app.use("/auth", socialRoutes);
app.use("/api/admin", adminRoutes);
app.use(tonVerifyRoutes);
app.use(healthRoutes);
app.use(refRedirectRoutes);

const FRONTEND_URL = process.env.FRONTEND_URL || "https://7goldencowries.com";

app.get("/referrals/:code", (req, res) => {
  const { code } = req.params;
  res.redirect(302, `${FRONTEND_URL}/?ref=${encodeURIComponent(code)}`);
});

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
