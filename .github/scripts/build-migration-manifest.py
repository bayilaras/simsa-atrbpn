#!/usr/bin/env python3
"""Emit the exact Drizzle migration code manifest as compact JSON."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path


repository_root = Path(__file__).resolve().parents[2]
migrations_dir = repository_root / "backend" / "src" / "db" / "migrations"
journal_path = migrations_dir / "meta" / "_journal.json"
journal = json.loads(journal_path.read_text(encoding="utf-8"))
entries = journal.get("entries")

# Read-only Production metadata was reconciled against the Git history. The
# first ten migrations were applied from these exact, known byte variants before
# LF was made canonical. No arbitrary legacy hash is accepted.
approved_legacy_sha256 = {
    int(index): digest
    for index, digest in json.loads(
        (migrations_dir / "meta" / "approved_legacy_hashes.json").read_text(encoding="utf-8")
    ).items()
}
if set(approved_legacy_sha256) != set(range(10)):
    raise SystemExit("approved legacy migration hashes must cover exactly 0000-0009")
if any(not isinstance(digest, str) or len(digest) != 64
       or any(character not in "0123456789abcdef" for character in digest)
       for digest in approved_legacy_sha256.values()):
    raise SystemExit("approved legacy migration hashes must be lowercase SHA-256 digests")

if not isinstance(entries, list) or not entries:
    raise SystemExit("expected a non-empty ordered Drizzle migration journal")

manifest: list[dict[str, int | str | list[str]]] = []
sql_by_tag: dict[str, str] = {}
for expected_index, entry in enumerate(entries):
    if (not isinstance(entry, dict) or type(entry.get("idx")) is not int
            or entry["idx"] != expected_index):
        raise SystemExit("Drizzle migration journal indices must be contiguous from zero")
    tag = entry.get("tag")
    created_at = entry.get("when")
    if not isinstance(tag, str) or type(created_at) is not int or not 0 <= created_at <= 9007199254740991:
        raise SystemExit("Drizzle migration journal entry is missing tag/when")
    if not re.fullmatch(rf"{expected_index:04d}_[a-z0-9_]+", tag):
        raise SystemExit("Drizzle migration tag prefix does not match its index")
    if manifest and created_at <= manifest[-1]["created_at"]:
        raise SystemExit("Drizzle migration timestamps must be strictly increasing")

    migration_path = migrations_dir / f"{tag}.sql"
    if not migration_path.is_file():
        raise SystemExit(f"missing migration file: {migration_path.name}")
    migration_bytes = migration_path.read_bytes()
    try:
        migration_sql = migration_bytes.decode("utf-8")
    except UnicodeDecodeError as error:
        raise SystemExit(f"migration is not valid UTF-8: {migration_path.name}") from error
    # Hash the canonical Git representation independently of the developer's
    # checkout platform. .gitattributes enforces LF for future checkouts too.
    migration_sql = migration_sql.replace("\r\n", "\n")
    if "\r" in migration_sql:
        raise SystemExit(f"migration contains an unsupported bare CR: {migration_path.name}")
    canonical_bytes = migration_sql.encode("utf-8")
    if any(line.startswith("\\") for line in migration_sql.splitlines()):
        raise SystemExit(f"migration contains a psql meta-command: {migration_path.name}")
    sql_by_tag[tag] = migration_sql
    canonical_sha256 = hashlib.sha256(canonical_bytes).hexdigest()
    accepted_sha256 = [canonical_sha256]
    if expected_index in approved_legacy_sha256:
        legacy_sha256 = approved_legacy_sha256[expected_index]
        if legacy_sha256 == canonical_sha256:
            raise SystemExit("legacy migration hash must differ from the canonical LF hash")
        if expected_index in {0, 1, 2, 3, 6, 7, 8, 9}:
            crlf_sha256 = hashlib.sha256(
                canonical_bytes.replace(b"\n", b"\r\n")
            ).hexdigest()
            if crlf_sha256 != legacy_sha256:
                raise SystemExit("approved legacy CRLF hash no longer matches its migration")
        accepted_sha256.append(legacy_sha256)
    manifest.append(
        {
            "idx": expected_index,
            "created_at": created_at,
            "tag": tag,
            "sha256": canonical_sha256,
            "accepted_sha256": accepted_sha256,
        }
    )


PROFILE_ANCHORS = {
    "pre_migration": "0020_permanent_transfer_lifecycle",
    "pre_upgrade_0038": "0038_arsip_direct_upload",
}
PROFILES = (*PROFILE_ANCHORS, "post_migration")


def profile_manifest(profile: str) -> list[dict]:
    """Only these reviewed historical baselines and the whole checkout are valid."""
    if profile == "post_migration":
        return manifest
    if profile not in PROFILE_ANCHORS:
        raise ValueError("unknown reviewed migration profile")
    baseline = next((index + 1 for index, entry in enumerate(manifest)
                     if entry["tag"] == PROFILE_ANCHORS[profile]), None)
    if baseline is None:
        raise ValueError("reviewed pre-upgrade migration baseline is missing")
    return manifest[:baseline]


def emit_fixture_sql(profile: str) -> None:
    """Emit a disposable, exact migration fixture for verifier CI tests."""
    selected_entries = profile_manifest(profile)
    print(r"\set ON_ERROR_STOP on")
    print("BEGIN;")
    print("CREATE SCHEMA IF NOT EXISTS drizzle;")
    print(
        "CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations ("
        "id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);"
    )
    for entry in selected_entries:
        tag = str(entry["tag"])
        print(f"\n-- Begin checked-out migration {tag}")
        print(sql_by_tag[tag].rstrip("\r\n"))
        print(
            "\nINSERT INTO drizzle.__drizzle_migrations (hash, created_at) "
            f"VALUES ('{entry['sha256']}', {entry['created_at']});"
        )
    print("COMMIT;")


def manifest_json() -> str:
    return json.dumps(manifest, separators=(",", ":"), ensure_ascii=True)


def manifest_sha256() -> str:
    """Match the CLI's exact bytes consumed by sha256sum in release workflows."""
    return hashlib.sha256((manifest_json() + "\n").encode("utf-8")).hexdigest()


