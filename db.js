// db.js — single source of truth (Render-safe absolute path)
import sqlite3pkg from "sqlite3";
import { open } from "sqlite";

// Precedence: DATABASE_URL → DATABASE_PATH → SQLITE_FILE → default
const DB_FILE =
  process.env.DATABASE_URL ||
  process.env.DATABASE_PATH ||
  process.env.SQLITE_FILE ||
  "/var/data/7gc.sqlite3";

const dbp = open({ filename: DB_FILE, driver: sqlite3pkg.Database })
  .then(async (db) => {
    await db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    console.log("[db] opened sqlite at", DB_FILE);
    return db;
  });

export default dbp;
