import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import session from "express-session";
import MemoryStore from "memorystore";
import morgan from "morgan";
import db from "./db.js";
import { ensureQuestsSchema } from "./lib/ensureQuestsSchema.js";
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

dotenv.config();

const app = express();
app.set("trust proxy", 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

const origins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const originCheck = (origin, cb) => {
  if (!origin) return cb(null, true);
  const ok = origins.some((o) => {
    if (o.includes("*")) {
      const re = new RegExp("^" + o.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
      return re.test(origin);
    }
    return o === origin;
  });
  cb(null, ok);
};
app.use(cors({ origin: originCheck, credentials: true }));
app.options("*", cors({ origin: originCheck, credentials: true }));

app.use(express.json());
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

const MemStore = MemoryStore(session);
app.use(
  session({
    name: process.env.COOKIE_NAME || "7gc.sid",
    secret: process.env.SESSION_SECRET || "change-me",
    resave: false,
    saveUninitialized: false,
    store: new MemStore({ checkPeriod: 864e5 }),
    cookie: {
      httpOnly: true,
      sameSite: "none",
      secure: true,
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

// --- users table migration (idempotent) ---
async function hasTable(name) {
  const row = await db.get(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    name
  );
  return !!row;
}

async function columnMap(table) {
  const cols = await db.all(`PRAGMA table_info(${table})`);
  return new Set(cols.map((c) => c.name));
}

async function addColumnIfMissing(table, column, defSql) {
  const cols = await columnMap(table);
  if (!cols.has(column)) {
    console.log(`Migration: adding ${table}.${column}`);
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${defSql}`);
  }
}

if (!(await hasTable("users"))) {
  await db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT UNIQUE,
      xp INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1,
      levelName TEXT DEFAULT 'Shellborn',
      levelProgress REAL DEFAULT 0,
      twitter_username TEXT,
      twitter_id TEXT,
      telegram_username TEXT,
      discord_username TEXT,
      discord_id TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    );
  `);
} else {
  await addColumnIfMissing("users", "xp", "xp INTEGER DEFAULT 0");
  await addColumnIfMissing("users", "level", "level INTEGER DEFAULT 1");
  await addColumnIfMissing(
    "users",
    "levelName",
    "levelName TEXT DEFAULT 'Shellborn'"
  );
  await addColumnIfMissing(
    "users",
    "levelProgress",
    "levelProgress REAL DEFAULT 0"
  );
  await addColumnIfMissing("users", "twitter_username", "twitter_username TEXT");
  await addColumnIfMissing("users", "twitter_id", "twitter_id TEXT");
  await addColumnIfMissing(
    "users",
    "telegram_username",
    "telegram_username TEXT"
  );
  await addColumnIfMissing("users", "discord_username", "discord_username TEXT");
  await addColumnIfMissing("users", "discord_id", "discord_id TEXT");
  // createdAt/updatedAt must be added without defaults, then backfilled
  await addColumnIfMissing("users", "createdAt", "createdAt TEXT");
  await addColumnIfMissing("users", "updatedAt", "updatedAt TEXT");
  await db.exec(`
    UPDATE users SET xp = COALESCE(xp, 0);
    UPDATE users SET level = COALESCE(level, 1);
    UPDATE users SET levelName = COALESCE(levelName, 'Shellborn');
    UPDATE users SET levelProgress = COALESCE(levelProgress, 0);
    UPDATE users SET createdAt = COALESCE(createdAt, datetime('now'));
    UPDATE users SET updatedAt = COALESCE(updatedAt, datetime('now'));
  `);
}

await ensureQuestsSchema();

app.use(metaRoutes);
app.use(questRoutes);
app.use("/api/users", usersRoutes);
app.use(userRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/referrals", referralRoutes);
app.use("/api/admin/referrals", referralAdminRoutes);
app.use("/api/session", sessionRoutes);
app.use("/auth", socialRoutes);
app.use("/api/admin", adminRoutes);

// temporary; keep until clients migrate
app.get("/quests", (_req, res) => res.redirect(307, "/api/quests"));
app.post("/complete", (req, res) => res.redirect(307, "/api/quests/claim"));

// generic error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
});
