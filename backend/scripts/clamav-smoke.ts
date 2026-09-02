import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { ClamAvScanner, MalwareScannerError } from '../src/services/malware-scanner.service.js';

function parsePositiveInteger(name: string, fallback: number): number {
    const raw = process.env[name]?.trim();
    if (!raw) return fallback;

    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return value;
}

const host = process.env.CLAMAV_HOST?.trim() || '127.0.0.1';
const port = parsePositiveInteger('CLAMAV_PORT', 3310);
const waitMs = parsePositiveInteger('CLAMAV_SMOKE_WAIT_MS', 6 * 60_000);
const pollMs = parsePositiveInteger('CLAMAV_SMOKE_POLL_MS', 2_000);

const scanner = new ClamAvScanner({
    host,
    port,
    connectTimeoutMs: 2_000,
    scanTimeoutMs: 30_000,
    maxStreamBytes: 1024 * 1024,
});

function errorSummary(error: unknown): string {
    if (error instanceof MalwareScannerError) {
        return `${error.name}(${error.code}): ${error.message}`;
    }
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function waitForScanner(): Promise<void> {
    const deadline = Date.now() + waitMs;
    let lastError: unknown;

    while (Date.now() < deadline) {
        try {
            await scanner.healthCheck();
            return;
        } catch (error) {
            lastError = error;
            await delay(pollMs);
        }
    }

    throw new Error(
        `ClamAV was not ready at ${host}:${port} within ${waitMs}ms; last error: ${errorSummary(lastError)}`,
    );
}

async function main(): Promise<void> {
    await waitForScanner();

    const clean = Buffer.from('SIMSA ClamAV integration smoke sample\n', 'utf8');
    const cleanVerdict = await scanner.scanStream(Readable.from([clean]), clean.length);
    if (cleanVerdict.verdict !== 'clean') {
        throw new Error(`Clean sample was rejected as ${cleanVerdict.verdict}`);
    }

    // Split the standard harmless EICAR test pattern so endpoint protection does
    // not quarantine the repository itself before the CI scanner can receive it.
    const eicar = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$' + 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*', 'ascii');
    const infectedVerdict = await scanner.scanStream(Readable.from([eicar]), eicar.length);
    if (infectedVerdict.verdict !== 'infected') {
        throw new Error(`EICAR sample was not detected; scanner returned ${infectedVerdict.verdict}`);
    }
    if (!/eicar/i.test(infectedVerdict.signature)) {
        throw new Error('ClamAV returned an unexpected signature for the EICAR sample');
    }

    await scanner.healthCheck();
    console.log(`ClamAV smoke passed at ${host}:${port}: clean accepted, EICAR detected`);
}

main().catch((error: unknown) => {
    console.error(`ClamAV smoke failed: ${errorSummary(error)}`);
    process.exitCode = 1;
});
