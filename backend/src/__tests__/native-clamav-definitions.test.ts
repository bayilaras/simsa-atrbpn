import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { NativeClamAvDefinitions } from '../services/native-clamav-definitions.js';

const dirs: string[] = [];
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
async function assets(age = 0) {
    const directory = await mkdtemp(join(tmpdir(), 'simsa-native-test-')); dirs.push(directory);
    await mkdir(join(directory, 'database'));
    const databases = [];
    for (const name of ['main', 'daily', 'bytecode']) {
        const bytes = Buffer.alloc(512); bytes.write('ClamAV-VDB:synthetic:1:0:0:hash:sig:builder:1');
        const signature = Buffer.from('synthetic-signature');
        await writeFile(join(directory, 'database', `${name}.cvd`), bytes);
        await writeFile(join(directory, 'database', `${name}-1.cvd.sign`), signature);
        databases.push({ name, version: 1, bytes: bytes.length, sha256: sha(bytes), signatureFile: `${name}-1.cvd.sign`, signatureBytes: signature.length, signatureSha256: sha(signature) });
    }
    const verifiedAt = new Date(Date.now() - age).toISOString();
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ version: '1.5.4', verifiedAt, databases }));
    return { directory, verifiedAt };
}
const verification = { code: 0, stdout: 'Version: 1\nVerification OK.\n', stderr: '', peakCombinedRssBytes: 1000 };
afterEach(async () => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
describe('native signed definitions and freshness', () => {
    it('authenticates all three signatures once on warm reuse without moving the freshness timestamp', async () => {
        const fixture = await assets(); const run = vi.fn(async () => verification);
        const manager = new NativeClamAvDefinitions(fixture.directory, run);
        const first = await manager.acquire(Date.now() + 10000);
        const second = await manager.acquire(Date.now() + 10000);
        expect(first).toEqual(second); expect(run).toHaveBeenCalledTimes(3);
        expect(first.evidence.definitionsVerifiedAt).toBe(fixture.verifiedAt);
        expect(Date.parse(first.evidence.definitionsExpiresAt) - Date.parse(fixture.verifiedAt)).toBe(86_400_000);
        expect(run.mock.calls.every(call => call[1].includes('--fips-limits'))).toBe(true);
    });
    it('refuses altered baseline hashes and failed signature authentication', async () => {
        const fixture = await assets();
        await writeFile(join(fixture.directory, 'database', 'daily-1.cvd.sign'), 'tampered');
        await expect(new NativeClamAvDefinitions(fixture.directory, vi.fn(async () => verification)).acquire(Date.now() + 10000)).rejects.toThrow();
        const valid = await assets();
        await expect(new NativeClamAvDefinitions(valid.directory, vi.fn(async () => ({ ...verification, stdout: 'Version: 1\nUnsigned container' }))).acquire(Date.now() + 10000)).rejects.toThrow();
    });
    it('expired baseline runs one Freshclam update before verifying and publishing a fresh cache', async () => {
        const fixture = await assets(86_400_001); let updates = 0;
        const run = vi.fn(async (command: string, args: string[]) => {
            if (command.endsWith('freshclam')) {
                updates++;
                const config = await readFile(args[1], 'utf8');
                expect(config).toContain('FIPSCryptoHashLimits yes'); expect(config).toContain('TestDatabases yes');
                expect(config).toContain('ScriptedUpdates no');
                return { ...verification, stdout: 'All databases are up-to-date.' };
            }
            return verification;
        });
        const manager = new NativeClamAvDefinitions(fixture.directory, run);
        const [a, b] = await Promise.all([manager.acquire(Date.now() + 10000), manager.acquire(Date.now() + 10000)]);
        expect(updates).toBe(1); expect(a).toEqual(b); expect(a.directory).not.toBe(join(fixture.directory, 'database'));
        expect(Date.parse(a.evidence.definitionsVerifiedAt)).toBeGreaterThan(Date.parse(fixture.verifiedAt));
        await manager.release(a); await manager.release(b); await manager.dispose();
    });
    it('never falls back to stale definitions after Freshclam failure', async () => {
        const fixture = await assets(86_400_001);
        const manager = new NativeClamAvDefinitions(fixture.directory, vi.fn(async command => command.endsWith('freshclam') ? { ...verification, code: 1 } : verification));
        await expect(manager.acquire(Date.now() + 10000)).rejects.toThrow();
        expect(manager.getEvidence()).toBeNull(); await manager.dispose();
    });
    it('rejects future timestamps and rejects stale signed CVDs when refresh signature authentication fails', async () => {
        const future = await assets(-60000);
        await expect(new NativeClamAvDefinitions(future.directory, vi.fn(async () => verification)).acquire(Date.now() + 10000)).rejects.toThrow();
        const old = await assets(86_400_001);
        const manager = new NativeClamAvDefinitions(old.directory, vi.fn(async command => command.endsWith('freshclam') ? { ...verification, stdout: 'up-to-date' } : { ...verification, stdout: 'Verification FAILED' }));
        await expect(manager.acquire(Date.now() + 10000)).rejects.toThrow(); expect(manager.getEvidence()).toBeNull();
        await manager.dispose();
    });
    it('aborting an updater waits for its close and never publishes partially refreshed evidence', async () => {
        const fixture = await assets(86_400_001); const controller = new AbortController();
        let entered: (() => void) | undefined, close: (() => void) | undefined;
        const started = new Promise<void>(resolve => { entered = resolve; });
        const run = vi.fn(async (_command, _args, options) => {
            entered!(); await new Promise<void>(resolve => { close = resolve; });
            options.signal.throwIfAborted(); return verification;
        });
        const manager = new NativeClamAvDefinitions(fixture.directory, run);
        let settled = false;
        const pending = manager.acquire(Date.now() + 10000, controller.signal).catch(error => { settled = true; return error; });
        await started; controller.abort(); await Promise.resolve();
        expect(settled).toBe(false); expect(manager.getEvidence()).toBeNull();
        close!(); await pending; expect(manager.getEvidence()).toBeNull(); await manager.dispose();
    });
    it('does not delete an in-use cache and disposes it after the last borrower releases', async () => {
        const fixture = await assets(86_400_001);
        const manager = new NativeClamAvDefinitions(fixture.directory, vi.fn(async () => verification));
        const snapshot = await manager.acquire(Date.now() + 10000);
        await expect(manager.dispose()).rejects.toThrow('still in use');
        expect((await stat(snapshot.directory)).isDirectory()).toBe(true);
        await manager.release(snapshot); await manager.dispose();
        await expect(stat(snapshot.directory)).rejects.toThrow();
    });
});
