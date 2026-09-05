#!/usr/bin/env python3
"""Offline fail-closed regression cases for disposable restore aliases."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location(
    "restore_aliases", Path(__file__).with_name("prepare-restore-role-aliases.py")
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

DATABASE = "simsa_archive"
ADMIN = "simsa_restore"
TARGETS = [
    "simsa-api-runtime@simsa-restore-drill.iam",
    "simsa-event-runtime@simsa-restore-drill.iam",
    "simsa-malware-worker@simsa-restore-drill.iam",
    "simsa-final-cleanup@simsa-restore-drill.iam",
    "simsa_restore_maintenance", "simsa_restore_migrator", "simsa_restore_backup",
]
SOURCES = [
    "simsa-api-runtime@simsa-source-project.iam",
    "simsa-event-runtime@simsa-source-project.iam",
    "simsa-malware-worker@simsa-source-project.iam",
    "simsa-final-cleanup@simsa-source-project.iam",
    "source_maintenance", "source_migrator", "source_backup",
]
PROPERTIES = [
    f'ALTER ROLE "{role}" IN DATABASE {DATABASE} SET search_path TO '
    + ("'public';" if role == SOURCES[5] else "'pg_catalog', 'public';")
    for role in SOURCES
] + [f'ALTER ROLE "{SOURCES[5]}" IN DATABASE {DATABASE} SET role TO \'simsa_migrator\';']


def sql(properties: list[str] | None = None, present: bool = True) -> str:
    reconnect = ["\\unrestrict A1b2C3", f"\\connect {DATABASE}", "\\restrict A1b2C3", *sorted(MODULE.WRAPPERS)]
    return "\n".join([
        "--", "-- PostgreSQL database dump", "--", "",
        "\\restrict A1b2C3", *sorted(MODULE.WRAPPERS),
        f"-- Name: {DATABASE}; Type: DATABASE; Schema: -; Owner: -",
        f"CREATE DATABASE {DATABASE} WITH TEMPLATE = template0 ENCODING = 'UTF8' LOCALE_PROVIDER = libc LOCALE = 'C';",
        *reconnect,
        *([f"-- Name: {DATABASE}; Type: DATABASE PROPERTIES; Schema: -; Owner: -",
           *(PROPERTIES if properties is None else properties), *reconnect] if present else []),
        "-- PostgreSQL database dump complete", "\\unrestrict A1b2C3", "",
    ])


def parse(value: str | None = None, **kwargs) -> dict:
    return MODULE.parse_properties(value if value is not None else sql(), DATABASE,
                                   kwargs.get("admin", ADMIN), kwargs.get("targets", TARGETS),
                                   kwargs.get("profile", "post_migration"),
                                   properties_present=kwargs.get("present", True))


def toc(extra: str = "") -> str:
    return (
        "; Archive created at fixture time\n"
        f";     dbname: {DATABASE}\n;     TOC Entries: 6\n"
        f"1; 1262 123 DATABASE - {DATABASE} source_admin\n"
        f"2; 0 0 DATABASE PROPERTIES - {DATABASE} source_admin\n"
        "3; 1259 456 TABLE public users simsa_migrator\n" + extra
    )


class RoleAliasTests(unittest.TestCase):
    def test_metadata_bytes_are_strict_and_bounded(self):
        with tempfile.TemporaryDirectory(prefix="simsa-alias-metadata-") as directory:
            path = Path(directory) / "metadata.sql"
            for value in [b"invalid utf8: \xff\n", b"nul\0byte\n", b"bare\rcarriage\n"]:
                path.write_bytes(value)
                with self.subTest(value=value), self.assertRaises((ValueError, UnicodeError)):
                    MODULE.read_metadata(path, 1024)
            path.write_bytes(b"safe\r\n")
            self.assertEqual(MODULE.read_metadata(path, 1024), "safe\n")
            with self.assertRaises(ValueError):
                MODULE.read_metadata(path, 1)

    def test_exact_toc_selection(self):
        self.assertEqual(MODULE.select_toc(toc(), DATABASE),
                         f"2; 0 0 DATABASE PROPERTIES - {DATABASE} source_admin\n")

    def test_invalid_toc_cases(self):
        cases = [
            "", toc().rstrip(), toc().replace("2;", "1;"),
            toc().replace("DATABASE PROPERTIES", "ACL"),
            toc().replace(f"DATABASE - {DATABASE}", "DATABASE - another_db"),
            toc().replace(f"PROPERTIES - {DATABASE}", "PROPERTIES - another_db"),
            toc(f"4; 0 0 DATABASE PROPERTIES - {DATABASE} source_admin\n"),
            toc("malformed non-comment TOC line\n"),
        ]
        for case in cases:
            with self.subTest(case=case), self.assertRaises(ValueError):
                MODULE.select_toc(case, DATABASE)

    def test_canonical_both_migration_profiles(self):
        for profile in ["pre_migration", "post_migration"]:
            with self.subTest(profile=profile):
                result = parse(profile=profile)
                self.assertEqual(len(result["source_roles"]), 7)
                self.assertEqual(sum(map(len, result["source_roles"].values())), 8)
                self.assertEqual(result["schema_profile"], profile)

    def test_pre_migration_without_properties_requires_complete_toc(self):
        empty = toc().replace(f"2; 0 0 DATABASE PROPERTIES - {DATABASE} source_admin\n", "").replace("TOC Entries: 6", "TOC Entries: 5")
        self.assertTrue(MODULE.select_toc(empty, DATABASE, "pre_migration").startswith(";"))
        with self.assertRaises(ValueError):
            MODULE.select_toc(empty, DATABASE, "post_migration")
        with self.assertRaises(ValueError):
            MODULE.select_toc(empty.replace("TOC Entries: 5", "TOC Entries: 6"), DATABASE, "pre_migration")
        plan = parse(sql(present=False), profile="pre_migration", present=False)
        self.assertEqual(plan["source_roles"], {})
        self.assertIn("ARRAY[]::text[]", MODULE.prepare_sql(plan))
        self.assertIn("SELECT NULL::text, NULL::text WHERE false", MODULE.cleanup_sql(plan))
        with self.assertRaises(ValueError):
            parse(sql(present=False), present=False)
        with self.assertRaises(ValueError):
            parse(sql(), profile="pre_migration", present=False)

    def test_unquoted_source_principals_and_quoted_database(self):
        value = sql().replace('"source_backup"', 'source_backup').replace(
            f"IN DATABASE {DATABASE}", f'IN DATABASE "{DATABASE}"')
        self.assertEqual(len(parse(value)["source_roles"]), 7)

    def test_no_restrict_wrapper_for_older_supported_client(self):
        value = sql().replace("\\restrict A1b2C3\n", "").replace("\\unrestrict A1b2C3\n", "")
        self.assertEqual(len(parse(value)["source_roles"]), 7)

    def test_truncation_and_missing_headers(self):
        cases = ["", sql().rstrip(), sql().replace("-- PostgreSQL database dump complete", ""),
                 sql().replace("-- PostgreSQL database dump\n", ""),
                 sql().replace("Type: DATABASE PROPERTIES;", "Type: DATABASE;"),
                 sql().replace("\\unrestrict A1b2C3", ""),
                 sql().replace("\\unrestrict A1b2C3", "\\unrestrict OtherKey")]
        for case in cases:
            with self.subTest(case=case), self.assertRaises(ValueError):
                parse(case)

    def test_missing_extra_duplicate_and_changed_properties(self):
        cases = [
            PROPERTIES[:-1], PROPERTIES[1:], PROPERTIES + [PROPERTIES[0]], [],
            PROPERTIES + [f'ALTER ROLE extra_role IN DATABASE {DATABASE} SET search_path TO \'public\';'],
            [line.replace("'pg_catalog', 'public'", "'public', 'pg_catalog'") for line in PROPERTIES],
            [line.replace("'simsa_migrator'", "'pg_read_all_data'") for line in PROPERTIES],
            [line.replace("IN DATABASE simsa_archive", "IN DATABASE other_database") for line in PROPERTIES],
            [line.replace("SET search_path", "SET session_preload_libraries") for line in PROPERTIES],
            [line.replace("source_migrator", SOURCES[0]) for line in PROPERTIES],
        ]
        for case in cases:
            with self.subTest(case=case), self.assertRaises(ValueError):
                parse(sql(case))

    def test_unapproved_sql_and_psql_commands(self):
        for extra in ["SELECT 1;", "DROP ROLE source_backup;", "\\! touch ignored",
                      "ALTER DATABASE simsa_archive SET log_statement TO 'all';",
                      "/* hidden statement */", "RESET ALL;", "SET statement_timeout = 1;"]:
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                parse(sql(PROPERTIES + [extra]))

    def test_protected_names_and_target_collisions(self):
        for name in [*MODULE.PROTECTED_ROLES, "pg_read_all_data", "PG_superuser", "cloudsqlagent",
                     "azure_anything", "rds_example", ADMIN, *TARGETS, "bad role", "x" * 64, "bad'quote"]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                parse(sql().replace("source_backup", name))

    def test_source_projects_and_runtime_roles_must_be_canonical(self):
        cases = [sql().replace(SOURCES[0], "arbitrary_runtime"),
                 sql().replace(SOURCES[0], "simsa-api-runtime@another-project.iam"),
                 sql().replace(SOURCES[0], "simsa-api-runtime@bad_project.iam")]
        for case in cases:
            with self.subTest(case=case), self.assertRaises(ValueError):
                parse(case)

    def test_create_and_connect_wrappers_cannot_introduce_other_sql(self):
        for value in [sql().replace(f"CREATE DATABASE {DATABASE}", "CREATE DATABASE unexpected"),
                      sql().replace("LOCALE = 'C';", "LOCALE = 'C'; DROP DATABASE other;"),
                      sql().replace(f"\\connect {DATABASE}", "\\connect other_database"),
                      sql().replace("LOCALE = 'C';", "LOCALE = 'C' OWNER postgres;"),
                      sql().replace("ENCODING = 'UTF8'", "ENCODING = 'SQL_ASCII'"),
                      sql().replace("SET row_security = off;\n", "", 1)]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse(value)

    def test_target_inputs_are_exact(self):
        for targets in [TARGETS[:-1], TARGETS + ["extra"], [TARGETS[0]] * 7,
                        TARGETS[:-1] + ["pg_read_all_data"], TARGETS[:-1] + [ADMIN]]:
            with self.subTest(targets=targets), self.assertRaises(ValueError):
                parse(targets=targets)
        with self.assertRaises(ValueError):
            parse(profile="auto")

    def test_generated_sql_is_transactional_and_never_grants_source_authority(self):
        plan = parse()
        prepare = MODULE.prepare_sql(plan)
        cleanup = MODULE.cleanup_sql(plan)
        for value in [prepare, cleanup]:
            self.assertIn("BEGIN;", value)
            self.assertTrue(value.endswith("COMMIT;\n"))
            self.assertIn("session_user <> expected_admin", value)
            self.assertNotIn("CASCADE", value)
            self.assertNotIn("GRANT ", value)
        for guard in ["source aliases must all be absent", "NOLOGIN NOINHERIT NOSUPERUSER",
                      "PASSWORD NULL", "restore target database must be absent"]:
            self.assertIn(guard, prepare)
        for guard in ["pg_authid", "pg_auth_members", "pg_shdepend", "pg_stat_activity",
                      "EXCEPT ALL", "RESET ALL", "DROP ROLE %I", "rolpassword IS NOT NULL"]:
            self.assertIn(guard, cleanup)
        # PostgreSQL stores database/global settings in pg_db_role_setting;
        # rolconfig is a pg_roles view column, not a physical pg_authid column.
        self.assertNotIn("rolconfig", cleanup)
        self.assertIn("settings.setdatabase <>", cleanup)
        self.assertLess(cleanup.index("source alias attributes drifted"), cleanup.index("RESET ALL"))
        self.assertLess(cleanup.index("RESET ALL"), cleanup.index("DROP ROLE %I"))


if __name__ == "__main__":
    unittest.main()
