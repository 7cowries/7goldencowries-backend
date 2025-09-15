import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import os from 'os';
import path from 'path';
import fs from 'fs';

test('adds missing timestamp columns', async () => {
  const tmp = path.join(os.tmpdir(), 'ts-migration.sqlite');
  try { fs.unlinkSync(tmp); } catch {}

  const pre = await open({ filename: tmp, driver: sqlite3.Database });
  await pre.exec(`CREATE TABLE completed_quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT,
      quest_id TEXT
    );
    CREATE TABLE subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT,
      tier TEXT,
      tonAmount REAL,
      usdAmount REAL,
      status TEXT
    );`);
  await pre.close();

  process.env.DATABASE_URL = tmp;
  const { default: db } = await import('../lib/db.js');

  const cqCols = await db.all("PRAGMA table_info(completed_quests)");
  const subCols = await db.all("PRAGMA table_info(subscriptions)");
  expect(cqCols.some(c => c.name === 'timestamp')).toBe(true);
  expect(subCols.some(c => c.name === 'timestamp')).toBe(true);

  await db.close();
  fs.unlinkSync(tmp);
});
