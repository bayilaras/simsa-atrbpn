import { fork, type ForkOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { open, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MalwareScannerError, isCurrentMalwareEngineEvidence, type MalwareScanner, type MalwareScanVerdict, type MalwareEngineEvidence } from './malware-scanner.service.js';
import { NativeClamAvDefinitions, NATIVE_CLAMAV_VERSION, nativeWorkspace, removeNativeWorkspace, type NativeCommandResult, type NativeCommandRunner, type NativeCommandOptions, type NativeDefinitionStore, type NativeDefinitionSnapshot } from './native-clamav-definitions.js';

export const NATIVE_CLAMAV_LIMITS = Object.freeze({ maxBytes: 50 * 1024 * 1024, maxLifetimeMs: 200_000, maxCombinedRssBytes: 1800 * 1024 * 1024 });
const nativeFailureReasons = ['deadline', 'cancelled', 'rss_limit', 'rss_unavailable', 'missing_measurement', 'spawn_failure',
    'invalid_control', 'invalid_executable', 'watchdog_failure', 'output_limit', 'child_exit', 'invalid_result', 'missing_result'] as const;
type NativeFailureReason = typeof nativeFailureReasons[number];
const rssCategories = ['process_tree_invalid', 'self_status_unreadable', 'self_rss_missing', 'self_children_unreadable',
    'descendant_status_unreadable', 'descendant_rss_missing', 'descendant_children_unreadable',
    'parent_status_unreadable', 'parent_rss_missing', 'sample_unknown'];
const rssOsCodes = ['ENOENT', 'ESRCH', 'EACCES', 'EPERM', 'EIO', 'EMFILE', 'ENFILE'];
function safeRssField(value: unknown, property: string, allowed: string[]): string | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const field = Object.getOwnPropertyDescriptor(value, property)?.value;
    return typeof field === 'string' && allowed.includes(field) ? field : undefined;
}
function nativeFailureReason(value: unknown, property: string): NativeFailureReason | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const reason = Object.getOwnPropertyDescriptor(value, property)?.value;
    return typeof reason === 'string' && (nativeFailureReasons as readonly string[]).includes(reason) ? reason as NativeFailureReason : undefined;
}
const failure = (reason?: NativeFailureReason, rssFailure?: string, rssErrorCode?: string) => Object.assign(
    new MalwareScannerError('scanner_error', 'Native antivirus did not complete a verified scan', true),
    reason ? { nativeReason: reason } : {},
    rssFailure ? { nativeRssFailure: rssFailure } : {},
    rssErrorCode ? { nativeRssErrorCode: rssErrorCode } : {},
);
const diagnosticCodes = new Set(['ENOENT', 'EACCES', 'EPERM', 'scanner_error', 'timeout', 'size_limit', 'stream_error']);
type NativeExecutionStage = 'workspace' | 'input' | 'definitions' | 'scan_command' | 'scan_verdict' | 'evidence';
function reportNativeFailure(stage: NativeExecutionStage, error: unknown): void {
    const code = error instanceof Error ? Object.getOwnPropertyDescriptor(error, 'code')?.value : undefined;
    const reason = nativeFailureReason(error, 'nativeReason');
    const rssFailure = reason === 'rss_unavailable' ? safeRssField(error, 'nativeRssFailure', rssCategories) : undefined;
    const rssErrorCode = reason === 'rss_unavailable' ? safeRssField(error, 'nativeRssErrorCode', rssOsCodes) : undefined;
    console.error('Native antivirus execution failed', { stage,
        ...(typeof code === 'string' && diagnosticCodes.has(code) ? { errorCode: code } : {}), ...(reason ? { reason } : {}),
        ...(rssFailure ? { rssFailure } : {}), ...(rssErrorCode ? { rssErrorCode } : {}) });
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
    const reject = (reason: 'memory_evidence' | 'unsafe_output' | 'scanned_summary' | 'verdict_summary'): never => {
        // Native output may contain document names, paths or matched content.
        // Emit fixed categories and bounded counters only, never output text.
        const summaries = (label: string) => {
            const values = [...result.stdout.matchAll(new RegExp(`^${label}:\\s+(\\d+)\\s*$`, 'gm'))];
            return { occurrences: Math.min(values.length, 100),
                count: values.length === 1 ? Math.min(Number(values[0][1]), 1_000_000) : null };
        };
        const exceeded = (limit: 'MaxFiles' | 'MaxScanSize' | 'MaxFileSize' | 'MaxRecursion' | 'MaxScanTime') => (
            new RegExp(`^[^\\r\\n]*: Heuristics\\.Limits\\.Exceeded\\.${limit} FOUND[ \\t]*$`, 'm').test(text)
        );
        console.error('Native antivirus verdict rejected', {
            reason,
            exitCode: Number.isInteger(result.code) && result.code! >= 0 && result.code! <= 255 ? result.code : null,
            memoryEvidenceValid: Number.isFinite(result.peakCombinedRssBytes) && result.peakCombinedRssBytes > 0,
            stdoutBytes: Math.min(Buffer.byteLength(result.stdout), 65_536),
            stderrBytes: Math.min(Buffer.byteLength(result.stderr), 65_536),
            scannedFiles: summaries('Scanned files'), infectedFiles: summaries('Infected files'),
            okLines: Math.min((result.stdout.match(/: OK\s*$/gm) ?? []).length, 100),
            foundLines: Math.min((result.stdout.match(/ FOUND\s*$/gm) ?? []).length, 100),
            outputError: /ERROR/i.test(text), outputWarning: /WARNING/i.test(text),
            skipped: /skipp/i.test(text), limitExceeded: /limit.*exceed/i.test(text),
            encrypted: /Heuristics\.Encrypted/i.test(text),
            maxFilesExceeded: exceeded('MaxFiles'), maxScanSizeExceeded: exceeded('MaxScanSize'),
            maxFileSizeExceeded: exceeded('MaxFileSize'), maxRecursionExceeded: exceeded('MaxRecursion'),
            maxScanTimeExceeded: exceeded('MaxScanTime'),
        });
        throw failure();
    };
    if (!Number.isFinite(result.peakCombinedRssBytes) || result.peakCombinedRssBytes <= 0
    ) return reject('memory_evidence');
    if (/ERROR|WARNING|skipp|limit.*exceed|Heuristics\.Encrypted/i.test(text)) return reject('unsafe_output');
    if ((result.stdout.match(/^Scanned files:\s+1\s*$/gm) ?? []).length !== 1) return reject('scanned_summary');
    if (result.code === 0 && /^Infected files:\s+0\s*$/m.test(result.stdout) && /: OK\s*$/m.test(result.stdout)) return { verdict: 'clean' };
    if (result.code === 1 && /^Infected files:\s+1\s*$/m.test(result.stdout)) {
        const signature = result.stdout.match(/: ([A-Za-z0-9_.+()/-]{1,200}) FOUND\s*$/m)?.[1];
        if (signature) return { verdict: 'infected', signature };
    }
    return reject('verdict_summary');
}

