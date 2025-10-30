import sqlite3 from "sqlite3";
import { open } from "sqlite";

const DB_FILE = process.env.DATABASE_URL || "./data.sqlite";

const dbPromise = open({
  filename: DB_FILE,
  driver: sqlite3.Database,
});

export async function getDb() {
  return dbPromise;
}

export async function dbRun(sql, ...params) {
  const db = await dbPromise;
  return db.run(sql, params);
}

export async function dbGet(sql, ...params) {
  const db = await dbPromise;
  return db.get(sql, params);
}

export async function dbAll(sql, ...params) {
  const db = await dbPromise;
  return db.all(sql, params);
}

// keep backward compatibility with `import db from './db.js'`
export default dbPromise;
