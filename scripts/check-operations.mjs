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

/** Asks the backend to refresh on-demand antivirus verification before it lapses. */
export async function requestScannerWake(source = process.env, fetcher = fetch) {
    try {
        const response = await fetcher('https://simsa-frontend.vercel.app/api/operations/scanner-wake', {
            method: 'POST', headers: { Authorization: `Bearer ${source.OPERATIONS_MONITOR_TOKEN || ''}`, Accept: 'application/json' },
            redirect: 'error', signal: AbortSignal.timeout(30000),
        });
        const body = await response.text();
        const status = body.length <= 1024 ? JSON.parse(body)?.status : undefined;
        return ['fresh', 'scheduled', 'not_required', 'unavailable'].includes(status) ? status : 'failed';
    } catch { return 'failed'; }
}

export async function runMonitor(source = process.env, fetcher = fetch, sleep = ms => new Promise(done => setTimeout(done, ms))) {
    if ((source.OPERATIONS_MONITOR_TOKEN || '').length < 32) throw new Error('OPERATIONS_MONITOR_TOKEN belum dikonfigurasi.');
    const wake = await requestScannerWake(source, fetcher);
    console.log(`Pemindai: ${wake}.`);
    // A scheduled wake needs about a minute to refresh definitions; probe
    // again only then, at most six times, before reporting the result.
    for (let attempt = 1; ; attempt++) {
        const healthy = await runOperationsProbe(source, fetcher);
        if (healthy || wake !== 'scheduled' || attempt >= 6) return healthy;
        await sleep(20000);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try { process.exitCode = await runMonitor() ? 0 : 1; }
    catch { console.error('Pemeriksaan monitoring gagal. Periksa koneksi dan konfigurasi token CI.'); process.exitCode = 1; }
}
