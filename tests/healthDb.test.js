import request from 'supertest';

let app, db;

beforeAll(async () => {
  process.env.DATABASE_URL = ':memory:';
  process.env.NODE_ENV = 'test';
  process.env.TWITTER_CONSUMER_KEY = 'x';
  process.env.TWITTER_CONSUMER_SECRET = 'y';
  ({ default: app } = await import('../server.js'));
  ({ default: db } = await import('../db.js'));
});

afterAll(async () => {
  await db.close();
});

test('/api/health/db returns ok true', async () => {
  const res = await request(app).get('/api/health/db');
  expect(res.body).toEqual({ ok: true });
});
