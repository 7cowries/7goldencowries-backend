import request from 'supertest';

let app, db;

beforeAll(async () => {
  process.env.TWITTER_CONSUMER_KEY = "x";
  process.env.TWITTER_CONSUMER_SECRET = "y";
  process.env.DATABASE_URL = ':memory:';
  process.env.NODE_ENV = 'test';
  ({ default: app } = await import('../server.js'));
  ({ default: db } = await import('../db.js'));
  try { await db.exec("ALTER TABLE quests ADD COLUMN code TEXT;"); } catch {}
  try { await db.exec("ALTER TABLE quests ADD COLUMN requirement TEXT;"); } catch {}
  await db.run("INSERT INTO quests (id, code, title, xp, active) VALUES ('q1','Q1','Test Quest',100,1)");
  await db.run("INSERT INTO users (wallet, tier, updatedAt) VALUES ('w1','tier1', CURRENT_TIMESTAMP)");
});

afterAll(async () => {
  await db.close();
});

describe('API routes', () => {
  test('claims quest and reports already flag', async () => {
    const first = await request(app).post('/api/quests/claim?wallet=w1').send({ questId: 'q1' });
    expect(first.body.ok).toBe(true);
    expect(first.body.xpGain).toBe(105);
    expect(first.body.newTotalXp).toBe(105);
    const second = await request(app).post('/api/quests/claim?wallet=w1').send({ questId: 'q1' });
    expect(second.body.already).toBe(true);
  });

  test('returns user stats', async () => {
    const res = await request(app).get('/api/users/w1');
    expect(res.body.xp).toBe(105);
  });

  test('leaderboard shows users', async () => {
    const res = await request(app).get('/api/leaderboard');
    expect(res.body.entries[0].wallet).toBe('w1');
    expect(res.body.total).toBeGreaterThan(0);
  });

  test('/api/users/me exposes socials and referral', async () => {
    const res = await request(app).get('/api/users/me?wallet=w1');
    expect(res.body.wallet).toBe('w1');
    expect(res.body).toHaveProperty('referral_code');
    expect(res.body.socials.twitter).toBeDefined();
  });

  test('/api/users/me returns defaults when wallet missing', async () => {
    const res = await request(app).get('/api/users/me');
    expect(res.status).toBe(200);
    expect(res.body.wallet).toBeNull();
    expect(res.body.socials.twitter.connected).toBe(false);
  });

  test('health endpoint works', async () => {
    const res = await request(app).get('/health');
    expect(res.body).toEqual({ ok: true, db: 'ok' });
  });
});
