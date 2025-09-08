import request from 'supertest';

let app, db;

beforeAll(async () => {
  process.env.DATABASE_URL = ':memory:';
  process.env.NODE_ENV = 'test';
  process.env.TWITTER_CONSUMER_KEY = 'x';
  process.env.TWITTER_CONSUMER_SECRET = 'y';
  ({ default: app } = await import('../server.js'));
  ({ default: db } = await import('../db.js'));
  await db.run("INSERT INTO quests (id, title, xp, requirement, active) VALUES ('q1','Quest',10,'none',1)");
});

afterAll(async () => {
  await db.close();
});

test('claim rate limit triggers at 11th request', async () => {
  const agent = request.agent(app);
  await agent.post('/api/session/bind-wallet').send({ wallet: 'w1' });
  for (let i = 0; i < 10; i++) {
    await agent.post('/api/quests/q1/claim');
  }
  const res = await agent.post('/api/quests/q1/claim');
  expect(res.status).toBe(429);
  expect(res.body.error).toBe('rate_limited');
});
