// Explicit release check. Tests run without deployment credentials before the
// ordinary build receives its original environment. Never runs migrations.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
if (!['backend', 'frontend'].includes(target) || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/verify-candidate-source.mjs backend|frontend');
}
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Candidate verification requires Node.js 24');

// Allow process/temporary-directory essentials only. In particular, do not
// inherit database, Blob, OAuth, SMTP, Vercel, NODE_OPTIONS, or VITE_* values.
const environment = { NODE_ENV: 'test', CI: 'true', TZ: 'Asia/Jakarta' };
for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'Path', 'TEMP', 'TMP', 'TMPDIR']) {
  if (process.env[key]) environment[key] = process.env[key];
}
const project = resolve(root, target);
const steps = target === 'backend'
  ? [['typecheck', 'node_modules/typescript/bin/tsc', '--noEmit'],
    ['tests', 'node_modules/vitest/vitest.mjs', 'run', '--maxWorkers=1']]
  : [['lint', 'node_modules/eslint/bin/eslint.js', '.'],
    ['tests', 'node_modules/vitest/vitest.mjs', 'run', '--maxWorkers=1']];

for (const [name, ...args] of steps) {
  console.log(`SIMSA candidate ${target}: ${name} (isolated test environment)`);
  const result = spawnSync(process.execPath, args, {
    cwd: project, env: environment, windowsHide: true, shell: false,
    stdio: 'inherit', timeout: 25 * 60 * 1000,
  });
  if (result.status !== 0) {
    console.error(`SIMSA candidate ${target}: ${name} failed`);
    process.exit(result.status || 1);
  }
}
console.log(`SIMSA candidate ${target}: source checks passed`);
