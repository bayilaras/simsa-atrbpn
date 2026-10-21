import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const yaml = createRequire(resolve(import.meta.dirname, '../../frontend/package.json'))('js-yaml');
const source = await readFile(resolve(import.meta.dirname, '../../.github/workflows/release-vercel.yml'), 'utf8');
const workflow = yaml.load(source);
const jobs = workflow.jobs;
const steps = name => jobs[name].steps;
const runs = name => steps(name).map(step => step.run ?? '').join('\n');

test('release is manual, gated by a repository variable, single-flight and read-only by default', () => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  // A disabled or misdirected dispatch fails visibly in the first step instead of skipping every job.
  const [enabled] = steps('source');
  assert.equal(jobs.source.if, undefined);
  assert.match(enabled.env.ENABLED, /vars\.RELEASE_VERCEL_ENABLED/); assert.match(enabled.run, /"\$GITHUB_REF" = "\$DEFAULT_REF"/);
  assert.equal(jobs.source.environment, undefined);
  for (const job of Object.values(jobs)) assert.doesNotMatch(job.if ?? '', /always\(\)/);
  assert.match(runs('source'), /GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}/);
  assert.deepEqual(Object.values(jobs.source.permissions).filter(value => value !== 'read'), []);
  assert.match(workflow.env.VERCEL_CLI_PACKAGE, /^vercel@\d+\.\d+\.\d+$/);
});

test('candidates deploy backend then frontend without a domain; only the approved production job promotes', () => {
  assert.deepEqual(Object.keys(jobs), ['source', 'backend-candidate', 'frontend-candidate', 'promote']);
  for (const name of ['backend-candidate', 'frontend-candidate']) {
    assert.equal(jobs[name].environment, 'production-candidate');
    assert.match(runs(name), /vercel deploy --prod --skip-domain --yes --build-env SIMSA_VERIFY_CANDIDATE_SOURCE=1/);
    assert.match(runs(name), /release-source\.mjs extract/);
    assert.match(runs(name), new RegExp(`SIMSA candidate ${name.split('-')[0]}: source checks passed`));
    assert.doesNotMatch(runs(name), /vercel promote/);
  }
  assert.ok(jobs['frontend-candidate'].needs.includes('backend-candidate'));
  assert.equal(jobs.promote.environment, 'production');
  assert.deepEqual(jobs.promote.needs, ['source', 'backend-candidate', 'frontend-candidate']);
  const promote = runs('promote');
  assert.ok(promote.indexOf('vercel promote "$BACKEND_CANDIDATE"') < promote.indexOf('vercel promote "$FRONTEND_CANDIDATE"'));
  assert.match(promote, /release-smoke\.mjs backend https:\/\/simsa-backend\.vercel\.app/);
  assert.match(promote, /release-smoke\.mjs frontend https:\/\/simsa-frontend\.vercel\.app/);
  assert.match(promote, /check-operations\.mjs/);
  assert.match(runs('source'), /check-gcp-backend-production-gate\.py/);
  assert.doesNotMatch(runs('source') + runs('promote'), /vercel deploy/);
});

test('credentials and inputs never reach shell text, CLI arguments or disk; actions are pinned by SHA', () => {
  for (const [name, job] of Object.entries(jobs)) {
    for (const step of job.steps) {
      if (step.uses) assert.match(step.uses, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${name}: ${step.uses}`);
      if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false);
      assert.doesNotMatch(step.run ?? '', /\$\{\{/, `${name}: ${step.name} interpolates an expression into shell`);
      for (const [key, value] of Object.entries(step.with ?? {})) assert.doesNotMatch(String(value), /secrets\./, `${name}: with.${key}`);
    }
  }
  assert.doesNotMatch(source, /--token|vercel (pull|env|login)|DATABASE_URL|NEON_|PGPASSWORD/);
  const secretNames = [...source.matchAll(/secrets\.([A-Z_]+)/g)].map(match => match[1]);
  assert.deepEqual([...new Set(secretNames)].sort(), ['GITHUB_TOKEN', 'OPERATIONS_MONITOR_TOKEN', 'VERCEL_BACKEND_BYPASS_SECRET',
    'VERCEL_FRONTEND_BYPASS_SECRET', 'VERCEL_TOKEN']);
  assert.deepEqual(Object.values(workflow.on.workflow_dispatch.inputs).map(input => input.required), [true, true, true, true]);
});
