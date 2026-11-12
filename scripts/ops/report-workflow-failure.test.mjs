import test from 'node:test';
import assert from 'node:assert/strict';
import { ISSUE_TITLE, failureReport, reportWorkflowFailure } from './report-workflow-failure.mjs';

const environment = { GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'example-org/example-repo', GITHUB_RUN_ID: '123456789' };
const runUrl = 'https://github.com/example-org/example-repo/actions/runs/123456789';
const now = Date.parse('2026-11-13T12:00:00Z');
const bot = { login: 'app/github-actions', is_bot: true }, outsider = { login: 'someone-else', is_bot: false };
const LIST = ['issue', 'list', '--repo', 'example-org/example-repo', '--state', 'open', '--author', 'app/github-actions', '--limit', '200', '--json', 'number,title,createdAt,author'];
function recorder(issues, comments = []) {
  const calls = [];
  return { calls, gh: async args => { calls.push(args); return args[1] === 'list' ? JSON.stringify(issues) : args[0] === 'api' ? JSON.stringify(comments) : ''; } };
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
  const { gh, calls } = recorder([{ number: 4, title: 'Hal lain', createdAt: '2026-11-13T11:59:00Z', author: bot }]);
  assert.deepEqual(await reportWorkflowFailure(environment, { gh, now: () => now }), { action: 'created' });
  assert.deepEqual(calls[0], LIST);
  assert.deepEqual(calls[1].slice(0, 6), ['issue', 'create', '--repo', 'example-org/example-repo', '--title', ISSUE_TITLE]);
  assert.match(calls[1][7], new RegExp(`Run: ${runUrl.replaceAll('.', '\\.')}`));
  assert.equal(calls.length, 2);
});

test('a later failure comments on the open issue with exactly that title', async () => {
  const { gh, calls } = recorder([
    { number: 9, title: `${ISSUE_TITLE} (lama)`, createdAt: '2026-11-01T00:00:00Z', author: bot },
    { number: 12, title: ISSUE_TITLE, createdAt: '2026-11-12T00:00:00Z', author: bot },
    { number: 7, title: ISSUE_TITLE, createdAt: '2026-11-10T00:00:00Z', author: bot },
  ]);
  assert.deepEqual(await reportWorkflowFailure(environment, { gh, now: () => now }), { action: 'commented' });
  assert.deepEqual(calls[1].slice(0, 5), ['issue', 'comment', '7', '--repo', 'example-org/example-repo']);
  assert.equal(calls.some(call => call[1] === 'create'), false);
});

test('an issue with the same title that the workflow did not open is never used', async () => {
  for (const author of [outsider, undefined, { login: 'github-actions-fan' }]) {
    const { gh, calls } = recorder([{ number: 3, title: ISSUE_TITLE, createdAt: '2026-11-13T11:00:00Z', author }]);
    assert.deepEqual(await reportWorkflowFailure({ ...environment, FAILURE_ISSUE_MIN_HOURS: '6' }, { gh, now: () => now }), { action: 'created' });
    assert.equal(calls.some(call => call[1] === 'comment' || call[0] === 'api'), false);
  }
  const mixed = recorder([{ number: 3, title: ISSUE_TITLE, createdAt: '2026-11-01T00:00:00Z', author: outsider }, { number: 8, title: ISSUE_TITLE, createdAt: '2026-11-02T00:00:00Z', author: bot }]);
  assert.deepEqual(await reportWorkflowFailure(environment, { gh: mixed.gh, now: () => now }), { action: 'commented' });
  assert.equal(mixed.calls[1][2], '8');
});

test('an hourly workflow does not comment again within its minimum interval', async () => {
  const hourly = { ...environment, FAILURE_ISSUE_MIN_HOURS: '6' };
  // The issue itself was opened by the workflow less than six hours ago.
  const fresh = recorder([{ number: 7, title: ISSUE_TITLE, createdAt: '2026-11-13T06:00:01Z', author: bot }]);
  assert.deepEqual(await reportWorkflowFailure(hourly, { gh: fresh.gh, now: () => now }), { action: 'already_reported' });
  assert.equal(fresh.calls.length, 1);
  const issue = [{ number: 7, title: ISSUE_TITLE, createdAt: '2026-11-10T00:00:00Z', author: bot }];
  // The workflow's own last comment is recent.
  const recent = recorder(issue, [{ user: { login: 'github-actions[bot]' }, created_at: '2026-11-13T06:00:01Z' }]);
  assert.deepEqual(await reportWorkflowFailure(hourly, { gh: recent.gh, now: () => now }), { action: 'already_reported' });
  assert.deepEqual(recent.calls[1], ['api', '--method', 'GET', 'repos/example-org/example-repo/issues/7/comments', '-f', 'since=2026-11-13T06:00:00.000Z', '-f', 'per_page=100']);
  assert.equal(recent.calls.length, 2);
  const old = recorder(issue, [{ user: { login: 'github-actions[bot]' }, created_at: '2026-11-13T06:00:00Z' }]);
  assert.deepEqual(await reportWorkflowFailure(hourly, { gh: old.gh, now: () => now }), { action: 'commented' });
  // Without an interval every failure is reported, and a missing issue is always opened.
  const daily = recorder([{ number: 7, title: ISSUE_TITLE, createdAt: '2026-11-13T11:59:59Z', author: bot }]);
  assert.deepEqual(await reportWorkflowFailure({ ...environment, FAILURE_ISSUE_MIN_HOURS: '' }, { gh: daily.gh, now: () => now }), { action: 'commented' });
  assert.equal(daily.calls.some(call => call[0] === 'api'), false);
  const none = recorder([]);
  assert.deepEqual(await reportWorkflowFailure(hourly, { gh: none.gh, now: () => now }), { action: 'created' });
});

test('comments by other people do not postpone the next report', async () => {
  const hourly = { ...environment, FAILURE_ISSUE_MIN_HOURS: '6' };
  const { gh, calls } = recorder([{ number: 7, title: ISSUE_TITLE, createdAt: '2026-11-10T00:00:00Z', author: bot }],
    [{ user: { login: 'someone-else' }, created_at: '2026-11-13T11:59:00Z' }, { user: { login: 'maintainer' }, created_at: '2026-11-13T11:30:00Z' }, { created_at: '2026-11-13T11:40:00Z' }]);
  assert.deepEqual(await reportWorkflowFailure(hourly, { gh, now: () => now }), { action: 'commented' });
  assert.deepEqual(calls.at(-1).slice(0, 3), ['issue', 'comment', '7']);
});

test('an unexpected run context or interval is refused before gh is called', async () => {
  for (const patch of [{ GITHUB_SERVER_URL: 'https://github.example' }, { GITHUB_REPOSITORY: 'owner/repo/extra' }, { GITHUB_REPOSITORY: 'owner repo' },
    { GITHUB_RUN_ID: '12 --body x' }, { GITHUB_RUN_ID: undefined }, { FAILURE_ISSUE_MIN_HOURS: '6h' }, { FAILURE_ISSUE_MIN_HOURS: '169' }]) {
    const { gh, calls } = recorder([]);
    await assert.rejects(reportWorkflowFailure({ ...environment, ...patch }, { gh }), error => /^FAILURE_REPORT_(CONTEXT|INTERVAL)_INVALID$/.test(error.safeCode));
    assert.equal(calls.length, 0);
  }
});
