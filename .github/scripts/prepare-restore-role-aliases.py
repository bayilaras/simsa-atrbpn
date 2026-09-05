#!/usr/bin/env python3
"""Validate pg_restore DATABASE PROPERTIES; generate inert, disposable aliases.

This does not execute archive SQL or connect to a database. The caller must
finish authenticated decryption, hash verification, and both pg_restore metadata
passes before executing the generated prepare SQL. Only TOC/selected-property
metadata is written to disk, never the plaintext archive or application rows.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path


POLICY_ROLES = {
    "simsa_api_runtime", "simsa_event_runtime", "simsa_worker_runtime",
    "simsa_final_cleanup", "simsa_maintenance", "simsa_migrator",
    "simsa_backup_reader",
}
PROTECTED_ROLES = POLICY_ROLES | {
    "postgres", "public", "none", "all", "current_user", "session_user",
    "rdsadmin", "rds_superuser", "azure_pg_admin", "azure_superuser",
}
ROLE_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.@-]{0,62}\Z")
DATABASE_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_-]{0,62}\Z")
IDENTIFIER = r'(?:"[A-Za-z0-9_][A-Za-z0-9_.@-]{0,62}"|[a-z_][a-z0-9_]{0,62})'
SETTING_RE = re.compile(
    rf"ALTER ROLE (?P<role>{IDENTIFIER}) IN DATABASE (?P<database>{IDENTIFIER}) "
    r"SET (?P<setting>search_path|role) TO (?P<value>[^;]+);\Z"
)
WRAPPERS = {
    "SET statement_timeout = 0;",
    "SET lock_timeout = 0;",
    "SET idle_in_transaction_session_timeout = 0;",
    "SET transaction_timeout = 0;",  # PostgreSQL 17+ pg_restore.
    "SET client_encoding = 'UTF8';",
    "SET standard_conforming_strings = on;",
    "SELECT pg_catalog.set_config('search_path', '', false);",
    "SET check_function_bodies = false;",
    "SET xmloption = content;",
    "SET client_min_messages = warning;",
    "SET row_security = off;",
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def database_name(value: str) -> str:
    require(bool(DATABASE_RE.fullmatch(value)), "unsafe database identifier")
    require(value.lower() not in {"postgres", "template0", "template1"},
            "maintenance database is forbidden")
    return value


def role_name(value: str) -> str:
    require(bool(ROLE_RE.fullmatch(value)), "unsafe role identifier")
    require(value.lower() not in PROTECTED_ROLES
            and not value.lower().startswith(("pg_", "cloudsql", "rds_", "azure_")),
            "protected or fixed policy role is forbidden")
    return value


def identifier(value: str) -> str:
    return value[1:-1] if value.startswith('"') else value


def literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def read_metadata(path: Path, limit: int) -> str:
    require(path.stat().st_size <= limit, "metadata exceeds its bounded size")
    value = path.read_bytes().decode("utf-8", errors="strict")
    require("\0" not in value and "\r" not in value.replace("\r\n", ""),
            "invalid metadata encoding or line endings")
    return value.replace("\r\n", "\n")


def select_toc(text: str, database: str, schema_profile: str = "post_migration") -> str:
    """Select exactly one DATABASE PROPERTIES entry, never omit it at restore."""
    database_name(database)
    require(schema_profile in {"pre_migration", "post_migration"}, "invalid schema profile")
    require(text.endswith("\n"), "truncated TOC metadata")
    counts = re.findall(r"^;\s+TOC Entries: ([1-9][0-9]*)$", text, re.MULTILINE)
    names = re.findall(r"^;\s+dbname: (.+)$", text, re.MULTILINE)
    require(len(counts) == 1 and names == [database], "missing or mismatched full TOC header")
    selected = []
    database_entries = []
    ids = set()
    for line in text.splitlines():
        if not line or line.startswith(";"):
            continue
        entry = re.fullmatch(r"([1-9][0-9]*); ([0-9]+) ([0-9]+) (.+)", line)
        require(entry is not None, "invalid TOC entry")
        require(entry[1] not in ids, "duplicate TOC entry ID")
        ids.add(entry[1])
        description = entry[4]
        if description.startswith("DATABASE PROPERTIES "):
            match = re.fullmatch(r"DATABASE PROPERTIES - ([A-Za-z_][A-Za-z0-9_-]{0,62}) ([A-Za-z0-9_.@-]{1,63})", description)
            require(match is not None and match[1] == database,
                    "DATABASE PROPERTIES belongs to another or unsafe database")
            selected.append(line)
        elif description.startswith("DATABASE "):
            match = re.fullmatch(r"DATABASE - ([A-Za-z_][A-Za-z0-9_-]{0,62}) ([A-Za-z0-9_.@-]{1,63})", description)
            require(match is not None and match[1] == database,
                    "DATABASE TOC identity differs from expected source")
            database_entries.append(line)
    # Supported pg_dump 16+ custom archives have three special entries that
    # pg_restore processes but does not list: ENCODING, STDSTRINGS, SEARCHPATH.
    # No list filtering flags may be supplied in this first metadata pass.
    require(len(ids) + 3 == int(counts[0]), "full TOC is truncated or was filtered")
    require(len(selected) == 1 or (not selected and schema_profile == "pre_migration"),
            "exactly one DATABASE PROPERTIES TOC entry is required after migration")
    require(len(database_entries) == 1, "exactly one source DATABASE TOC entry is required")
    return selected[0] + "\n" if selected else "; No DATABASE PROPERTIES in this validated pre_migration archive\n"


def parse_properties(text: str, database: str, target_admin: str,
                     target_roles: list[str], schema_profile: str,
                     properties_present: bool = True) -> dict:
    database_name(database)
    role_name(target_admin)
    require(schema_profile in {"pre_migration", "post_migration"}, "invalid schema profile")
    require(properties_present or schema_profile == "pre_migration",
            "only pre_migration may omit database role properties")
    require(len(target_roles) == 7 and len(set(target_roles)) == 7,
            "exactly seven distinct restore principals are required")
    for role in target_roles:
        role_name(role)
    require(target_admin not in target_roles, "restore administrator collides with a principal")
    require(text.endswith("\n"), "truncated DATABASE PROPERTIES SQL")
    require("PostgreSQL database dump complete" in text, "missing SQL completion marker")
    require("PostgreSQL database dump\n" in text, "missing SQL opening marker")
    statements = []
    restrictions = []
    wrapper_seen: dict[str, int] = {}
    source_settings: dict[str, dict[str, str]] = {}
    header_seen = 0
    database_header_seen = 0
    create_seen = 0
    connects = 0
    for line in text.splitlines():
        if line.startswith("--"):
            if "Type: DATABASE PROPERTIES;" in line:
                match = re.fullmatch(
                    r"-- Name: ([A-Za-z_][A-Za-z0-9_-]{0,62}); Type: DATABASE PROPERTIES; Schema: -; Owner: (?:-|[A-Za-z0-9_.@-]{1,63})",
                    line,
                )
                require(match is not None and match[1] == database,
                        "SQL DATABASE PROPERTIES header does not match the source")
                header_seen += 1
            elif "; Type:" in line:
                require(line == f"-- Name: {database}; Type: DATABASE; Schema: -; Owner: -",
                        "unexpected object in selected database metadata")
                database_header_seen += 1
            continue
        if not line.strip():
            continue
        if line.startswith("\\"):
            if line == f"\\connect {database}" or line == f'\\connect "{database}"':
                connects += 1
                continue
            restriction = re.fullmatch(r"\\(restrict|unrestrict) ([A-Za-z0-9]{1,128})", line)
            require(restriction is not None, "unsupported psql command in metadata")
            restrictions.append((restriction[1], restriction[2]))
            continue
        statements.append(line.strip())
    require(header_seen == int(properties_present), "SQL properties header differs from the complete TOC")
    require(database_header_seen == 1 and connects == (2 if properties_present else 1),
            "missing or duplicate pg_restore database creation wrapper")
    require(not restrictions or (len(restrictions) == 2 * (connects + 1)
            and all(command == ("restrict" if i % 2 == 0 else "unrestrict")
                    for i, (command, _) in enumerate(restrictions))
            and len({token for _, token in restrictions}) == 1),
            "invalid or truncated psql restriction wrapper")
    # No general SQL parser, comments, escape sequences, or arbitrary SET values
    # are accepted. pg_restore emits these approved properties one per line.
    for statement in statements:
        if statement in WRAPPERS:
            wrapper_seen[statement] = wrapper_seen.get(statement, 0) + 1
            require(wrapper_seen[statement] <= connects + 1, "duplicate pg_restore wrapper")
            continue
        if statement.startswith("CREATE DATABASE "):
            create = re.fullmatch(
                rf"CREATE DATABASE (?P<database>{IDENTIFIER}) WITH TEMPLATE = template0 ENCODING = 'UTF8'"
                r"(?: LOCALE_PROVIDER = (?:libc|icu|builtin))?"
                r"(?:(?: LOCALE| LC_COLLATE| LC_CTYPE| ICU_LOCALE| BUILTIN_LOCALE| COLLATION_VERSION) = '[A-Za-z0-9_.@+-]{1,128}')+;",
                statement,
            )
            require(create is not None and identifier(create["database"]) == database,
                    "unapproved database identity, encoding, or locale creation wrapper")
            create_seen += 1
            continue
        match = SETTING_RE.fullmatch(statement)
        require(match is not None, "unapproved SQL in DATABASE PROPERTIES")
        role = role_name(identifier(match["role"]))
        require(identifier(match["database"]) == database, "role setting targets another database")
        require(role not in target_roles and role != target_admin, "source role collides with restore identity")
        setting, value = match["setting"], match["value"]
        approved_values = {
            ("search_path", "'pg_catalog', 'public'"): "search_path=pg_catalog, public",
            ("search_path", "'public'"): "search_path=public",
            ("role", "'simsa_migrator'"): "role=simsa_migrator",
        }
        require((setting, value) in approved_values, "unapproved role setting value")
        role_settings = source_settings.setdefault(role, {})
        require(setting not in role_settings, "duplicate role setting")
        role_settings[setting] = approved_values[(setting, value)]
    require(create_seen == 1, "exactly one validated CREATE DATABASE wrapper is required")
    require(all(wrapper_seen.get(statement) == connects + 1
                for statement in WRAPPERS - {"SET transaction_timeout = 0;"})
            and wrapper_seen.get("SET transaction_timeout = 0;", connects + 1) == connects + 1,
            "missing or truncated pg_restore session wrappers")
    if not properties_present:
        require(not source_settings, "pre_migration SQL contains properties absent from the TOC")
        return build_plan(text, database, target_admin, target_roles, schema_profile, {})
    require(len(source_settings) == 7 and sum(map(len, source_settings.values())) == 8,
            "exactly seven source roles and eight bootstrap settings are required")
    migrators = [role for role, settings in source_settings.items() if "role" in settings]
    require(len(migrators) == 1, "exactly one source migrator is required")
    for role, settings in source_settings.items():
        expected = ({"search_path": "search_path=public", "role": "role=simsa_migrator"}
                    if role == migrators[0] else {"search_path": "search_path=pg_catalog, public"})
        require(settings == expected, "source settings differ from canonical bootstrap")
    projects = []
    runtime_roles = []
    for prefix in ("simsa-api-runtime", "simsa-event-runtime", "simsa-malware-worker", "simsa-final-cleanup"):
        matches = [role for role in source_settings if role.startswith(prefix + "@")]
        require(len(matches) == 1, "missing or duplicate canonical source runtime principal")
        match = re.fullmatch(re.escape(prefix) + r"@([a-z][a-z0-9-]{4,28}[a-z0-9])[.]iam", matches[0])
        require(match is not None, "invalid source IAM principal")
        projects.append(match[1])
        runtime_roles.append(matches[0])
    require(len(set(projects)) == 1, "source runtime principals span different projects")
    require(migrators[0] not in runtime_roles, "runtime principal cannot be source migrator")
    return build_plan(text, database, target_admin, target_roles, schema_profile, source_settings)


def build_plan(text: str, database: str, target_admin: str, target_roles: list[str],
               schema_profile: str, source_settings: dict) -> dict:
    return {
        "version": 1,
        "database": database,
        "schema_profile": schema_profile,
        "target_admin": target_admin,
        "target_roles": sorted(target_roles),
        "source_roles": {role: sorted(settings.values()) for role, settings in sorted(source_settings.items())},
        "properties_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
    }


def sql_prelude(plan: dict) -> str:
    sources = ", ".join(literal(role) for role in plan["source_roles"])
    targets = ", ".join(literal(role) for role in plan["target_roles"])
    return f"""\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = pg_catalog;
