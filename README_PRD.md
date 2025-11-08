# 7GoldenCowries – PRD (Single Source of Truth)

**Version:** v1.2  
**Canonical PDF:** [/docs/7goldencowries_Final_Full_PRD_v1.2.pdf](./docs/7goldencowries_Final_Full_PRD_v1.2.pdf)

This PDF is the **only** authoritative specification for 7GoldenCowries.
APIs, DB schema, rate limits, payments (TON-only), and integrations must match the PRD.

## Backend Scope (per PRD)
- REST API (users, quests, referrals, staking, token sale, subscription)
- Wallet/session binding; rate limiting; idempotency
- TON-only payment verification & subscription logic
- Quest verification for Twitter/X, Telegram, Discord
- Staking: accrue rewards, claim windows, audit logs

## Environments & Infra
- Render (or equivalent) with HTTPS, CORS per PRD
- Security headers & WAF
- Rate limits per PRD §Non-functional
- See PRD §Environments & Secrets
