BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- sources: move from source_key/display_name/source_type to name/kind
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sources' AND column_name = 'display_name'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sources' AND column_name = 'name'
  ) THEN
    EXECUTE 'ALTER TABLE sources RENAME COLUMN display_name TO name';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sources' AND column_name = 'source_type'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sources' AND column_name = 'kind'
  ) THEN
    EXECUTE 'ALTER TABLE sources RENAME COLUMN source_type TO kind';
  END IF;
END
$$;

ALTER TABLE sources ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS kind TEXT;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}'::jsonb;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE sources ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE sources
SET name = COALESCE(NULLIF(btrim(name), ''), 'source-' || SUBSTRING(id::text, 1, 8));

UPDATE sources
SET kind = COALESCE(NULLIF(btrim(kind), ''), 'manual_upload');

UPDATE sources
SET config = COALESCE(config, '{}'::jsonb),
    is_active = COALESCE(is_active, TRUE),
    created_at = COALESCE(created_at, NOW()),
    updated_at = COALESCE(updated_at, NOW());

ALTER TABLE sources ALTER COLUMN name SET NOT NULL;
ALTER TABLE sources ALTER COLUMN kind SET NOT NULL;
ALTER TABLE sources ALTER COLUMN config SET DEFAULT '{}'::jsonb;
ALTER TABLE sources ALTER COLUMN config SET NOT NULL;
ALTER TABLE sources ALTER COLUMN is_active SET DEFAULT TRUE;
ALTER TABLE sources ALTER COLUMN is_active SET NOT NULL;
ALTER TABLE sources ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE sources ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE sources ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE sources ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE sources DROP COLUMN IF EXISTS source_key;
CREATE INDEX IF NOT EXISTS idx_sources_kind ON sources(kind);

-- sync_runs: move to queued/running/succeeded/failed/partial + stats/error
ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS stats JSONB DEFAULT '{}'::jsonb;
ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS error JSONB;
ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

UPDATE sync_runs
SET status = 'running'
WHERE status = 'started';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sync_runs' AND column_name = 'cursor_start'
  ) THEN
    EXECUTE $sql$
      UPDATE sync_runs
      SET stats = COALESCE(stats, '{}'::jsonb)
        || jsonb_strip_nulls(
          jsonb_build_object(
            'cursor_start', cursor_start,
            'cursor_end', cursor_end,
            'records_seen', records_seen,
            'records_written', records_written
          )
        )
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sync_runs' AND column_name = 'metadata'
  ) THEN
    EXECUTE $sql$
      UPDATE sync_runs
      SET stats = COALESCE(stats, '{}'::jsonb) || COALESCE(metadata, '{}'::jsonb)
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sync_runs' AND column_name = 'error_message'
  ) THEN
    EXECUTE $sql$
      UPDATE sync_runs
      SET error = COALESCE(error, jsonb_build_object('message', error_message))
      WHERE error_message IS NOT NULL
    $sql$;
  END IF;
END
$$;

UPDATE sync_runs
SET status = COALESCE(status, 'queued'),
    stats = COALESCE(stats, '{}'::jsonb),
    created_at = COALESCE(created_at, started_at, NOW());

ALTER TABLE sync_runs DROP CONSTRAINT IF EXISTS sync_runs_status_check;
ALTER TABLE sync_runs
  ADD CONSTRAINT sync_runs_status_check
  CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'partial'));

ALTER TABLE sync_runs ALTER COLUMN status SET NOT NULL;
ALTER TABLE sync_runs ALTER COLUMN started_at DROP NOT NULL;
ALTER TABLE sync_runs ALTER COLUMN started_at DROP DEFAULT;
ALTER TABLE sync_runs ALTER COLUMN stats SET DEFAULT '{}'::jsonb;
ALTER TABLE sync_runs ALTER COLUMN stats SET NOT NULL;
ALTER TABLE sync_runs ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE sync_runs ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE sync_runs DROP COLUMN IF EXISTS cursor_start;
ALTER TABLE sync_runs DROP COLUMN IF EXISTS cursor_end;
ALTER TABLE sync_runs DROP COLUMN IF EXISTS records_seen;
ALTER TABLE sync_runs DROP COLUMN IF EXISTS records_written;
ALTER TABLE sync_runs DROP COLUMN IF EXISTS error_message;
ALTER TABLE sync_runs DROP COLUMN IF EXISTS metadata;

