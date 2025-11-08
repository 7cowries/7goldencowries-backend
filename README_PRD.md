# 7GoldenCowries – PRD (Single Source of Truth)

**Version:** v1.2  
**Canonical PDF:** [/docs/7goldencowries_Final_Full_PRD_v1.2.pdf](./docs/7goldencowries_Final_Full_PRD_v1.2.pdf)

This PDF is the **only** authoritative specification for 7GoldenCowries.  
APIs, database schema, rate limits, payments (TON-only), and integrations must match the PRD.

## Backend Scope (per PRD)
- REST API per PRD (users, quests, referrals, staking, token sale, subscription)
- Wallet/session binding, rate limiting, and idempotency on sensitive endpoints
- TON-only payment verification and subscription logic
- Quest verification for **Twitter/X, Telegram, and Discord**
- Staking service: reward accrual, claim windows, and audit logs

## Environment & Infra
- Hosted on Render (or equivalent) with HTTPS and secure CORS  
- Security headers, WAF, and rate limits per PRD §Non-functional  
- See PRD §Environments & Secrets for full environment variable list

