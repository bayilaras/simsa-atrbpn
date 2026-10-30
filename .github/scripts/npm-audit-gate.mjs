#!/usr/bin/env node
// Gerbang audit npm untuk CI.
//
// Menjalankan `npm audit --json` di direktori proyek, lalu gagal bila ada
// advisori ber-severity high/critical yang tidak tercantum pada allowlist
// (.github/npm-audit-allowlist.json) untuk proyek tersebut. Entri allowlist
// wajib mempunyai tanggal kedaluwarsa; entri yang sudah lewat tanggalnya
// membuat gerbang gagal, sehingga pengecualian tidak menetap diam-diam.
//
// Pemakaian: node .github/scripts/npm-audit-gate.mjs <proyek> [--omit=dev]
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const BLOCKING = new Set(['high', 'critical']);
const GHSA = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/;
// Gangguan registry/jaringan, bukan hasil audit: `npm audit` yang menggantung
// lalu berakhir dengan galat kosong (CI 22 Okt, 4,5 menit) termasuk di sini.
const TRANSIENT_CODES = /^(ETIMEDOUT|ESOCKETTIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPIPE|E429|E5\d\d)$/;
const TRANSIENT_TEXT = /timed? ?out|socket hang up|network|ECONNRESET|ETIMEDOUT|EAI_AGAIN|audit endpoint|503|502|504|429/i;
const ATTEMPT_TIMEOUT_MS = 120_000;
const RETRY_WAIT_MS = [15_000, 45_000];

/**
 * Golongkan satu hasil spawnSync `npm audit --json`.
 * @returns {{ ok: true, report: object } | { ok: false, transient: boolean, message: string }}
 */
export function classifyAuditRun(result) {
    if (result.error) {
        return { ok: false, transient: true, message: `npm audit tidak selesai: ${result.error.code ?? result.error.message}` };
    }
    let report;
    try { report = JSON.parse(result.stdout); } catch {
        const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
        return {
            ok: false,
            // Tanpa JSON, npm hampir selalu mati di jaringan; selain itu tetap dicoba ulang
            // karena advisori sungguhan selalu datang sebagai JSON.
            transient: true,
            message: `npm audit tidak menghasilkan JSON (exit ${result.status}). ${output.slice(0, 2000)}`,
        };
    }
    if (report?.error) {
        const { code, summary, detail } = report.error;
        const text = `${summary ?? ''} ${detail ?? ''}`.trim();
        const transient = !code && !text ? true : TRANSIENT_CODES.test(code ?? '') || TRANSIENT_TEXT.test(text);
        return { ok: false, transient, message: `npm audit gagal (${code ?? 'tanpa kode'}): ${text || JSON.stringify(report.error)}` };
    }
    return { ok: true, report };
}

/** Jalankan audit, ulangi bila gagalnya karena gangguan sementara. */
export function runAuditWithRetry(runOnce, { attempts = 3, wait, log = console.error } = {}) {
    let outcome;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        outcome = classifyAuditRun(runOnce());
        if (outcome.ok || !outcome.transient || attempt === attempts) return outcome;
        const ms = RETRY_WAIT_MS[Math.min(attempt - 1, RETRY_WAIT_MS.length - 1)];
        log(`${outcome.message} — gangguan sementara, coba lagi (${attempt + 1}/${attempts}) dalam ${ms / 1000} detik.`);
        wait(ms);
    }
    return outcome;
}

function sleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Kumpulkan advisori langsung (objek `via`) dari laporan `npm audit --json`. */
export function collectAdvisories(report) {
    const advisories = new Map();
    for (const [pkg, vulnerability] of Object.entries(report?.vulnerabilities ?? {})) {
        for (const via of vulnerability?.via ?? []) {
            if (typeof via !== 'object' || via === null) continue;
            const id = String(via.url ?? '').match(GHSA)?.[0] ?? `source-${via.source ?? pkg}`;
            const current = advisories.get(id) ?? { id, title: via.title, severity: via.severity, packages: new Set() };
            current.packages.add(via.name ?? pkg);
            advisories.set(id, current);
        }
    }
    return [...advisories.values()].map((a) => ({ ...a, packages: [...a.packages].sort() }));
}

