#!/usr/bin/env bash

set -euo pipefail

for environment in dev stage prod; do
  source_file="env/${environment}.env.example"
  target_file="env/${environment}.env"

  if [[ ! -f "${target_file}" ]]; then
    cp "${source_file}" "${target_file}"
    echo "Created ${target_file}"
  else
    echo "Skipped ${target_file} (already exists)"
  fi
done
