import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { internalRuntimeConfig, validateInternalBuild } from './config/internal-runtime.js';

// Validate before importing the application graph (auth, database, and workers).
// The Windows launcher supplies the existing env file; no data is seeded here.
async function main() {
    const { host, port } = internalRuntimeConfig(process.env);
    const frontendDist = fileURLToPath(new URL('../../frontend/dist/', import.meta.url));
    validateInternalBuild(JSON.parse(await readFile(new URL('../../frontend/dist/simsa-build.json', import.meta.url), 'utf8')));
    process.env.PORT = String(port);
    process.env.SIMSA_FRONTEND_DIST = frontendDist;
    const { validateEnv, malwareScanConfig } = await import('./config/env.js');
    validateEnv();
    const { default: app } = await import('./app.js');
    const { malwareScanWorker } = await import('./services/malware-scan.worker.js');
    // This listener is reached directly, with no trusted reverse proxy.
    app.set('trust proxy', false);
    const server = app.listen({ host, port }, () => {
        console.info(`SIMSA internal tersedia di http://${host}:${port}`);
        if (malwareScanConfig.worker.runtime === 'embedded') malwareScanWorker.start();
    });
    server.on('error', () => {
        console.error('SIMSA gagal membuka port lokal. Jalankan Cek-SIMSA.cmd untuk memeriksa layanan.');
        process.exit(1);
    });
    let stopping = false;
    const stop = () => {
        if (stopping) return;
        stopping = true;
        const deadline = setTimeout(() => process.exit(1), 10000);
        deadline.unref();
        const workerStopped = malwareScanWorker.stop();
        server.close(async () => { await workerStopped; process.exit(0); });
        server.closeIdleConnections();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}

main().catch(() => {
    // Startup errors may contain database URLs or provider credentials.
    console.error('SIMSA tidak dapat dimulai. Periksa konfigurasi lokal dan hasil build; jalankan Cek-SIMSA.cmd.');
    process.exit(1);
});
