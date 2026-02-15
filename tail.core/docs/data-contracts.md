# Data Contracts

Migration sources:
- `db/migrations/001_raw_contracts.sql`
- `db/migrations/002_alter_contracts_for_existing_dbs.sql`
- `db/migrations/003_raw_upload_rows_transactions.sql`
- `db/migrations/004_source_system_row_dedupe.sql`

Prisma migration source:
- `packages/db/prisma/migrations/20260215195500_raw_upload_rows_transactions/migration.sql`
- `packages/db/prisma/migrations/20260215221500_source_system_row_dedupe/migration.sql`

## Canonical Tables

### `sources`
Registry for providers/banks/connectors.

Key fields:
- `id`
- `name`
- `kind`
- `config`
- `is_active`

### `sync_runs`
Tracks each ingest execution lifecycle.

Key fields:
- `id`
- `source_id`
- `status` (`queued | running | succeeded | failed | partial`)
- `started_at`
- `finished_at`
- `stats`
- `error`

### `raw_uploads`
File-level metadata and lineage.

Key fields:
- `id`
- `source_id`
- `sync_run_id`
- `source_system` (for example: `bank:hdfc_csv`, `bank:icici_csv`, `upi:gpay_export`)
- `filename`
- `content_sha256` (full file hash)
- `raw_blob_uri`
- `raw_mime_type`
- `uploaded_at`

### `raw_rows`
One parsed raw record per extracted row/chunk.

Key fields:
- `id`
- `upload_id`
- `source_system`
- `row_index` (0-based)
- `raw_json` (original row/object, no business mapping)
- `row_sha256` (deterministic canonical hash)
- `created_at`

Constraints:
- `UNIQUE (source_system, row_sha256)`

### `normalized_transactions`
Canonical normalized transaction output.

Key fields:
- `id`
- `source_system`
- `row_sha256`
- `occurred_at`
- `amount` (signed decimal)
- `currency`
- `description`
- `merchant`
- `account_id`
- `category`
- `normalization_version`
- `created_at`

Constraints:
- `UNIQUE (source_system, row_sha256, normalization_version)`

## Idempotency Rules

- File-level checksum: `raw_uploads.content_sha256` hashes full file bytes.
- Row-level idempotency key: `(raw_rows.source_system, raw_rows.row_sha256)`.
- `row_sha256` is computed from canonicalized row content, not `row_index`.
- Writes must be retry-safe:

```sql
INSERT INTO raw_rows (...)
VALUES (...)
ON CONFLICT (source_system, row_sha256) DO NOTHING;
```

- Normalized writes must also be retry-safe:

```sql
INSERT INTO normalized_transactions (...)
VALUES (...)
ON CONFLICT (source_system, row_sha256, normalization_version) DO NOTHING;
```

## Canonical Hashing

v1 canonicalization rules before hashing:
- parse CSV into a row dictionary
- trim whitespace on all string fields
- normalize unicode with `NFKC`
- lowercase known text fields (`description`, `merchant`, `memo`, `narration`, `payee`, `details`)
- normalize known numeric fields (`amount`, `debit`, `credit`, `balance`, `fee`, `total`, `value`) into fixed-scale decimal strings
- normalize known date/time fields into ISO (`YYYY-MM-DD` or full `ISO 8601`)
- serialize with sorted keys and no insignificant whitespace

Then:
- CSV `row_sha256`: `sha256(canonical_json(row_content))`
- PDF `row_sha256`: `sha256(canonical_json(extracted_row_content))`

## Normalization Versioning

- Start with `normalization_version='v1'`.
- Introduce `v2`, `v3`, ... only when normalization logic meaningfully changes.
- Keep historical versions immutable.

## Legacy Table

`raw_events` remains as a legacy append-only contract for compatibility. New ingestion writes use `raw_uploads` and `raw_rows`.
