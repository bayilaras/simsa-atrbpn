import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, cp, lstat, mkdir, mkdtemp, open, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isCurrentMalwareEngineEvidence, type MalwareEngineEvidence } from './malware-scanner.service.js';

export const NATIVE_CLAMAV_VERSION = '1.5.4';
export const NATIVE_DEFINITION_TTL_MS = 86_400_000;
const DATABASES = ['main', 'daily', 'bytecode'] as const;
export interface NativeCommandResult { code: number | null; stdout: string; stderr: string; peakCombinedRssBytes: number }
export interface NativeCommandOptions { assetsDirectory: string; workDirectory: string; deadlineAtMs: number; maxCombinedRssBytes: number; signal?: AbortSignal }
export type NativeCommandRunner = (command: string, args: string[], options: NativeCommandOptions) => Promise<NativeCommandResult>;
export interface NativeDefinitionSnapshot { directory: string; evidence: MalwareEngineEvidence }
export interface NativeDefinitionStore {
    acquire(deadlineAtMs: number, signal?: AbortSignal): Promise<NativeDefinitionSnapshot>;
    getEvidence(): MalwareEngineEvidence | null;
    release?(snapshot: NativeDefinitionSnapshot): Promise<void>;
    dispose?(): Promise<void>;
}
interface DatabaseArtifact { name: string; version: number; bytes: number; sha256: string; signatureFile: string; signatureBytes: number; signatureSha256: string }

export async function removeNativeWorkspace(directory: string): Promise<void> {
    const physical = await realpath(directory);
    const parent = await realpath(tmpdir());
    if (resolve(physical) !== resolve(directory) || dirname(physical) !== parent || !/^simsa-native-[a-z]+-/.test(physical.slice(parent.length + 1))) {
        throw new Error('Unsafe antivirus workspace cleanup path');
    }
    await rm(physical, { recursive: true, force: false });
}
export async function nativeWorkspace(kind: 'scan' | 'definitions'): Promise<string> {
    const directory = await mkdtemp(join(await realpath(tmpdir()), `simsa-native-${kind}-`));
    await chmod(directory, 0o700);
    return directory;
}
function checkDeadline(deadlineAtMs: number, signal?: AbortSignal): void {
    signal?.throwIfAborted();
    if (!Number.isFinite(deadlineAtMs) || deadlineAtMs <= Date.now()) throw new Error('Antivirus deadline exhausted');
}
async function boundedHash(path: string, minimum: number, maximum: number, deadlineAtMs: number, signal?: AbortSignal): Promise<{ bytes: number; sha256: string }> {
    checkDeadline(deadlineAtMs, signal);
    const info = await lstat(path);
    if (!info.isFile() || info.size < minimum || info.size > maximum) throw new Error('Invalid antivirus asset');
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of createReadStream(path, { signal })) {
        checkDeadline(deadlineAtMs, signal);
        bytes += chunk.length;
        if (bytes > maximum) throw new Error('Antivirus asset exceeds bound');
        hash.update(chunk);
    }
    if (bytes !== info.size) throw new Error('Antivirus asset changed during verification');
    return { bytes, sha256: hash.digest('hex') };
}
async function readArtifact(directory: string, name: string, deadlineAtMs: number, signal?: AbortSignal): Promise<DatabaseArtifact> {
    const path = join(directory, `${name}.cvd`);
    const hashed = await boundedHash(path, 512, 120 * 1024 * 1024, deadlineAtMs, signal);
    const file = await open(path, 'r'); const header = Buffer.alloc(512);
    try { await file.read(header, 0, header.length, 0); } finally { await file.close(); }
    const fields = header.toString('ascii').trim().split(':'); const version = Number(fields[2]);
    if (fields[0] !== 'ClamAV-VDB' || fields.length < 9 || !/^\d+$/.test(fields[2] ?? '') || !Number.isSafeInteger(version) || version < 1) throw new Error('Invalid signed definition header');
    const signatureFile = `${name}-${version}.cvd.sign`;
    const signature = await boundedHash(join(directory, signatureFile), 1, 65536, deadlineAtMs, signal);
    return { name, version, ...hashed, signatureFile, signatureBytes: signature.bytes, signatureSha256: signature.sha256 };
}
function assertVerification(result: NativeCommandResult, version: number): void {
    if (result.code !== 0 || /ERROR|Unsigned container/i.test(`${result.stdout}\n${result.stderr}`)
        || !new RegExp(`^Version:\\s+${version}\\s*$`, 'm').test(result.stdout)
        || !/^Verification OK\.\s*$/m.test(result.stdout)) throw new Error('Definition signature authentication failed');
}