DROP INDEX IF EXISTS sync_runs_source_started_idx;
CREATE INDEX IF NOT EXISTS idx_sync_runs_source ON sync_runs(source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_runs_status ON sync_runs(status);

-- raw_events: align with canonical row-per-record contract
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'raw_events' AND column_name = 'source_occurred_at'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'raw_events' AND column_name = 'occurred_at'
  ) THEN
    EXECUTE 'ALTER TABLE raw_events RENAME COLUMN source_occurred_at TO occurred_at';
  END IF;
END
$$;

ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS upload_id UUID;
ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS raw_mime_type TEXT;
ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS raw_record_locator TEXT;
ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS parse_status TEXT DEFAULT 'pending';
ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS parse_error JSONB;
ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ;

UPDATE raw_events
SET raw_mime_type = CASE
  WHEN raw_blob_uri ILIKE '%.csv' OR raw_blob_uri ILIKE '%.csv?%' THEN 'text/csv'
  WHEN raw_blob_uri ILIKE '%.pdf' OR raw_blob_uri ILIKE '%.pdf?%' THEN 'application/pdf'
  ELSE 'application/octet-stream'
END
WHERE raw_mime_type IS NULL;

UPDATE raw_events
SET content_hash = encode(
  digest(
    COALESCE(payload::text, '') || '|' ||
    COALESCE(raw_blob_uri, '') || '|' ||
    COALESCE(raw_record_locator, ''),
    'sha256'
  ),
  'hex'
)
WHERE content_hash IS NULL OR btrim(content_hash) = '';

UPDATE raw_events
SET parse_status = 'error'
WHERE parse_status IS NULL AND parse_error IS NOT NULL;

UPDATE raw_events
SET parse_status = COALESCE(parse_status, 'parsed');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'raw_events' AND column_name = 'id' AND data_type <> 'uuid'
  ) THEN
    EXECUTE 'ALTER TABLE raw_events ALTER COLUMN id DROP DEFAULT';
    EXECUTE 'ALTER TABLE raw_events ALTER COLUMN id TYPE UUID USING gen_random_uuid()';
    EXECUTE 'ALTER TABLE raw_events ALTER COLUMN id SET DEFAULT gen_random_uuid()';
    EXECUTE 'DROP SEQUENCE IF EXISTS raw_events_id_seq';
  END IF;
END
$$;

WITH orphan_sources AS (
  SELECT DISTINCT source_id
  FROM raw_events
  WHERE sync_run_id IS NULL
),
created_runs AS (
  INSERT INTO sync_runs (source_id, status, started_at, finished_at, stats, error, created_at)
  SELECT source_id, 'partial', NOW(), NOW(), jsonb_build_object('backfilled_reason', 'missing_sync_run_id'), NULL, NOW()
  FROM orphan_sources
  RETURNING id, source_id
)
UPDATE raw_events re
SET sync_run_id = created_runs.id
FROM created_runs
WHERE re.source_id = created_runs.source_id
  AND re.sync_run_id IS NULL;

ALTER TABLE raw_events DROP CONSTRAINT IF EXISTS raw_events_sync_run_id_fkey;
ALTER TABLE raw_events
  ADD CONSTRAINT raw_events_sync_run_id_fkey
  FOREIGN KEY (sync_run_id) REFERENCES sync_runs(id);

ALTER TABLE raw_events ALTER COLUMN sync_run_id SET NOT NULL;
ALTER TABLE raw_events ALTER COLUMN raw_blob_uri SET NOT NULL;
ALTER TABLE raw_events ALTER COLUMN raw_mime_type SET NOT NULL;
ALTER TABLE raw_events ALTER COLUMN schema_version SET DEFAULT 1;
ALTER TABLE raw_events ALTER COLUMN schema_version SET NOT NULL;
ALTER TABLE raw_events ALTER COLUMN content_hash SET NOT NULL;
ALTER TABLE raw_events ALTER COLUMN parse_status SET DEFAULT 'pending';
ALTER TABLE raw_events ALTER COLUMN parse_status SET NOT NULL;
ALTER TABLE raw_events ALTER COLUMN ingested_at SET DEFAULT NOW();
ALTER TABLE raw_events ALTER COLUMN ingested_at SET NOT NULL;

