# 7 Golden Cowries Backend

Node/Express backend using SQLite for persistence.

## Setup

```bash
npm install
cp .env.example .env
# edit .env values or copy `.env.production` when preparing Render
```

## Environment matrices

### Render (backend)

| Variable | Value | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | Enables production logging/helmet defaults. |
| `PORT` | `4000` | Render service port. |
| `SQLITE_FILE` | `/var/data/7gc.sqlite` | SQLite database file (auto-migrated on boot when the file exists). |
| `SESSION_SECRET` | _(secret)_ | Session signing secret. |
| `SESSIONS_DIR` | `/var/data` | Persistent directory for Memorystore. |
| `COOKIE_SECURE` | `true` | Forces `Secure`/`SameSite=None` cookies in production. |
| `SUBSCRIPTION_WEBHOOK_SECRET` | _(secret)_ | HMAC key for `/api/v1/subscription/callback`. |
| `TOKEN_SALE_WEBHOOK_SECRET` | _(secret)_ | HMAC key for `/api/v1/token-sale/webhook`. |
| `SUBSCRIPTION_BONUS_XP` | `120` | XP reward for subscription claim. |
| `TON_RECEIVE_ADDRESS` | `EQ…` | Wallet receiving paywall transfers. |
| `TON_MIN_PAYMENT_TON` | `10` | Minimum TON accepted for paywall unlock. |
| `TON_VERIFIER` | `toncenter` | Payment verifier implementation. |
| `TONCENTER_API_KEY` | _(secret)_ | API key for TonCenter verification. |
| `FRONTEND_URL` | `https://7goldencowries.com` | Used for callback allowlist + redirects. |

### Vercel (frontend)

| Variable | Value | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `https://sevengoldencowries-backend.onrender.com` | Optional override for API base. |
| `REACT_APP_TON_RECEIVE_ADDRESS` | Mirrors backend `TON_RECEIVE_ADDRESS` | Displayed in UI and used for TonConnect transfer. |
| `REACT_APP_TON_MIN_PAYMENT_TON` | Mirrors backend minimum | Used to set TonConnect transfer amount. |
| `REACT_APP_SUBSCRIPTION_CALLBACK` | `https://7goldencowries.com/subscription/callback` | Redirect URL after hosted checkout. |

## Manual SLO checks

- Focused flows should issue **≤1** `GET /api/users/me` per user action (200 ms debounce, no storming).
- Passive refresh should poll `GET /api/users/me` at most once per minute.
- Confirm `/api/v1/payments/status` and `/api/v1/subscription/status` respond in `<500 ms` from Render (no CDN caching).
- Social link/unlink flows emit exactly one toast, one confetti event, and a single `profile-updated` dispatch.

## Migrations

```bash
npm run migrate:quests
```

## Start

```bash
PORT=4000 node server.js
```

## API

### Versioned (`/api/v1`)

- `POST /api/v1/token-sale/purchase` – accepts `{ wallet, amount, referralCode? }` and returns `{ paymentLink, sessionId }` for checkout hand-off.
- `POST /api/v1/token-sale/webhook` – requires an `X-Signature` HMAC header (see below) and upserts the contribution by `eventId`.
- `GET /api/v1/payments/status` – returns `{ paid: boolean }` for the current session wallet.
- `POST /api/v1/payments/verify` – accepts `{ txHash }` (TonConnect transfer hash) and verifies the transfer against `TON_RECEIVE_ADDRESS`; on success the user record is marked `paid`.
- `GET /api/v1/subscription/status` – returns `{ tier, paid, canClaim, bonusXp, claimedAt }` for the current wallet.
- `POST /api/v1/subscription/claim` – awards the configured `SUBSCRIPTION_BONUS_XP` once per paid wallet and records the event in `quest_history`.
- `POST /api/v1/subscription/subscribe` – creates a hosted checkout session (best-effort, idempotent) and stores the intended tier for the current wallet session.

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
curl -s $BACKEND/
curl -s $BACKEND/healthz
curl -s $BACKEND/api/health
```

The root route responds with the service name and key health/payment routes. `/healthz` and `/api/health` remain JSON health probes for Render/Vercel checks.

## Frontend rewrites

Deployments on Vercel must include the provided `vercel.json` so that `/api/*` and `/ref/*` requests are proxied to the Render backend without triggering CORS preflights. The frontend ships with an empty `REACT_APP_API_URL`, relying entirely on same-origin rewrites in production. Local development continues to use the CRA proxy (`http://localhost:4000`).

## Paywall flow

1. Wallet binds to the API session via `POST /api/session/bind-wallet`.
2. The user signs a TonConnect transfer; the backend verifies it through `POST /api/v1/payments/verify`, marking the wallet `paid` and stamping `subscriptionTier`/`subscriptionPaidAt`.
3. The frontend immediately issues a best-effort `POST /api/v1/subscription/subscribe` to record the hosted checkout session. On backend errors the response still returns `{ ok: true }` so the paywall flow can proceed.
4. A single `profile-updated` event is dispatched so UI consumers refresh `/api/users/me` and `/api/v1/subscription/status`.
5. `POST /api/v1/subscription/claim` unlocks the XP bonus once per paid period; re-claims return `{ xpDelta: 0 }` and UI disables the claim CTA.

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


> **Product Requirements (Single Source of Truth):** see `docs/7goldencowries_Final_Full_PRD_v1.2.pdf` (tag: `prd-v1.2`).

> **Product Requirements (Single Source of Truth):** see `docs/7goldencowries_Final_Full_PRD_v1.2.pdf` (tag: `prd-v1.2`).

> **Product Requirements (Single Source of Truth):** see `docs/7goldencowries_Final_Full_PRD_v1.2.pdf` (tag: `prd-v1.2`).
