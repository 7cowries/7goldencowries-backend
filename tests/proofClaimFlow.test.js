import request from 'supertest';

let app, db;

beforeAll(async () => {
  process.env.DATABASE_URL = ':memory:';
  process.env.NODE_ENV = 'test';
  process.env.TWITTER_CONSUMER_KEY = 'x';
  process.env.TWITTER_CONSUMER_SECRET = 'y';
  ({ default: app } = await import('../server.js'));
  ({ default: db } = await import('../db.js'));
  await db.run("INSERT INTO quests (id, title, xp, requirement, active, url) VALUES ('qpc','Link Quest',10,'link',1,'https://example.com')");
});

afterAll(async () => {
  await db.close();
});

describe('proof then claim flow', () => {
  test('submit proof, claim, re-claim idempotent', async () => {
    const agent = request.agent(app);
    await agent.post('/api/session/bind-wallet').send({ wallet: 'w1' });
    let res = await agent
      .post('/api/quests/qpc/proofs')
      .send({ url: 'https://example.com/proof' });
    expect(res.body.status).toBe('approved');
    const u1 = await db.get('SELECT xp FROM users WHERE wallet=?', 'w1');
    expect(u1.xp).toBe(10);
    res = await agent.post('/api/quests/qpc/claim');
    expect(res.status).toBe(409);
  });
});