ALTER TABLE raw_events DROP COLUMN IF EXISTS observed_who;
ALTER TABLE raw_events DROP COLUMN IF EXISTS observed_what;
ALTER TABLE raw_events DROP COLUMN IF EXISTS observed_when;
ALTER TABLE raw_events DROP COLUMN IF EXISTS observed_how;
ALTER TABLE raw_events DROP COLUMN IF EXISTS metadata;
ALTER TABLE raw_events DROP COLUMN IF EXISTS source_occurred_at;

ALTER TABLE raw_events DROP CONSTRAINT IF EXISTS raw_events_source_external_id_uk;
ALTER TABLE raw_events DROP CONSTRAINT IF EXISTS raw_events_source_content_hash_uk;
ALTER TABLE raw_events DROP CONSTRAINT IF EXISTS raw_events_payload_object_chk;
ALTER TABLE raw_events DROP CONSTRAINT IF EXISTS raw_events_payload_meta_object_chk;
ALTER TABLE raw_events DROP CONSTRAINT IF EXISTS raw_events_raw_blob_uri_non_empty_chk;
ALTER TABLE raw_events DROP CONSTRAINT IF EXISTS raw_events_raw_mime_type_non_empty_chk;
ALTER TABLE raw_events DROP CONSTRAINT IF EXISTS raw_events_content_hash_non_empty_chk;
ALTER TABLE raw_events DROP CONSTRAINT IF EXISTS raw_events_parse_status_chk;

ALTER TABLE raw_events
  ADD CONSTRAINT raw_events_parse_status_chk
  CHECK (parse_status IN ('pending', 'parsed', 'error', 'skipped'));
ALTER TABLE raw_events
  ADD CONSTRAINT raw_events_payload_object_chk
  CHECK (jsonb_typeof(payload) = 'object');
ALTER TABLE raw_events
  ADD CONSTRAINT raw_events_payload_meta_object_chk
  CHECK (NOT (payload ? '_meta') OR jsonb_typeof(payload -> '_meta') = 'object');
ALTER TABLE raw_events
  ADD CONSTRAINT raw_events_raw_blob_uri_non_empty_chk
  CHECK (btrim(raw_blob_uri) <> '');
ALTER TABLE raw_events
  ADD CONSTRAINT raw_events_raw_mime_type_non_empty_chk
  CHECK (btrim(raw_mime_type) <> '');
ALTER TABLE raw_events
  ADD CONSTRAINT raw_events_content_hash_non_empty_chk
  CHECK (btrim(content_hash) <> '');

DROP INDEX IF EXISTS raw_events_sync_run_idx;
DROP INDEX IF EXISTS raw_events_source_ingested_idx;
CREATE INDEX IF NOT EXISTS idx_raw_events_run ON raw_events(sync_run_id);
CREATE INDEX IF NOT EXISTS idx_raw_events_source ON raw_events(source_id, ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_events_parse_status ON raw_events(parse_status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_events_dedupe ON raw_events(source_id, content_hash);

DROP TRIGGER IF EXISTS raw_events_no_update ON raw_events;
DROP TRIGGER IF EXISTS raw_events_no_delete ON raw_events;

CREATE OR REPLACE FUNCTION prevent_raw_events_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'raw_events is append-only. % is not permitted.', TG_OP;
END;
$$;

CREATE TRIGGER raw_events_no_update
BEFORE UPDATE ON raw_events
FOR EACH ROW
EXECUTE FUNCTION prevent_raw_events_mutation();

CREATE TRIGGER raw_events_no_delete
BEFORE DELETE ON raw_events
FOR EACH ROW
EXECUTE FUNCTION prevent_raw_events_mutation();

COMMIT;
