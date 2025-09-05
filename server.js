import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import session from "express-session";
import connectSqlite3 from "connect-sqlite3";
import fs from "fs";

import metaRoutes from "./routes/metaRoutes.js";
import questRoutes from "./routes/questRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";
import leaderboardRoutes from "./routes/leaderboardRoutes.js";

dotenv.config();

const app = express();
app.set("trust proxy", 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

const allowedOrigins = [
  "https://7goldencowries.com",
  "https://www.7goldencowries.com",
  "https://7goldencowries-frontend.vercel.app",
];

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("CORS blocked"), false);
  },
  credentials: true,
}));

app.use(express.json());

const limiter = rateLimit({ windowMs: 60 * 1000, max: 200 });
app.use(limiter);

const SQLiteStore = connectSqlite3(session);
fs.mkdirSync("/var/data", { recursive: true });
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: "/var/data" }),
  secret: process.env.SESSION_SECRET || "changeme",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.use(metaRoutes);
app.use(questRoutes);
app.use(userRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/leaderboard", leaderboardRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
});
