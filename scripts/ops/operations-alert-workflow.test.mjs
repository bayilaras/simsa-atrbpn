import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const yaml = createRequire(resolve(import.meta.dirname, '../../frontend/package.json'))('js-yaml');
const load = async name => {
  const source = await readFile(resolve(import.meta.dirname, '../../.github/workflows', name), 'utf8');
  return { source, workflow: yaml.load(source) };
};
const monitor = await load('operations-monitor.yml'), recovery = await load('operations-recovery.yml');
const cases = [['operations-monitor.yml', monitor, 'monitor'], ['operations-recovery.yml', recovery, 'recovery']];

for (const [name, { source, workflow }, main] of cases) {
  test(`${name}: a failed or timed-out run opens or updates the failure issue`, () => {
    assert.deepEqual(Object.keys(workflow.jobs), [main, 'notify-failure']);
    const notify = workflow.jobs['notify-failure'];
    assert.equal(notify.needs, main);
    assert.equal(notify.if, `\${{ always() && (needs.${main}.result == 'failure' || needs.${main}.result == 'cancelled') }}`);
    // A skipped main job (wrong branch, workflow disabled) or a success never reports.
    assert.doesNotMatch(notify.if, /skipped|success/);
    assert.equal(notify.steps.at(-1).run, 'node scripts/ops/report-workflow-failure.mjs');
    assert.ok(notify['timeout-minutes'] <= 5);
  });

  test(`${name}: only the notify job may write issues, and it sees no production secret`, () => {
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    assert.equal(workflow.jobs[main].permissions, undefined);
    const notify = workflow.jobs['notify-failure'];
    assert.deepEqual(notify.permissions, { contents: 'read', issues: 'write' });
    assert.equal(notify.environment, undefined);
    assert.doesNotMatch(JSON.stringify(notify), /secrets\.|vars\./);
    const reportEnv = notify.steps.at(-1).env;
    assert.equal(reportEnv.GH_TOKEN, '${{ github.token }}');
    assert.deepEqual(Object.keys(reportEnv).filter(key => !['GH_TOKEN', 'FAILURE_ISSUE_MIN_HOURS'].includes(key)), []);
    const [checkout] = notify.steps;
    assert.match(checkout.uses, /^actions\/checkout@[a-f0-9]{40}$/);
    assert.equal(checkout.with['persist-credentials'], false);
    for (const step of notify.steps) if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
    // The workflow itself never spells out issue text; the fixed wording lives in the tested script.
    assert.doesNotMatch(source, /gh issue|--body/);
  });
}

test('the hourly monitor limits repeat comments; the daily recovery reports every failure', () => {
  assert.equal(monitor.workflow.jobs['notify-failure'].steps.at(-1).env.FAILURE_ISSUE_MIN_HOURS, '6');
  assert.equal(recovery.workflow.jobs['notify-failure'].steps.at(-1).env.FAILURE_ISSUE_MIN_HOURS, undefined);
});

test('the recovery workflow passes the optional document budget settings and allows time for the default budget', () => {
  const job = recovery.workflow.jobs.recovery, run = job.steps.find(step => step.run === 'node scripts/operations-recovery.mjs run');
  for (const name of ['OPERATIONS_RECOVERY_MAX_DOCUMENT_BYTES', 'OPERATIONS_RECOVERY_MAX_DOCUMENT_OBJECTS', 'OPERATIONS_RECOVERY_MAX_DOCUMENT_REFERENCES'])
    assert.equal(run.env[name], `\${{ vars.${name} }}`);
  assert.equal(job['timeout-minutes'], 150);
});
