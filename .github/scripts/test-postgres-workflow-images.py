#!/usr/bin/env python3
"""Offline regressions for exact-major CI and Cloud SQL logical-backup images."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


SPEC = importlib.util.spec_from_file_location(
    "postgres_images", Path(__file__).with_name("check-postgres-workflow-images.py")
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
BACKUP = (MODULE.ROOT / ".github/workflows/backup-cloud-sql.yml").read_text(encoding="utf-8")
CI = (MODULE.ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")


class PostgresWorkflowImagesTests(unittest.TestCase):
    def assert_invalid(self, backup: str = BACKUP, ci: str = CI) -> None:
        with self.assertRaises(ValueError):
            MODULE.validate_postgres_images(backup, ci)

    def test_repository_uses_all_three_matching_pinned_majors(self):
        MODULE.validate_postgres_images(BACKUP, CI)

    def test_one_restore_image_cannot_drift_from_source(self):
        for major, image in MODULE.SUPPORTED_IMAGES.items():
            with self.subTest(major=major):
                self.assert_invalid(BACKUP.replace(image, MODULE.SUPPORTED_IMAGES["16" if major != "16" else "17"], 1))

    def test_mutable_alpine_or_unknown_digest_is_rejected(self):
        image = MODULE.SUPPORTED_IMAGES["18"]
        for replacement in ("postgres:18-bookworm", image.replace("bookworm", "alpine"),
                            "postgres:18-bookworm@sha256:" + "a" * 64):
            with self.subTest(image=replacement):
                self.assert_invalid(BACKUP.replace(image, replacement))

    def test_unknown_major_must_fail_instead_of_falling_back(self):
        self.assert_invalid(BACKUP.replace("'invalid-postgres-major'", repr(MODULE.SUPPORTED_IMAGES["18"])))

    def test_every_supported_major_must_be_validated(self):
        for pattern in ("(?:16|17)", "(?:16|17|18|19)", "[0-9]+"):
            with self.subTest(pattern=pattern):
                self.assert_invalid(BACKUP.replace("(?:16|17|18)", pattern))

    def test_expected_major_cannot_be_hardcoded(self):
        self.assert_invalid(BACKUP.replace(
            "EXPECTED_POSTGRES_MAJOR: ${{ vars.CLOUD_SQL_BACKUP_POSTGRES_MAJOR }}",
            "EXPECTED_POSTGRES_MAJOR: '18'",
        ))

    def test_actual_server_major_must_still_be_checked(self):
        self.assert_invalid(BACKUP.replace("= :'expected_postgres_major'::integer", ">= 16"))

    def test_ci_cannot_omit_any_supported_major(self):
        for major, image in MODULE.SUPPORTED_IMAGES.items():
            entry = f"          - postgres_major: {major}\n            postgres_image: {image}\n"
            with self.subTest(major=major):
                self.assert_invalid(ci=CI.replace(entry, ""))

    def test_ci_image_must_match_the_backup_digest(self):
        self.assert_invalid(ci=CI.replace(MODULE.SUPPORTED_IMAGES["18"], "postgres:18-bookworm@sha256:" + "b" * 64))

    def test_ci_service_and_clients_must_consume_the_matrix(self):
        for marker in ("POSTGRES_IMAGE: ${{ matrix.postgres_image }}", "image: ${{ matrix.postgres_image }}"):
            with self.subTest(marker=marker):
                self.assert_invalid(ci=CI.replace(marker, "image: postgres:17"))


if __name__ == "__main__":
    unittest.main()
