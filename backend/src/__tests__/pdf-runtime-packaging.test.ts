import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// The same probe runs in a fresh Node process during every Vercel build.
import { verifyPdfRuntime } from '../../scripts/verify-pdf-runtime.mjs';

const directory = fileURLToPath(new URL('../../', import.meta.url));

describe('Vercel PDF parser runtime', () => {
    it('parses a PDF with the real worker and installed native canvas binding', async () => {
        await expect(verifyPdfRuntime({ directory })).resolves.toEqual({
            pageCount: 1, workerIncluded: true, nativeCanvasIncluded: true,
        });
    }, 30_000);

    it('rejects a deployment that relies only on automatic tracing of dynamic PDF dependencies', async () => {
        await expect(verifyPdfRuntime({ directory, vercelConfig: { functions: {} } }))
            .rejects.toThrow('explicitly retain PDF runtime assets');
    });

    it('rejects packaging native canvas without the PDF worker', async () => {
        const vercelConfig = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'));
        vercelConfig.functions['api/index.js'].includeFiles = 'node_modules/@napi-rs/canvas*/**';
        await expect(verifyPdfRuntime({ directory, vercelConfig }))
            .rejects.toThrow('missing the PDF.js worker asset');
    });
});
