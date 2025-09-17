import request from 'supertest';
import { jest } from '@jest/globals';

let app, db, fetchMock;

beforeAll(async () => {
  process.env.SQLITE_FILE = ':memory:';
  process.env.DATABASE_URL = process.env.SQLITE_FILE;
  process.env.NODE_ENV = 'test';
  process.env.TELEGRAM_BOT_TOKEN = '123:abc';
  process.env.TELEGRAM_GROUP_ID = '-100123';
  process.env.DISCORD_BOT_TOKEN = 'discordbot';
  process.env.DISCORD_GUILD_ID = 'guild123';
  process.env.TWITTER_CONSUMER_KEY = 'x';
  process.env.TWITTER_CONSUMER_SECRET = 'y';

  fetchMock = jest.fn();
  jest.unstable_mockModule('node-fetch', () => ({ default: fetchMock }));

  ({ default: app } = await import('../server.js'));
  ({ default: db } = await import('../lib/db.js'));
  await db.run("ALTER TABLE users ADD COLUMN telegram_id TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN discord_id TEXT").catch(() => {});
});

afterAll(async () => {
  await db.close();
});

test('telegram join group awards xp when member', async () => {
  const agent = request.agent(app);
  await agent.post('/api/session/bind-wallet').send({ wallet: 'w1' });
  await db.run("INSERT INTO quests (id, code, title, xp, requirement, active) VALUES (1,'tg_join_group','Join TG',50,'tg_group_member',1)");
  await db.run("UPDATE users SET telegram_id = ? WHERE wallet = ?", ['tg123', 'w1']);

  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ result: { status: 'member' } })
  });

  const res = await agent
    .post('/api/quests/telegram/join/verify')
    .send({ target: 'group' });

  expect(res.status).toBe(200);
  expect(res.body.results[0].status).toBe('completed');
  const row = await db.get('SELECT xp FROM users WHERE wallet=?', 'w1');
  expect(row.xp).toBe(50);
});

test('discord guild verify awards xp', async () => {
  const agent = request.agent(app);
  await agent.post('/api/session/bind-wallet').send({ wallet: 'w2' });
  await db.run("INSERT INTO quests (id, code, title, xp, requirement, active) VALUES (2,'JOIN_DISCORD','Join Discord',40,'join_discord',1)");
  await db.run("UPDATE users SET discord_id = ? WHERE wallet = ?", ['dc123', 'w2']);

  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({})
  });

  const res = await agent.post('/api/quests/discord/join/verify');
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('completed');
  const row = await db.get('SELECT xp FROM users WHERE wallet=?', 'w2');
  expect(row.xp).toBe(40);
});
