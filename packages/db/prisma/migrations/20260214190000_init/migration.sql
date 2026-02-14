BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sources_kind ON sources(kind);

CREATE TABLE IF NOT EXISTS sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES sources(id),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'partial')),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  error JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_source ON sync_runs(source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_runs_status ON sync_runs(status);

CREATE TABLE IF NOT EXISTS raw_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES sources(id),
  sync_run_id UUID NOT NULL REFERENCES sync_runs(id),
  upload_id UUID,
  raw_blob_uri TEXT NOT NULL,
  raw_mime_type TEXT NOT NULL,
  raw_record_locator TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  payload JSONB NOT NULL,
  external_id TEXT,
  content_hash TEXT NOT NULL,
  parse_status TEXT NOT NULL DEFAULT 'pending' CHECK (parse_status IN ('pending', 'parsed', 'error', 'skipped')),
  parse_error JSONB,
  occurred_at TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT raw_events_payload_object_chk CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT raw_events_payload_meta_object_chk CHECK (
    (payload ? '_meta')
    AND jsonb_typeof(payload -> '_meta') = 'object'
  ),
  CONSTRAINT raw_events_payload_meta_locator_chk CHECK (
    ((payload -> '_meta') ? 'locator')
    AND btrim(COALESCE((payload -> '_meta' ->> 'locator'), '')) <> ''
  ),
  CONSTRAINT raw_events_raw_blob_uri_non_empty_chk CHECK (btrim(raw_blob_uri) <> ''),
  CONSTRAINT raw_events_raw_mime_type_non_empty_chk CHECK (btrim(raw_mime_type) <> ''),
  CONSTRAINT raw_events_content_hash_non_empty_chk CHECK (btrim(content_hash) <> '')
);

CREATE INDEX IF NOT EXISTS idx_raw_events_run ON raw_events(sync_run_id);
CREATE INDEX IF NOT EXISTS idx_raw_events_source ON raw_events(source_id, ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_events_parse_status ON raw_events(parse_status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_events_dedupe ON raw_events(source_id, content_hash);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sources_set_updated_at ON sources;
CREATE TRIGGER sources_set_updated_at
BEFORE UPDATE ON sources
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION prevent_raw_events_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'raw_events is append-only. % is not permitted.', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS raw_events_no_update ON raw_events;
DROP TRIGGER IF EXISTS raw_events_no_delete ON raw_events;

CREATE TRIGGER raw_events_no_update
BEFORE UPDATE ON raw_events
FOR EACH ROW
EXECUTE FUNCTION prevent_raw_events_mutation();

CREATE TRIGGER raw_events_no_delete
BEFORE DELETE ON raw_events
FOR EACH ROW
EXECUTE FUNCTION prevent_raw_events_mutation();

COMMIT;
