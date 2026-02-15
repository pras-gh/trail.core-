BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS raw_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES sources(id),
  sync_run_id UUID NOT NULL REFERENCES sync_runs(id),
  filename TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  raw_blob_uri TEXT NOT NULL,
  raw_mime_type TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT raw_uploads_filename_non_empty_chk CHECK (btrim(filename) <> ''),
  CONSTRAINT raw_uploads_content_sha_non_empty_chk CHECK (btrim(content_sha256) <> ''),
  CONSTRAINT raw_uploads_raw_blob_uri_non_empty_chk CHECK (btrim(raw_blob_uri) <> ''),
  CONSTRAINT raw_uploads_raw_mime_type_non_empty_chk CHECK (btrim(raw_mime_type) <> '')
);

CREATE INDEX IF NOT EXISTS idx_raw_uploads_source_uploaded ON raw_uploads(source_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_uploads_sync_run ON raw_uploads(sync_run_id);
CREATE INDEX IF NOT EXISTS idx_raw_uploads_content_sha ON raw_uploads(content_sha256);

CREATE TABLE IF NOT EXISTS raw_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES raw_uploads(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  raw_json JSONB NOT NULL,
  row_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT raw_rows_row_index_non_negative_chk CHECK (row_index >= 0),
  CONSTRAINT raw_rows_raw_json_object_chk CHECK (jsonb_typeof(raw_json) = 'object'),
  CONSTRAINT raw_rows_row_sha_non_empty_chk CHECK (btrim(row_sha256) <> '')
);

CREATE INDEX IF NOT EXISTS idx_raw_rows_upload_row_index ON raw_rows(upload_id, row_index);
CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_rows_row_sha256 ON raw_rows(row_sha256);

CREATE TABLE IF NOT EXISTS normalized_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  row_sha256 TEXT NOT NULL REFERENCES raw_rows(row_sha256),
  occurred_at TIMESTAMPTZ,
  amount NUMERIC(18, 4) NOT NULL,
  currency TEXT NOT NULL,
  description TEXT NOT NULL,
  merchant TEXT,
  account_id TEXT,
  category TEXT,
  normalization_version TEXT NOT NULL DEFAULT 'v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT normalized_transactions_currency_non_empty_chk CHECK (btrim(currency) <> ''),
  CONSTRAINT normalized_transactions_description_non_empty_chk CHECK (btrim(description) <> ''),
  CONSTRAINT normalized_transactions_version_non_empty_chk CHECK (btrim(normalization_version) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_normalized_transactions_row_version
  ON normalized_transactions(row_sha256, normalization_version);
CREATE INDEX IF NOT EXISTS idx_normalized_transactions_occurred_at
  ON normalized_transactions(occurred_at DESC);

COMMIT;
