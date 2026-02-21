#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:3000}"
AUTH_HEADER="Authorization: Bearer manager:smoke"

for i in {1..20}; do
  curl -sS -X POST "$BASE_URL/api/field/jobs/assign" \
    -H "$AUTH_HEADER" \
    -H 'Content-Type: application/json' \
    -H "Idempotency-Key: smoke-$i" \
    -d '{"jobId":"job-100"}' >/dev/null
done

echo "smoke load complete: 20 assignment requests"
