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
import db from "./db.js";
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
import runSqliteMigrations from "./db/migrateProofs.js";
import proofRoutes from "./routes/proofRoutes.js";
import healthRoutes from "./routes/healthRoutes.js";

dotenv.config();
const logger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()], format: winston.format.combine(winston.format.timestamp(), winston.format.simple()) });


const app = express();
app.set("trust proxy", 1);
app.set("etag", false);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

const origins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
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

app.use(express.json());
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
morgan.token("uid", (req) => req.user?.id || req.session?.userId || "anon");
app.use(morgan(":method :url :status :res[content-length] - :response-time ms uid=:uid"));

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

app.get("/healthz", async (_req, res) => {
  try {
    await db.exec(
      "BEGIN; CREATE TABLE IF NOT EXISTS __health (id INTEGER); DELETE FROM __health; INSERT INTO __health (id) VALUES (1); DELETE FROM __health; COMMIT;"
    );
    res.json({ ok: true, db: "rw" });
  } catch (e) {
    res.status(500).json({ ok: false, db: "error" });
  }
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
app.use(healthRoutes);

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  process.env.CLIENT_URL ||
  "https://7goldencowries.com";

app.get("/referrals/:code", (req, res) => {
  const { code } = req.params;
  res.redirect(302, `${FRONTEND_URL}/?ref=${encodeURIComponent(code)}`);
});

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