DO $simsa_restore_aliases$
DECLARE
  source_roles constant text[] := ARRAY[{sources}]::text[];
  target_roles constant text[] := ARRAY[{targets}];
  expected_database constant text := {literal(plan['database'])};
  expected_admin constant text := {literal(plan['target_admin'])};
  source_role text;
BEGIN
  IF current_database() <> 'postgres' OR session_user <> expected_admin
     OR current_user <> expected_admin
     OR NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'alias lifecycle requires the exact disposable restore administrator on postgres';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ANY(target_roles)
      AND (NOT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole
           OR rolreplication OR rolbypassrls))
     OR (SELECT count(*) FROM pg_roles WHERE rolname = ANY(target_roles)) <> 7 THEN
    RAISE EXCEPTION 'restore principals are missing or have unsafe attributes';
  END IF;
"""


def prepare_sql(plan: dict) -> str:
    return sql_prelude(plan) + """  IF EXISTS (SELECT 1 FROM pg_database WHERE datname = expected_database) THEN
    RAISE EXCEPTION 'restore target database must be absent; never overwrite a failed drill';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ANY(source_roles)) THEN
    RAISE EXCEPTION 'source aliases must all be absent; never reuse existing roles';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members membership JOIN pg_roles principal
      ON principal.oid IN (membership.member, membership.roleid, membership.grantor)
      WHERE principal.rolname = ANY(target_roles)) THEN
    RAISE EXCEPTION 'restore principal membership is not initially empty';
  END IF;
  FOREACH source_role IN ARRAY source_roles LOOP
    EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1 PASSWORD NULL', source_role);
  END LOOP;
