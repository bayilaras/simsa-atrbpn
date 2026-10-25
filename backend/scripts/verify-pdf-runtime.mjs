import { glob, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectDirectory = fileURLToPath(new URL('../', import.meta.url));

function onePagePdf() {
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>',
    ];
    let text = '%PDF-1.4\n';
    const offsets = objects.map((object, index) => {
        const offset = Buffer.byteLength(text);
        text += `${index + 1} 0 obj\n${object}\nendobj\n`;
        return offset;
    });
    const xref = Buffer.byteLength(text);
    text += 'xref\n0 4\n0000000000 65535 f \n';
    text += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    text += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new Uint8Array(Buffer.from(text));
}

export async function verifyPdfRuntime({ directory = projectDirectory, vercelConfig } = {}) {
    const config = vercelConfig || JSON.parse(await readFile(join(directory, 'vercel.json'), 'utf8'));
    const pattern = config.functions?.['api/index.js']?.includeFiles;
    if (typeof pattern !== 'string') throw new Error('API function must explicitly retain PDF runtime assets');

    const included = new Set();
    for await (const file of glob(pattern, { cwd: directory })) included.add(await realpath(join(directory, file)));
    const require = createRequire(join(directory, 'package.json'));
    const pdfEntry = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    const worker = join(dirname(pdfEntry), 'pdf.worker.mjs');
    if (!included.has(await realpath(worker))) throw new Error('API function is missing the PDF.js worker asset');

    // Loading the actual platform binding catches skipped optional dependencies
    // as well as missing runtime files; no canvas or DOM stubs are permitted.
    require('@napi-rs/canvas');
    const canvasFiles = Object.keys(require.cache).filter(file => /[/\\]@napi-rs[/\\]canvas(?:[/\\-])/.test(file));
    if (!canvasFiles.some(file => file.endsWith('.node'))) throw new Error('Native PDF canvas binding was not loaded');
    for (const file of canvasFiles) {
        if (!included.has(await realpath(file))) throw new Error('API function is missing a native PDF canvas runtime asset');
    }

    const pdfjs = await import(pathToFileURL(pdfEntry).href);
    const document = await pdfjs.getDocument({ data: onePagePdf(), useWorkerFetch: false }).promise;
    try {
        if (document.numPages !== 1) throw new Error('PDF runtime fixture page count did not match');
    } finally {
        await document.destroy();
    }
    return { pageCount: 1, workerIncluded: true, nativeCanvasIncluded: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        console.log(JSON.stringify({ pdfRuntime: await verifyPdfRuntime() }));
    } catch {
        console.error('PDF runtime verification failed: required parser assets or the platform binding are unavailable.');
        process.exitCode = 1;
    }
}
