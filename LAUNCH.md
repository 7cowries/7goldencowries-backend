# Launch Checklist

## Environment matrix

### Render (backend)

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `SQLITE_FILE` | `/var/data/7gc.sqlite` |
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
PORT=4000 node index.js
```

## Render

Node web service with 1GB persistent disk at `/var/data`.

## Deployment notes

- Add production domains in Vercel and keep the repo `vercel.json` rewrites intact.
- Render service mounts a persistent disk at `/var/data`, exports the environment matrix above, and runs `node index.js`.

## Smoke QA

1. Focus/visibility changes trigger at most one `GET /api/users/me` per focus event; passive refresh ≤1/minute.
2. Paywall flow: TonConnect button stages idle → pending → verifying → success with `POST /api/v1/payments/verify`, best-effort `POST /api/v1/subscription/subscribe`, `profile-updated`, and toast.
3. Subscription claim: first `POST /api/v1/subscription/claim` returns `{ xpDelta: 120 }`, second returns `{ xpDelta: 0 }` and the UI disables the CTA.
4. Social link/unlink produces exactly one toast, one confetti burst, and a single `profile-updated` dispatch.
5. Frontend build honours `GENERATE_SOURCEMAP=false` (no sourcemaps in production bundle).

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
2. Ensure `/api/v1/subscription/subscribe` responds with a session URL (non-fatal if Render unreachable; response stays `{ ok: true }`).
3. Claim bonus once; repeat claim returns `{ xpDelta: 0 }`.
