import request from 'supertest';

let app, db;

beforeAll(async () => {
  process.env.SQLITE_FILE = ':memory:';
  process.env.DATABASE_URL = process.env.SQLITE_FILE;
  process.env.NODE_ENV = 'test';
  process.env.TWITTER_CONSUMER_KEY = 'x';
  process.env.TWITTER_CONSUMER_SECRET = 'y';
  ({ default: app } = await import('../index.js'));
  ({ default: db } = await import('../lib/db.js'));
});

afterAll(async () => {
  await db.close();
});

test('telegram start returns 302', async () => {
  const res = await request(app)
    .get('/api/auth/telegram/start?state=foo')
    .redirects(0);
  expect(res.status).toBe(302);
});
