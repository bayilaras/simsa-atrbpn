#!/usr/bin/env node
// Unauthenticated HTTP smoke checks recorded by hand in every HASIL_RILIS_*
// report since C47, now repeatable: liveness, readiness (with cold-start
// retries), and 401 for protected routes; for the frontend also the SPA shell,
// its entry bundle, deep links and the same-origin API proxy. No session, no
// writes; responses are summarized, never printed whole.
//
//   release-smoke.mjs backend|frontend <https origin>
// SMOKE_PROTECTION_BYPASS (optional) is sent as x-vercel-protection-bypass so
// protected candidate URLs can be checked before promotion.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const unauthorized = path => ({ path, status: 401 });
export const CHECKS = Object.freeze({
  backend: [{ path: '/health', status: 200, expect: body => body?.status === 'alive' }, { path: '/ready', status: 200, retry: true },
    unauthorized('/api/surat-keluar'), unauthorized('/api/export/surat-keluar'), unauthorized('/api/import/google-drive/sheets'),
    unauthorized('/api/operations/probe'), { ...unauthorized('/api/operations/scanner-wake'), method: 'POST' }],
  frontend: [{ path: '/', status: 200, shell: true }, { path: '/surat-masuk', status: 200, shell: true },
    { path: '/health', status: 200, expect: body => body?.status === 'alive' }, { path: '/ready', status: 200, retry: true },
    unauthorized('/api/surat-keluar'), unauthorized('/api/operations/probe')],
});
const SAFE_WORD = /^[A-Za-z0-9_.-]{1,64}$/;
const HEALTHY_STATES = new Set(['ready', 'disabled', 'delegated_to_worker', 'on_demand']);

/** Names only the dependencies that are not ready, from a fixed vocabulary. */
export function readinessSummary(body) {
  const dependencies = body && typeof body.dependencies === 'object' ? Object.entries(body.dependencies) : [];
  const failing = dependencies.filter(([name, value]) => SAFE_WORD.test(name) && typeof value?.state === 'string' && !HEALTHY_STATES.has(value.state))
    .map(([name, value]) => `${name}=${SAFE_WORD.test(value.state) ? value.state : '?'}${SAFE_WORD.test(value.reason ?? '') ? '/' + value.reason : ''}`);
  return [SAFE_WORD.test(body?.status ?? '') ? body.status : '?', ...failing].join(' ');
}

export function assertOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Origin tidak valid.'); }
  if (url.protocol !== 'https:' || url.origin !== value.replace(/\/$/, '') || !url.hostname.endsWith('.vercel.app')) throw new Error('Origin harus https://*.vercel.app tanpa path.');
  return url.origin;
}

export async function runSmoke(component, origin, { fetcher = fetch, bypass = '', log = console.log, sleep = ms => new Promise(done => setTimeout(done, ms)), attempts = 6 } = {}) {
  if (!Object.hasOwn(CHECKS, component)) throw new Error('Komponen harus backend atau frontend.');
  const base = assertOrigin(origin);
  const headers = { Accept: 'application/json, text/html;q=0.9', 'Cache-Control': 'no-cache', ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}) };
  const request = async (path, method = 'GET') => {
    try {
      const response = await fetcher(base + path, { method, headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
      const text = (await response.text()).slice(0, 262144);
      return { status: response.status, type: response.headers.get('content-type') ?? '', text };
    } catch (error) { return { status: 0, type: '', text: '', error: error?.name ?? 'Error' }; }
  };
  const results = [];
  const record = (ok, label, detail = '') => { results.push({ ok, check: label }); log(`${ok ? 'ok   ' : 'GAGAL'} ${label}${detail ? ' ' + detail : ''}`); };
  for (const check of CHECKS[component]) {
    const label = `${check.method ?? 'GET'} ${check.path}`;
    let response;
    for (let attempt = 1; ; attempt++) {
      response = await request(check.path, check.method);
      if (!check.retry || response.status === check.status || attempt >= attempts) break;
      await sleep(10000); // Cold start or a scanner verification refresh in progress.
    }
    let body;
    if (response.type.includes('json')) { try { body = JSON.parse(response.text); } catch { body = undefined; } }
    let ok = response.status === check.status && (!check.expect || check.expect(body));
    let detail = `${response.status || response.error}`;
    if (check.path === '/ready' && body) detail += ` (${readinessSummary(body)})`;
    if (check.shell) {
      const entry = response.text.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
      ok &&= response.type.includes('text/html') && response.text.includes('<div id="root">') && Boolean(entry);
      if (ok && check.path === '/') {
        const asset = await request(entry);
        record(asset.status === 200 && /javascript/.test(asset.type), `GET ${entry}`, String(asset.status || asset.error));
      }
    }
    record(ok, label, detail);
  }
  return results.every(result => result.ok);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [component, origin] = process.argv.slice(2);
  try {
    process.exitCode = await runSmoke(component, origin ?? '', { bypass: process.env.SMOKE_PROTECTION_BYPASS ?? '' }) ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
