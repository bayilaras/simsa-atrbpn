#!/usr/bin/env python3
"""Emit the exact Drizzle migration code manifest as compact JSON."""

from __future__ import annotations

import argparse
import hashlib
import json
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

if not isinstance(entries, list) or len(entries) != 34:
    raise SystemExit("expected exactly 34 entries in the Drizzle migration journal")

manifest: list[dict[str, int | str | list[str]]] = []
sql_by_tag: dict[str, str] = {}
for expected_index, entry in enumerate(entries):
    if entry.get("idx") != expected_index:
        raise SystemExit("Drizzle migration journal indices must be contiguous from zero")
    tag = entry.get("tag")
    created_at = entry.get("when")
    if not isinstance(tag, str) or not isinstance(created_at, int):
        raise SystemExit("Drizzle migration journal entry is missing tag/when")
    if not tag.startswith(f"{expected_index:04d}_"):
        raise SystemExit("Drizzle migration tag prefix does not match its index")

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


def emit_fixture_sql(profile: str) -> None:
    """Emit a disposable, exact migration fixture for verifier CI tests."""

    profile_lengths = {"pre_migration": 21, "post_migration": 34}
    selected_entries = manifest[: profile_lengths[profile]]
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


parser = argparse.ArgumentParser()
parser.add_argument(
    "--emit-profile-sql",
    choices=("pre_migration", "post_migration"),
    help="emit a disposable exact-profile SQL fixture instead of JSON",
)
arguments = parser.parse_args()

if arguments.emit_profile_sql:
    emit_fixture_sql(arguments.emit_profile_sql)
else:
    print(json.dumps(manifest, separators=(",", ":"), ensure_ascii=True))
