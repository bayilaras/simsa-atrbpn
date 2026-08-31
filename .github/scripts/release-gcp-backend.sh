#!/usr/bin/env bash
set -Eeuo pipefail

# Cloud Run release operations shared by the manually approved GitHub jobs.
# All deployment references are immutable digests. This script changes only a
# named application container and therefore preserves Terraform-managed
# sidecars, networking, service identities, secrets, probes, and scaling.

MODE="${1:-}"
EVIDENCE_DIR="${EVIDENCE_DIR:-release-evidence}"
mkdir -p "$EVIDENCE_DIR"

fail() {
  echo "::error::$*" >&2
  return 1
}

require_value() {
  local name="$1"
  [ -n "${!name:-}" ] || fail "${name} is required"
}

validate_common() {
  local name
  for name in PROJECT_ID REGION SERVICE CONTAINER COMMIT_SHA DEPLOYMENT_ENVIRONMENT; do
    require_value "$name"
  done
  [[ "$PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || fail "Invalid PROJECT_ID"
  [[ "$REGION" =~ ^[a-z]+-[a-z0-9]+[0-9]$ ]] || fail "Invalid REGION"
  [[ "$SERVICE" =~ ^[a-z][a-z0-9-]{0,62}$ ]] || fail "Invalid SERVICE"
  [[ "$CONTAINER" =~ ^[a-z][a-z0-9-]{0,62}$ ]] || fail "Invalid CONTAINER"
  [[ "$COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "COMMIT_SHA must be a full lowercase SHA"
  [[ "$DEPLOYMENT_ENVIRONMENT" =~ ^(preview|production)$ ]] \
    || fail "DEPLOYMENT_ENVIRONMENT must be preview or production"
  command -v gcloud >/dev/null
  command -v jq >/dev/null
  command -v curl >/dev/null
  command -v python3 >/dev/null
}

describe_service() {
  local target="$1"
  gcloud run services describe "$SERVICE" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format=json >"$target"
}

describe_revision() {
  local revision="$1"
  local target="$2"
  gcloud run revisions describe "$revision" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format=json >"$target"
}

assert_service_identity() {
  local source="$1"
  local expected_ingress
  if [ "$CONTAINER" = api ]; then
    expected_ingress=all
  elif [ "$CONTAINER" = events ]; then
    expected_ingress=internal
  else
    fail "Service identity only supports api or events"
    return 1
  fi
  jq -e --arg expected_environment "$DEPLOYMENT_ENVIRONMENT" --arg expected_ingress "$expected_ingress" '
    (.metadata.labels // .labels // {}) as $labels
    | (.spec.ingress // .ingress // .metadata.annotations["run.googleapis.com/ingress"] // "") as $ingress
    | $labels.application == "simsa"
      and $labels.environment == $expected_environment
      and $labels.managed_by == "terraform"
      and (if $expected_ingress == "all" then ($ingress == "all" or $ingress == "INGRESS_TRAFFIC_ALL")
           else ($ingress == "internal" or $ingress == "INGRESS_TRAFFIC_INTERNAL_ONLY") end)
  ' "$source" >/dev/null \
    || fail "Cloud Run service labels do not match the selected SIMSA Terraform environment"
  if [ "$CONTAINER" = events ]; then
    require_value EXPECTED_EVENTARC_INVOKER_SERVICE_ACCOUNT
    gcloud run services get-iam-policy "$SERVICE" --project "$PROJECT_ID" --region "$REGION" \
      --format=json >"$EVIDENCE_DIR/event-service-iam-policy.json"
    jq -e --arg member "serviceAccount:${EXPECTED_EVENTARC_INVOKER_SERVICE_ACCOUNT}" '
      [.bindings[]? | select(.role == "roles/run.invoker")] as $invoker
      | ($invoker | length) == 1
        and (($invoker[0].members // [] | sort) == [$member])
        and (($invoker[0].condition // null) == null)
    ' "$EVIDENCE_DIR/event-service-iam-policy.json" >/dev/null \
      || fail "Event receiver invoker IAM must contain only the sealed Eventarc service account"
  fi
}

database_binding_required() {
  return 0
}

assert_live_storage_target() {
  local artifact_project_number project_number kind bucket target expected_bucket
  jq -e \
    --arg project_id "$EXPECTED_DATABASE_PROJECT_ID" \
    --arg region "$EXPECTED_DATABASE_REGION" \
    --arg environment "$DEPLOYMENT_ENVIRONMENT" \
    --arg upload "$EXPECTED_GCS_UPLOAD_BUCKET" \
    --arg final "$EXPECTED_GCS_FINAL_BUCKET" '
    . as $target |
    (keys | sort) == (["final", "project_id", "project_number", "region", "upload"] | sort) and
    .project_id == $project_id and .region == $region and
    (.project_number | type == "string" and test("^[0-9]+$")) and
    .upload.name == $upload and .final.name == $final and
    .upload.name != .final.name and
    all([.upload, .final][];
      (keys | sort) == (["labels", "location", "name", "project_number", "public_access_prevention", "uniform_bucket_level_access"] | sort) and
      .location == $region and .project_number == $target.project_number and
      .uniform_bucket_level_access == true and .public_access_prevention == "enforced") and
    .upload.labels == {application: "simsa", environment: $environment, managed_by: "terraform", purpose: "quarantine"} and
    .final.labels == {application: "simsa", environment: $environment, managed_by: "terraform", purpose: "final"}
  ' <<<"$EXPECTED_STORAGE_TARGET_JSON" >/dev/null \
    || fail "Sealed storage target JSON is missing, malformed, or inconsistent"
  artifact_project_number="$(jq -r '.project_number' <<<"$EXPECTED_STORAGE_TARGET_JSON")"
  project_number="$(gcloud projects describe "$EXPECTED_DATABASE_PROJECT_ID" --format='value(projectNumber)')"
  [[ "$project_number" =~ ^[0-9]+$ ]] || fail "Could not resolve database-evidence project number"
  [ "$project_number" = "$artifact_project_number" ] \
    || fail "Live project number drifted from sealed storage evidence"
  [ "$EXPECTED_GCS_UPLOAD_BUCKET" != "$EXPECTED_GCS_FINAL_BUCKET" ] \
    || fail "Upload and final buckets in database evidence must be distinct"
  for kind in upload final; do
    if [ "$kind" = upload ]; then
      bucket="$EXPECTED_GCS_UPLOAD_BUCKET"
    else
      bucket="$EXPECTED_GCS_FINAL_BUCKET"
    fi
    expected_bucket="$(jq -c --arg kind "$kind" '.[$kind]' <<<"$EXPECTED_STORAGE_TARGET_JSON")"
    target="$EVIDENCE_DIR/live-${kind}-bucket.json"
    gcloud storage buckets describe "gs://$bucket" --format=json >"$target"
    jq -e \
      --argjson expected "$expected_bucket" '
      .name == $expected.name and
      ((.projectNumber | tostring) == $expected.project_number) and
      ((.location | ascii_downcase) == $expected.location) and
      ((.iamConfiguration.uniformBucketLevelAccess.enabled // .uniformBucketLevelAccess.enabled) == $expected.uniform_bucket_level_access) and
      ((.iamConfiguration.publicAccessPrevention // .publicAccessPrevention) == $expected.public_access_prevention) and
      ((.labels // {}) == $expected.labels)
    ' "$target" >/dev/null || fail "Live ${kind} bucket metadata drifted from sealed database evidence"
  done
  jq -n \
    --argjson sealed "$EXPECTED_STORAGE_TARGET_JSON" \
    --slurpfile upload "$EVIDENCE_DIR/live-upload-bucket.json" \
    --slurpfile final "$EVIDENCE_DIR/live-final-bucket.json" \
    '{gate: "passed", sealed_target: $sealed, live_metadata: {upload: $upload[0], final: $final[0]}}' \
    >"$EVIDENCE_DIR/live-storage-target-gate.json"
}

expected_database_principal() {
  case "$CONTAINER" in
    api) printf '%s\n' "${EXPECTED_DATABASE_API_PRINCIPAL:-}" ;;
    events) printf '%s\n' "${EXPECTED_DATABASE_EVENT_PRINCIPAL:-}" ;;
    *) fail "Database binding only supports api or events runtime containers" ;;
  esac
}

validate_database_expectations() {
  database_binding_required || return 0
  local name
  for name in EXPECTED_DATABASE_PROJECT_ID EXPECTED_DATABASE_REGION \
    EXPECTED_DATABASE_INSTANCE EXPECTED_DATABASE_NAME \
    EXPECTED_GCS_UPLOAD_BUCKET EXPECTED_GCS_FINAL_BUCKET \
    EXPECTED_STORAGE_TARGET_JSON EXPECTED_CLOUD_SQL_PROXY_IMAGE \
    EXPECTED_RUNTIME_SECURITY_JSON; do
    require_value "$name"
  done
  [ -n "$(expected_database_principal)" ] || fail "Expected database principal is required for ${CONTAINER}"
  [ "$PROJECT_ID" = "$EXPECTED_DATABASE_PROJECT_ID" ] \
    || fail "Deployment project does not match sealed database evidence"
  [ "$REGION" = "$EXPECTED_DATABASE_REGION" ] \
    || fail "Deployment region does not match sealed database evidence"
  assert_live_storage_target
}

assert_database_binding() {
  local revision_json="$1"
  local evidence_label="$2"
  database_binding_required || return 0
  [[ "$evidence_label" =~ ^[a-z0-9-]+$ ]] || fail "Invalid database binding evidence label"
  python3 "${GITHUB_WORKSPACE:-$PWD}/.github/scripts/check-gcp-cloud-run-database-binding.py" \
    --revision "$revision_json" \
    --expected-project-id "$EXPECTED_DATABASE_PROJECT_ID" \
    --expected-region "$EXPECTED_DATABASE_REGION" \
    --expected-instance "$EXPECTED_DATABASE_INSTANCE" \
    --expected-database "$EXPECTED_DATABASE_NAME" \
    --runtime-container "$CONTAINER" \
    --expected-database-principal "$(expected_database_principal)" \
    --expected-upload-bucket "$EXPECTED_GCS_UPLOAD_BUCKET" \
    --expected-final-bucket "$EXPECTED_GCS_FINAL_BUCKET" \
    --expected-cloud-sql-proxy-image "$EXPECTED_CLOUD_SQL_PROXY_IMAGE" \
    --expected-runtime-security-json "$EXPECTED_RUNTIME_SECURITY_JSON" \
    --evidence "$EVIDENCE_DIR/${evidence_label}-database-binding.json"
}

traffic_json() {
  local source="$1"
  jq -c '
    [
      ((.status.trafficStatuses // .status.traffic // [])[]?)
      | {
          revision: (.revision // .revisionName // ""),
          percent: (.percent // 0)
        }
      | select(.revision != "" and .percent > 0)
    ]
    | group_by(.revision)
    | map({revision: .[0].revision, percent: (map(.percent) | add)})
    | sort_by(.revision)
  ' "$source"
}

baseline_revision() {
  local source="$1"
  local traffic
  traffic="$(traffic_json "$source")"
  if [ "$(jq 'length' <<<"$traffic")" -ne 1 ]; then
    fail "Cloud Run must have one deterministic active baseline revision"
    return 1
  fi
  if [ "$(jq '.[0].percent' <<<"$traffic")" -ne 100 ]; then
    fail "Cloud Run baseline must receive exactly 100 percent traffic"
    return 1
  fi
  jq -r '.[0].revision' <<<"$traffic"
}

service_uri() {
  local source="$1"
  jq -r '.status.uri // .status.url // empty' "$source"
}

tagged_revision() {
  local source="$1"
  local tag="$2"
  jq -r --arg tag "$tag" '
    first(
      ((.status.trafficStatuses // .status.traffic // [])[]?)
      | select(.tag == $tag)
      | (.revision // .revisionName // empty)
    ) // empty
  ' "$source"
}

tagged_uri() {
  local source="$1"
  local tag="$2"
  jq -r --arg tag "$tag" '
    first(
      ((.status.trafficStatuses // .status.traffic // [])[]?)
      | select(.tag == $tag)
      | (.uri // .url // empty)
    ) // empty
  ' "$source"
}

revision_image() {
  local source="$1"
  local container="$2"
  jq -r --arg container "$container" '
    first(
      [
        .spec.containers[]?,
        .template.containers[]?,
        .spec.template.spec.containers[]?
      ][]
      | select(.name == $container)
      | .image
    ) // empty
  ' "$source"
}

revision_digest() {
  local source="$1"
  local container="$2"
  local image status_digest
  image="$(revision_image "$source" "$container")"
  if [[ "$image" =~ @((sha256:)[0-9a-f]{64})$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi
  status_digest="$(jq -r '.status.imageDigest // empty' "$source")"
  if [[ "$status_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    printf '%s\n' "$status_digest"
    return 0
  fi
  if [ -n "$image" ]; then
    status_digest="$(gcloud artifacts docker images describe "$image" \
      --project "$PROJECT_ID" --format='value(image_summary.digest)' 2>/dev/null || true)"
  fi
  if [[ ! "$status_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    fail "Could not resolve immutable digest for revision container ${container}"
    return 1
  fi
  printf '%s\n' "$status_digest"
}

wait_for_tag() {
  local tag="$1"
  local target="$2"
  local attempt revision uri
  for attempt in $(seq 1 30); do
    describe_service "$target"
    revision="$(tagged_revision "$target" "$tag")"
    uri="$(tagged_uri "$target" "$tag")"
    if [ -n "$revision" ] && [ -n "$uri" ]; then
      printf '%s\t%s\n' "$revision" "$uri"
      return 0
    fi
    sleep 4
  done
  fail "Timed out waiting for Cloud Run tag ${tag}"
}

probe_base() {
  local base_uri="$1"
  local auth_mode="${2:-public}"
  local audience="${3:-}"
  local token=""
  local path attempt code body_file trace_file
  trace_file="$EVIDENCE_DIR/probes.ndjson"

  if [ "$auth_mode" = "identity" ]; then
    [ -n "$audience" ] || fail "An identity-token audience is required for a private probe"
    token="$(gcloud auth print-identity-token --audiences="$audience")"
    [ -n "$token" ] || fail "Could not mint an identity token for private Cloud Run probe"
  elif [ "$auth_mode" != "public" ]; then
    fail "Unsupported probe auth mode: ${auth_mode}"
  fi

  for path in /health /ready; do
    local passed=false
    for attempt in $(seq 1 20); do
      body_file="$(mktemp)"
      if [ "$auth_mode" = "identity" ]; then
        code="$(curl --silent --show-error --max-time 10 \
          --header "Authorization: Bearer ${token}" \
          --output "$body_file" --write-out '%{http_code}' "${base_uri}${path}" || true)"
      else
        code="$(curl --silent --show-error --max-time 10 \
          --output "$body_file" --write-out '%{http_code}' "${base_uri}${path}" || true)"
      fi
      local valid_json=false
      if jq -e 'type == "object"' "$body_file" >/dev/null 2>&1; then
        valid_json=true
      fi
      jq -nRc \
        --arg path "$path" \
        --argjson attempt "$attempt" \
        --arg code "$code" \
        --argjson valid_json "$valid_json" \
        --arg body "$(head -c 4096 "$body_file")" \
        '{path: $path, attempt: $attempt, http_status: $code,
          valid_json_object: $valid_json, body: $body}' \
        >>"$trace_file"
      rm -f "$body_file"
      if [ "$code" = "200" ] && [ "$valid_json" = true ]; then
        passed=true
        break
      fi
      sleep 5
    done
    if [ "$passed" != true ]; then
      fail "${path} did not return HTTP 200 within the bounded retry window"
      return 1
    fi
  done
}

write_rollback_command() {
  local previous_revision="$1"
  cat >"$EVIDENCE_DIR/rollback-command.sh" <<EOF
gcloud run services update-traffic ${SERVICE} --project ${PROJECT_ID} --region ${REGION} --to-revisions ${previous_revision}=100 --quiet
EOF
}

assert_traffic() {
  local source="$1"
  local candidate="$2"
  local expected_candidate="$3"
  local previous="$4"
  local expected_previous="$5"
  local traffic actual_candidate actual_previous unknown total
  traffic="$(traffic_json "$source")"
  actual_candidate="$(jq --arg revision "$candidate" '[.[] | select(.revision == $revision) | .percent] | add // 0' <<<"$traffic")"
  actual_previous="$(jq --arg revision "$previous" '[.[] | select(.revision == $revision) | .percent] | add // 0' <<<"$traffic")"
  unknown="$(jq --arg candidate "$candidate" --arg previous "$previous" '[.[] | select(.revision != $candidate and .revision != $previous)] | length' <<<"$traffic")"
  total="$(jq '[.[].percent] | add // 0' <<<"$traffic")"
  [ "$actual_candidate" -eq "$expected_candidate" ] || fail "Candidate traffic is ${actual_candidate}, expected ${expected_candidate}"
  [ "$actual_previous" -eq "$expected_previous" ] || fail "Previous traffic is ${actual_previous}, expected ${expected_previous}"
  [ "$unknown" -eq 0 ] || fail "Unexpected active revision detected in traffic allocation"
  [ "$total" -eq 100 ] || fail "Cloud Run active traffic does not total 100 percent"
}

test_rollback_command() {
  local previous_revision="$1"
  gcloud run services update-traffic "$SERVICE" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --to-revisions "${previous_revision}=100" \
    --quiet >"$EVIDENCE_DIR/rollback-preflight.txt"
  describe_service "$EVIDENCE_DIR/after-rollback-preflight.json"
  assert_traffic "$EVIDENCE_DIR/after-rollback-preflight.json" "$previous_revision" 100 "$previous_revision" 100
}

deploy_candidate() {
  local image_ref="$1"
  local tag="$2"
  local suffix="$3"
  gcloud run services update "$SERVICE" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --container "$CONTAINER" \
    --image "$image_ref" \
    --no-traffic \
    --tag "$tag" \
    --revision-suffix "$suffix" \
    --quiet >"$EVIDENCE_DIR/deploy-candidate.txt"
}

api_candidate() {
  validate_common
  validate_database_expectations
  local name
  for name in ARTIFACT_REPOSITORY IMAGE_NAME EVENT_SERVICE EVENT_CONTAINER GITHUB_RUN_ID GITHUB_RUN_ATTEMPT GITHUB_OUTPUT; do
    require_value "$name"
  done
  command -v docker >/dev/null
  [[ "$ARTIFACT_REPOSITORY" =~ ^[a-z][a-z0-9._-]{0,62}$ ]] || fail "Invalid ARTIFACT_REPOSITORY"
  [[ "$IMAGE_NAME" =~ ^[a-z0-9][a-z0-9._/-]{0,126}$ ]] || fail "Invalid IMAGE_NAME"
  [[ "$EVENT_SERVICE" =~ ^[a-z][a-z0-9-]{0,62}$ ]] || fail "Invalid EVENT_SERVICE"
  [[ "$EVENT_CONTAINER" =~ ^[a-z][a-z0-9-]{0,62}$ ]] || fail "Invalid EVENT_CONTAINER"

  gcloud --version >"$EVIDENCE_DIR/gcloud-version.txt"
  docker version >"$EVIDENCE_DIR/docker-version.txt"
  describe_service "$EVIDENCE_DIR/service-before.json"
  assert_service_identity "$EVIDENCE_DIR/service-before.json"
  local previous previous_image previous_digest
  previous="$(baseline_revision "$EVIDENCE_DIR/service-before.json")"
  describe_revision "$previous" "$EVIDENCE_DIR/previous-revision.json"
  assert_database_binding "$EVIDENCE_DIR/previous-revision.json" previous-api
  previous_image="$(revision_image "$EVIDENCE_DIR/previous-revision.json" "$CONTAINER")"
  [ -n "$previous_image" ] || fail "Previous API container image was not found"
  previous_digest="$(revision_digest "$EVIDENCE_DIR/previous-revision.json" "$CONTAINER")"

  local registry image_tag image_digest image_ref
  registry="${REGION}-docker.pkg.dev"
  image_tag="${registry}/${PROJECT_ID}/${ARTIFACT_REPOSITORY}/${IMAGE_NAME}:release-${COMMIT_SHA}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
  gcloud auth configure-docker "$registry" --quiet >"$EVIDENCE_DIR/docker-auth.txt"

  # This is intentionally the workflow's only application image build. Every
  # subsequent deployment consumes the single resolved digest below.
  docker build --pull --target runtime \
    --label "org.opencontainers.image.revision=${COMMIT_SHA}" \
    --label "org.opencontainers.image.source=${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}" \
    --tag "$image_tag" backend >"$EVIDENCE_DIR/docker-build.txt"
  docker push "$image_tag" >"$EVIDENCE_DIR/docker-push.txt"
  image_digest="$(gcloud artifacts docker images describe "$image_tag" \
    --project "$PROJECT_ID" --format='value(image_summary.digest)')"
  [[ "$image_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "Artifact Registry did not return an immutable sha256 digest"
  image_ref="${registry}/${PROJECT_ID}/${ARTIFACT_REPOSITORY}/${IMAGE_NAME}@${image_digest}"

  local short tag suffix tagged candidate candidate_uri candidate_digest api_uri
  short="${COMMIT_SHA:0:12}"
  tag="candidate-${short}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
  suffix="r${short}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
  [ $((${#SERVICE} + ${#suffix} + 1)) -le 63 ] || fail "Service and revision suffix exceed Cloud Run's 63-character revision name limit"
  deploy_candidate "$image_ref" "$tag" "$suffix"
  tagged="$(wait_for_tag "$tag" "$EVIDENCE_DIR/service-candidate.json")"
  candidate="${tagged%%$'\t'*}"
  candidate_uri="${tagged#*$'\t'}"
  [ "$candidate" != "$previous" ] || fail "Candidate revision did not change"
  describe_revision "$candidate" "$EVIDENCE_DIR/candidate-revision.json"
  assert_database_binding "$EVIDENCE_DIR/candidate-revision.json" candidate-api
  candidate_digest="$(revision_digest "$EVIDENCE_DIR/candidate-revision.json" "$CONTAINER")"
  [ "$candidate_digest" = "$image_digest" ] || fail "Cloud Run candidate digest does not equal the Artifact Registry digest"
  assert_traffic "$EVIDENCE_DIR/service-candidate.json" "$previous" 100 "$previous" 100
  probe_base "$candidate_uri" public

  # At this point the baseline is still at 100%. Execute the exact rollback
  # command as a no-op preflight so the saved command, permissions, and target
  # revision are proven before any canary traffic exists.
  write_rollback_command "$previous"
  test_rollback_command "$previous"
  api_uri="$(service_uri "$EVIDENCE_DIR/after-rollback-preflight.json")"
  [ -n "$api_uri" ] || fail "Cloud Run API URI is missing"

  jq -n \
    --arg environment "${DEPLOYMENT_ENVIRONMENT:-}" \
    --arg commit_sha "$COMMIT_SHA" \
    --arg image_ref "$image_ref" \
    --arg image_digest "$image_digest" \
    --arg candidate_revision "$candidate" \
    --arg candidate_uri "$candidate_uri" \
    --arg previous_revision "$previous" \
    --arg previous_image "$previous_image" \
    --arg previous_digest "$previous_digest" \
    --arg service_uri "$api_uri" \
    '{environment: $environment, commit_sha: $commit_sha, image_ref: $image_ref,
      image_digest: $image_digest, candidate_revision: $candidate_revision,
      candidate_uri: $candidate_uri, previous_revision: $previous_revision,
      previous_image: $previous_image, previous_digest: $previous_digest,
      service_uri: $service_uri, rollback_preflight: "passed"}' \
    >"$EVIDENCE_DIR/api-candidate-summary.json"

  {
    echo "image_ref=$image_ref"
    echo "image_digest=$image_digest"
    echo "candidate_revision=$candidate"
    echo "previous_revision=$previous"
    echo "previous_image=$previous_image"
    echo "previous_digest=$previous_digest"
    echo "service_uri=$api_uri"
  } >>"$GITHUB_OUTPUT"
}

event_candidate() {
  validate_common
  validate_database_expectations
  local name
  for name in IMAGE_REF IMAGE_DIGEST GITHUB_RUN_ID GITHUB_RUN_ATTEMPT GITHUB_OUTPUT; do
    require_value "$name"
  done
  [[ "$IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "Invalid IMAGE_DIGEST"
  [[ "$IMAGE_REF" == *@"$IMAGE_DIGEST" ]] || fail "IMAGE_REF must end in IMAGE_DIGEST"

  describe_service "$EVIDENCE_DIR/service-before.json"
  assert_service_identity "$EVIDENCE_DIR/service-before.json"
  local previous previous_image previous_digest service_base short tag suffix tagged candidate candidate_uri candidate_digest
  previous="$(baseline_revision "$EVIDENCE_DIR/service-before.json")"
  service_base="$(service_uri "$EVIDENCE_DIR/service-before.json")"
  [ -n "$service_base" ] || fail "Private Cloud Run service URI is missing"
  describe_revision "$previous" "$EVIDENCE_DIR/previous-revision.json"
  assert_database_binding "$EVIDENCE_DIR/previous-revision.json" previous-events
  previous_image="$(revision_image "$EVIDENCE_DIR/previous-revision.json" "$CONTAINER")"
  [ -n "$previous_image" ] || fail "Previous event container image was not found"
  previous_digest="$(revision_digest "$EVIDENCE_DIR/previous-revision.json" "$CONTAINER")"

  short="${COMMIT_SHA:0:12}"
  tag="candidate-${short}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
  suffix="r${short}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
  [ $((${#SERVICE} + ${#suffix} + 1)) -le 63 ] || fail "Service and revision suffix exceed Cloud Run's 63-character revision name limit"
  deploy_candidate "$IMAGE_REF" "$tag" "$suffix"
  tagged="$(wait_for_tag "$tag" "$EVIDENCE_DIR/service-candidate.json")"
  candidate="${tagged%%$'\t'*}"
  candidate_uri="${tagged#*$'\t'}"
  [ "$candidate" != "$previous" ] || fail "Private candidate revision did not change"
  describe_revision "$candidate" "$EVIDENCE_DIR/candidate-revision.json"
  assert_database_binding "$EVIDENCE_DIR/candidate-revision.json" candidate-events
  candidate_digest="$(revision_digest "$EVIDENCE_DIR/candidate-revision.json" "$CONTAINER")"
  [ "$candidate_digest" = "$IMAGE_DIGEST" ] || fail "Private candidate digest does not equal the built digest"
  assert_traffic "$EVIDENCE_DIR/service-candidate.json" "$previous" 100 "$previous" 100
  probe_base "$candidate_uri" identity "$service_base"
  write_rollback_command "$previous"
  test_rollback_command "$previous"

  jq -n \
    --arg environment "${DEPLOYMENT_ENVIRONMENT:-}" \
    --arg commit_sha "$COMMIT_SHA" \
    --arg image_ref "$IMAGE_REF" \
    --arg candidate_revision "$candidate" \
    --arg candidate_uri "$candidate_uri" \
    --arg previous_revision "$previous" \
    --arg previous_image "$previous_image" \
    --arg previous_digest "$previous_digest" \
    --arg service_uri "$service_base" \
    '{environment: $environment, commit_sha: $commit_sha, image_ref: $image_ref,
      candidate_revision: $candidate_revision, candidate_uri: $candidate_uri,
      previous_revision: $previous_revision, previous_image: $previous_image,
      previous_digest: $previous_digest, service_uri: $service_uri,
      private_probe: "passed", rollback_preflight: "passed"}' \
    >"$EVIDENCE_DIR/event-candidate-summary.json"
  {
    echo "candidate_revision=$candidate"
    echo "previous_revision=$previous"
    echo "previous_digest=$previous_digest"
    echo "service_uri=$service_base"
  } >>"$GITHUB_OUTPUT"
}

promote_traffic() {
  validate_common
  local name
  for name in CANDIDATE_REVISION PREVIOUS_REVISION CANDIDATE_PERCENT EXPECTED_CANDIDATE_PERCENT EXPECTED_PREVIOUS_PERCENT PREVIOUS_DIGEST IMAGE_DIGEST PROBE_AUTH STAGE; do
    require_value "$name"
  done
  [[ "$CANDIDATE_REVISION" =~ ^[a-z][a-z0-9-]{0,62}$ ]] || fail "Invalid CANDIDATE_REVISION"
  [[ "$PREVIOUS_REVISION" =~ ^[a-z][a-z0-9-]{0,62}$ ]] || fail "Invalid PREVIOUS_REVISION"
  [[ "$CANDIDATE_PERCENT" =~ ^(5|25|100)$ ]] || fail "CANDIDATE_PERCENT must be 5, 25, or 100"
  [[ "$EXPECTED_CANDIDATE_PERCENT" =~ ^(0|5|25)$ ]] || fail "Invalid EXPECTED_CANDIDATE_PERCENT"
  [[ "$EXPECTED_PREVIOUS_PERCENT" =~ ^(75|95|100)$ ]] || fail "Invalid EXPECTED_PREVIOUS_PERCENT"
  [[ "$PREVIOUS_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "Invalid PREVIOUS_DIGEST"
  [[ "$IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "Invalid IMAGE_DIGEST"
  [[ "$STAGE" =~ ^[a-z0-9-]+$ ]] || fail "Invalid STAGE"
  [ "$CANDIDATE_REVISION" != "$PREVIOUS_REVISION" ] || fail "Candidate and previous revision must differ"
  validate_database_expectations

  describe_revision "$CANDIDATE_REVISION" "$EVIDENCE_DIR/candidate-revision.json"
  describe_revision "$PREVIOUS_REVISION" "$EVIDENCE_DIR/previous-revision.json"
  assert_database_binding "$EVIDENCE_DIR/candidate-revision.json" "candidate-${CONTAINER}"
  assert_database_binding "$EVIDENCE_DIR/previous-revision.json" "current-${CONTAINER}"
  [ "$(revision_digest "$EVIDENCE_DIR/candidate-revision.json" "$CONTAINER")" = "$IMAGE_DIGEST" ] || fail "Candidate digest changed before promotion"
  [ "$(revision_digest "$EVIDENCE_DIR/previous-revision.json" "$CONTAINER")" = "$PREVIOUS_DIGEST" ] || fail "Previous revision digest changed before promotion"
  describe_service "$EVIDENCE_DIR/traffic-before.json"
  assert_service_identity "$EVIDENCE_DIR/traffic-before.json"
  assert_traffic "$EVIDENCE_DIR/traffic-before.json" "$CANDIDATE_REVISION" "$EXPECTED_CANDIDATE_PERCENT" "$PREVIOUS_REVISION" "$EXPECTED_PREVIOUS_PERCENT"

  rollback_on_error() {
    local exit_code=$?
    trap - ERR
    set +e
    {
      echo "Promotion stage ${STAGE} failed; restoring ${PREVIOUS_REVISION}=100."
      gcloud run services update-traffic "$SERVICE" \
        --project "$PROJECT_ID" \
        --region "$REGION" \
        --to-revisions "${PREVIOUS_REVISION}=100" \
        --quiet
    } >"$EVIDENCE_DIR/automatic-rollback.txt" 2>&1
    describe_service "$EVIDENCE_DIR/after-automatic-rollback.json" 2>>"$EVIDENCE_DIR/automatic-rollback.txt"
    assert_traffic "$EVIDENCE_DIR/after-automatic-rollback.json" "$PREVIOUS_REVISION" 100 "$PREVIOUS_REVISION" 100 \
      >>"$EVIDENCE_DIR/automatic-rollback.txt" 2>&1
    exit "$exit_code"
  }
  trap rollback_on_error ERR

  if [ "$CANDIDATE_PERCENT" -eq 100 ]; then
    gcloud run services update-traffic "$SERVICE" \
      --project "$PROJECT_ID" \
      --region "$REGION" \
      --to-revisions "${CANDIDATE_REVISION}=100" \
      --quiet >"$EVIDENCE_DIR/update-traffic.txt"
  else
    gcloud run services update-traffic "$SERVICE" \
      --project "$PROJECT_ID" \
      --region "$REGION" \
      --to-revisions "${CANDIDATE_REVISION}=${CANDIDATE_PERCENT},${PREVIOUS_REVISION}=$((100 - CANDIDATE_PERCENT))" \
      --quiet >"$EVIDENCE_DIR/update-traffic.txt"
  fi

  describe_service "$EVIDENCE_DIR/traffic-after.json"
  assert_traffic "$EVIDENCE_DIR/traffic-after.json" "$CANDIDATE_REVISION" "$CANDIDATE_PERCENT" "$PREVIOUS_REVISION" "$((100 - CANDIDATE_PERCENT))"
  local base_uri
  base_uri="$(service_uri "$EVIDENCE_DIR/traffic-after.json")"
  [ -n "$base_uri" ] || fail "Cloud Run service URI is missing after promotion"
  if [ "$PROBE_AUTH" = "identity" ]; then
    probe_base "$base_uri" identity "$base_uri"
  else
    [ "$PROBE_AUTH" = "public" ] || fail "PROBE_AUTH must be public or identity"
    probe_base "$base_uri" public
  fi
  write_rollback_command "$PREVIOUS_REVISION"

  jq -n \
    --arg environment "${DEPLOYMENT_ENVIRONMENT:-}" \
    --arg stage "$STAGE" \
    --arg commit_sha "$COMMIT_SHA" \
    --arg service "$SERVICE" \
    --arg candidate_revision "$CANDIDATE_REVISION" \
    --arg candidate_digest "$IMAGE_DIGEST" \
    --arg previous_revision "$PREVIOUS_REVISION" \
    --arg previous_digest "$PREVIOUS_DIGEST" \
    --argjson candidate_percent "$CANDIDATE_PERCENT" \
    --arg service_uri "$base_uri" \
    '{environment: $environment, stage: $stage, commit_sha: $commit_sha,
      service: $service, candidate_revision: $candidate_revision,
      candidate_digest: $candidate_digest, previous_revision: $previous_revision,
      previous_digest: $previous_digest, candidate_percent: $candidate_percent,
      service_uri: $service_uri, probes: "passed"}' \
    >"$EVIDENCE_DIR/promotion-summary.json"
  trap - ERR
}

verify_database_binding() {
  validate_common
  database_binding_required \
    || fail "Standalone database binding verification requires Preview or Production"
  [[ "$CONTAINER" =~ ^(api|events)$ ]] \
    || fail "Standalone database binding verification targets api or events"
  require_value CANDIDATE_REVISION
  require_value PREVIOUS_REVISION
  validate_database_expectations
  [[ "$CANDIDATE_REVISION" =~ ^[a-z][a-z0-9-]{0,62}$ ]] \
    || fail "Invalid CANDIDATE_REVISION"
  [[ "$PREVIOUS_REVISION" =~ ^[a-z][a-z0-9-]{0,62}$ ]] \
    || fail "Invalid PREVIOUS_REVISION"
  [ "$CANDIDATE_REVISION" != "$PREVIOUS_REVISION" ] \
    || fail "Candidate and previous revision must differ"

  describe_service "$EVIDENCE_DIR/runtime-service.json"
  assert_service_identity "$EVIDENCE_DIR/runtime-service.json"
  [ "$(baseline_revision "$EVIDENCE_DIR/runtime-service.json")" = "$PREVIOUS_REVISION" ] \
    || fail "Current runtime baseline changed before promotion"
  describe_revision "$CANDIDATE_REVISION" "$EVIDENCE_DIR/candidate-runtime-revision.json"
  describe_revision "$PREVIOUS_REVISION" "$EVIDENCE_DIR/current-runtime-revision.json"
  assert_database_binding "$EVIDENCE_DIR/candidate-runtime-revision.json" "candidate-${CONTAINER}"
  assert_database_binding "$EVIDENCE_DIR/current-runtime-revision.json" "current-${CONTAINER}"
}

rollback_component() {
  local component="$1"
  local target_service="$2"
  local target_container="$3"
  local previous_revision="$4"
  local previous_digest="$5"
  local probe_auth="$6"
  local evidence_root="$7"
  local actual_digest base_uri restored_revision

  SERVICE="$target_service"
  CONTAINER="$target_container"
  EVIDENCE_DIR="$evidence_root/$component"
  mkdir -p "$EVIDENCE_DIR"

  describe_service "$EVIDENCE_DIR/service-before.json" || return 1
  assert_service_identity "$EVIDENCE_DIR/service-before.json" || return 1
  describe_revision "$previous_revision" "$EVIDENCE_DIR/previous-revision.json" || return 1
  actual_digest="$(revision_digest "$EVIDENCE_DIR/previous-revision.json" "$target_container")" \
    || return 1
  [ "$actual_digest" = "$previous_digest" ] \
    || { fail "${component} previous revision digest no longer matches release evidence"; return 1; }

  gcloud run services update-traffic "$target_service" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --to-revisions "${previous_revision}=100" \
    --quiet >"$EVIDENCE_DIR/update-traffic.txt" || return 1

  describe_service "$EVIDENCE_DIR/service-after.json" || return 1
  assert_service_identity "$EVIDENCE_DIR/service-after.json" || return 1
  restored_revision="$(baseline_revision "$EVIDENCE_DIR/service-after.json")" || return 1
  [ "$restored_revision" = "$previous_revision" ] \
    || { fail "${component} rollback did not restore the exact previous revision"; return 1; }
  base_uri="$(service_uri "$EVIDENCE_DIR/service-after.json")"
  [ -n "$base_uri" ] || { fail "${component} service URI is missing after rollback"; return 1; }
  if [ "$probe_auth" = "identity" ]; then
    probe_base "$base_uri" identity "$base_uri" || return 1
  else
    [ "$probe_auth" = "public" ] || { fail "Invalid rollback probe mode"; return 1; }
    probe_base "$base_uri" public || return 1
  fi
  write_rollback_command "$previous_revision"

  jq -n \
    --arg component "$component" \
    --arg environment "$DEPLOYMENT_ENVIRONMENT" \
    --arg service "$target_service" \
    --arg container "$target_container" \
    --arg previous_revision "$previous_revision" \
    --arg previous_digest "$previous_digest" \
    --arg service_uri "$base_uri" \
    '{component: $component, environment: $environment, service: $service,
      container: $container, restored_revision: $previous_revision,
      restored_digest: $previous_digest, traffic_percent: 100,
      service_uri: $service_uri, probes: "passed"}' \
    >"$EVIDENCE_DIR/rollback-summary.json"
}

coordinated_rollback() {
  local name
  for name in PROJECT_ID REGION COMMIT_SHA DEPLOYMENT_ENVIRONMENT \
    API_SERVICE API_CONTAINER API_PREVIOUS_REVISION API_PREVIOUS_DIGEST \
    ROLLBACK_EVENT EVENT_PROMOTE_RESULT CANARY_5_RESULT CANARY_25_RESULT \
    PROMOTE_100_RESULT; do
    require_value "$name"
  done

  SERVICE="$API_SERVICE"
  CONTAINER="$API_CONTAINER"
  validate_common
  [[ "$API_PREVIOUS_REVISION" =~ ^[a-z][a-z0-9-]{0,62}$ ]] || fail "Invalid API_PREVIOUS_REVISION"
  [[ "$API_PREVIOUS_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "Invalid API_PREVIOUS_DIGEST"
  [[ "$ROLLBACK_EVENT" =~ ^(true|false)$ ]] || fail "ROLLBACK_EVENT must be true or false"
  if [ "$ROLLBACK_EVENT" = true ]; then
    for name in EVENT_SERVICE EVENT_CONTAINER EVENT_PREVIOUS_REVISION EVENT_PREVIOUS_DIGEST; do
      require_value "$name"
    done
    [[ "$EVENT_SERVICE" =~ ^[a-z][a-z0-9-]{0,62}$ ]] || fail "Invalid EVENT_SERVICE"
    [[ "$EVENT_CONTAINER" =~ ^[a-z][a-z0-9-]{0,62}$ ]] || fail "Invalid EVENT_CONTAINER"
    [[ "$EVENT_PREVIOUS_REVISION" =~ ^[a-z][a-z0-9-]{0,62}$ ]] || fail "Invalid EVENT_PREVIOUS_REVISION"
    [[ "$EVENT_PREVIOUS_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "Invalid EVENT_PREVIOUS_DIGEST"
  fi
  for name in EVENT_PROMOTE_RESULT CANARY_5_RESULT CANARY_25_RESULT PROMOTE_100_RESULT; do
    [[ "${!name}" =~ ^(success|failure|cancelled|skipped)$ ]] \
      || fail "Invalid upstream job result in ${name}"
  done

  local evidence_root api_status event_status
  evidence_root="$EVIDENCE_DIR"
  set +e
  (
    set -Eeuo pipefail
    rollback_component api "$API_SERVICE" "$API_CONTAINER" \
      "$API_PREVIOUS_REVISION" "$API_PREVIOUS_DIGEST" public "$evidence_root"
  )
  api_status=$?
  event_status=0
  if [ "$ROLLBACK_EVENT" = true ]; then
    (
      set -Eeuo pipefail
      rollback_component event "$EVENT_SERVICE" "$EVENT_CONTAINER" \
        "$EVENT_PREVIOUS_REVISION" "$EVENT_PREVIOUS_DIGEST" identity "$evidence_root"
    )
    event_status=$?
  fi
  set -e
  EVIDENCE_DIR="$evidence_root"

  jq -n \
    --arg environment "$DEPLOYMENT_ENVIRONMENT" \
    --arg commit_sha "$COMMIT_SHA" \
    --arg event_promote "$EVENT_PROMOTE_RESULT" \
    --arg canary_5 "$CANARY_5_RESULT" \
    --arg canary_25 "$CANARY_25_RESULT" \
    --arg promote_100 "$PROMOTE_100_RESULT" \
    --argjson rollback_event "$ROLLBACK_EVENT" \
    --argjson api_status "$api_status" \
    --argjson event_status "$event_status" \
    '{environment: $environment, commit_sha: $commit_sha,
      trigger_results: {event_promote: $event_promote, canary_5: $canary_5, canary_25: $canary_25,
        promote_100: $promote_100},
      rollback_event: $rollback_event,
      api_rollback_exit_code: $api_status,
      event_rollback_exit_code: (if $rollback_event then $event_status else null end),
      all_requested_components_restored:
        ($api_status == 0 and (($rollback_event | not) or $event_status == 0))}' \
    >"$EVIDENCE_DIR/coordinated-rollback-summary.json"

  [ "$api_status" -eq 0 ] \
    && { [ "$ROLLBACK_EVENT" = false ] || [ "$event_status" -eq 0 ]; } \
    || fail "Rollback could not verify every requested previous revision"
}

case "$MODE" in
  api-candidate)
    api_candidate
    ;;
  event-candidate)
    event_candidate
    ;;
  promote)
    promote_traffic
    ;;
  verify-database-binding)
    verify_database_binding
    ;;
  coordinated-rollback)
    coordinated_rollback
    ;;
  *)
    echo "Usage: $0 {api-candidate|event-candidate|promote|verify-database-binding|coordinated-rollback}" >&2
    exit 2
    ;;
esac
