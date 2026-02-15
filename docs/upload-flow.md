# Upload Flow (CSV/PDF -> Storage -> raw_uploads/raw_rows)

## API Contract

`POST /upload` using `multipart/form-data`

Form fields:

- `file` (required): CSV or PDF
- `source_id` (optional): if omitted, API reuses or creates a default `manual_upload` source
- `external_id` (optional): client batch identifier

Response body:

- `upload_id`
- `sync_run_id`
- `status`
- `counts` (`total`, `inserted`, `duplicates`)
- `normalized_transactions` (inline mode: derived/attempted normalized rows; queued mode: `[]`)

## Behavior

1. Create `sync_runs` row with `status='queued'`.
2. Store upload bytes in object storage.
3. Persist file lineage in `raw_uploads` (`filename`, `content_sha256`, `raw_blob_uri`, `raw_mime_type`).
   - assign `source_system` (for example: `bank:hdfc_csv`, `bank:icici_csv`, `upi:gpay_export`).
4. Parse and write `raw_rows`:
   - Stage A `extract` (format-aware, no business logic):
     - CSV: read headers + rows and emit one record per data row.
     - PDF: emit one placeholder extracted record for the document.
   - Stage B `normalize` (still no business logic):
     - keep `raw_json` in original shape
     - compute deterministic `row_sha256`:
       - canonicalize row content (trim, NFKC, known-field date/number/text normalization, sorted-key serialization)
       - hash canonical JSON only (no `row_index` dependency)
5. Derive and write `normalized_transactions` (`normalization_version='v1'`) from `raw_rows` where required fields are available.
6. All inserts are conflict-safe for reruns:
   - `raw_rows`: `ON CONFLICT (source_system, row_sha256) DO NOTHING`
   - `normalized_transactions`: `ON CONFLICT (source_system, row_sha256, normalization_version) DO NOTHING`
7. Update `sync_runs` lifecycle:
   - `running` when parse starts
   - `succeeded` on completion (or `failed` with structured `error`)
   - `stats` populated with counts and parse timing

## Parse Mode

- `UPLOAD_PARSE_INLINE=true`: parse during request (default in `dev`)
- `UPLOAD_PARSE_INLINE=false`: queue parse in background worker/API process (default in `stage`/`prod` templates)

## Local Example

```bash
curl -X POST http://127.0.0.1:3000/upload \
  -F "file=@/path/to/sample.csv" \
  -F "external_id=batch-2026-02-14"
```
