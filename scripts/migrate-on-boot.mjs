// scripts/migrate-on-boot.mjs
// Lightweight bootstrap to ensure the primary SQLite database exists and core migrations have run.

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import db from "../lib/db.js";
import { ensureQuestsSchema } from "../lib/ensureQuestsSchema.js";

const DEFAULT_DB = "/var/data/7gc.sqlite3";
const RUNTIME_DB_PATH = process.env.SQLITE_FILE || process.env.DATABASE_URL || DEFAULT_DB;

export async function migrateOnBoot(dbPath = RUNTIME_DB_PATH) {
  const targetPath = dbPath || DEFAULT_DB;
  process.env.DATABASE_URL ||= targetPath;
  process.env.SQLITE_FILE ||= targetPath;

  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  } catch {}

  await db.exec("PRAGMA journal_mode = WAL;");
  await db.exec("PRAGMA foreign_keys = ON;");

  // Touch a critical table so downstream routes never fall back to in-memory stubs.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      wallet TEXT PRIMARY KEY,
      xp INTEGER NOT NULL DEFAULT 0,
      tier TEXT NOT NULL DEFAULT 'Free',
      subscriptionTier TEXT DEFAULT 'Free'
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      tier TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      sessionId TEXT,
      timestamp TEXT DEFAULT (datetime('now'))
    );
  `);

  // Make sure the quests table has the full column set (including `code`)
  // before any request handlers run. This is idempotent and safe against
  // older Render disks that pre-date the quests migration.
  await ensureQuestsSchema();

  console.log(`[migrate-on-boot] database ready at ${targetPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await migrateOnBoot();
}
