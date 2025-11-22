import request from 'supertest';
import { createHmac } from 'crypto';

let app;
let db;

const SUB_SECRET = 'test-sub-secret';
const TOKEN_SECRET = 'test-token-secret';

function signPayload(payload, secret = SUB_SECRET) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const digest = createHmac('sha256', secret).update(raw).digest('hex');
  return { raw, signature: `sha256=${digest}` };
}

beforeAll(async () => {
  process.env.SQLITE_FILE = ':memory:';
  process.env.DATABASE_URL = process.env.SQLITE_FILE;
  process.env.NODE_ENV = 'test';
  process.env.SUBSCRIPTION_WEBHOOK_SECRET = SUB_SECRET;
  process.env.TOKEN_SALE_WEBHOOK_SECRET = TOKEN_SECRET;
  process.env.TWITTER_CONSUMER_KEY = 'test-key';
  process.env.TWITTER_CONSUMER_SECRET = 'test-secret';

  ({ default: app } = await import('../index.js'));
  ({ default: db } = await import('../lib/db.js'));
});

beforeEach(async () => {
  await db.exec(`
    DELETE FROM subscriptions;
    DELETE FROM users;
    DELETE FROM token_sale_events;
    DELETE FROM token_sale_contributions;
  `);
});

afterAll(async () => {
  if (db) {
    await db.close();
  }
});

describe('subscription callback HMAC', () => {
  test('rejects missing signature', async () => {
    const payload = { sessionId: 'missing_sig' };
    const res = await request(app)
      .post('/api/v1/subscription/callback')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload));

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('signature_required');
  });

  test('rejects invalid signature', async () => {
    const payload = { sessionId: 'bad_sig' };
    const res = await request(app)
      .post('/api/v1/subscription/callback')
      .set('Content-Type', 'application/json')
      .set('X-Signature', 'sha256=deadbeef')
      .send(JSON.stringify(payload));

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_signature');
  });

  test('activates pending session idempotently', async () => {
    const sessionId = 'sub_valid_456';
    const nonce = 'nonce-456';
    await db.run(
      `INSERT INTO subscriptions (wallet, tier, status, sessionId, nonce, sessionCreatedAt, timestamp)
       VALUES ('wallet-456', 'Tier 2', 'pending', ?, ?, ?, datetime('now'))`,
      sessionId,
      nonce,
      new Date().toISOString()
    );

    const payload = { sessionId, nonce };
    const { raw, signature } = signPayload(payload);

    const first = await request(app)
      .post('/api/v1/subscription/callback')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .send(raw);

    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);
    expect(first.body.status).toBe('active');
    expect(first.body.alreadyProcessed).not.toBe(true);

    const updated = await db.get(
      `SELECT status, renewalDate FROM subscriptions WHERE sessionId = ?`,
      sessionId
    );
    expect(updated.status).toBe('active');
    expect(typeof updated.renewalDate).toBe('string');

    const second = await request(app)
      .post('/api/v1/subscription/callback')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .send(raw);

    expect(second.status).toBe(200);
    expect(second.body.ok).toBe(true);
    expect(second.body.alreadyProcessed).toBe(true);

    const tierRow = await db.get(`SELECT tier FROM users WHERE wallet = 'wallet-456'`);
    expect(tierRow.tier).toBe('Tier 2');
  });
});