/** Snapshot timestamps are upstream update/check times, never local read times. */
export class NativeClamAvDefinitions implements NativeDefinitionStore {
    private snapshot: NativeDefinitionSnapshot | null = null;
    private inFlight: Promise<NativeDefinitionSnapshot> | null = null;
    private readonly workspaces = new Set<string>();
    private readonly references = new Map<string, number>();
    constructor(private readonly assetsDirectory: string, private readonly run: NativeCommandRunner,
        private readonly maxCombinedRssBytes = 1800 * 1024 * 1024,
        private readonly baselineDirectory = assetsDirectory) {
        if (/[\r\n\0]/.test(assetsDirectory + baselineDirectory)) throw new Error('Invalid antivirus asset path');
    }
    getEvidence(): MalwareEngineEvidence | null {
        return this.snapshot && isCurrentMalwareEngineEvidence(this.snapshot.evidence) ? structuredClone(this.snapshot.evidence) : null;
    }
    async acquire(deadlineAtMs: number, signal?: AbortSignal): Promise<NativeDefinitionSnapshot> {
        checkDeadline(deadlineAtMs, signal);
        if (!this.snapshot || !isCurrentMalwareEngineEvidence(this.snapshot.evidence)) {
            this.inFlight ??= this.prepare(deadlineAtMs, signal).finally(() => { this.inFlight = null; });
        }
        // An aborted waiter still waits for the owned updater to close. The global
        // scanner capacity lease must not be released while Freshclam is alive.
        const snapshot = this.inFlight ? await this.inFlight : this.snapshot!;
        checkDeadline(deadlineAtMs, signal);
        this.references.set(snapshot.directory, (this.references.get(snapshot.directory) ?? 0) + 1);
        return snapshot;
    }
    private async authenticate(directory: string, deadlineAtMs: number, signal?: AbortSignal): Promise<DatabaseArtifact[]> {
        const databases: DatabaseArtifact[] = [];
        for (const name of DATABASES) {
            checkDeadline(deadlineAtMs, signal);
            const artifact = await readArtifact(directory, name, deadlineAtMs, signal);
            const result = await this.run(join(this.assetsDirectory, 'bin/sigtool'), [`--info=${join(directory, `${name}.cvd`)}`, '--fips-limits', `--cvdcertsdir=${join(this.assetsDirectory, 'etc/certs')}`], {
                assetsDirectory: this.assetsDirectory, workDirectory: directory, deadlineAtMs, maxCombinedRssBytes: this.maxCombinedRssBytes, signal,
            });
            assertVerification(result, artifact.version); databases.push(artifact);
        }
        return databases;
    }
    private async prepare(deadlineAtMs: number, signal?: AbortSignal): Promise<NativeDefinitionSnapshot> {
        const manifestPath = join(this.baselineDirectory, 'manifest.json');
        const manifestInfo = await lstat(manifestPath);
        if (!manifestInfo.isFile() || manifestInfo.size > 65536) throw new Error('Invalid antivirus manifest');
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        const verifiedAt = Date.parse(manifest.verifiedAt);
        if (manifest.version !== NATIVE_CLAMAV_VERSION || !Number.isFinite(verifiedAt) || verifiedAt > Date.now()
            || !Array.isArray(manifest.databases) || manifest.databases.length !== 3) throw new Error('Invalid antivirus manifest identity');
        const baseline = join(this.baselineDirectory, 'database');
        // Compare every signed artifact with the packaged manifest, even if an
        // old baseline is about to seed the first on-demand update.
        for (const name of DATABASES) {
            const expected = manifest.databases.find((item: DatabaseArtifact) => item.name === name);
            const actual = await readArtifact(baseline, name, deadlineAtMs, signal);
            if (!expected || Object.keys(actual).some(key => actual[key as keyof DatabaseArtifact] !== expected[key])) throw new Error('Packaged antivirus definition hash mismatch');
        }
        let directory = baseline;
        let updatedAt = verifiedAt;
        let owned: string | null = null;
        const previous = this.snapshot;
        try {
            if (Date.now() >= verifiedAt + NATIVE_DEFINITION_TTL_MS) {
                owned = await nativeWorkspace('definitions'); this.workspaces.add(owned);
                directory = join(owned, 'database'); await mkdir(directory, { mode: 0o700 });
                const seed = this.snapshot?.directory ?? baseline;
                for (const name of DATABASES) {
                    const artifact = await readArtifact(seed, name, deadlineAtMs, signal);
                    await cp(join(seed, `${name}.cvd`), join(directory, `${name}.cvd`));
                    await cp(join(seed, artifact.signatureFile), join(directory, artifact.signatureFile));
                }
                const owner = userInfo().username;
                if (!/^[a-z0-9_.-]+$/i.test(owner)) throw new Error('Unsupported antivirus database owner');
                const config = join(owned, 'freshclam.conf');
                await writeFile(config, [`DatabaseDirectory ${directory}`, `DatabaseOwner ${owner}`, 'DatabaseMirror database.clamav.net', 'DNSDatabaseInfo current.cvd.clamav.net', 'ConnectTimeout 15', 'ReceiveTimeout 90', 'MaxAttempts 1', 'TestDatabases yes', 'Bytecode yes', 'ScriptedUpdates no', 'FIPSCryptoHashLimits yes', `CVDCertsDirectory ${join(this.assetsDirectory, 'etc/certs')}`, ''].join('\n'), { mode: 0o600, flag: 'wx' });
                const update = await this.run(join(this.assetsDirectory, 'bin/freshclam'), ['--config-file', config, '--stdout'], {
                    assetsDirectory: this.assetsDirectory, workDirectory: owned, deadlineAtMs, maxCombinedRssBytes: this.maxCombinedRssBytes, signal,
                });
                if (update.code !== 0 || /ERROR|Can't download|failed to update/i.test(`${update.stdout}\n${update.stderr}`)) throw new Error('Official antivirus definition update failed');
                updatedAt = Date.now();
            }
            const artifacts = await this.authenticate(directory, deadlineAtMs, signal);
            const databases = artifacts.map(({ name, version, sha256, signatureSha256 }) => ({ name, version, sha256, signatureSha256 }));
            const evidence: MalwareEngineEvidence = {
                engineVersion: NATIVE_CLAMAV_VERSION, definitionsVerifiedAt: new Date(updatedAt).toISOString(),
                definitionsExpiresAt: new Date(updatedAt + NATIVE_DEFINITION_TTL_MS).toISOString(),
                definitionsDigest: createHash('sha256').update(JSON.stringify(databases)).digest('hex'), databases,
            };
            checkDeadline(deadlineAtMs, signal);
            if (!isCurrentMalwareEngineEvidence(evidence)) throw new Error('Antivirus definitions expired during verification');
            this.snapshot = { directory, evidence };
            await this.removeUnusedCaches();
            return this.snapshot;
        } catch (error) {
            this.snapshot = previous;
            if (owned) { await removeNativeWorkspace(owned); this.workspaces.delete(owned); }
            throw error;
        }
    }
    private async removeUnusedCaches(): Promise<void> {
        for (const directory of this.workspaces) {
            const database = join(directory, 'database');
            if (database !== this.snapshot?.directory && (this.references.get(database) ?? 0) === 0) {
                await removeNativeWorkspace(directory); this.workspaces.delete(directory); this.references.delete(database);
            }
        }
    }
    async release(snapshot: NativeDefinitionSnapshot): Promise<void> {
        const count = this.references.get(snapshot.directory) ?? 0;
        if (count > 0) this.references.set(snapshot.directory, count - 1);
        await this.removeUnusedCaches();
    }
    async dispose(): Promise<void> {
        if (this.inFlight) await this.inFlight.catch(() => undefined);
        if ([...this.references.values()].some(count => count > 0)) throw new Error('Antivirus definitions are still in use');
        this.snapshot = null;
        for (const directory of this.workspaces) { await removeNativeWorkspace(directory); this.workspaces.delete(directory); }
    }
}
