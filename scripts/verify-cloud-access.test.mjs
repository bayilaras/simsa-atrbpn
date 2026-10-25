import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions, runCloudAcceptance, validateCloudOrigin, validateCredentialTarget } from './verify-cloud-access.mjs';

const origin = 'https://synthetic-acceptance.onrender.com';
const email = 'operator@synthetic.invalid';
const password = 'SYNTHETIC-private-password-123';
const token = 'SYNTHETIC-session-secret';
const session = '__Secure-better-auth.session_token';
const csrf = 'SYNTHETIC-csrf-secret';
const args = { origin, email, password, timeoutMs: 1000, expectedFiles: false };
const json = (data, status = 200, cookies = []) => {
    const headers = new Headers({ 'content-type': 'application/json' });
    for (const cookie of cookies) headers.append('set-cookie', cookie);
    return new Response(JSON.stringify(data), { status, headers });
};
function scenario({ secure = true, revocation = true, hook } = {}) {
    const requests = [];
    let revoked = false;
    const fetchImpl = async (url, options) => {
        const path = new URL(url).pathname;
        requests.push({ path, options });
        assert.equal(new URL(url).origin, origin);
        assert.equal(options.redirect, 'manual');
        assert.equal(options.headers.origin, origin);
        assert.ok(options.signal instanceof AbortSignal);
        const override = hook?.(path, options);
        if (override) return override;
        if (path === '/health') return json({ status: 'alive' });
        if (path === '/ready') return json({ status: 'ready' });
        if (path === '/api/capabilities') return json({ mode: 'full', syntheticDataOnly: false,
            capabilities: { metadata: true, files: false, fileUploads: false },
            authentication: { provider: 'better-auth', googleSignIn: false } }, 200, [`csrf-token=${csrf}; Path=/; Secure; SameSite=None`]);
        if (path === '/api/auth/sign-in/email') {
            assert.deepEqual(JSON.parse(options.body), { email, password });
            assert.equal(options.headers['x-csrf-token'], csrf);
            return json({ token, user: { email } }, 200, [`${session}=${token}; Path=/; HttpOnly; ${secure ? 'Secure;' : ''} SameSite=Lax`]);
        }
        if (path === '/api/unit-kerja') {
            const authorized = options.headers.cookie?.includes(`${session}=${token}`) && (!revoked || !revocation);
            return authorized ? json({ success: true, data: [{ id: 'ditjen', name: 'Synthetic' }] }) : json({ error: 'Unauthorized' }, 401);
        }
        if (path === '/api/auth/sign-out') {
            assert.ok(options.headers.cookie.includes(`${session}=${token}`));
            assert.deepEqual(JSON.parse(options.body), {});
            revoked = true;
            return json({ success: true }, 200, [`${session}=; Path=/; Secure; HttpOnly; Max-Age=0`]);
        }
        assert.fail('Unexpected endpoint');
    };
    return { requests, fetchImpl };
}
function assertNoPrivateValues(result) {
    const text = JSON.stringify(result);
    for (const privateValue of [email, password, token, csrf, origin]) assert.ok(!text.includes(privateValue));
}

test('requires an exact HTTPS hosting origin, explicit file expectation and bounded options', () => {
    assert.equal(validateCloudOrigin(origin + '/'), origin);
    assert.equal(validateCloudOrigin('https://synthetic-verification.vercel.app'), 'https://synthetic-verification.vercel.app');
    assert.equal(validateCloudOrigin('https://synthetic-verification.netlify.app'), 'https://synthetic-verification.netlify.app');
    for (const value of ['http://synthetic-acceptance.onrender.com', 'https://onrender.com',
        'https://synthetic-acceptance.onrender.com.evil.invalid', 'https://evil.invalid',
        'https://secret:password@synthetic-acceptance.onrender.com', origin + ':8443', origin + '/api', origin + '?x=secret']) {
        assert.throws(() => validateCloudOrigin(value));
    }
    for (const options of [[], ['--origin', origin], ['--origin', origin, '--env-file', 'synthetic.env', '--timeout-ms', '60001'],
        ['--origin', origin, '--env-file', 'synthetic.env', '--timeout-ms', '999'],
        ['--origin', origin, '--env-file', 'synthetic.env', '--origin', origin],
        ['--origin', origin, '--env-file', 'synthetic.env', '--output', '../unsafe.json']]) {
        assert.throws(() => parseOptions(options));
    }
    const valid = ['--origin', origin, '--env-file', 'synthetic.env', '--files', 'disabled'];
    assert.equal(parseOptions(valid).timeoutMs, 60_000);
    assert.equal(parseOptions(valid).expectedFiles, false);
    assert.throws(() => parseOptions([...valid, '--timeout-ms', '60001']));
    assert.throws(() => parseOptions([...valid, '--output', '../unsafe.json']));
    assert.throws(() => parseOptions(['--origin', origin, '--env-file', 'synthetic.env', '--files', 'maybe']));
});

