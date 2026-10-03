import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { collectAdvisories, evaluate, validateAllowlist } from './npm-audit-gate.mjs';

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

test('allowlist repositori valid dan setiap entri kedaluwarsa paling lama 90 hari', () => {
    const allowlist = JSON.parse(readFileSync(resolve(import.meta.dirname, '../npm-audit-allowlist.json'), 'utf8'));
    assert.deepEqual(validateAllowlist(allowlist), []);
    for (const item of allowlist.entries) {
        const days = (Date.parse(`${item.expires}T00:00:00Z`) - Date.parse('2026-10-03T00:00:00Z')) / 86_400_000;
        assert.ok(days <= 90, `${item.ghsa} kedaluwarsa terlalu jauh (${item.expires})`);
        assert.ok(!item.projects.includes('backend'), 'backend tidak boleh mendapat pengecualian audit');
    }
});
