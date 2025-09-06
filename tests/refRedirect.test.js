import request from 'supertest';

let app, db;

beforeAll(async () => {
  process.env.DATABASE_URL = ':memory:';
  process.env.NODE_ENV = 'test';
  process.env.TWITTER_CONSUMER_KEY = 'x';
  process.env.TWITTER_CONSUMER_SECRET = 'y';
  ({ default: app } = await import('../server.js'));
  ({ default: db } = await import('../db.js'));
  await db.exec("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, wallet TEXT, referral_code TEXT);");
  await db.run("INSERT INTO users (wallet, referral_code) VALUES ('w2','ABC123')");
});

afterAll(async () => {
  if (db) await db.close();
});

test('/ref/:code sets cookie and redirects', async () => {
  const res = await request(app).get('/ref/ABC123');
  expect(res.status).toBe(302);
  expect(res.headers['set-cookie'][0]).toMatch(/ref=ABC123/);
  expect(res.headers.location).toBe('/');
});
