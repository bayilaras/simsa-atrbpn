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
    0: "65885db6ca8dd9bc239b7ae3c8e7d35a6d3f206b517e2cfb810f991c8fdd32c2",
    1: "d4062fa9423a88d322262b7da6d389dae0408f57c6e5c236562cc9c2464ba4ab",
    2: "fd51691c42d20d512a294a4e19ea0082827a1362eb82aeb7957e5ed052e85de4",
    3: "16696f9b1ac904c6ebb0b5c2b6b2bc680b1fe1f87db3afc7adbf6169bbabf5d4",
    4: "46ff9fc972ad55d14cfd499b85c2c72fb6e688036acf467b8c0c4ad91c01eb3a",
    5: "eaa537043eb75158f8915d9058a8b17ee4405149886e58dbe3ed3b09a1281fd6",
    6: "a2ae1c042dca1ef5fa053b9665bb3d0dfa7f1fa1bdef189d6b0baa6896cc8810",
    7: "dee5ddf994e7d7cb076defab0eb92f02097253f74777da1e276030699acc438f",
    8: "244926d8c498e01a31953782e86a5cadea1877a303238248bcd7517024432a0a",
    9: "ba6d07e28709d7a1032446aae27513a7f131bb081032b2a4c382ad0c2d2ef1a1",
}
if set(approved_legacy_sha256) != set(range(10)):
    raise SystemExit("approved legacy migration hashes must cover exactly 0000-0009")

if not isinstance(entries, list) or len(entries) != 30:
    raise SystemExit("expected exactly 30 entries in the Drizzle migration journal")

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

    profile_lengths = {"pre_migration": 21, "post_migration": 30}
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
