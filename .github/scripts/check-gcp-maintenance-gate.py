#!/usr/bin/env python3
"""Fail-closed GitHub run/artifact gate for GCP database workflows.

Only metadata returned by the GitHub REST API is trusted.  For maintenance
artifacts the caller may additionally provide the downloaded artifact
directory; every file is then checked against the embedded SHA-256 manifest
and the release-binding summary is validated.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.request
from urllib.parse import urlsplit
from pathlib import Path
from typing import Any


API_VERSION = "2026-03-10"
SHA_RE = re.compile(r"[0-9a-f]{40}")
DIGEST_RE = re.compile(r"sha256:[0-9a-f]{64}")
SHA256_RE = re.compile(r"[0-9a-f]{64}")
POSITIVE_ID_RE = re.compile(r"[1-9][0-9]*")
PROJECT_RE = re.compile(r"[a-z][a-z0-9-]{4,28}[a-z0-9]")
REGION_RE = re.compile(r"[a-z]+-[a-z0-9]+[0-9]")
INSTANCE_RE = re.compile(r"[a-z][a-z0-9-]{0,96}[a-z0-9]")
DATABASE_RE = re.compile(r"[a-z][a-z0-9_]{2,62}")
DATABASE_PRINCIPAL_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._@-]{2,62}")
BUCKET_RE = re.compile(r"[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]")
PROJECT_NUMBER_RE = re.compile(r"[1-9][0-9]+")
IMAGE_DIGEST_REF_RE = re.compile(
    r"(?:[a-z0-9.-]+(?::[0-9]+)?/)+[a-z0-9._/-]+@sha256:[0-9a-f]{64}"
)
SERVICE_ACCOUNT_RE = re.compile(
    r"[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9][.]iam[.]gserviceaccount[.]com"
)
BACKUP_WORKFLOW = ".github/workflows/backup-cloud-sql.yml"
MAINTENANCE_WORKFLOW = ".github/workflows/database-maintenance-gcp.yml"
PREVIEW_BOOTSTRAP_WORKFLOW = ".github/workflows/database-bootstrap-gcp-preview.yml"
LATEST_MIGRATION = 1788060600000
EXPECTED_MIGRATION_COUNT = 34
EXPECTED_OPERATIONS = [
    "db:roles:bootstrap-initial",
    "db:migrate",
    "db:roles:bootstrap-final",
    "db:grants:converge",
    "seed:all",
]


class GateFailure(RuntimeError):
    """The referenced run or artifact does not satisfy the release policy."""


class GitHubApi:
    def __init__(self, token: str, api_url: str = "https://api.github.com") -> None:
        if not token:
            raise GateFailure("GITHUB_TOKEN is required")
        self._token = token
        self._api_url = api_url.rstrip("/")

    def get(self, path: str) -> Any:
        request = urllib.request.Request(
            f"{self._api_url}{path}",
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {self._token}",
                "X-GitHub-Api-Version": API_VERSION,
                "User-Agent": "simsa-gcp-maintenance-gate",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:500]
            raise GateFailure(
                f"GitHub API GET {path} failed with HTTP {error.code}: {detail}"
            ) from error
        except (urllib.error.URLError, TimeoutError) as error:
            raise GateFailure(f"GitHub API GET {path} failed: {error}") from error

    def paginated(self, path: str, key: str) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        page = 1
        while True:
            separator = "&" if "?" in path else "?"
            payload = self.get(f"{path}{separator}per_page=100&page={page}")
            batch = payload.get(key) if isinstance(payload, dict) else None
            if not isinstance(batch, list):
                raise GateFailure(f"Unexpected paginated response for {path}")
            results.extend(value for value in batch if isinstance(value, dict))
            if len(batch) < 100:
                return results
            page += 1


def _require_identifier(value: str | None, pattern: re.Pattern[str], label: str) -> str:
    normalized = (value or "").strip().lower()
    if pattern.fullmatch(normalized) is None:
        raise GateFailure(f"{label} is invalid")
    return normalized


def _validate_database_target(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        raise GateFailure("maintenance database target binding is missing")
    expected_keys = {
        "project_id",
        "region",
        "instance",
        "connection_name",
        "database",
        "cloud_sql_proxy_image",
        "eventarc_invoker_service_account",
        "runtime_identities",
        "api_principal",
        "event_principal",
        "worker_principal",
        "final_cleanup_principal",
        "backup_principal",
        "source_identity_sha256",
    }
    if set(value) != expected_keys:
        raise GateFailure("maintenance database target binding is incomplete or unexpected")
    target = {key: str(value.get(key) or "") for key in expected_keys if key != "runtime_identities"}
    runtime_identities = value.get("runtime_identities")
    patterns = {
        "project_id": PROJECT_RE,
        "region": REGION_RE,
        "instance": INSTANCE_RE,
        "database": DATABASE_RE,
        "cloud_sql_proxy_image": IMAGE_DIGEST_REF_RE,
        "eventarc_invoker_service_account": SERVICE_ACCOUNT_RE,
        "api_principal": DATABASE_PRINCIPAL_RE,
        "event_principal": DATABASE_PRINCIPAL_RE,
        "worker_principal": DATABASE_PRINCIPAL_RE,
        "final_cleanup_principal": DATABASE_PRINCIPAL_RE,
        "backup_principal": DATABASE_PRINCIPAL_RE,
        "source_identity_sha256": SHA256_RE,
    }
    for key, pattern in patterns.items():
        if pattern.fullmatch(target[key]) is None:
            raise GateFailure(f"maintenance database target value is invalid: {key}")
    expected_connection = (
        f"{target['project_id']}:{target['region']}:{target['instance']}"
    )
    expected_invoker = f"simsa-eventarc-invoker@{target['project_id']}.iam.gserviceaccount.com"
    if target["eventarc_invoker_service_account"] != expected_invoker:
        raise GateFailure("maintenance Eventarc invoker is not the canonical project identity")
    if target["connection_name"] != expected_connection:
        raise GateFailure("maintenance Cloud SQL connection name is inconsistent")
    principal_suffix = f"@{target['project_id']}.iam"
    principal_keys = (
        "api_principal",
        "event_principal",
        "worker_principal",
        "final_cleanup_principal",
        "backup_principal",
    )
    for key in principal_keys:
        if not target[key].endswith(principal_suffix):
            raise GateFailure(f"maintenance database principal belongs to another project: {key}")
    if len({target[key] for key in principal_keys}) != len(principal_keys):
        raise GateFailure("maintenance database runtime and backup principals must be distinct")
    _validate_runtime_identities(runtime_identities, target)
    canonical_source = (
        f"{target['connection_name']}/{target['database']}/{target['backup_principal']}"
    )
    canonical_hash = hashlib.sha256(canonical_source.encode("utf-8")).hexdigest()
    if target["source_identity_sha256"] != canonical_hash:
        raise GateFailure("maintenance database target identity hash is inconsistent")
    return target


def _validate_preview_database_target(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        raise GateFailure("Preview database target binding is missing")
    principal_keys = (
        "grant_admin_principal",
        "api_principal",
        "event_principal",
        "worker_principal",
        "final_cleanup_principal",
        "migrator_principal",
        "maintenance_principal",
        "backup_principal",
    )
    expected_keys = {
        "project_id",
        "region",
        "instance",
        "connection_name",
        "database",
        "cloud_sql_proxy_image",
        "eventarc_invoker_service_account",
        "runtime_identities",
        *principal_keys,
    }
    if set(value) != expected_keys:
        raise GateFailure("Preview database target binding is incomplete or unexpected")
    target = {key: str(value.get(key) or "") for key in expected_keys if key != "runtime_identities"}
    runtime_identities = value.get("runtime_identities")
    for key, pattern in (
        ("project_id", PROJECT_RE),
        ("region", REGION_RE),
        ("instance", INSTANCE_RE),
        ("database", DATABASE_RE),
        ("cloud_sql_proxy_image", IMAGE_DIGEST_REF_RE),
        ("eventarc_invoker_service_account", SERVICE_ACCOUNT_RE),
    ):
        if pattern.fullmatch(target[key]) is None:
            raise GateFailure(f"Preview database target value is invalid: {key}")
    expected_connection = f"{target['project_id']}:{target['region']}:{target['instance']}"
    if target["connection_name"] != expected_connection:
        raise GateFailure("Preview Cloud SQL connection name is inconsistent")
    expected_invoker = f"simsa-eventarc-invoker@{target['project_id']}.iam.gserviceaccount.com"
    if target["eventarc_invoker_service_account"] != expected_invoker:
        raise GateFailure("Preview Eventarc invoker is not the canonical project identity")
    suffix = f"@{target['project_id']}.iam"
    for key in principal_keys:
        if DATABASE_PRINCIPAL_RE.fullmatch(target[key]) is None or not target[key].endswith(suffix):
            raise GateFailure(f"Preview database principal is invalid or belongs to another project: {key}")
    if len({target[key] for key in principal_keys}) != len(principal_keys):
        raise GateFailure("Preview database principals must all be distinct")
    _validate_runtime_identities(runtime_identities, target)
    return target


def _validate_runtime_identities(value: Any, target: dict[str, str]) -> None:
    if not isinstance(value, dict) or set(value) != {
        "api", "events", "worker", "final_cleanup", "binding_sha256"
    }:
        raise GateFailure("database runtime identity binding is missing or unexpected")
    canonical: list[str] = [target["project_id"]]
    mappings = (
        ("api", "api_principal"),
        ("events", "event_principal"),
        ("worker", "worker_principal"),
        ("final_cleanup", "final_cleanup_principal"),
    )
    for runtime_name, principal_key in mappings:
        identity = value.get(runtime_name)
        if not isinstance(identity, dict) or set(identity) != {"service_account", "database_principal"}:
            raise GateFailure(f"database runtime identity is incomplete: {runtime_name}")
        principal = str(identity.get("database_principal") or "")
        service_account = str(identity.get("service_account") or "")
        if principal != target[principal_key] or service_account != f"{principal}.gserviceaccount.com":
            raise GateFailure(f"database runtime service account/principal mismatch: {runtime_name}")
        canonical.extend((service_account, principal))
    expected_hash = hashlib.sha256("/".join(canonical).encode("utf-8")).hexdigest()
    if value.get("binding_sha256") != expected_hash:
        raise GateFailure("database runtime identity binding hash is inconsistent")


def _validate_storage_target(
    value: Any,
    *,
    database_target: dict[str, str],
    environment: str,
) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {
        "project_id", "project_number", "region", "upload", "final"
    }:
        raise GateFailure("storage target binding is missing or unexpected")
    project_id = str(value.get("project_id") or "")
    project_number = str(value.get("project_number") or "")
    region = str(value.get("region") or "")
    if project_id != database_target["project_id"] or region != database_target["region"]:
        raise GateFailure("storage project/region does not match the sealed database target")
    if PROJECT_NUMBER_RE.fullmatch(project_number) is None:
        raise GateFailure("storage project number is invalid")
    normalized: dict[str, Any] = {
        "project_id": project_id,
        "project_number": project_number,
        "region": region,
    }
    names: set[str] = set()
    for kind, purpose in (("upload", "quarantine"), ("final", "final")):
        bucket = value.get(kind)
        if not isinstance(bucket, dict) or set(bucket) != {
            "name", "location", "project_number", "uniform_bucket_level_access",
            "public_access_prevention", "labels",
        }:
            raise GateFailure(f"{kind} bucket metadata is incomplete or unexpected")
        name = str(bucket.get("name") or "")
        labels = bucket.get("labels")
        expected_labels = {
            "application": "simsa",
            "environment": environment,
            "managed_by": "terraform",
            "purpose": purpose,
        }
        if BUCKET_RE.fullmatch(name) is None or name in names:
            raise GateFailure("storage bucket names are invalid or not separated")
        names.add(name)
        if bucket.get("location") != region or str(bucket.get("project_number")) != project_number:
            raise GateFailure(f"{kind} bucket project/location does not match target")
        if bucket.get("uniform_bucket_level_access") is not True or bucket.get("public_access_prevention") != "enforced":
            raise GateFailure(f"{kind} bucket is not private with uniform access")
        if labels != expected_labels:
            raise GateFailure(f"{kind} bucket labels/purpose do not match target")
        normalized[kind] = bucket
    return normalized


def _validate_runtime_security(value: Any, project_id: str) -> dict[str, str]:
    expected_keys = {
        "node_env", "app_profile", "simsa_cloud_platform", "auth_provider",
        "object_storage_provider", "firebase_project_id",
        "firebase_session_max_age_hours", "firebase_check_revoked",
        "firebase_app_check_required", "firebase_app_check_app_ids",
        "frontend_url", "additional_trusted_origins", "db_host", "db_port",
        "db_password", "db_ssl",
    }
    if not isinstance(value, dict) or set(value) != expected_keys:
        raise GateFailure("runtime security binding is missing or unexpected")
    normalized = {key: str(value.get(key) if value.get(key) is not None else "") for key in expected_keys}
    fixed = {
        "node_env": "production", "app_profile": "internal", "simsa_cloud_platform": "gcp",
        "auth_provider": "firebase", "object_storage_provider": "gcs",
        "firebase_project_id": project_id, "firebase_session_max_age_hours": "24",
        "firebase_check_revoked": "true", "firebase_app_check_required": "true",
        "db_host": "127.0.0.1", "db_port": "5432", "db_password": "", "db_ssl": "false",
    }
    if any(normalized[key] != expected for key, expected in fixed.items()):
        raise GateFailure("runtime security constants do not match the reviewed Terraform contract")
    app_ids = normalized["firebase_app_check_app_ids"].split(",")
    if (not app_ids or app_ids != sorted(set(app_ids)) or any(
        re.fullmatch(r"1:[0-9]{6,}:web:[0-9a-f]{8,}", item) is None for item in app_ids
    )):
        raise GateFailure("runtime App Check app IDs are not canonical")
    def canonical_origin(origin: str) -> bool:
        parsed = urlsplit(origin)
        return bool(parsed.scheme == "https" and parsed.netloc and not parsed.username and
                    not parsed.password and parsed.path == "" and not parsed.query and
                    not parsed.fragment and origin == f"https://{parsed.netloc}")
    if not canonical_origin(normalized["frontend_url"]):
        raise GateFailure("runtime frontend URL is not a canonical HTTPS origin")
    origins_text = normalized["additional_trusted_origins"]
    origins = origins_text.split(",") if origins_text else []
    if (len(origins) > 20 or origins != sorted(set(origins)) or
            normalized["frontend_url"] in origins or any(not canonical_origin(item) for item in origins)):
        raise GateFailure("runtime additional trusted origins are not canonical")
    return normalized


def evaluate_metadata(
    *,
    kind: str,
    repository: str,
    environment: str,
    commit_sha: str,
    run_id: int,
    artifact_id: int,
    artifact_digest: str,
    run: dict[str, Any],
    jobs: list[dict[str, Any]],
    artifacts: list[dict[str, Any]],
) -> dict[str, Any]:
    policies = {
        "backup": ("production", BACKUP_WORKFLOW, {
            "WIF, read-only dump, and age encryption",
            "Fresh-runner download and independent restore",
        }),
        "maintenance": ("production", MAINTENANCE_WORKFLOW, {
            "Controlled bootstrap, migrate, grants, and seed",
        }),
        "preview-bootstrap": ("preview", PREVIEW_BOOTSTRAP_WORKFLOW, {
            "Bootstrap and converge isolated Preview database",
        }),
    }
    if kind not in policies:
        raise GateFailure("unsupported database evidence kind")
    expected_environment, expected_workflow, required_jobs = policies[kind]
    if environment != expected_environment:
        raise GateFailure(f"{kind} evidence must use environment {expected_environment}")
    if str(run.get("path") or "") != expected_workflow:
        raise GateFailure(f"run {run_id} did not execute {expected_workflow}")
    if str(run.get("event") or "") != "workflow_dispatch":
        raise GateFailure("only an explicitly dispatched run is accepted")
    if str(run.get("status") or "") != "completed" or str(run.get("conclusion") or "") != "success":
        raise GateFailure("referenced workflow run is not completed successfully")
    if str(run.get("head_sha") or "").lower() != commit_sha:
        raise GateFailure("workflow run head SHA does not equal the requested release commit")
    head_repository = str((run.get("head_repository") or {}).get("full_name") or "")
    if head_repository.casefold() != repository.casefold():
        raise GateFailure("workflow run source repository is missing or is a fork")

    names_to_conclusions = {
        str(job.get("name") or ""): str(job.get("conclusion") or "") for job in jobs
    }
    missing_or_failed = sorted(
        name for name in required_jobs if names_to_conclusions.get(name) != "success"
    )
    if missing_or_failed:
        raise GateFailure("required jobs are missing or failed: " + ", ".join(missing_or_failed))

    matches = [artifact for artifact in artifacts if int(artifact.get("id") or 0) == artifact_id]
    if len(matches) != 1:
        raise GateFailure("exactly one artifact with the requested ID must belong to the run")
    artifact = matches[0]
    if artifact.get("expired") is True:
        raise GateFailure("referenced evidence artifact is expired")
    if str(artifact.get("digest") or "").lower() != artifact_digest:
        raise GateFailure("artifact digest returned by GitHub does not match the requested digest")
    artifact_name = str(artifact.get("name") or "")
    if kind == "backup":
        if re.fullmatch(rf"cloud-sql-backup-{run_id}-[1-9][0-9]*", artifact_name) is None:
            raise GateFailure("backup artifact name is not bound to the referenced run")
    elif kind == "maintenance":
        run_attempt = int(run.get("run_attempt") or 0)
        expected_name = (
            f"gcp-database-maintenance-production-{commit_sha}-{run_id}-{run_attempt}-evidence"
        )
        if artifact_name != expected_name:
            raise GateFailure("maintenance artifact name is not bound to environment, commit, and run")
    else:
        run_attempt = int(run.get("run_attempt") or 0)
        expected_name = f"gcp-preview-database-{commit_sha}-{run_id}-{run_attempt}-evidence"
        if artifact_name != expected_name:
            raise GateFailure("Preview bootstrap artifact name is not bound to commit and run")

    return {
        "gate": "passed",
        "kind": kind,
        "repository": repository,
        "environment": environment,
        "commit_sha": commit_sha,
        "workflow_run_id": run_id,
        "workflow_run_attempt": int(run.get("run_attempt") or 0),
        "workflow_path": expected_workflow,
        "artifact_id": artifact_id,
        "artifact_name": artifact_name,
        "artifact_digest": artifact_digest,
        "required_jobs": sorted(required_jobs),
    }


def _parse_manifest(path: Path) -> dict[str, str]:
    entries: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._/-]*)", raw_line)
        if match is None:
            raise GateFailure("maintenance evidence manifest contains an unsafe or invalid entry")
        digest, relative_name = match.groups()
        if relative_name in entries or relative_name == path.name or relative_name.startswith("/"):
            raise GateFailure("maintenance evidence manifest contains a duplicate or recursive entry")
        entries[relative_name] = digest
    if not entries:
        raise GateFailure("maintenance evidence manifest is empty")
    return entries


def validate_maintenance_evidence(
    evidence_dir: Path,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    root = evidence_dir.resolve()
    manifest_path = root / "evidence-manifest.sha256"
    summary_path = root / "maintenance-summary.json"
    if not manifest_path.is_file() or not summary_path.is_file():
        raise GateFailure("maintenance artifact is missing its manifest or summary")
    entries = _parse_manifest(manifest_path)
    actual_files = {
        str(path.relative_to(root)).replace("\\", "/")
        for path in root.rglob("*")
        if path.is_file() and path != manifest_path
    }
    if actual_files != set(entries):
        raise GateFailure("maintenance artifact files do not exactly match the evidence manifest")
    for relative_name, expected_digest in entries.items():
        candidate = (root / relative_name).resolve()
        if root not in candidate.parents or not candidate.is_file():
            raise GateFailure("maintenance evidence entry escapes the artifact directory")
        actual_digest = hashlib.sha256(candidate.read_bytes()).hexdigest()
        if actual_digest != expected_digest:
            raise GateFailure(f"maintenance evidence hash mismatch: {relative_name}")

    try:
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise GateFailure("maintenance summary is not valid JSON") from error
    expected_bindings = {
        "gate_version": "simsa-gcp-database-maintenance/v1",
        "repository": metadata["repository"],
        "environment": metadata["environment"],
        "commit_sha": metadata["commit_sha"],
        "workflow_run_id": metadata["workflow_run_id"],
        "workflow_run_attempt": metadata["workflow_run_attempt"],
    }
    for key, expected in expected_bindings.items():
        if summary.get(key) != expected:
            raise GateFailure(f"maintenance summary binding mismatch: {key}")
    image_digest = str(summary.get("maintenance_image_digest") or "")
    if DIGEST_RE.fullmatch(image_digest) is None:
        raise GateFailure("maintenance image content digest is missing")
    reviewed_source = summary.get("reviewed_source") or {}
    if reviewed_source.get("revision") != metadata["commit_sha"]:
        raise GateFailure("maintenance image revision is not the reviewed commit")
    repository_url = str(reviewed_source.get("repository_url") or "")
    if not repository_url.startswith("https://") or not repository_url.endswith(
        "/" + metadata["repository"]
    ):
        raise GateFailure("maintenance source repository URL is not the reviewed repository")
    if reviewed_source.get("production_merge_review_and_checks") != "passed":
        raise GateFailure("maintenance source does not prove final review and required checks")
    for key in ("dockerfile_sha256", "package_lock_sha256"):
        if re.fullmatch(r"[0-9a-f]{64}", str(reviewed_source.get(key) or "")) is None:
            raise GateFailure(f"reviewed source hash is invalid: {key}")
    journal = summary.get("database_journal") or {}
    if journal.get("count") != EXPECTED_MIGRATION_COUNT or journal.get("latest_created_at") != LATEST_MIGRATION:
        raise GateFailure("maintenance journal is not complete through migration 0033")
    if summary.get("migration_manifest_verified") is not True or re.fullmatch(
        r"[0-9a-f]{64}", str(summary.get("migration_manifest_sha256") or "")
    ) is None:
        raise GateFailure("reviewed migration manifest is not proven against the database journal")
    if summary.get("grant_convergence") != "passed":
        raise GateFailure("versioned grant convergence is not proven")
    if summary.get("ownership_violations") != 0:
        raise GateFailure("application object ownership did not converge exactly")
    if summary.get("migrator_database_create") is not False:
        raise GateFailure("migrator still has effective database CREATE")
    if summary.get("principal_memberships_verified") is not True:
        raise GateFailure("database login-to-policy-role memberships are not proven")
    if summary.get("ordered_operations") != EXPECTED_OPERATIONS:
        raise GateFailure("maintenance operations are missing, reordered, or unexpected")
    seed = summary.get("seed") or {}
    if seed.get("verified") is not True:
        raise GateFailure("seed convergence evidence is missing")
    acl = str(summary.get("acl_fingerprint_md5") or "")
    if re.fullmatch(r"[0-9a-f]{32}", acl) is None:
        raise GateFailure("ACL evidence fingerprint is invalid")
    backup = summary.get("backup") or {}
    if not isinstance(backup.get("workflow_run_id"), int) or isinstance(backup.get("workflow_run_id"), bool) or backup["workflow_run_id"] < 1:
        raise GateFailure("backup workflow run ID is invalid")
    if not isinstance(backup.get("artifact_id"), int) or isinstance(backup.get("artifact_id"), bool) or backup["artifact_id"] < 1:
        raise GateFailure("backup artifact ID is invalid")
    if DIGEST_RE.fullmatch(str(backup.get("artifact_digest") or "")) is None:
        raise GateFailure("backup artifact digest is invalid")
    if backup.get("independent_restore") != "passed":
        raise GateFailure("backup evidence does not prove the independent restore drill")
    database_target = _validate_database_target(summary.get("database_target"))
    _validate_storage_target(
        summary.get("storage_target"),
        database_target=database_target,
        environment="production",
    )
    _validate_runtime_security(summary.get("runtime_security"), database_target["project_id"])
    source_identity_sha256 = database_target["source_identity_sha256"]
    if backup.get("source_identity_sha256") != source_identity_sha256:
        raise GateFailure("maintenance backup is bound to another database target")
    backup_gate_path = root / "backup-gate.json"
    try:
        backup_gate = json.loads(backup_gate_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise GateFailure("downloaded backup gate evidence is missing or invalid") from error
    expected_backup_gate = {
        "workflow_run_id": backup["workflow_run_id"],
        "artifact_id": backup["artifact_id"],
        "artifact_digest": backup["artifact_digest"],
        "commit_sha": metadata["commit_sha"],
        "kind": "backup",
        "expected_source_identity_sha256": source_identity_sha256,
        "downloaded_evidence": "content_manifest_verified",
    }
    for key, expected in expected_backup_gate.items():
        if backup_gate.get(key) != expected:
            raise GateFailure(f"backup API/content gate binding mismatch: {key}")
    backup_manifest = backup_gate.get("backup_manifest") or {}
    if backup_manifest.get("backup_role_membership_closure") != "exact":
        raise GateFailure("downloaded backup did not prove the exact read-only role closure")
    if backup_manifest.get("source_identity_sha256") != source_identity_sha256:
        raise GateFailure("downloaded backup manifest is bound to another database target")
    image_path = root / "maintenance-image.json"
    try:
        image_evidence = json.loads(image_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise GateFailure("maintenance image evidence is missing or invalid") from error
    if image_evidence != {
        "maintenance_image_digest": image_digest,
        "revision": metadata["commit_sha"],
        "source": repository_url,
    }:
        raise GateFailure("maintenance image labels/digest do not match the reviewed source summary")
    return summary


def validate_preview_bootstrap_evidence(
    evidence_dir: Path,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    root = evidence_dir.resolve()
    manifest_path = root / "evidence-manifest.sha256"
    summary_path = root / "preview-database-summary.json"
    if not manifest_path.is_file() or not summary_path.is_file():
        raise GateFailure("Preview bootstrap artifact is missing its manifest or summary")
    entries = _parse_manifest(manifest_path)
    actual_files = {
        str(path.relative_to(root)).replace("\\", "/")
        for path in root.rglob("*")
        if path.is_file() and path != manifest_path
    }
    if actual_files != set(entries):
        raise GateFailure("Preview bootstrap files do not exactly match the evidence manifest")
    for relative_name, expected_digest in entries.items():
        candidate = (root / relative_name).resolve()
        if root not in candidate.parents or not candidate.is_file():
            raise GateFailure("Preview bootstrap evidence entry escapes the artifact directory")
        if hashlib.sha256(candidate.read_bytes()).hexdigest() != expected_digest:
            raise GateFailure(f"Preview bootstrap evidence hash mismatch: {relative_name}")

    try:
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise GateFailure("Preview database summary is not valid JSON") from error
    expected_bindings = {
        "gate_version": "simsa-gcp-preview-database/v1",
        "repository": metadata["repository"],
        "environment": "preview",
        "commit_sha": metadata["commit_sha"],
        "workflow_run_id": metadata["workflow_run_id"],
        "workflow_run_attempt": metadata["workflow_run_attempt"],
    }
    for key, expected in expected_bindings.items():
        if summary.get(key) != expected:
            raise GateFailure(f"Preview summary binding mismatch: {key}")
    image_digest = str(summary.get("maintenance_image_digest") or "")
    if DIGEST_RE.fullmatch(image_digest) is None:
        raise GateFailure("Preview maintenance image content digest is missing")
    reviewed = summary.get("reviewed_source") or {}
    if reviewed.get("revision") != metadata["commit_sha"]:
        raise GateFailure("Preview image revision is not the reviewed commit")
    repository_url = str(reviewed.get("repository_url") or "")
    if not repository_url.startswith("https://") or not repository_url.endswith(
        "/" + metadata["repository"]
    ):
        raise GateFailure("Preview source repository URL is not the reviewed repository")
    if reviewed.get("merge_review_and_required_checks") != "passed":
        raise GateFailure("Preview source does not prove merge review and required checks")
    for key in ("dockerfile_sha256", "package_lock_sha256"):
        if SHA256_RE.fullmatch(str(reviewed.get(key) or "")) is None:
            raise GateFailure(f"Preview reviewed source hash is invalid: {key}")

    database_target = _validate_preview_database_target(summary.get("database_target"))
    _validate_storage_target(
        summary.get("storage_target"),
        database_target=database_target,
        environment="preview",
    )
    _validate_runtime_security(summary.get("runtime_security"), database_target["project_id"])
    isolation = summary.get("isolation") or {}
    expected_isolation = {
        "project": database_target["project_id"],
        "instance": database_target["instance"],
        "region": database_target["region"],
        "application_label": "simsa",
        "environment_label": "preview",
        "managed_by_label": "terraform",
        "public_ipv4": False,
    }
    if isolation != expected_isolation:
        raise GateFailure("Preview isolation evidence does not match the sealed database target")
    journal = summary.get("database_journal") or {}
    if journal.get("count") != EXPECTED_MIGRATION_COUNT or journal.get("latest_created_at") != LATEST_MIGRATION:
        raise GateFailure("Preview journal is not complete through migration 0033")
    if summary.get("migration_manifest_verified") is not True or SHA256_RE.fullmatch(
        str(summary.get("migration_manifest_sha256") or "")
    ) is None:
        raise GateFailure("Preview migration manifest is not proven")
    if summary.get("grant_convergence") != "passed" or summary.get("ownership_violations") != 0:
        raise GateFailure("Preview ownership/grant convergence is not proven")
    if summary.get("migrator_database_create") is not False:
        raise GateFailure("Preview migrator still has effective database CREATE")
    if summary.get("principal_memberships_verified") is not True:
        raise GateFailure("Preview principal memberships are not proven")
    if summary.get("ordered_operations") != EXPECTED_OPERATIONS:
        raise GateFailure("Preview operations are missing, reordered, or unexpected")
    if (summary.get("seed") or {}).get("verified") is not True:
        raise GateFailure("Preview seed convergence evidence is missing")
    if re.fullmatch(r"[0-9a-f]{32}", str(summary.get("acl_fingerprint_md5") or "")) is None:
        raise GateFailure("Preview ACL fingerprint is invalid")

    image_path = root / "maintenance-image.json"
    try:
        image_evidence = json.loads(image_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise GateFailure("Preview maintenance image evidence is missing or invalid") from error
    if image_evidence != {
        "maintenance_image_digest": image_digest,
        "revision": metadata["commit_sha"],
        "source": repository_url,
    }:
        raise GateFailure("Preview maintenance image labels/digest do not match reviewed source")
    return summary


def validate_backup_evidence(
    evidence_dir: Path,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    root = evidence_dir.resolve()
    files = [path for path in root.iterdir() if path.is_file()]
    if len(files) != 3 or any(path.is_symlink() for path in files):
        raise GateFailure("downloaded backup artifact must contain exactly three regular files")
    manifests = [path for path in files if path.name.endswith(".manifest.txt")]
    if len(manifests) != 1:
        raise GateFailure("downloaded backup artifact has no unambiguous plaintext manifest")
    manifest = manifests[0]
    values: dict[str, str] = {}
    for line in manifest.read_text(encoding="utf-8").splitlines():
        if "=" not in line:
            raise GateFailure("backup manifest contains an invalid line")
        key, value = line.split("=", 1)
        if key in values or re.fullmatch(r"[a-z][a-z0-9_]*", key) is None:
            raise GateFailure("backup manifest contains a duplicate or unsafe key")
        values[key] = value
    expected_keys = {
        "format",
        "schema_profile",
        "source_identity_sha256",
        "backup_role_membership_closure",
        "archive_name",
        "archive_sha256",
        "evidence_name",
        "evidence_sha256",
        "repository_commit",
        "workflow_run",
    }
    if set(values) != expected_keys:
        raise GateFailure("backup manifest key set is incomplete or unexpected")
    if values["format"] != "simsa-cloud-sql-age-v1":
        raise GateFailure("backup manifest format is unsupported")
    if values["backup_role_membership_closure"] != "exact":
        raise GateFailure("backup role membership closure is not exact")
    if values["schema_profile"] != "pre_migration":
        raise GateFailure("maintenance requires a verified pre_migration backup")
    if values["repository_commit"].lower() != metadata["commit_sha"]:
        raise GateFailure("backup manifest commit is not the maintenance commit")
    expected_workflow = f"{metadata['workflow_run_id']}/{metadata['workflow_run_attempt']}"
    if values["workflow_run"] != expected_workflow:
        raise GateFailure("backup manifest workflow run/attempt binding is invalid")
    expected_source_identity_sha256 = str(
        metadata.get("expected_source_identity_sha256") or ""
    )
    if SHA256_RE.fullmatch(expected_source_identity_sha256) is None:
        raise GateFailure("expected Production database target identity hash is missing or invalid")
    if SHA256_RE.fullmatch(values["source_identity_sha256"]) is None:
        raise GateFailure("backup source identity hash is invalid")
    if values["source_identity_sha256"] != expected_source_identity_sha256:
        raise GateFailure("backup source identity does not match the Production maintenance target")
    archive_name = values["archive_name"]
    encrypted_evidence_name = values["evidence_name"]
    safe_name = re.compile(r"simsa-cloud-sql-[0-9]{4}-[0-9]{2}-[0-9]{2}-[1-9][0-9]*-[1-9][0-9]*[.](?:dump|evidence)[.]age")
    if safe_name.fullmatch(archive_name) is None or not archive_name.endswith(".dump.age"):
        raise GateFailure("backup archive name is invalid")
    if safe_name.fullmatch(encrypted_evidence_name) is None or not encrypted_evidence_name.endswith(".evidence.age"):
        raise GateFailure("encrypted source-evidence name is invalid")
    expected_stem = f"-{metadata['workflow_run_id']}-{metadata['workflow_run_attempt']}"
    if expected_stem not in archive_name or expected_stem not in encrypted_evidence_name:
        raise GateFailure("backup file names are not bound to the workflow run/attempt")
    if {path.name for path in files} != {archive_name, encrypted_evidence_name, manifest.name}:
        raise GateFailure("backup manifest names do not exactly describe the downloaded files")
    for name, digest_key in (
        (archive_name, "archive_sha256"),
        (encrypted_evidence_name, "evidence_sha256"),
    ):
        expected_digest = values[digest_key]
        if re.fullmatch(r"[0-9a-f]{64}", expected_digest) is None:
            raise GateFailure(f"invalid encrypted file hash: {digest_key}")
        if hashlib.sha256((root / name).read_bytes()).hexdigest() != expected_digest:
            raise GateFailure(f"downloaded encrypted file hash mismatch: {name}")
    return values


def run_self_test() -> None:
    sha = "a" * 40
    digest = "sha256:" + "b" * 64
    base_run = {
        "path": BACKUP_WORKFLOW,
        "event": "workflow_dispatch",
        "status": "completed",
        "conclusion": "success",
        "head_sha": sha,
        "head_repository": {"full_name": "example/simsa"},
        "run_attempt": 1,
    }
    evidence = evaluate_metadata(
        kind="backup",
        repository="example/simsa",
        environment="production",
        commit_sha=sha,
        run_id=123,
        artifact_id=456,
        artifact_digest=digest,
        run=base_run,
        jobs=[
            {"name": "WIF, read-only dump, and age encryption", "conclusion": "success"},
            {"name": "Fresh-runner download and independent restore", "conclusion": "success"},
        ],
        artifacts=[{"id": 456, "name": "cloud-sql-backup-123-1", "digest": digest, "expired": False}],
    )
    source_identity_sha256 = hashlib.sha256(
        b"simsa-prod:asia-southeast2:simsa-prod/simsa/simsa-db-backup@simsa-prod.iam"
    ).hexdigest()
    evidence["expected_source_identity_sha256"] = source_identity_sha256
    assert evidence["gate"] == "passed"
    for mutation, message in (
        ({"head_sha": "c" * 40}, "wrong commit was accepted"),
        ({"conclusion": "failure"}, "failed run was accepted"),
        ({"event": "schedule"}, "scheduled backup was accepted"),
    ):
        broken = dict(base_run)
        broken.update(mutation)
        try:
            evaluate_metadata(
                kind="backup",
                repository="example/simsa",
                environment="production",
                commit_sha=sha,
                run_id=123,
                artifact_id=456,
                artifact_digest=digest,
                run=broken,
                jobs=[
                    {"name": "WIF, read-only dump, and age encryption", "conclusion": "success"},
                    {"name": "Fresh-runner download and independent restore", "conclusion": "success"},
                ],
                artifacts=[{"id": 456, "name": "cloud-sql-backup-123-1", "digest": digest}],
            )
        except GateFailure:
            pass
        else:
            raise AssertionError(message)

    preview_metadata = evaluate_metadata(
        kind="preview-bootstrap",
        repository="example/simsa",
        environment="preview",
        commit_sha=sha,
        run_id=321,
        artifact_id=654,
        artifact_digest=digest,
        run={**base_run, "path": PREVIEW_BOOTSTRAP_WORKFLOW, "run_attempt": 3},
        jobs=[{
            "name": "Bootstrap and converge isolated Preview database",
            "conclusion": "success",
        }],
        artifacts=[{
            "id": 654,
            "name": f"gcp-preview-database-{sha}-321-3-evidence",
            "digest": digest,
            "expired": False,
        }],
    )
    assert preview_metadata["workflow_path"] == PREVIEW_BOOTSTRAP_WORKFLOW
    preview_target = {
        "project_id": "simsa-preview",
        "region": "asia-southeast2",
        "instance": "simsa-preview",
        "connection_name": "simsa-preview:asia-southeast2:simsa-preview",
        "database": "simsa_preview",
        "cloud_sql_proxy_image": "gcr.io/cloud-sql-connectors/cloud-sql-proxy@sha256:" + "c" * 64,
        "eventarc_invoker_service_account": "simsa-eventarc-invoker@simsa-preview.iam.gserviceaccount.com",
        "grant_admin_principal": "simsa-grant-admin@simsa-preview.iam",
        "api_principal": "simsa-api@simsa-preview.iam",
        "event_principal": "simsa-events@simsa-preview.iam",
        "worker_principal": "simsa-worker@simsa-preview.iam",
        "final_cleanup_principal": "simsa-final-cleanup@simsa-preview.iam",
        "migrator_principal": "simsa-migrator@simsa-preview.iam",
        "maintenance_principal": "simsa-maintenance@simsa-preview.iam",
        "backup_principal": "simsa-backup@simsa-preview.iam",
    }
    preview_runtime_parts = ["simsa-preview"]
    preview_runtime_identities: dict[str, Any] = {}
    for runtime_name, principal_key in (
        ("api", "api_principal"),
        ("events", "event_principal"),
        ("worker", "worker_principal"),
        ("final_cleanup", "final_cleanup_principal"),
    ):
        principal = preview_target[principal_key]
        service_account = f"{principal}.gserviceaccount.com"
        preview_runtime_identities[runtime_name] = {
            "service_account": service_account,
            "database_principal": principal,
        }
        preview_runtime_parts.extend((service_account, principal))
    preview_runtime_identities["binding_sha256"] = hashlib.sha256(
        "/".join(preview_runtime_parts).encode("utf-8")
    ).hexdigest()
    preview_target["runtime_identities"] = preview_runtime_identities
    assert _validate_preview_database_target(preview_target)["database"] == "simsa_preview"
    broken_preview_target = dict(preview_target)
    broken_preview_target["event_principal"] = preview_target["api_principal"]
    try:
        _validate_preview_database_target(broken_preview_target)
    except GateFailure:
        pass
    else:
        raise AssertionError("Preview evidence with aliased runtime principals was accepted")

    with tempfile.TemporaryDirectory() as temporary:
        backup_root = Path(temporary) / "backup"
        backup_root.mkdir()
        stem = "simsa-cloud-sql-2026-08-31-123-1"
        archive = backup_root / f"{stem}.dump.age"
        encrypted_evidence = backup_root / f"{stem}.evidence.age"
        archive.write_bytes(b"encrypted dump fixture")
        encrypted_evidence.write_bytes(b"encrypted evidence fixture")
        manifest = backup_root / f"{stem}.manifest.txt"
        manifest.write_text(
            "\n".join(
                (
                    "format=simsa-cloud-sql-age-v1",
                    "schema_profile=pre_migration",
                    f"source_identity_sha256={source_identity_sha256}",
                    "backup_role_membership_closure=exact",
                    f"archive_name={archive.name}",
                    f"archive_sha256={hashlib.sha256(archive.read_bytes()).hexdigest()}",
                    f"evidence_name={encrypted_evidence.name}",
                    f"evidence_sha256={hashlib.sha256(encrypted_evidence.read_bytes()).hexdigest()}",
                    f"repository_commit={sha}",
                    "workflow_run=123/1",
                )
            )
            + "\n",
            encoding="utf-8",
        )
        backup_manifest = validate_backup_evidence(backup_root, evidence)
        assert backup_manifest["schema_profile"] == "pre_migration"
        wrong_target_evidence = dict(evidence)
        wrong_target_evidence["expected_source_identity_sha256"] = "d" * 64
        try:
            validate_backup_evidence(backup_root, wrong_target_evidence)
        except GateFailure:
            pass
        else:
            raise AssertionError("a backup from another Production database target was accepted")
        manifest.write_text(
            manifest.read_text(encoding="utf-8").replace(
                "schema_profile=pre_migration", "schema_profile=post_migration"
            ),
            encoding="utf-8",
        )
        try:
            validate_backup_evidence(backup_root, evidence)
        except GateFailure:
            pass
        else:
            raise AssertionError("a post-migration backup was accepted for maintenance")

        maintenance_digest = "sha256:" + "e" * 64
        maintenance_metadata = evaluate_metadata(
            kind="maintenance",
            repository="example/simsa",
            environment="production",
            commit_sha=sha,
            run_id=789,
            artifact_id=790,
            artifact_digest=maintenance_digest,
            run={
                **base_run,
                "path": MAINTENANCE_WORKFLOW,
                "run_attempt": 2,
            },
            jobs=[{"name": "Controlled bootstrap, migrate, grants, and seed", "conclusion": "success"}],
            artifacts=[{
                "id": 790,
                "name": f"gcp-database-maintenance-production-{sha}-789-2-evidence",
                "digest": maintenance_digest,
                "expired": False,
            }],
        )
        maintenance_root = Path(temporary) / "maintenance"
        maintenance_root.mkdir()
        summary_path = maintenance_root / "maintenance-summary.json"
        summary = {
            "gate_version": "simsa-gcp-database-maintenance/v1",
            "repository": "example/simsa",
            "environment": "production",
            "commit_sha": sha,
            "workflow_run_id": 789,
            "workflow_run_attempt": 2,
            "maintenance_image_digest": "sha256:" + "f" * 64,
            "reviewed_source": {
                "revision": sha,
                "repository_url": "https://github.com/example/simsa",
                "dockerfile_sha256": "1" * 64,
                "package_lock_sha256": "2" * 64,
                "production_merge_review_and_checks": "passed",
            },
            "database_journal": {"count": 34, "latest_created_at": LATEST_MIGRATION},
            "migration_manifest_verified": True,
            "migration_manifest_sha256": "3" * 64,
            "grant_convergence": "passed",
            "ownership_violations": 0,
            "migrator_database_create": False,
            "principal_memberships_verified": True,
            "seed": {"verified": True},
            "acl_fingerprint_md5": "4" * 32,
            "ordered_operations": EXPECTED_OPERATIONS,
            "backup": {
                "workflow_run_id": 123,
                "artifact_id": 456,
                "artifact_digest": digest,
                "source_identity_sha256": source_identity_sha256,
                "independent_restore": "passed",
            },
            "database_target": {
                "project_id": "simsa-prod",
                "region": "asia-southeast2",
                "instance": "simsa-prod",
                "connection_name": "simsa-prod:asia-southeast2:simsa-prod",
                "database": "simsa",
                "cloud_sql_proxy_image": "gcr.io/cloud-sql-connectors/cloud-sql-proxy@sha256:" + "c" * 64,
                "eventarc_invoker_service_account": "simsa-eventarc-invoker@simsa-prod.iam.gserviceaccount.com",
                "api_principal": "simsa-api@simsa-prod.iam",
                "event_principal": "simsa-events@simsa-prod.iam",
                "worker_principal": "simsa-worker@simsa-prod.iam",
                "final_cleanup_principal": "simsa-final-cleanup@simsa-prod.iam",
                "backup_principal": "simsa-db-backup@simsa-prod.iam",
                "source_identity_sha256": source_identity_sha256,
                "runtime_identities": {
                    "api": {
                        "service_account": "simsa-api@simsa-prod.iam.gserviceaccount.com",
                        "database_principal": "simsa-api@simsa-prod.iam",
                    },
                    "events": {
                        "service_account": "simsa-events@simsa-prod.iam.gserviceaccount.com",
                        "database_principal": "simsa-events@simsa-prod.iam",
                    },
                    "worker": {
                        "service_account": "simsa-worker@simsa-prod.iam.gserviceaccount.com",
                        "database_principal": "simsa-worker@simsa-prod.iam",
                    },
                    "final_cleanup": {
                        "service_account": "simsa-final-cleanup@simsa-prod.iam.gserviceaccount.com",
                        "database_principal": "simsa-final-cleanup@simsa-prod.iam",
                    },
                    "binding_sha256": hashlib.sha256(
                        b"simsa-prod/simsa-api@simsa-prod.iam.gserviceaccount.com/simsa-api@simsa-prod.iam/"
                        b"simsa-events@simsa-prod.iam.gserviceaccount.com/simsa-events@simsa-prod.iam/"
                        b"simsa-worker@simsa-prod.iam.gserviceaccount.com/simsa-worker@simsa-prod.iam/"
                        b"simsa-final-cleanup@simsa-prod.iam.gserviceaccount.com/simsa-final-cleanup@simsa-prod.iam"
                    ).hexdigest(),
                },
            },
            "storage_target": {
                "project_id": "simsa-prod",
                "project_number": "123456789",
                "region": "asia-southeast2",
                "upload": {
                    "name": "simsa-prod-upload",
                    "location": "asia-southeast2",
                    "project_number": "123456789",
                    "uniform_bucket_level_access": True,
                    "public_access_prevention": "enforced",
                    "labels": {"application": "simsa", "environment": "production", "managed_by": "terraform", "purpose": "quarantine"},
                },
                "final": {
                    "name": "simsa-prod-final",
                    "location": "asia-southeast2",
                    "project_number": "123456789",
                    "uniform_bucket_level_access": True,
                    "public_access_prevention": "enforced",
                    "labels": {"application": "simsa", "environment": "production", "managed_by": "terraform", "purpose": "final"},
                },
            },
            "runtime_security": {
                "node_env": "production", "app_profile": "internal", "simsa_cloud_platform": "gcp",
                "auth_provider": "firebase", "object_storage_provider": "gcs",
                "firebase_project_id": "simsa-prod", "firebase_session_max_age_hours": "24",
                "firebase_check_revoked": "true", "firebase_app_check_required": "true",
                "firebase_app_check_app_ids": "1:123456789012:web:abcdef12",
                "frontend_url": "https://simsa.example.test",
                "additional_trusted_origins": "https://admin.example.test",
                "db_host": "127.0.0.1", "db_port": "5432", "db_password": "", "db_ssl": "false",
            },
        }
        summary_path.write_text(json.dumps(summary) + "\n", encoding="utf-8")
        auxiliary = maintenance_root / "database-evidence.json"
        auxiliary.write_text('{"fixture":true}\n', encoding="utf-8")
        image_evidence_path = maintenance_root / "maintenance-image.json"
        image_evidence_path.write_text(
            json.dumps({
                "maintenance_image_digest": summary["maintenance_image_digest"],
                "revision": sha,
                "source": "https://github.com/example/simsa",
            }) + "\n",
            encoding="utf-8",
        )
        backup_gate_path = maintenance_root / "backup-gate.json"
        backup_gate = {
            **evidence,
            "backup_manifest": {
                "format": backup_manifest["format"],
                "schema_profile": backup_manifest["schema_profile"],
                "source_identity_sha256": backup_manifest["source_identity_sha256"],
                "backup_role_membership_closure": backup_manifest["backup_role_membership_closure"],
                "repository_commit": backup_manifest["repository_commit"],
                "workflow_run": backup_manifest["workflow_run"],
                "archive_name": backup_manifest["archive_name"],
                "archive_sha256": backup_manifest["archive_sha256"],
                "evidence_name": backup_manifest["evidence_name"],
                "evidence_sha256": backup_manifest["evidence_sha256"],
            },
            "downloaded_evidence": "content_manifest_verified",
        }
        backup_gate_path.write_text(json.dumps(backup_gate) + "\n", encoding="utf-8")
        manifest_path = maintenance_root / "evidence-manifest.sha256"
        manifest_path.write_text(
            "".join(
                f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n"
                for path in (auxiliary, backup_gate_path, image_evidence_path, summary_path)
            ),
            encoding="utf-8",
        )
        assert validate_maintenance_evidence(maintenance_root, maintenance_metadata)["commit_sha"] == sha
        summary["backup"]["independent_restore"] = "missing"
        summary_path.write_text(json.dumps(summary) + "\n", encoding="utf-8")
        manifest_path.write_text(
            "".join(
                f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n"
                for path in (auxiliary, backup_gate_path, image_evidence_path, summary_path)
            ),
            encoding="utf-8",
        )
        try:
            validate_maintenance_evidence(maintenance_root, maintenance_metadata)
        except GateFailure:
            pass
        else:
            raise AssertionError("maintenance evidence without an independent restore was accepted")
        summary["backup"]["independent_restore"] = "passed"
        summary["database_target"]["source_identity_sha256"] = "8" * 64
        summary_path.write_text(json.dumps(summary) + "\n", encoding="utf-8")
        manifest_path.write_text(
            "".join(
                f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n"
                for path in (auxiliary, backup_gate_path, image_evidence_path, summary_path)
            ),
            encoding="utf-8",
        )
        try:
            validate_maintenance_evidence(maintenance_root, maintenance_metadata)
        except GateFailure:
            pass
        else:
            raise AssertionError("maintenance evidence bound to another database target was accepted")
        summary["database_target"]["source_identity_sha256"] = source_identity_sha256
        summary["database_target"]["project_id"] = "other-prod"
        summary_path.write_text(json.dumps(summary) + "\n", encoding="utf-8")
        manifest_path.write_text(
            "".join(
                f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n"
                for path in (auxiliary, backup_gate_path, image_evidence_path, summary_path)
            ),
            encoding="utf-8",
        )
        try:
            validate_maintenance_evidence(maintenance_root, maintenance_metadata)
        except GateFailure:
            pass
        else:
            raise AssertionError("maintenance evidence with a mismatched GCP project was accepted")
        summary["database_target"]["project_id"] = "simsa-prod"
        summary["database_target"]["database"] = "other_database"
        summary_path.write_text(json.dumps(summary) + "\n", encoding="utf-8")
        manifest_path.write_text(
            "".join(
                f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n"
                for path in (auxiliary, backup_gate_path, image_evidence_path, summary_path)
            ),
            encoding="utf-8",
        )
        try:
            validate_maintenance_evidence(maintenance_root, maintenance_metadata)
        except GateFailure:
            pass
        else:
            raise AssertionError("maintenance evidence with a mismatched database was accepted")
        summary["database_target"]["database"] = "simsa"
        backup_gate["backup_manifest"]["source_identity_sha256"] = "7" * 64
        backup_gate_path.write_text(json.dumps(backup_gate) + "\n", encoding="utf-8")
        summary_path.write_text(json.dumps(summary) + "\n", encoding="utf-8")
        manifest_path.write_text(
            "".join(
                f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n"
                for path in (auxiliary, backup_gate_path, image_evidence_path, summary_path)
            ),
            encoding="utf-8",
        )
        try:
            validate_maintenance_evidence(maintenance_root, maintenance_metadata)
        except GateFailure:
            pass
        else:
            raise AssertionError("a mismatched downloaded backup target binding was accepted")
        backup_gate["backup_manifest"]["source_identity_sha256"] = source_identity_sha256
        backup_gate_path.write_text(json.dumps(backup_gate) + "\n", encoding="utf-8")
        summary["commit_sha"] = "9" * 40
        summary_path.write_text(json.dumps(summary) + "\n", encoding="utf-8")
        manifest_path.write_text(
            "".join(
                f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n"
                for path in (auxiliary, backup_gate_path, image_evidence_path, summary_path)
            ),
            encoding="utf-8",
        )
        try:
            validate_maintenance_evidence(maintenance_root, maintenance_metadata)
        except GateFailure:
            pass
        else:
            raise AssertionError("maintenance evidence bound to another commit was accepted")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", choices=("backup", "maintenance", "preview-bootstrap"))
    parser.add_argument("--repository")
    parser.add_argument("--environment")
    parser.add_argument("--commit-sha")
    parser.add_argument("--run-id")
    parser.add_argument("--artifact-id")
    parser.add_argument("--artifact-digest")
    parser.add_argument("--expected-source-identity-sha256")
    parser.add_argument("--evidence", type=Path)
    parser.add_argument("--evidence-dir", type=Path)
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.self_test:
        run_self_test()
        print("GCP maintenance gate self-test: ok")
        return 0
    required = (
        args.kind,
        args.repository,
        args.environment,
        args.commit_sha,
        args.run_id,
        args.artifact_id,
        args.artifact_digest,
        args.evidence,
    )
    if not all(required):
        raise GateFailure("kind, repository, environment, commit/run/artifact identifiers, digest, and evidence are required")
    repository = str(args.repository).strip()
    if re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository) is None:
        raise GateFailure("repository is invalid")
    commit_sha = _require_identifier(args.commit_sha, SHA_RE, "commit SHA")
    run_id_text = _require_identifier(args.run_id, POSITIVE_ID_RE, "run ID")
    artifact_id_text = _require_identifier(args.artifact_id, POSITIVE_ID_RE, "artifact ID")
    artifact_digest = _require_identifier(args.artifact_digest, DIGEST_RE, "artifact digest")
    expected_source_identity_sha256 = None
    if args.kind == "backup":
        expected_source_identity_sha256 = _require_identifier(
            args.expected_source_identity_sha256,
            SHA256_RE,
            "expected source identity SHA-256",
        )
    api = GitHubApi(os.environ.get("GITHUB_TOKEN", ""), os.environ.get("GITHUB_API_URL", "https://api.github.com"))
    run_id = int(run_id_text)
    artifact_id = int(artifact_id_text)
    run = api.get(f"/repos/{repository}/actions/runs/{run_id}")
    jobs = api.paginated(f"/repos/{repository}/actions/runs/{run_id}/jobs", "jobs")
    artifacts = api.paginated(f"/repos/{repository}/actions/runs/{run_id}/artifacts", "artifacts")
    metadata = evaluate_metadata(
        kind=args.kind,
        repository=repository,
        environment=str(args.environment).strip().lower(),
        commit_sha=commit_sha,
        run_id=run_id,
        artifact_id=artifact_id,
        artifact_digest=artifact_digest,
        run=run,
        jobs=jobs,
        artifacts=artifacts,
    )
    if args.kind == "backup":
        metadata["expected_source_identity_sha256"] = expected_source_identity_sha256
    if args.evidence_dir is not None:
        if args.kind == "maintenance":
            maintenance_summary = validate_maintenance_evidence(args.evidence_dir, metadata)
            metadata["database_target"] = maintenance_summary["database_target"]
            metadata["storage_target"] = maintenance_summary["storage_target"]
            metadata["runtime_security"] = maintenance_summary["runtime_security"]
        elif args.kind == "preview-bootstrap":
            preview_summary = validate_preview_bootstrap_evidence(args.evidence_dir, metadata)
            metadata["database_target"] = preview_summary["database_target"]
            metadata["storage_target"] = preview_summary["storage_target"]
            metadata["runtime_security"] = preview_summary["runtime_security"]
        else:
            backup_manifest = validate_backup_evidence(args.evidence_dir, metadata)
            metadata["backup_manifest"] = {
                "format": backup_manifest["format"],
                "schema_profile": backup_manifest["schema_profile"],
                "source_identity_sha256": backup_manifest["source_identity_sha256"],
                "backup_role_membership_closure": backup_manifest["backup_role_membership_closure"],
                "repository_commit": backup_manifest["repository_commit"],
                "workflow_run": backup_manifest["workflow_run"],
                "archive_name": backup_manifest["archive_name"],
                "archive_sha256": backup_manifest["archive_sha256"],
                "evidence_name": backup_manifest["evidence_name"],
                "evidence_sha256": backup_manifest["evidence_sha256"],
            }
        metadata["downloaded_evidence"] = "content_manifest_verified"
    args.evidence.parent.mkdir(parents=True, exist_ok=True)
    args.evidence.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"{args.kind} run/artifact gate passed for {commit_sha}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (GateFailure, OSError, json.JSONDecodeError) as error:
        print(f"GCP maintenance gate: {error}", file=sys.stderr)
        raise SystemExit(1) from error
