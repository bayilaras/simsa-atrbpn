import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pool, buildDatabasePoolConfig } from '../config/database.js';
import { validateDemoEnvironment } from '../config/demo.js';
import { assertValidBlobStorageEnvironment } from '../config/blob-storage.js';
import { assertGcpIamDatabaseRuntimeEnvironment, assertValidCloudPlatformEnvironment, buildCloudPlatformConfig } from '../config/cloud-platform.js';
import { blobStorageService } from '../services/blob-storage.service.js';
import { FileFixityService, loadFixityConfig } from '../services/file-fixity.service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('FileFixityWorker');

export async function runFileFixity() {
    validateDemoEnvironment('file-fixity');
    buildDatabasePoolConfig(process.env);
    const config = loadFixityConfig();
    if (buildCloudPlatformConfig().storageProvider === 'gcs') {
        const cloud = assertValidCloudPlatformEnvironment(process.env, { requireAuth: false });
        assertGcpIamDatabaseRuntimeEnvironment(process.env, cloud.projectId);
    } else {
        assertValidBlobStorageEnvironment({ ...process.env, NODE_ENV: 'production' }, { requireCallbackUrl: false });
    }
    const service = new FileFixityService(pool, (locator, options) => blobStorageService.downloadFile(locator, options));
    return service.run(config);
}

export async function main() {
    try {
        const result = await runFileFixity();
        log.info(result, 'Scheduled file integrity inspection completed');
        if (result.failed || result.mismatched || result.stale) {
            log.error(result, 'File integrity inspection requires operator review');
            process.exitCode = 1;
        }
    } catch (error) {
        log.error({ err: error }, 'File integrity job failed');
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void main();
