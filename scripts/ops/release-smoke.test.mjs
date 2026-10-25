import test from 'node:test';
import assert from 'node:assert/strict';
import { assertOrigin, readinessSummary, runSmoke } from './release-smoke.mjs';

const shell = '<!doctype html><div id="root"></div><script type="module" crossorigin src="/assets/index-xFjK6RSJ.js"></script>';
function site(overrides = {}) {
  const calls = [];
  const routes = {
    'GET /health': [200, 'application/json', { status: 'alive' }],
    'GET /ready': [200, 'application/json', { status: 'ready', dependencies: { database: { state: 'ready' } } }],
    'GET /': [200, 'text/html; charset=utf-8', shell], 'GET /surat-masuk': [200, 'text/html', shell],
    'GET /assets/index-xFjK6RSJ.js': [200, 'application/javascript', 'export{}'], ...overrides,
  };
  const fetcher = async (url, options) => {
    const { pathname } = new URL(url);
    calls.push({ key: `${options.method} ${pathname}`, options });
    const route = routes[`${options.method} ${pathname}`];
    const [status, type, body] = typeof route === 'function' ? route() : route ?? [401, 'application/json', { error: 'Unauthorized' }];
    return { status, headers: new Headers({ 'content-type': type }), text: async () => typeof body === 'string' ? body : JSON.stringify(body) };
  };
  return { calls, fetcher };
}
const quiet = { log: () => {}, sleep: async () => {} };

test('backend smoke checks liveness, readiness and 401 on protected routes without any credential', async () => {
  const { calls, fetcher } = site();
  assert.equal(await runSmoke('backend', 'https://simsa-backend.vercel.app', { fetcher, ...quiet }), true);
  assert.deepEqual(calls.map(call => call.key), ['GET /health', 'GET /ready', 'GET /api/surat-keluar', 'GET /api/export/surat-keluar',
    'GET /api/import/google-drive/sheets', 'GET /api/operations/probe', 'POST /api/operations/scanner-wake']);
  assert.ok(calls.every(call => !('authorization' in call.options.headers) && !('x-vercel-protection-bypass' in call.options.headers)));
  assert.ok(calls.every(call => call.options.redirect === 'manual'));
});

test('frontend smoke checks the SPA shell, its entry bundle, deep links and the API proxy', async () => {
  const lines = [];
  const { calls, fetcher } = site();
  assert.equal(await runSmoke('frontend', 'https://simsa-frontend.vercel.app/', { fetcher, ...quiet, log: line => lines.push(line), bypass: 'bypass-secret' }), true);
  assert.ok(calls.some(call => call.key === 'GET /assets/index-xFjK6RSJ.js'));
  assert.ok(calls.every(call => call.options.headers['x-vercel-protection-bypass'] === 'bypass-secret'));
  assert.ok(lines.every(line => !line.includes('bypass-secret')));
  for (const broken of [{ 'GET /': [200, 'text/html', '<html>maintenance</html>'] }, { 'GET /assets/index-xFjK6RSJ.js': [404, 'text/html', 'x'] },
    { 'GET /surat-masuk': [404, 'text/html', 'x'] }, { 'GET /api/surat-keluar': [200, 'application/json', []] },
    { 'GET /health': [200, 'application/json', { status: 'down' }] }]) {
    assert.equal(await runSmoke('frontend', 'https://simsa-frontend.vercel.app', { fetcher: site(broken).fetcher, ...quiet }), false, JSON.stringify(broken));
  }
});

test('readiness is retried for cold starts and failures name only the unready dependencies', async () => {
  let readyCalls = 0;
  const notReady = [503, 'application/json', { status: 'not_ready', dependencies: { database: { state: 'ready' },
    malwareWorker: { state: 'not_ready', reason: 'on_demand_verification_missing_or_expired', detail: 'postgresql://secret' } } }];
  const recovering = site({ 'GET /ready': () => (++readyCalls < 3 ? notReady : [200, 'application/json', { status: 'ready' }]) });
  assert.equal(await runSmoke('backend', 'https://simsa-backend.vercel.app', { fetcher: recovering.fetcher, ...quiet }), true);
  assert.equal(readyCalls, 3);
  const lines = [];
  const stuck = site({ 'GET /ready': () => notReady });
  assert.equal(await runSmoke('backend', 'https://simsa-backend.vercel.app', { fetcher: stuck.fetcher, ...quiet, log: line => lines.push(line), attempts: 2 }), false);
  assert.ok(lines.includes('GAGAL GET /ready 503 (not_ready malwareWorker=not_ready/on_demand_verification_missing_or_expired)'));
  assert.ok(lines.every(line => !line.includes('secret')));
  assert.equal(readinessSummary({ status: 'x y', dependencies: { 'bad name': { state: 'down' }, ok: { state: 'weird state!' } } }), '? ok=?');
});

test('network errors fail the check, and only https vercel.app origins without paths are accepted', async () => {
  const failing = async () => { throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.1'), { name: 'TypeError' }); };
  const lines = [];
  assert.equal(await runSmoke('backend', 'https://simsa-backend.vercel.app', { fetcher: failing, ...quiet, log: line => lines.push(line), attempts: 1 }), false);
  assert.ok(lines.every(line => !line.includes('10.0.0.1')));
  for (const origin of ['http://simsa-backend.vercel.app', 'https://simsa-backend.vercel.app/api', 'https://example.com', 'nonsense']) {
    assert.throws(() => assertOrigin(origin));
  }
  await assert.rejects(runSmoke('docs', 'https://simsa-backend.vercel.app', quiet), /backend atau frontend/);
});
