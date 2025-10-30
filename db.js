// db.js — ESM sqlite helper for Render
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const DB_URL = process.env.DATABASE_URL || process.env.DB_PATH || "./data.db";

// open() returns a promise; we export the promise as default
const dbPromise = open({
  filename: DB_URL,
  driver: sqlite3.Database,
});

// named helpers so server.js can do: const db = await dbp; dbRun(...)
export async function get(sql, ...params) {
  const db = await dbPromise;
  return db.get(sql, ...params);
}

export async function all(sql, ...params) {
  const db = await dbPromise;
  return db.all(sql, ...params);
}

export async function run(sql, ...params) {
  const db = await dbPromise;
  return db.run(sql, ...params);
}

export default dbPromise;
