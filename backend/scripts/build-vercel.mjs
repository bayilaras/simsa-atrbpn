import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { resolveNpmCli } from '../../frontend/scripts/resolve-npm-cli.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Vercel build requires Node.js 24');
const output = join(project, 'dist-vercel');
if (existsSync(output) && realpathSync(output) !== join(realpathSync(project), 'dist-vercel')) {
    throw new Error('Vercel build output must remain inside backend');
}
const npm = resolveNpmCli();
const result = spawnSync(process.execPath, [npm, 'run', 'build', '--', '--out-dir', 'dist-vercel'], {
    cwd: project, stdio: 'inherit', windowsHide: true, shell: false,
});
if (result.error || result.status !== 0) throw new Error('Backend Vercel build failed');
// Bundle shared validators at build time so function runtime never relies on
// files outside the backend project. Include repository sources during build.
await build({ entryPoints: [join(project, 'lib/vercel-runtime.mjs')],
    outfile: join(output, 'vercel-runtime.js'), bundle: true, platform: 'node',
    format: 'esm', target: 'node24' });
await build({ entryPoints: [join(project, 'lib/internal-malware-scan-runtime.mjs')],
    outfile: join(output, 'internal-malware-scan-runtime.js'), bundle: true,
    platform: 'node', format: 'esm', target: 'node24' });
await build({ entryPoints: [join(project, 'src/workers/malware-scan-on-demand.ts'),
    join(project, 'src/workers/native-clamav-process.ts')], outdir: join(output, 'workers'),
    bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24' });
// Never refresh/download native assets during a default Preview build.
if (process.env.VERCEL_ENV === 'production' && process.env.CLAMAV_TRANSPORT === 'native'
    && process.env.MALWARE_SCAN_WORKER_RUNTIME === 'on-demand') {
    const native = spawnSync(process.execPath, [join(project, 'scripts/build-native-clamav.mjs')], {
        cwd: project, stdio: 'inherit', windowsHide: true, shell: false,
    });
    if (native.error || native.status !== 0) throw new Error('Native antivirus packaging failed');
}
