import app from './app';
import { env, malwareScanConfig, validateEnv } from './config/env';
import { logger } from './utils/logger';
import { malwareScanWorker } from './services/malware-scan.worker.js';
import { getDemoListenHost, isMetadataDemo } from './config/demo.js';

// Validate environment variables
try {
    validateEnv();
} catch (error) {
    logger.fatal({ err: error }, 'Environment validation failed');
    process.exit(1);
}

// Start server
const PORT = env.PORT;
const listenHost = getDemoListenHost();

const server = app.listen({
    port: PORT,
    ...(listenHost ? { host: listenHost } : {}),
}, () => {
    logger.info({
        port: PORT,
        host: listenHost,
        env: env.NODE_ENV,
        frontendUrl: env.FRONTEND_URL,
    }, `SIMSA Backend running at http://localhost:${PORT}`);
});

// The worker uses atomic database claims, so multiple persistent application
// instances may run it safely. Disabled/test environments keep every file in
// quarantine because only an actual clean verdict changes release state.
if (isMetadataDemo()) {
    logger.info('Metadata demo serves no file uploads and starts no background workers');
} else if (malwareScanConfig.worker.runtime === 'embedded') {
    malwareScanWorker.start();
} else {
    logger.info('Malware scanning is assigned to the external persistent worker');
}

// Graceful shutdown handler
function gracefulShutdown(signal: string) {
    logger.info({ signal }, 'Graceful shutdown initiated');

    const workerStopped = malwareScanWorker.stop();

    server.close(async () => {
        await workerStopped;
        logger.info('HTTP server closed');
        process.exit(0);
    });

    // Force shutdown after 10 seconds if connections aren't closed
    setTimeout(() => {
        logger.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle unhandled rejections and uncaught exceptions
process.on('unhandledRejection', (reason: Error) => {
    logger.error({ err: reason }, 'Unhandled Rejection');
    // Don't exit — let the error handler deal with it
});

process.on('uncaughtException', (error: Error) => {
    logger.fatal({ err: error }, 'Uncaught Exception');
    gracefulShutdown('uncaughtException');
});
