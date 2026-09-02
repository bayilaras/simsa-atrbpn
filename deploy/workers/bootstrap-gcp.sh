#!/usr/bin/env bash
set -euo pipefail

umask 077

fail() {
    printf 'SIMSA GCP worker bootstrap failed: %s\n' "$1" >&2
    exit 1
}

for required in blkid curl docker findmnt gcloud grep install iptables mkfs.ext4 mount mountpoint python3 seq systemctl; do
    command -v "$required" >/dev/null 2>&1 || fail "$required is required in the hardened boot image"
done

metadata_url='http://metadata.google.internal/computeMetadata/v1'
metadata_get() {
    curl --fail --silent --show-error \
        --connect-timeout 2 \
        --max-time 10 \
        -H 'Metadata-Flavor: Google' \
        "$metadata_url/$1"
}

config_json=$(metadata_get 'instance/attributes/simsa-worker-config') \
    || fail 'simsa-worker-config metadata is unavailable'

json_value() {
    CONFIG_JSON=$config_json python3 - "$1" <<'PY'
import json
import os
import sys

value = json.loads(os.environ['CONFIG_JSON']).get(sys.argv[1])
if value is None or isinstance(value, (dict, list, bool)):
    raise SystemExit(1)
print(value)
PY
}

project_id=$(json_value project_id) || fail 'project_id is missing from bootstrap config'
secret_id=$(json_value worker_environment_secret) || fail 'worker secret ID is missing'
secret_version=$(json_value worker_environment_version) || fail 'worker secret version is missing'
worker_image=$(json_value worker_image) || fail 'worker image is missing'
proxy_image=$(json_value cloud_sql_proxy_image) || fail 'proxy image is missing'
registry_host=$(json_value artifact_registry_host) || fail 'registry host is missing'
connection_name=$(json_value cloud_sql_instance) || fail 'Cloud SQL connection name is missing'
database_name=$(json_value database_name) || fail 'database name is missing'
database_user=$(json_value database_user) || fail 'database user is missing'
db_pool_max=$(json_value db_pool_max) || fail 'database pool limit is missing'
upload_bucket=$(json_value upload_bucket) || fail 'upload bucket is missing'
final_bucket=$(json_value final_bucket) || fail 'final bucket is missing'
final_retention_seconds=$(json_value final_retention_seconds) || fail 'final retention is missing'
final_retention_margin_seconds=$(json_value final_retention_margin_seconds) || fail 'final retention margin is missing'
compose_directory=$(json_value compose_directory) || fail 'Compose directory is missing'
signature_device=$(json_value signature_device) || fail 'signature device is missing'

printf '%s\n' "$worker_image" | grep -Eq \
    '^[a-z0-9.-]+-docker[.]pkg[.]dev/.+@sha256:[0-9a-f]{64}$' \
    || fail 'worker image is not an immutable Artifact Registry digest'
printf '%s\n' "$proxy_image" | grep -Eq '@sha256:[0-9a-f]{64}$' \
    || fail 'Cloud SQL Auth Proxy image is not digest-pinned'
printf '%s\n' "$secret_version" | grep -Eq '^[1-9][0-9]*$' \
    || fail 'worker environment secret version must be numeric and pinned'
printf '%s\n' "$connection_name" | grep -Eq '^[a-z][a-z0-9-]{4,28}[a-z0-9]:[a-z0-9-]+:[a-z][a-z0-9-]{0,97}$' \
    || fail 'Cloud SQL connection name is malformed'
printf '%s\n' "$final_retention_seconds" | grep -Eq '^[0-9]+$' \
    || fail 'final retention must be integer seconds'
printf '%s\n' "$final_retention_margin_seconds" | grep -Eq '^[0-9]+$' \
    || fail 'final retention margin must be integer seconds'
[ "$final_retention_seconds" -ge 86400 ] && [ "$final_retention_seconds" -le 31536000 ] \
    || fail 'final retention must be between one day and one year'
[ "$final_retention_margin_seconds" -ge 300 ] && [ "$final_retention_margin_seconds" -le 86400 ] \
    || fail 'final retention margin must be between five minutes and one day'

[ -d "$compose_directory" ] || fail "Compose directory does not exist: $compose_directory"
for file in compose.yml compose.gcp.yml preflight-worker-image.sh simsa-blob-reconciler.service simsa-blob-reconciler.timer; do
    [ -f "$compose_directory/$file" ] || fail "missing reviewed worker bundle file: $file"
done

runtime_directory='/run/simsa-workers'
signature_mount='/var/lib/simsa/clamav'
socket_mount="$runtime_directory/cloudsql"
environment_file="$runtime_directory/worker.env"
clamav_update_subnet='172.31.250.0/28'

install -d -o root -g root -m 0700 "$runtime_directory"
install -d -o root -g root -m 0750 "$signature_mount"
# The proxy is non-root and the Node image has a separate UID. Authentication
# remains Cloud SQL IAM; this directory carries only the local Unix socket.
install -d -o root -g root -m 0777 "$socket_mount"

for _attempt in $(seq 1 60); do
    [ -b "$signature_device" ] && break
    sleep 2
done
[ -b "$signature_device" ] || fail "persistent signature disk did not appear: $signature_device"

filesystem_type=$(blkid -s TYPE -o value "$signature_device" 2>/dev/null || true)
if [ -z "$filesystem_type" ]; then
    mkfs.ext4 -F -m 0 "$signature_device"
elif [ "$filesystem_type" != 'ext4' ]; then
    fail "signature disk has unexpected filesystem: $filesystem_type"
fi

