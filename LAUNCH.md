# Launch Checklist

## Environment matrix

### Render (backend)

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `SQLITE_FILE` | `/var/data/7go.sqlite` |
| `SESSION_SECRET` | _(secret)_ |
| `SESSIONS_DIR` | `/var/data` |
| `COOKIE_SECURE` | `true` |
| `SUBSCRIPTION_WEBHOOK_SECRET` | _(secret)_ |
| `TOKEN_SALE_WEBHOOK_SECRET` | _(secret)_ |
| `SUBSCRIPTION_BONUS_XP` | `120` |
| `TON_NETWORK` | `mainnet` |
| `TON_RECEIVE_ADDRESS` | `EQ…` |
| `TON_VERIFIER` | `toncenter` |
| `TON_MIN_PAYMENT_TON` | `10` |
| `TONCENTER_API_KEY` | _(secret)_ |

### Vercel (frontend)

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | `https://sevengoldencowries-backend.onrender.com` |
| `REACT_APP_TON_RECEIVE_ADDRESS` | `EQ…` |
| `REACT_APP_TON_MIN_PAYMENT_TON` | `10` |
| `REACT_APP_SUBSCRIPTION_CALLBACK` | `https://7goldencowries.com/subscription/callback` |

## Disk

1GB mounted at `/var/data`

## Migrations

```bash
npm run migrate:quests
```

## Start

```bash
PORT=4000 node server.js
```

## Render

Node web service with 1GB persistent disk at `/var/data`.

## Manual SLO checks

- `/api/users/me` ≤1 call per foreground action, ≤1/minute passive polling.
- `/api/v1/payments/status` and `/api/v1/subscription/status` return in <500 ms (no CDN cache).
- Cookies remain `HttpOnly`, `Secure`, `SameSite=None` when `COOKIE_SECURE=true`.

## Smoke tests

```bash
BACKEND=https://sevengoldencowries-backend.onrender.com
curl -s $BACKEND/healthz
curl -s $BACKEND/api/meta/progression | jq
curl -s -H "x-wallet: UQTestWallet123" $BACKEND/api/quests | jq
curl -s -H "x-wallet: UQTestWallet123" -H "Content-Type: application/json" -d '{"questId":"join_telegram"}' $BACKEND/api/quests/claim | jq
curl -s -H "x-wallet: UQTestWallet123" $BACKEND/api/users/me | jq
curl -s -b cookies.txt -c cookies.txt -X POST -H "Content-Type: application/json" -d '{"wallet":"EQTestWallet123"}' $BACKEND/api/session/bind-wallet | jq
curl -s -b cookies.txt -c cookies.txt $BACKEND/api/v1/payments/status | jq
curl -s -b cookies.txt -c cookies.txt $BACKEND/api/v1/subscription/status | jq
curl -s -b cookies.txt -c cookies.txt -X POST -H "Content-Type: application/json" -d '{"txHash":"demo","comment":"7GC-SUB:demo"}' $BACKEND/api/v1/payments/verify | jq
curl -s -b cookies.txt -c cookies.txt -X POST -H "Content-Type: application/json" -d '{"tier":"Tier 1"}' $BACKEND/api/v1/subscription/subscribe | jq
```

## Paywall flow validation

1. Bind wallet → verify TON transfer → confirm `/api/v1/payments/status` flips to `{ paid: true }`.
2. Ensure `/api/v1/subscription/subscribe` responds with a session URL (non-fatal if Render unreachable).
3. Claim bonus once; repeat claim returns `{ xpDelta: 0 }`.
