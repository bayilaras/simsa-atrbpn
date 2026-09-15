import { get } from '@vercel/blob';
import type { QueryConfig } from 'pg';
import { pool } from '../config/database.js';
import { getReadiness } from './readiness.service.js';
import { PRIVATE_LETTER_BLOB_SQL_PATTERN } from './file-release-policy.js';

export const RECOVERY_STATUS_PATH = 'operations/recovery-status-v1.json';
type Status = 'healthy' | 'attention' | 'failed' | 'unknown' | 'disabled';
type Check = { id: string; label: string; status: Status; message: string; checkedAt?: string; expiresAt?: string; counts?: Record<string, number> };
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : NaN;
const count = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const validCount = (value: unknown) => (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)))
    && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
const QUEUE_KEYS = ['scanWaiting', 'scanOverdue', 'scanErrors', 'fixityOverdue', 'fixityErrors', 'fixityUnscheduled', 'mismatched'];

export function evaluateRecoveryCheck(id: 'backup' | 'restore', evidence: unknown, now: number): Check {
    const label = id === 'backup' ? 'Backup database dan dokumen' : 'Uji pemulihan backup';
    const item = record(evidence);
    const completed = date(item.completedAt);
    const base = { id, label };
    if (!Number.isFinite(completed) || completed > now || !/^[a-f0-9]{64}$/.test(String(item.evidenceSha256)))
        return { ...base, status: 'unknown', message: 'Belum ada bukti terverifikasi. Jalankan pemeriksaan pemulihan.' };
    const checkedAt = new Date(completed).toISOString();
    const expires = completed + (id === 'backup' ? 36 * 3600000 : 90 * 86400000);
    const times = { checkedAt, expiresAt: new Date(expires).toISOString() };
    if (item.status === 'failed') return { ...base, ...times, status: 'failed', message: 'Percobaan terakhir gagal. Periksa hasil pekerjaan di CI.' };
    if (item.status !== 'success') return { ...base, ...times, status: 'unknown', message: 'Hasil pekerjaan belum dapat dipastikan.' };
    if (item.databaseVerified !== true || item.documentsVerified !== true)
        return { ...base, ...times, status: 'attention', message: 'Verifikasi database dan berkas dokumen belum lengkap.' };
    if (expires <= now) return { ...base, ...times, status: 'attention', message: 'Bukti pemeriksaan sudah kedaluwarsa. Jalankan kembali pekerjaan di CI.' };
    return { ...base, ...times, status: 'healthy', message: id === 'backup' ? 'Database dan berkas dokumen terverifikasi dalam backup.' : 'Database dan berkas berhasil dipulihkan dan diverifikasi.' };
}

export function buildOperationsStatus(input: { now: number; readiness: unknown; queues: unknown; recovery: unknown }) {
    const readiness = record(input.readiness), dependencies = record(readiness.dependencies);
    const db = record(dependencies.database), blob = record(dependencies.blobStorage);
    const scanner = record(dependencies.malwareScanner), worker = record(dependencies.malwareWorker);
    const queues = record(input.queues), recovery = record(input.recovery);
    const checks: Check[] = [
        { id: 'database', label: 'Database', status: db.ready === true ? 'healthy' : 'failed', message: db.ready === true ? 'Koneksi dan struktur database siap.' : 'Pemeriksaan database gagal. Periksa koneksi dan migrasi.' },
        { id: 'storage', label: 'Penyimpanan dokumen', status: blob.required === false ? 'disabled' : record(blob.runtime).ready === true ? 'healthy' : 'failed', message: blob.required === false ? 'Penyimpanan berkas tidak diaktifkan.' : record(blob.runtime).ready === true ? 'Penyimpanan privat dapat diakses.' : 'Penyimpanan privat belum siap.' },
        { id: 'scanner', label: 'Pemindai keamanan dokumen', status: scanner.state === 'disabled' ? 'disabled' : worker.state === 'not_ready' || scanner.state === 'not_ready' ? 'failed' : worker.state === 'ready' || scanner.state === 'ready' ? 'healthy' : 'unknown',
            message: scanner.state === 'disabled' ? 'Pemindai tidak diaktifkan.' : worker.state === 'not_ready' ? 'Verifikasi pemindai hilang, gagal, atau kedaluwarsa. Jalankan pemeriksaan pemindai.' : 'Status mengikuti pemeriksaan mesin dan kesegaran definisi virus.' },
    ];
    const expiry = date(worker.definitionsExpiresAt), seen = date(worker.lastSeenAt);
    if (Number.isFinite(expiry)) checks[2].expiresAt = new Date(expiry).toISOString();
    if (Number.isFinite(seen)) checks[2].checkedAt = new Date(seen).toISOString();
    const scanCounts = { waiting: count(queues.scanWaiting), overdue: count(queues.scanOverdue), errors: count(queues.scanErrors) };
    const fixityCounts = { overdue: count(queues.fixityOverdue), errors: count(queues.fixityErrors), unscheduled: count(queues.fixityUnscheduled), mismatched: count(queues.mismatched) };
    // COUNT returns decimal strings in pg. Missing/malformed fields are an
    // unavailable snapshot, never evidence that the queues contain zero jobs.
    const unavailable = !QUEUE_KEYS.every(key => validCount(queues[key]));
    checks.push({ id: 'scan_queue', label: 'Antrean pemindaian', status: unavailable ? 'unknown' : scanCounts.errors || scanCounts.overdue ? 'attention' : 'healthy',
        message: unavailable ? 'Antrean belum dapat diperiksa.' : 'Berkas menunggu lebih dari 30 menit atau gagal dipindai perlu ditindaklanjuti.', ...(!unavailable ? { counts: scanCounts } : {}) });
    checks.push({ id: 'fixity', label: 'Integritas dokumen berkala', status: unavailable ? 'unknown' : fixityCounts.mismatched ? 'failed' : Object.values(fixityCounts).some(Boolean) ? 'attention' : 'healthy',
        message: unavailable ? 'Jadwal integritas belum dapat diperiksa.' : 'Periksa berkas rusak, pemeriksaan gagal, jadwal terlambat lebih dari satu jam, atau berkas yang belum terjadwal.', ...(!unavailable ? { counts: fixityCounts } : {}) });
    checks.push(evaluateRecoveryCheck('backup', recovery.backup, input.now), evaluateRecoveryCheck('restore', recovery.restore, input.now));
    return { timestamp: new Date(input.now).toISOString(), status: checks.some(c => c.status === 'failed') ? 'failed' : checks.some(c => ['attention', 'unknown'].includes(c.status)) ? 'attention' : 'healthy',
        checks, ciUrl: 'https://github.com/bayilaras/simsa-atrbpn/actions', refreshAfterSeconds: 60 };
}

