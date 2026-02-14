# Storage Layout (Blobs)

Keep original uploads in object storage (S3/GCS/Azure Blob, or local S3-compatible storage in dev).

## Key Convention

Primary upload object key:

```text
uploads/{source_id}/{yyyy}/{mm}/{dd}/{upload_id}/{original_filename}
```

Example:

```text
uploads/2d14fb9d-0f89-4f13-a040-3e5f5d9b7302/2026/02/14/0f0225f3-f266-4ea1-ab95-e2ab5f5964d5/invoice_batch.csv
```

Derived artifacts (optional later):

```text
derived/{sync_run_id}/...
```

## URI in `raw_events`

`raw_events.raw_blob_uri` should point to the original uploaded object:

- `s3://bucket/<key>`
- `gs://bucket/<key>`
- `az://container/<key>` (or your chosen Azure URI scheme)
- `file:///...` for local/dev flows when needed

## Metadata Placement

Right now:

- keep minimal lineage metadata in `raw_events` (`raw_blob_uri`, `raw_mime_type`, `raw_record_locator`, `upload_id` if present)

Later (recommended):

- add an `uploads` table for richer blob-level metadata (checksum, size, uploader identity, storage provider info, retention/TTL, etc.)

## Notes

- Do not overwrite existing blob keys for immutable uploads.
- Use `upload_id` as the immutable directory segment to prevent filename collisions.
- Keep `original_filename` as provided for auditability.
