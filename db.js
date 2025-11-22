// db.js — OPEN ONLY, no migrations, no writes to subscriptions.active
import "dotenv/config";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const DEFAULT_DB = "/var/data/7gc.sqlite3";
const DB_FILE =
  process.env.SQLITE_FILE ||
  process.env.DATABASE_PATH ||
  process.env.DATABASE_URL ||
  DEFAULT_DB;

process.env.DATABASE_URL ||= DB_FILE;
process.env.SQLITE_FILE ||= DB_FILE;

// open once and export the promise
const dbPromise = open({
  filename: DB_FILE,
  driver: sqlite3.Database,
});

export default dbPromise;
