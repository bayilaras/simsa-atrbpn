import { pathToFileURL } from 'node:url';

const MAXIMUM_FUTURE_SKEW_MS = 5000;
const REQUIRED_CHECKS = ['database', 'storage', 'scanner', 'scan_queue', 'fixity', 'backup', 'restore'];
const PROBLEM_STATUSES = ['attention', 'failed', 'unknown'];

export function validateOperationsProbe(responseStatus, payload, now = Date.now()) {
    const required = REQUIRED_CHECKS;
    const timestamp = Date.parse(payload?.timestamp);
    if (responseStatus !== 200 || payload?.status !== 'healthy' || !Number.isFinite(timestamp)
        || timestamp - now > MAXIMUM_FUTURE_SKEW_MS || now - timestamp > 120000 || !Array.isArray(payload?.checks)) return false;
    return payload.checks.length === required.length && required.every(id => {
        const items = payload.checks.filter(check => check?.id === id);
        return items.length === 1 && ['healthy', 'disabled'].includes(items[0].status);
    });
}

/** Only known check ids with a known problem status; never echo other response text. */
function unhealthyChecks(payload) {
    if (!Array.isArray(payload?.checks)) return [];
    return REQUIRED_CHECKS.flatMap(id => {
        const items = payload.checks.filter(check => check?.id === id);
        return items.length === 1 && PROBLEM_STATUSES.includes(items[0].status) ? [`${id}: ${items[0].status}`] : [];
    });
}

export async function runOperationsProbe(source = process.env, fetcher = fetch, log = console.log) {
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
    const problems = healthy ? [] : unhealthyChecks(payload);
    log(healthy ? 'Monitoring operasional: sehat.'
        : `Monitoring operasional: perlu tindakan${problems.length ? ` (${problems.join(', ')})` : ''}. Periksa panel Super Admin.`);
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

const timingValue = value => Number.isFinite(value?.median) && value.median >= 0 && value.median < 600000;
const measuredShape = result => result?.status === 'measured' && /^[a-z]{3}\d$/.test(result.functionRegion)
    && result.provider === 'vercel-blob-private' && Number.isInteger(result.rounds) && timingValue(result.listMs)
    && Array.isArray(result.sizes) && result.sizes.length > 0 && result.sizes.every(size => Number.isInteger(size?.bytes) && size.bytes > 0
        && ['uploadMs', 'headMs', 'downloadMs', 'deleteMs'].every(key => timingValue(size[key])));

/** Operator-dispatched: asks the deployed function to time private Blob put/head/get/delete/list. */
export async function requestStorageLatency(source = process.env, fetcher = fetch) {
    const token = source.OPERATIONS_MONITOR_TOKEN || '';
    if (token.length < 32) throw new Error('OPERATIONS_MONITOR_TOKEN belum dikonfigurasi.');
    try {
        const response = await fetcher('https://simsa-frontend.vercel.app/api/operations/storage-latency', {
            method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            redirect: 'error', signal: AbortSignal.timeout(120000),
        });
        const body = await response.text();
        const result = body.length <= 16384 ? JSON.parse(body) : null;
        if (response.status === 200 && measuredShape(result)) return result;
        return { status: ['not_supported', 'busy', 'failed'].includes(result?.status) ? result.status : 'invalid_response' };
    } catch { return { status: 'request_failed' }; }
}

export function formatStorageLatency(result) {
    if (!measuredShape(result)) return [`Latensi penyimpanan tidak terukur (${result?.status ?? 'invalid_response'}).`];
    const ms = value => `${Math.round(value.median)} ms`;
    return [`Latensi penyimpanan dari fungsi ${result.functionRegion} (${result.provider}), median ${result.rounds} putaran:`,
        ...result.sizes.map(size => `- ${Math.round(size.bytes / 1024)} KiB: unggah ${ms(size.uploadMs)}, metadata ${ms(size.headMs)}, unduh ${ms(size.downloadMs)}, hapus ${ms(size.deleteMs)}`),
        `- list (probe /ready): ${ms(result.listMs)}`];
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
    try {
        if (process.argv[2] === '--storage-latency') {
            const result = await requestStorageLatency();
            for (const line of formatStorageLatency(result)) console.log(line);
            process.exitCode = result.status === 'measured' ? 0 : 1;
        } else process.exitCode = await runMonitor() ? 0 : 1;
    }
    catch { console.error('Pemeriksaan monitoring gagal. Periksa koneksi dan konfigurasi token CI.'); process.exitCode = 1; }
}
