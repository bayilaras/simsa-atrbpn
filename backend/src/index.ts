import app from './app';
import { env, validateEnv } from './config/env';
import { logger } from './utils/logger';

// Validate environment variables
try {
    validateEnv();
} catch (error) {
    logger.fatal({ err: error }, 'Environment validation failed');
    process.exit(1);
}

// Start server
const PORT = env.PORT;

const server = app.listen(PORT, () => {
    logger.info({
        port: PORT,
        env: env.NODE_ENV,
        frontendUrl: env.FRONTEND_URL,
    }, `SIMSA Backend running at http://localhost:${PORT}`);
});

// Graceful shutdown handler
function gracefulShutdown(signal: string) {
    logger.info({ signal }, 'Graceful shutdown initiated');

    server.close(() => {
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
