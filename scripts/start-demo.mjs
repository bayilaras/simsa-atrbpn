import { fileURLToPath } from 'node:url';
import { configureDemoLauncher } from './demo-launcher-config.mjs';

// Keep the backend hosting behavior opt-in. This same-origin launcher is the
// explicit opt-in for source/buildpack deployments; the standalone backend
// start command continues to expose API routes only.
configureDemoLauncher(process.env, fileURLToPath(import.meta.url));

await import('../backend/dist/index.js');
