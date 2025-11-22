# 7 Golden Cowries Frontend

React/TypeScript playground that consumes the backend APIs.

## Deployment

- Vercel builds should point `NEXT_PUBLIC_API_URL` to the production backend (`https://sevengoldencowries-backend.onrender.com`)
  so the live site calls the Render API base without relying on local rewrites.
- Smoke test the deployed site against PRD v1.2/v1.3 flows (paywall, subscription claim, social link/unlink) before marking rel
ease ready.

## How to test

1. Configure the backend to serve a quest with a proof requirement (for example an `x_follow` quest without any approved proof rows).
2. Load the Quests page, connect a wallet, and attempt to claim the gated quest.
3. The Claim button remains disabled after the API responds with `{ error: "proof-required" }` (or the legacy `proof_required`) and shows the tooltip reminding you to connect a proof provider before retrying.
