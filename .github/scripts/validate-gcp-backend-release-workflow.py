#!/usr/bin/env python3
"""Static safety checks for the manual GCP backend release workflow."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "deploy-gcp-backend.yml"
RELEASE_SCRIPT = ROOT / ".github" / "scripts" / "release-gcp-backend.sh"
GATE_SCRIPT = ROOT / ".github" / "scripts" / "check-gcp-backend-production-gate.py"
MAINTENANCE_GATE_SCRIPT = ROOT / ".github" / "scripts" / "check-gcp-maintenance-gate.py"
CLOUD_RUN_DATABASE_GATE = ROOT / ".github" / "scripts" / "check-gcp-cloud-run-database-binding.py"
RUNBOOK = ROOT / "GCP_BACKEND_RELEASE.md"
IAM = ROOT / "docs/infra/firebase-gcp/terraform/service-accounts.tf"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def job_block(workflow: str, job_name: str) -> str:
    match = re.search(
        rf"(?ms)^  {re.escape(job_name)}:\n(.*?)(?=^  [a-zA-Z0-9_]+:\n|\Z)",
        workflow,
    )
    require(match is not None, f"job {job_name} is missing")
    return match.group(0)


def main() -> int:
    workflow_text = WORKFLOW.read_text(encoding="utf-8")
    release_text = RELEASE_SCRIPT.read_text(encoding="utf-8")
    gate_text = GATE_SCRIPT.read_text(encoding="utf-8")
    cloud_run_database_gate_text = CLOUD_RUN_DATABASE_GATE.read_text(encoding="utf-8")
    iam_text = IAM.read_text(encoding="utf-8")
    require(re.search(r"(?m)^on:\n  workflow_dispatch:\n", workflow_text) is not None,
            "workflow_dispatch trigger is missing")
    for forbidden_trigger in ("push", "pull_request", "schedule", "workflow_run"):
        require(re.search(rf"(?m)^  {forbidden_trigger}:\s*$", workflow_text) is None,
                f"backend deployment must remain manual-only; found {forbidden_trigger}")
    require(
        re.search(
            r"(?ms)^      environment:\n.*?^        options:\n"
            r"          - preview\n          - production\n",
            workflow_text,
        )
        is not None,
        "environment choices must be Preview/Production only",
    )
    require("          - staging\n" not in workflow_text,
            "Staging must fail closed until it has equivalent immutable database evidence")
    require(
        re.search(r"(?ms)^      commit_sha:\n.*?^        required: true\n", workflow_text) is not None,
        "immutable commit SHA input is required",
    )
    require('${GITHUB_SHA,,}' in workflow_text
            and "workflow definition ref must be the exact requested release commit" in workflow_text,
            "workflow definition SHA is not bound to the requested release commit")
    definition_binding = workflow_text.find(
        "Bind the loaded workflow definition to the requested commit"
    )
    initial_checkout = workflow_text.find("Check out the exact requested commit")
    require(
        -1 < definition_binding < initial_checkout,
        "the loaded workflow definition must be bound before checkout or any delegated release job",
    )
    require("ref: ${{ steps.request.outputs.commit_sha }}" in workflow_text,
            "initial checkout is not fed only by the normalized workflow-definition binding")
    for maintenance_input in (
        "maintenance_run_id",
        "maintenance_artifact_id",
        "maintenance_artifact_digest",
    ):
        require(
            re.search(rf"(?m)^      {maintenance_input}:$", workflow_text) is not None,
            f"Production maintenance input {maintenance_input} is missing",
        )
    for preview_input in (
        "preview_database_run_id",
        "preview_database_artifact_id",
        "preview_database_artifact_digest",
    ):
        require(
            re.search(rf"(?m)^      {preview_input}:$", workflow_text) is not None,
            f"Preview bootstrap input {preview_input} is missing",
        )

    job_names = set(re.findall(r"(?m)^  ([a-zA-Z0-9_]+):\n    name:", workflow_text))
    expected_jobs = {
        "validate",
        "candidate",
        "event_candidate",
        "event_promote",
        "canary_5",
        "canary_25",
        "promote_100",
        "coordinated_rollback",
        "api_only_rollback",
    }
    require(job_names == expected_jobs, "release stage jobs changed unexpectedly")

    require("cancel-in-progress: false" in workflow_text, "concurrent releases must queue, not cancel")
    require("PROMOTE_PRODUCTION" in workflow_text, "explicit Production confirmation is missing")
    require("Require coordinated API and event release" in workflow_text
            and "!inputs.deploy_event_receiver" in workflow_text
            and "require API and event receiver to release the same digest together" in workflow_text,
            "Preview/Production can bypass the coordinated event release")
    require("check-gcp-backend-production-gate.py" in workflow_text, "GitHub production gate is missing")
    require(workflow_text.count("check-gcp-backend-production-gate.py") == 5,
            "Production gate must run initially and immediately before every traffic promotion")
    require("secrets.GITHUB_TOKEN" in workflow_text, "production gate must use GITHUB_TOKEN")
    require("github.event.repository.default_branch" in workflow_text, "default branch must come from GitHub")
    require("persist-credentials: false" in workflow_text, "checkout credentials must not persist")
    require(workflow_text.count("check-gcp-maintenance-gate.py") == 9,
            "Preview/Production database evidence must be self-tested, content-verified, and rechecked before Production traffic")
    require("--evidence-dir \"$RUNNER_TEMP/database-maintenance-evidence\"" in workflow_text,
            "downloaded maintenance evidence manifest/summary is not verified")
    require("--evidence-dir \"$RUNNER_TEMP/preview-database-evidence\"" in workflow_text
            and "--kind preview-bootstrap" in workflow_text,
            "downloaded Preview bootstrap evidence manifest/summary is not verified")
    for exact_binding in (
        "preview_database_run_id",
        "preview_database_artifact_id",
        "preview_database_artifact_digest",
        "artifact-ids: ${{ inputs.preview_database_artifact_id }}",
        "run-id: ${{ inputs.preview_database_run_id }}",
    ):
        require(exact_binding in workflow_text,
                f"Preview deploy is not bound to exact bootstrap evidence: {exact_binding}")
    for output_name in (
        "database_project_id",
        "database_region",
        "database_instance",
        "database_name",
        "database_api_principal",
        "database_event_principal",
        "gcs_upload_bucket",
        "gcs_final_bucket",
        "storage_target_json",
        "cloud_sql_proxy_image",
        "eventarc_invoker_service_account",
        "runtime_security_json",
    ):
        require(
            re.search(rf"(?m)^      {output_name}: \$\{{\{{ steps[.]database_binding[.]outputs[.]", workflow_text)
            is not None,
            f"verified database target output is missing: {output_name}",
        )
    require('id: database_binding' in workflow_text
            and ".database_target.project_id" in workflow_text
            and ".database_target.api_principal" in workflow_text
            and ".database_target.event_principal" in workflow_text
            and ".storage_target.upload.name" in workflow_text
            and ".storage_target.final.name" in workflow_text
            and "jq -c '.storage_target'" in workflow_text,
            "verified database target/runtime principals are not exported to deployment jobs")
    require('"@${PROJECT_ID}.iam.gserviceaccount.com"' in workflow_text,
            "deploy service account is not bound to the selected environment project")

    uses = re.findall(r"^\s*uses:\s*([^@\s]+)@([^\s#]+)", workflow_text, flags=re.MULTILINE)
    require(uses, "workflow has no pinned actions")
    for action, ref in uses:
        require(re.fullmatch(r"[0-9a-f]{40}", ref) is not None,
                f"{action} is not pinned by a full commit SHA")
    required_actions = {
        "actions/checkout",
        "actions/download-artifact",
        "actions/upload-artifact",
        "google-github-actions/auth",
        "google-github-actions/setup-gcloud",
    }
    require(required_actions <= {action for action, _ in uses}, "required official actions are missing")

    forbidden_key_material = (
        "credentials_json",
        "service_account_key",
        "gcp_credentials",
        "gcp_sa_key",
        "private_key",
    )
    lowered = workflow_text.lower()
    for token in forbidden_key_material:
        require(token not in lowered, f"forbidden static Google credential token present: {token}")
    secret_references = set(re.findall(r"secrets\.([A-Za-z0-9_]+)", workflow_text))
    require(secret_references <= {"GITHUB_TOKEN"}, "only the ephemeral GITHUB_TOKEN may be referenced")

    for job_name in ("candidate", "event_candidate", "event_promote", "canary_5", "canary_25", "promote_100", "coordinated_rollback", "api_only_rollback"):
        block = job_block(workflow_text, job_name)
        require(re.search(r"(?m)^      id-token: write$", block) is not None,
                f"{job_name} lacks OIDC id-token permission")
        require(re.search(r"(?m)^    environment:$", block) is not None,
                f"{job_name} lacks a GitHub Environment approval gate")
    for job_name in ("event_promote", "canary_5", "canary_25", "promote_100"):
        block = job_block(workflow_text, job_name)
        for permission in ("checks", "statuses", "pull-requests"):
            require(re.search(rf"(?m)^      {permission}: read$", block) is not None,
                    f"{job_name} cannot perform its just-in-time Production revalidation")
        require("check-gcp-backend-production-gate.py" in block,
                f"{job_name} does not revalidate the Production gate before traffic")
        require(re.search(r"(?m)^      actions: read$", block) is not None,
                f"{job_name} cannot revalidate maintenance run/artifact metadata")
        require("check-gcp-maintenance-gate.py" in block,
                f"{job_name} does not revalidate maintenance evidence before traffic")
    candidate_block = job_block(workflow_text, "candidate")
    require('[ "$PROJECT_ID" = "$DATABASE_PROJECT_ID" ]' in candidate_block
            and '[ "$REGION" = "$DATABASE_REGION" ]' in candidate_block,
            "Preview/Production project and region are not bound to database evidence before authentication")
    common_bindings = (
        "EXPECTED_DATABASE_PROJECT_ID",
        "EXPECTED_DATABASE_REGION",
        "EXPECTED_DATABASE_INSTANCE",
        "EXPECTED_DATABASE_NAME",
        "EXPECTED_GCS_UPLOAD_BUCKET",
        "EXPECTED_GCS_FINAL_BUCKET",
        "EXPECTED_STORAGE_TARGET_JSON",
        "EXPECTED_CLOUD_SQL_PROXY_IMAGE",
        "EXPECTED_RUNTIME_SECURITY_JSON",
    )
    for expected_binding in common_bindings:
        require(expected_binding in candidate_block,
                f"API candidate lacks database binding: {expected_binding}")
        for job_name in ("event_candidate", "event_promote", "canary_5", "canary_25", "promote_100"):
            require(expected_binding in job_block(workflow_text, job_name),
                    f"{job_name} lacks database binding: {expected_binding}")
        require(
            workflow_text.count(f"{expected_binding}:") == 7,
            f"all seven API/event current-candidate/pre-traffic invocations must receive {expected_binding}",
        )
    require("EXPECTED_DATABASE_API_PRINCIPAL" in candidate_block,
            "API candidate lacks exact sealed API principal")
    for job_name in ("canary_5", "canary_25", "promote_100"):
        require("EXPECTED_DATABASE_API_PRINCIPAL" in job_block(workflow_text, job_name),
                f"{job_name} lacks exact sealed API principal")
    for job_name in ("event_candidate", "event_promote"):
        block = job_block(workflow_text, job_name)
        require("EXPECTED_DATABASE_EVENT_PRINCIPAL" in block,
                f"{job_name} lacks exact sealed event principal")
    event_promote_block = job_block(workflow_text, "event_promote")
    require("verify-database-binding" in event_promote_block
            and "CONTAINER: events" in event_promote_block
            and "needs.event_candidate.outputs.candidate_revision" in event_promote_block,
            "current/candidate event DB binding is not rechecked before event traffic")
    require(re.search(r"(?m)^      actions: read$", job_block(workflow_text, "validate")) is not None,
            "validate job cannot inspect or download maintenance evidence")

    expected_private_runner = (
        "    runs-on:\n"
        "      - self-hosted\n"
        "      - linux\n"
        "      - x64\n"
        "      - simsa-gcp-private\n"
    )
    for job_name in ("event_candidate", "event_promote", "coordinated_rollback"):
        require(expected_private_runner in job_block(workflow_text, job_name),
                f"{job_name} must stay on the dedicated VPC runner")

    required_environment_fragments = (
        "backend-candidate",
        "backend-event-candidate",
        "backend-event-promote",
        "backend-canary-5",
        "backend-canary-25",
        "backend-promote-100",
        "backend-coordinated-rollback",
    )
    for fragment in required_environment_fragments:
        require(fragment in workflow_text, f"approval environment {fragment} is missing")

    require(release_text.count("docker build --pull --target runtime") == 1,
            "the API runtime image must be built exactly once")
    require("docker push" in release_text and "image_summary.digest" in release_text,
            "Artifact Registry digest resolution is missing")
    require("--no-traffic" in release_text and "--tag" in release_text,
            "candidate must deploy as a tagged no-traffic revision")
    require("gcloud run services update \"$SERVICE\"" in release_text,
            "container-only Cloud Run update is missing")
    require("gcloud run deploy" not in release_text,
            "gcloud run deploy could replace Terraform-managed service configuration")
    require("--container \"$CONTAINER\"" in release_text,
            "named container update is required to preserve the sidecar")
    require("CANDIDATE_PERCENT" in release_text and "^(5|25|100)$" in release_text,
            "fixed 5/25/100 traffic stages are missing")
    require("rollback_on_error" in release_text and "rollback-preflight" in release_text,
            "automatic rollback and tested rollback preflight are required")
    require("/health /ready" in release_text, "both health and readiness probes are required")
    require("seq 1 20" in release_text, "probes must use bounded retries")
    require("print-identity-token" in release_text,
            "private event probe must use a Cloud Run identity token")
    require("previous_digest" in release_text and "rollback-command.sh" in release_text,
            "previous digest and rollback evidence are missing")
    require("assert_service_identity" in release_text
            and '$labels.application == "simsa"' in release_text
            and "$labels.environment == $expected_environment" in release_text
            and '$labels.managed_by == "terraform"' in release_text,
            "Cloud Run target is not bound to SIMSA Terraform environment labels")
    require(release_text.count("assert_service_identity") >= 5,
            "service identity must be rechecked for candidate, promotion, and rollback")
    require("check-gcp-cloud-run-database-binding.py" in release_text
            and release_text.count("assert_database_binding") >= 9
            and "EXPECTED_DATABASE_EVENT_PRINCIPAL" in release_text,
            "current/candidate API and event bindings are not checked for Preview/Production")
    require("verify-database-binding" in release_text
            and "Current runtime baseline changed before promotion" in release_text,
            "pre-promotion verifier does not recheck the exact active runtime baseline")
    for live_storage_check in (
        "assert_live_storage_target", "gcloud storage buckets describe",
        "uniformBucketLevelAccess.enabled", "publicAccessPrevention",
        "Live project number drifted from sealed storage evidence",
        '--argjson expected "$expected_bucket"',
        "((.labels // {}) == $expected.labels)",
        "sealed_target: $sealed",
    ):
        require(live_storage_check in release_text,
                f"release does not fail closed on live storage drift: {live_storage_check}")
    require("backend_deploy_database_evidence_metadata" in iam_text
            and 'database_evidence_metadata_reader.name' in iam_text
            and 'serviceAccount:${var.backend_deploy_service_account_email}' in iam_text,
            "backend deploy identity lacks the Terraform metadata-read role")
    for binding in (
        "GOOGLE_CLOUD_PROJECT",
        "DB_NAME",
        "DB_USER",
        "GCS_UPLOAD_BUCKET",
        "GCS_BUCKET",
        "cloud-sql-proxy",
        "--auto-iam-authn",
        "serviceAccountName",
        "runtime_container",
        "database_principal",
        "cloud_sql_proxy_image",
        "runtime_security",
    ):
        require(binding in cloud_run_database_gate_text,
            f"Cloud Run database checker is missing: {binding}")
    require("Cloud Run revision container set is not exact" in cloud_run_database_gate_text
            and "Cloud Run events command/args" in cloud_run_database_gate_text
            and "Cloud Run API must use the reviewed image command" in cloud_run_database_gate_text,
            "runtime checker does not bind exact containers and entrypoints")
    require("event-service-iam-policy.json" in release_text
            and "roles/run.invoker" in release_text
            and "EXPECTED_EVENTARC_INVOKER_SERVICE_ACCOUNT" in release_text
            and "INGRESS_TRAFFIC_INTERNAL_ONLY" in release_text,
            "event ingress/invoker IAM is not fail-closed")
    rollback_block = job_block(workflow_text, "coordinated_rollback")
    require("always()" in rollback_block
            and "needs.event_candidate.result == 'success'" in rollback_block
            and "needs.event_promote.result != 'success'" in rollback_block,
            "coordinated rollback is not armed after a failed/cancelled event promotion")
    for upstream in ("canary_5", "canary_25", "promote_100"):
        require(f"needs.{upstream}.result != 'success'" in rollback_block,
                f"coordinated rollback does not cover {upstream} failure/cancellation")
    require("coordinated-rollback" in rollback_block and "coordinated-rollback" in release_text,
            "two-service coordinated rollback mode is missing")
    for binding in ("API_PREVIOUS_REVISION", "API_PREVIOUS_DIGEST",
                    "EVENT_PREVIOUS_REVISION", "EVENT_PREVIOUS_DIGEST"):
        require(binding in rollback_block and binding in release_text,
                f"coordinated rollback is not bound to {binding}")
    require('ROLLBACK_EVENT: "true"' in rollback_block,
            "two-service rollback does not require event restoration")
    require("EXPECTED_EVENTARC_INVOKER_SERVICE_ACCOUNT" in rollback_block,
            "event rollback cannot revalidate the sealed Eventarc invoker IAM")
    api_rollback_block = job_block(workflow_text, "api_only_rollback")
    require("always()" in api_rollback_block
            and "!inputs.deploy_event_receiver" in api_rollback_block
            and "needs.candidate.result == 'success'" in api_rollback_block,
            "API-only rollback is not armed for an incomplete no-event release")
    for upstream in ("canary_5", "canary_25", "promote_100"):
        require(f"needs.{upstream}.result != 'success'" in api_rollback_block,
                f"API-only rollback does not cover {upstream} failure/cancellation")
    require('ROLLBACK_EVENT: "false"' in api_rollback_block
            and "coordinated-rollback" in api_rollback_block,
            "API-only rollback does not use the verified idempotent rollback mode")
    require("API_PREVIOUS_REVISION" in api_rollback_block
            and "API_PREVIOUS_DIGEST" in api_rollback_block,
            "API-only rollback is not bound to the exact prior revision/digest")
    require("all_requested_components_restored" in release_text,
            "rollback does not record exact requested-component verification")
    require("preview|production" in release_text and "preview|staging|production" not in release_text,
            "release script still permits ungated Staging deployment")
    require("reviews_by_pull" in gate_text and "approved_reviewers" in gate_text,
            "Production gate must prove effective PR approval evidence")
    require("reviewed_commit == head_sha" in gate_text and 'reviewer.get("type") or "") == "User"' in gate_text,
            "Production approval must be human, non-stale, and on the final PR head")
    require("fail_closed_minimum" in gate_text,
            "Production review count must fail closed when branch detail is unavailable")

    require(RUNBOOK.exists(), "GCP backend release runbook is missing")
    subprocess.run(
        [sys.executable, str(GATE_SCRIPT), "--self-test"],
        cwd=ROOT,
        check=True,
    )
    subprocess.run(
        [sys.executable, str(MAINTENANCE_GATE_SCRIPT), "--self-test"],
        cwd=ROOT,
        check=True,
    )
    subprocess.run(
        [sys.executable, str(CLOUD_RUN_DATABASE_GATE), "--self-test"],
        cwd=ROOT,
        check=True,
    )
    print("GCP backend release workflow validation: ok")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, OSError, subprocess.CalledProcessError) as error:
        print(f"GCP backend release workflow validation failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
