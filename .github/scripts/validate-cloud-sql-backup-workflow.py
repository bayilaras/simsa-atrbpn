#!/usr/bin/env python3
"""Static fail-closed checks for the Cloud SQL backup workflow."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "backup-cloud-sql.yml"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"backup-cloud-sql validation failed: {message}")


def job_block(workflow: str, job_name: str) -> str:
    match = re.search(
        rf"(?ms)^  {re.escape(job_name)}:\n(.*?)(?=^  [A-Za-z0-9_-]+:\n|\Z)",
        workflow,
    )
    require(match is not None, f"job is missing: {job_name}")
    return match.group(0)


text = WORKFLOW.read_text(encoding="utf-8")

require("schedule:" in text and "workflow_dispatch:" in text, "safe triggers are missing")
require("pull_request:" not in text and "push:" not in text, "unsafe source trigger is present")
backup_job = job_block(text, "backup")
restore_job = job_block(text, "independent-restore-drill")
require(text.count("environment: gcp-production-backup") == 1
        and "environment: gcp-production-backup" in backup_job,
        "source backup must use only its protected Environment")
require(text.count("environment: gcp-production-restore-drill") == 1
        and "environment: gcp-production-restore-drill" in restore_job,
        "independent restore must use a separate protected Environment")
require("CLOUD_SQL_BACKUP_AGE_IDENTITY" not in backup_job,
        "the source backup job must never receive the private recovery identity")
require("CLOUD_SQL_BACKUP_AGE_RECIPIENT" in backup_job
        and "CLOUD_SQL_BACKUP_AGE_RECIPIENT" in restore_job
        and "CLOUD_SQL_BACKUP_AGE_IDENTITY" in restore_job,
        "age encryption/decryption secrets are not separated by job")
require("id-token: write" in backup_job and "id-token: write" not in restore_job
        and "google-github-actions/auth@" not in restore_job,
        "the restore environment must not receive WIF or Cloud SQL credentials")
for source_only_value in (
    "CLOUD_SQL_BACKUP_PROJECT_ID",
    "CLOUD_SQL_BACKUP_REGION",
    "CLOUD_SQL_BACKUP_INSTANCE",
    "CLOUD_SQL_BACKUP_DATABASE_USER",
    "CLOUD_SQL_BACKUP_WIF_PROVIDER",
    "CLOUD_SQL_BACKUP_SERVICE_ACCOUNT",
):
    require(source_only_value not in restore_job,
            f"restore job unexpectedly references source-only target value: {source_only_value}")
require(
    text.count("github.ref == format('refs/heads/{0}', github.event.repository.default_branch)") == 2,
    "both jobs must reject non-default branches",
)
require("id-token: write" in text, "backup job cannot use WIF")
require(
    "runs-on: [self-hosted, linux, x64, simsa-gcp-backup]" in text
    and text.count("runs-on: ubuntu-latest") == 1,
    "private backup and fresh independent restore runner boundaries are missing",
)
require("--private-ip" in text, "private-only Cloud SQL must use the proxy private-IP path")
require("PROXY_PORT=$((20000 + ((GITHUB_RUN_ID * 17 + GITHUB_RUN_ATTEMPT) % 10000)))" in backup_job
        and '--port "$PROXY_PORT"' in backup_job
        and 'PGPORT="$PROXY_PORT"' in backup_job,
        "source backup proxy is not isolated on its deterministic per-run port")
require("credentials_json:" not in text and "service_account_key" not in text.lower(), "static service-account key is referenced")
require("CLOUD_SQL_BACKUP_AGE_RECIPIENT" in text, "age recipient secret is missing")
require("CLOUD_SQL_BACKUP_AGE_IDENTITY" in text, "age identity secret is missing")
require("collect-backup-evidence.sql" in text, "canonical evidence collector is not used")
require(
    "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE;" in text
    and "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;" in text,
    "source or restore evidence is not captured in an explicit read-only transaction",
)
require("--format=custom" in text and "| age-bin" in text, "dump is not streamed directly into encryption")
require(
    '--env SOURCE_SNAPSHOT="$SOURCE_SNAPSHOT"' in text,
    "the exported snapshot is not explicitly passed to pg_dump",
)
require("actions/download-artifact@" in text and "pg_restore" in text, "independent restore drill is missing")
require(
    "0001_bootstrap_cloud_sql_roles.sql" in text
    and "0002_converge_application_grants.sql" in text
    and "pg_restore --exit-on-error --create" in text,
    "restore does not bootstrap the fixed owner role and converge versioned ACLs",
)
require(
    'pg_restore --create --list' in restore_job
    and 'prepare-restore-role-aliases.py" select-toc' in restore_job
    and 'prepare-restore-role-aliases.py" prepare' in restore_job
    and '--toc-input "$ROLE_METADATA_DIR/archive.toc.list"' in restore_job
    and '--use-list /metadata/database-properties.list --file=-' in restore_job
    and restore_job.count('exit "$metadata_status"') == 2
    and restore_job.count('cat > /dev/null') == 2,
    "restore metadata must include complete DATABASE PROPERTIES and fully drain authenticated decryption",
)
require(
    restore_job.index('prepare-restore-role-aliases.py" prepare')
    < restore_job.index('CREATE ROLE "simsa-api-runtime@simsa-restore-drill.iam" LOGIN;')
    < restore_job.index('--file /aliases/prepare-aliases.sql')
    < restore_job.index('pg_restore --exit-on-error --create')
    < restore_job.index('--file /aliases/cleanup-aliases.sql')
    < restore_job.index('--file /grants/0001_bootstrap_cloud_sql_roles.sql'),
    "inert source aliases must be validated before mutation and removed before restore-principal bootstrap",
)
restore_command = re.search(r"pg_restore --exit-on-error --create[^\n]*\n[^\n]*", restore_job)
require(restore_command is not None
        and '--no-owner --no-privileges --dbname postgres' in restore_command.group(0)
        and '--use-list' not in restore_command.group(0),
        "the actual restore must retain the complete archive including database properties")
evidence_text = (ROOT / ".github" / "scripts" / "collect-backup-evidence.sql").read_text(
    encoding="utf-8"
)
require(
    "database_role_acl" in evidence_text and "SECURITY DEFINER execution privilege is unsafe" in evidence_text,
    "source/restore evidence does not verify the fixed-role ACL policy",
)
require(
    "pg_catalog.to_jsonb(database_record)->>'datlocale'" in evidence_text
    and "pg_catalog.to_jsonb(database_record)->>'daticulocale'" in evidence_text
    and "database_record.datlocale" not in evidence_text
    and "database_record.daticulocale" not in evidence_text,
    "database locale evidence is not compatible with PostgreSQL 16, 17, and 18 catalogs",
)
require("retention-days: 14" in text, "artifact retention must remain short")
require("cloud-sql-proxy" in text and "CLOUD_SQL_PROXY_SHA256" in text, "pinned proxy verification is missing")
require("AGE_LINUX_AMD64_SHA256" in text, "pinned age verification is missing")
require(
    "database_user != service_account.removesuffix('.gserviceaccount.com')" in text,
    "WIF service account and Cloud SQL backup principal are not bound exactly",
)
for marker in (
    "WITH RECURSIVE role_state AS",
    "role_membership_closure(role_oid, role_name)",
    "direct_backup_membership",
    "backup_policy_membership",
    "membership_closure_state",
    "parent.rolname = 'simsa_backup_reader'",
    "parent.rolname = 'pg_read_all_data'",
    "NOT membership.set_option",
    "backup_role_membership_closure=exact",
):
    require(marker in text, f"exact backup role membership closure is missing: {marker}")
require(
    "SOURCE_IDENTITY_SHA256=$(printf '%s' \"$CONNECTION_NAME/$EXPECTED_DATABASE/$EXPECTED_DATABASE_USER\"" in backup_job
    and "source_identity_sha256: ${{ steps.create.outputs.source_identity_sha256 }}" in backup_job
    and 'echo "source_identity_sha256=$SOURCE_IDENTITY_SHA256" >> "$GITHUB_OUTPUT"' in backup_job,
    "backup evidence does not expose the canonical project:region:instance/database/user identity hash",
)
require(
    "SOURCE_IDENTITY_SHA256: ${{ needs.backup.outputs.source_identity_sha256 }}" in restore_job
    and 'grep --fixed-strings --line-regexp --quiet "source_identity_sha256=$SOURCE_IDENTITY_SHA256"' in restore_job,
    "independent restore does not verify the source target identity hash in the sealed manifest",
)
require(re.search(r"postgres:[0-9]+-alpine", text) is None,
        "Alpine restore images are forbidden because they may not reproduce Cloud SQL libc locales")

for action in re.findall(r"^\s*uses:\s*([^\s#]+)", text, flags=re.MULTILINE):
    require(
        re.fullmatch(r"[^@]+@[0-9a-f]{40}", action) is not None,
        f"action is not pinned to a full commit: {action}",
    )

retentions = [int(value) for value in re.findall(r"retention-days:\s*([0-9]+)", text)]
require(retentions and max(retentions) <= 14, "artifact retention exceeds 14 days")

for forbidden in (
    "npm run db:migrate",
    "npm run db:push",
    "npm run seed",
    "firebase deploy",
    "gcloud run deploy",
    "terraform apply",
):
    require(forbidden not in text.lower(), f"forbidden mutation command is present: {forbidden}")

# Already invoked by the required CI safety-gate step, so new helper regressions
# cannot be omitted merely because the cloud workflow is not dispatched locally.
for helper in (
    "check-postgres-workflow-images.py",
    "test-postgres-workflow-images.py",
    "test-prepare-restore-role-aliases.py",
):
    subprocess.run([sys.executable, str(ROOT / ".github/scripts" / helper)], cwd=ROOT, check=True)
print("backup-cloud-sql workflow static validation, image consistency, and helper self-tests passed")
