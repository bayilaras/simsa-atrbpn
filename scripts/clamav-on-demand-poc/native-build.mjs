import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
export async function compileNativeProbeAdapter(destination = join(root, 'native')) {
    // These four modules have only Node built-in runtime imports. No backend
    // application/config/DB is imported or bundled into this synthetic project.
    for (const path of ['services/native-clamav.service.ts', 'services/native-clamav-definitions.ts', 'services/malware-scanner.service.ts', 'workers/native-clamav-process.ts']) {
        const source = await readFile(join(root, '../../backend/src', path), 'utf8');
        const output = stripTypeScriptTypes(source, { mode: 'transform', sourceMap: false });
        const target = join(destination, path.replace(/\.ts$/, '.js'));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, output);
    }
}
export async function buildNativeProbe(buildAssets) {
    await buildAssets({ destination: join(root, 'vendor'), includeUpdateTools: true });
    await compileNativeProbeAdapter();
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildNativeProbe((await import('./build.mjs')).buildClamavAssets);
