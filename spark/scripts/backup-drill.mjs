import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sealArchive, openArchive, buildManifest } from "./backup-archive.mjs";
import { readSnapshot, restoreArchive, assertEmptyEmulatorProject, verifyRestoredSnapshot } from "./backup-emulator.mjs";
import { createPrivateRunDirectory, writeNewFile, readRegularFile } from "./backup-private-files.mjs";

const project = "demo-simsa-spark-backup";
const sparkRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const str = value => ({ stringValue: value });
const bool = value => ({ booleanValue: value });
const at = value => ({ timestampValue: value });
const integer = value => ({ integerValue: String(value) });

async function sourcePost(resource, body, kind = "firestore") {
  const origin = kind === "auth" ? "http://127.0.0.1:9098" : "http://127.0.0.1:8088";
  if (!resource.startsWith(`/v1/projects/${project}/`)) throw new Error("Only the fixed source fixture namespace is writable");
  const response = await fetch(`${origin}${kind === "auth" ? "/identitytoolkit.googleapis.com" : ""}${resource}`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Synthetic fixture create failed (${response.status}); existing state preserved`);
  const result = await response.json();
  if (result.error?.length || result.errors?.length) throw new Error("Synthetic account import returned item errors");
  return result;
}

async function sourceDocument(path, fields) {
  const segments = path.split("/");
  const id = segments.pop();
  return sourcePost(`/v1/projects/${project}/databases/(default)/documents/${segments.join("/")}?documentId=${encodeURIComponent(id)}`, { fields });
}

async function createSyntheticSource() {
  const users = Array.from({ length: 55 }, (_, index) => ({
    localId: `backup-user-${String(index).padStart(3, "0")}`,
    email: `user-${index}@example.test`, emailVerified: true, disabled: index === 3,
    displayName: `Pengguna sintetis ${index}`,
    ...(index === 0 ? {
      providerUserInfo: [{ providerId: "google.com", rawId: "google-synthetic-000", email: "user-0@example.test", displayName: "Pengguna sintetis 0" }],
      customAttributes: JSON.stringify({ pilot: true, tags: ["synthetic", "backup"] }),
    } : {}),
  }));
  await sourcePost(`/v1/projects/${project}/accounts:batchCreate`, { users, allowOverwrite: false, sanityCheck: true }, "auth");
  for (const unit of ["unit-a", "unit-b"])
    await sourceDocument(`sparkUnits/${unit}`, { name: str(`Unit sintetis ${unit}`) });
  for (const [index, user] of users.entries())
    await sourceDocument(`sparkUsers/${user.localId}`, {
      displayName: str(user.displayName), unitId: str(index === 54 ? "unit-b" : "unit-a"),
      role: str(index === 0 ? "operator" : "viewer"), active: bool(index !== 3),
    });
  for (let index = 0; index < 55; index++)
    await sourceDocument(`sparkUnits/unit-a/classifications/class-${String(index).padStart(3, "0")}`, {
      code: str(`SYN.${index}`), name: str(`Klasifikasi sintetis ${index}`), active: bool(true),
    });
  await sourceDocument("sparkUnits/unit-b/classifications/class-000", { code: str("SYN.B"), name: str("Klasifikasi Unit B"), active: bool(true) });
  for (const unit of ["unit-a", "unit-b"])
    await sourceDocument(`sparkUnits/${unit}/locations/rack-a`, { name: str("Rak sintetis A"), description: str("Bukan arsip asli"), active: bool(true) });
  const record = (index, version) => ({
    title: str(`Arsip sintetis ${index} revisi ${Math.min(version, 54)}`),
    referenceNumber: str(`SYN-${String(index).padStart(3, "0")}`),
    recordDate: str("2026-09-07"), classificationId: str("class-000"), locationId: str("rack-a"),
    description: str("Data fiktif untuk restore drill, bukan arsip asli."),
    status: str(version === 55 ? "archived" : version === 1 ? "draft" : "active"),
    archiveReason: str(version === 55 ? "Penutupan sintetis untuk pengujian" : ""),
    unitId: str("unit-a"), createdBy: str(users[0].localId), updatedBy: str(users[0].localId),
    createdAt: at("2026-09-07T12:00:01.123456789Z"),
    updatedAt: at(`2026-09-07T12:00:${String(version).padStart(2, "0")}.123456789Z`),
    version: integer(version),
  });
  for (let index = 0; index < 56; index++) {
    const path = `sparkUnits/unit-a/records/record-${String(index).padStart(3, "0")}`;
    const versions = index === 55 ? 55 : 1;
    await sourceDocument(path, record(index, versions));
    for (let version = 1; version <= versions; version++) {
      const fields = record(index, version);
      await sourceDocument(`${path}/history/v${version}`, {
        snapshot: { mapValue: { fields } }, actorUid: str(users[0].localId), at: fields.updatedAt,
      });
    }
  }
}

async function independentRestore(archivePath, keyPath, reportPath) {
  await new Promise((resolveDone, reject) => {
    const child = spawn(process.execPath, [join(sparkRoot, "scripts/backup-restore-process.mjs"), archivePath, keyPath, reportPath], {
      cwd: sparkRoot, env: process.env, stdio: ["ignore", "inherit", "inherit"], windowsHide: true, shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolveDone() : reject(new Error(`Independent restore process failed (${code ?? signal})`)));
  });
}

export async function runBackupDrill() {
  if (process.versions.node.split(".")[0] !== "24") throw new Error("Node.js 24 is required");
  // The adapter checks fixed hosts, project IDs, credentials and hub before any
  // fixture write. No export/import of existing user emulators is supported.
  await assertEmptyEmulatorProject("source");
  await assertEmptyEmulatorProject("restore");
  const directory = await createPrivateRunDirectory();
  console.log(`Private synthetic drill directory: ${directory}`);
  const artifacts = join(directory, "artifacts"), recovery = join(directory, "recovery");
  await mkdir(artifacts, { mode: 0o700 });
  await mkdir(recovery, { mode: 0o700 });
  const key = randomBytes(32);
  const archivePath = join(artifacts, "snapshot.simsabackup");
  const keyPath = join(recovery, "key.bin");
  const reportPath = join(directory, "restore-result.json");
  let archive;
  try {
    await createSyntheticSource();
    const snapshot = await readSnapshot();
    assert.equal(snapshot.authUsers.length, 55);
    assert.equal(snapshot.documents.filter(item => /\/records\/[^/]+$/.test(item.path)).length, 56);
    assert.equal(snapshot.documents.filter(item => item.path.includes("/record-055/history/")).length, 55);
    archive = sealArchive(snapshot, key);
    // Authentication failures must happen before even probing the destination.
    let requests = 0;
    const neverRequest = async () => { requests++; throw new Error("Invalid archive reached the network"); };
    const wrong = randomBytes(32), corrupt = Buffer.from(archive);
    corrupt[Math.floor(corrupt.length / 2)] ^= 1;
    try {
      for (const [bytes, candidate] of [[archive, wrong], [corrupt, key], [archive.subarray(0, archive.length - 1), key]])
        await assert.rejects(restoreArchive(bytes, candidate, { request: neverRequest }));
      assert.equal(requests, 0);
    } finally { wrong.fill(0); }
    assert.deepEqual(openArchive(archive, key), snapshot);
    await writeNewFile(keyPath, key);
    await writeNewFile(archivePath, archive);
    await writeNewFile(join(directory, "source-manifest.json"), JSON.stringify(buildManifest(snapshot), null, 2) + "\n");
  } finally { key.fill(0); }
  // A new process receives only authenticated ciphertext + separate key, not
  // the source snapshot or its in-memory objects. It reads only the destination.
  await independentRestore(archivePath, keyPath, reportPath);
  const restoredReport = JSON.parse(await readFile(reportPath, "utf8"));
  const verificationKey = await readRegularFile(keyPath, 32);
  let afterRefusedRepeat;
  try {
    await assert.rejects(restoreArchive(archive, verificationKey), error => error?.code === "TARGET_NOT_EMPTY");
    afterRefusedRepeat = await verifyRestoredSnapshot(openArchive(archive, verificationKey));
  } finally { verificationKey.fill(0); }
  const result = {
    scope: "local-synthetic-only", productionReady: false, liveBackupPerformed: false,
    sourceProject: project, targetProject: "demo-simsa-spark-restore",
    backupSha256: createHash("sha256").update(archive).digest("hex"),
    corruptionCasesRejectedBeforeNetwork: 3, independentRestore: restoredReport,
    repeatRestoreRefusedWithoutOverwrite: true, afterRefusedRepeat,
    archivePath, keyPath, completedAt: new Date().toISOString(),
    limitations: ["Auth metadata only; passwords, password hashes, sessions and provider tokens are excluded.",
      "Restored accounts are disabled; this is not a user-login recovery proof.",
      "Local controlled maintenance rehearsal, not a cross-service atomic online backup.",
      "Separate folders on one machine are not independent off-site key custody."],
  };
  await writeNewFile(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(`Local Spark encrypted backup and independent-process restore passed. Report: ${join(directory, "result.json")}`);
  console.log("Synthetic archive and separate private recovery key retained. No cloud project or Production data was accessed.");
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error("Use npm run backup:drill; no target or credential arguments allowed");
    await runBackupDrill();
  } catch (error) {
    console.error(`Local Spark backup drill failed: ${error.message}. Created files are retained; launcher shutdown discards emulator state. No overwrite or deletion request was issued.`);
    process.exitCode = 1;
  }
}
