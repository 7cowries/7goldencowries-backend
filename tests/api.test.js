import request from 'supertest';

let app, db;

beforeAll(async () => {
  process.env.TWITTER_CONSUMER_KEY = "x";
  process.env.TWITTER_CONSUMER_SECRET = "y";
  process.env.SQLITE_FILE = ':memory:';
  process.env.NODE_ENV = 'test';
  ({ default: app } = await import('../server.js'));
  ({ default: db } = await import('../db.js'));
  try { await db.exec("ALTER TABLE quests ADD COLUMN code TEXT;"); } catch {}
  try { await db.exec("ALTER TABLE quests ADD COLUMN requirement TEXT;"); } catch {}
  await db.exec(`CREATE TABLE IF NOT EXISTS tier_multipliers (
      tier TEXT PRIMARY KEY,
      multiplier REAL,
      label TEXT
    );`);
  await db.run("INSERT INTO tier_multipliers (tier,multiplier,label) VALUES ('free',1.0,'Free'),('tier1',1.1,'Tier 1'),('tier3',1.5,'Tier 3')");
  await db.run("INSERT INTO quests (id, code, title, xp, active) VALUES ('q1','Q1','Test Quest',100,1)");
  await db.run("INSERT INTO users (wallet, tier, updatedAt) VALUES ('w1','tier1', CURRENT_TIMESTAMP)");
});

afterAll(async () => {
  await db.close();
});

describe('API routes', () => {
  test('claims quest and reports alreadyClaimed', async () => {
    const first = await request(app).post('/api/quests/claim?wallet=w1').send({ questId: 'q1' });
    expect(first.body.ok).toBe(true);
    expect(first.body.effectiveXp).toBe(110);
    expect(first.body.baseXp).toBe(100);
    expect(first.body.multiplier).toBeCloseTo(1.1);
    expect(first.body.newTotalXp).toBe(110);
    const second = await request(app).post('/api/quests/claim?wallet=w1').send({ questId: 'q1' });
    expect(second.body.alreadyClaimed).toBe(true);
  });

  test('returns user stats', async () => {
    const res = await request(app).get('/api/users/w1');
    expect(res.body.xp).toBe(110);
  });

  test('leaderboard shows users', async () => {
    const res = await request(app).get('/api/leaderboard');
    expect(res.body.top[0].wallet).toBe('w1');
  });

  test('/api/users/me exposes tier and multiplier', async () => {
    const res = await request(app).get('/api/users/me?wallet=w1');
    expect(res.body.tier).toBe('tier1');
    expect(res.body.tierLabel).toBe('Tier 1');
    expect(res.body.multiplier).toBeCloseTo(1.1);
  });
});
