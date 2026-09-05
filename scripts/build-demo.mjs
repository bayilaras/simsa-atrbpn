import { spawnSync } from 'node:child_process';

const localBetterAuth = process.argv.slice(2).includes('--local-better-auth');
if (process.argv.length > (localBetterAuth ? 3 : 2)) {
    throw new Error('The only supported option is --local-better-auth');
}

const requiredPublicConfiguration = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_APP_ID',
    'VITE_FIREBASE_APP_CHECK_SITE_KEY',
];
const missing = localBetterAuth
    ? []
    : requiredPublicConfiguration.filter(name => !process.env[name]?.trim());
if (missing.length > 0) {
    throw new Error(`Demo build is missing public Firebase configuration: ${missing.join(', ')}`);
}
if (process.env.VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN?.trim()) {
    throw new Error('VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN is forbidden in a demo build');
}

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this entry point through npm run build:demo');

const buildEnvironment = {
    ...process.env,
    VITE_API_URL: '',
    VITE_APP_MODE: 'metadata-demo',
    VITE_APP_PROFILE: 'internal',
    VITE_AUTH_PROVIDER: localBetterAuth ? 'better-auth' : 'firebase',
    VITE_STORAGE_PROVIDER: 'disabled',
    VITE_FEATURE_SRIKANDI: 'false',
    SIMSA_DEMO_LOCAL_BUILD: localBetterAuth ? 'true' : '',
};

function runNpm(argumentsList, environment = process.env) {
    const result = spawnSync(process.execPath, [npmCli, ...argumentsList], {
        env: environment,
        stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}

runNpm(['--prefix', 'frontend', 'ci']);
runNpm(['--prefix', 'frontend', 'run', 'build'], buildEnvironment);
runNpm(['--prefix', 'backend', 'ci', '--include=dev']);
runNpm(['--prefix', 'backend', 'run', 'build']);
