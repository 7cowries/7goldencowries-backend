import request from 'supertest';

let app, db, agent;

beforeAll(async () => {
  process.env.DATABASE_URL = ':memory:';
  process.env.NODE_ENV = 'test';
  process.env.TWITTER_CONSUMER_KEY = 'x';
  process.env.TWITTER_CONSUMER_SECRET = 'y';
  ({ default: app } = await import('../server.js'));
  ({ default: db } = await import('../lib/db.js'));
  await db.run("INSERT INTO quests (id, title, xp, requirement, active) VALUES ('q1','Quest',50,'none',1)");
  agent = request.agent(app);
  await agent.post('/api/session/bind-wallet').send({ wallet: 'w1' });
  await agent.post('/api/quests/q1/claim');
});

afterAll(async () => {
  await db.close();
});

test('/api/users/me returns normalized progress and history shape', async () => {
  const res = await agent.get('/api/users/me');
  expect(res.status).toBe(200);
  const user = res.body;
  expect(user.totalXP).toBeGreaterThanOrEqual(0);
  expect(user).toHaveProperty('xp');
  expect(user).toHaveProperty('nextXP');
  expect(user).toHaveProperty('levelTier');
  expect(user.levelProgress).toBeGreaterThanOrEqual(0);
  expect(user.levelProgress).toBeLessThanOrEqual(1);
  expect(Array.isArray(user.questHistory)).toBe(true);
  const entry = user.questHistory[0];
  expect(entry).toHaveProperty('id');
  expect(entry).toHaveProperty('title');
  expect(entry).toHaveProperty('xp');
  expect(entry).toHaveProperty('ts');
  expect(entry).toHaveProperty('status');
});
