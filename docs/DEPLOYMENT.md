# Deployment Guide

This document captures the end-to-end steps required to deploy the backend to Render with a persistent disk and the frontend to Vercel while keeping pull requests consistent with PRD v1.2 expectations.

## Branch and pull request workflow

- Create dedicated branches for backend and frontend changes before opening PRs against `main`.
- Each PR should summarize fixes, tests executed, database usage (including migrations), and deployment notes.
- Include the relevant Render and Vercel environment variables in the PR description whenever they change.

## Backend: Render deployment

1. **Service settings**
   - Runtime: **Node 20**.
   - Build command: `npm install` (Render will cache node modules).
   - Start command: `npm run render-start`.
2. **Environment**
   - Mount a **persistent disk** at `/var/data` with the database file stored at `/var/data/7gc.sqlite3` (`SQLITE_FILE` should point here).
   - Recommended variables: `NODE_ENV=production`, `PORT=4000`, `SESSION_SECRET`, `SESSIONS_DIR=/var/data`, `COOKIE_SECURE=true`, `SUBSCRIPTION_WEBHOOK_SECRET`, `TOKEN_SALE_WEBHOOK_SECRET`, `SUBSCRIPTION_BONUS_XP`, `TON_RECEIVE_ADDRESS`, `TON_MIN_PAYMENT_TON`, `TON_VERIFIER`, `TONCENTER_API_KEY`, `FRONTEND_URL`.
3. **Bootstrapping the database**
   - `npm start`/`npm run render-start` automatically runs `scripts/migrate-on-boot.mjs` to migrate `/var/data/7gc.sqlite3` in place.
   - For manual runs (one-off debugging), set `DATABASE_URL=/var/data/7gc.sqlite3` and run `npm run migrate:quests` or other migration scripts.
4. **Health checks**
   - Probes: `/healthz` and `/api/health` return JSON health responses; the root `/` route advertises service metadata and key payment routes.
5. **Deployment verification**
   - Confirm payment and subscription status endpoints respond in `<500 ms` from Render as outlined in the PRD v1.2 manual SLOs.
   - Validate webhook signatures (`X-Signature` with `sha256=` prefix) for `POST /api/v1/subscription/callback` and `POST /api/v1/token-sale/webhook`.

## Frontend: Vercel deployment

1. **Environment**
   - Set `NEXT_PUBLIC_API_URL` to the Render backend (`https://sevengoldencowries-backend.onrender.com`).
   - Mirror backend TON settings for UI display: `REACT_APP_TON_RECEIVE_ADDRESS`, `REACT_APP_TON_MIN_PAYMENT_TON`.
   - `REACT_APP_SUBSCRIPTION_CALLBACK` should remain `https://7goldencowries.com/subscription/callback`.
2. **Rewrites**
   - Ensure `vercel.json` is included so `/api/*` and `/ref/*` requests proxy to the backend without CORS preflights.
3. **Post-deploy validation**
   - Confirm critical flows in PRD v1.2/1.3: wallet binding, paywall transfer verification, subscription claim, social link/unlink, and quest claim toasts/confetti dispatches.
   - Verify the frontend issues at most one `GET /api/users/me` per user action and polls no more than once per minute during passive refresh.

## Production readiness checklist

- Database lives on the Render disk at `/var/data/7gc.sqlite3` with automatic migrations on boot.
- Webhooks and paywall flows adhere to PRD v1.2 contract (see `README_PRD.md` for canonical details).
- PR descriptions capture fixes, tests, DB notes, and deployment status for both backend and frontend branches.
- Render and Vercel environments mirror each other for TON addresses and subscription callback URLs.
