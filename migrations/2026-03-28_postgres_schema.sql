CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  wallet TEXT UNIQUE NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  tier TEXT NOT NULL DEFAULT 'Free',
  subscriptionTier TEXT DEFAULT 'Free',
  levelName TEXT DEFAULT 'Shellborn',
  levelSymbol TEXT DEFAULT '🐚',
  levelProgress DOUBLE PRECISION DEFAULT 0,
  nextXP INTEGER DEFAULT 10000,
  referral_code TEXT UNIQUE,
  referred_by TEXT,
  socials TEXT DEFAULT '{}',
  twitterHandle TEXT,
  telegramId TEXT,
  telegramHandle TEXT,
  discordId TEXT,
  discordHandle TEXT,
  discordAccessToken TEXT,
  discordRefreshToken TEXT,
  discordTokenExpiresAt BIGINT,
  discordGuildMember INTEGER DEFAULT 0,
  paid INTEGER DEFAULT 0,
  lastPaymentAt TEXT,
  subscriptionPaidAt TEXT,
  subscriptionClaimedAt TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quests (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT 'All',
  kind TEXT DEFAULT 'link',
  requirement TEXT DEFAULT 'none',
  url TEXT DEFAULT '',
  xp INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  sort INTEGER DEFAULT 0,
  createdAt BIGINT DEFAULT EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::bigint,
  updatedAt BIGINT DEFAULT EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::bigint
);

CREATE TABLE IF NOT EXISTS completed_quests (
  id BIGSERIAL PRIMARY KEY,
  wallet TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(wallet, quest_id)
);

CREATE TABLE IF NOT EXISTS referrals (
  id BIGSERIAL PRIMARY KEY,
  referrer TEXT NOT NULL,
  referred TEXT NOT NULL,
  code TEXT UNIQUE,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(referred)
);

