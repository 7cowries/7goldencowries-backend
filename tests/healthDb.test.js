import request from 'supertest';

let app, db;

beforeAll(async () => {
  process.env.DATABASE_URL = ':memory:';
  process.env.NODE_ENV = 'test';
  process.env.TWITTER_CONSUMER_KEY = 'x';
  process.env.TWITTER_CONSUMER_SECRET = 'y';
  ({ default: app } = await import('../server.js'));
  ({ default: db } = await import('../lib/db.js'));
});

afterAll(async () => {
  await db.close();
});

test('/health returns db status', async () => {
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true, db: 'ok' });
});

test('/healthz returns db status', async () => {
  const res = await request(app).get('/healthz');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true, db: 'ok' });
});

test('/api/health reports db status', async () => {
  const res = await request(app).get('/api/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true, db: 'ok' });
});
