import { fork, type ForkOptions } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { OCRResult } from './ocr.service.js';

// CPU/rendering belongs to the child. The caller retains its durable database
// capacity lease until this promise settles, including on cancellation.
export const OCR_PROCESS_LIMITS = Object.freeze({ maxPdfBytes: 50 * 1024 * 1024, timeoutMs: 225_000, maxLifetimeMs: 200_000 });
const text = z.string().max(50_000);
const field = text.nullable();
const resultSchema = z.object({
    success: z.boolean(), text,
    metadata: z.object({
        nomorSurat: field, perihal: field, tanggalSurat: field, pengirim: field,
        extractedText: text, penerima: field, tembusan: z.array(text).max(10), lampiran: field,
        sifatSurat: field, klasifikasiKeamanan: field, jenisSurat: field,
        keywords: z.array(text).max(10), summary: field,
    }).strict(),
    error: z.string().max(500).optional(),
}).strict();

export function parseOcrProcessResult(value: unknown): OCRResult | null {
    try {
        if (JSON.stringify(value).length > 512 * 1024) return null;
        const result = resultSchema.safeParse(value);
        return result.success ? result.data : null;
    } catch { return null; }
}

function childEnvironment(directory: string, timeoutMs: number): NodeJS.ProcessEnv {
    // This is process/credential isolation, not an OS sandbox. In deployment,
    // the service account must still have the minimum filesystem permissions.
    const env: NodeJS.ProcessEnv = {
        NODE_ENV: process.env.NODE_ENV === 'production' ? 'production' : 'development', DOTENV_CONFIG_QUIET: 'true',
        TEMP: directory, TMP: directory, TMPDIR: directory, HOME: directory, USERPROFILE: directory,
        OCR_CACHE_PATH: directory,
        SIMSA_OCR_DEADLINE_AT_MS: String(Date.now() + Math.min(timeoutMs, OCR_PROCESS_LIMITS.maxLifetimeMs)),
    };
    for (const key of ['SystemRoot', 'WINDIR', 'LANG', 'LC_ALL']) {
        if (process.env[key]) env[key] = process.env[key];
    }
    env.PATH = dirname(process.execPath);
    const languagePath = process.env.OCR_TESSDATA_PATH?.trim();
    if (languagePath) env.OCR_TESSDATA_PATH = /^https?:\/\//i.test(languagePath) ? languagePath : resolve(languagePath);
    return env;
}

async function removeOwnedDirectory(directory: string, parent: string): Promise<void> {
    // Refuse a renamed/replaced directory. Never recursively remove a computed
    // parent, cwd, or a path obtained from a PDF/worker result.
    const physical = await realpath(directory);
    if (resolve(physical) !== resolve(directory) || dirname(directory) !== parent
        || !directory.startsWith(join(parent, 'simsa-ocr-'))) throw new Error('Unsafe OCR cleanup path');
    await rm(directory, { recursive: true, force: false });
}

export class OcrProcessService {
    private readonly launch: typeof fork;
    private readonly timeoutMs: number;

    constructor(options: { timeoutMs?: number; launch?: typeof fork } = {}) {
        this.launch = options.launch ?? fork;
        this.timeoutMs = options.timeoutMs ?? OCR_PROCESS_LIMITS.timeoutMs;
        if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1
            || this.timeoutMs > OCR_PROCESS_LIMITS.timeoutMs) throw new Error('Invalid OCR process deadline');
    }

    async processPDF(buffer: Buffer, signal?: AbortSignal): Promise<OCRResult> {
        if (signal?.aborted) throw signal.reason;
        if (!Buffer.isBuffer(buffer) || buffer.length < 5 || buffer.length > OCR_PROCESS_LIMITS.maxPdfBytes
            || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Dokumen PDF tidak valid untuk OCR.');
        const parent = resolve(tmpdir());
        const directory = mkdtempSync(join(parent, 'simsa-ocr-'));
        try {
            const sourceMode = import.meta.url.endsWith('.ts');
            const entryName = `ocr-process.${sourceMode ? 'ts' : 'js'}`;
            const sourceEntry = new URL(`../workers/${entryName}`, import.meta.url);
            const entry = existsSync(sourceEntry) ? sourceEntry : new URL(`./workers/${entryName}`, import.meta.url);
            return await new Promise<OCRResult>((accept, reject) => {
                const options: ForkOptions & { windowsHide: boolean } = {
                    cwd: directory, env: childEnvironment(directory, this.timeoutMs), windowsHide: true,
                    execArgv: [...(sourceMode ? ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href] : []),
                        '--max-old-space-size=512'],
                    stdio: ['pipe', 'ignore', 'pipe', 'ipc'],
                };
                const child = this.launch(fileURLToPath(entry), [], options);
                let result: OCRResult | null = null;
                let failure: unknown;
                let stopped = false;
                const stop = (reason = new Error('Proses OCR berhenti sebelum hasil tersedia.')) => {
                    if (stopped) return;
                    stopped = true;
                    failure = reason;
                    child.kill('SIGKILL');
                };
                const onAbort = () => stop(signal?.reason ?? new Error('Proses OCR dibatalkan.'));
                const timer = setTimeout(() => stop(new Error('Proses OCR melewati batas waktu pemrosesan.')), this.timeoutMs);
                child.stderr?.resume(); // Discard diagnostics; never return PDF bytes or provider data.
                child.once('error', () => stop());
                child.stdin?.once('error', () => stop());
                child.on('message', (message: unknown) => {
                    if (stopped) return;
                    const response = message as { ok?: unknown; result?: unknown } | null;
                    if (response?.ok !== true || result !== null) { stop(); return; }
                    result = parseOcrProcessResult(response.result);
                    if (!result) stop();
                });
                child.once('close', (code) => {
                    clearTimeout(timer);
                    signal?.removeEventListener('abort', onAbort);
                    if (stopped) reject(failure);
                    else if (code === 0 && result) accept(result);
                    else reject(new Error('Proses OCR berhenti sebelum hasil tersedia.'));
                });
                signal?.addEventListener('abort', onAbort, { once: true });
                if (signal?.aborted) onAbort();
                else { try { child.stdin?.end(buffer); } catch { stop(); } }
                // No Promise.race: timeout/lease loss kills the actual work and
                // only confirmed close lets the caller release its global slot.
            });
        } finally {
            await removeOwnedDirectory(directory, parent);
        }
    }
}

export const ocrProcessService = new OcrProcessService();
