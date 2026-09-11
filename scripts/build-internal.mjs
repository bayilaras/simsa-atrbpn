import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveNpmCli } from '../frontend/scripts/resolve-npm-cli.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = resolveNpmCli();

const env = {
    ...process.env,
    VITE_APP_MODE: 'full', VITE_APP_PROFILE: 'internal',
    VITE_AUTH_PROVIDER: 'better-auth', VITE_STORAGE_PROVIDER: 'vercel-blob',
    VITE_API_URL: '', VITE_FEATURE_SRIKANDI: 'false',
};
for (const project of ['frontend', 'backend']) {
    const result = spawnSync(process.execPath, [npm, '--prefix', project, 'run', 'build'], {
        cwd: root, env, stdio: 'inherit', windowsHide: true, shell: false,
    });
    if (result.error || result.status !== 0) process.exit(result.status || 1);
}
