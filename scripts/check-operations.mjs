import { pathToFileURL } from 'node:url';

const MAXIMUM_FUTURE_SKEW_MS = 5000;

export function validateOperationsProbe(responseStatus, payload, now = Date.now()) {
    const required = ['database', 'storage', 'scanner', 'scan_queue', 'fixity', 'backup', 'restore'];
    const timestamp = Date.parse(payload?.timestamp);
    if (responseStatus !== 200 || payload?.status !== 'healthy' || !Number.isFinite(timestamp)
        || timestamp - now > MAXIMUM_FUTURE_SKEW_MS || now - timestamp > 120000 || !Array.isArray(payload?.checks)) return false;
    return payload.checks.length === required.length && required.every(id => {
        const items = payload.checks.filter(check => check?.id === id);
        return items.length === 1 && ['healthy', 'disabled'].includes(items[0].status);
    });
}

export async function runOperationsProbe(source = process.env, fetcher = fetch) {
    const token = source.OPERATIONS_MONITOR_TOKEN || '';
    if (token.length < 32) throw new Error('OPERATIONS_MONITOR_TOKEN belum dikonfigurasi.');
    const response = await fetcher('https://simsa-frontend.vercel.app/api/operations/probe', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    const body = await response.text();
    if (body.length > 16384) throw new Error('Respons monitoring tidak valid.');
    const payload = JSON.parse(body);
    // Never log arbitrary response bodies, URLs or credentials from a failed request.
    const healthy = validateOperationsProbe(response.status, payload);
    console.log(healthy ? 'Monitoring operasional: sehat.' : 'Monitoring operasional: perlu tindakan. Periksa panel Super Admin.');
    return healthy;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try { process.exitCode = await runOperationsProbe() ? 0 : 1; }
    catch { console.error('Pemeriksaan monitoring gagal. Periksa koneksi dan konfigurasi token CI.'); process.exitCode = 1; }
}
