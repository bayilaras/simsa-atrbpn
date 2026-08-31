import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { buildCloudPlatformConfig } from '../config/cloud-platform.js';
import { env } from '../config/env.js';
import { isTrustedOrigin } from '../config/trusted-origins.js';
import { authMiddleware, type AuthRequest } from '../middlewares/auth.middleware.js';
import { firebaseReplayProtectedAppCheckMiddleware } from '../middlewares/firebase-app-check.middleware.js';
import { uploadLimiter } from '../middlewares/rate-limiter.middleware.js';
import { canWriteMiddleware } from '../middlewares/role.middleware.js';
import { clientBlobUploadService, type ClientBlobPurpose } from '../services/client-blob-upload.service.js';
import regulatoryRuleSetService, {
    REGULATORY_SOURCE_MAX_BYTES,
} from '../services/regulatory-rule-set.service.js';
import { GcsStorageAdapter } from '../storage/gcs.adapter.js';
import { toGcsLocator } from '../storage/locator.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const log = createLogger('GcsUploadRoutes');

const ALLOWED_TYPES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
]);

const initiateSchema = z.object({
    purpose: z.enum(['surat_masuk', 'surat_keluar', 'regulatory_source']),
    fileName: z.string().min(1).max(240),
    contentType: z.string().min(3).max(160),
    sizeBytes: z.number().int().positive().max(REGULATORY_SOURCE_MAX_BYTES),
    ruleSetId: z.string().uuid().optional(),
});

function safeFileName(value: string): string {
    const leaf = value.split(/[\\/]/).pop() || 'object';
    const result = leaf.normalize('NFKC')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/[^\p{L}\p{N}._ -]+/gu, '_')
        .trim()
        .slice(0, 160);
    if (!result || result === '.' || result === '..') throw new Error('Invalid file name');
    return result;
}

function objectPath(
    purpose: ClientBlobPurpose,
    uploadId: string,
    fileName: string,
    userId: string,
    ruleSetId?: string,
): string {
    if (purpose === 'regulatory_source') {
        if (!ruleSetId) throw new Error('ruleSetId is required');
        // PostgreSQL UUID text and the regulatory locator constraint use the
        // canonical lowercase representation. Zod accepts uppercase UUID input,
        // so normalize it before binding the object namespace to the rule set.
        return `regulatory-sources/${ruleSetId.toLowerCase()}/${uploadId}-${fileName}`;
    }
    const prefix = purpose === 'surat_masuk' ? 'surat-masuk' : 'surat-keluar';
    return `${prefix}/${userId}/${uploadId}-${fileName}`;
}

router.post(
    '/',
    firebaseReplayProtectedAppCheckMiddleware,
    authMiddleware as any,
    uploadLimiter,
    canWriteMiddleware() as any,
    async (req: AuthRequest, res) => {
        const parsed = initiateSchema.safeParse(req.body);
        if (!parsed.success || !req.user) {
            res.status(400).json({ error: 'Invalid upload intent' });
            return;
        }
        const input = parsed.data;
        if (!ALLOWED_TYPES.has(input.contentType)) {
            res.status(415).json({ error: 'Content-Type is not allowed' });
            return;
        }
        if (input.purpose === 'regulatory_source') {
            if (req.user.role !== 'super_admin' || input.contentType !== 'application/pdf' || !input.ruleSetId) {
                res.status(403).json({ error: 'Regulatory source upload is not permitted' });
                return;
            }
            await regulatoryRuleSetService.assertSourceDocumentUploadAllowed(input.ruleSetId);
        } else if (input.sizeBytes > 10 * 1024 * 1024) {
            res.status(413).json({ error: 'Letter attachment exceeds 10 MiB' });
            return;
        }

        const config = buildCloudPlatformConfig();
        if (config.storageProvider !== 'gcs' || !config.gcsUploadBucket) {
            res.status(503).json({ error: 'Cloud Storage upload is not configured' });
            return;
        }
        const uploadId = randomUUID();
        const pathname = objectPath(
            input.purpose,
            uploadId,
            safeFileName(input.fileName),
            req.user.id,
            input.ruleSetId?.toLowerCase(),
        );
        const locator = toGcsLocator(config.gcsUploadBucket, pathname);

        try {
            const authorization = await clientBlobUploadService.authorizeGcsUpload({
                id: uploadId,
                blobUrl: locator,
                pathname,
                bucket: config.gcsUploadBucket,
                purpose: input.purpose,
                uploadedBy: req.user.id,
                expectedSizeBytes: input.sizeBytes,
                expectedContentType: input.contentType,
            });
            try {
                const adapter = GcsStorageAdapter.uploadFromEnvironment();
                const requestOrigin = typeof req.headers.origin === 'string'
                    && isTrustedOrigin(req.headers.origin)
                    ? req.headers.origin
                    : env.FRONTEND_URL;
                const session = await adapter.createResumableUploadSession({
                    objectName: pathname,
                    mimeType: input.contentType,
                    sizeBytes: input.sizeBytes,
                    origin: requestOrigin,
                    metadata: {
                        simsaUploadId: uploadId,
                        simsaUploadedBy: req.user.id,
                        simsaPurpose: input.purpose,
                        originalName: input.fileName,
                    },
                });
                res.status(201).json({
                    uploadId,
                    locator: session.locator,
                    resumableSessionUri: session.sessionUri,
                    expiresAt: authorization.expiresAt.toISOString(),
                    requiredHeaders: { 'Content-Type': input.contentType },
                });
            } catch (error) {
                await clientBlobUploadService.cancelGcsAuthorization(
                    uploadId,
                    'Failed to create resumable upload session',
                );
                throw error;
            }
        } catch (error) {
            log.error({ err: error, uploadId, purpose: input.purpose }, 'GCS upload initiation failed');
            res.status(503).json({ error: 'Could not initialize private upload' });
        }
    },
);

router.get('/:uploadId', authMiddleware as any, async (req: AuthRequest, res) => {
    if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    const uploadId = z.string().uuid().safeParse(req.params.uploadId);
    if (!uploadId.success) {
        res.status(400).json({ error: 'Invalid upload id' });
        return;
    }
    const upload = await clientBlobUploadService.getOwnedUpload(uploadId.data, req.user.id);
    if (!upload) {
        res.status(404).json({ error: 'Upload not found' });
        return;
    }
    res.json({
        uploadId: upload.id,
        locator: upload.blobUrl,
        status: upload.status,
        purpose: upload.purpose,
        expiresAt: upload.expiresAt,
        finalizedAt: upload.finalizedAt,
    });
});

export default router;
