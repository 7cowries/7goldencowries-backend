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
