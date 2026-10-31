#!/usr/bin/env python3
"""No database/cloud access: prove the manifest and profiles follow additions to the journal."""
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
            self.assertEqual(future["manifest"][-1]["created_at"], timestamp)
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
