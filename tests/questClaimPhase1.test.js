import request from 'supertest';

let app;
let db;

beforeAll(async () => {
  process.env.SQLITE_FILE = ':memory:';
  process.env.DATABASE_URL = process.env.SQLITE_FILE;
  process.env.NODE_ENV = 'test';
  process.env.TWITTER_CONSUMER_KEY = 'test';
  process.env.TWITTER_CONSUMER_SECRET = 'secret';
  ({ default: app } = await import('../server.js'));
  ({ default: db } = await import('../lib/db.js'));
});

beforeEach(async () => {
  await db.exec(`
    DELETE FROM quest_proofs;
    DELETE FROM proofs;
    DELETE FROM completed_quests;
    DELETE FROM quests;
    DELETE FROM users;
  `);
});

afterAll(async () => {
  await db.close();
});

describe('quest claim gating', () => {
  test('claims gated quest when proof is verified', async () => {
    await db.run(
      `INSERT INTO quests (id, title, xp, requirement, active) VALUES (101, 'Follow on X', 50, 'x_follow', 1)`
    );
    await db.run(
      `INSERT INTO users (wallet, tier, xp, updatedAt) VALUES ('wallet-1', 'Free', 0, CURRENT_TIMESTAMP)`
    );
    await db.run(
      `INSERT INTO proofs (wallet, quest_id, url, provider, status) VALUES (?, ?, 'https://example.com', 'twitter', 'verified')`,
      'wallet-1',
      101
    );

    const res = await request(app)
      .post('/api/quests/claim?wallet=wallet-1')
      .send({ questId: 101 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.xpGain).toBeGreaterThan(0);
  });

  test('rejects gated quest when proof is missing', async () => {
    await db.run(
      `INSERT INTO quests (id, title, xp, requirement, active) VALUES (202, 'Follow on X', 50, 'x_follow', 1)`
    );
    await db.run(
      `INSERT INTO users (wallet, tier, xp, updatedAt) VALUES ('wallet-2', 'Free', 0, CURRENT_TIMESTAMP)`
    );

    const res = await request(app)
      .post('/api/quests/claim?wallet=wallet-2')
      .send({ questId: 202 });

    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('proof-required');
  });
});
