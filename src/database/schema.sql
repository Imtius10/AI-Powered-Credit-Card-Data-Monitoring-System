CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  issuer TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fallback_source_url TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS card_current (
  card_id UUID PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  card_name TEXT,
  issuer TEXT,
  purchase_apr TEXT,
  balance_transfer_apr TEXT,
  annual_fee TEXT,
  other_fees TEXT,
  welcome_bonus TEXT,
  rewards_and_benefits TEXT,
  introductory_apr TEXT,
  restrictions TEXT,
  source_url TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  observation_id UUID,
  verified_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS card_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_url TEXT NOT NULL,
  source_mode TEXT NOT NULL CHECK (source_mode IN ('live', 'fixture')),
  source_content_hash TEXT NOT NULL,
  extraction JSONB NOT NULL DEFAULT '{}'::jsonb,
  verification JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('verified', 'pending_review', 'failed')),
  ai_model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(12, 8) NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS card_observations_card_observed_idx
  ON card_observations (card_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS card_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  observation_id UUID NOT NULL REFERENCES card_observations(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('INITIAL', 'UNCHANGED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED')
  ),
  evidence TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS card_changes_card_detected_idx
  ON card_changes (card_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS card_changes_observation_idx
  ON card_changes (observation_id);

CREATE TABLE IF NOT EXISTS source_cache (
  url TEXT PRIMARY KEY,
  etag TEXT,
  last_modified TEXT,
  content_hash TEXT NOT NULL,
  content TEXT NOT NULL,
  content_type TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (
    status IN ('running', 'succeeded', 'partial_failure', 'failed')
  ),
  cards_processed INTEGER NOT NULL DEFAULT 0,
  cards_failed INTEGER NOT NULL DEFAULT 0,
  changes_detected INTEGER NOT NULL DEFAULT 0,
  summary JSONB,
  error TEXT
);
