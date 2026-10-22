import test from 'node:test';
import assert from 'node:assert/strict';
import { assertServing, checkCandidate, currentProduction, deploymentReference, vercelClient } from './vercel-release.mjs';

const token = 'synthetic-vercel-token-not-real-0123456789';
const project = 'prj_syntheticBackend01';
const candidate = { id: 'dpl_candidate0123456789', url: 'simsa-backend-abc123-team.vercel.app', projectId: project, target: 'production', readyState: 'READY' };

function fakeApi(routes) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    const { pathname } = new URL(url);
    const body = routes[pathname];
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, text: async () => JSON.stringify(body ?? { error: { message: 'secret detail' } }) };
  };
  return { calls, get: vercelClient({ token, teamId: 'team_synthetic01', fetcher }) };
}

test('client sends the token only as a bearer header, pins the team and never echoes error bodies', async () => {
  const { calls, get } = fakeApi({ '/v4/aliases/simsa-backend.vercel.app': { deploymentId: 'dpl_previous0123456789', protectionBypass: 'hidden' } });
  assert.deepEqual(await currentProduction(get, { component: 'backend' }), { component: 'backend', alias: 'simsa-backend.vercel.app', id: 'dpl_previous0123456789' });
  assert.equal(calls[0].url, 'https://api.vercel.com/v4/aliases/simsa-backend.vercel.app?teamId=team_synthetic01');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${token}`); assert.equal(calls[0].options.redirect, 'error');
  await assert.rejects(get('/v13/deployments/dpl_missing01234'), error => error.message === 'Vercel API /v13/deployments/dpl_missing01234 HTTP 404');
  assert.throws(() => vercelClient({ token: '', teamId: 'team_synthetic01' }), /VERCEL_TOKEN/);
  assert.throws(() => vercelClient({ token, teamId: '' }), /VERCEL_ORG_ID/);
  await assert.rejects(currentProduction(get, { component: 'docs' }), /backend atau frontend/);
});

test('deployment references are a dpl id or a vercel.app URL only', () => {
  assert.equal(deploymentReference('https://simsa-backend-abc123-team.vercel.app/\n'), 'simsa-backend-abc123-team.vercel.app');
  assert.equal(deploymentReference('dpl_31FvsRbDVi5KTYkBmkVTNxKZApmw'), 'dpl_31FvsRbDVi5KTYkBmkVTNxKZApmw');
  for (const value of ['', 'https://evil.example/x', 'simsa.vercel.app/../x', 'dpl_', '../v4/aliases']) assert.throws(() => deploymentReference(value));
});

test('a candidate must be READY, production-target, in the pinned project and not already serving', async () => {
  const aliases = { '/v4/aliases/simsa-backend.vercel.app': { deploymentId: 'dpl_previous0123456789' } };
  const { get } = fakeApi({ ...aliases, '/v13/deployments/simsa-backend-abc123-team.vercel.app': candidate });
  assert.deepEqual(await checkCandidate(get, { component: 'backend', deployment: 'https://simsa-backend-abc123-team.vercel.app', projectId: project }),
    { component: 'backend', id: candidate.id, url: 'https://simsa-backend-abc123-team.vercel.app', current: 'dpl_previous0123456789' });
  for (const [changes, message] of [[{ projectId: 'prj_otherProject01' }, /project Vercel lain/], [{ target: null }, /--prod/],
    [{ readyState: 'ERROR' }, /belum READY \(ERROR\)/], [{ id: 'x' }, /tidak valid/]]) {
    const api = fakeApi({ ...aliases, '/v13/deployments/dpl_candidate0123456789': { ...candidate, ...changes } });
    await assert.rejects(checkCandidate(api.get, { component: 'backend', deployment: 'dpl_candidate0123456789', projectId: project }), message);
  }
  const serving = fakeApi({ '/v4/aliases/simsa-backend.vercel.app': { deploymentId: candidate.id }, '/v13/deployments/dpl_candidate0123456789': candidate });
  await assert.rejects(checkCandidate(serving.get, { component: 'backend', deployment: candidate.id, projectId: project }), /sudah melayani/);
  await assert.rejects(checkCandidate(serving.get, { component: 'backend', deployment: candidate.id, projectId: '' }), /VERCEL_PROJECT_ID/);
});

test('after promotion the canonical alias must serve the promoted READY deployment, with bounded retries', async () => {
  let served = 'dpl_previous0123456789';
  const routes = { '/v13/deployments/dpl_candidate0123456789': candidate };
  const fetcher = async url => {
    const { pathname } = new URL(url);
    const body = pathname.startsWith('/v4/aliases/') ? { deploymentId: served } : routes[pathname];
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  const get = vercelClient({ token, teamId: 'team_synthetic01', fetcher });
  let sleeps = 0;
  const sleep = async () => { sleeps++; served = candidate.id; };
  assert.deepEqual(await assertServing(get, { component: 'backend', deployment: candidate.id }, { sleep }),
    { component: 'backend', alias: 'simsa-backend.vercel.app', id: candidate.id });
  assert.equal(sleeps, 1);
  served = 'dpl_previous0123456789';
  await assert.rejects(assertServing(get, { component: 'backend', deployment: candidate.id }, { attempts: 2, sleep: async () => {} }), /masih melayani dpl_previous/);
  await assert.rejects(assertServing(get, { component: 'backend', deployment: 'https://x.vercel.app' }), /dpl_/);
});
