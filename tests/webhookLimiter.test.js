import request from 'supertest';
import { createHmac } from 'crypto';

let app;
let db;

const TOKEN_SECRET = 'rate-limit-secret';

function signPayload(payload, secret = TOKEN_SECRET) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const digest = createHmac('sha256', secret).update(raw).digest('hex');
  return { raw, signature: `sha256=${digest}` };
}

beforeAll(async () => {
  process.env.SQLITE_FILE = ':memory:';
  process.env.DATABASE_URL = process.env.SQLITE_FILE;
  process.env.NODE_ENV = 'test';
  process.env.SUBSCRIPTION_WEBHOOK_SECRET = 'sub-secret';
  process.env.TOKEN_SALE_WEBHOOK_SECRET = TOKEN_SECRET;
  process.env.WEBHOOK_WINDOW_MS = '2000';
  process.env.WEBHOOK_MAX_EVENTS = '3';
  process.env.TWITTER_CONSUMER_KEY = 'test-key';
  process.env.TWITTER_CONSUMER_SECRET = 'test-secret';

  ({ default: app } = await import('../server.js'));
  ({ default: db } = await import('../lib/db.js'));
});

beforeEach(async () => {
  await db.exec(`
    DELETE FROM token_sale_events;
    DELETE FROM token_sale_contributions;
  `);
});

afterAll(async () => {
  if (db) {
    await db.close();
  }
});

describe('webhook limiter', () => {
  test('returns 429 after exceeding the configured limit', async () => {
    for (let i = 0; i < 3; i += 1) {
      const payload = {
        eventId: `evt-rate-${i}`,
        eventType: 'payment.paid',
        data: {
          sessionId: `sess-${i}`,
          wallet: `wallet-${i}`,
          tonAmount: 10,
          usdAmount: 20,
          referralCode: null,
          txHash: `0xhash${i}`,
          paymentStatus: 'paid',
        },
      };

      const { raw, signature } = signPayload(payload);

      const res = await request(app)
        .post('/api/v1/token-sale/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Signature', signature)
        .send(raw);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    }

    const payload = {
      eventId: 'evt-rate-limit',
      eventType: 'payment.paid',
      data: {
        sessionId: 'sess-rate-limit',
        wallet: 'wallet-rate',
        tonAmount: 10,
        usdAmount: 20,
        referralCode: null,
        txHash: '0xhash-limit',
        paymentStatus: 'paid',
      },
    };

    const { raw, signature } = signPayload(payload);

    const res = await request(app)
      .post('/api/v1/token-sale/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .send(raw);

    expect(res.status).toBe(429);
  });
});