CREATE TABLE IF NOT EXISTS social_links (
  wallet TEXT PRIMARY KEY,
  twitter TEXT,
  telegram TEXT,
  discord TEXT,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quest_history (
  id BIGSERIAL PRIMARY KEY,
  wallet TEXT NOT NULL,
  quest_id TEXT,
  title TEXT,
  xp INTEGER DEFAULT 0,
  completed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quest_proofs (
  id BIGSERIAL PRIMARY KEY,
  wallet TEXT NOT NULL,
  quest_id INTEGER,
  vendor TEXT,
  url TEXT,
  tweet_id TEXT,
  status TEXT,
  details TEXT,
  createdAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  questId TEXT,
  UNIQUE(wallet, quest_id, url)
);

CREATE TABLE IF NOT EXISTS proofs (
  id BIGSERIAL PRIMARY KEY,
  wallet TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  url TEXT,
  provider TEXT,
  status TEXT,
  reason TEXT,
  tweet_id TEXT,
  handle TEXT,
  createdAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(wallet, quest_id)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id BIGSERIAL PRIMARY KEY,
  wallet TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'Free',
  tonAmount DOUBLE PRECISION DEFAULT 0,
  usdAmount DOUBLE PRECISION DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  sessionId TEXT UNIQUE,
  timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS token_sale_contributions (
  id BIGSERIAL PRIMARY KEY,
  wallet TEXT NOT NULL,
  ton_amount DOUBLE PRECISION NOT NULL,
  usd_amount DOUBLE PRECISION DEFAULT 0,
  referral_code TEXT,
  tx_hash TEXT,
  checkout_session_id TEXT UNIQUE,
  status TEXT,
  event_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS token_sale_events (
  eventId TEXT PRIMARY KEY,
  receivedAt TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw JSONB
);

CREATE TABLE IF NOT EXISTS tier_multipliers (
  tier TEXT PRIMARY KEY,
  multiplier DOUBLE PRECISION DEFAULT 1.0,
  label TEXT
);

CREATE TABLE IF NOT EXISTS sponsors (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  billing_mode TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS arenas (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  arena_type TEXT NOT NULL DEFAULT 'standard',
  entry_fee_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  entry_fee_currency TEXT NOT NULL DEFAULT 'TON',
  prize_pool_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  prize_pool_currency TEXT NOT NULL DEFAULT 'TON',
  status TEXT NOT NULL DEFAULT 'draft',
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  max_participants INTEGER,
  visibility TEXT NOT NULL DEFAULT 'public',
  scoring_mode TEXT NOT NULL DEFAULT 'xp',
  payout_mode TEXT NOT NULL DEFAULT 'manual',
  sponsor_id BIGINT REFERENCES sponsors(id),
  created_by TEXT,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  user_wallet TEXT NOT NULL,
  arena_id BIGINT REFERENCES arenas(id),
  payment_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_reference TEXT,
  external_order_id TEXT,
  external_transaction_id TEXT,
  amount DOUBLE PRECISION NOT NULL,
  currency TEXT NOT NULL,
  amount_usd_equiv DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'pending',
  checkout_url TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  paid_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS arena_participants (
  id BIGSERIAL PRIMARY KEY,
  arena_id BIGINT NOT NULL REFERENCES arenas(id),
  user_wallet TEXT NOT NULL,
  wallet TEXT NOT NULL,
  joined_via TEXT NOT NULL DEFAULT 'free',
  join_payment_id BIGINT REFERENCES payments(id),
  arena_xp INTEGER NOT NULL DEFAULT 0,
  rank_cached INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(arena_id, user_wallet)
);

CREATE TABLE IF NOT EXISTS arena_quests (
  id BIGSERIAL PRIMARY KEY,
  arena_id BIGINT NOT NULL REFERENCES arenas(id),
  quest_id TEXT NOT NULL,
  weight DOUBLE PRECISION NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(arena_id, quest_id)
);

CREATE TABLE IF NOT EXISTS arena_claims (
  id BIGSERIAL PRIMARY KEY,
  arena_id BIGINT NOT NULL REFERENCES arenas(id),
  quest_id TEXT NOT NULL,
  user_wallet TEXT NOT NULL,
  awarded_xp INTEGER NOT NULL DEFAULT 0,
  verification_status TEXT NOT NULL DEFAULT 'approved',
  proof_payload TEXT,
  source TEXT DEFAULT 'quest_claim',
  claimed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(arena_id, user_wallet, quest_id)
);

CREATE TABLE IF NOT EXISTS payment_events (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  external_reference TEXT,
  payload TEXT NOT NULL,
  processed INTEGER NOT NULL DEFAULT 0,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reward_rules (
  id BIGSERIAL PRIMARY KEY,
  arena_id BIGINT NOT NULL REFERENCES arenas(id),
  rank_from INTEGER NOT NULL,
  rank_to INTEGER NOT NULL,
  reward_type TEXT NOT NULL DEFAULT 'token',
  reward_amount DOUBLE PRECISION NOT NULL,
  reward_currency TEXT NOT NULL DEFAULT 'TON',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reward_payouts (
  id BIGSERIAL PRIMARY KEY,
  arena_id BIGINT NOT NULL REFERENCES arenas(id),
  user_wallet TEXT NOT NULL,
  rank_final INTEGER NOT NULL,
  payout_amount DOUBLE PRECISION NOT NULL,
  payout_currency TEXT NOT NULL DEFAULT 'TON',
  payout_provider TEXT NOT NULL DEFAULT 'manual',
  payout_status TEXT NOT NULL DEFAULT 'pending',
  payout_reference TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(arena_id, user_wallet, rank_final)
);

CREATE TABLE IF NOT EXISTS sponsor_applications (
  id BIGSERIAL PRIMARY KEY,
  brand_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  telegram_handle TEXT,
  twitter_handle TEXT,
  website_url TEXT,
  campaign_type TEXT NOT NULL,
  target_audience TEXT,
  desired_start_date TEXT,
  budget DOUBLE PRECISION DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sponsor_campaigns (
  id BIGSERIAL PRIMARY KEY,
  sponsor_id BIGINT NOT NULL REFERENCES sponsors(id),
  sponsor_application_id BIGINT REFERENCES sponsor_applications(id),
  campaign_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  slot_type TEXT NOT NULL,
  placement TEXT,
  arena_id BIGINT REFERENCES arenas(id),
  quest_id TEXT,
  budget DOUBLE PRECISION DEFAULT 0,
  payment_id BIGINT REFERENCES payments(id),
  status TEXT NOT NULL DEFAULT 'draft',
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  report_payload TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  data TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_quests_active ON quests(active);
CREATE INDEX IF NOT EXISTS idx_completed_wallet_qid_time ON completed_quests(wallet, quest_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_subscriptions_wallet_time ON subscriptions(wallet, timestamp);
CREATE INDEX IF NOT EXISTS idx_tokensale_wallet_time ON token_sale_contributions(wallet, created_at);
CREATE INDEX IF NOT EXISTS idx_arena_status_visibility ON arenas(status, visibility);
CREATE INDEX IF NOT EXISTS idx_arena_participants_arena_xp ON arena_participants(arena_id, arena_xp DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_provider_ref ON payments(provider, provider_reference);
