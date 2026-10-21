import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateOperationsProbe, runOperationsProbe } from './check-operations.mjs';
const now = Date.now();
const payload = () => ({ timestamp: new Date(now).toISOString(), status: 'healthy',
    checks: ['database', 'storage', 'scanner', 'scan_queue', 'fixity', 'backup', 'restore'].map(id => ({ id, status: 'healthy' })) });
test('only a complete fresh healthy response passes CI', () => {
    assert.equal(validateOperationsProbe(200, payload(), now), true);
    assert.equal(validateOperationsProbe(503, payload(), now), false);
    assert.equal(validateOperationsProbe(200, { ...payload(), checks: [] }, now), false);
    assert.equal(validateOperationsProbe(200, payload(), now + 120001), false);
    const failed = payload(); failed.checks[5].status = 'unknown';
    assert.equal(validateOperationsProbe(200, failed, now), false);
});

test('a healthy response tolerates the observed 325 millisecond server clock skew', () => {
    const response = { ...payload(), timestamp: new Date(now + 325).toISOString() };
    assert.equal(validateOperationsProbe(200, response, now), true);
});

test('future timestamps at the five second skew boundary remain valid', () => {
    const response = { ...payload(), timestamp: new Date(now + 5000).toISOString() };
    assert.equal(validateOperationsProbe(200, response, now), true);
});

test('future timestamps beyond the five second skew boundary are rejected', () => {
    const response = { ...payload(), timestamp: new Date(now + 5001).toISOString() };
    assert.equal(validateOperationsProbe(200, response, now), false);
});

test('clock skew tolerance does not extend the two minute freshness limit', () => {
    assert.equal(validateOperationsProbe(200, payload(), now + 120000), true);
    assert.equal(validateOperationsProbe(200, payload(), now + 120001), false);
});
test('probe never redirects credentials and rejects missing token without network', async () => {
    await assert.rejects(runOperationsProbe({}, () => { throw new Error('must not fetch'); }));
    const result = await runOperationsProbe({ OPERATIONS_MONITOR_TOKEN: 'x'.repeat(64) }, async (url, options) => {
        assert.equal(url, 'https://simsa-frontend.vercel.app/api/operations/probe');
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers.Authorization, `Bearer ${'x'.repeat(64)}`);
        return { status: 200, text: async () => JSON.stringify(payload()) };
    });
    assert.equal(result, true);
});

test('monitor wakes the scanner first and re-probes only while a scheduled wake settles', async () => {
    const { runMonitor } = await import('./check-operations.mjs');
    const calls = []; let probes = 0;
    const fetcher = async (url, options) => {
        calls.push([url, options.method || 'GET']);
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers.Authorization, `Bearer ${'x'.repeat(64)}`);
        if (url.endsWith('/scanner-wake')) return { status: 202, text: async () => JSON.stringify({ status: 'scheduled' }) };
        probes += 1;
        return probes < 3 ? { status: 503, text: async () => JSON.stringify({ ...payload(), status: 'failed' }) }
            : { status: 200, text: async () => JSON.stringify({ ...payload(), timestamp: new Date().toISOString() }) };
    };
    const waits = [];
    assert.equal(await runMonitor({ OPERATIONS_MONITOR_TOKEN: 'x'.repeat(64) }, fetcher, async ms => { waits.push(ms); }), true);
    assert.deepEqual(calls[0], ['https://simsa-frontend.vercel.app/api/operations/scanner-wake', 'POST']);
    assert.equal(probes, 3);
    assert.deepEqual(waits, [20000, 20000]);
});

test('a fresh scanner or a failed wake request gets exactly one probe', async () => {
    const { runMonitor } = await import('./check-operations.mjs');
    for (const wake of [{ status: 200, text: async () => '{"status":"fresh"}' }, null]) {
        let probes = 0;
        const fetcher = async url => {
            if (url.endsWith('/scanner-wake')) { if (!wake) throw new Error('network'); return wake; }
            probes += 1;
            return { status: 503, text: async () => JSON.stringify({ ...payload(), status: 'failed' }) };
        };
        assert.equal(await runMonitor({ OPERATIONS_MONITOR_TOKEN: 'x'.repeat(64) }, fetcher, async () => assert.fail('must not wait')), false);
        assert.equal(probes, 1);
    }
});

test('an unhealthy probe names the failing check ids and statuses, nothing else', async () => {
    const lines = [];
    const body = payload(); body.status = 'attention';
    body.checks[2].status = 'attention'; body.checks[5].status = 'failed';
    body.checks.push({ id: 'Bearer secret-value', status: 'failed' }, { id: 'storage', status: '<script>' });
    const healthy = await runOperationsProbe({ OPERATIONS_MONITOR_TOKEN: 'x'.repeat(64) },
        async () => ({ status: 503, text: async () => JSON.stringify(body) }), line => lines.push(line));
    assert.equal(healthy, false);
    assert.deepEqual(lines, ['Monitoring operasional: perlu tindakan (scanner: attention, backup: failed). Periksa panel Super Admin.']);
});

test('storage latency is requested from the deployed function and printed as medians only', async () => {
    const { requestStorageLatency, formatStorageLatency } = await import('./check-operations.mjs');
    await assert.rejects(requestStorageLatency({}, () => assert.fail('must not fetch')));
    const timing = median => ({ median, samples: [median, median + 1, median - 1] });
    const measured = { status: 'measured', provider: 'vercel-blob-private', functionRegion: 'sin1', rounds: 3, listMs: timing(410),
        sizes: [{ bytes: 16384, uploadMs: timing(300), headMs: timing(120), downloadMs: timing(90), deleteMs: timing(200) },
            { bytes: 1048576, uploadMs: timing(700), headMs: timing(125), downloadMs: timing(160), deleteMs: timing(210) }] };
    const result = await requestStorageLatency({ OPERATIONS_MONITOR_TOKEN: 'x'.repeat(64) }, async (url, options) => {
        assert.equal(url, 'https://simsa-frontend.vercel.app/api/operations/storage-latency');
        assert.equal(options.method, 'POST');
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers.Authorization, `Bearer ${'x'.repeat(64)}`);
        return { status: 200, text: async () => JSON.stringify(measured) };
    });
    assert.deepEqual(formatStorageLatency(result), [
        'Latensi penyimpanan dari fungsi sin1 (vercel-blob-private), median 3 putaran:',
        '- 16 KiB: unggah 300 ms, metadata 120 ms, unduh 90 ms, hapus 200 ms',
        '- 1024 KiB: unggah 700 ms, metadata 125 ms, unduh 160 ms, hapus 210 ms',
        '- list (probe /ready): 410 ms',
    ]);
    for (const response of [{ status: 503, text: async () => '{"status":"failed"}' },
        { status: 200, text: async () => JSON.stringify({ ...measured, functionRegion: 'sin1; rm -rf' }) }]) {
        const failed = await requestStorageLatency({ OPERATIONS_MONITOR_TOKEN: 'x'.repeat(64) }, async () => response);
        assert.notEqual(failed.status, 'measured');
        assert.deepEqual(formatStorageLatency(failed), [`Latensi penyimpanan tidak terukur (${failed.status}).`]);
    }
});
