import { createStorageFinalizedApp } from './storage-finalized.app.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('StorageFinalizedServer');
const port = Number(process.env.PORT || 8080);
const app = createStorageFinalizedApp();
const server = app.listen(port, () => {
    log.info({ port }, 'Private Cloud Storage event receiver started');
});

function shutdown(signal: string): void {
    log.info({ signal }, 'Storage event receiver shutting down');
    server.close(error => {
        if (error) {
            log.error({ err: error }, 'Storage event receiver could not stop cleanly');
            process.exit(1);
        }
        process.exit(0);
    });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
