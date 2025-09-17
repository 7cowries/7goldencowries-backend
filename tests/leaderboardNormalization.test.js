import request from 'supertest';

let app, db;

beforeAll(async () => {
  process.env.DATABASE_URL = ':memory:';
  process.env.NODE_ENV = 'test';
  process.env.TWITTER_CONSUMER_KEY = 'x';
  process.env.TWITTER_CONSUMER_SECRET = 'y';
  ({ default: app } = await import('../server.js'));
  ({ default: db } = await import('../lib/db.js'));
  await db.run("INSERT INTO users (wallet, xp, twitterHandle) VALUES ('w1', 5000, 'tw1')");
  await db.run("INSERT INTO users (wallet, xp) VALUES ('w2', 20000)");
});

afterAll(async () => {
  await db.close();
});

describe('leaderboard normalization', () => {
  test('progress clamped between 0 and 1 and exposes twitterHandle', async () => {
    const res = await request(app).get('/api/leaderboard');
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBeGreaterThan(0);
    for (const e of res.body.entries) {
      expect(e.progress).toBeGreaterThanOrEqual(0);
      expect(e.progress).toBeLessThanOrEqual(1);
      expect(e.levelSymbol).toBeDefined();
    }
    const first = res.body.entries.find(e => e.wallet === 'w1');
    expect(first.twitterHandle).toBe('tw1');
  });
});
