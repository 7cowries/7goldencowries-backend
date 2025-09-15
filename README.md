# 7 Golden Cowries Backend

Node/Express backend using SQLite for persistence.

## Setup

```bash
npm install
cp .env.example .env
# edit .env values
```

## Migrations

```bash
npm run migrate:quests
```

## Start

```bash
node server.js
```

## API

### Versioned (`/api/v1`)

- `POST /api/v1/token-sale/purchase` – accepts `{ wallet, amount, referralCode? }` and returns `{ paymentLink, sessionId }` for checkout hand-off.
- `POST /api/v1/token-sale/webhook` – requires an `X-Signature` HMAC header (see below) and upserts the contribution by `eventId`.
- `POST /api/v1/subscription/subscribe` – accepts `{ wallet, tier }`, creates a pending subscription session, and returns `{ sessionUrl, sessionId }`.
- `POST /api/v1/subscription/callback` – requires an HMAC-signed JSON payload, verifies the session with the payment provider stub, and activates the tier idempotently.

### Quest claim responses

Quest claim endpoints respond with consistent error keys. Proof-gated quests return `{ ok: false, error: "proof-required" }` when the user must submit or wait for an approved proof before claiming XP.

### Legacy (`/api`)

- `GET /api/meta/progression` – progression levels (cached)
- `GET /api/users/:wallet` – returns xp, tier, levelName, progress
- `POST /api/quests/claim?wallet=ADDR` `{ "questId": "..." }` – idempotent claim, responds with `alreadyClaimed` when repeated
- `GET /api/leaderboard` – top users by XP

### Tier multipliers

User tiers (Free, Tier1, Tier2, Tier3) are stored in the `users.tier` column.  XP boosts are defined in the
`tier_multipliers` table (`tier`, `multiplier`, `label`) and can be edited without code changes.  Claiming a quest
applies the multiplier and reports the effective XP.

Legacy endpoints `/quests` and `/complete` redirect to the new routes and will be removed after **1 Jan 2025**. Update clients before this date.

### Webhook signing

Subscription and token-sale webhooks must include an `X-Signature` header computed as an `HMAC-SHA256` digest over the **exact raw request body** (the bytes received on the wire before any JSON parsing). Prefix the digest with `sha256=` when setting the header:

```js
const rawBody = JSON.stringify(payload); // the literal string sent to the webhook
const signature = `sha256=${crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex')}`;
request.set('X-Signature', signature).send(rawBody);
```

Each flow uses its own secret for verification and idempotent processing:

- `SUBSCRIPTION_WEBHOOK_SECRET` – validates `POST /api/v1/subscription/callback` payloads before any database writes and activates sessions by `sessionId`.
- `TOKEN_SALE_WEBHOOK_SECRET` – validates `POST /api/v1/token-sale/webhook` events, stores the raw payload in `token_sale_events`, and dedupes contributions by `eventId`/`checkout_session_id`.

Webhook endpoints are also rate-limited to guard against bursts or replay storms:

- `WEBHOOK_WINDOW_MS` – sliding window size in milliseconds (default/recommended starting value: `60000`).
- `WEBHOOK_MAX_EVENTS` – maximum events allowed per window (default/recommended starting value: `120`).

Incoming bodies are rejected with `401` when the signature is missing or invalid. Subscription callbacks are idempotent by `sessionId` and safe to retry; token-sale events are stored once per `eventId` (falling back to `txHash`) and repeated deliveries respond with `{ ok: true, idempotent: true }`. The checkout and redirect URLs used in the subscription flow are restricted to allow-listed origins via `SUBSCRIPTION_CHECKOUT_URL` / `SUBSCRIPTION_CALLBACK_REDIRECT` and their respective `*_ALLOWLIST` overrides to prevent untrusted redirects.

## Disk

Provision a 1GB disk mounted at `/var/data`.

## Database roadmap

- SQLite powers development/staging today. A migration to a managed Postgres cluster is planned once connection details are available; `lib/db.js` contains the bootstrap logic that will be swapped for a pooled Postgres client.

## Health

```bash
curl -s $BACKEND/healthz
curl -s $BACKEND/api/health/db
```

## Tests

```bash
npm test
```

## Proof verification

Tweet-based quests require a proof token to be posted in a public tweet.  Tokens are derived from the wallet and quest id and are
verified asynchronously.

Environment:

- `PROOF_SECRET` – secret used to generate proof tokens.  Required for proof submission/verification.

Flow:

1. Client requests `/api/quests/submit-proof` with `{ wallet, questId, url }` where `url` is a tweet link.
2. Server normalizes the URL and stores a pending row in the `proofs` table.
3. Background task fetches the tweet HTML and checks for `#7GC-<token>`.
4. On success the proof status becomes `verified` and `/api/quests/claim` may be called.

Use `/api/quests/proof-status?wallet=...&questId=...` to poll for status updates.

