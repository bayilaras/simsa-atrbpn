#!/usr/bin/env bash
set -Eeuo pipefail

# Execute exactly one database-maintenance phase behind a fresh Cloud SQL Auth
# Proxy.  The workflow authenticates a different WIF service account before
# each call, so the automatic IAM database login remains phase-specific.

MODE="${1:-}"
EVIDENCE_DIR="${EVIDENCE_DIR:-maintenance-evidence}"
PHASE_LABEL="${MAINTENANCE_PHASE:-$MODE}"

fail() {
  echo "::error::$*" >&2
  exit 1
}

require_value() {
  local name="$1"
  [ -n "${!name:-}" ] || fail "${name} is required"
}

for name in CLOUD_SQL_PROXY_BIN CLOUD_SQL_CONNECTION_NAME DB_NAME DATABASE_PRINCIPAL \
  MAINTENANCE_IMAGE EVIDENCE_DIR GITHUB_RUN_ID GITHUB_RUN_ATTEMPT; do
  require_value "$name"
done
[[ "$MODE" =~ ^(bootstrap|migrate|converge|seed|evidence)$ ]] || fail "unsupported maintenance mode"
[[ "$PHASE_LABEL" =~ ^[a-z][a-z0-9-]{0,40}$ ]] || fail "invalid maintenance phase label"
[[ "$CLOUD_SQL_CONNECTION_NAME" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]:[a-z]+-[a-z0-9]+[0-9]:[a-z][a-z0-9-]{0,96}[a-z0-9]$ ]] \
  || fail "invalid Cloud SQL connection name"
[[ "$DB_NAME" =~ ^[a-z][a-z0-9_]{2,62}$ ]] || fail "invalid application database name"
[[ "$DATABASE_PRINCIPAL" =~ ^[A-Za-z0-9][A-Za-z0-9._@-]{0,62}$ ]] || fail "invalid database principal"
[ -x "$CLOUD_SQL_PROXY_BIN" ] || fail "checksum-pinned Cloud SQL Auth Proxy is unavailable"
command -v docker >/dev/null || fail "docker is required on the private maintenance runner"
command -v python3 >/dev/null || fail "python3 is required for isolated proxy-port preflight"
mkdir -p "$EVIDENCE_DIR"

for principal_name in DB_API_PRINCIPAL DB_EVENT_PRINCIPAL DB_WORKER_PRINCIPAL \
  DB_FINAL_CLEANUP_PRINCIPAL DB_MAINTENANCE_PRINCIPAL DB_MIGRATOR_PRINCIPAL \
  DB_BACKUP_PRINCIPAL; do
  require_value "$principal_name"
  [[ "${!principal_name}" =~ ^[A-Za-z0-9][A-Za-z0-9._@-]{0,62}$ ]] \
    || fail "invalid ${principal_name}"
done