test('refuses credentials without an independent matching target pin', () => {
    assert.throws(() => validateCredentialTarget({}, origin));
    assert.throws(() => validateCredentialTarget({ CLOUD_ACCESS_EXPECTED_ORIGIN: 'https://another-app.vercel.app' }, origin));
    assert.doesNotThrow(() => validateCredentialTarget({ CLOUD_ACCESS_EXPECTED_ORIGIN: origin }, origin));
});

test('does not send credentials when file capabilities differ from the required deployment', async () => {
    const fixture = scenario();
    const result = await runCloudAcceptance({ ...args, expectedFiles: true }, fixture);
    assert.ok(result.results.some(row => row.check === 'expected_file_capabilities' && !row.passed));
    assert.equal(fixture.requests.length, 3);
    assert.ok(fixture.requests.every(({ options }) => options.method === 'GET'));
    assertNoPrivateValues(result);
});

test('can verify file-enabled access without claiming file safety or production readiness', async () => {
    const fixture = scenario({ hook: path => path === '/api/capabilities' ? json({ mode: 'full', syntheticDataOnly: false,
        capabilities: { metadata: true, files: true, fileUploads: true },
        authentication: { provider: 'better-auth', googleSignIn: true } }, 200,
        [`csrf-token=${csrf}; Path=/; Secure; SameSite=Lax`]) : null });
    const result = await runCloudAcceptance({ ...args, expectedFiles: true }, fixture);
    assert.equal(result.failed, 0);
    assert.equal(result.scope, 'http-access-and-session');
    assert.equal(result.expectedFiles, true);
    assertNoPrivateValues(result);
});

test('reads status, signs in, reads units, signs out and proves old session denied with no metadata writes', async () => {
    const fixture = scenario();
    const result = await runCloudAcceptance(args, fixture);
    assert.equal(result.failed, 0);
    assert.equal(result.passed, 13);
    assert.equal(result.oldSessionRevoked, true);
    assert.deepEqual(fixture.requests.map(({ path, options }) => options.method + ' ' + path), [
        'GET /health', 'GET /ready', 'GET /api/capabilities', 'GET /api/unit-kerja',
        'POST /api/auth/sign-in/email', 'GET /api/unit-kerja', 'POST /api/auth/sign-out', 'GET /api/unit-kerja',
    ]);
    assert.ok(fixture.requests.at(-1).options.headers.cookie.includes(`${session}=${token}`));
    assertNoPrivateValues(result);
});

test('a successful logout response alone cannot prove revocation', async () => {
    const fixture = scenario({ revocation: false });
    const result = await runCloudAcceptance(args, fixture);
    assert.equal(result.oldSessionRevoked, false);
    assert.ok(result.results.some(row => row.check === 'old_session_denied_after_logout' && !row.passed && row.httpStatus === 200));
    assert.equal(fixture.requests.length, 8);
    assertNoPrivateValues(result);
});

test('refuses redirects before credentials and never follows a second origin', async () => {
    const fixture = scenario({ hook: path => path === '/ready' ? new Response(null, { status: 302, headers: { location: 'https://evil.invalid' } }) : null });
    const result = await runCloudAcceptance(args, fixture);
    assert.equal(fixture.requests.length, 2);
    assert.equal(result.results.at(-1).failure, 'redirect_refused');
    assert.ok(fixture.requests.every(({ options }) => options.method === 'GET'));
    assertNoPrivateValues(result);
});

test('rejects an insecure session cookie and performs one cleanup logout for that session', async () => {
    const fixture = scenario({ secure: false });
    const result = await runCloudAcceptance(args, fixture);
    assert.ok(result.results.some(row => row.check === 'session_cookie_secure_httponly' && !row.passed));
    assert.equal(fixture.requests.filter(({ path }) => path === '/api/auth/sign-out').length, 1);
    assert.equal(result.results.at(-1).check, 'cleanup_logout_response');
    assert.equal(result.oldSessionRevoked, false);
    assertNoPrivateValues(result);
});

test('bounded body failure does not print a private server response', async () => {
    const fixture = scenario({ hook: path => path === '/health' ? new Response(password.repeat(20_000)) : null });
    const result = await runCloudAcceptance(args, fixture);
    assert.equal(fixture.requests.length, 1);
    assert.equal(result.results.at(-1).failure, 'response_too_large');
    assertNoPrivateValues(result);
});

test('request failure cannot disclose raw exception credentials or trigger a retry', async () => {
    let calls = 0;
    const result = await runCloudAcceptance(args, { fetchImpl: async () => { calls++; throw new Error(email + password + token); } });
    assert.equal(calls, 1);
    assert.equal(result.results.at(-1).failure, 'request_failed');
    assertNoPrivateValues(result);
});

test('timeout is reported as a fixed status without retrying', async () => {
    let calls = 0;
    const result = await runCloudAcceptance(args, { fetchImpl: async () => { calls++; throw new DOMException(password, 'TimeoutError'); } });
    assert.equal(calls, 1);
    assert.equal(result.results.at(-1).failure, 'request_timeout');
    assertNoPrivateValues(result);
});
