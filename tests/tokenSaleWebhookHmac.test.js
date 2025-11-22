import request from 'supertest';
import { createHmac } from 'crypto';

let app;
let db;

const SUB_SECRET = 'test-sub-secret';
const TOKEN_SECRET = 'test-token-secret';

function signPayload(payload, secret = TOKEN_SECRET) {
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
    DELETE FROM token_sale_events;
    DELETE FROM token_sale_contributions;
  `);
});

afterAll(async () => {
  if (db) {
    await db.close();
  }
});

describe('token sale webhook HMAC + idempotency', () => {
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
      .set('X-Signature', 'sha256=bad')
      .send(JSON.stringify(payload));

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_signature');
  });

  test('processes new events once and ignores replays', async () => {
    const payload = {
      eventId: 'evt_valid_hmac',
      eventType: 'payment.paid',
      data: {
        sessionId: 'sess-abc',
        wallet: 'wallet-hmac',
        tonAmount: 200,
        usdAmount: 400,
        referralCode: 'ref-hmac',
        txHash: '0xdeadbeef',
        paymentStatus: 'paid',
      },
    };

    const { raw, signature } = signPayload(payload);

    const first = await request(app)
      .post('/api/v1/token-sale/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .send(raw);

    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);
    expect(first.body.status).toBe('paid');
    expect(first.body.eventId).toBe(payload.eventId);

    const contribution = await db.get(
      `SELECT wallet, ton_amount AS tonAmount, usd_amount AS usdAmount, referral_code AS referralCode, status, checkout_session_id AS checkoutSessionId
       FROM token_sale_contributions WHERE event_id = ?`,
      payload.eventId
    );
    expect(contribution.wallet).toBe('wallet-hmac');
    expect(contribution.tonAmount).toBe(200);
    expect(contribution.usdAmount).toBe(400);
    expect(contribution.referralCode).toBe('ref-hmac');
    expect(contribution.status).toBe('paid');
    expect(contribution.checkoutSessionId).toBe('sess-abc');

    const eventRow = await db.get(
      `SELECT eventId, raw FROM token_sale_events WHERE eventId = ?`,
      payload.eventId
    );
    expect(eventRow.eventId).toBe(payload.eventId);
    expect(JSON.parse(eventRow.raw)).toMatchObject(payload);

    const second = await request(app)
      .post('/api/v1/token-sale/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .send(raw);

    expect(second.status).toBe(200);
    expect(second.body.ok).toBe(true);
    expect(second.body.idempotent).toBe(true);

    const countContrib = await db.get(
      `SELECT COUNT(*) AS total FROM token_sale_contributions WHERE event_id = ?`,
      payload.eventId
    );
    expect(countContrib.total).toBe(1);

    const countEvents = await db.get(
      `SELECT COUNT(*) AS total FROM token_sale_events WHERE eventId = ?`,
      payload.eventId
    );
    expect(countEvents.total).toBe(1);
  });
});
