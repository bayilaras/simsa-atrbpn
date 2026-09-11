#!/usr/bin/env node
// Operator-invoked, bounded HTTP acceptance. Never invoked by an application timer.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

const OUTPUT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../output/cloud-verification');
const SESSION_COOKIE = /^(?:__Secure-|__Host-)?better-auth\.session_token(?:\.\d+)?$/;
const MAX_BODY_BYTES = 256 * 1024;
class SafeFailure extends Error {
    constructor(code) { super(code); this.code = code; }
}
const requireSafe = (condition, code) => { if (!condition) throw new SafeFailure(code); };

export function validateCloudOrigin(value) {
    let url;
    try { url = new URL(value); } catch { throw new SafeFailure('invalid_origin'); }
    requireSafe(url.protocol === 'https:' && !url.username && !url.password && !url.port
        && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:onrender\.com|vercel\.app|netlify\.app)$/.test(url.hostname)
        && url.pathname === '/' && !url.search && !url.hash, 'invalid_origin');
    return url.origin;
}

export function parseOptions(args) {
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
        const name = args[index];
        requireSafe(['--origin', '--env-file', '--timeout-ms', '--output', '--files'].includes(name)
            && options[name] === undefined && typeof args[index + 1] === 'string'
            && !args[index + 1].startsWith('--'), 'invalid_arguments');
        options[name] = args[index + 1];
    }
    requireSafe(Boolean(options['--origin']) && Boolean(options['--env-file']) && Boolean(options['--files']), 'missing_arguments');
    requireSafe(['enabled', 'disabled'].includes(options['--files']), 'invalid_file_expectation');
    const timeoutMs = Number(options['--timeout-ms'] ?? 60_000);
    requireSafe(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 60_000, 'invalid_timeout');
    const envPath = resolve(options['--env-file']);
    const outputPath = resolve(options['--output'] ?? resolve(OUTPUT_ROOT, 'cloud-acceptance-' + Date.now() + '.json'));
    const outputRelative = relative(OUTPUT_ROOT, outputPath);
    requireSafe(outputRelative && !outputRelative.startsWith('..') && !isAbsolute(outputRelative)
        && outputPath.endsWith('.json') && outputPath !== envPath, 'invalid_output');
    return { origin: validateCloudOrigin(options['--origin']), envPath, outputPath, timeoutMs,
        expectedFiles: options['--files'] === 'enabled' };
}

/** Bind credentials to the independently configured target before any request. */
export function validateCredentialTarget(environment, origin) {
    requireSafe(validateCloudOrigin(environment.CLOUD_ACCESS_EXPECTED_ORIGIN) === validateCloudOrigin(origin), 'credential_target_mismatch');
}

function parseCookie(header, hostname) {
    const [pair, ...rawAttributes] = header.split(';');
    const index = pair.indexOf('=');
    if (index < 1) return null;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) || /[\x00-\x20\x7f;,]/.test(value)) return null;
    const attributes = new Map(rawAttributes.map(raw => {
        const at = raw.indexOf('=');
        return at < 0 ? [raw.trim().toLowerCase(), ''] : [raw.slice(0, at).trim().toLowerCase(), raw.slice(at + 1).trim()];
    }));
    if (attributes.has('domain') && attributes.get('domain').replace(/^\./, '').toLowerCase() !== hostname) return null;
    const expired = (attributes.has('max-age') && Number(attributes.get('max-age')) <= 0)
        || (!attributes.has('max-age') && attributes.has('expires') && Date.parse(attributes.get('expires')) <= Date.now());
    return { name, value, path: attributes.get('path') || '/', expired,
        secure: attributes.has('secure'), httpOnly: attributes.has('httponly') };
}

async function boundedJson(response) {
    if (Number(response.headers.get('content-length') || 0) > MAX_BODY_BYTES) {
        await response.body?.cancel().catch(() => {});
        throw new SafeFailure('response_too_large');
    }
    if (!response.body) return null;
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            length += value.byteLength;
            requireSafe(length <= MAX_BODY_BYTES, 'response_too_large');
            chunks.push(value);
        }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new SafeFailure('invalid_json_response'); }
}