require_value DB_IDENTITY_PROJECT_ID
[[ "$DB_IDENTITY_PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] \
  || fail "invalid DB_IDENTITY_PROJECT_ID"
for service_account_name in DB_API_SERVICE_ACCOUNT DB_EVENT_SERVICE_ACCOUNT \
  DB_WORKER_SERVICE_ACCOUNT DB_FINAL_CLEANUP_SERVICE_ACCOUNT; do
  require_value "$service_account_name"
  [[ "${!service_account_name}" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$ ]] \
    || fail "invalid ${service_account_name}"
done

[[ "$GITHUB_RUN_ID" =~ ^[1-9][0-9]*$ && "$GITHUB_RUN_ATTEMPT" =~ ^[1-9][0-9]*$ ]] \
  || fail "invalid GitHub run identity for proxy port isolation"
PROXY_PORT=$((30000 + ((GITHUB_RUN_ID * 17 + GITHUB_RUN_ATTEMPT) % 10000)))
[ "$PROXY_PORT" -ge 1024 ] && [ "$PROXY_PORT" -le 65535 ] \
  || fail "derived Cloud SQL proxy port is outside the safe TCP range"
python3 - "$PROXY_PORT" <<'PY'
import socket
import sys

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as candidate:
    candidate.bind(('127.0.0.1', int(sys.argv[1])))
PY

proxy_log="$EVIDENCE_DIR/cloud-sql-proxy-${PHASE_LABEL}.log"
"$CLOUD_SQL_PROXY_BIN" \
  --address 127.0.0.1 \
  --port "$PROXY_PORT" \
  --private-ip \
  --auto-iam-authn \
  --exit-zero-on-sigterm \
  "$CLOUD_SQL_CONNECTION_NAME" >"$proxy_log" 2>&1 &
proxy_pid=$!

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if kill -0 "$proxy_pid" 2>/dev/null; then
    kill -TERM "$proxy_pid" 2>/dev/null || true
    wait "$proxy_pid" 2>/dev/null || true
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

ready=false
for _attempt in $(seq 1 30); do
  if ! kill -0 "$proxy_pid" 2>/dev/null; then
    fail "Cloud SQL Auth Proxy exited before accepting connections"
  fi
  if docker run --rm --network host --entrypoint pg_isready "$MAINTENANCE_IMAGE" \
      --host 127.0.0.1 --port "$PROXY_PORT" --timeout 2 >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
[ "$ready" = true ] || fail "Cloud SQL Auth Proxy did not become ready"

common_docker=(
  docker run --rm --network host --read-only
  --cap-drop ALL --security-opt no-new-privileges
  --tmpfs "/tmp:rw,noexec,nosuid,size=268435456"
  --env HOME=/tmp --env npm_config_cache=/tmp/npm-cache
  --env PGHOST=127.0.0.1 --env "PGPORT=$PROXY_PORT"
  --env "PGDATABASE=$DB_NAME" --env "PGUSER=$DATABASE_PRINCIPAL"
  --env "DB_NAME=$DB_NAME"
)

encoded_principal="${DATABASE_PRINCIPAL//@/%40}"
database_url="postgresql://${encoded_principal}@127.0.0.1:${PROXY_PORT}/${DB_NAME}?sslmode=disable"
phase_log="$EVIDENCE_DIR/${PHASE_LABEL}.log"

case "$MODE" in
  bootstrap)
    require_value DB_EXPECTED_CURRENT_OWNER
    [ "$DATABASE_PRINCIPAL" = "$DB_EXPECTED_CURRENT_OWNER" ] \
      || fail "bootstrap must use the configured grant-admin database principal"
    "${common_docker[@]}" \
      --env "DB_EXPECTED_CURRENT_OWNER=$DB_EXPECTED_CURRENT_OWNER" \
      --env "DB_IDENTITY_PROJECT_ID=$DB_IDENTITY_PROJECT_ID" \
      --env "DB_API_SERVICE_ACCOUNT=$DB_API_SERVICE_ACCOUNT" \
      --env "DB_EVENT_SERVICE_ACCOUNT=$DB_EVENT_SERVICE_ACCOUNT" \
      --env "DB_WORKER_SERVICE_ACCOUNT=$DB_WORKER_SERVICE_ACCOUNT" \
      --env "DB_FINAL_CLEANUP_SERVICE_ACCOUNT=$DB_FINAL_CLEANUP_SERVICE_ACCOUNT" \
      --env "DB_API_PRINCIPAL=$DB_API_PRINCIPAL" \
      --env "DB_EVENT_PRINCIPAL=$DB_EVENT_PRINCIPAL" \
      --env "DB_WORKER_PRINCIPAL=$DB_WORKER_PRINCIPAL" \
      --env "DB_FINAL_CLEANUP_PRINCIPAL=$DB_FINAL_CLEANUP_PRINCIPAL" \
      --env "DB_MAINTENANCE_PRINCIPAL=$DB_MAINTENANCE_PRINCIPAL" \
      --env "DB_MIGRATOR_PRINCIPAL=$DB_MIGRATOR_PRINCIPAL" \
      --env "DB_BACKUP_PRINCIPAL=$DB_BACKUP_PRINCIPAL" \
      "$MAINTENANCE_IMAGE" npm run db:roles:bootstrap 2>&1 | tee "$phase_log"
    ;;
  migrate)
    [ "$DATABASE_PRINCIPAL" = "$DB_MIGRATOR_PRINCIPAL" ] \
      || fail "migration must use the migrator database principal"
    "${common_docker[@]}" --env "DATABASE_URL=$database_url" \
      "$MAINTENANCE_IMAGE" npm run db:migrate 2>&1 | tee "$phase_log"
    ;;
  converge)
    [ "$DATABASE_PRINCIPAL" = "$DB_MIGRATOR_PRINCIPAL" ] \
      || fail "grant convergence must use the migrator database principal"
    require_value EXPECTED_MIGRATIONS_JSON
    "${common_docker[@]}" \
      --env "EXPECTED_MIGRATIONS_JSON=$EXPECTED_MIGRATIONS_JSON" \
      --env "DB_IDENTITY_PROJECT_ID=$DB_IDENTITY_PROJECT_ID" \
      --env "DB_API_SERVICE_ACCOUNT=$DB_API_SERVICE_ACCOUNT" \
      --env "DB_EVENT_SERVICE_ACCOUNT=$DB_EVENT_SERVICE_ACCOUNT" \
      --env "DB_WORKER_SERVICE_ACCOUNT=$DB_WORKER_SERVICE_ACCOUNT" \
      --env "DB_FINAL_CLEANUP_SERVICE_ACCOUNT=$DB_FINAL_CLEANUP_SERVICE_ACCOUNT" \
      --env "DB_API_PRINCIPAL=$DB_API_PRINCIPAL" \
      --env "DB_EVENT_PRINCIPAL=$DB_EVENT_PRINCIPAL" \
      --env "DB_WORKER_PRINCIPAL=$DB_WORKER_PRINCIPAL" \
      --env "DB_FINAL_CLEANUP_PRINCIPAL=$DB_FINAL_CLEANUP_PRINCIPAL" \
      --env "DB_MAINTENANCE_PRINCIPAL=$DB_MAINTENANCE_PRINCIPAL" \
      --env "DB_MIGRATOR_PRINCIPAL=$DB_MIGRATOR_PRINCIPAL" \
      --env "DB_BACKUP_PRINCIPAL=$DB_BACKUP_PRINCIPAL" \
      "$MAINTENANCE_IMAGE" \
      npm run db:grants:converge 2>&1 | tee "$phase_log"
    ;;
  seed)
    [ "$DATABASE_PRINCIPAL" = "$DB_MAINTENANCE_PRINCIPAL" ] \
      || fail "seed convergence must use the maintenance database principal"
    "${common_docker[@]}" --env "DATABASE_URL=$database_url" \
      "$MAINTENANCE_IMAGE" npm run seed:all 2>&1 | tee "$phase_log"
    ;;
  evidence)
    [ "$DATABASE_PRINCIPAL" = "$DB_MIGRATOR_PRINCIPAL" ] \
      || fail "database evidence must use the migrator database principal"
    evidence_sql="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/collect-database-maintenance-evidence.sql"
    [ -f "$evidence_sql" ] || fail "database evidence SQL is missing"
    require_value EXPECTED_MIGRATIONS_JSON
    "${common_docker[@]}" \
      --volume "$evidence_sql:/evidence/collect.sql:ro" \
      --entrypoint psql "$MAINTENANCE_IMAGE" \
      --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=on \
      --set "identity_project_id=$DB_IDENTITY_PROJECT_ID" \
      --set "api_service_account=$DB_API_SERVICE_ACCOUNT" \
      --set "event_service_account=$DB_EVENT_SERVICE_ACCOUNT" \
      --set "worker_service_account=$DB_WORKER_SERVICE_ACCOUNT" \
      --set "final_cleanup_service_account=$DB_FINAL_CLEANUP_SERVICE_ACCOUNT" \
      --set "api_principal=$DB_API_PRINCIPAL" \
      --set "event_principal=$DB_EVENT_PRINCIPAL" \
      --set "worker_principal=$DB_WORKER_PRINCIPAL" \
      --set "final_cleanup_principal=$DB_FINAL_CLEANUP_PRINCIPAL" \
      --set "maintenance_principal=$DB_MAINTENANCE_PRINCIPAL" \
      --set "migrator_principal=$DB_MIGRATOR_PRINCIPAL" \
      --set "backup_principal=$DB_BACKUP_PRINCIPAL" \
      --set "expected_migrations_json=$EXPECTED_MIGRATIONS_JSON" \
      --file /evidence/collect.sql >"$EVIDENCE_DIR/database-evidence.json"
    jq -e '
      .journal.count == 34 and
      .journal.latest_created_at == 1788060600000 and
      .evidence_role == "simsa_migrator" and
      .ownership_violations == 0 and
      .migrator_database_create == false and
      .migration_manifest_verified == true and
      .principal_memberships_verified == true and
      .role_membership_closure_verified == true and
      .runtime_identity_bindings.verified == true and
      .runtime_identity_bindings.project_id == env.DB_IDENTITY_PROJECT_ID and
      .seed.verified == true and
      (.acl_fingerprint_md5 | test("^[0-9a-f]{32}$")) and
      (.role_membership_fingerprint_md5 | test("^[0-9a-f]{32}$"))
    ' "$EVIDENCE_DIR/database-evidence.json" >/dev/null
    printf 'Database journal, ownership, ACL, principal membership, and seed evidence verified.\n' \
      >"$phase_log"
    ;;
esac
