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
  await db.run("INSERT INTO quests (id, code, title, xp, active) VALUES ('q1','Q1','Test Quest',10,1)");
  await db.run("INSERT INTO users (wallet) VALUES ('w1')");
});

afterAll(async () => {
  await db.close();
});

describe('API routes', () => {
  test('claims quest and reports alreadyClaimed', async () => {
    const first = await request(app).post('/api/quests/claim?wallet=w1').send({ questId: 'q1' });
    expect(first.body.ok).toBe(true);
    const second = await request(app).post('/api/quests/claim?wallet=w1').send({ questId: 'q1' });
    expect(second.body.alreadyClaimed).toBe(true);
  });

  test('returns user stats', async () => {
    const res = await request(app).get('/api/users/w1');
    expect(res.body.xp).toBe(10);
  });

  test('leaderboard shows users', async () => {
    const res = await request(app).get('/api/leaderboard');
    expect(res.body.top[0].wallet).toBe('w1');
  });
});