/** Only these eight fixed requests are made. A failed post-login check may add one cleanup logout. */
export async function runCloudAcceptance({ origin, expectedFiles, email, password, timeoutMs = 60_000 }, { fetchImpl = fetch } = {}) {
    origin = validateCloudOrigin(origin);
    requireSafe(typeof expectedFiles === 'boolean', 'invalid_file_expectation');
    requireSafe(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 60_000, 'invalid_timeout');
    requireSafe(typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        && email.length <= 255 && typeof password === 'string' && password.length >= 16
        && password.length <= 128 && !/[\x00-\x1f\x7f]/.test(password), 'invalid_credentials');
    const hostname = new URL(origin).hostname;
    const cookies = new Map();
    const results = [];
    let phase = 'health';
    let logoutAttempted = false;
    let oldSessionRevoked = false;
    const hasSession = jar => [...jar.values()].some(cookie => SESSION_COOKIE.test(cookie.name) && cookie.value);
    async function request(method, path, body, jar = cookies) {
        const headers = { accept: 'application/json', origin };
        const matching = [...jar.values()].filter(cookie => path === cookie.path || path.startsWith(cookie.path.endsWith('/') ? cookie.path : cookie.path + '/'));
        if (matching.length) headers.cookie = matching.map(cookie => cookie.name + '=' + cookie.value).join('; ');
        const csrf = jar.get('csrf-token');
        if (csrf) headers['x-csrf-token'] = csrf.value;
        if (body !== undefined) headers['content-type'] = 'application/json';
        const response = await fetchImpl(origin + path, { method, headers,
            body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual',
            signal: AbortSignal.timeout(timeoutMs) });
        const received = response.headers.getSetCookie().map(header => parseCookie(header, hostname)).filter(Boolean);
        for (const cookie of received) {
            if (cookie.expired || cookie.value === '') jar.delete(cookie.name);
            else jar.set(cookie.name, cookie);
        }
        if (response.status >= 300 && response.status < 400) {
            await response.body?.cancel().catch(() => {});
            throw new SafeFailure('redirect_refused');
        }
        return { status: response.status, data: await boundedJson(response), received };
    }
    function check(name, condition, httpStatus) {
        results.push({ check: name, passed: Boolean(condition), ...(httpStatus === undefined ? {} : { httpStatus }) });
        requireSafe(condition, 'check_failed');
    }
    try {
        const health = await request('GET', '/health');
        check('health', health.status === 200 && health.data?.status === 'alive', health.status);
        phase = 'readiness';
        const ready = await request('GET', '/ready');
        check('ready', ready.status === 200 && ready.data?.status === 'ready', ready.status);
        phase = 'capabilities';
        const capabilities = await request('GET', '/api/capabilities');
        check('capabilities_http', capabilities.status === 200, capabilities.status);
        const caps = capabilities.data;
        check('full_application', caps?.mode === 'full' && caps?.syntheticDataOnly === false && caps?.capabilities?.metadata === true);
        check('expected_file_capabilities', caps?.capabilities?.files === expectedFiles && caps?.capabilities?.fileUploads === expectedFiles);
        check('password_auth_provider', caps?.authentication?.provider === 'better-auth');
        phase = 'unauthenticated_access';
        const anonymous = await request('GET', '/api/unit-kerja');
        check('unauthenticated_access_denied', anonymous.status === 401, anonymous.status);
        phase = 'login';
        const login = await request('POST', '/api/auth/sign-in/email', { email, password });
        check('credential_login', login.status === 200, login.status);
        const sessionCookies = login.received.filter(cookie => SESSION_COOKIE.test(cookie.name) && cookie.value && !cookie.expired);
        check('session_cookie_secure_httponly', sessionCookies.length > 0 && sessionCookies.every(cookie => cookie.secure && cookie.httpOnly));
        const oldSession = new Map(cookies);
        phase = 'authenticated_access';
        const authenticated = await request('GET', '/api/unit-kerja');
        check('authenticated_unit_list', authenticated.status === 200 && authenticated.data?.success === true && Array.isArray(authenticated.data?.data), authenticated.status);
        phase = 'logout';
        logoutAttempted = true;
        const logout = await request('POST', '/api/auth/sign-out', {});
        check('logout_response', logout.status === 200 && logout.data?.success === true, logout.status);
        check('session_cookie_cleared', !hasSession(cookies));
        phase = 'old_session';
        const oldSessionResponse = await request('GET', '/api/unit-kerja', undefined, oldSession);
        oldSessionRevoked = oldSessionResponse.status === 401;
        check('old_session_denied_after_logout', oldSessionRevoked, oldSessionResponse.status);
        oldSession.clear();
    } catch (error) {
        results.push({ check: 'execution', passed: false, phase,
            failure: error instanceof SafeFailure ? error.code
                : error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'request_timeout' : 'request_failed' });
    } finally {
        // If login succeeded but a later assertion failed, revoke only this test's session.
        // Never retry a login or a logout whose response is uncertain.
        if (!logoutAttempted && hasSession(cookies)) {
            logoutAttempted = true;
            try {
                const cleanup = await request('POST', '/api/auth/sign-out', {});
                results.push({ check: 'cleanup_logout_response', passed: cleanup.status === 200 && cleanup.data?.success === true, httpStatus: cleanup.status });
            } catch { results.push({ check: 'cleanup_logout_response', passed: false }); }
        }
        cookies.clear();
    }
    // This proves access/session behavior only, never archival production readiness.
    return { scope: 'http-access-and-session', expectedFiles,
        passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed).length,
        oldSessionRevoked, results };
}

async function main() {
    let result;
    let options;
    try {
        options = parseOptions(process.argv.slice(2));
        requireSafe((await stat(options.envPath)).size <= 64 * 1024, 'environment_file_too_large');
        const environment = parseEnv(await readFile(options.envPath, 'utf8'));
        validateCredentialTarget(environment, options.origin);
        result = await runCloudAcceptance({ origin: options.origin, timeoutMs: options.timeoutMs, expectedFiles: options.expectedFiles,
            email: environment.FIRST_ADMIN_EMAIL, password: environment.FIRST_ADMIN_PASSWORD });
    } catch (error) {
        result = { passed: 0, failed: 1, oldSessionRevoked: false, results: [{ check: 'configuration', passed: false,
            failure: error instanceof SafeFailure ? error.code : 'configuration_unavailable' }] };
    }
    if (options) {
        try {
            await mkdir(dirname(options.outputPath), { recursive: true });
            await writeFile(options.outputPath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        } catch {
            result.results.push({ check: 'evidence_saved', passed: false, failure: 'evidence_write_failed' });
            result.failed += 1;
        }
    }
    // No origin, email, env values, response bodies, cookie values, or raw exceptions.
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exitCode = result.failed === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
