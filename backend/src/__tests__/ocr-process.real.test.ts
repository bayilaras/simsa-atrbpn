import { fork, type ChildProcess, type ForkOptions } from 'node:child_process';
import { createServer, get, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import PDFDocument from 'pdfkit';
import { afterEach, describe, expect, it } from 'vitest';
import { OcrProcessService } from '../services/ocr-process.service';

const fixture = fileURLToPath(new URL('./fixtures/ocr-busy-worker.mjs', import.meta.url));
const children = new Set<ChildProcess>();
const servers = new Set<Server>();
const canary = 'private-request-canary';

function deadline<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([promise, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Test observation deadline exceeded')), ms);
    })]).finally(() => clearTimeout(timer));
}

async function textPdf() {
    return new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        const document = new PDFDocument();
        document.on('data', chunk => chunks.push(chunk));
        document.once('error', reject);
        document.once('end', () => resolve(Buffer.concat(chunks)));
        document.fontSize(12).text('OCRPROCESSCHECK Pengujian isolasi OCR lokal tanpa data pengguna. Surat ini digunakan untuk memastikan ekstraksi lapisan teks PDF berjalan di proses terpisah.');
        document.end();
    });
}

function busyLauncher() {
    let child: ChildProcess | undefined;
    let readyResolve!: () => void;
    let closed = false;
    const ready = new Promise<void>(resolve => { readyResolve = resolve; });
    const launch = ((_entry: string, _args: string[], options: ForkOptions) => {
        child = fork(fixture, [], { ...options, execArgv: [], stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
        children.add(child);
        child.stdout!.on('data', chunk => { if (chunk.toString().includes('READY')) readyResolve(); });
        child.once('close', () => { closed = true; children.delete(child!); });
        return child;
    }) as typeof fork;
    return { launch, ready, child: () => child, closed: () => closed };
}

afterEach(async () => {
    await Promise.all([...children].map(async child => {
        if (child.exitCode === null && child.signalCode === null) {
            const close = once(child, 'close');
            child.kill('SIGKILL');
            await deadline(close, 3000);
        }
        children.delete(child);
    }));
    await Promise.all([...servers].map(server => new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close(error => error ? reject(error) : resolve());
        servers.delete(server);
    })));
});

describe('OCR isolation with real child processes', () => {
    it('extracts a generated text-layer PDF using the default OCR child', async () => {
        const controller = new AbortController();
        try {
            const result = await new OcrProcessService({ timeoutMs: 15_000 }).processPDF(await textPdf(), controller.signal);
            expect(result.success).toBe(true);
            expect(result.text).toContain('OCRPROCESSCHECK');
            expect(result.text.trim().length).toBeGreaterThanOrEqual(50);
            expect(result.metadata.extractedText).toBe(result.text);
            expect(Array.isArray(result.metadata.keywords)).toBe(true);
        } finally { controller.abort(); }
    }, 20_000);

    it('fails a malformed PDF within the process deadline without echoing its contents', async () => {
        const controller = new AbortController();
        try {
            const result = await new OcrProcessService({ timeoutMs: 15_000 })
                .processPDF(Buffer.from(`%PDF-1.7\n${canary}\n%%EOF`), controller.signal)
                .then(value => ({ kind: 'result' as const, value }), error => ({ kind: 'error' as const, message: String(error?.message) }));
            expect(JSON.stringify(result)).not.toContain(canary);
            if (result.kind === 'result') {
                expect(result.value.success).toBe(false);
                expect(result.value.text).toBe('');
            } else expect(result.message).toMatch(/OCR|PDF|pemrosesan/i);
        } finally { controller.abort(); }
    }, 20_000);

    it('keeps a parent timer and HTTP server responsive during child CPU work, then awaits abort termination', async () => {
        const server = createServer((_request, response) => response.end('parent-responsive'));
        servers.add(server);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = (server.address() as { port: number }).port;
        const worker = busyLauncher();
        const controller = new AbortController();
        const operation = new OcrProcessService({ timeoutMs: 15_000, launch: worker.launch })
            .processPDF(Buffer.from('%PDF-1.7\nsynthetic fixture'), controller.signal);
        // Attach rejection handling immediately, including when a failed
        // readiness assertion forces the finally block to abort the child.
        const outcome = operation.then(() => ({ ok: true as const }), error => ({ ok: false as const, error }));
        try {
            await deadline(worker.ready, 5000);
            const [timer, http] = await deadline(Promise.all([
                new Promise<string>(resolve => setTimeout(() => resolve('timer-fired'), 100)),
                new Promise<string>((resolve, reject) => {
                    const request = get({ hostname: '127.0.0.1', port, path: '/' }, response => {
                        let body = '';
                        response.on('data', chunk => { body += chunk; });
                        response.once('end', () => resolve(body));
                    });
                    request.once('error', reject);
                }),
            ]), 2000);
            expect(timer).toBe('timer-fired');
            expect(http).toBe('parent-responsive');
            expect(worker.closed()).toBe(false);
            const cancellation = new Error('Test cancellation');
            controller.abort(cancellation);
            const result = await outcome;
            expect(result.ok).toBe(false);
            expect(worker.closed()).toBe(true);
            expect(worker.child()?.signalCode).toBe('SIGKILL');
            if (!result.ok) expect(result.error).toBe(cancellation);
        } finally {
            controller.abort();
            await outcome;
        }
    }, 20_000);

    it('kills a real worker on deadline and rejects only after close', async () => {
        const worker = busyLauncher();
        await expect(new OcrProcessService({ timeoutMs: 200, launch: worker.launch })
            .processPDF(Buffer.from('%PDF-1.7\nsynthetic fixture'))).rejects.toMatchObject({ name: expect.any(String) });
        expect(worker.closed()).toBe(true);
        expect(worker.child()?.signalCode).toBe('SIGKILL');
    }, 20_000);
});
