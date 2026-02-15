BEGIN;

ALTER TABLE raw_uploads
  ADD COLUMN IF NOT EXISTS source_system TEXT;

ALTER TABLE raw_rows
  ADD COLUMN IF NOT EXISTS source_system TEXT;

ALTER TABLE normalized_transactions
  ADD COLUMN IF NOT EXISTS source_system TEXT;

WITH source_systems AS (
  SELECT
    s.id AS source_id,
    CASE
      WHEN COALESCE(NULLIF(btrim(lower(s.config ->> 'source_system')), ''), '') <> '' THEN
        CASE
          WHEN position(':' IN btrim(lower(s.config ->> 'source_system'))) > 0 THEN
            COALESCE(
              NULLIF(
                regexp_replace(
                  regexp_replace(
                    split_part(btrim(lower(s.config ->> 'source_system')), ':', 1),
                    '[^a-z0-9]+',
                    '_',
                    'g'
                  ),
                  '(^_+|_+$)',
                  '',
                  'g'
                ),
                ''
              ),
              'unknown'
            )
            || ':' ||
            COALESCE(
              NULLIF(
                regexp_replace(
                  regexp_replace(
                    substr(
                      btrim(lower(s.config ->> 'source_system')),
                      position(':' IN btrim(lower(s.config ->> 'source_system'))) + 1
                    ),
                    '[^a-z0-9]+',
                    '_',
                    'g'
                  ),
                  '(^_+|_+$)',
                  '',
                  'g'
                ),
                ''
              ),
              'unknown'
            )
          ELSE
            'source:' ||
            COALESCE(
              NULLIF(
                regexp_replace(
                  regexp_replace(btrim(lower(s.config ->> 'source_system')), '[^a-z0-9]+', '_', 'g'),
                  '(^_+|_+$)',
                  '',
                  'g'
                ),
                ''
              ),
              'unknown'
            )
        END
      ELSE
        COALESCE(
          NULLIF(
            regexp_replace(
              regexp_replace(btrim(lower(s.kind)), '[^a-z0-9]+', '_', 'g'),
              '(^_+|_+$)',
              '',
              'g'
            ),
            ''
          ),
          'unknown'
        )
        || ':' ||
        COALESCE(
          NULLIF(
            regexp_replace(
              regexp_replace(btrim(lower(s.name)), '[^a-z0-9]+', '_', 'g'),
              '(^_+|_+$)',
              '',
              'g'
            ),
            ''
          ),
          'unknown'
        )
    END AS source_system
  FROM sources s
)
UPDATE raw_uploads ru
SET source_system = ss.source_system
FROM source_systems ss
WHERE ru.source_id = ss.source_id
  AND (ru.source_system IS NULL OR btrim(ru.source_system) = '');

UPDATE raw_uploads
SET source_system = 'unknown:unknown'
WHERE source_system IS NULL OR btrim(source_system) = '';

UPDATE raw_rows rr
SET source_system = ru.source_system
FROM raw_uploads ru
WHERE rr.upload_id = ru.id
  AND (rr.source_system IS NULL OR btrim(rr.source_system) = '');

UPDATE raw_rows
SET source_system = 'unknown:unknown'
WHERE source_system IS NULL OR btrim(source_system) = '';

UPDATE normalized_transactions nt
SET source_system = rr.source_system
FROM raw_rows rr
WHERE nt.row_sha256 = rr.row_sha256
  AND (nt.source_system IS NULL OR btrim(nt.source_system) = '');

UPDATE normalized_transactions
SET source_system = 'unknown:unknown'
WHERE source_system IS NULL OR btrim(source_system) = '';

ALTER TABLE raw_uploads
  ALTER COLUMN source_system SET NOT NULL;

ALTER TABLE raw_rows
  ALTER COLUMN source_system SET NOT NULL;

ALTER TABLE normalized_transactions
  ALTER COLUMN source_system SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'raw_uploads_source_system_non_empty_chk'
  ) THEN
    ALTER TABLE raw_uploads
      ADD CONSTRAINT raw_uploads_source_system_non_empty_chk CHECK (btrim(source_system) <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'raw_rows_source_system_non_empty_chk'
  ) THEN
    ALTER TABLE raw_rows
      ADD CONSTRAINT raw_rows_source_system_non_empty_chk CHECK (btrim(source_system) <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'normalized_transactions_source_system_non_empty_chk'
  ) THEN
    ALTER TABLE normalized_transactions
      ADD CONSTRAINT normalized_transactions_source_system_non_empty_chk CHECK (btrim(source_system) <> '');
  END IF;
END $$;

ALTER TABLE normalized_transactions
  DROP CONSTRAINT IF EXISTS normalized_transactions_row_sha256_fkey;

ALTER TABLE normalized_transactions
  DROP CONSTRAINT IF EXISTS normalized_transactions_source_row_fkey;

DROP INDEX IF EXISTS uq_normalized_transactions_row_version;
DROP INDEX IF EXISTS uq_raw_rows_row_sha256;

CREATE INDEX IF NOT EXISTS idx_raw_uploads_source_system
  ON raw_uploads(source_system);

CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_rows_source_system_row_sha256
  ON raw_rows(source_system, row_sha256);

CREATE INDEX IF NOT EXISTS idx_raw_rows_source_system_row_sha256
  ON raw_rows(source_system, row_sha256);

ALTER TABLE normalized_transactions
  ADD CONSTRAINT normalized_transactions_source_row_fkey
  FOREIGN KEY (source_system, row_sha256)
  REFERENCES raw_rows(source_system, row_sha256)
  ON UPDATE CASCADE
  ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_normalized_transactions_source_row_version
  ON normalized_transactions(source_system, row_sha256, normalization_version);

CREATE INDEX IF NOT EXISTS idx_normalized_transactions_source_occurred_at
  ON normalized_transactions(source_system, occurred_at DESC);

COMMIT;
