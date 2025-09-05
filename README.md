# 7 Golden Cowries Backend

Node/Express backend using SQLite for persistence.

## Environment

Required variables:

- `NODE_ENV=production`
- `SESSION_SECRET`
- `SQLITE_FILE=/var/data/7gc.sqlite`
- `SESSIONS_DIR=/var/data`
- `CORS_ORIGINS=https://7goldencowries.com,https://www.7goldencowries.com,https://7goldencowries-frontend.vercel.app`

## Disk

Provision a 1GB disk mounted at `/var/data`.

## Migrations

```bash
npm run migrate:quests
```

## Start

```bash
node server.js
```

## Health

```bash
BACKEND=https://sevengoldencowries-backend.onrender.com
curl -s $BACKEND/healthz
```

## Smoke tests

```bash
BACKEND=https://sevengoldencowries-backend.onrender.com
curl -s $BACKEND/api/meta/progression | jq
curl -s -H "x-wallet: UQTestWallet123" $BACKEND/api/quests | jq
curl -s -H "x-wallet: UQTestWallet123" -H "Content-Type: application/json" -d '{"questId":"join_telegram"}' $BACKEND/api/quests/claim | jq
curl -s -H "x-wallet: UQTestWallet123" $BACKEND/api/users/me | jq
```
