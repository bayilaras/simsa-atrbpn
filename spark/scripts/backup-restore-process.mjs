import { resolve, isAbsolute, dirname } from "node:path";
import { open, realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { restoreArchive, verifyRestoredSnapshot, PartialRestoreError } from "./backup-emulator.mjs";
import { openArchive } from "./backup-archive.mjs";
import { readRegularFile } from "./backup-private-files.mjs";

export async function restoreFromFiles(archivePath, keyPath, reportPath) {
  if (new Set([archivePath, keyPath, reportPath].map(value => resolve(value))).size !== 3)
    throw new Error("Archive, recovery key and report must use distinct paths");
  const bytes = await readRegularFile(archivePath, 17 * 1024 * 1024);
  const key = await readRegularFile(keyPath, 32);
  let reportFile;
  try {
    if (key.length !== 32) throw new Error("Recovery key must contain exactly 32 bytes");
    const snapshot = openArchive(bytes, key);
    if (!isAbsolute(reportPath) || reportPath.startsWith("\\\\") || reportPath.startsWith("//") || await realpath(dirname(reportPath)) !== resolve(dirname(reportPath)))
      throw new Error("Report must use a canonical absolute local directory");
    // Reserve a new report before touching the destination. Never overwrite an
    // existing report or discover an unwritable report directory after restore.
    reportFile = await open(reportPath, "wx", 0o600);
    const restored = await restoreArchive(bytes, key);
    const verification = await verifyRestoredSnapshot(snapshot);
    const report = {
      scope: "local-synthetic-only", independentProcess: true,
      restored, verification, productionReady: false, liveRestorePerformed: false,
      completedAt: new Date().toISOString(),
    };
    await reportFile.writeFile(JSON.stringify(report, null, 2) + "\n");
    return report;
  } catch (error) {
    if (reportFile) {
      const partial = error instanceof PartialRestoreError ? {
        phase: error.report.phase, createdAccounts: error.report.createdAccounts,
        createdDocuments: error.report.createdDocuments, attemptedAccounts: error.report.attemptedAccounts,
        attemptedDocuments: error.report.attemptedDocuments, writesMayHaveOccurred: error.report.writesMayHaveOccurred,
        failureCode: error.report.failureCode,
      } : undefined;
      const failure = Buffer.from(JSON.stringify({ scope: "local-synthetic-only", status: "failed", productionReady: false,
        automaticCleanup: false, partial, note: "The target may be partial while emulators are running. Launcher shutdown discards emulator state; only report/artifact files persist. Accounts are never enabled by this tool." }) + "\n");
      await reportFile.truncate(0);
      const { bytesWritten } = await reportFile.write(failure, 0, failure.length, 0);
      if (bytesWritten !== failure.length) throw new Error("Failed to finish the partial-restore report");
    }
    throw error;
  } finally { key.fill(0); await reportFile?.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 5) throw new Error("Use backup-restore-process.mjs <archive> <separate-key-file> <new-report-file>; emulator only");
    await restoreFromFiles(...process.argv.slice(2));
    console.log("Independent emulator restore and full-data comparison passed; restored accounts remain disabled.");
  } catch (error) {
    console.error(`Emulator restore failed: ${error.message}. No overwrite was attempted; launcher shutdown discards in-memory emulator state.`);
    process.exitCode = 1;
  }
}