END
$simsa_restore_aliases$;
COMMIT;
"""


def cleanup_sql(plan: dict) -> str:
    expected_rows = ",\n      ".join(
        "(" + literal(role) + ", " + literal(setting) + ")"
        for role, settings in plan["source_roles"].items() for setting in settings
    )
    expected_query = "VALUES\n      " + expected_rows if expected_rows else "SELECT NULL::text, NULL::text WHERE false"
    return sql_prelude(plan) + f"""  IF NOT EXISTS (SELECT 1 FROM pg_database
      WHERE datname = expected_database AND pg_get_userbyid(datdba) = expected_admin) THEN
    RAISE EXCEPTION 'restored database is absent or not owned by the restore administrator';
  END IF;
  IF (SELECT count(*) FROM pg_authid WHERE rolname = ANY(source_roles)) <> {len(plan['source_roles'])}
     OR EXISTS (SELECT 1 FROM pg_authid WHERE rolname = ANY(source_roles)
       AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole
            OR rolreplication OR rolbypassrls OR rolconnlimit <> -1
            OR rolpassword IS NOT NULL OR rolvaliduntil IS NOT NULL)) THEN
    RAISE EXCEPTION 'source alias attributes drifted; refusing reset or removal';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members membership JOIN pg_roles alias
      ON alias.oid IN (membership.member, membership.roleid, membership.grantor)
      WHERE alias.rolname = ANY(source_roles))
     OR EXISTS (SELECT 1 FROM pg_shdepend dependency JOIN pg_roles alias
       ON dependency.refclassid = 'pg_authid'::regclass AND dependency.refobjid = alias.oid
       WHERE alias.rolname = ANY(source_roles))
     OR EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename = ANY(source_roles)) THEN
    RAISE EXCEPTION 'source aliases acquired membership, ownership, privileges, or sessions';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting settings JOIN pg_roles alias ON alias.oid = settings.setrole
      WHERE alias.rolname = ANY(source_roles)
        AND settings.setdatabase <> (SELECT oid FROM pg_database WHERE datname = expected_database)) THEN
    RAISE EXCEPTION 'source aliases acquired settings outside the restored database';
  END IF;
  IF EXISTS (
    WITH expected(role_name, setting) AS (
      {expected_query}
    ), actual AS (
      SELECT alias.rolname::text AS role_name, setting
      FROM pg_db_role_setting settings
      LEFT JOIN pg_roles alias ON alias.oid = settings.setrole
      CROSS JOIN LATERAL unnest(settings.setconfig) AS setting
      WHERE settings.setdatabase = (SELECT oid FROM pg_database WHERE datname = expected_database)
    ), differences AS (
      (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
    ) SELECT 1 FROM differences
  ) THEN
    RAISE EXCEPTION 'restored database role properties differ from the validated archive';
  END IF;
  FOREACH source_role IN ARRAY source_roles LOOP
    EXECUTE format('ALTER ROLE %I IN DATABASE %I RESET ALL', source_role, expected_database);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting settings JOIN pg_roles alias ON alias.oid = settings.setrole
      WHERE alias.rolname = ANY(source_roles)) THEN
    RAISE EXCEPTION 'source alias settings remain after reset';
  END IF;
  FOREACH source_role IN ARRAY source_roles LOOP
    EXECUTE format('DROP ROLE %I', source_role);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ANY(source_roles)) THEN
    RAISE EXCEPTION 'source aliases remain after cleanup';
  END IF;
