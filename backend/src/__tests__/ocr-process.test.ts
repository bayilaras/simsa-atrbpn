import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { fork } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OcrProcessService } from '../services/ocr-process.service.js';

const pdf = Buffer.from('%PDF-1.7 test');
const metadata = { nomorSurat: null, perihal: null, tanggalSurat: null, pengirim: null,
    extractedText: 'text', penerima: null, tembusan: [], lampiran: null, sifatSurat: null,
    klasifikasiKeamanan: null, jenisSurat: null, keywords: [], summary: null };
const result = { success: true, text: 'text', metadata };
let child: EventEmitter & { stdin: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
let launch: ReturnType<typeof vi.fn>;
const service = (timeoutMs = 100) => new OcrProcessService({ timeoutMs, launch: launch as unknown as typeof fork });
beforeEach(() => {
    vi.useFakeTimers();
    child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true) });
    child.stdin.resume();
    launch = vi.fn(() => child);
});
afterEach(() => { child.stdin.destroy(); child.stderr.destroy(); vi.useRealTimers(); vi.unstubAllEnvs(); });

it('does not spawn for invalid input or a pre-aborted lease', async () => {
    await expect(service().processPDF(Buffer.from('not a PDF'))).rejects.toThrow('PDF');
    const controller = new AbortController();
    const reason = new Error('capacity ownership lost');
    controller.abort(reason);
    await expect(service().processPDF(pdf, controller.signal)).rejects.toBe(reason);
    expect(launch).not.toHaveBeenCalled();
});

it('passes only bounded PDF bytes to an isolated child and strips service credentials', async () => {
    vi.stubEnv('DATABASE_URL', 'database-canary');
    vi.stubEnv('BETTER_AUTH_SECRET', 'auth-canary');
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'blob-canary');
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', 'credentials-canary');
    vi.stubEnv('NODE_OPTIONS', '--unsafe-canary');
    vi.stubEnv('OCR_TESSDATA_PATH', './models');
    const operation = service().processPDF(pdf);
    const options = launch.mock.calls[0][2];
    expect(JSON.stringify(options.env)).not.toMatch(/canary/);
    expect(options.windowsHide).toBe(true);
    expect(options.stdio).toEqual(['pipe', 'ignore', 'pipe', 'ipc']);
    expect(options.cwd).toBe(options.env.TMPDIR);
    expect(options.env.OCR_CACHE_PATH).toBe(options.cwd);
    expect(options.env.OCR_TESSDATA_PATH).toBe(resolve('./models'));
    expect(Number(options.env.SIMSA_OCR_DEADLINE_AT_MS)).toBe(Date.now() + 100);
    expect(existsSync(join(options.cwd, '.env'))).toBe(false);
    child.emit('message', { ok: true, result });
    child.emit('close', 0, null);
    await expect(operation).resolves.toEqual(result);
    expect(existsSync(options.cwd)).toBe(false);
});

it('retains the lease-facing promise until a timed-out child has actually closed', async () => {
    const operation = service().processPDF(pdf);
    let settled = false;
    void operation.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(101);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(settled).toBe(false);
    const rejected = expect(operation).rejects.toThrow('batas waktu');
    child.emit('message', { ok: true, result });
    child.emit('close', 0, null);
    await rejected;
});

it('kills on lease loss and preserves the ownership error after child close', async () => {
    const controller = new AbortController();
    const operation = service().processPDF(pdf, controller.signal);
    const reason = new Error('capacity ownership lost');
    controller.abort(reason);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    const rejected = expect(operation).rejects.toBe(reason);
    child.emit('close', null, 'SIGKILL');
    await rejected;
});

it.each(['invalid-result', 'crash', 'pipe-error'])('fails safely after %s without copying child diagnostics', async mode => {
    const operation = service().processPDF(pdf);
    child.stderr.write('provider-credential-canary');
    if (mode === 'invalid-result') child.emit('message', { ok: true, result: { ...result, metadata: { secret: 'canary' } } });
    if (mode === 'pipe-error') child.stdin.emit('error', new Error('input-canary'));
    const rejected = expect(operation).rejects.toThrow(/^Proses OCR/);
    child.emit('close', 1, null);
    await rejected;
});

it('cleans only its owned temporary directory after confirmed process exit', async () => {
    const operation = service().processPDF(pdf);
    const directory = launch.mock.calls[0][2].cwd;
    writeFileSync(join(directory, 'eng.traineddata'), 'cache');
    expect(readFileSync(join(directory, 'eng.traineddata'), 'utf8')).toBe('cache');
    child.emit('message', { ok: true, result });
    child.emit('close', 0, null);
    await operation;
    expect(existsSync(directory)).toBe(false);
});
