import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readRegularFile, writeNewFile, windowsSystemEnvironment } from "./backup-private-files.mjs";

test("private artifact writes are exclusive, bounded reads never accept directory or relative paths", async () => {
  // Public fixture text only; generated test directory contains no key material.
  const directory = await mkdtemp(join(tmpdir(), "simsa-spark-file-test-"));
  const filename = join(directory, "public-fixture.txt");
  await writeNewFile(filename, "public-synthetic-only");
  assert.equal((await readRegularFile(filename, 30)).toString(), "public-synthetic-only");
  await assert.rejects(writeNewFile(filename, "overwrite"), { code: "EEXIST" });
  assert.equal((await readFile(filename)).toString(), "public-synthetic-only");
  await assert.rejects(readRegularFile(filename, 2), /oversized/);
  await assert.rejects(readRegularFile(directory, 1024), /Invalid/);
  await assert.rejects(readRegularFile("relative.bin", 1024), /absolute local/);
  await assert.rejects(readRegularFile("//network/share/key.bin", 1024), /absolute local/);
  if (process.platform !== "win32") assert.equal((await lstat(filename)).mode & 0o077, 0);
});

test("backup launcher is fixed-scope and CI gates the local rehearsal", async () => {
  const source = await readFile(new URL("./emulators.mjs", import.meta.url), "utf8");
  const config = JSON.parse(await readFile(new URL("../firebase.backup-emulator.json", import.meta.url), "utf8"));
  const ci = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(source, /demo-simsa-spark-backup/);
  assert.match(source, /Emulator port.*already in use/);
  assert.match(source, /XDG_CONFIG_HOME = mkdtempSync/);
  assert.match(source, /args.push\("node scripts\/backup-drill.mjs"\)/);
  assert.equal(config.emulators.singleProjectMode, false);
  assert.deepEqual(config.emulators.firestore, { host: "127.0.0.1", port: 8088 });
  assert.deepEqual(config.emulators.auth, { host: "127.0.0.1", port: 9098 });
  assert.equal(config.hosting, undefined);
  assert.equal(config.functions, undefined);
  assert.match(ci, /run: npm run backup:drill/);
});

test("Windows ACL commands receive only fixed system module paths, no inherited secrets or user modules", () => {
  const root = process.platform === "win32" ? "C:\\Windows" : "/windows-fixture";
  const environment = windowsSystemEnvironment(root);
  assert.deepEqual(Object.keys(environment).sort(), ["PATH", "PSModulePath", "SystemRoot", "WINDIR"].sort());
  assert.equal(environment.PSModulePath, join(root, "System32", "WindowsPowerShell/v1.0/Modules"));
  assert.throws(() => windowsSystemEnvironment("relative"), /unavailable/);
});
