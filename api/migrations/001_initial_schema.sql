-- migrations/001_initial_schema.sql
-- Initial Postgres schema for The Freedom Intelligence Field backend.
-- Idempotent: safe to re-run. Each CREATE uses IF NOT EXISTS where supported.
-- Reference: docs/proposals/data-model.md

-- ============================================================================
-- Extensions
-- ============================================================================

-- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- citext for case-insensitive email
CREATE EXTENSION IF NOT EXISTS "citext";

-- pgvector for future memory_summaries embeddings. Commented out so the
-- migration succeeds even on environments that don't have it. Enable manually
-- when adding the embedding column.
-- CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================================
-- Enums
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE user_tier AS ENUM ('preview', 'full', 'refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system_event');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- users
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                   citext UNIQUE NOT NULL,
  kajabi_member_id        text UNIQUE,
  thrivecart_customer_id  text UNIQUE,
  display_name            text,
  tier                    user_tier NOT NULL DEFAULT 'preview',
  preview_started_at      timestamptz,
  preview_ends_at         timestamptz,
  upgraded_at             timestamptz,
  pitch_eligible          boolean NOT NULL DEFAULT false,
  pitch_delivered_at      timestamptz,
  last_completed_day      smallint NOT NULL DEFAULT 0
                          CHECK (last_completed_day BETWEEN 0 AND 3),
  -- current_day is server-derived. Generated column means there is no way
  -- for application code to drift from this rule.
  current_day             smallint GENERATED ALWAYS AS
                          (LEAST(last_completed_day + 1, 3)) STORED,
  created_at              timestamptz NOT NULL DEFAULT NOW(),
  updated_at              timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_kajabi_member_id ON users (kajabi_member_id);
CREATE INDEX IF NOT EXISTS idx_users_thrivecart ON users (thrivecart_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_tier ON users (tier);

-- ============================================================================
-- sessions
-- ============================================================================
-- One logical chat thread per user. v1 = single session per user.

CREATE TABLE IF NOT EXISTS sessions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title                   text DEFAULT '72-Hour Power Reset',
  started_at              timestamptz NOT NULL DEFAULT NOW(),
  last_message_at         timestamptz,
  system_prompt_version   text,
  closed_at               timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_lastmsg
  ON sessions (user_id, last_message_at DESC);

-- ============================================================================
-- messages
-- ============================================================================
-- The conversation log. NEVER deleted, even when tier flips.

CREATE TABLE IF NOT EXISTS messages (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id              uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  user_id                 uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role                    message_role NOT NULL,
  content                 text NOT NULL,
  model                   text,
  input_tokens            integer,
  output_tokens           integer,
  stop_reason             text,
  tier_at_send            user_tier,
  day_at_send             smallint,
  system_prompt_version   text,
  system_prompt_hash      text,
  created_at              timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_session_created
  ON messages (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_user_created
  ON messages (user_id, created_at DESC);

-- ============================================================================
-- day_completions
-- ============================================================================
-- Structured Day N final output. The AI's persistent memory of commitments.

CREATE TABLE IF NOT EXISTS day_completions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  session_id              uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  day                     smallint NOT NULL CHECK (day IN (1, 2, 3)),
  variant                 text,
  branches_used           text[] NOT NULL DEFAULT '{}',
  data                    jsonb NOT NULL,
  schema_version          text NOT NULL,
  completed_at            timestamptz NOT NULL DEFAULT NOW(),
  message_id              uuid REFERENCES messages (id) ON DELETE SET NULL,
  -- v1 constraint: one completion per day per user. Relax later if full tier
  -- users re-run protocols.
  UNIQUE (user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_day_completions_user_day
  ON day_completions (user_id, day, completed_at DESC);

-- ============================================================================
-- webhook_events
-- ============================================================================
-- Append-only log of inbound webhooks. ThriveCart, Kajabi, anything else.
-- The handler reads from this table and writes to users. Replayable.

CREATE TABLE IF NOT EXISTS webhook_events (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source                  text NOT NULL,
  event_type              text NOT NULL,
  external_id             text,
  payload                 jsonb NOT NULL,
  signature_verified      boolean NOT NULL DEFAULT false,
  processed_at            timestamptz,
  processing_error        text,
  user_id                 uuid REFERENCES users (id) ON DELETE SET NULL,
  received_at             timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_unprocessed
  ON webhook_events (received_at) WHERE processed_at IS NULL;

-- ============================================================================
-- memory_summaries
-- ============================================================================
-- Forward-looking. Empty in v1. Schema created now so we don't migrate later.
-- Add the embedding column in a separate migration once pgvector is enabled.

CREATE TABLE IF NOT EXISTS memory_summaries (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind                    text NOT NULL,
  content                 text NOT NULL,
  -- embedding         vector(1536),  -- add via 002_add_embedding.sql later
  source_message_ids      uuid[] NOT NULL DEFAULT '{}',
  source_completion_ids   uuid[] NOT NULL DEFAULT '{}',
  period_start            timestamptz,
  period_end              timestamptz,
  created_at              timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_summaries_user_kind_period
  ON memory_summaries (user_id, kind, period_end DESC);

-- ============================================================================
-- audit_log
-- ============================================================================
-- Generic audit trail. Used for tier flips, pitch delivery, day advances.

CREATE TABLE IF NOT EXISTS audit_log (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type              text,
  actor_id                text,
  action                  text NOT NULL,
  user_id                 uuid REFERENCES users (id) ON DELETE SET NULL,
  before                  jsonb,
  after                   jsonb,
  created_at              timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user
  ON audit_log (user_id, created_at DESC);

-- ============================================================================
-- updated_at trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
