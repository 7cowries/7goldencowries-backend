// db.js — OPEN ONLY, no migrations, no writes to subscriptions.active
import "dotenv/config";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const DB_FILE =
  process.env.SQLITE_FILE ||
  process.env.DATABASE_PATH ||
  process.env.DATABASE_URL ||
  "/var/data/7gc.sqlite3";

// open once and export the promise
const dbPromise = open({
  filename: DB_FILE,
  driver: sqlite3.Database,
});

export default dbPromise;
