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

## Health

```bash
curl -s $BACKEND/healthz
```

## Tests

```bash
npm test
```

