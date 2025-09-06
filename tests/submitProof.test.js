import request from 'supertest';
import { jest } from '@jest/globals';

let app, db;

beforeAll(async () => {
  process.env.SQLITE_FILE = ':memory:';
  process.env.NODE_ENV = 'test';
  process.env.X_TARGET_TWEET_URL = 'https://x.com/7goldencowries/status/1';
  process.env.X_REQUIRED_HASHTAG = '#7GC';
  process.env.X_TARGET_HANDLE = 'alice';
  process.env.TWITTER_CONSUMER_KEY = 'x';
  process.env.TWITTER_CONSUMER_SECRET = 'y';
  ({ default: app } = await import('../server.js'));
  ({ default: db } = await import('../db.js'));
  try { await db.exec('ALTER TABLE quests ADD COLUMN requirement TEXT'); } catch {}
  await db.run("INSERT INTO quests (id, title, xp, requirement, active) VALUES ('q1','Tweet Quest',10,'x_follow',1)");
});

afterAll(async () => {
  await db.close();
});

describe('submit-proof flow', () => {
  test('valid proof awards claim', async () => {
    const agent = request.agent(app);
    await agent.post('/api/session/bind-wallet').send({ wallet: 'w1' });
    await db.run("UPDATE users SET twitter_username='alice' WHERE wallet='w1'");
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ html: `<blockquote><a href='https://x.com/7goldencowries/status/1'>Q</a> #7GC</blockquote>` }) });
    const url = 'https://x.com/alice/status/1';
    let res = await agent.post('/api/quests/submit-proof?wallet=w1').send({ questId: 'q1', url });
    expect(res.body.status).toBe('verified');
    res = await agent.post('/api/quests/claim?wallet=w1').send({ questId: 'q1' });
    expect(res.body.ok).toBe(true);
    const u = await db.get('SELECT xp FROM users WHERE wallet=?', 'w1');
    expect(u.xp).toBeGreaterThan(0);
  });

  test('invalid proof prevents claim', async () => {
    const agent = request.agent(app);
    await agent.post('/api/session/bind-wallet').send({ wallet: 'w2' });
    await db.run("UPDATE users SET twitter_username='alice' WHERE wallet='w2'");
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ html: '<blockquote>no match</blockquote>' }) });
    const url = 'https://x.com/alice/status/2';
    let res = await agent.post('/api/quests/submit-proof?wallet=w2').send({ questId: 'q1', url });
    expect(res.body.status).toBe('rejected');
    res = await agent.post('/api/quests/claim?wallet=w2').send({ questId: 'q1' });
    expect(res.body.needProof).toBe(true);
  });
});
