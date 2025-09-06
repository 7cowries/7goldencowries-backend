import request from 'supertest';

let app, db;

beforeAll(async () => {
  process.env.SQLITE_FILE = ':memory:';
  process.env.NODE_ENV = 'test';
  process.env.TWITTER_CONSUMER_KEY = 'x';
  process.env.TWITTER_CONSUMER_SECRET = 'y';
  ({ default: app } = await import('../server.js'));
  ({ default: db } = await import('../db.js'));
  await db.exec(`CREATE TABLE IF NOT EXISTS tier_multipliers (
        tier TEXT PRIMARY KEY,
        multiplier REAL,
        label TEXT
      );`);
  await db.run("INSERT INTO tier_multipliers (tier,multiplier,label) VALUES ('free',1.0,'Free'),('tier2',1.25,'Tier 2')");
  await db.run("INSERT INTO quests (id, title, xp, requirement, active) VALUES ('t2q','Tier2 Quest',100,'none',1)");
});

afterAll(async () => {
  await db.close();
});

describe('session claim route tier multiplier', () => {
  test('Tier 2 user receives multiplier when claiming', async () => {
    const agent = request.agent(app);
    await agent.post('/api/session/bind-wallet').send({ wallet: 'w2' });
    await db.run("UPDATE users SET tier='tier2' WHERE wallet='w2'");
    const res = await agent.post('/api/quests/t2q/claim');
    expect(res.status).toBe(200);
    const row = await db.get('SELECT xp FROM users WHERE wallet=?', 'w2');
    expect(row.xp).toBe(125);
  });
});

