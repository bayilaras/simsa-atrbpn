import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { classifyAuditRun, collectAdvisories, evaluate, runAuditWithRetry, validateAllowlist } from './npm-audit-gate.mjs';

const advisory = (name, ghsa, severity) => ({
    source: 1, name, title: `${name} advisory`, severity,
    url: `https://github.com/advisories/${ghsa}`, range: '<=1.0.0',
});

const report = {
    vulnerabilities: {
        braces: { severity: 'high', via: [advisory('braces', 'GHSA-vfj7-8cjw-p6xm', 'high')] },
        micromatch: { severity: 'high', via: ['braces'] },
        uuid: { severity: 'moderate', via: [advisory('uuid', 'GHSA-aaaa-bbbb-cccc', 'moderate')] },
        tar: { severity: 'critical', via: [advisory('tar', 'GHSA-dddd-eeee-ffff', 'critical')] },
    },
};

const entry = (overrides = {}) => ({
    ghsa: 'GHSA-vfj7-8cjw-p6xm', packages: ['braces'], projects: ['docs-site'],
    reason: 'Hanya dipakai alat build situs statis; belum ada versi patch.', expires: '2026-11-03', ...overrides,
});

test('mengambil advisori langsung dan mengabaikan rujukan turunan', () => {
    const ids = collectAdvisories(report).map((a) => a.id).sort();
    assert.deepEqual(ids, ['GHSA-aaaa-bbbb-cccc', 'GHSA-dddd-eeee-ffff', 'GHSA-vfj7-8cjw-p6xm']);
});

test('tanpa allowlist, advisori high dan critical memblokir; moderate tidak', () => {
    const result = evaluate(report, { entries: [] }, 'frontend', '2026-10-03');
    assert.deepEqual(result.blocking.map((a) => a.id).sort(), ['GHSA-dddd-eeee-ffff', 'GHSA-vfj7-8cjw-p6xm']);
    assert.equal(result.allowed.length, 0);
});

test('entri aktif hanya berlaku untuk proyek yang disebut', () => {
    const allowlist = { entries: [entry()] };
    const docs = evaluate(report, allowlist, 'docs-site', '2026-10-03');
    assert.deepEqual(docs.allowed.map((a) => a.id), ['GHSA-vfj7-8cjw-p6xm']);
    assert.deepEqual(docs.blocking.map((a) => a.id), ['GHSA-dddd-eeee-ffff']);
    const frontend = evaluate(report, allowlist, 'frontend', '2026-10-03');
    assert.ok(frontend.blocking.some((a) => a.id === 'GHSA-vfj7-8cjw-p6xm'));
});

test('entri kedaluwarsa tidak lagi mengecualikan dan dilaporkan', () => {
    const result = evaluate(report, { entries: [entry({ expires: '2026-10-02' })] }, 'docs-site', '2026-10-03');
    assert.equal(result.expired.length, 1);
    assert.ok(result.blocking.some((a) => a.id === 'GHSA-vfj7-8cjw-p6xm'));
});

test('paket di luar daftar entri tetap memblokir walau GHSA sama', () => {
    const lain = { vulnerabilities: { picomatch: { severity: 'high', via: [advisory('picomatch', 'GHSA-vfj7-8cjw-p6xm', 'high')] } } };
    const result = evaluate(lain, { entries: [entry()] }, 'docs-site', '2026-10-03');
    assert.equal(result.blocking.length, 1);
});

test('allowlist tanpa alasan atau tanggal ditolak', () => {
    assert.ok(validateAllowlist({ entries: [entry({ reason: 'singkat' })] }).length > 0);
    assert.ok(validateAllowlist({ entries: [entry({ expires: 'besok' })] }).length > 0);
    assert.ok(validateAllowlist({ entries: [entry({ ghsa: 'CVE-2026-1' })] }).length > 0);
    assert.ok(validateAllowlist({}).length > 0);
    const result = evaluate(report, { entries: [entry({ reason: '' })] }, 'docs-site', '2026-10-03');
    assert.ok(result.errors.length > 0);
});

