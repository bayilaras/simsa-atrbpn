import { fork, type ForkOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { open, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MalwareScannerError, isCurrentMalwareEngineEvidence, type MalwareScanner, type MalwareScanVerdict, type MalwareEngineEvidence } from './malware-scanner.service.js';
import { NativeClamAvDefinitions, NATIVE_CLAMAV_VERSION, nativeWorkspace, removeNativeWorkspace, type NativeCommandResult, type NativeCommandRunner, type NativeCommandOptions, type NativeDefinitionStore, type NativeDefinitionSnapshot } from './native-clamav-definitions.js';

export const NATIVE_CLAMAV_LIMITS = Object.freeze({ maxBytes: 10 * 1024 * 1024, maxLifetimeMs: 200_000, maxCombinedRssBytes: 1800 * 1024 * 1024 });
const failure = () => new MalwareScannerError('scanner_error', 'Native antivirus did not complete a verified scan', true);
const diagnosticCodes = new Set(['ENOENT', 'EACCES', 'EPERM', 'scanner_error', 'timeout', 'size_limit', 'stream_error']);
type NativeExecutionStage = 'workspace' | 'input' | 'definitions' | 'scan_command' | 'scan_verdict' | 'evidence';
function reportNativeFailure(stage: NativeExecutionStage, error: unknown): void {
    const code = error instanceof Error ? Object.getOwnPropertyDescriptor(error, 'code')?.value : undefined;
    console.error('Native antivirus execution failed', { stage,
        ...(typeof code === 'string' && diagnosticCodes.has(code) ? { errorCode: code } : {}) });
}

/** Source and isolated worker bundles both sit two levels below backend. */
export function nativeClamAvAssetsDirectory(moduleUrl = import.meta.url): string {
    return fileURLToPath(new URL('../../native-clamav-assets/', moduleUrl)).replace(/[\\/]$/, '');
}
function healthPdf(): Buffer {
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>', '<< /Length 3 >>\nstream\nq Q\nendstream'];
    let pdf = '%PDF-1.4\n'; const offsets: number[] = [];
    for (const [index, object] of objects.entries()) {
        offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    }
    const xref = Buffer.byteLength(pdf);
    pdf += 'xref\n0 5\n0000000000 65535 f \n' + offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    return Buffer.from(`${pdf}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

export function assessNativeScan(result: NativeCommandResult): MalwareScanVerdict {
    const text = `${result.stdout}\n${result.stderr}`;
    if (!Number.isFinite(result.peakCombinedRssBytes) || result.peakCombinedRssBytes <= 0
        || /ERROR|WARNING|skipp|limit.*exceed|Heuristics\.Encrypted/i.test(text)
        || (result.stdout.match(/^Scanned files:\s+1\s*$/gm) ?? []).length !== 1) throw failure();
    if (result.code === 0 && /^Infected files:\s+0\s*$/m.test(result.stdout) && /: OK\s*$/m.test(result.stdout)) return { verdict: 'clean' };
    if (result.code === 1 && /^Infected files:\s+1\s*$/m.test(result.stdout)) {
        const signature = result.stdout.match(/: ([A-Za-z0-9_.+()/-]{1,200}) FOUND\s*$/m)?.[1];
        if (signature) return { verdict: 'infected', signature };
    }
    throw failure();
}

/** Dedicated, credential-free supervisor; it owns the native process group. */
export function createNativeCommandRunner(launch: typeof fork = fork): NativeCommandRunner {
    return async (command, args, options) => {
        options.signal?.throwIfAborted();
        if (options.deadlineAtMs <= Date.now() || options.deadlineAtMs > Date.now() + NATIVE_CLAMAV_LIMITS.maxLifetimeMs) throw failure();
        const sourceMode = import.meta.url.endsWith('.ts');
        const name = `native-clamav-process.${sourceMode ? 'ts' : 'js'}`;
        const normal = new URL(`../workers/${name}`, import.meta.url);
        const entry = existsSync(normal) ? normal : new URL(`./workers/${name}`, import.meta.url);
        return await new Promise<NativeCommandResult>((accept, reject) => {
            const env: NodeJS.ProcessEnv = {
                PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C', LC_ALL: 'C',
                HOME: options.workDirectory, TMPDIR: options.workDirectory, TMP: options.workDirectory, TEMP: options.workDirectory,
                SIMSA_NATIVE_CLAMAV_DEADLINE_AT_MS: String(options.deadlineAtMs),
            };
            const launchOptions: ForkOptions & { windowsHide: boolean } = {
                cwd: options.workDirectory, env, detached: process.platform !== 'win32', windowsHide: true,
                execArgv: [...(sourceMode ? ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href] : []), '--max-old-space-size=96'],
                stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
            };
            const child = launch(fileURLToPath(entry), [], launchOptions);
            let result: NativeCommandResult | null = null;
            let stopped = false;
            let fallback: ReturnType<typeof setTimeout> | undefined;
            const killGroup = () => {
                if (child.pid && process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already gone. */ } }
                child.kill('SIGKILL');
            };
            const stop = () => {
                if (stopped) return; stopped = true;
                if (child.connected) { try { child.send({ cancel: true }, () => undefined); } catch { killGroup(); } }
                else killGroup();
                // A responsive supervisor kills and awaits the native child.
                // This fallback kills the entire owned group, never just Node.
                fallback = setTimeout(killGroup, 250);
            };
            const timer = setTimeout(stop, Math.max(1, options.deadlineAtMs - Date.now()));
            const onAbort = () => stop();
            child.once('error', stop);
            child.on('message', (value: unknown) => {
                if (stopped) return;
                const message = value as { ok?: unknown; result?: NativeCommandResult } | null;
                const candidate = message?.result;
                if (message?.ok !== true || result || !candidate || !Number.isInteger(candidate.code)
                    || typeof candidate.stdout !== 'string' || typeof candidate.stderr !== 'string'
                    || Buffer.byteLength(candidate.stdout) > 65536 || Buffer.byteLength(candidate.stderr) > 65536
                    || !Number.isFinite(candidate.peakCombinedRssBytes) || candidate.peakCombinedRssBytes <= 0
                    || candidate.peakCombinedRssBytes > options.maxCombinedRssBytes) { stop(); return; }
                result = candidate;
            });
            child.once('close', code => {
                clearTimeout(timer); clearTimeout(fallback); options.signal?.removeEventListener('abort', onAbort);
                // Retire the owned process group even after a normal result, so
                // a residual helper cannot outlive the completed supervisor.
                killGroup();
                if (!stopped && code === 0 && result) accept(result);
                else reject(failure());
            });
            options.signal?.addEventListener('abort', onAbort, { once: true });
            if (options.signal?.aborted) stop();
            else child.send({ command, args, assetsDirectory: options.assetsDirectory, workDirectory: options.workDirectory,
                deadlineAtMs: options.deadlineAtMs, maxCombinedRssBytes: options.maxCombinedRssBytes }, error => { if (error) stop(); });
        });
    };
}

export interface NativeClamAvScannerOptions { assetsDirectory?: string; timeoutMs?: number; maxBytes?: number; maxCombinedRssBytes?: number }
// One native engine per warm function instance, including explicit health work.
// Cross-instance serialization remains the durable worker/PG lease's job.
let instanceBusy = false;
export class NativeClamAvScanner implements MalwareScanner {
    private readonly assetsDirectory: string;
    private readonly timeoutMs: number;
    private readonly maxBytes: number;
    private readonly maxCombinedRssBytes: number;
    private readonly run: NativeCommandRunner;
    private readonly definitions: NativeDefinitionStore;
    private evidence: MalwareEngineEvidence | null = null;
    constructor(options: NativeClamAvScannerOptions = {}, dependencies: { run?: NativeCommandRunner; definitions?: NativeDefinitionStore } = {}) {
        this.assetsDirectory = resolve(options.assetsDirectory ?? 'native-clamav-assets');
        this.timeoutMs = options.timeoutMs ?? 180_000;
        this.maxBytes = options.maxBytes ?? NATIVE_CLAMAV_LIMITS.maxBytes;
        this.maxCombinedRssBytes = options.maxCombinedRssBytes ?? NATIVE_CLAMAV_LIMITS.maxCombinedRssBytes;
        for (const [value, maximum] of [[this.timeoutMs, NATIVE_CLAMAV_LIMITS.maxLifetimeMs], [this.maxBytes, NATIVE_CLAMAV_LIMITS.maxBytes], [this.maxCombinedRssBytes, NATIVE_CLAMAV_LIMITS.maxCombinedRssBytes]]) {
            if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error('Invalid native antivirus resource limit');
        }
        this.run = dependencies.run ?? createNativeCommandRunner();
        this.definitions = dependencies.definitions ?? new NativeClamAvDefinitions(this.assetsDirectory, this.run, this.maxCombinedRssBytes);
    }
    getEngineEvidence(): MalwareEngineEvidence | null {
        return isCurrentMalwareEngineEvidence(this.evidence) ? structuredClone(this.evidence) : null;
    }
    private commandOptions(workDirectory: string, deadlineAtMs: number, signal: AbortSignal): NativeCommandOptions {
        return { assetsDirectory: this.assetsDirectory, workDirectory, deadlineAtMs, maxCombinedRssBytes: this.maxCombinedRssBytes, signal };
    }
    private async execute(stream: Readable | null, knownSizeBytes: number | null | undefined, outerSignal?: AbortSignal): Promise<MalwareScanVerdict> {
        if (instanceBusy) { stream?.destroy(); throw new MalwareScannerError('scanner_error', 'Native antivirus capacity is occupied', true); }
        instanceBusy = true; this.evidence = null;
        const controller = new AbortController(); const deadlineAtMs = Date.now() + this.timeoutMs;
        const timeout = setTimeout(() => controller.abort(new MalwareScannerError('timeout', 'Native antivirus deadline exhausted', true)), this.timeoutMs);
        const onAbort = () => controller.abort(outerSignal?.reason);
        outerSignal?.addEventListener('abort', onAbort, { once: true }); if (outerSignal?.aborted) onAbort();
        const signal = controller.signal;
        const destroyInput = () => stream?.destroy(signal.reason instanceof Error ? signal.reason : failure());
        // Install an error observer before cancellation: Readable.destroy(error)
        // may otherwise emit before the async iterator has been attached.
        const observeInputError = () => undefined;
        stream?.on('error', observeInputError);
        signal.addEventListener('abort', destroyInput, { once: true });
        let work: string | null = null;
        let snapshot: NativeDefinitionSnapshot | null = null;
        let stage: NativeExecutionStage = 'workspace';
        try {
            signal.throwIfAborted();
            if (knownSizeBytes != null && (!Number.isSafeInteger(knownSizeBytes) || knownSizeBytes < 1 || knownSizeBytes > this.maxBytes)) throw new MalwareScannerError('size_limit', 'Antivirus input size is invalid', false);
            work = await nativeWorkspace('scan');
            const file = join(work, 'payload.bin');
            stage = 'input';
            if (stream) {
                const handle = await open(file, 'wx', 0o600); let bytes = 0;
                try {
                    for await (const value of stream) {
                        signal.throwIfAborted(); const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
                        bytes += chunk.length;
                        if (bytes > this.maxBytes) throw new MalwareScannerError('size_limit', 'Antivirus input exceeds 10 MiB', false);
                        let offset = 0;
                        while (offset < chunk.length) { const written = await handle.write(chunk, offset, chunk.length - offset); if (!written.bytesWritten) throw failure(); offset += written.bytesWritten; }
                    }
                } finally { await handle.close(); }
                if (bytes === 0 || (knownSizeBytes != null && bytes !== knownSizeBytes)) throw new MalwareScannerError('stream_error', 'Antivirus input size changed while reading', false);
            } else {
                // This fixed local fixture tests engine loading during explicit
                // readiness. It is never evidence that an archive was scanned.
                await writeFile(file, healthPdf(), { flag: 'wx', mode: 0o600 });
            }
            signal.throwIfAborted();
            stage = 'definitions';
            snapshot = await this.definitions.acquire(deadlineAtMs, signal);
            stage = 'scan_command';
            const result = await this.run(join(this.assetsDirectory, 'bin/clamscan'), [
                `--database=${snapshot.directory}`, `--cvdcertsdir=${join(this.assetsDirectory, 'etc/certs')}`, '--fips-limits',
                '--max-filesize=11M', '--max-scansize=30M', '--max-recursion=10', '--max-files=100', '--max-scantime=60000',
                '--alert-exceeds-max=yes', '--alert-encrypted=yes', `--tempdir=${work}`, file,
            ], this.commandOptions(work, deadlineAtMs, signal));
            signal.throwIfAborted();
            stage = 'scan_verdict';
            const verdict = assessNativeScan(result);
            stage = 'evidence';
            if (!isCurrentMalwareEngineEvidence(snapshot.evidence) || snapshot.evidence.engineVersion !== NATIVE_CLAMAV_VERSION || Date.now() >= deadlineAtMs) throw failure();
            this.evidence = structuredClone(snapshot.evidence);
            return { ...verdict, engineEvidence: structuredClone(snapshot.evidence) };
        } catch (error) {
            reportNativeFailure(stage, error);
            stream?.destroy(); this.evidence = null;
            if (error instanceof MalwareScannerError) throw error;
            throw failure();
        } finally {
            clearTimeout(timeout); outerSignal?.removeEventListener('abort', onAbort); signal.removeEventListener('abort', destroyInput);
            stream?.off('error', observeInputError);
            try {
                try { if (work) await removeNativeWorkspace(work); }
                finally { if (snapshot) await this.definitions.release?.(snapshot); }
            } finally { instanceBusy = false; }
        }
    }
    scanStream(stream: Readable, knownSizeBytes?: number | null, signal?: AbortSignal): Promise<MalwareScanVerdict> {
        return this.execute(stream, knownSizeBytes, signal);
    }
    async healthCheck(signal?: AbortSignal): Promise<void> {
        const result = await this.execute(null, null, signal);
        if (result.verdict !== 'clean') { this.evidence = null; throw failure(); }
    }
    async dispose(): Promise<void> {
        if (instanceBusy) throw new Error('Native antivirus is still in use');
        this.evidence = null;
        await this.definitions.dispose?.();
    }
}
