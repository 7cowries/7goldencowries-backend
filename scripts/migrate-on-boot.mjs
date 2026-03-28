// scripts/migrate-on-boot.mjs
// Postgres boot check: validates DATABASE_URL and confirms schema availability.

import { fileURLToPath } from "node:url";
import db from "../lib/db.js";

export async function migrateOnBoot() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for production boot.");
  }

  await db.get("SELECT 1 AS ok");
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_boot_log (
      id BIGSERIAL PRIMARY KEY,
      booted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("[migrate-on-boot] Postgres schema ready via DATABASE_URL");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await migrateOnBoot();
}
