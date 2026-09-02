#!/usr/bin/env python3
"""Fail-closed static policy checks for the isolated Preview DB workflow."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github/workflows/database-bootstrap-gcp-preview.yml"
RUNNER = ROOT / ".github/scripts/run-gcp-database-maintenance.sh"
SOURCE_GATE = ROOT / ".github/scripts/check-gcp-backend-production-gate.py"
EVIDENCE_GATE = ROOT / ".github/scripts/check-gcp-maintenance-gate.py"
RUNBOOK = ROOT / "GCP_PREVIEW_DATABASE.md"
TERRAFORM_WORKFLOW = ROOT / ".github/workflows/terraform-validate.yml"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def validate(workflow: str, runner: str) -> None:
    require(re.search(r"(?m)^on:\n  workflow_dispatch:\n", workflow) is not None,
            "Preview bootstrap must be workflow_dispatch-only")
    for trigger in ("push", "pull_request", "schedule", "workflow_run"):
        require(re.search(rf"(?m)^  {trigger}:\s*$", workflow) is None,
                f"unexpected automatic trigger: {trigger}")
    for name in ("environment", "commit_sha", "preview_confirmation"):
        require(re.search(rf"(?ms)^      {name}:\n.*?^        required: true\n", workflow) is not None,
                f"required input is missing: {name}")
    require(re.search(r"(?ms)^      environment:\n.*?^        options:\n          - preview\n", workflow) is not None,
            "input environment is not Preview-only")
    require("BOOTSTRAP_ISOLATED_PREVIEW" in workflow,
            "explicit Preview confirmation is missing")
    definition_binding = workflow.find(
        "Bind the loaded Preview workflow definition to the requested commit"
    )
    initial_checkout = workflow.find("Check out the exact reviewed merge commit")
    require(-1 < definition_binding < initial_checkout,
            "Preview workflow definition must be bound to GITHUB_SHA before checkout")
    require('${GITHUB_SHA,,}' in workflow
            and "ref: ${{ steps.request.outputs.commit_sha }}" in workflow,
            "Preview checkout is not fed only by the normalized workflow-definition binding")
    require("cancel-in-progress: false" in workflow,
            "database mutations must queue rather than cancel")

    require(re.findall(r"(?m)^  ([A-Za-z0-9_]+):\n    name:", workflow) == ["bootstrap"],
            "Preview bootstrap must remain one serial protected job")
    require(
        "    runs-on:\n"
        "      - self-hosted\n"
        "      - linux\n"
        "      - x64\n"
        "      - simsa-gcp-private\n"
        "      - simsa-gcp-preview-db\n" in workflow,
        "workflow is not pinned to the private Preview database runner",
    )
    require("name: gcp-preview-database-bootstrap" in workflow,
            "Preview GitHub Environment boundary is missing")
    require("gcp-production-database-maintenance" not in workflow,
            "Production Environment must never be referenced")
    require("vars.GCP_DB_" not in workflow,
            "unscoped Production database variables must never be referenced")
    preview_vars = set(re.findall(r"vars\.([A-Za-z0-9_]+)", workflow))
    require(preview_vars and all(name.startswith("PREVIEW_GCP_") for name in preview_vars),
            "every database/storage/runtime variable must be explicitly Preview-scoped")
    secret_references = set(re.findall(r"secrets\.([A-Za-z0-9_]+)", workflow))
    require(secret_references == {"GITHUB_TOKEN"},
            "Preview database workflow may only use ephemeral GITHUB_TOKEN")
    require("credentials_json" not in workflow.lower() and "service_account_key" not in workflow.lower(),
            "static Google credentials are forbidden")
    require("persist-credentials: false" in workflow,
            "checkout credentials must not persist")

    for permission in ("checks", "contents", "pull-requests", "statuses"):
        require(re.search(rf"(?m)^      {permission}: read$", workflow) is not None,
                f"missing read-only permission: {permission}")
    require(re.search(r"(?m)^      id-token: write$", workflow) is not None,
            "WIF OIDC permission is missing")
    uses = re.findall(r"^\s*uses:\s*([^@\s]+)@([^\s#]+)", workflow, flags=re.MULTILINE)
    require(uses, "workflow uses no pinned actions")
    for action, ref in uses:
        require(re.fullmatch(r"[0-9a-f]{40}", ref) is not None,
                f"action is not pinned by full SHA: {action}")
    require({"actions/checkout", "actions/upload-artifact", "google-github-actions/auth",
             "google-github-actions/setup-gcloud"} <= {action for action, _ in uses},
            "required pinned actions are missing")
    require(workflow.count("google-github-actions/auth@") == 6,
            "every privileged phase must establish its own WIF identity")

    require("check-gcp-backend-production-gate.py" in workflow,
            "reviewed merge/current-main/required-check gate is missing")
    for binding in ("GITHUB_REF_TYPE", "GITHUB_REF_NAME", "DEFAULT_BRANCH", "GITHUB_SHA"):
        require(binding in workflow, f"exact default-branch binding is missing: {binding}")
    require("reviewed-merge-gate.json" in workflow,
            "merge/check evidence is not retained")

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
            "the two role-bootstrap phases are not separately evidenced")
    require("EXPECTED_MIGRATIONS_JSON" in workflow and "build-migration-manifest.py" in workflow,
            "grant/evidence phases are not bound to the reviewed migration manifest")
    require("db:push" not in workflow and "db:push" not in runner,
            "unsafe schema push is forbidden")

    require("docker build --pull --target maintenance" in workflow and "--iidfile" in workflow,
            "reviewed maintenance image is not content-addressed")
    require("cloud-sql-proxy.linux.amd64" in workflow and "sha256sum --check --status" in workflow,
            "Cloud SQL Auth Proxy is not checksum-pinned")
    require("--private-ip" in runner and "--auto-iam-authn" in runner,
            "database connection is not private/keyless IAM")
    require("--read-only" in runner and "--cap-drop ALL" in runner and "no-new-privileges" in runner,
            "maintenance container is not hardened")

    for label in ('.settings.userLabels.application == "simsa"',
                  '.settings.userLabels.environment == "preview"',
                  '.settings.userLabels.managed_by == "terraform"',
                  '.settings.ipConfiguration.ipv4Enabled == false'):
        require(label in workflow, f"Cloud SQL Preview boundary check is missing: {label}")
    require('any(.settings.databaseFlags[]?' in workflow and 'cloudsql.iam_authentication' in workflow,
            "Cloud SQL IAM authentication boundary is not checked")
    require("vars.GCP_DB_BACKUP" not in workflow and "vars.PREVIEW_GCP_DB_BACKUP" in workflow,
            "backup principal is not explicitly Preview-scoped")
    require("len(set(service_accounts.values())) != len(service_accounts)" in workflow,
            "all Preview database service accounts are not required to be distinct")
    require("len(set(principals.values())) != len(principals)" in workflow,
            "Preview login principals are not required to be distinct")
    for binding in (
        "('API_SA', 'API_PRINCIPAL')",
        "('EVENT_SA', 'EVENT_PRINCIPAL')",
        "('WORKER_SA', 'WORKER_PRINCIPAL')",
        "('FINAL_CLEANUP_SA', 'FINAL_CLEANUP_PRINCIPAL')",
    ):
        require(binding in workflow, f"canonical Preview runtime identity pair is missing: {binding}")
    for account_id in (
        "simsa-api-runtime", "simsa-event-runtime",
        "simsa-malware-worker", "simsa-final-cleanup",
    ):
        require(account_id in workflow, f"Terraform Preview runtime account ID is not enforced: {account_id}")
    require("runtime_identity_bindings" in workflow
            and "role_membership_closure_verified" in workflow,
            "Preview artifact does not seal runtime identity and membership closure evidence")

    require("preview-database-summary.json" in workflow and "evidence-manifest.sha256" in workflow,
            "sealed Preview database evidence is missing")
    for target_field in (
        "connection_name", "database", "runtime_identities", "api_principal",
        "event_principal", "worker_principal", "final_cleanup_principal",
        "grant_admin_principal", "migrator_principal", "maintenance_principal",
        "backup_principal", "storage_target",
        "cloud_sql_proxy_image", "eventarc_invoker_service_account", "runtime_security",
    ):
        require(target_field in workflow,
                f"sealed Preview target is missing: {target_field}")
    for storage_proof in (
        "PREVIEW_GCP_UPLOAD_BUCKET", "PREVIEW_GCP_FINAL_BUCKET",
        "gcloud storage buckets describe", "uniformBucketLevelAccess.enabled",
        'publicAccessPrevention) == "enforced"', '.labels.purpose == $purpose',
        "PREVIEW_GCP_CLOUD_SQL_PROXY_IMAGE", "PREVIEW_GCP_FIREBASE_APP_CHECK_APP_IDS",
        "PREVIEW_GCP_FRONTEND_URL", "PREVIEW_GCP_EVENTARC_INVOKER_SERVICE_ACCOUNT",
    ):
        require(storage_proof in workflow,
                f"Preview storage evidence is missing: {storage_proof}")
    require("actions/upload-artifact@" in workflow and "artifact-digest" in workflow,
            "immutable evidence artifact identity is not captured")
    require("retention-days: 30" in workflow,
            "Preview evidence retention is missing")
    require(RUNBOOK.exists(), "Preview database runbook is missing")
    require(SOURCE_GATE.exists(), "reviewed merge gate implementation is missing")


def self_test(workflow: str, runner: str) -> None:
    mutations = (
        workflow.replace("name: gcp-preview-database-bootstrap", "name: gcp-production-database-maintenance", 1),
        workflow.replace("vars.PREVIEW_GCP_DB_PROJECT_ID", "vars.GCP_DB_PROJECT_ID", 1),
        workflow.replace("run-gcp-database-maintenance.sh migrate", "db:push", 1),
        workflow.replace('.settings.userLabels.environment == "preview"', '.settings.userLabels.environment == "production"', 1),
    )
    for index, mutation in enumerate(mutations, start=1):
        try:
            validate(mutation, runner)
        except AssertionError:
            continue
        raise AssertionError(f"Preview workflow mutation self-test {index} was accepted")


def main() -> int:
    workflow = WORKFLOW.read_text(encoding="utf-8")
    runner = RUNNER.read_text(encoding="utf-8")
    validate(workflow, runner)
    self_test(workflow, runner)
    terraform_workflow = TERRAFORM_WORKFLOW.read_text(encoding="utf-8")
    require("validate-gcp-preview-database-workflow.py" in terraform_workflow,
            "PR/push validation workflow does not execute the Preview policy validator")
    subprocess.run([sys.executable, str(SOURCE_GATE), "--self-test"], cwd=ROOT, check=True)
    subprocess.run([sys.executable, str(EVIDENCE_GATE), "--self-test"], cwd=ROOT, check=True)
    print("GCP Preview database workflow validation: ok")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, OSError, subprocess.CalledProcessError) as error:
        print(f"GCP Preview database workflow validation failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
