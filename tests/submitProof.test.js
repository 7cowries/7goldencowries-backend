import request from 'supertest';
import { jest } from '@jest/globals';

let app, db;

beforeAll(async () => {
  process.env.SQLITE_FILE = ':memory:';
  process.env.NODE_ENV = 'test';
  process.env.TWITTER_CONSUMER_KEY = 'x';
  process.env.TWITTER_CONSUMER_SECRET = 'y';
  ({ default: app } = await import('../server.js'));
  ({ default: db } = await import('../db.js'));
  await db.run("INSERT INTO quests (id, title, xp, requirement, active) VALUES ('q1','Tweet Quest',10,'x_follow',1)");
  await db.run("INSERT INTO quests (id, title, xp, requirement, active) VALUES ('q2','Basic Quest',5,'none',1)");
});

afterAll(async () => {
  await db.close();
});

describe('submit-proof flow', () => {
  test('valid proof awards claim', async () => {
    const agent = request.agent(app);
    await agent.post('/api/session/bind-wallet').send({ wallet: 'w1' });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ html: '<blockquote class="twitter-tweet"></blockquote>' }) });
    const url = 'https://x.com/alice/status/1';
    let res = await agent.post('/api/quests/submit-proof?wallet=w1').send({ questId: 'q1', url });
    expect(res.body.status).toBe('verified');
    res = await agent.post('/api/quests/claim?wallet=w1').send({ questId: 'q1' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const u = await db.get('SELECT xp FROM users WHERE wallet=?', 'w1');
    expect(u.xp).toBeGreaterThan(0);
  });

  test('invalid URL proof rejected and claim blocked', async () => {
    const agent = request.agent(app);
    await agent.post('/api/session/bind-wallet').send({ wallet: 'w2' });
    global.fetch = jest.fn();
    const url = 'https://x.com/alice/status/abc';
    let res = await agent.post('/api/quests/submit-proof?wallet=w2').send({ questId: 'q1', url });
    expect(res.body.status).toBe('rejected');
    res = await agent.post('/api/quests/claim?wallet=w2').send({ questId: 'q1' });
    expect(res.status).toBe(403);
  });

  test('claim without proof is forbidden for x quests', async () => {
    const agent = request.agent(app);
    await agent.post('/api/session/bind-wallet').send({ wallet: 'w3' });
    const res = await agent.post('/api/quests/claim?wallet=w3').send({ questId: 'q1' });
    expect(res.status).toBe(403);
  });

  test('non-x quest can be claimed without proof', async () => {
    const agent = request.agent(app);
    await agent.post('/api/session/bind-wallet').send({ wallet: 'w4' });
    const res = await agent.post('/api/quests/claim?wallet=w4').send({ questId: 'q2' });
    expect(res.status).toBe(200);
    const u = await db.get('SELECT xp FROM users WHERE wallet=?', 'w4');
    expect(u.xp).toBeGreaterThan(0);
  });

  test('legacy complete route removed', async () => {
    const res = await request(app).post('/api/quests/complete?wallet=w1').send({ questId: 'q1' });
    expect(res.status).toBe(404);
  });
});
