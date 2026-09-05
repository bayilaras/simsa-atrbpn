import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultModuleUrl = new URL('./start-demo.mjs', import.meta.url);

/** Configure the root demo launcher without importing or starting the API. */
export function configureDemoLauncher(
    environment,
    launcherFile = fileURLToPath(defaultModuleUrl),
) {
    const mode = environment.SIMSA_APP_MODE?.trim().toLowerCase();
    if (mode !== 'metadata-demo') {
        throw new Error('Root demo launcher requires explicit SIMSA_APP_MODE=metadata-demo');
    }

    if (environment.SIMSA_FRONTEND_DIST === undefined) {
        const repositoryRoot = path.resolve(path.dirname(launcherFile), '..');
        environment.SIMSA_FRONTEND_DIST = path.join(repositoryRoot, 'frontend', 'dist');
    }
    return environment;
}
