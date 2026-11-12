import test from 'node:test';
import assert from 'node:assert/strict';
import { ISSUE_TITLE, failureReport, reportWorkflowFailure } from './report-workflow-failure.mjs';

const environment = { GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'example-org/example-repo', GITHUB_RUN_ID: '123456789' };
const runUrl = 'https://github.com/example-org/example-repo/actions/runs/123456789';
const now = Date.parse('2026-11-13T12:00:00Z');
function recorder(issues) {
  const calls = [];
  return { calls, gh: async args => { calls.push(args); return args[1] === 'list' ? JSON.stringify(issues) : ''; } };
}

test('the issue text is one fixed sentence and the run link, nothing about the system', () => {
  const report = failureReport(environment);
  assert.equal(report.title, 'Pemeriksaan operasional gagal');
  assert.equal(report.body, `Pemeriksaan operasional terjadwal gagal atau terhenti sebelum selesai.\n\nRun: ${runUrl}\n\n`
    + 'Rincian hanya tersedia bagi pengelola pada halaman run tersebut. Tutup isu ini setelah penyebabnya ditangani; kegagalan berikutnya membuka isu baru.');
  // Extra environment content never reaches the issue.
  const noisy = failureReport({ ...environment, OPERATIONS_MONITOR_TOKEN: 'secret-token-value', NEON_EXPECTED_HOST: 'db.internal.example', GITHUB_WORKFLOW: 'private name' });
  assert.equal(noisy.body, report.body);
  assert.doesNotMatch(JSON.stringify(noisy), /secret-token-value|db\.internal\.example|private name/);
});

test('the first failure opens the issue', async () => {
  const { gh, calls } = recorder([{ number: 4, title: 'Hal lain', updatedAt: '2026-11-13T11:59:00Z' }]);
  assert.deepEqual(await reportWorkflowFailure(environment, { gh, now: () => now }), { action: 'created' });
  assert.deepEqual(calls[0], ['issue', 'list', '--repo', 'example-org/example-repo', '--state', 'open', '--limit', '200', '--json', 'number,title,updatedAt']);
  assert.deepEqual(calls[1].slice(0, 6), ['issue', 'create', '--repo', 'example-org/example-repo', '--title', ISSUE_TITLE]);
  assert.match(calls[1][7], new RegExp(`Run: ${runUrl.replaceAll('.', '\\.')}`));
  assert.equal(calls.length, 2);
});

test('a later failure comments on the open issue with exactly that title', async () => {
  const { gh, calls } = recorder([
    { number: 9, title: `${ISSUE_TITLE} (lama)`, updatedAt: '2026-11-01T00:00:00Z' },
    { number: 12, title: ISSUE_TITLE, updatedAt: '2026-11-12T00:00:00Z' },
    { number: 7, title: ISSUE_TITLE, updatedAt: '2026-11-10T00:00:00Z' },
  ]);
  assert.deepEqual(await reportWorkflowFailure(environment, { gh, now: () => now }), { action: 'commented' });
  assert.deepEqual(calls[1].slice(0, 5), ['issue', 'comment', '7', '--repo', 'example-org/example-repo']);
  assert.equal(calls.some(call => call[1] === 'create'), false);
});

test('an hourly workflow does not comment again within its minimum interval', async () => {
  const hourly = { ...environment, FAILURE_ISSUE_MIN_HOURS: '6' };
  const recent = recorder([{ number: 7, title: ISSUE_TITLE, updatedAt: '2026-11-13T06:00:01Z' }]);
  assert.deepEqual(await reportWorkflowFailure(hourly, { gh: recent.gh, now: () => now }), { action: 'already_reported' });
  assert.equal(recent.calls.length, 1);
  const old = recorder([{ number: 7, title: ISSUE_TITLE, updatedAt: '2026-11-13T06:00:00Z' }]);
  assert.deepEqual(await reportWorkflowFailure(hourly, { gh: old.gh, now: () => now }), { action: 'commented' });
  // Without an interval every failure is reported, and a missing issue is always opened.
  const daily = recorder([{ number: 7, title: ISSUE_TITLE, updatedAt: '2026-11-13T11:59:59Z' }]);
  assert.deepEqual(await reportWorkflowFailure({ ...environment, FAILURE_ISSUE_MIN_HOURS: '' }, { gh: daily.gh, now: () => now }), { action: 'commented' });
  const none = recorder([]);
  assert.deepEqual(await reportWorkflowFailure(hourly, { gh: none.gh, now: () => now }), { action: 'created' });
});

test('an unexpected run context or interval is refused before gh is called', async () => {
  for (const patch of [{ GITHUB_SERVER_URL: 'https://github.example' }, { GITHUB_REPOSITORY: 'owner/repo/extra' }, { GITHUB_REPOSITORY: 'owner repo' },
    { GITHUB_RUN_ID: '12 --body x' }, { GITHUB_RUN_ID: undefined }, { FAILURE_ISSUE_MIN_HOURS: '6h' }, { FAILURE_ISSUE_MIN_HOURS: '169' }]) {
    const { gh, calls } = recorder([]);
    await assert.rejects(reportWorkflowFailure({ ...environment, ...patch }, { gh }), error => /^FAILURE_REPORT_(CONTEXT|INTERVAL)_INVALID$/.test(error.safeCode));
    assert.equal(calls.length, 0);
  }
});
