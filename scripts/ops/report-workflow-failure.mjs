#!/usr/bin/env node
// Turns a failed scheduled operations workflow into a GitHub issue, so people
// watching the repository get an email instead of having to look at the
// Actions tab. One open issue with a fixed title collects every failure: the
// first failure opens it, later ones add a comment.
//
// The repository is public. The issue carries a fixed sentence and the link to
// the run, nothing else: no check names, counts, hosts or file names.
//
//   report-workflow-failure.mjs          (run by the notify job, needs `gh`)
// GH_TOKEN                  token with issues: write
// GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID   set by GitHub Actions
// FAILURE_ISSUE_MIN_HOURS   optional 0-168: skip the comment while the open
//                           issue was updated more recently (hourly workflows)
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

export const ISSUE_TITLE = 'Pemeriksaan operasional gagal';
const fail = code => { throw Object.assign(new Error(code), { safeCode: code }); };

export function failureReport(environment) {
  const server = environment.GITHUB_SERVER_URL, repository = environment.GITHUB_REPOSITORY, runId = environment.GITHUB_RUN_ID;
  if (server !== 'https://github.com' || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository ?? '') || !/^[1-9][0-9]{0,19}$/.test(runId ?? ''))
    fail('FAILURE_REPORT_CONTEXT_INVALID');
  const hours = environment.FAILURE_ISSUE_MIN_HOURS;
  if (hours !== undefined && hours !== '' && !(/^(0|[1-9][0-9]{0,2})$/.test(hours) && Number(hours) <= 168)) fail('FAILURE_REPORT_INTERVAL_INVALID');
  const runUrl = `${server}/${repository}/actions/runs/${runId}`;
  return { repository, runUrl, minimumHours: hours ? Number(hours) : 0, title: ISSUE_TITLE,
    body: `Pemeriksaan operasional terjadwal gagal atau terhenti sebelum selesai.\n\nRun: ${runUrl}\n\n`
      + 'Rincian hanya tersedia bagi pengelola pada halaman run tersebut. Tutup isu ini setelah penyebabnya ditangani; kegagalan berikutnya membuka isu baru.' };
}

/** `gh(args)` resolves to stdout. Returns what was done, never any issue content. */
export async function reportWorkflowFailure(environment, { gh, now = Date.now } = {}) {
  const report = failureReport(environment), target = ['--repo', report.repository];
  const listed = JSON.parse(await gh(['issue', 'list', ...target, '--state', 'open', '--limit', '200', '--json', 'number,title,updatedAt']));
  // Exact title only, oldest first: a similarly named issue is never touched.
  const existing = (Array.isArray(listed) ? listed : []).filter(issue => issue?.title === report.title && Number.isSafeInteger(issue.number))
    .sort((a, b) => a.number - b.number)[0];
  if (!existing) {
    await gh(['issue', 'create', ...target, '--title', report.title, '--body', report.body]);
    return { action: 'created' };
  }
  const updated = Date.parse(existing.updatedAt);
  if (report.minimumHours > 0 && Number.isFinite(updated) && now() - updated < report.minimumHours * 3600000) return { action: 'already_reported' };
  await gh(['issue', 'comment', String(existing.number), ...target, '--body', report.body]);
  return { action: 'commented' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const run = promisify(execFile);
  try {
    const result = await reportWorkflowFailure(process.env, { gh: async args => (await run('gh', args, { env: process.env, maxBuffer: 4 * 1024 * 1024 })).stdout });
    console.log(JSON.stringify(result));
  } catch (error) {
    // gh output may quote issue text or request details; print a fixed code only.
    console.error(JSON.stringify({ action: 'failed', code: error?.safeCode || 'FAILURE_REPORT_FAILED_DETAILS_SUPPRESSED' }));
    process.exitCode = 1;
  }
}
