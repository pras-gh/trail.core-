# Secrets Management

This repository uses a two-layer approach:

- Local: `env/<environment>.env` files (never committed)
- Shared environments: GitHub Environment secrets (`dev`, `stage`, `prod`)

## Required Secret Keys (Minimum)

- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `MINIO_ROOT_USER`
- `MINIO_ROOT_PASSWORD`
- `STORAGE_BUCKET`
- `SENTRY_DSN_WEB`
- `SENTRY_DSN_API`
- `SENTRY_DSN_WORKER`

## Recommended Additional Keys

- `DATABASE_URL` (when using Neon/Supabase managed Postgres)
- `REDIS_URL` (when using managed Redis like Upstash)
- `STORAGE_ACCESS_KEY_ID`
- `STORAGE_SECRET_ACCESS_KEY`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `RESEND_API_KEY`
- `GUPSHUP_API_KEY` and `GUPSHUP_APP_NAME`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`
- `NEXT_PUBLIC_POSTHOG_KEY`
- `NEXT_PUBLIC_POSTHOG_HOST`

## Optional Upload Storage Keys

Use when object storage credentials differ from `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`:

- `STORAGE_ACCESS_KEY_ID`
- `STORAGE_SECRET_ACCESS_KEY`

## Local Development

1. Run:

   ```bash
   ./scripts/bootstrap-env.sh
   ```

2. Edit `env/dev.env` with local values.
3. Start services:

   ```bash
   ./scripts/provision.sh dev
   ```

## GitHub Environments

Create three GitHub Environments in the repo:

- `dev`
- `stage`
- `prod`

Set all required secret keys in each environment.

Run the `Secrets Audit` workflow manually and select the target environment to validate presence of required secrets.
