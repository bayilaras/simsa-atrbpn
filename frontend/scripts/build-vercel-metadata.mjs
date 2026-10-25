import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { resolveNpmCli } from './resolve-npm-cli.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
if (Number(process.versions.node.split('.')[0]) !== 24
    || process.env.SIMSA_VERCEL_METADATA_ENABLED !== 'true') throw new Error('Explicit Vercel metadata build with Node.js 24 required');
const output = join(project, 'dist-vercel-metadata');
if (existsSync(output) && realpathSync(output) !== join(realpathSync(project), 'dist-vercel-metadata')) {
    throw new Error('Vercel build output must remain inside frontend');
}
const npm = resolveNpmCli();
const result = spawnSync(process.execPath, [npm, 'run', 'build', '--', '--outDir', 'dist-vercel-metadata'], {
    cwd: project, windowsHide: true, shell: false, stdio: 'inherit', env: { ...process.env,
        VITE_APP_MODE: 'full', VITE_APP_PROFILE: 'internal', VITE_AUTH_PROVIDER: 'better-auth',
        VITE_STORAGE_PROVIDER: 'disabled', VITE_API_URL: '', VITE_FEATURE_SRIKANDI: 'false',
    },
});
if (result.error || result.status !== 0) throw new Error('Frontend Vercel metadata build failed');
const manifest = JSON.parse(readFileSync(join(output, 'simsa-build.json'), 'utf8'));
if (manifest.mode !== 'full' || manifest.syntheticDataOnly !== false || manifest.api !== 'same-origin'
    || manifest.authProvider !== 'better-auth' || manifest.storageProvider !== 'disabled' || manifest.firebase !== null) {
    throw new Error('Frontend Vercel manifest does not match metadata profile');
}