def verify_journal_summary(summary: dict) -> None:
    """Compare captured evidence with this checkout, never a second release number."""
    if not isinstance(summary, dict):
        raise ValueError("database evidence must be an object")
    journal = summary.get("database_journal", summary.get("journal"))
    if (not isinstance(journal, dict)
            or type(journal.get("count")) is not int
            or journal["count"] != len(manifest)
            or journal.get("latest_created_at") != manifest[-1]["created_at"]
            or summary.get("migration_manifest_verified") is not True):
        raise ValueError("database journal differs from the reviewed migration manifest")
    if ("migration_manifest_sha256" in summary
            and summary["migration_manifest_sha256"] != manifest_sha256()):
        raise ValueError("database evidence is bound to a different migration manifest")


def validate_gate_binding(source: str, evidence_path: str) -> None:
    command = ("python3 .github/scripts/build-migration-manifest.py "
               f"--verify-journal-summary {evidence_path}")
    if re.search(r"^\s*" + re.escape(command) + r"\s*$", source, re.MULTILINE) is None:
        raise ValueError(f"missing reviewed migration verification for {evidence_path}")
    if re.search(r"\.(?:database_)?journal\.(?:count|latest_created_at)\s*(?:==|!=|>=|<=|>|<)\s*[0-9]", source):
        raise ValueError("hardcoded release journal gate can drift from the reviewed manifest")


def check_gate_bindings() -> None:
    for file, evidence in (
        (".github/workflows/database-maintenance-gcp.yml", "maintenance-evidence/maintenance-summary.json"),
        (".github/workflows/database-bootstrap-gcp-preview.yml", "preview-database-evidence/preview-database-summary.json"),
        (".github/scripts/run-gcp-database-maintenance.sh", '"$EVIDENCE_DIR/database-evidence.json"'),
    ):
        validate_gate_binding((repository_root / file).read_text(encoding="utf-8"), evidence)


def main() -> None:
    parser = argparse.ArgumentParser()
    operation = parser.add_mutually_exclusive_group()
    operation.add_argument("--emit-profile-sql", choices=PROFILES)
    operation.add_argument("--emit-profile-manifest", choices=PROFILES)
    operation.add_argument("--verify-journal-summary", type=Path)
    operation.add_argument("--check-bindings", action="store_true")
    arguments = parser.parse_args()
    if arguments.emit_profile_sql:
        emit_fixture_sql(arguments.emit_profile_sql)
    elif arguments.emit_profile_manifest:
        print(json.dumps(profile_manifest(arguments.emit_profile_manifest), separators=(",", ":")))
    elif arguments.verify_journal_summary:
        verify_journal_summary(json.loads(arguments.verify_journal_summary.read_text(encoding="utf-8")))
    elif arguments.check_bindings:
        check_gate_bindings()
        print("Migration journal workflow bindings: ok")
    else:
        print(manifest_json())


if __name__ == "__main__":
    main()
