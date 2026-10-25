#!/usr/bin/env python3
"""No database/cloud access: prove release gates follow additions to the journal."""
import contextlib
import copy
import io
import json
from pathlib import Path
import runpy
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / ".github/scripts/build-migration-manifest.py"
CODE = runpy.run_path(str(SCRIPT))


class MigrationManifestTests(unittest.TestCase):
    def test_summary_rejects_stale_count_timestamp_hash_and_missing_verification(self):
        summary = {"database_journal": {"count": len(CODE["manifest"]),
                   "latest_created_at": CODE["manifest"][-1]["created_at"]},
                   "migration_manifest_verified": True,
                   "migration_manifest_sha256": CODE["manifest_sha256"]()}
        CODE["verify_journal_summary"](summary)
        for key, value in (("count", 34), ("count", len(CODE["manifest"]) - 1),
                           ("latest_created_at", CODE["manifest"][-2]["created_at"])):
            bad = copy.deepcopy(summary)
            bad["database_journal"][key] = value
            with self.assertRaises(ValueError):
                CODE["verify_journal_summary"](bad)
        for key, value in (("migration_manifest_sha256", "0" * 64),
                           ("migration_manifest_verified", False)):
            with self.assertRaises(ValueError):
                CODE["verify_journal_summary"]({**summary, key: value})

    def test_workflow_validator_rejects_literal_or_missing_release_gate(self):
        path = "maintenance-evidence/maintenance-summary.json"
        good = f"python3 .github/scripts/build-migration-manifest.py --verify-journal-summary {path}"
        CODE["validate_gate_binding"](good, path)
        for mutation in ("", "# " + good, good + "\njq -e '.database_journal.count == 34'",
                         good + "\njq -e '.journal.latest_created_at == 1788060600000'"):
            with self.assertRaises(ValueError):
                CODE["validate_gate_binding"](mutation, path)
        CODE["check_gate_bindings"]()

    def test_next_migration_advances_all_manifest_consumers_without_a_release_number_edit(self):
        with tempfile.TemporaryDirectory(prefix="simsa-migration-manifest-") as folder:
            root = Path(folder)
            script = root / ".github/scripts/build-migration-manifest.py"
            script.parent.mkdir(parents=True)
            shutil.copyfile(SCRIPT, script)
            migrations = root / "backend/src/db/migrations"
            shutil.copytree(ROOT / "backend/src/db/migrations", migrations)
            journal_file = migrations / "meta/_journal.json"
            journal = json.loads(journal_file.read_text(encoding="utf-8"))
            idx = len(journal["entries"])
            tag = f"{idx:04d}_synthetic_future_migration"
            timestamp = journal["entries"][-1]["when"] + 600000
            journal["entries"].append({"idx": idx, "tag": tag, "when": timestamp})
            (migrations / (tag + ".sql")).write_text("SELECT 1;\n", encoding="utf-8")
            journal_file.write_text(json.dumps(journal), encoding="utf-8")
            future = runpy.run_path(str(script))
            self.assertEqual(len(future["manifest"]), idx + 1)
            future["verify_journal_summary"]({"journal": {"count": idx + 1, "latest_created_at": timestamp},
                                              "migration_manifest_verified": True})
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                future["emit_fixture_sql"]("post_migration")
            self.assertIn(tag, output.getvalue())
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                future["emit_fixture_sql"]("pre_migration")
            self.assertNotIn(tag, output.getvalue())
            upgrade = future["profile_manifest"]("pre_upgrade_0038")
            self.assertEqual(upgrade[-1]["tag"], "0038_arsip_direct_upload")
            self.assertEqual(upgrade, future["manifest"][:39])
            with self.assertRaises(ValueError):
                future["profile_manifest"]("pre_upgrade_0037")
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                future["emit_fixture_sql"]("pre_upgrade_0038")
            self.assertIn("0038_arsip_direct_upload", output.getvalue())
            self.assertNotIn("0039_shared_rate_limits", output.getvalue())
            self.assertNotIn(tag, output.getvalue())
            for mutation in ("duplicate_timestamp", "reordered_index"):
                bad = copy.deepcopy(journal)
                if mutation == "duplicate_timestamp":
                    bad["entries"][-1]["when"] = bad["entries"][-2]["when"]
                else:
                    bad["entries"][-1]["idx"] = 0
                journal_file.write_text(json.dumps(bad), encoding="utf-8")
                with self.assertRaises(SystemExit):
                    runpy.run_path(str(script))


if __name__ == "__main__":
    unittest.main()
