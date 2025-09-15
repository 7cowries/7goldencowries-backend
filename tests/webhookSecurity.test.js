import request from 'supertest';
import { createHmac } from 'crypto';

let app;
let db;

const SUB_SECRET = 'test-sub-secret';
const TOKEN_SECRET = 'test-token-secret';

function signPayload(payload, secret) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  return { raw, signature };
}

beforeAll(async () => {
  process.env.DATABASE_URL = ':memory:';
  process.env.NODE_ENV = 'test';
  process.env.SUBSCRIPTION_WEBHOOK_SECRET = SUB_SECRET;
  process.env.TOKEN_SALE_WEBHOOK_SECRET = TOKEN_SECRET;
  process.env.TWITTER_CONSUMER_KEY = 'test-key';
  process.env.TWITTER_CONSUMER_SECRET = 'test-secret';
  ({ default: app } = await import('../server.js'));
  ({ default: db } = await import('../lib/db.js'));
});

beforeEach(async () => {
  await db.exec(`
    DELETE FROM subscriptions;
    DELETE FROM users;
    DELETE FROM token_sale_contributions;
  `);
});

afterAll(async () => {
  if (db) {
    await db.close();
  }
});

describe('subscription callback security', () => {
  test('rejects missing signature', async () => {
    const payload = { sessionId: 'sub_missing' };
    const res = await request(app)
      .post('/api/v1/subscription/callback')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload));

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('signature_required');
  });

  test('rejects invalid signature', async () => {
    const payload = { sessionId: 'sub_invalid' };
    const res = await request(app)
      .post('/api/v1/subscription/callback')
      .set('Content-Type', 'application/json')
      .set('X-Signature', 'bad-signature')
      .send(JSON.stringify(payload));

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_signature');
  });

  test('valid signature activates session idempotently', async () => {
    const sessionId = 'sub_valid_123';
    const nonce = 'nonce-123';
    await db.run(
      `INSERT INTO subscriptions (wallet, tier, status, sessionId, nonce, sessionCreatedAt, timestamp)
       VALUES ('wallet-123', 'Tier 1', 'pending', ?, ?, ?, datetime('now'))`,
      sessionId,
      nonce,
      new Date().toISOString()
    );

    const payload = { sessionId, nonce };
    const { raw, signature } = signPayload(payload, SUB_SECRET);

    const first = await request(app)
      .post('/api/v1/subscription/callback')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .send(raw);

    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);
    expect(first.body.status).toBe('active');
    expect(first.body.alreadyProcessed).toBeUndefined();

    const updated = await db.get(
      `SELECT status, renewalDate FROM subscriptions WHERE sessionId = ?`,
      sessionId
    );
    expect(updated.status).toBe('active');
    expect(typeof updated.renewalDate).toBe('string');

    const repeat = await request(app)
      .post('/api/v1/subscription/callback')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .send(raw);

    expect(repeat.status).toBe(200);
    expect(repeat.body.ok).toBe(true);
    expect(repeat.body.alreadyProcessed).toBe(true);

    const users = await db.get(`SELECT tier FROM users WHERE wallet = 'wallet-123'`);
    expect(users.tier).toBe('Tier 1');
  });
});

describe('token sale webhook security', () => {
  test('rejects missing signature', async () => {
    const payload = { eventId: 'evt_missing' };
    const res = await request(app)
      .post('/api/v1/token-sale/webhook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload));

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('signature_required');
  });

  test('rejects invalid signature', async () => {
    const payload = { eventId: 'evt_invalid' };
    const res = await request(app)
      .post('/api/v1/token-sale/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature', 'nope')
      .send(JSON.stringify(payload));

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_signature');
  });

  test('accepts valid signature once per eventId', async () => {
    const eventPayload = {
      eventId: 'evt_valid_1',
      eventType: 'payment.paid',
      data: {
        sessionId: 'sess-1',
        wallet: 'wallet-evt',
        tonAmount: 150,
        usdAmount: 300,
        referralCode: 'ref-evt',
        txHash: '0xabc',
      },
    };
    const { raw, signature } = signPayload(eventPayload, TOKEN_SECRET);

    const first = await request(app)
      .post('/api/v1/token-sale/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .send(raw);

    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);
    expect(first.body.status).toBe('paid');

    const second = await request(app)
      .post('/api/v1/token-sale/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .send(raw);

    expect(second.status).toBe(200);
    expect(second.body.ok).toBe(true);

    const row = await db.get(
      `SELECT ton_amount AS tonAmount, status FROM token_sale_contributions WHERE event_id = ?`,
      eventPayload.eventId
    );
    expect(row.tonAmount).toBe(150);
    expect(row.status).toBe('paid');

    const count = await db.get(
      `SELECT COUNT(*) AS total FROM token_sale_contributions WHERE event_id = ?`,
      eventPayload.eventId
    );
    expect(count.total).toBe(1);
  });
});
