#!/usr/bin/env python3
"""Verify a Cloud Run runtime revision is bound to exact database evidence."""

from __future__ import annotations

import argparse
import copy
import json
import re
import sys
import tempfile
from urllib.parse import urlsplit
from pathlib import Path
from typing import Any, Callable


PROJECT_RE = re.compile(r"[a-z][a-z0-9-]{4,28}[a-z0-9]")
REGION_RE = re.compile(r"[a-z]+-[a-z0-9]+[0-9]")
INSTANCE_RE = re.compile(r"[a-z][a-z0-9-]{0,96}[a-z0-9]")
DATABASE_RE = re.compile(r"[a-z][a-z0-9_]{2,62}")
PRINCIPAL_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._@-]{2,62}")
BUCKET_RE = re.compile(r"[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]")
CONNECTION_RE = re.compile(
    r"[a-z][a-z0-9-]{4,28}[a-z0-9]:"
    r"[a-z]+-[a-z0-9]+[0-9]:"
    r"[a-z][a-z0-9-]{0,96}[a-z0-9]"
)
IMAGE_DIGEST_REF_RE = re.compile(
    r"(?:[a-z0-9.-]+(?::[0-9]+)?/)+[a-z0-9._/-]+@sha256:[0-9a-f]{64}"
)


class BindingFailure(RuntimeError):
    """The revision does not use the database target proven by maintenance."""


