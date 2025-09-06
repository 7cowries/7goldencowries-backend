import request from 'supertest';

let app, db;

beforeAll(async () => {
  process.env.SQLITE_FILE = ':memory:';
  process.env.NODE_ENV = 'test';
  process.env.TWITTER_CONSUMER_KEY = 'x';
  process.env.TWITTER_CONSUMER_SECRET = 'y';
  ({ default: app } = await import('../server.js'));
  ({ default: db } = await import('../db.js'));
  await db.exec(`CREATE TABLE IF NOT EXISTS tier_multipliers (tier TEXT PRIMARY KEY, multiplier REAL, label TEXT);`);
  await db.run("INSERT OR IGNORE INTO tier_multipliers (tier,multiplier,label) VALUES ('free',1,'Free')");
  await db.run("INSERT INTO quests (id,title,url,xp,active) VALUES (1,'Q1','u1',10,1),(4,'Q4','u4',10,1),(5,'Q5','u5',10,1),(41,'Q41','u41',10,1)");
});

afterAll(async () => {
  await db.close();
});

describe('quests api', () => {
  test('maps categories by id', async () => {
    const res = await request(app).get('/api/quests');
    const qs = Array.isArray(res.body.quests) ? res.body.quests : res.body;
    const map = Object.fromEntries(qs.map((q) => [q.id, q.category]));
    expect(map[1]).toBe('Social');
    expect(map[4]).toBe('Partner');
    expect(map[5]).toBe('Onchain');
    expect(map[41]).toBe('Daily');
  });

  test('inserts proofs', async () => {
    const res = await request(app)
      .post('/api/quests/1/proofs')
      .send({ wallet: 'w1', vendor: 'twitter', url: 'https://x.com/t/1' });
    expect(res.body.ok).toBe(true);
    const row = await db.get('SELECT wallet,vendor,url FROM quest_proofs WHERE quest_id=1 AND wallet=?', 'w1');
    expect(row.vendor).toBe('twitter');
    expect(row.url).toBe('https://x.com/t/1');
  });
});
