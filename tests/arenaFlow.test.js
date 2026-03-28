import request from 'supertest';

let app;
let db;

beforeAll(async () => {
  process.env.SQLITE_FILE = ':memory:';
  process.env.DATABASE_URL = process.env.SQLITE_FILE;
  process.env.NODE_ENV = 'test';
  process.env.ADMIN_TOKEN = 'admin-token';
  ({ default: app } = await import('../index.js'));
  ({ default: db } = await import('../lib/db.js'));
});

beforeEach(async () => {
  await db.exec(`
    DELETE FROM reward_payouts;
    DELETE FROM reward_rules;
    DELETE FROM arena_claims;
    DELETE FROM arena_quests;
    DELETE FROM arena_participants;
    DELETE FROM payments;
    DELETE FROM payment_events;
    DELETE FROM arenas;
    DELETE FROM quests;
    DELETE FROM users;
  `);
});

afterAll(async () => {
  await db.close();
});

test('arena join + claim + leaderboard + settlement', async () => {
  await db.run(`INSERT INTO users (wallet, xp, tier, updatedAt) VALUES ('wallet-a', 0, 'Free', CURRENT_TIMESTAMP)`);
  await db.run(`INSERT INTO quests (id, title, xp, requirement, active) VALUES (9001, 'Arena Quest', 100, 'none', 1)`);

  const createArena = await request(app)
    .post('/api/admin/arenas')
    .set('Authorization', 'Bearer admin-token')
    .send({ code: 'arena-1', title: 'Arena 1', status: 'live', entry_fee_amount: 0 });
  expect(createArena.status).toBe(201);
  const arenaId = createArena.body.arenaId;

  await request(app)
    .post(`/api/admin/arenas/${arenaId}/quests`)
    .set('Authorization', 'Bearer admin-token')
    .send({ quests: [{ quest_id: '9001', weight: 2 }] });

  await db.run(`INSERT INTO reward_rules (arena_id, rank_from, rank_to, reward_type, reward_amount, reward_currency) VALUES (?,1,1,'token',50,'TON')`, arenaId);

  const agent = request.agent(app);
  await agent.post('/api/session/bind-wallet').send({ wallet: 'wallet-a' });

  const joinRes = await agent.post(`/api/arenas/${arenaId}/join`).send({});
  expect(joinRes.status).toBe(200);

  const claimRes = await agent.post('/api/quests/claim').send({ questId: 9001, arenaId });
  expect(claimRes.status).toBe(200);
  expect(claimRes.body.arenaXpGain).toBe(200);

  const boardRes = await request(app).get(`/api/arenas/${arenaId}/leaderboard`);
  expect(boardRes.status).toBe(200);
  expect(boardRes.body.leaderboard[0].wallet).toBe('wallet-a');

  await request(app)
    .post(`/api/admin/arenas/${arenaId}/end`)
    .set('Authorization', 'Bearer admin-token')
    .send({});

  const settleRes = await request(app)
    .post(`/api/admin/arenas/${arenaId}/settle`)
    .set('Authorization', 'Bearer admin-token')
    .send({});
  expect(settleRes.status).toBe(200);

  const payouts = await db.all(`SELECT * FROM reward_payouts WHERE arena_id = ?`, arenaId);
  expect(payouts.length).toBe(1);
});
