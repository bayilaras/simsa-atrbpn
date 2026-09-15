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
// The cloud builder can reload backend/vercel.json and discard CLI command
// overrides. Keep candidate verification in the canonical build entry point.
if (process.env.SIMSA_VERIFY_CANDIDATE_SOURCE === '1') {
    const verification = spawnSync(process.execPath, [join(project, '../scripts/verify-candidate-source.mjs'), 'backend'], {
        cwd: project, stdio: 'inherit', windowsHide: true, shell: false,
    });
    if (verification.error || verification.status !== 0) throw new Error('Backend candidate source verification failed');
}
const npm = resolveNpmCli();
// PDF.js loads its worker and native canvas through dynamic runtime paths that
// the serverless dependency tracer cannot reliably infer. Verify the explicit
// function assets and parse a real PDF before producing a deployable build.
const pdfRuntime = spawnSync(process.execPath, [join(project, 'scripts/verify-pdf-runtime.mjs')], {
    cwd: project, stdio: 'inherit', windowsHide: true, shell: false,
});
if (pdfRuntime.error || pdfRuntime.status !== 0) throw new Error('PDF runtime packaging verification failed');
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
