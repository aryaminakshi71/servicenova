#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${MIGRATION_REHEARSAL_CONTAINER:-servicenova-migration-rehearsal}"
POSTGRES_IMAGE="${MIGRATION_REHEARSAL_IMAGE:-postgres:16-alpine}"
POSTGRES_PORT="${MIGRATION_REHEARSAL_PORT:-55439}"
POSTGRES_USER="${MIGRATION_REHEARSAL_USER:-postgres}"
POSTGRES_PASSWORD="${MIGRATION_REHEARSAL_PASSWORD:-password}"
POSTGRES_DB="${MIGRATION_REHEARSAL_DB:-servicenova}"
ROLLBACK_DB="${MIGRATION_REHEARSAL_ROLLBACK_DB:-servicenova_rollback}"
OUTPUT_DIR="${MIGRATION_REHEARSAL_OUTPUT_DIR:-test-results/migration-rehearsal}"

mkdir -p "$OUTPUT_DIR"

cleanup() {
	docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}

trap cleanup EXIT
cleanup

docker run -d \
	--name "$CONTAINER_NAME" \
	-e POSTGRES_USER="$POSTGRES_USER" \
	-e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
	-e POSTGRES_DB="$POSTGRES_DB" \
	-p "${POSTGRES_PORT}:5432" \
	"$POSTGRES_IMAGE" >/dev/null

for _ in $(seq 1 40); do
	if docker exec "$CONTAINER_NAME" pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1; then
		break
	fi
	sleep 1
done

if ! docker exec "$CONTAINER_NAME" pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1; then
	echo "[migration-rehearsal] Postgres did not become ready."
	exit 1
fi

export DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}"
bun run db:migrate
bun run db:seed

docker exec "$CONTAINER_NAME" pg_dump \
	-U "$POSTGRES_USER" \
	-d "$POSTGRES_DB" \
	--no-owner \
	--no-privileges \
	--format=plain >"$OUTPUT_DIR/forward-snapshot.sql"

docker exec "$CONTAINER_NAME" psql -U "$POSTGRES_USER" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${ROLLBACK_DB};" >/dev/null
docker exec "$CONTAINER_NAME" psql -U "$POSTGRES_USER" -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${ROLLBACK_DB};" >/dev/null

cat "$OUTPUT_DIR/forward-snapshot.sql" | docker exec -i "$CONTAINER_NAME" psql -U "$POSTGRES_USER" -d "$ROLLBACK_DB" -v ON_ERROR_STOP=1 >/dev/null

required_tables=(
	"technicians"
	"service_jobs"
	"integration_outbox"
	"idempotency_keys"
	"rate_limit_counters"
	"background_jobs"
)

for table_name in "${required_tables[@]}"; do
	table_count="$(docker exec "$CONTAINER_NAME" psql -U "$POSTGRES_USER" -d "$ROLLBACK_DB" -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='${table_name}';" | tr -d '[:space:]')"
	if [[ "$table_count" != "1" ]]; then
		echo "[migration-rehearsal] Required table missing after rollback rehearsal: ${table_name}"
		exit 1
	fi
done

DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}" node scripts/platform-db-check.mjs >"$OUTPUT_DIR/forward-check.json"
DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${ROLLBACK_DB}" node scripts/platform-db-check.mjs >"$OUTPUT_DIR/rollback-check.json"

cat >"$OUTPUT_DIR/rehearsal-summary.json" <<EOF
{
  "ok": true,
  "databaseUrl": "postgres://***@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}",
  "rollbackDatabase": "${ROLLBACK_DB}",
  "requiredTablesValidated": ${#required_tables[@]}
}
EOF

echo "[migration-rehearsal] Forward migration and rollback rehearsal succeeded"
