import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { sourceProbeEnvironment } from './local-current-backup-core.mjs';
import { sterileEnvironment } from './local-backup-drill-core.mjs';

// Windows-only integration suite: invokes actual PowerShell and native processes.
const repository = resolve(import.meta.dirname, '..');
const launcher = resolve(import.meta.dirname, 'windows/local-runtime.ps1');
function status(metadata) {
  const result = spawnSync(resolve(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; . $env:SIMSA_TEST_LAUNCHER; Format-LocalBackupStatus ($env:SIMSA_TEST_STATUS | ConvertFrom-Json) ([datetime]'2026-09-11T12:00:00Z')"],
    { windowsHide: true, encoding: 'utf8', env: { ...process.env, SIMSA_TEST_LAUNCHER: launcher, SIMSA_TEST_STATUS: JSON.stringify(metadata) } });
  assert.equal(result.status, 0, result.stderr); return result.stdout;
}
test('sterile identity probe launches an absolute native executable inside a PowerShell pipeline', () => {
  const env = sterileEnvironment(process.env, { privateDir: repository, pgBin: resolve(repository, 'unused'), nodePath: process.execPath });
  const result = spawnSync(resolve(env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; (& $env:SIMSA_TEST_NODE --version | Out-String).Trim()"],
    { encoding: 'utf8', windowsHide: true, env: { ...sourceProbeEnvironment(env, repository), SIMSA_TEST_NODE: process.execPath } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), process.version);
});
test('status honestly distinguishes no backup and a backup whose artifact is not verified', () => {
  assert.match(status({ format: 1 }), /belum ada backup/);
  assert.match(status({ format: 1, lastBackup: { status: 'passed', run_id: 'a', snapshot_at: '2026-09-11T10:00:00Z' } }), /belum diuji restore/);
});
test('verification of an older bundle cannot certify the latest backup', () => {
  const lastBackup = { status: 'passed', run_id: 'new', snapshot_at: '2026-09-11T10:00:00Z' };
  assert.match(status({ format: 1, lastBackup, lastVerification: { status: 'passed', run_id: 'old', at: '2026-09-11T11:00:00Z' } }), /belum diuji restore/);
  assert.match(status({ format: 1, lastBackup, lastVerification: { status: 'passed', run_id: 'new', at: '2026-09-11T11:00:00Z' } }), /restore terpisah terverifikasi/);
});
test('failure status exposes no private diagnostic and malformed timestamps never become success', () => {
  const output = status({ format: 1, lastAttempt: { status: 'failed', failure: 'PRIVATE-SECRET' } });
  assert.match(output, /terakhir gagal/); assert.doesNotMatch(output, /PRIVATE-SECRET/);
  assert.match(status({ format: 1, lastBackup: { status: 'passed', snapshot_at: 'invalid' } }), /tidak valid/);
});
