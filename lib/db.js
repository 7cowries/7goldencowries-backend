import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

function hasPgUrlScheme(value) {
  return /^postgres(ql)?:\/\//i.test(String(value || "").trim());
}

function buildPoolConfig() {
  const ssl = process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false };

  if (hasPgUrlScheme(DATABASE_URL)) {
    return { connectionString: DATABASE_URL, ssl };
  }

  // Render-style fallback: if PGHOST/PGUSER/etc are present, prefer them.
  // This also tolerates accidentally setting DATABASE_URL to only the DB name.
  if (process.env.PGHOST) {
    return {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE || (DATABASE_URL ? String(DATABASE_URL).trim() : undefined),
      ssl,
    };
  }

  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is required. Expected a postgres:// connection string.");
  }

  throw new Error(
    `Invalid DATABASE_URL format: \"${String(DATABASE_URL).slice(0, 64)}\". ` +
      "Expected postgres://... or PGHOST/PGUSER/PGPASSWORD/PGDATABASE env vars."
  );
}

const pool = new Pool(buildPoolConfig());

const ISO_UTC_NOW = "to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')";

function normalizeParams(params) {
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

function toPgPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function adaptSql(sql) {
  let out = String(sql || "").trim();
  if (!out) return out;

  if (/^PRAGMA\s+/i.test(out)) return "-- noop pragma";

  out = out.replace(/strftime\('%Y-%m-%dT%H:%M:%fZ','now'\)/gi, ISO_UTC_NOW);
  out = out.replace(/strftime\('%s','now'\)/gi, "EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::bigint");
  out = out.replace(/datetime\('now'\)/gi, "CURRENT_TIMESTAMP");
  out = out.replace(/datetime\((\w+),\s*'\+30 days'\)/gi, "($1::timestamp + INTERVAL '30 days')");

  out = out.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, "INSERT INTO");
  if (/^\s*INSERT\s+INTO\b/i.test(out) && !/\bON\s+CONFLICT\b/i.test(out) && !/\bRETURNING\b/i.test(out)) {
    out = `${out.replace(/;\s*$/, "")} ON CONFLICT DO NOTHING`;
  }

  return toPgPlaceholders(out);
}

async function run(sql, ...params) {
  const values = normalizeParams(params);
  const text = adaptSql(sql);
  const result = await pool.query(text, values);

  let lastID;
  if (/^\s*INSERT\s+INTO\s+([a-zA-Z0-9_]+)/i.test(text)) {
    const [, table] = text.match(/^\s*INSERT\s+INTO\s+([a-zA-Z0-9_]+)/i) || [];
    if (table) {
      try {
        const probe = await pool.query(
          "SELECT currval(pg_get_serial_sequence($1,'id')) AS id",
          [table]
        );
        lastID = probe.rows?.[0]?.id;
      } catch {
        // table may not have numeric serial `id`; ignore.
      }
    }
  }

  return { changes: result.rowCount || 0, lastID };
}

async function get(sql, ...params) {
  const values = normalizeParams(params);
  const text = adaptSql(sql);
  const result = await pool.query(text, values);
  return result.rows?.[0] || null;
}

async function all(sql, ...params) {
  const values = normalizeParams(params);
  const text = adaptSql(sql);
  const result = await pool.query(text, values);
  return result.rows || [];
}

async function exec(sql) {
  const statements = String(sql || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    const text = adaptSql(statement);
    if (!text || text.startsWith("-- noop pragma")) continue;
    await pool.query(text);
  }
}

async function initializePostgresSchema() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.resolve(here, "../migrations/2026-03-28_postgres_schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(schemaSql);
}

const db = {
  run,
  get,
  all,
  exec,
  query: (text, values) => pool.query(text, values),
  pool,
  initializePostgresSchema,
};

export default db;