signature_uuid=$(blkid -s UUID -o value "$signature_device")
[ -n "$signature_uuid" ] || fail 'signature disk UUID is unavailable'
fstab_entry="UUID=$signature_uuid $signature_mount ext4 defaults,nofail,nodev,nosuid,noexec 0 2"
grep -Fq "UUID=$signature_uuid " /etc/fstab || printf '%s\n' "$fstab_entry" >> /etc/fstab

if ! mountpoint -q "$signature_mount"; then
    existing_mount=$(findmnt -n -o TARGET -S "$signature_device" 2>/dev/null || true)
    [ -z "$existing_mount" ] || fail "signature disk is already mounted at $existing_mount"
    mount "$signature_mount"
fi

# The ClamAV image's reviewed entrypoint owns/chowns the bind mount before
# dropping privileges. No application container receives this host path.
chmod 0750 "$signature_mount"

secret_tmp=$(mktemp "$runtime_directory/worker-secret.XXXXXX")
registry_logged_in=false
cleanup() {
    rm -f "$secret_tmp"
    if [ "$registry_logged_in" = true ]; then
        docker logout "$registry_host" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT
gcloud --quiet secrets versions access "$secret_version" \
    --project "$project_id" \
    --secret "$secret_id" > "$secret_tmp"

if grep -q $'\r' "$secret_tmp"; then
    fail 'worker environment secret must use LF line endings'
fi
if grep -Evq '^([A-Z][A-Z0-9_]*=.*|[[:space:]]*|#.*)$' "$secret_tmp"; then
    fail 'worker environment secret contains an invalid dotenv line'
fi

reserved_keys='^(SIMSA_WORKER_IMAGE|CLOUD_SQL_PROXY_IMAGE|CLOUD_SQL_INSTANCE_CONNECTION_NAME|CLOUD_SQL_UNIX_SOCKET|CLOUD_SQL_SOCKET_PATH|DATABASE_URL|DB_HOST|DB_PORT|DB_NAME|DB_USER|DB_PASSWORD|DB_SSL|DB_POOL_MAX|DB_APPLICATION_NAME|SIMSA_CLOUD_PLATFORM|AUTH_PROVIDER|OBJECT_STORAGE_PROVIDER|GOOGLE_CLOUD_PROJECT|FIREBASE_PROJECT_ID|GCS_UPLOAD_BUCKET|GCS_BUCKET|FINAL_RETENTION_SECONDS|FINAL_ORPHAN_RETENTION_MARGIN_SECONDS|BLOB_READ_WRITE_TOKEN|GOOGLE_APPLICATION_CREDENTIALS|CLAMAV_SIGNATURES_PATH|CLAMAV_UPDATE_SUBNET)='
if grep -Eq "$reserved_keys" "$secret_tmp"; then
    fail 'worker environment secret tries to override a Terraform-controlled or credential-file variable'
fi

install -o root -g root -m 0600 "$secret_tmp" "$environment_file"
cat >> "$environment_file" <<EOF
SIMSA_WORKER_IMAGE=$worker_image
CLOUD_SQL_PROXY_IMAGE=$proxy_image
CLOUD_SQL_INSTANCE_CONNECTION_NAME=$connection_name
CLOUD_SQL_UNIX_SOCKET=/cloudsql/$connection_name
CLOUD_SQL_SOCKET_PATH=$socket_mount
DATABASE_URL=
DB_HOST=
DB_PORT=5432
DB_NAME=$database_name
DB_USER=$database_user
DB_PASSWORD=
DB_SSL=false
DB_POOL_MAX=$db_pool_max
DB_APPLICATION_NAME=simsa-malware-worker
SIMSA_CLOUD_PLATFORM=gcp
AUTH_PROVIDER=firebase
OBJECT_STORAGE_PROVIDER=gcs
GOOGLE_CLOUD_PROJECT=$project_id
FIREBASE_PROJECT_ID=$project_id
GCS_UPLOAD_BUCKET=$upload_bucket
GCS_BUCKET=$final_bucket
FINAL_RETENTION_SECONDS=$final_retention_seconds
FINAL_ORPHAN_RETENTION_MARGIN_SECONDS=$final_retention_margin_seconds
BLOB_READ_WRITE_TOKEN=
CLAMAV_SIGNATURES_PATH=$signature_mount
CLAMAV_UPDATE_SUBNET=$clamav_update_subnet
EOF

# Only ClamAV joins this deterministic egress subnet. It needs FreshClam HTTPS
# but must not be able to mint the VM service account token from metadata.
iptables -C DOCKER-USER -s "$clamav_update_subnet" -d 169.254.169.254/32 -j REJECT 2>/dev/null \
    || iptables -I DOCKER-USER 1 -s "$clamav_update_subnet" -d 169.254.169.254/32 -j REJECT

printf '%s\n' "$(gcloud --quiet auth print-access-token)" \
    | docker login --username oauth2accesstoken --password-stdin "$registry_host" >/dev/null
registry_logged_in=true

export SIMSA_WORKER_IMAGE=$worker_image
sh "$compose_directory/preflight-worker-image.sh"

compose() {
    docker compose \
        --env-file "$environment_file" \
        -f "$compose_directory/compose.yml" \
        -f "$compose_directory/compose.gcp.yml" \
        --profile gcp "$@"
}

compose config --quiet
compose pull cloud-sql-proxy clamav malware-worker
compose up -d --no-build --pull never cloud-sql-proxy clamav malware-worker
docker logout "$registry_host" >/dev/null 2>&1 || true
registry_logged_in=false

install -o root -g root -m 0644 \
    "$compose_directory/simsa-blob-reconciler.service" \
    /etc/systemd/system/simsa-blob-reconciler.service
install -o root -g root -m 0644 \
    "$compose_directory/simsa-blob-reconciler.timer" \
    /etc/systemd/system/simsa-blob-reconciler.timer
systemctl daemon-reload
systemctl enable --now simsa-blob-reconciler.timer

compose ps
