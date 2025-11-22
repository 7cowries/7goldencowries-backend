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
  await db.run("INSERT INTO quests (id, title, xp, active) VALUES ('q1','Manual Quest',25,1)");
});

afterAll(async () => {
  await db.close();
});

describe('POST /api/proofs', () => {
  test('stores proof and awards xp', async () => {
    const res = await request(app)
      .post('/api/proofs')
      .send({ quest_id: 'q1', wallet: 'w1', url: 'https://example.com/proof' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const u = await db.get('SELECT xp FROM users WHERE wallet=?', 'w1');
    expect(u.xp).toBe(25);
    const p = await db.get('SELECT url FROM quest_proofs WHERE wallet=? AND quest_id=?', 'w1', 'q1');
    expect(p.url).toBe('https://example.com/proof');
  });

  test('rejects duplicate submissions', async () => {
    const res = await request(app)
      .post('/api/proofs')
      .send({ quest_id: 'q1', wallet: 'w1', url: 'https://example.com/proof2' });
    expect(res.status).toBe(409);
    const u = await db.get('SELECT xp FROM users WHERE wallet=?', 'w1');
    expect(u.xp).toBe(25);
  });
});
