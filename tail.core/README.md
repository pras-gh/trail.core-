# tail.core

`tail.core` is a Turborepo monorepo for ingesting CSV/PDF uploads into canonical raw contracts (`raw_uploads` + `raw_rows`) with versioned normalization outputs.

## Stack

- Monorepo: Turborepo
- Language: TypeScript end-to-end
- API: NestJS (`apps/api`)
- Web: Next.js (`apps/web`)
- Worker: BullMQ (`apps/worker`)
- DB: PostgreSQL + Prisma (`packages/db`)
- Queue: Redis
- Storage: S3-compatible object storage
- Observability: Sentry (`web`, `api`, `worker`) + PostHog (web)

## Repository Layout

```text
.
|-- .github/workflows/
|-- apps/
|   |-- api/
|   |-- web/
|   `-- worker/
|-- packages/
|   |-- db/
|   |-- ingest/
|   `-- runtime/
|-- db/migrations/
|-- docs/
|-- env/
|-- infra/compose/
`-- scripts/
```

## Quick Start

1. Install dependencies:
   ```bash
   npm install --workspaces --include-workspace-root
   ```
2. Copy env templates:
   ```bash
   ./scripts/bootstrap-env.sh
   ```
3. Provision local infra (Postgres/Redis/MinIO):
   ```bash
   ./scripts/provision.sh dev
   ```
4. Load env values (example):
   ```bash
   set -a
   source env/dev.env
   set +a
   ```
5. Generate Prisma client and run migrations:
   ```bash
   npm run db:generate
   npm run db:migrate:dev
   ```
6. Run apps in parallel:
   ```bash
   npm run dev
   ```

Admin screen:
- open `http://127.0.0.1:3000` (web app)
- dashboard data endpoint: `GET /admin/overview`
- pages:
  - `/uploads/:uploadId` upload detail (metadata + raw rows + view normalized action)
  - `/rows/:rowSha256?upload_id=:uploadId` raw row detail (raw JSON + normalized side-by-side + status chips)
  - optional quick win: `/normalized` list with date/amount filters

## CI

- Local CI:
  ```bash
  npm run ci
  ```
- GitHub Actions:
  - `CI` workflow: lint + typecheck + tests
  - `Secrets Audit` workflow: verifies required GitHub environment secrets

## Vercel Deployment

- Web app:
  - set Vercel Root Directory to `apps/web`
  - framework: Next.js
- API app (if you deploy API on Vercel):
  - set Root Directory to `apps/api`
  - Vercel uses `/api/index.ts` serverless handler (included in this repo)
  - do not run the long-lived `src/main.ts` listener in Vercel serverless

## Contract Docs

- Data contracts: `docs/data-contracts.md`
- Upload flow: `docs/upload-flow.md`
- Storage layout: `docs/storage-layout.md`
- Secrets: `docs/secrets.md`
- Admin UI: `docs/admin-ui.md`

Canonical schema SQL references:
- `db/migrations/001_raw_contracts.sql`
- `db/migrations/002_alter_contracts_for_existing_dbs.sql`
- `db/migrations/003_raw_upload_rows_transactions.sql`
- `db/migrations/004_source_system_row_dedupe.sql`

Prisma migration source:
- `packages/db/prisma/migrations/20260214190000_init/migration.sql`
- `packages/db/prisma/migrations/20260215195500_raw_upload_rows_transactions/migration.sql`
- `packages/db/prisma/migrations/20260215221500_source_system_row_dedupe/migration.sql`
