// db.js — single source of truth for SQLite file (Render-safe)
import sqlite3pkg from "sqlite3";
import { open } from "sqlite";

// Prefer explicit var, then fallbacks; default to Render persistent disk
const DB_FILE =
  process.env.SQLITE_FILE ||
  process.env.DATABASE_URL ||
  process.env.DATABASE_PATH ||
  "/var/data/7gc.sqlite3";

const dbp = open({ filename: DB_FILE, driver: sqlite3pkg.Database }).then(async (db) => {
  await db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  console.log("[db] opened sqlite at", DB_FILE);
  return db;
});

export default dbp;
