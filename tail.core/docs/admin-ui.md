# Admin UI (Minimal)

## Page A: Upload Detail
Route: `/uploads/:uploadId`

Shows:
- upload metadata (`filename`, `uploaded_at`, `source`, `source_system`, `content_sha256`)
- raw rows table with:
  - `row_index`
  - key columns (`date`, `amount`, `description`)
  - `row_sha256`
  - status chips (`RAW_INSERTED`, `RAW_DUPLICATE`, `RAW_PENDING`)
  - normalized status chips (`NORMALIZED_EXISTS`, `NORMALIZED_MISSING`)
  - action: `View normalized` (opens row detail)

## Page B: Raw Row Detail
Route: `/rows/:rowSha256?upload_id=:uploadId`

Shows side-by-side:
- raw JSON (pretty printed)
- normalized transaction (`v1`) if it exists

Status chips:
- `RAW_DUPLICATE` (when viewing row with `upload_id` context that does not own the persisted raw row)
- `NORMALIZED_EXISTS`
- `NORMALIZED_MISSING`

## Optional Quick Win: Normalized List
Route: `/normalized`

Filters:
- date range (`from`, `to`)
- amount range (`min_amount`, `max_amount`)

Useful for fast operational review and triage.
