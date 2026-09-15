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
