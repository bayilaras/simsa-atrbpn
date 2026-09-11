import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureCloudMetadata, validateCloudMetadataManifest } from './cloud-metadata-config.mjs';
import { validateNeonTarget } from './neon-target.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const environment = configureCloudMetadata(process.env, root);
validateNeonTarget(environment.DATABASE_URL, { role: 'simsa_api' });
const directory = realpathSync(environment.SIMSA_FRONTEND_DIST);
const manifestPath = realpathSync(path.join(directory, 'simsa-build.json'));
const manifestStat = statSync(manifestPath);
if (path.dirname(manifestPath) !== directory || !manifestStat.isFile() || manifestStat.size > 8192) {
    throw new Error('Cloud metadata frontend manifest must be a small regular file inside the build.');
}
let manifest;
try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); }
catch { throw new Error('Cloud metadata frontend manifest is invalid.'); }
validateCloudMetadataManifest(manifest);
Object.assign(process.env, environment);
await import('../backend/dist-cloud-metadata/index.js');
