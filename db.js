// db.js — Render-safe SQLite bootstrap for 7GC
// single default export: a Promise that resolves to an opened sqlite DB

import fs from "node:fs";
import path from "node:path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

// 1) decide where to put the DB
// - if Render env has DATABASE_URL, use that
// - else use ./data/7gc.sqlite3
const DB_FILE =
  process.env.DATABASE_URL && process.env.DATABASE_URL.trim()
    ? process.env.DATABASE_URL.trim()
    : path.join(process.cwd(), "data", "7gc.sqlite3");

// 2) make sure the folder exists (Render was failing here)
const dir = path.dirname(DB_FILE);
try {
  fs.mkdirSync(dir, { recursive: true });
} catch (e) {
  // if this fails, we'll still try to open; worst-case we fall back to :memory:
  console.warn("[db] mkdir failed:", e.message);
}

// 3) open the db
const dbPromise = (async () => {
  try {
    const db = await open({
      filename: DB_FILE,
      driver: sqlite3.Database,
    });

    // enable FK
    await db.exec("PRAGMA foreign_keys = ON;");

    console.log("[db] opened sqlite at", DB_FILE);
    return db;
  } catch (err) {
    console.error("[db] failed to open", DB_FILE, err);

    // LAST RESORT: in-memory so server.js can still boot
    const mem = await open({
      filename: ":memory:",
      driver: sqlite3.Database,
    });
    console.warn("[db] using in-memory sqlite (no persistence)");
    return mem;
  }
})();

export default dbPromise;