async function readRecoveryEvidence() {
    if (process.env.OBJECT_STORAGE_PROVIDER !== 'vercel-blob' || !process.env.BLOB_READ_WRITE_TOKEN) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
        const result = await get(RECOVERY_STATUS_PATH, { access: 'private', useCache: false, abortSignal: controller.signal });
        if (!result || result.statusCode !== 200) return null;
        const reader = result.stream.getReader();
        try {
            let bytes = 0; const chunks: Uint8Array[] = [];
            for (;;) {
                const next = await reader.read();
                if (next.done) break;
                bytes += next.value.byteLength;
                if (bytes > 16384) throw new Error('oversized recovery evidence');
                chunks.push(next.value);
            }
            const evidence = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            return evidence.schemaVersion === 1 ? evidence : null;
        } finally { await reader.cancel().catch(() => {}); }
    } finally { clearTimeout(timer); }
}

export async function collectOperationsStatus() {
    // Keep queue membership aligned with the actual scan/fixity workers.
    const eligible = `NOT (entity_type IN ('surat_masuk', 'surat_keluar') AND coalesce(nullif(file_url, ''), drive_file_id, '') ~* '${PRIVATE_LETTER_BLOB_SQL_PATTERN}')`;
    const pendingScan = `(${eligible}) AND (malware_scan_status='not_scanned'
        OR (malware_scan_status='clean' AND (integrity_status <> 'verified' OR sha256 IS NULL OR sha256 !~* '^[a-f0-9]{64}$'))
        OR malware_scan_status ~ '^(scanning|retry):[1-9][0-9]?:[0-9]{1,12}$')`;
    const fixityEligible = `(${eligible}) AND f.storage_access='private' AND f.malware_scan_status='clean'
        AND f.sha256 IS NOT NULL AND f.integrity_status <> 'mismatch'`;
    const [ready, queue, recovery] = await Promise.allSettled([
        getReadiness(),
        pool.query({ text: `SELECT
            (SELECT count(*) FROM file_attachments WHERE ${pendingScan}) AS "scanWaiting",
            (SELECT count(*) FROM file_attachments WHERE ${pendingScan} AND created_at < now() - interval '30 minutes') AS "scanOverdue",
            (SELECT count(*) FROM file_attachments WHERE ${eligible} AND malware_scan_status IN ('scan_error', 'infected')) AS "scanErrors",
            (SELECT count(*) FROM file_fixity_jobs j JOIN file_attachments f ON f.id=j.attachment_id
                WHERE ${fixityEligible} AND j.next_check_at < now() - interval '1 hour') AS "fixityOverdue",
            (SELECT count(*) FROM file_fixity_jobs j JOIN file_attachments f ON f.id=j.attachment_id
                WHERE ${fixityEligible} AND j.last_result IN ('error', 'stale')) AS "fixityErrors",
            (SELECT count(*) FROM file_attachments f LEFT JOIN file_fixity_jobs j ON j.attachment_id=f.id
                WHERE j.attachment_id IS NULL AND ${fixityEligible}) AS "fixityUnscheduled",
            (SELECT count(*) FROM file_attachments WHERE integrity_status='mismatch') AS "mismatched"`, query_timeout: 5000 } as QueryConfig & { query_timeout: number }),
        readRecoveryEvidence(),
    ]);
    return buildOperationsStatus({ now: Date.now(), readiness: ready.status === 'fulfilled' ? ready.value : null,
        queues: queue.status === 'fulfilled' ? queue.value.rows[0] : null, recovery: recovery.status === 'fulfilled' ? recovery.value : null });
}

let cached: Awaited<ReturnType<typeof collectOperationsStatus>> | null = null;
let pending: Promise<Awaited<ReturnType<typeof collectOperationsStatus>>> | null = null;
let until = 0;
export function getOperationsStatus() {
    if (cached && Date.now() < until) return Promise.resolve(cached);
    if (pending) return pending;
    pending = collectOperationsStatus().then(result => { cached = result; until = Date.now() + 30000; return result; }).finally(() => { pending = null; });
    return pending;
}
