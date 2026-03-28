import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
const SQLITE_TARGET = String(DATABASE_URL || process.env.SQLITE_FILE || "").trim();
const IS_SQLITE = SQLITE_TARGET === ":memory:" || /\.(sqlite3?|db)$/i.test(SQLITE_TARGET) || SQLITE_TARGET.startsWith('/tmp/');

function hasPgUrlScheme(value) {
  return /^postgres(ql)?:\/\//i.test(String(value || "").trim());
}

function buildPoolConfig() {
  const ssl = process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false };

  if (hasPgUrlScheme(DATABASE_URL)) {
    return { connectionString: DATABASE_URL, ssl };
  }

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

async function createSqliteDb() {
  const sqlite3mod = await import("sqlite3");
  const sqlite3 = sqlite3mod.default || sqlite3mod;
  const driver = sqlite3.verbose ? sqlite3.verbose() : sqlite3;
  const raw = new driver.Database(SQLITE_TARGET || ":memory:");

  const run = (sql, ...params) =>
    new Promise((resolve, reject) => {
      const values = normalizeParams(params);
      raw.run(sql, values, function onRun(err) {
        if (err) return reject(err);
        resolve({ changes: this.changes || 0, lastID: this.lastID });
      });
    });

  const get = (sql, ...params) =>
    new Promise((resolve, reject) => {
      const values = normalizeParams(params);
      raw.get(sql, values, (err, row) => (err ? reject(err) : resolve(row || null)));
    });

  const all = (sql, ...params) =>
    new Promise((resolve, reject) => {
      const values = normalizeParams(params);
      raw.all(sql, values, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });

  const exec = (sql) =>
    new Promise((resolve, reject) => {
      raw.exec(String(sql || ""), (err) => (err ? reject(err) : resolve()));
    });

  const query = async (text, values = []) => {
    const normalized = String(text || "").trim().toUpperCase();
    if (normalized.startsWith("SELECT")) {
      const rows = await all(text, values);
      return { rows, rowCount: rows.length };
    }
    const result = await run(text, values);
    return { rows: [], rowCount: result.changes };
  };

  const close = () =>
    new Promise((resolve, reject) => {
      raw.close((err) => (err ? reject(err) : resolve()));
    });



  await exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT UNIQUE NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  tier TEXT NOT NULL DEFAULT 'Free',
  subscriptionTier TEXT DEFAULT 'Free',
  levelName TEXT DEFAULT 'Shellborn',
  levelSymbol TEXT DEFAULT '🐚',
  levelProgress REAL DEFAULT 0,
  nextXP INTEGER DEFAULT 10000,
  referral_code TEXT UNIQUE,
  referred_by TEXT,
  socials TEXT DEFAULT '{}',
  twitterHandle TEXT,
  twitter_username TEXT,
  twitter_id TEXT,
  telegramId TEXT,
  telegramHandle TEXT,
  telegram_username TEXT,
  discordId TEXT,
  discord_id TEXT,
  discordHandle TEXT,
  discord_username TEXT,
  discordGuildMember INTEGER DEFAULT 0,
  paid INTEGER DEFAULT 0,
  lastPaymentAt TEXT,
  subscriptionPaidAt TEXT,
  subscriptionClaimedAt TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS quests (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT 'All',
  kind TEXT DEFAULT 'link',
  requirement TEXT DEFAULT 'none',
  url TEXT DEFAULT '',
  xp INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  sort INTEGER DEFAULT 0,
  createdAt INTEGER DEFAULT (strftime('%s','now')),
  updatedAt INTEGER DEFAULT (strftime('%s','now'))
);
CREATE TABLE IF NOT EXISTS completed_quests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(wallet, quest_id)
);
CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer TEXT NOT NULL,
  referred TEXT NOT NULL UNIQUE,
  code TEXT UNIQUE,
  completed INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  tier TEXT,
  tonAmount REAL,
  usdAmount REAL,
  status TEXT,
  sessionId TEXT UNIQUE,
  nonce TEXT,
  sessionCreatedAt TEXT,
  txHash TEXT,
  renewalDate TEXT,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP
);
`);


  try { await exec("ALTER TABLE completed_quests ADD COLUMN timestamp TEXT DEFAULT CURRENT_TIMESTAMP;"); } catch {}
  try { await exec("ALTER TABLE subscriptions ADD COLUMN timestamp TEXT DEFAULT CURRENT_TIMESTAMP;"); } catch {}

  return {
    run,
    get,
    all,
    exec,
    query,
    pool: { end: close },
    close,
    initializePostgresSchema: async () => {},
  };
}

async function createPostgresDb() {
  const pool = new Pool(buildPoolConfig());

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

  return {
    run,
    get,
    all,
    exec,
    query: (text, values) => pool.query(text, values),
    pool,
    close: () => pool.end(),
    initializePostgresSchema,
  };
}

const db = IS_SQLITE ? await createSqliteDb() : await createPostgresDb();

export default db;
