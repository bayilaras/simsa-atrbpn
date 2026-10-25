#!/usr/bin/env node
// Read-only Vercel REST checks for .github/workflows/release-vercel.yml. A
// candidate must be READY, built for production in the expected project and
// not yet serving; after `vercel promote` the canonical alias must serve that
// exact deployment. Deploy and promote stay with the pinned Vercel CLI.
// VERCEL_TOKEN goes only into the Authorization header; responses are never
// printed whole (alias objects can carry protection bypass values).
//
//   candidate --component backend|frontend --deployment <url|dpl_id>
//   current   --component backend|frontend
//   serving   --component backend|frontend --deployment <dpl_id>
// Environment: VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID (candidate only).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const ALIASES = Object.freeze({ backend: 'simsa-backend.vercel.app', frontend: 'simsa-frontend.vercel.app' });
const fail = message => { throw new Error(message); };
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{8,64}$/;

/** Accepts a dpl_ id or a *.vercel.app deployment URL; returns the API path segment. */
export function deploymentReference(value) {
  const reference = String(value ?? '').trim().replace(/^https:\/\//, '').replace(/\/$/, '');
  if (!DEPLOYMENT_ID.test(reference) && !/^[a-z0-9][a-z0-9-]{0,62}\.vercel\.app$/.test(reference)) fail('Deployment harus dpl_... atau URL *.vercel.app.');
  return reference;
}

export function vercelClient({ token, teamId, fetcher = fetch }) {
  if (typeof token !== 'string' || token.length < 20) fail('VERCEL_TOKEN belum dikonfigurasi.');
  if (!/^(team_)?[A-Za-z0-9]{8,64}$/.test(teamId ?? '')) fail('VERCEL_ORG_ID belum dikonfigurasi.');
  return async path => {
    const response = await fetcher(`https://api.vercel.com${path}?teamId=${encodeURIComponent(teamId)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(30000) });
    const body = await response.text();
    if (!response.ok) fail(`Vercel API ${path} HTTP ${response.status}`);
    return JSON.parse(body);
  };
}

const deployment = async (get, reference) => {
  const value = await get(`/v13/deployments/${encodeURIComponent(deploymentReference(reference))}`);
  if (!DEPLOYMENT_ID.test(value?.id ?? '')) fail('Respons deployment Vercel tidak valid.');
  return value;
};
const servingId = async (get, component) => {
  if (!Object.hasOwn(ALIASES, component ?? '')) fail('--component harus backend atau frontend.');
  const alias = await get(`/v4/aliases/${ALIASES[component]}`);
  if (!DEPLOYMENT_ID.test(alias?.deploymentId ?? '')) fail(`Alias ${ALIASES[component]} tidak menunjuk deployment.`);
  return alias.deploymentId;
};

export async function checkCandidate(get, { component, deployment: reference, projectId }) {
  if (!/^prj_[A-Za-z0-9]{8,64}$/.test(projectId ?? '')) fail('VERCEL_PROJECT_ID belum dikonfigurasi.');
  const candidate = await deployment(get, reference);
  if (candidate.projectId !== projectId) fail('Kandidat milik project Vercel lain.');
  if (candidate.target !== 'production') fail('Kandidat tidak dibangun dengan environment Production (--prod).');
  if (candidate.readyState !== 'READY') fail(`Kandidat belum READY (${String(candidate.readyState).slice(0, 20)}).`);
  const current = await servingId(get, component);
  if (current === candidate.id) fail('Kandidat sudah melayani alias produksi; tidak ada yang dipromosikan.');
  return { component, id: candidate.id, url: `https://${candidate.url}`, current };
}

export async function currentProduction(get, { component }) {
  return { component, alias: ALIASES[component], id: await servingId(get, component) };
}

export async function assertServing(get, { component, deployment: id }, { attempts = 6, sleep = ms => new Promise(done => setTimeout(done, ms)) } = {}) {
  if (!DEPLOYMENT_ID.test(id ?? '')) fail('--deployment harus dpl_...');
  for (let attempt = 1; ; attempt++) {
    const serving = await servingId(get, component);
    if (serving === id) {
      const value = await deployment(get, id);
      if (value.readyState !== 'READY') fail('Deployment yang melayani alias tidak READY.');
      return { component, alias: ALIASES[component], id };
    }
    if (attempt >= attempts) fail(`${ALIASES[component]} masih melayani ${serving}, bukan ${id}.`);
    await sleep(5000);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { positionals: [action], values } = parseArgs({ allowPositionals: true,
      options: { component: { type: 'string' }, deployment: { type: 'string' } } });
    const get = vercelClient({ token: process.env.VERCEL_TOKEN, teamId: process.env.VERCEL_ORG_ID });
    const result = action === 'candidate' ? await checkCandidate(get, { ...values, projectId: process.env.VERCEL_PROJECT_ID })
      : action === 'current' ? await currentProduction(get, values)
        : action === 'serving' ? await assertServing(get, values) : fail('Gunakan: vercel-release.mjs candidate|current|serving.');
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