def _mapping(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _containers(revision: dict[str, Any]) -> list[dict[str, Any]]:
    spec = _mapping(revision.get("spec"))
    template = _mapping(revision.get("template"))
    nested_template = _mapping(spec.get("template"))
    nested_spec = _mapping(nested_template.get("spec"))
    candidates = [
        spec.get("containers"),
        template.get("containers"),
        nested_spec.get("containers"),
    ]
    populated = [
        [item for item in candidate if isinstance(item, dict)]
        for candidate in candidates
        if isinstance(candidate, list) and candidate
    ]
    if len(populated) != 1 or len(populated[0]) < 2:
        raise BindingFailure("Cloud Run revision has missing or ambiguous container configuration")
    return populated[0]


def _one_container(containers: list[dict[str, Any]], name: str) -> dict[str, Any]:
    matches = [container for container in containers if container.get("name") == name]
    if len(matches) != 1:
        raise BindingFailure(f"Cloud Run revision must contain exactly one {name} container")
    return matches[0]


def _literal_environment(container: dict[str, Any]) -> dict[str, str]:
    entries = container.get("env")
    if not isinstance(entries, list):
        raise BindingFailure("API container environment is missing")
    result: dict[str, str] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise BindingFailure("API container environment contains an invalid entry")
        name = entry.get("name")
        if not isinstance(name, str) or not name:
            raise BindingFailure("API container environment contains an unnamed entry")
        if name in result:
            raise BindingFailure(f"API container environment duplicates {name}")
        value = entry.get("value")
        if isinstance(value, str):
            result[name] = value
    return result


def _service_account(revision: dict[str, Any]) -> str:
    spec = _mapping(revision.get("spec"))
    template = _mapping(revision.get("template"))
    nested_template = _mapping(spec.get("template"))
    nested_spec = _mapping(nested_template.get("spec"))
    values = {
        value
        for value in (
            spec.get("serviceAccountName"),
            spec.get("serviceAccount"),
            template.get("serviceAccountName"),
            template.get("serviceAccount"),
            nested_spec.get("serviceAccountName"),
            nested_spec.get("serviceAccount"),
        )
        if isinstance(value, str) and value
    }
    if len(values) != 1:
        raise BindingFailure("Cloud Run revision runtime service account is missing or ambiguous")
    return next(iter(values))


def validate_revision_binding(
    revision: dict[str, Any],
    *,
    project_id: str,
    region: str,
    instance: str,
    database: str,
    runtime_container: str,
    database_principal: str,
    upload_bucket: str,
    final_bucket: str,
    cloud_sql_proxy_image: str,
    runtime_security: dict[str, Any],
) -> dict[str, Any]:
    if runtime_container not in {"api", "events"}:
        raise BindingFailure("Runtime container must be api or events")
    patterns = (
        (project_id, PROJECT_RE, "project ID"),
        (region, REGION_RE, "region"),
        (instance, INSTANCE_RE, "instance"),
        (database, DATABASE_RE, "database"),
        (database_principal, PRINCIPAL_RE, "runtime database principal"),
        (upload_bucket, BUCKET_RE, "upload bucket"),
        (final_bucket, BUCKET_RE, "final bucket"),
        (cloud_sql_proxy_image, IMAGE_DIGEST_REF_RE, "Cloud SQL Auth Proxy image"),
    )
    for value, pattern, label in patterns:
        if pattern.fullmatch(value) is None:
            raise BindingFailure(f"Expected maintenance {label} is invalid")
    if not database_principal.endswith(f"@{project_id}.iam"):
        raise BindingFailure("Expected runtime database principal belongs to another project")
    if upload_bucket == final_bucket:
        raise BindingFailure("Expected upload and final buckets must be distinct")
    fixed_security = {
        "node_env": "production", "app_profile": "internal", "simsa_cloud_platform": "gcp",
        "auth_provider": "firebase", "object_storage_provider": "gcs",
        "firebase_project_id": project_id, "firebase_session_max_age_hours": "24",
        "firebase_check_revoked": "true", "firebase_app_check_required": "true",
        "db_host": "127.0.0.1", "db_port": "5432", "db_password": "", "db_ssl": "false",
    }
    variable_security = {
        "firebase_app_check_app_ids", "frontend_url", "additional_trusted_origins"
    }
    if not isinstance(runtime_security, dict) or set(runtime_security) != set(fixed_security) | variable_security:
        raise BindingFailure("Expected runtime security binding is incomplete or unexpected")
    if any(runtime_security.get(key) != value for key, value in fixed_security.items()):
        raise BindingFailure("Expected runtime security constants are invalid")
    app_ids = str(runtime_security.get("firebase_app_check_app_ids") or "").split(",")
    if not app_ids or app_ids != sorted(set(app_ids)) or any(
        re.fullmatch(r"1:[0-9]{6,}:web:[0-9a-f]{8,}", value) is None for value in app_ids
    ):
        raise BindingFailure("Expected App Check IDs are not canonical")
    def canonical_origin(value: str) -> bool:
        parsed = urlsplit(value)
        return bool(parsed.scheme == "https" and parsed.netloc and not parsed.username and
                    not parsed.password and parsed.path == "" and not parsed.query and
                    not parsed.fragment and value == f"https://{parsed.netloc}")
    frontend_url = str(runtime_security.get("frontend_url") or "")
    origins_text = str(runtime_security.get("additional_trusted_origins") or "")
    origins = origins_text.split(",") if origins_text else []
    if (not canonical_origin(frontend_url) or origins != sorted(set(origins)) or
            frontend_url in origins or any(not canonical_origin(value) for value in origins)):
        raise BindingFailure("Expected frontend/trusted origins are not canonical")

    connection_name = f"{project_id}:{region}:{instance}"
    expected_service_account = f"{database_principal}.gserviceaccount.com"
    containers = _containers(revision)
    names = [str(container.get("name") or "") for container in containers]
    if len(containers) != 2 or set(names) != {runtime_container, "cloud-sql-proxy"}:
        raise BindingFailure("Cloud Run revision container set is not exact")
    runtime = _one_container(containers, runtime_container)
    proxy = _one_container(containers, "cloud-sql-proxy")
    if proxy.get("image") != cloud_sql_proxy_image:
        raise BindingFailure("Cloud SQL Auth Proxy image digest does not match sealed evidence")
    environment = _literal_environment(runtime)
    expected_environment = {
        "NODE_ENV": runtime_security["node_env"],
        "APP_PROFILE": runtime_security["app_profile"],
        "SIMSA_CLOUD_PLATFORM": runtime_security["simsa_cloud_platform"],
        "OBJECT_STORAGE_PROVIDER": runtime_security["object_storage_provider"],
        "GOOGLE_CLOUD_PROJECT": project_id,
        "DB_NAME": database,
        "DB_USER": database_principal,
        "DB_HOST": "127.0.0.1",
        "DB_PORT": "5432",
        "GCS_UPLOAD_BUCKET": upload_bucket,
        "GCS_BUCKET": final_bucket,
        "DB_PASSWORD": runtime_security["db_password"],
        "DB_SSL": runtime_security["db_ssl"],
        "SRIKANDI_ENABLED": "false",
    }
    if runtime_container == "api":
        expected_environment.update({
            "AUTH_PROVIDER": runtime_security["auth_provider"],
            "FIREBASE_PROJECT_ID": runtime_security["firebase_project_id"],
            "FIREBASE_SESSION_MAX_AGE_HOURS": runtime_security["firebase_session_max_age_hours"],
            "FIREBASE_CHECK_REVOKED": runtime_security["firebase_check_revoked"],
            "FIREBASE_APP_CHECK_REQUIRED": runtime_security["firebase_app_check_required"],
            "FIREBASE_APP_CHECK_APP_IDS": runtime_security["firebase_app_check_app_ids"],
            "FRONTEND_URL": runtime_security["frontend_url"],
            "ADDITIONAL_TRUSTED_ORIGINS": runtime_security["additional_trusted_origins"],
            "MALWARE_SCANNER_MODE": "clamav",
            "MALWARE_SCAN_WORKER_ENABLED": "true",
            "MALWARE_SCAN_WORKER_RUNTIME": "external",
        })
        if runtime.get("command") not in (None, []) or runtime.get("args") not in (None, []):
            raise BindingFailure("Cloud Run API must use the reviewed image command without overrides")
    else:
        expected_environment.update({
            "EVENTARC_HANDLER_PATH": "/internal/events/storage-finalized",
            "MALWARE_SCANNER_MODE": "disabled",
        })
        if runtime.get("command") != ["node"] or runtime.get("args") != ["dist/events/storage-finalized.js"]:
            raise BindingFailure("Cloud Run events command/args do not match the reviewed handler")
    for name, expected in expected_environment.items():
        if environment.get(name) != expected:
            raise BindingFailure(f"Cloud Run {runtime_container} environment mismatch: {name}")

    actual_service_account = _service_account(revision)
    if actual_service_account != expected_service_account:
        raise BindingFailure("Cloud Run runtime service account does not match the sealed database principal")

    args = proxy.get("args")
    if not isinstance(args, list) or any(not isinstance(arg, str) for arg in args):
        raise BindingFailure("Cloud SQL Auth Proxy arguments are missing or invalid")
    connections = [arg for arg in args if CONNECTION_RE.fullmatch(arg)]
    if connections != [connection_name]:
        raise BindingFailure("Cloud SQL Auth Proxy connection does not match maintenance evidence")
    if "--private-ip" not in args or "--auto-iam-authn" not in args:
        raise BindingFailure("Cloud SQL Auth Proxy is not private with automatic IAM authentication")

    metadata = _mapping(revision.get("metadata"))
    revision_name = metadata.get("name")
    if not isinstance(revision_name, str) or not revision_name:
        raise BindingFailure("Cloud Run revision name is missing")
    return {
        "binding_version": "simsa-cloud-run-database-binding/v1",
        "revision": revision_name,
        "database_target": {
            "project_id": project_id,
            "region": region,
            "instance": instance,
            "connection_name": connection_name,
            "database": database,
            "database_principal": database_principal,
            "upload_bucket": upload_bucket,
            "final_bucket": final_bucket,
            "cloud_sql_proxy_image": cloud_sql_proxy_image,
        },
        "runtime_container": runtime_container,
        "runtime_environment": expected_environment,
        "runtime_security": runtime_security,
        "runtime_service_account": expected_service_account,
        "cloud_sql_proxy": {
            "private_ip": True,
            "automatic_iam_authentication": True,
            "connection_name": connection_name,
            "image": cloud_sql_proxy_image,
        },
        "gate": "passed",
    }


def _fixture(runtime_container: str = "api", principal: str = "simsa-api@simsa-prod.iam") -> dict[str, Any]:
    result = {
        "metadata": {"name": "simsa-api-00001-test"},
        "spec": {
            "serviceAccountName": f"{principal}.gserviceaccount.com",
            "containers": [
                {
                    "name": runtime_container,
                    "image": "example.invalid/api@sha256:" + "a" * 64,
                    "env": [
                        {"name": "NODE_ENV", "value": "production"},
                        {"name": "APP_PROFILE", "value": "internal"},
                        {"name": "SIMSA_CLOUD_PLATFORM", "value": "gcp"},
                        {"name": "OBJECT_STORAGE_PROVIDER", "value": "gcs"},
                        {"name": "GOOGLE_CLOUD_PROJECT", "value": "simsa-prod"},
                        {"name": "DB_NAME", "value": "simsa"},
                        {"name": "DB_USER", "value": principal},
                        {"name": "DB_HOST", "value": "127.0.0.1"},
                        {"name": "DB_PORT", "value": "5432"},
                        {"name": "GCS_UPLOAD_BUCKET", "value": "simsa-prod-upload"},
                        {"name": "GCS_BUCKET", "value": "simsa-prod-final"},
                        {"name": "DB_PASSWORD", "value": ""},
                        {"name": "DB_SSL", "value": "false"},
                        {"name": "AUTH_PROVIDER", "value": "firebase"},
                        {"name": "FIREBASE_PROJECT_ID", "value": "simsa-prod"},
                        {"name": "FIREBASE_SESSION_MAX_AGE_HOURS", "value": "24"},
                        {"name": "FIREBASE_CHECK_REVOKED", "value": "true"},
                        {"name": "FIREBASE_APP_CHECK_REQUIRED", "value": "true"},
                        {"name": "FIREBASE_APP_CHECK_APP_IDS", "value": "1:123456789012:web:abcdef12"},
                        {"name": "FRONTEND_URL", "value": "https://simsa.example.test"},
                        {"name": "ADDITIONAL_TRUSTED_ORIGINS", "value": "https://admin.example.test"},
                        {"name": "SRIKANDI_ENABLED", "value": "false"},
                        {"name": "MALWARE_SCANNER_MODE", "value": "clamav"},
                        {"name": "MALWARE_SCAN_WORKER_ENABLED", "value": "true"},
                        {"name": "MALWARE_SCAN_WORKER_RUNTIME", "value": "external"},
                    ],
                },
                {
                    "name": "cloud-sql-proxy",
                    "image": "example.invalid/proxy@sha256:" + "b" * 64,
                    "args": [
                        "--structured-logs",
                        "--private-ip",
                        "--auto-iam-authn",
                        "--address=127.0.0.1",
                        "--port=5432",
                        "simsa-prod:asia-southeast2:simsa-prod",
                    ],
                },
            ],
        },
    }
    if runtime_container == "events":
        runtime = result["spec"]["containers"][0]
        runtime["command"] = ["node"]
        runtime["args"] = ["dist/events/storage-finalized.js"]
        api_only = {
            "AUTH_PROVIDER", "FIREBASE_PROJECT_ID", "FIREBASE_SESSION_MAX_AGE_HOURS",
            "FIREBASE_CHECK_REVOKED", "FIREBASE_APP_CHECK_REQUIRED",
            "FIREBASE_APP_CHECK_APP_IDS", "FRONTEND_URL", "ADDITIONAL_TRUSTED_ORIGINS",
            "MALWARE_SCANNER_MODE", "MALWARE_SCAN_WORKER_ENABLED",
            "MALWARE_SCAN_WORKER_RUNTIME",
        }
        runtime["env"] = [entry for entry in runtime["env"] if entry["name"] not in api_only]
        runtime["env"].extend([
            {"name": "EVENTARC_HANDLER_PATH", "value": "/internal/events/storage-finalized"},
            {"name": "MALWARE_SCANNER_MODE", "value": "disabled"},
        ])
        result["metadata"]["name"] = "simsa-events-00001-test"
    return result


def run_self_test() -> None:
    runtime_security = {
        "node_env": "production", "app_profile": "internal", "simsa_cloud_platform": "gcp",
        "auth_provider": "firebase", "object_storage_provider": "gcs",
        "firebase_project_id": "simsa-prod", "firebase_session_max_age_hours": "24",
        "firebase_check_revoked": "true", "firebase_app_check_required": "true",
        "firebase_app_check_app_ids": "1:123456789012:web:abcdef12",
        "frontend_url": "https://simsa.example.test",
        "additional_trusted_origins": "https://admin.example.test",
        "db_host": "127.0.0.1", "db_port": "5432", "db_password": "", "db_ssl": "false",
    }
    arguments = {
        "project_id": "simsa-prod",
        "region": "asia-southeast2",
        "instance": "simsa-prod",
        "database": "simsa",
        "runtime_container": "api",
        "database_principal": "simsa-api@simsa-prod.iam",
        "upload_bucket": "simsa-prod-upload",
        "final_bucket": "simsa-prod-final",
        "cloud_sql_proxy_image": "example.invalid/proxy@sha256:" + "b" * 64,
        "runtime_security": runtime_security,
    }
    assert validate_revision_binding(_fixture(), **arguments)["gate"] == "passed"
    event_arguments = {
        **arguments,
        "runtime_container": "events",
        "database_principal": "simsa-events@simsa-prod.iam",
    }
    assert validate_revision_binding(
        _fixture("events", "simsa-events@simsa-prod.iam"), **event_arguments
    )["gate"] == "passed"

    mutations: list[tuple[str, Callable[[dict[str, Any]], None]]] = [
        (
            "GCP project",
            lambda value: value["spec"]["containers"][0]["env"][4].update(
                value="other-prod"
            ),
        ),
        (
            "database",
            lambda value: value["spec"]["containers"][0]["env"][5].update(
                value="other_database"
            ),
        ),
        (
            "database principal",
            lambda value: value["spec"]["containers"][0]["env"][6].update(
                value="other-api@simsa-prod.iam"
            ),
        ),
        (
            "upload bucket",
            lambda value: value["spec"]["containers"][0]["env"][9].update(
                value="other-upload"
            ),
        ),
        (
            "runtime service account",
            lambda value: value["spec"].update(
                serviceAccountName="other-api@simsa-prod.iam.gserviceaccount.com"
            ),
        ),
        (
            "Cloud SQL connection",
            lambda value: value["spec"]["containers"][1]["args"].__setitem__(
                5, "other-prod:asia-southeast2:other-prod"
            ),
        ),
        (
            "Cloud SQL proxy digest",
            lambda value: value["spec"]["containers"][1].update(
                image="example.invalid/proxy@sha256:" + "c" * 64
            ),
        ),
        (
            "unpinned Cloud SQL proxy",
            lambda value: value["spec"]["containers"][1].update(
                image="example.invalid/proxy:latest"
            ),
        ),
        (
            "extra sidecar",
            lambda value: value["spec"]["containers"].append({
                "name": "observer", "image": "example.invalid/observer@sha256:" + "d" * 64
            }),
        ),
        (
            "authentication provider",
            lambda value: value["spec"]["containers"][0]["env"][13].update(value="legacy"),
        ),
        (
            "trusted origins",
            lambda value: value["spec"]["containers"][0]["env"][20].update(value="https://evil.example"),
        ),
        (
            "API command override",
            lambda value: value["spec"]["containers"][0].update(command=["sh"]),
        ),
        (
            "API service container",
            lambda value: value["spec"]["containers"][0].update(name="other-api"),
        ),
        (
            "duplicate DB_NAME",
            lambda value: value["spec"]["containers"][0]["env"].append(
                {"name": "DB_NAME", "value": "simsa"}
            ),
        ),
    ]
    for label, mutate in mutations:
        broken = copy.deepcopy(_fixture())
        mutate(broken)
        try:
            validate_revision_binding(broken, **arguments)
        except BindingFailure:
            pass
        else:
            raise AssertionError(f"revision with mismatched {label} was accepted")

    broken_event = _fixture("events", "simsa-events@simsa-prod.iam")
    broken_event["spec"]["containers"][0]["args"] = ["dist/index.js"]
    try:
        validate_revision_binding(broken_event, **event_arguments)
    except BindingFailure:
        pass
    else:
        raise AssertionError("event revision with a wrong handler entrypoint was accepted")

    broken_worker_runtime = _fixture()
    next(
        entry for entry in broken_worker_runtime["spec"]["containers"][0]["env"]
        if entry["name"] == "MALWARE_SCAN_WORKER_RUNTIME"
    )["value"] = "embedded"
    try:
        validate_revision_binding(broken_worker_runtime, **arguments)
    except BindingFailure:
        pass
    else:
        raise AssertionError("API revision with a wrong malware worker runtime was accepted")

    broken_event_path = _fixture("events", "simsa-events@simsa-prod.iam")
    next(
        entry for entry in broken_event_path["spec"]["containers"][0]["env"]
        if entry["name"] == "EVENTARC_HANDLER_PATH"
    )["value"] = "/internal/events/wrong"
    try:
        validate_revision_binding(broken_event_path, **event_arguments)
    except BindingFailure:
        pass
    else:
        raise AssertionError("event revision with a wrong handler path was accepted")

    with tempfile.TemporaryDirectory() as temporary:
        evidence = Path(temporary) / "binding.json"
        evidence.write_text(
            json.dumps(validate_revision_binding(_fixture(), **arguments)) + "\n",
            encoding="utf-8",
        )
        assert json.loads(evidence.read_text(encoding="utf-8"))["gate"] == "passed"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--revision", type=Path)
    parser.add_argument("--expected-project-id")
    parser.add_argument("--expected-region")
    parser.add_argument("--expected-instance")
    parser.add_argument("--expected-database")
    parser.add_argument("--runtime-container", choices=("api", "events"))
    parser.add_argument("--expected-database-principal")
    parser.add_argument("--expected-upload-bucket")
    parser.add_argument("--expected-final-bucket")
    parser.add_argument("--expected-cloud-sql-proxy-image")
    parser.add_argument("--expected-runtime-security-json")
    parser.add_argument("--evidence", type=Path)
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.self_test:
        run_self_test()
        print("GCP Cloud Run database binding self-test: ok")
        return 0
    required = (
        args.revision,
        args.expected_project_id,
        args.expected_region,
        args.expected_instance,
        args.expected_database,
        args.runtime_container,
        args.expected_database_principal,
        args.expected_upload_bucket,
        args.expected_final_bucket,
        args.expected_cloud_sql_proxy_image,
        args.expected_runtime_security_json,
        args.evidence,
    )
    if not all(required):
        raise BindingFailure("revision, runtime container, exact database target, principal, and evidence path are required")
    try:
        runtime_security = json.loads(str(args.expected_runtime_security_json))
    except json.JSONDecodeError as error:
        raise BindingFailure("expected runtime security JSON is invalid") from error
    if not isinstance(runtime_security, dict):
        raise BindingFailure("expected runtime security JSON must be an object")
    try:
        revision = json.loads(args.revision.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise BindingFailure("Cloud Run revision JSON is missing or invalid") from error
    if not isinstance(revision, dict):
        raise BindingFailure("Cloud Run revision JSON root must be an object")
    result = validate_revision_binding(
        revision,
        project_id=str(args.expected_project_id),
        region=str(args.expected_region),
        instance=str(args.expected_instance),
        database=str(args.expected_database),
        runtime_container=str(args.runtime_container),
        database_principal=str(args.expected_database_principal),
        upload_bucket=str(args.expected_upload_bucket),
        final_bucket=str(args.expected_final_bucket),
        cloud_sql_proxy_image=str(args.expected_cloud_sql_proxy_image),
        runtime_security=runtime_security,
    )
    args.evidence.parent.mkdir(parents=True, exist_ok=True)
    args.evidence.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Cloud Run database binding passed for {result['revision']}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (BindingFailure, OSError, json.JSONDecodeError) as error:
        print(f"GCP Cloud Run database binding: {error}", file=sys.stderr)
        raise SystemExit(1) from error
