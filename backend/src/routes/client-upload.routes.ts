import { Router, Request, Response } from 'express';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware.js';
import { uploadLimiter } from '../middlewares/rate-limiter.middleware.js';
import { createLogger } from '../utils/logger.js';
import { canWriteMiddleware } from '../middlewares/role.middleware.js';
import regulatoryRuleSetService, {
    REGULATORY_SOURCE_MAX_BYTES,
} from '../services/regulatory-rule-set.service.js';

const log = createLogger('ClientUploadRoutes');

const router = Router();
const REGULATORY_SOURCE_PATH = /^regulatory-sources\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([^/\\]+\.pdf)$/i;

function regulatoryClientPayload(value: string | null): { ruleSetId: string } | null {
    if (!value) return null;
    try {
        const parsed = JSON.parse(value);
        if (
            parsed
            && typeof parsed === 'object'
            && parsed.purpose === 'regulatory-source'
            && typeof parsed.ruleSetId === 'string'
        ) {
            return { ruleSetId: parsed.ruleSetId };
        }
    } catch {
        // A malformed payload is rejected below without reflecting its value.
    }
    return null;
}

// Rate-limit upload token generation
router.use(uploadLimiter);

// All routes require authentication
router.use(authMiddleware as any);
router.use(canWriteMiddleware());

/**
 * POST /api/client-upload
 * Handles Vercel Blob client-side upload token generation.
 * The @vercel/blob/client `upload()` function on the frontend calls this endpoint
 * to get a secure token, then uploads the file directly to Blob storage,
 * bypassing the 4.5MB serverless function body limit.
 */
router.post('/', async (req: AuthRequest, res: Response) => {
    try {
        const body = req.body as HandleUploadBody;
        if (
            body?.type === 'blob.generate-client-token'
            && body.payload.pathname.startsWith('regulatory-sources/')
            && req.user?.role !== 'super_admin'
        ) {
            return res.status(403).json({ error: 'Regulatory source upload requires super_admin.' });
        }

        // Reconstruct a Web API Request object for handleUpload
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
        const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
        const url = `${protocol}://${host}${req.originalUrl}`;

        const webRequest = new globalThis.Request(url, {
            method: 'POST',
            headers: Object.fromEntries(
                Object.entries(req.headers)
                    .filter(([, v]) => typeof v === 'string')
                    .map(([k, v]) => [k, v as string])
            ),
            body: JSON.stringify(body),
        });

        const jsonResponse = await handleUpload({
            body,
            request: webRequest,
            onBeforeGenerateToken: async (pathname: string, clientPayload: string | null) => {
                const regulatoryMatch = pathname.match(REGULATORY_SOURCE_PATH);
                if (regulatoryMatch) {
                    const [, ruleSetId, fileName] = regulatoryMatch;
                    const payload = regulatoryClientPayload(clientPayload);
                    if (
                        req.user?.role !== 'super_admin'
                        || !payload
                        || ruleSetId !== ruleSetId.toLowerCase()
                        || payload.ruleSetId.toLowerCase() !== ruleSetId.toLowerCase()
                        || pathname.includes('..')
                        || fileName.length > 240
                        || /[\u0000-\u001f\u007f]/.test(fileName)
                    ) {
                        throw new Error('Regulatory source upload is not permitted');
                    }
                    await regulatoryRuleSetService.assertSourceDocumentUploadAllowed(ruleSetId);
                    log.info(
                        { userId: req.user.id, ruleSetId, pathname },
                        'Generating rule-set-bound regulatory source upload token',
                    );
                    return {
                        allowedContentTypes: ['application/pdf'],
                        maximumSizeInBytes: REGULATORY_SOURCE_MAX_BYTES,
                        addRandomSuffix: true,
                        allowOverwrite: false,
                        validUntil: Date.now() + 10 * 60 * 1000,
                        tokenPayload: JSON.stringify({
                            purpose: 'regulatory-source',
                            ruleSetId,
                            userId: req.user.id,
                            userEmail: req.user.email,
                        }),
                    };
                }

                const allowedPrefixes = ['surat-masuk/', 'surat-keluar/'];
                if (
                    !allowedPrefixes.some(prefix => pathname.startsWith(prefix)) ||
                    pathname.includes('..') ||
                    pathname.includes('\\')
                ) {
                    throw new Error('Upload pathname is not permitted');
                }
                // User is already authenticated via authMiddleware
                log.info(
                    { userId: req.user?.id, pathname },
                    'Generating client upload token'
                );

                return {
                    allowedContentTypes: [
                        'application/pdf',
                        'application/msword',
                        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        'application/vnd.ms-excel',
                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        'image/jpeg',
                        'image/png',
                        'image/gif',
                        'image/webp',
                    ],
                    maximumSizeInBytes: 10 * 1024 * 1024, // 10MB
                    addRandomSuffix: true,
                    validUntil: Date.now() + 10 * 60 * 1000,
                    tokenPayload: JSON.stringify({
                        userId: req.user?.id,
                        userEmail: req.user?.email,
                    }),
                };
            },
            // Completion is finalized by the authenticated business endpoint
            // (for regulatory PDFs: /verify-blob). No unauthenticated webhook
            // mutates database state or turns an upload into accepted evidence.
        });

        res.json(jsonResponse);
    } catch (error: any) {
        log.error({ err: error }, 'Client upload handler error');
        res.status(400).json({
            error: error.message || 'Upload failed',
        });
    }
});

export default router;
