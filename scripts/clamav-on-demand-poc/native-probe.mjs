import { cp, mkdir, readFile, stat, statfs, writeFile } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { makePdf } from './core.mjs';

const root = dirname(fileURLToPath(import.meta.url));
let running = false;
export async function runNativeProbe() {
    if (running || process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Native probe unavailable');
    running = true;
    let directory, scanner, definitions;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 275000);
    const commands = [], scans = [];
    let cleanup;
    let phase = 'setup';
    try {
        // Native outputs exist only in opted-in builds; explicit includeFiles
        // bundles them without making the default POC require missing modules.
        const { NativeClamAvScanner, createNativeCommandRunner } = await import(pathToFileURL(join(root, 'native/services/native-clamav.service.js')).href);
        const { NativeClamAvDefinitions, nativeWorkspace, removeNativeWorkspace } = await import(pathToFileURL(join(root, 'native/services/native-clamav-definitions.js')).href);
        cleanup = removeNativeWorkspace;
        directory = await nativeWorkspace('definitions');
        const assets = join(root, 'vendor');
        const manifest = JSON.parse(await readFile(join(assets, 'manifest.json'), 'utf8'));
        if (manifest.includesUpdateTools !== true) throw new Error('Native update tools not bundled');
        const before = await statfs(directory);
        // Only definition bytes are copied. Executables, libraries and roots of
        // trust remain in the immutable signed vendor bundle. At most two CVD
        // copies occupy /tmp: this seed and the adapter's authenticated cache.
        if (before.bavail * before.bsize < manifest.databases.reduce((total, db) => total + db.bytes + db.signatureBytes, 0) * 2 + 30 * 1024 * 1024) throw new Error('Insufficient private temporary capacity');
        await mkdir(join(directory, 'database'), { mode: 0o700 });
        for (const db of manifest.databases) for (const file of [`${db.name}.cvd`, db.signatureFile]) {
            await cp(join(assets, 'database', file), join(directory, 'database', file));
        }
        const forcedVerifiedAt = new Date(Date.now() - 86400001).toISOString();
        await writeFile(join(directory, 'manifest.json'), JSON.stringify({ ...manifest, verifiedAt: forcedVerifiedAt }), { mode: 0o600 });
        const nativeRun = createNativeCommandRunner();
        let abortNextScan = false, abortedFile;
        const run = async (command, args, options) => {
            const started = Date.now(); let abortTimer;
            if (abortNextScan && basename(command) === 'clamscan') {
                abortNextScan = false; abortedFile = args.at(-1);
                abortTimer = setTimeout(() => abortController.abort(), 1000);
            }
            try {
                const result = await nativeRun(command, args, options);
                commands.push({ command: basename(command), elapsedMs: Date.now() - started, exitCode: result.code, peakCombinedRssBytes: result.peakCombinedRssBytes });
                return result;
            } catch (error) {
                commands.push({ command: basename(command), elapsedMs: Date.now() - started, completed: false });
                throw error;
            } finally { clearTimeout(abortTimer); }
        };
        definitions = new NativeClamAvDefinitions(assets, run, 1800 * 1024 * 1024, directory);
        scanner = new NativeClamAvScanner({ assetsDirectory: assets, timeoutMs: 200000 }, { run, definitions });
        phase = 'forced_refresh_and_health';
        await scanner.healthCheck(controller.signal);
        const proof = scanner.getEngineEvidence();
        const refreshVerified = proof && Date.parse(proof.definitionsVerifiedAt) > Date.parse(forcedVerifiedAt)
            && commands.filter(command => command.command === 'freshclam' && command.exitCode === 0).length === 1;
        if (!refreshVerified) throw new Error('Forced official refresh did not complete');
        const fixtures = [{ name: 'small.pdf', bytes: makePdf(1024), expected: 'clean' }, { name: 'ten-mib.pdf', bytes: makePdf(10 * 1024 * 1024), expected: 'clean' },
            { name: 'eicar.txt', bytes: Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$' + 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'), expected: 'infected' }];
        for (const fixture of fixtures) {
            phase = `scan_${fixture.name}`;
            const started = Date.now();
            const result = await scanner.scanStream(Readable.from([fixture.bytes]), fixture.bytes.length, controller.signal);
            const passed = result.verdict === fixture.expected && result.engineEvidence?.definitionsDigest === proof.definitionsDigest;
            scans.push({ fixture: fixture.name, bytes: fixture.bytes.length, verdict: result.verdict, passed, elapsedMs: Date.now() - started });
            if (!passed) break;
        }
        // Reuse the same harmless small fixture to prove actual cancellation and
        // cleanup. No fourth input type or arbitrary data is accepted.
        const abortController = new AbortController();
        phase = 'cancellation';
        const abortSignal = AbortSignal.any([controller.signal, abortController.signal]);
        abortNextScan = true;
        let abortRejected = false;
        try { await scanner.scanStream(Readable.from([fixtures[0].bytes]), fixtures[0].bytes.length, abortSignal); }
        catch { abortRejected = abortController.signal.aborted; }
        let tempCleaned = false;
        if (abortedFile) { try { await stat(abortedFile); } catch (error) { tempCleaned = error.code === 'ENOENT'; } }
        const peakCombinedRssBytes = Math.max(...commands.map(command => command.peakCombinedRssBytes ?? 0));
        return { poc: true, nativeAdapter: true, productionIntegrated: false,
            passed: refreshVerified && scans.length === 3 && scans.every(scan => scan.passed) && abortRejected && tempCleaned,
            forcedRefreshVerified: refreshVerified, definitionsVerifiedAt: proof.definitionsVerifiedAt, definitionsExpiresAt: proof.definitionsExpiresAt,
            definitionsDigest: proof.definitionsDigest, engineVersion: proof.engineVersion, bundleBytes: manifest.bundleBytes,
            tmpAvailableBeforeBytes: before.bavail * before.bsize, peakCombinedRssBytes,
            rssMeasurement: 'Linux proc sampled every25ms: calling Node plus supervisor plus native descendants; not complete cgroup accounting',
            abortRejected, tempCleaned, scans, commands };
    } catch {
        return { poc: true, nativeAdapter: true, productionIntegrated: false, passed: false, phase, scans, commands };
    } finally {
        clearTimeout(timer);
        try { if (scanner) await scanner.dispose(); else if (definitions) await definitions.dispose(); }
        finally { try { if (directory && cleanup) await cleanup(directory); } finally { running = false; } }
    }
}
