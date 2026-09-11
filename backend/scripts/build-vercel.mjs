import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const project = fileURLToPath(new URL('../', import.meta.url));
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Vercel build requires Node.js 24');
const output = join(project, 'dist-vercel');
if (existsSync(output) && realpathSync(output) !== join(realpathSync(project), 'dist-vercel')) {
    throw new Error('Vercel build output must remain inside backend');
}
const npm = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const result = spawnSync(process.execPath, [npm, 'run', 'build', '--', '--out-dir', 'dist-vercel'], {
    cwd: project, stdio: 'inherit', windowsHide: true,
});
if (result.error || result.status !== 0) throw new Error('Backend Vercel build failed');
// Bundle shared validators at build time so function runtime never relies on
// files outside the backend project. Include repository sources during build.
await build({ entryPoints: [join(project, 'lib/vercel-runtime.mjs')],
    outfile: join(output, 'vercel-runtime.js'), bundle: true, platform: 'node',
    format: 'esm', target: 'node24' });
