import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveNpmCli } from '../frontend/scripts/resolve-npm-cli.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--skip-install') || args.length > 1) {
    throw new Error('Usage: npm run build:cloud-metadata [-- --skip-install]');
}
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node.js 24 to build SIMSA.');
const npm = resolveNpmCli();
const env = {
    ...process.env,
    VITE_APP_MODE: 'full', VITE_APP_PROFILE: 'internal',
    VITE_AUTH_PROVIDER: 'better-auth', VITE_STORAGE_PROVIDER: 'disabled',
    VITE_API_URL: '', VITE_FEATURE_SRIKANDI: 'false',
};
for (const project of ['frontend', 'backend']) {
    // Build tools clean their output directory. Do not follow a replaced symlink.
    const output = join(root, project, 'dist-cloud-metadata');
    if (existsSync(output) && realpathSync(output) !== join(realpathSync(join(root, project)), 'dist-cloud-metadata')) {
        throw new Error('Cloud build output must stay inside its project directory.');
    }
    const commands = args.includes('--skip-install') ? [] : [['--prefix', project, 'ci', '--include=dev']];
    commands.push(['--prefix', project, 'run', 'build', '--',
        project === 'frontend' ? '--outDir' : '--out-dir', 'dist-cloud-metadata']);
    for (const command of commands) {
        const result = spawnSync(process.execPath, [npm, ...command], {
            cwd: root, env, stdio: 'inherit', windowsHide: true, shell: false,
        });
        if (result.error) throw new Error('Could not start the cloud build process.');
        if (result.status !== 0) process.exit(result.status ?? 1);
    }
}
