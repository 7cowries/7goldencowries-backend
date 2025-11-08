# 7GoldenCowries – PRD (Single Source of Truth)

**Version:** v1.2  
**Canonical PDF:** [/docs/7goldencowries_Final_Full_PRD_v1.2.pdf](./docs/7goldencowries_Final_Full_PRD_v1.2.pdf)

This PDF is the **only** authoritative specification for 7GoldenCowries.  
All APIs, database schema, rate limits, payments (TON-only), and integrations must match the PRD.

## Backend Scope (per PRD)
- REST API endpoints for users, quests, referrals, staking, token sale, and subscription
- Wallet/session binding, secure rate limiting, and idempotent routes for sensitive actions
- TON-only payment verification and subscription logic
- Quest verification for **Twitter/X, Telegram, and Discord**
- Staking service: reward accrual, claim windows, audit logs

## Environment & Infrastructure
- Hosted on Render (or equivalent) with HTTPS, secure CORS, and WAF  
- Security headers, rate limits, and logging per PRD §Non-functional  
- See PRD §Environments & Secrets for full environment variable list

This PDF is the **only** authoritative specification for 7GoldenCowries.
APIs, DB schema, rate limits, payments (TON-only), and integrations must match the PRD.

### Backend Scope (per PRD)
- REST API per PRD (users, quests, referrals, staking, token sale, subscription).
- Wallet/session binding; rate limiting; idempotency on sensitive endpoints.
- TON-only payment verification and subscription logic.
- Quest verification for **Twitter/X, Telegram, Discord** as defined in PRD.
- Staking service: accrue rewards, claim windows, audit logs.

### Environment & Infra
- Render (or equivalent) with HTTPS, CORS per PRD.
- Security headers and WAF.
- Rate limits per PRD §Non-functional.
- See PRD §Environments & Secrets for complete list.

