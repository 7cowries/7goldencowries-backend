# 7 Golden Cowries Backend

Node/Express backend using SQLite for persistence.

## Environment

Copy `.env.example` to `.env` and fill in the values. The SQLite file defaults to `/var/data/7gc.sqlite`.
When deploying on Render, mount a persistent disk at `/var/data`.

## Development

```bash
npm install
npm start
```

## Migrations

Run `npm run migrate:quests` after deploy to ensure the `active` column exists in the `quests` table.

## Health

`GET /healthz` returns `{ ok: true }`.
