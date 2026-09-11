import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
if (!existsSync(npm)) throw new Error('Jalankan npm run build:internal menggunakan Node.js 24 dan npm.');

const env = {
    ...process.env,
    VITE_APP_MODE: 'full', VITE_APP_PROFILE: 'internal',
    VITE_AUTH_PROVIDER: 'better-auth', VITE_STORAGE_PROVIDER: 'vercel-blob',
    VITE_API_URL: '', VITE_FEATURE_SRIKANDI: 'false',
};
for (const project of ['frontend', 'backend']) {
    const result = spawnSync(process.execPath, [npm, '--prefix', project, 'run', 'build'], {
        cwd: root, env, stdio: 'inherit', windowsHide: true,
    });
    if (result.error || result.status !== 0) process.exit(result.status || 1);
}
