#!/bin/sh
set -eu

export LC_ALL=C

fail() {
    printf 'Worker image preflight failed: %s\n' "$1" >&2
    exit 1
}

format_only=false
case "${1:-}" in
    --format-only)
        format_only=true
        shift
        ;;
    --help|-h)
        printf '%s\n' \
            'Usage: SIMSA_WORKER_IMAGE=registry/name@sha256:<64 lowercase hex> sh preflight-worker-image.sh [--format-only]' \
            '' \
            'Without --format-only, the script also checks Docker Compose >= 2.33.1' \
            'and confirms that the exact manifest digest is accessible to Docker.'
        exit 0
        ;;
esac

[ "$#" -eq 0 ] || fail 'unexpected argument (use --help for usage)'

image_ref=${SIMSA_WORKER_IMAGE:-}
[ -n "$image_ref" ] || fail 'SIMSA_WORKER_IMAGE is required'

image_pattern='^[a-z0-9]+([.-][a-z0-9]+)*(:[0-9]+)?/[a-z0-9]+([._-][a-z0-9]+)*(/[a-z0-9]+([._-][a-z0-9]+)*)*@sha256:[0-9a-f]{64}$'
printf '%s\n' "$image_ref" | grep -Eq "$image_pattern" \
    || fail 'SIMSA_WORKER_IMAGE must be a lowercase registry/repository@sha256 reference with exactly 64 hex characters and no tag'

repository=${image_ref%@sha256:*}
registry=${repository%%/*}
case "$registry" in
    localhost|*.*|*:*) ;;
    *) fail 'the image reference must begin with an explicit registry host (for example ghcr.io)' ;;
esac

if [ "$format_only" = true ]; then
    printf 'Worker image reference format is valid: %s\n' "$image_ref"
    exit 0
fi

command -v docker >/dev/null 2>&1 || fail 'Docker CLI is not installed'

compose_version=$(docker compose version --short 2>/dev/null) \
    || fail 'Docker Compose is unavailable'
compose_version=$(printf '%s\n' "$compose_version" | sed -E 's/^v//; s/[-+].*$//')
printf '%s\n' "$compose_version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' \
    || fail 'Docker Compose returned an unrecognized version'

old_ifs=$IFS
IFS=.
set -- $compose_version
IFS=$old_ifs
compose_major=$1
compose_minor=$2
compose_patch=$3

if [ "$compose_major" -lt 2 ] \
    || { [ "$compose_major" -eq 2 ] && [ "$compose_minor" -lt 33 ]; } \
    || { [ "$compose_major" -eq 2 ] && [ "$compose_minor" -eq 33 ] && [ "$compose_patch" -lt 1 ]; }; then
    fail "Docker Compose 2.33.1 or newer is required (found $compose_version)"
fi

docker manifest inspect "$image_ref" >/dev/null 2>&1 \
    || fail 'the exact image digest is unavailable; authenticate to the registry and confirm the release reference'

printf 'Worker image preflight passed: %s (Docker Compose %s)\n' "$image_ref" "$compose_version"
