import request from 'supertest';
import { setCache, getCache } from '../utils/cache.js';

let app, db;

beforeAll(async () => {
  process.env.SQLITE_FILE = ':memory:';
  process.env.DATABASE_URL = process.env.SQLITE_FILE;
  process.env.NODE_ENV = 'test';
  process.env.TWITTER_CONSUMER_KEY = 'x';
  process.env.TWITTER_CONSUMER_SECRET = 'y';
  ({ default: app } = await import('../server.js'));
  ({ default: db } = await import('../lib/db.js'));
  await db.run("INSERT OR REPLACE INTO quests (id, title, xp, requirement, active) VALUES ('qc','Cache Quest',10,'none',1)");
});

afterAll(async () => {
  await db.close();
});

test('claim awards xp and clears leaderboard cache', async () => {
  const agent = request.agent(app);
  await agent.post('/api/session/bind-wallet').send({ wallet: 'wc' });
  setCache('leaderboard', { foo: 'bar' }, 60000);
  const res = await agent.post('/api/quests/qc/claim');
  expect(res.body.ok).toBe(true);
  const row = await db.get('SELECT xp FROM users WHERE wallet=?', 'wc');
  expect(row.xp).toBe(10);
  expect(getCache('leaderboard')).toBeNull();
});