END
$simsa_restore_aliases$;
COMMIT;
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    toc = commands.add_parser("select-toc")
    toc.add_argument("--database", required=True)
    toc.add_argument("--schema-profile", required=True, choices=["pre_migration", "post_migration"])
    toc.add_argument("--input", required=True, type=Path)
    toc.add_argument("--output", required=True, type=Path)
    prepare = commands.add_parser("prepare")
    prepare.add_argument("--database", required=True)
    prepare.add_argument("--schema-profile", required=True, choices=["pre_migration", "post_migration"])
    prepare.add_argument("--target-admin", required=True)
    prepare.add_argument("--target-role", required=True, action="append")
    prepare.add_argument("--input", required=True, type=Path)
    prepare.add_argument("--toc-input", required=True, type=Path)
    prepare.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.command == "select-toc":
            selected = select_toc(read_metadata(args.input, 4 * 1024 * 1024), args.database, args.schema_profile)
            with args.output.open("x", encoding="utf-8", newline="\n") as output:
                output.write(selected)
        else:
            selected = select_toc(read_metadata(args.toc_input, 4 * 1024 * 1024), args.database, args.schema_profile)
            plan = parse_properties(read_metadata(args.input, 64 * 1024), args.database,
                                    args.target_admin, args.target_role, args.schema_profile,
                                    properties_present=not selected.startswith(";"))
            args.output_dir.mkdir(mode=0o700, parents=True, exist_ok=False)
            for name, value in {
                "aliases.json": json.dumps(plan, indent=2) + "\n",
                "prepare-aliases.sql": prepare_sql(plan),
                "cleanup-aliases.sql": cleanup_sql(plan),
            }.items():
                with (args.output_dir / name).open("x", encoding="utf-8", newline="\n") as output:
                    output.write(value)
        print("restore role-alias metadata validation passed")
    except (ValueError, UnicodeError, OSError) as exc:
        parser.exit(1, f"restore role-alias validation failed: {exc}\n")


if __name__ == "__main__":
    main()
