#!/usr/bin/env bash

set -euo pipefail

environment="${1:-dev}"

if [[ "${environment}" != "dev" && "${environment}" != "stage" && "${environment}" != "prod" ]]; then
  echo "Usage: $0 [dev|stage|prod]"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required."
  exit 1
fi

env_file="env/${environment}.env"
env_example_file="env/${environment}.env.example"

if [[ ! -f "${env_file}" ]]; then
  cp "${env_example_file}" "${env_file}"
  echo "Created ${env_file} from template."
fi

docker compose \
  --env-file "${env_file}" \
  -f infra/compose/base.yml \
  -f "infra/compose/${environment}.yml" \
  up -d postgres redis minio minio-init

echo "Provisioned ${environment} services:"
echo "- Postgres: localhost:$(grep '^POSTGRES_PORT=' "${env_file}" | cut -d '=' -f2)"
echo "- Redis: localhost:$(grep '^REDIS_PORT=' "${env_file}" | cut -d '=' -f2)"
echo "- MinIO API: localhost:$(grep '^MINIO_PORT=' "${env_file}" | cut -d '=' -f2)"
echo "- MinIO Console: localhost:$(grep '^MINIO_CONSOLE_PORT=' "${env_file}" | cut -d '=' -f2)"
