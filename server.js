// server.js — 7 Golden Cowries backend (robust DB boot, no fallback)

// -------------------- imports --------------------
import express from "express";
import cors from "cors";
import session from "express-session";
import SQLiteStoreFactory from "connect-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

// -------------------- constants --------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Render gives us /var/data for persistent sqlite
const DB_CANDIDATES = [
  "/var/data/7gc.sqlite3",
  "/var/data/7gc.sqlite",
  "/var/data/7go.sqlite",
];

// pick the first that works, but we’ll migrate ALL of them
const PRIMARY_DB = DB_CANDIDATES[0];

const PORT = process.env.PORT || 10000;
const ORIGIN = process.env.CORS_ORIGIN || "*";

// -------------------- tiny sqlite helper --------------------
import sqlite3 from "sqlite3";
sqlite3.verbose();

function openDb(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) return reject(err);
      // WAL + FK
      db.serialize(() => {
        db.run("PRAGMA journal_mode=WAL;");
        db.run("PRAGMA foreign_keys=ON;");
      });
      console.log("[db] opened sqlite at", dbPath);
      resolve(db);
    });
  });
}

async function ensureSubscriptionsTable(db, label) {
  // create table if missing
  await new Promise((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wallet TEXT NOT NULL,
        tier TEXT NOT NULL DEFAULT 'Free',
        active INTEGER NOT NULL DEFAULT 0,
        provider TEXT,
        tx_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        timestamp TEXT
      );`,
      (err) => {
        if (err) return reject(err);
        console.log(`[migrate] subscriptions: base table ok @ ${label}`);
        resolve();
      }
    );
  });

  // make sure the 'active' column exists
  const cols = await new Promise((resolve, reject) => {
    db.all("PRAGMA table_info(subscriptions);", (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

  const hasActive = cols.some((c) => c.name === "active");
  if (!hasActive) {
    await new Promise((resolve, reject) => {
      db.run(
        "ALTER TABLE subscriptions ADD COLUMN active INTEGER NOT NULL DEFAULT 0;",
        (err) => {
          if (err) return reject(err);
          console.log(`[migrate] added missing 'active' column @ ${label}`);
          resolve();
        }
      );
    });
  }
}

async function runFullMigrations() {
  for (const p of DB_CANDIDATES) {
    try {
      const db = await openDb(p);
      await ensureSubscriptionsTable(db, p);
      db.close();
    } catch (e) {
      console.log("[migrate] skip", p, e.message);
    }
  }
  console.log("[migrate] ALL DBs ensured, continuing to start app ✅");
}

// -------------------- express app --------------------
async function start() {
  // 1) make sure DBs are good BEFORE express
  try {
    await runFullMigrations();
  } catch (e) {
    console.log("[migrate] fatal during startup", e);
    // even then, start — we don’t want Render to crash-loop
  }

  const app = express();
  app.use(express.json());

  // CORS
  app.use(
    cors({
      origin: ORIGIN === "*" ? true : ORIGIN.split(","),
      credentials: true,
    })
  );

  // sessions (persist in /var/data/sessions.sqlite)
  const SQLiteStore = SQLiteStoreFactory(session);
  app.use(
    session({
      store: new SQLiteStore({
        db: "sessions.sqlite",
        dir: "/var/data",
      }),
      secret: process.env.SESSION_SECRET || "7goldencowries-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 1000 * 60 * 60,
      },
    })
  );

  // ------------- DB accessor for routes -------------
  // we open only the primary for request-time ops
  const liveDb = await openDb(PRIMARY_DB);

  // helper to compute “active” from tier (so routes never SELECT active)
  function computeActiveFromRow(row) {
    if (!row) return 0;
    if (!row.tier) return 0;
    return row.tier === "Free" ? 0 : 1;
  }

  // -------------------- routes --------------------

  // health
  app.get("/api/health", (req, res) => {
    res.json({ ok: true, db: "ok" });
  });

  // auth: wallet session
  app.post("/api/auth/wallet/session", (req, res) => {
    const { address } = req.body || {};
    if (!address) {
      return res.status(400).json({ ok: false, error: "address required" });
    }
    req.session.wallet = address;
    req.session.save(() => {
      res.json({ ok: true, address });
    });
  });

  // subscriptions: status (READ-ONLY, no SELECT active)
  app.get("/api/subscriptions/status", (req, res) => {
    const wallet = req.session.wallet;
    if (!wallet) {
      return res.json({
        ok: true,
        wallet: null,
        tier: "Free",
        xpBoost: 1,
      });
    }

    liveDb.get(
      "SELECT id, wallet, tier FROM subscriptions WHERE wallet = ? ORDER BY id DESC LIMIT 1",
      [wallet],
      (err, row) => {
        if (err) {
          console.log("[api/subscriptions/status] db err", err.message);
          return res.json({
            ok: true,
            wallet,
            tier: "Free",
            xpBoost: 1,
          });
        }

        const tier = row ? row.tier : "Free";
        const xpBoost = tier === "Free" ? 1 : tier === "Tier 1" ? 1.2 : tier === "Tier 2" ? 1.5 : 2;
        const active = computeActiveFromRow(row);

        res.json({
          ok: true,
          wallet,
          tier,
          active,
          xpBoost,
        });
      }
    );
  });

  // subscriptions: create/update (WRITE but never INSERT active)
  app.post("/api/subscriptions/upsert", (req, res) => {
    const wallet = req.session.wallet;
    if (!wallet) {
      return res.status(401).json({ ok: false, error: "not authenticated" });
    }
    const { tier = "Free", provider = "TON", tx_id = null } = req.body || {};

    liveDb.run(
      `INSERT INTO subscriptions (wallet, tier, provider, tx_id, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [wallet, tier, provider, tx_id],
      function (err) {
        if (err) {
          console.log("[api/subscriptions/upsert] err", err.message);
          return res.status(500).json({ ok: false, error: err.message });
        }
        return res.json({
          ok: true,
          id: this.lastID,
          wallet,
          tier,
        });
      }
    );
  });

  // -------------------- start server --------------------
  app.listen(PORT, () => {
    console.log("==> 7goldencowries backend listening on", PORT);
  });
}

start();
