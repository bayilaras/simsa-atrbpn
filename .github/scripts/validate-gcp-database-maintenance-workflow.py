#!/usr/bin/env python3
"""Static fail-closed checks for controlled GCP database maintenance."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "database-maintenance-gcp.yml"
RUNNER = ROOT / ".github" / "scripts" / "run-gcp-database-maintenance.sh"
GATE = ROOT / ".github" / "scripts" / "check-gcp-maintenance-gate.py"
EVIDENCE_SQL = ROOT / ".github" / "scripts" / "collect-database-maintenance-evidence.sql"
RUNBOOK = ROOT / "GCP_DATABASE_MAINTENANCE.md"
IAM = ROOT / "docs/infra/firebase-gcp/terraform/service-accounts.tf"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    workflow = WORKFLOW.read_text(encoding="utf-8")
    runner = RUNNER.read_text(encoding="utf-8")
    evidence_sql = EVIDENCE_SQL.read_text(encoding="utf-8")
    gate = GATE.read_text(encoding="utf-8")
    iam = IAM.read_text(encoding="utf-8")

    require(re.search(r"(?m)^on:\n  workflow_dispatch:\n", workflow) is not None,
            "maintenance must be workflow_dispatch-only")
    for forbidden_trigger in ("push", "pull_request", "schedule", "workflow_run"):
        require(re.search(rf"(?m)^  {forbidden_trigger}:\s*$", workflow) is None,
                f"unexpected automatic maintenance trigger: {forbidden_trigger}")
    required_inputs = (
        "environment",
        "commit_sha",
        "backup_run_id",
        "backup_artifact_id",
        "backup_artifact_digest",
        "production_confirmation",
    )
    for input_name in required_inputs:
        require(
            re.search(rf"(?ms)^      {input_name}:\n.*?^        required: true\n", workflow) is not None,
            f"required maintenance input is missing: {input_name}",
        )
    require(re.search(r"(?ms)^      environment:\n.*?^        options:\n          - production\n", workflow) is not None,
            "maintenance environment must remain Production-only")
    require("MAINTAIN_PRODUCTION" in workflow, "explicit Production confirmation is missing")
    definition_binding = workflow.find(
        "Bind the loaded Production workflow definition to the requested commit"
    )
    initial_checkout = workflow.find("Check out the exact maintenance commit")
    require(-1 < definition_binding < initial_checkout,
            "Production workflow definition must be bound to GITHUB_SHA before checkout")
    require('${GITHUB_SHA,,}' in workflow
            and "ref: ${{ steps.request.outputs.commit_sha }}" in workflow,
            "Production checkout is not fed only by the normalized workflow-definition binding")
    require("cancel-in-progress: false" in workflow, "maintenance runs must queue, not cancel")

    job_names = re.findall(r"(?m)^  ([A-Za-z0-9_]+):\n    name:", workflow)
    require(job_names == ["maintain"], "maintenance workflow must remain one protected serial job")
    expected_runner = (
        "    runs-on:\n"
        "      - self-hosted\n"
        "      - linux\n"
        "      - x64\n"
        "      - simsa-gcp-private\n"
        "      - simsa-gcp-maintenance\n"
    )
    require(expected_runner in workflow, "maintenance is not pinned to the private Linux/VPC runner")
    require("name: gcp-production-database-maintenance" in workflow,
            "protected Production maintenance Environment is missing")
    for permission in ("actions", "checks", "contents", "id-token", "pull-requests", "statuses"):
        expected = "write" if permission == "id-token" else "read"
        require(re.search(rf"(?m)^      {permission}: {expected}$", workflow) is not None,
                f"job permission is missing: {permission}: {expected}")

    uses = re.findall(r"^\s*uses:\s*([^@\s]+)@([^\s#]+)", workflow, flags=re.MULTILINE)
    require(uses, "maintenance workflow uses no actions")
    for action, ref in uses:
        require(re.fullmatch(r"[0-9a-f]{40}", ref) is not None,
                f"action is not pinned by full SHA: {action}")
    require(
        {
            "actions/checkout",
            "actions/download-artifact",
            "actions/upload-artifact",
            "google-github-actions/auth",
        }
        <= {action for action, _ in uses},
        "required pinned actions are missing",
    )
    require(workflow.count("google-github-actions/auth@") == 6,
            "each grant-admin/migrator/maintenance phase must re-establish its WIF identity")
    require("credentials_json" not in workflow.lower(), "static Google credentials are forbidden")
    require("service_account_key" not in workflow.lower(), "service-account key material is forbidden")
    secret_references = set(re.findall(r"secrets\.([A-Za-z0-9_]+)", workflow))
    require(secret_references <= {"GITHUB_TOKEN"}, "maintenance may only reference ephemeral GITHUB_TOKEN")
    require("persist-credentials: false" in workflow, "checkout credentials must not persist")

    require(workflow.count("check-gcp-maintenance-gate.py") == 3,
            "backup metadata and downloaded content must be checked, including self-test")
    require("check-gcp-backend-production-gate.py" in workflow,
            "review/merge/required-check source gate is missing before database mutation")
    require("actions/download-artifact@" in workflow and "merge-multiple: true" in workflow,
            "exact encrypted backup artifact is not downloaded for manifest verification")
    for binding in ("schema_profile", "repository_commit", "workflow_run", "pre_migration"):
        require(binding in gate,
                f"downloaded backup manifest binding is not verified: {binding}")
    target_resolution = workflow.find(
        "Resolve exact Production backup target binding before the backup gate"
    )
    first_backup_gate = workflow.find("--kind backup")
    first_mutation = workflow.find("run-gcp-database-maintenance.sh bootstrap")
    require(
        -1 < target_resolution < first_backup_gate < first_mutation,
        "the exact Production database target must be resolved before backup acceptance and mutation",
    )
    require(workflow.count("--expected-source-identity-sha256") == 2,
            "both backup metadata/content checks must receive the protected target identity hash")
    require(
        "f\"{values['PROJECT_ID']}:{values['REGION']}:{values['INSTANCE']}/\"" in workflow
        and "f\"{values['DATABASE']}/{values['BACKUP_PRINCIPAL']}\"" in workflow
        and "hashlib.sha256(canonical.encode('utf-8')).hexdigest()" in workflow,
        "the pre-gate target hash does not use the canonical project:region:instance/database/user format",
    )
    require(
        "printf '%s' \"$connection_name/$DATABASE/$BACKUP_PRINCIPAL\"" in workflow
        and 'source_identity_sha256" = "$EXPECTED_SOURCE_IDENTITY_SHA256' in workflow,
        "the mutation target is not recomputed and compared with the pre-gate target hash",
    )
    require(
        "backup source identity does not match the Production maintenance target" in gate
        and 'metadata.get("expected_source_identity_sha256")' in gate,
        "the downloaded manifest checker does not fail closed on a target mismatch",
    )
    for target_key in (
        "project_id",
        "region",
        "instance",
        "connection_name",
        "database",
        "api_principal",
        "event_principal",
        "worker_principal",
        "final_cleanup_principal",
        "runtime_identities",
        "cloud_sql_proxy_image",
        "eventarc_invoker_service_account",
        "backup_principal",
        "source_identity_sha256",
    ):
        require(target_key in workflow and target_key in gate,
                f"maintenance evidence does not bind database target field: {target_key}")
    require("canonical_source.encode(\"utf-8\")" in gate
            and "maintenance database target identity hash is inconsistent" in gate,
            "maintenance evidence target components are not independently rehashed")
    for storage_binding in (
        "GCP_UPLOAD_BUCKET", "GCP_FINAL_BUCKET", "gcloud storage buckets describe",
        "storage_target", "uniformBucketLevelAccess.enabled",
        'publicAccessPrevention) == "enforced"', '.labels.purpose == $purpose',
        "GCP_CLOUD_SQL_PROXY_IMAGE", "GCP_FIREBASE_APP_CHECK_APP_IDS",
        "GCP_FRONTEND_URL", "GCP_EVENTARC_INVOKER_SERVICE_ACCOUNT", "runtime_security",
    ):
        require(storage_binding in workflow or storage_binding in gate,
                f"Production storage target evidence is missing: {storage_binding}")
    config_step = re.search(
        r"(?ms)^      - name: Resolve protected database identities and target\n"
        r"(.*?)(?=^      - name: )",
        workflow,
    )
    require(config_step is not None, "protected Production target resolution step is missing")
    config_text = config_step.group(1)
    for scoped_variable in (
        "UPLOAD_BUCKET",
        "FINAL_BUCKET",
        "CLOUD_SQL_PROXY_IMAGE",
        "FIREBASE_APP_CHECK_APP_IDS",
        "FRONTEND_URL",
        "ADDITIONAL_TRUSTED_ORIGINS",
        "EVENTARC_INVOKER_SA",
    ):
        require(
            re.search(rf"(?m)^          {scoped_variable}: \$\{{\{{ vars\.[A-Z0-9_]+ \}}\}}$", config_text)
            is not None,
            f"{scoped_variable} must be scoped directly on the protected target resolution step",
        )
        require(
            f"${scoped_variable}" in config_text or f"'{scoped_variable}'" in config_text,
            f"{scoped_variable} is declared but not consumed by protected target resolution",
        )
    require('"resourcemanager.projects.get"' in iam
            and '"storage.buckets.get"' in iam
            and 'member  = google_service_account.grant_admin.member' in iam,
            "grant-admin lacks the least-privilege project/bucket metadata evidence role")
    evidence_role = re.search(
        r'(?ms)resource "google_project_iam_custom_role" "database_evidence_metadata_reader" \{(.*?)^\}',
        iam,
    )
    require(evidence_role is not None and "storage.objects." not in evidence_role.group(1),
            "database evidence metadata role must not grant object access")

    operations = [
        "run-gcp-database-maintenance.sh bootstrap",
        "run-gcp-database-maintenance.sh migrate",
        "run-gcp-database-maintenance.sh bootstrap",
        "run-gcp-database-maintenance.sh converge",
        "run-gcp-database-maintenance.sh seed",
        "run-gcp-database-maintenance.sh evidence",
    ]
    cursor = 0
    for operation in operations:
        position = workflow.find(operation, cursor)
        require(position >= 0, f"ordered operation is missing: {operation}")
        cursor = position + len(operation)
    require("bootstrap-initial" in workflow and "bootstrap-final" in workflow,
            "initial CREATE grant and post-migration revocation phases are not separately evidenced")
    require("EXPECTED_MIGRATIONS_JSON" in workflow and "build-migration-manifest.py" in workflow,
            "grant/evidence convergence is not bound to the reviewed migration manifest")
    require("db:push" not in workflow and "db:push" not in runner,
            "unsafe schema push command is forbidden")

    require(workflow.count("docker build --pull --target maintenance") == 1,
            "maintenance image must be built exactly once")
    for label in ("org.opencontainers.image.revision", "org.opencontainers.image.source"):
        require(label in workflow, f"reviewed maintenance image label is missing: {label}")
    require("--iidfile" in workflow and "maintenance_image_digest" in workflow,
            "maintenance image content digest is not captured")
    require("cloud-sql-proxy.linux.amd64" in workflow and "sha256sum --check --status" in workflow,
            "Cloud SQL Auth Proxy is not checksum pinned")
    require("--private-ip" in runner and "--auto-iam-authn" in runner,
            "maintenance connection is not private and keyless IAM authenticated")
    require("PROXY_PORT=$((30000 + ((GITHUB_RUN_ID * 17 + GITHUB_RUN_ATTEMPT) % 10000)))" in runner
            and '--port "$PROXY_PORT"' in runner
            and 'PGPORT=$PROXY_PORT' in runner,
            "maintenance proxy is not isolated on its deterministic per-run port")
    require("--read-only" in runner and "--cap-drop ALL" in runner and "no-new-privileges" in runner,
            "maintenance containers lack runtime hardening")
    require("--env \"EXPECTED_MIGRATIONS_JSON=$EXPECTED_MIGRATIONS_JSON\"" in runner,
            "migration manifest is not passed into grant convergence")
    require("--set \"expected_migrations_json=$EXPECTED_MIGRATIONS_JSON\"" in runner,
            "migration manifest is not passed into evidence SQL")
    require("GCP_DB_BACKUP_SERVICE_ACCOUNT" in workflow
            and "GCP_DB_BACKUP_PRINCIPAL" in workflow
            and "DB_BACKUP_PRINCIPAL" in workflow,
            "the Terraform backup IAM identity is not resolved by maintenance")
    require("('BACKUP_SA', 'BACKUP_PRINCIPAL')" in workflow,
            "the backup Cloud SQL principal is not bound to its exact service account")
    for binding in (
        "('API_SA', 'API_PRINCIPAL')",
        "('EVENT_SA', 'EVENT_PRINCIPAL')",
        "('WORKER_SA', 'WORKER_PRINCIPAL')",
        "('FINAL_CLEANUP_SA', 'FINAL_CLEANUP_PRINCIPAL')",
    ):
        require(binding in workflow, f"canonical runtime identity pair is missing: {binding}")
    for account_id in (
        "simsa-api-runtime", "simsa-event-runtime",
        "simsa-malware-worker", "simsa-final-cleanup",
    ):
        require(account_id in workflow, f"Terraform runtime account ID is not enforced: {account_id}")
    require("len(set(service_accounts.values())) != len(service_accounts)" in workflow,
            "all database service accounts are not required to be distinct")
    require("'BACKUP_PRINCIPAL'," in workflow and "len(set(principals.values()))" in workflow,
            "the backup IAM database principal is not covered by the distinct-login check")
    require("DB_BACKUP_PRINCIPAL" in runner,
            "the backup IAM database principal is not required by the maintenance runner")
    require('--env "DB_BACKUP_PRINCIPAL=$DB_BACKUP_PRINCIPAL"' in runner,
            "the backup IAM database principal is not passed into both bootstrap phases")
    require('--set "backup_principal=$DB_BACKUP_PRINCIPAL"' in runner,
            "database evidence is not bound to the exact backup login principal")

    for command in ("db:roles:bootstrap", "db:migrate", "db:grants:converge", "seed:all"):
        require(command in workflow or command in runner, f"required command is missing: {command}")
    for evidence_key in (
        "migration_manifest_verified",
        "migrator_database_create",
        "acl_fingerprint_md5",
        "principal_memberships_verified",
        "role_membership_closure_verified",
        "runtime_identity_bindings",
        "seed",
        "database_target",
        "source_identity_sha256",
    ):
        require(evidence_key in evidence_sql or evidence_key in workflow,
                f"database evidence is missing: {evidence_key}")
    require("evidence-manifest.sha256" in workflow and "artifact-digest" in workflow,
            "immutable maintenance evidence artifact is not sealed")
    require("retention-days: 90" in workflow, "maintenance evidence retention is unexpectedly short")
    require(RUNBOOK.exists(), "database maintenance runbook is missing")

    terraform_service_accounts = (ROOT / "docs/infra/firebase-gcp/terraform/service-accounts.tf").read_text(encoding="utf-8")
    terraform_database = (ROOT / "docs/infra/firebase-gcp/terraform/database.tf").read_text(encoding="utf-8")
    terraform_outputs = (ROOT / "docs/infra/firebase-gcp/terraform/outputs.tf").read_text(encoding="utf-8")
    require('resource "google_service_account" "grant_admin"' in terraform_service_accounts,
            "dedicated grant-admin service account is missing")
    require('resource "google_service_account" "backup"' in terraform_service_accounts,
            "dedicated backup service account is missing")
    require('resource "google_sql_user" "grant_admin"' in terraform_database,
            "dedicated grant-admin IAM database user is missing")
    require('resource "google_sql_user" "backup"' in terraform_database,
            "dedicated backup IAM database user is missing")
    require('output "cloud_sql_backup_identity"' in terraform_outputs
            and "service_account    = google_service_account.backup.email" in terraform_outputs
            and "database_principal = google_sql_user.backup.name" in terraform_outputs,
            "maintenance has no canonical Terraform output for the backup principal")
    require('output "database_runtime_identities"' in terraform_outputs
            and "service_account    = google_service_account.api.email" in terraform_outputs
            and "database_principal = google_sql_user.api.name" in terraform_outputs
            and "service_account    = google_service_account.events.email" in terraform_outputs
            and "database_principal = google_sql_user.events.name" in terraform_outputs
            and "service_account    = google_service_account.worker.email" in terraform_outputs
            and "database_principal = google_sql_user.worker.name" in terraform_outputs,
            "maintenance has no canonical Terraform output for runtime database identities")

    subprocess.run([sys.executable, str(GATE), "--self-test"], cwd=ROOT, check=True)
    print("GCP database maintenance workflow validation: ok")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, OSError, subprocess.CalledProcessError) as error:
        print(f"GCP database maintenance workflow validation failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
