import request from 'supertest';

let app, db;

beforeAll(async () => {
  process.env.SQLITE_FILE = ':memory:';
  process.env.DATABASE_URL = process.env.SQLITE_FILE;
  process.env.NODE_ENV = 'test';
  process.env.TWITTER_CONSUMER_KEY = 'x';
  process.env.TWITTER_CONSUMER_SECRET = 'y';
  delete process.env.NOMBA_ENABLED;
  delete process.env.TON_PAYMENTS_ENABLED;
  ({ default: app } = await import('../index.js'));
  ({ default: db } = await import('../lib/db.js'));
});

afterAll(async () => {
  await db.close();
});

function expectHealthyPayload(body) {
  expect(body.ok).toBe(true);
  expect(body.service).toBe('7goldencowries-backend');
  expect(typeof body.version).toBe('string');
  expect(typeof body.timestamp).toBe('string');
  expect(typeof body.uptimeSeconds).toBe('number');
  expect(body.checks).toEqual({
    db: 'ok',
    startup: {
      ok: true,
      missing: [],
    },
  });
}

test('/health returns db status', async () => {
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expectHealthyPayload(res.body);
});

test('/healthz returns db status', async () => {
  const res = await request(app).get('/healthz');
  expect(res.status).toBe(200);
  expectHealthyPayload(res.body);
});

test('/api/health reports db status', async () => {
  const res = await request(app).get('/api/health');
  expect(res.status).toBe(200);
  expectHealthyPayload(res.body);
});


test('/api/healthz reports db status', async () => {
  const res = await request(app).get('/api/healthz');
  expect(res.status).toBe(200);
  expectHealthyPayload(res.body);
});

test('healthz returns 503 when a required payment env var is missing', async () => {
  process.env.NOMBA_ENABLED = '1';
  delete process.env.NOMBA_SECRET_KEY;

  const res = await request(app).get('/healthz');
  expect(res.status).toBe(503);
  expect(res.body.ok).toBe(false);
  expect(res.body.checks.startup.ok).toBe(false);
  expect(res.body.checks.startup.missing).toContain('NOMBA_SECRET_KEY');

  delete process.env.NOMBA_ENABLED;
});
