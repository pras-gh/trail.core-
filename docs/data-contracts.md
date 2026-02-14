# Data Contracts

Migration source: `db/migrations/001_raw_contracts.sql` and forward-only alters in `db/migrations/002_alter_contracts_for_existing_dbs.sql`.

## Table Definitions and Meaning

### `sources`
Represents where data comes from (manual upload, S3 drop, external system, API connector).

Key fields:
- `id`
- `name`
- `kind`
- `config`
- `is_active`

### `sync_runs`
Tracks each ingest attempt (upload batch or scheduled pull) and its lifecycle.

Key fields:
- `id`
- `source_id`
- `status`
- `started_at`
- `finished_at`
- `stats`
- `error`

### `raw_events`
One row per raw record (CSV row, extracted PDF chunk/page, etc.).

Key fields:
- `id`
- `source_id`
- `sync_run_id`
- `raw_blob_uri`
- `raw_mime_type`
- `raw_record_locator`
- `schema_version`
- `payload`
- `content_hash`
- `parse_status`
- `parse_error`
- `occurred_at`
- `ingested_at`

## `raw_events.payload` Required Fields

Rules:
- `payload` must be a JSON object.
- `payload._meta` is reserved for ingestion metadata.
- `payload._meta.locator` is required for every record.
- For CSV, preserve original column names as-is in payload keys (do not rename yet).

Examples:
- CSV: `{"Amount":"100","Customer Name":"Acme","_meta":{"locator":"row:42"}}`
- PDF stub: `{"text":"...","_meta":{"locator":"document:1"}}`

## Allowed `parse_status` Values

Allowed values:
- `pending`
- `parsed`
- `error`
- `skipped`

## Idempotency Rules and Uniqueness Constraints

- `content_hash` must be deterministic for the same canonical raw record.
- Uniqueness constraint: `UNIQUE (source_id, content_hash)`.
- Ingestion must be retry-safe using conflict-ignore semantics:

```sql
INSERT INTO raw_events (...)
VALUES (...)
ON CONFLICT (source_id, content_hash) DO NOTHING;
```

Deterministic hashing guidance:
- CSV: hash stable serialization of `(row + header mapping + locator)`.
- PDF: hash `(extracted text or bytes chunk + locator)`.

## Schema Versioning Policy

- `schema_version` starts at `1`.
- Bump `schema_version` only when `_meta` shape changes or canonical serialization changes.
- Do not bump for operational-only changes that do not alter payload shape/serialization.

## Raw Table Immutability

`raw_events` is append-only:
- no updates
- no deletes

All parsing/enrichment should happen in derived tables keyed by `raw_events.id`.
