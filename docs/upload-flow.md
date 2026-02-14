# Upload Flow (CSV/PDF -> Storage -> raw_events)

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

## Behavior

1. Create `sync_runs` row with `status='queued'`.
2. Store upload bytes into object storage.
3. Save blob URI to `raw_blob_uri` using configured key convention from `docs/storage-layout.md`.
4. Parse and write `raw_events`:
   - Stage A `extract` (format-aware, no business logic):
     - CSV: read headers + rows and emit one extracted record per row.
     - PDF: emit one placeholder extracted record for the whole document (`raw_record_locator=document:1`).
   - Stage B `normalize` (no business logic):
     - attach consistent `_meta` on each payload:
       - `_meta.source_id`
       - `_meta.sync_run_id`
       - `_meta.locator`
       - `_meta.filename`
     - include extraction hints (for example CSV `row`/`header_mapping`, or PDF `stub`).
     - compute deterministic `content_hash`:
       - CSV: sha256(stable JSON of row + header mapping + locator)
       - PDF: sha256(extracted text + locator)
5. Update `sync_runs` lifecycle:
   - `running` when parse starts
   - `succeeded` on completion (or `failed` with structured `error`)
   - `stats` populated with counts and parse timing

## Parse Mode

- `UPLOAD_PARSE_INLINE=true`: parse during request (default in `dev`)
- `UPLOAD_PARSE_INLINE=false`: queue parse in background in API process (default in `stage`/`prod` templates)

## Local Example

```bash
curl -X POST http://127.0.0.1:3000/upload \
  -F "file=@/path/to/sample.csv" \
  -F "external_id=batch-2026-02-14"
```
