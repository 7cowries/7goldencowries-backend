import sqlite3 from "sqlite3";
import { open } from "sqlite";

const DB_PATH = process.env.DATABASE_URL || "./data.sqlite";

const db = await open({
  filename: DB_PATH,
  driver: sqlite3.Database
});

// important for relations
await db.exec("PRAGMA foreign_keys = ON;");

export default db;
