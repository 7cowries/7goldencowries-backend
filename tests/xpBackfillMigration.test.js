import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { backfillXP } from '../db/backfillXP.js';

describe('XP backfill migration', () => {
  async function setupDB() {
    const db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await db.exec(`CREATE TABLE users (wallet TEXT PRIMARY KEY, xp INTEGER);
                   CREATE TABLE quests (id INTEGER PRIMARY KEY, xp INTEGER);
                   CREATE TABLE completed_quests (wallet TEXT, quest_id INTEGER);`);
    return db;
  }

  test('XP backfill preserves existing XP', async () => {
    const db = await setupDB();
    await db.exec(`INSERT INTO users (wallet, xp) VALUES ('W1', 500);
                   INSERT INTO quests (id, xp) VALUES (1, 200);
                   INSERT INTO completed_quests (wallet, quest_id) VALUES ('W1', 1);`);
    await backfillXP(db);
    let row = await db.get(`SELECT xp FROM users WHERE wallet='W1'`);
    expect(row.xp).toBe(500);
    await backfillXP(db); // idempotent second run
    row = await db.get(`SELECT xp FROM users WHERE wallet='W1'`);
    expect(row.xp).toBe(500);
    await db.close();
  });

  test('XP backfill fills missing XP', async () => {
    const db = await setupDB();
    await db.exec(`INSERT INTO users (wallet, xp) VALUES ('W2', 0);
                   INSERT INTO quests (id, xp) VALUES (1, 100), (2, 50);
                   INSERT INTO completed_quests (wallet, quest_id) VALUES ('W2',1), ('W2',2);`);
    await backfillXP(db);
    let row = await db.get(`SELECT xp FROM users WHERE wallet='W2'`);
    expect(row.xp).toBe(150);
    await backfillXP(db); // idempotent second run
    row = await db.get(`SELECT xp FROM users WHERE wallet='W2'`);
    expect(row.xp).toBe(150);
    await db.close();
  });
});
