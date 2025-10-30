// db.js – ESM sqlite for Render
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const filename = process.env.DATABASE_URL || "./data.sqlite";

const dbPromise = open({
  filename,
  driver: sqlite3.Database,
});

// tiny helpers so routes don’t call .exec on the promise
export async function dbGet(sql, params = []) {
  const db = await dbPromise;
  return db.get(sql, params);
}

export async function dbAll(sql, params = []) {
  const db = await dbPromise;
  return db.all(sql, params);
}

export async function dbRun(sql, params = []) {
  const db = await dbPromise;
  return db.run(sql, params);
}

// expose the promise too (server.js uses it)
export default dbPromise;
