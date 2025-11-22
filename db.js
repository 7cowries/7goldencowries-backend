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

// Open once (resolved connection). Top-level await ensures consumers receive a live db
// instance with the sqlite3 driver instead of a pending promise (fixes "db.exec is not a
// function" when routes call db helpers).
const db = await open({
  filename: DB_FILE,
  driver: sqlite3.Database,
});

export default db;
