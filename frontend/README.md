# 7 Golden Cowries Frontend

React/TypeScript playground that consumes the backend APIs.

## How to test

1. Configure the backend to serve a quest with a proof requirement (for example an `x_follow` quest without any approved proof rows).
2. Load the Quests page, connect a wallet, and attempt to claim the gated quest.
3. The Claim button remains disabled after the API responds with `{ error: "proof-required" }` (or the legacy `proof_required`) and shows the tooltip reminding you to connect a proof provider before retrying.
