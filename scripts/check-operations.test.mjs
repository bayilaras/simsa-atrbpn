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