/** Dedicated, credential-free supervisor; it owns the native process group. */
export function createNativeCommandRunner(launch: typeof fork = fork): NativeCommandRunner {
    return async (command, args, options) => {
        options.signal?.throwIfAborted();
        if (options.deadlineAtMs <= Date.now() || options.deadlineAtMs > Date.now() + NATIVE_CLAMAV_LIMITS.maxLifetimeMs) throw failure('deadline');
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
            let child: ReturnType<typeof fork>;
            try { child = launch(fileURLToPath(entry), [], launchOptions); }
            catch { reject(failure('spawn_failure')); return; }
            let result: NativeCommandResult | null = null;
            let stopped = false;
            let reason: NativeFailureReason | undefined;
            let rssFailure: string | undefined;
            let rssErrorCode: string | undefined;
            let fallback: ReturnType<typeof setTimeout> | undefined;
            const killGroup = () => {
                if (child.pid && process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already gone. */ } }
                child.kill('SIGKILL');
            };
            const stop = (cause: NativeFailureReason) => {
                reason ??= cause;
                if (stopped) return; stopped = true;
                if (child.connected) { try { child.send({ cancel: true }, () => undefined); } catch { killGroup(); } }
                else killGroup();
                // A responsive supervisor kills and awaits the native child.
                // This fallback kills the entire owned group, never just Node.
                fallback = setTimeout(killGroup, 250);
            };
            const timer = setTimeout(() => stop('deadline'), Math.max(1, options.deadlineAtMs - Date.now()));
            const onAbort = () => stop('cancelled');
            child.once('error', () => stop('spawn_failure'));
            child.on('message', (value: unknown) => {
                if (stopped) return;
                const message = value as { ok?: unknown; result?: NativeCommandResult } | null;
                if (message?.ok === false) {
                    const reportedReason = nativeFailureReason(message, 'reason');
                    if (reportedReason === 'rss_unavailable') {
                        rssFailure = safeRssField(message, 'rssFailure', rssCategories);
                        rssErrorCode = safeRssField(message, 'rssErrorCode', rssOsCodes);
                    }
                    stop(reportedReason ?? 'invalid_result'); return;
                }
                const candidate = message?.result;
                if (message?.ok !== true || result || !candidate || !Number.isInteger(candidate.code)
                    || typeof candidate.stdout !== 'string' || typeof candidate.stderr !== 'string'
                    || Buffer.byteLength(candidate.stdout) > 65536 || Buffer.byteLength(candidate.stderr) > 65536
                    || !Number.isFinite(candidate.peakCombinedRssBytes) || candidate.peakCombinedRssBytes <= 0
                    || candidate.peakCombinedRssBytes > options.maxCombinedRssBytes) { stop('invalid_result'); return; }
                result = candidate;
            });
            child.once('close', code => {
                clearTimeout(timer); clearTimeout(fallback); options.signal?.removeEventListener('abort', onAbort);
                // Retire the owned process group even after a normal result, so
                // a residual helper cannot outlive the completed supervisor.
                killGroup();
                if (!stopped && code === 0 && result) accept(result);
                else reject(failure(reason ?? (code === 0 && !result ? 'missing_result' : 'child_exit'), rssFailure, rssErrorCode));
            });
            options.signal?.addEventListener('abort', onAbort, { once: true });
            if (options.signal?.aborted) stop('cancelled');
            else try {
                child.send({ command, args, assetsDirectory: options.assetsDirectory, workDirectory: options.workDirectory,
                    deadlineAtMs: options.deadlineAtMs, maxCombinedRssBytes: options.maxCombinedRssBytes }, error => { if (error) stop('invalid_control'); });
            } catch { stop('invalid_control'); }
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
        this.maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
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
                        if (bytes > this.maxBytes) throw new MalwareScannerError('size_limit', 'Antivirus input exceeds the configured byte limit', false);
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
                `--max-filesize=${Math.ceil(this.maxBytes / (1024 * 1024)) + 1}M`,
                `--max-scansize=${Math.max(30, Math.ceil(this.maxBytes / (1024 * 1024)) * 3)}M`,
                // PDF objects and normalized text count separately. Keep this
                // finite while admitting the official multi-page regulations.
                '--max-recursion=10', '--max-files=1000', '--max-scantime=60000',
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
