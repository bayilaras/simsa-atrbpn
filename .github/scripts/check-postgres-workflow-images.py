#!/usr/bin/env python3
"""Keep CI, logical-backup clients, and disposable restores on the same major."""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SUPPORTED_IMAGES = {
    "16": "postgres:16-bookworm@sha256:bb3e1a57e5407e0a5280b4211980a5e537f4abd234a87014ac979849a78dd825",
    "17": "postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0",
    "18": "postgres:18-bookworm@sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af",
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def validate_postgres_images(backup_workflow: str, ci_workflow: str) -> None:
    selector = "${{ " + " || ".join(
        f"vars.CLOUD_SQL_BACKUP_POSTGRES_MAJOR == '{major}' && '{image}'"
        for major, image in SUPPORTED_IMAGES.items()
    ) + " || 'invalid-postgres-major' }}"
    selectors = re.findall(
        r"(?m)^\s*(?:POSTGRES_IMAGE|image): (\$\{\{ vars\.CLOUD_SQL_BACKUP_POSTGRES_MAJOR[^\n]+)$",
        backup_workflow,
    )
    require(selectors == [selector, selector],
            "backup clients and independent restore must use the exact same fail-closed image selector")
    require("EXPECTED_POSTGRES_MAJOR: ${{ vars.CLOUD_SQL_BACKUP_POSTGRES_MAJOR }}" in backup_workflow,
            "the source major must be bound to the image selection variable")
    require("require('EXPECTED_POSTGRES_MAJOR', r'(?:16|17|18)')" in backup_workflow,
            "backup target validation must allow exactly PostgreSQL 16, 17, and 18")
    require(re.search(
        r"current_setting\('server_version_num'\)::integer / 10000\s+"
        r"= :'expected_postgres_major'::integer", backup_workflow,
    ) is not None, "backup must verify the actual server major before dumping")

    matrix_job = re.search(r"(?ms)^  test:\n(.*?)(?=^  [A-Za-z0-9_-]+:\n|\Z)", ci_workflow)
    require(matrix_job is not None, "backend PostgreSQL CI matrix job is missing")
    job = matrix_job.group(0)
    entries = re.findall(
        r"(?m)^          - postgres_major: ([0-9]+)\n            postgres_image: ([^\n]+)$", job,
    )
    require(entries == list(SUPPORTED_IMAGES.items()),
            "CI must test every supported backup major with the exact same pinned image")
    require("POSTGRES_IMAGE: ${{ matrix.postgres_image }}" in job
            and "image: ${{ matrix.postgres_image }}" in job,
            "CI database service and backup/restore commands must consume the matrix image")


def main() -> None:
    validate_postgres_images(
        (ROOT / ".github/workflows/backup-cloud-sql.yml").read_text(encoding="utf-8"),
        (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8"),
    )
    print("PostgreSQL CI and backup/restore image consistency passed (16, 17, 18)")


if __name__ == "__main__":
    main()
