import pino from 'pino';

try {
    // Configuration builders can throw while env.ts is being evaluated. The
    // ordinary logger imports env.ts too, so neither it nor the application
    // graph may be imported statically outside this startup error boundary.
    const { validateEnv } = await import('./config/env.js');
    validateEnv();
    await import('./api-runtime.js');
} catch (error) {
    // Startup failures must remain structured even when normal configuration
    // (including NODE_ENV) is invalid. A synchronous destination flushes the
    // fatal record before exit, without requiring the development transport.
    const startupLogger = pino({
        level: 'fatal',
        formatters: { level: label => ({ level: label }) },
        redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie', 'password', 'token'],
            censor: '[REDACTED]',
        },
    }, pino.destination({ dest: 2, sync: true }));
    startupLogger.fatal({ err: error }, 'Environment validation failed');
    process.exit(1);
}
