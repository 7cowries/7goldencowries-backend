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
- `POST /api/v1/token-sale/webhook` – idempotently records payment notifications and updates the matching contribution row.
- `POST /api/v1/subscription/subscribe` – accepts `{ wallet, tier }`, creates a pending subscription session, and returns `{ sessionUrl, sessionId }`.
- `GET /api/v1/subscription/callback?sessionId=...` – marks the session active, updates the user tier, and redirects back to the frontend with status/tier metadata.

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

