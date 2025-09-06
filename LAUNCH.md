# Launch Checklist

## Env vars

- NODE_ENV=production
- SESSION_SECRET
- DATABASE_URL=/var/data/7go.sqlite
- SESSIONS_DIR=/var/data
- CORS_ORIGINS=https://7goldencowries.com,https://www.7goldencowries.com,https://7goldencowries-frontend.vercel.app

## Disk

1GB mounted at `/var/data`

## Migrations

```bash
npm run migrate:quests
```

## Start

```bash
node server.js
```

## Render

Node web service with 1GB persistent disk at `/var/data`.

## Smoke tests

```bash
BACKEND=https://sevengoldencowries-backend.onrender.com
curl -s $BACKEND/healthz
curl -s $BACKEND/api/meta/progression | jq
curl -s -H "x-wallet: UQTestWallet123" $BACKEND/api/quests | jq
curl -s -H "x-wallet: UQTestWallet123" -H "Content-Type: application/json" -d '{"questId":"join_telegram"}' $BACKEND/api/quests/claim | jq
curl -s -H "x-wallet: UQTestWallet123" $BACKEND/api/users/me | jq
```
