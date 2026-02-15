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

## URI in `raw_uploads`

`raw_uploads.raw_blob_uri` points to the original uploaded object:

- `s3://bucket/<key>`
- `gs://bucket/<key>`
- `az://container/<key>` (or your chosen Azure URI scheme)
- `file:///...` for local/dev flows when needed

## Metadata Placement

Current:
- file-level metadata in `raw_uploads`
- row-level raw records in `raw_rows`

Optional later:
- add richer upload metadata fields (size, uploader identity, retention/TTL, provider tags)

## Notes

- Do not overwrite existing blob keys for immutable uploads.
- Use `upload_id` as immutable directory segment to prevent filename collisions.
- Keep `original_filename` unchanged for auditability.