test('laporan audit yang terbaca diteruskan apa adanya, termasuk yang berisi advisori', () => {
    const run = classifyAuditRun({ status: 1, stdout: JSON.stringify(report), stderr: '' });
    assert.equal(run.ok, true);
    assert.deepEqual(run.report, report);
});

test('gangguan registry dan jaringan dianggap sementara; galat konfigurasi tidak', () => {
    // CI 22 Okt: langkah spark berjalan 4,5 menit lalu "npm audit gagal untuk spark: " (ringkasan kosong).
    const empty = classifyAuditRun({ status: 1, stdout: JSON.stringify({ error: { code: null, summary: '', detail: '' } }), stderr: '' });
    assert.deepEqual([empty.ok, empty.transient], [false, true]);
    for (const code of ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'E503', 'E429']) {
        const run = classifyAuditRun({ status: 1, stdout: JSON.stringify({ error: { code, summary: `request failed ${code}` } }), stderr: '' });
        assert.equal(run.transient, true, code);
    }
    const timedOut = classifyAuditRun({ status: null, error: Object.assign(new Error('spawnSync npm ETIMEDOUT'), { code: 'ETIMEDOUT' }), stdout: '', stderr: '' });
    assert.deepEqual([timedOut.ok, timedOut.transient], [false, true]);
    const notJson = classifyAuditRun({ status: 1, stdout: 'npm error network socket hang up', stderr: 'npm error code ECONNRESET' });
    assert.equal(notJson.transient, true);
    const noLock = classifyAuditRun({ status: 1, stdout: JSON.stringify({ error: { code: 'ENOLOCK', summary: 'This command requires an existing lockfile.' } }), stderr: '' });
    assert.deepEqual([noLock.ok, noLock.transient], [false, false]);
    assert.match(noLock.message, /ENOLOCK/);
});

test('audit diulang hanya untuk gangguan sementara, paling banyak tiga kali', () => {
    const transient = { status: 1, stdout: JSON.stringify({ error: { code: 'ETIMEDOUT', summary: 'timeout' } }), stderr: '' };
    const good = { status: 0, stdout: JSON.stringify({ vulnerabilities: {} }), stderr: '' };
    const waits = [];
    const runs = [transient, good];
    const recovered = runAuditWithRetry(() => runs.shift(), { attempts: 3, wait: (ms) => waits.push(ms), log: () => {} });
    assert.equal(recovered.ok, true);
    assert.equal(waits.length, 1);

    let calls = 0;
    const exhausted = runAuditWithRetry(() => { calls += 1; return transient; }, { attempts: 3, wait: () => {}, log: () => {} });
    assert.deepEqual([exhausted.ok, calls], [false, 3]);

    calls = 0;
    const fatal = { status: 1, stdout: JSON.stringify({ error: { code: 'ENOLOCK', summary: 'no lockfile' } }), stderr: '' };
    const stopped = runAuditWithRetry(() => { calls += 1; return fatal; }, { attempts: 3, wait: () => {}, log: () => {} });
    assert.deepEqual([stopped.ok, calls], [false, 1]);
});

test('allowlist repositori valid dan setiap entri kedaluwarsa paling lama 90 hari', () => {
    const allowlist = JSON.parse(readFileSync(resolve(import.meta.dirname, '../npm-audit-allowlist.json'), 'utf8'));
    assert.deepEqual(validateAllowlist(allowlist), []);
    for (const item of allowlist.entries) {
        const days = (Date.parse(`${item.expires}T00:00:00Z`) - Date.parse('2026-10-03T00:00:00Z')) / 86_400_000;
        assert.ok(days <= 90, `${item.ghsa} kedaluwarsa terlalu jauh (${item.expires})`);
        assert.ok(!item.projects.includes('backend'), 'backend tidak boleh mendapat pengecualian audit');
    }
});