/** Validasi bentuk allowlist; mengembalikan daftar pesan galat. */
export function validateAllowlist(allowlist) {
    const errors = [];
    if (!Array.isArray(allowlist?.entries)) return ['allowlist harus berupa objek dengan array "entries"'];
    allowlist.entries.forEach((entry, i) => {
        const label = `entri #${i + 1}`;
        if (!GHSA.test(entry?.ghsa ?? '') || entry.ghsa !== entry.ghsa.match(GHSA)[0]) errors.push(`${label}: "ghsa" wajib berupa ID GHSA`);
        if (!Array.isArray(entry?.projects) || entry.projects.length === 0) errors.push(`${label}: "projects" wajib diisi`);
        if (!Array.isArray(entry?.packages) || entry.packages.length === 0) errors.push(`${label}: "packages" wajib diisi`);
        if (typeof entry?.reason !== 'string' || entry.reason.trim().length < 20) errors.push(`${label}: "reason" wajib dijelaskan (minimal 20 karakter)`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(entry?.expires ?? '') || Number.isNaN(Date.parse(`${entry.expires}T00:00:00Z`))) {
            errors.push(`${label}: "expires" wajib berformat YYYY-MM-DD`);
        }
    });
    return errors;
}

/**
 * Nilai laporan audit terhadap allowlist.
 * @returns {{ blocking: object[], allowed: object[], expired: object[], errors: string[] }}
 */
export function evaluate(report, allowlist, project, today) {
    const errors = validateAllowlist(allowlist);
    if (errors.length) return { blocking: [], allowed: [], expired: [], errors };
    const entries = allowlist.entries.filter((entry) => entry.projects.includes(project));
    const expired = entries.filter((entry) => entry.expires < today);
    const active = entries.filter((entry) => entry.expires >= today);
    const blocking = [];
    const allowed = [];
    for (const advisory of collectAdvisories(report)) {
        if (!BLOCKING.has(advisory.severity)) continue;
        const entry = active.find((candidate) => candidate.ghsa === advisory.id
            && advisory.packages.every((pkg) => candidate.packages.includes(pkg)));
        (entry ? allowed : blocking).push({ ...advisory, expires: entry?.expires });
    }
    return { blocking, allowed, expired, errors };
}

function main(argv) {
    const [project, ...flags] = argv;
    if (!project || flags.some((flag) => flag !== '--omit=dev')) {
        console.error('Pemakaian: node .github/scripts/npm-audit-gate.mjs <proyek> [--omit=dev]');
        return 2;
    }
    const root = resolve(import.meta.dirname, '..', '..');
    const allowlist = JSON.parse(readFileSync(resolve(root, '.github/npm-audit-allowlist.json'), 'utf8'));
    // Argumen tetap (tanpa masukan pengguna); di Windows npm adalah skrip .cmd
    // sehingga dijalankan lewat cmd.exe, bukan opsi shell.
    const args = ['audit', '--json', ...flags];
    const [command, commandArgs] = process.platform === 'win32'
        ? ['cmd.exe', ['/d', '/c', 'npm', ...args]]
        : ['npm', args];
    const outcome = runAuditWithRetry(() => spawnSync(command, commandArgs, {
        cwd: resolve(root, project), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: ATTEMPT_TIMEOUT_MS,
    }), { wait: sleep });
    if (!outcome.ok) {
        console.error(`Audit ${project}: ${outcome.message}`);
        return 1;
    }
    const { report } = outcome;
    const today = new Date().toISOString().slice(0, 10);
    const { blocking, allowed, expired, errors } = evaluate(report, allowlist, project, today);
    const scope = flags.includes('--omit=dev') ? 'dependensi produksi' : 'semua dependensi';
    for (const message of errors) console.error(`Allowlist tidak valid: ${message}`);
    for (const entry of expired) console.error(`Pengecualian ${entry.ghsa} untuk ${project} sudah kedaluwarsa (${entry.expires}); tinjau ulang.`);
    for (const a of allowed) console.log(`Dikecualikan sementara sampai ${a.expires}: ${a.id} (${a.severity}) ${a.packages.join(', ')} — ${a.title}`);
    for (const a of blocking) console.error(`BLOKIR: ${a.id} (${a.severity}) ${a.packages.join(', ')} — ${a.title}`);
    const failed = errors.length > 0 || expired.length > 0 || blocking.length > 0;
    console.log(`Audit ${project} (${scope}): ${failed ? 'GAGAL' : 'lulus'}; ${blocking.length} advisori high/critical terblokir, ${allowed.length} dikecualikan sementara.`);
    return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    process.exitCode = main(process.argv.slice(2));
}
