import { jest } from '@jest/globals';

let db, awardQuest;

beforeAll(async () => {
  process.env.DATABASE_URL = ':memory:';
  ({ default: db } = await import('../db.js'));
  ({ awardQuest } = await import('../lib/quests.js'));
  await db.run("INSERT INTO quests (id, title, xp, active) VALUES ('q1','Q',100,1)");
  await db.run("INSERT INTO users (wallet, tier, updatedAt) VALUES ('w3','tier3',CURRENT_TIMESTAMP)");
});

afterAll(async () => {
  await db.close();
});

test('tier3 gets 125 xp for 100xp quest', async () => {
  const res = await awardQuest('w3','q1');
  expect(res.xpGain).toBe(125);
  const row = await db.get("SELECT xp FROM users WHERE wallet='w3'");
  expect(row.xp).toBe(125);
});
