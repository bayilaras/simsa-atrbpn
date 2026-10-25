import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lstat } from 'node:fs/promises';
import { buildClamavAssets } from '../../scripts/clamav-on-demand-poc/build.mjs';

const backend = dirname(dirname(fileURLToPath(import.meta.url)));
// Explicit build action only: importing the adapter or starting an API does not
// download an engine, enable files, or activate the scanner.
export async function buildNativeClamAvAssets() {
    const destination = join(backend, 'native-clamav-assets');
    try {
        await lstat(destination);
        throw new Error('Native assets already exist; use a clean isolated build workspace');
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    return buildClamavAssets({ destination, includeUpdateTools: true });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await buildNativeClamAvAssets();
}
