// db.js — single source of truth for SQLite (Render-safe, ESM)
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const DB_URL = process.env.DATABASE_URL || "./data.sqlite";

// one shared promise everywhere
const dbPromise = open({
  filename: DB_URL,
  driver: sqlite3.Database,
});

// default export = promise (what server.js awaits)
export default dbPromise;

// named helpers (what migrate-on-boot.mjs and routes/* use)
export async function dbRun(sql, params = []) {
  const db = await dbPromise;
  return db.run(sql, params);
}

export async function dbGet(sql, params = []) {
  const db = await dbPromise;
  return db.get(sql, params);
}

export async function dbAll(sql, params = []) {
  const db = await dbPromise;
  return db.all(sql, params);
}
