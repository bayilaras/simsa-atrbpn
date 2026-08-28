import { NextFunction, Router, Response } from 'express';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware.js';
import { uploadLimiter } from '../middlewares/rate-limiter.middleware.js';
import { createLogger } from '../utils/logger.js';
import { canWriteMiddleware, roleMiddleware } from '../middlewares/role.middleware.js';
import regulatoryRuleSetService, {
    REGULATORY_SOURCE_MAX_BYTES,
} from '../services/regulatory-rule-set.service.js';
import {
    clientBlobUploadService,
    type ClientBlobPurpose,
} from '../services/client-blob-upload.service.js';

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

function completedTokenPayload(value: string | null | undefined): {
    purpose: ClientBlobPurpose;
    userId: string;
    ruleSetId?: string;
} {
    try {
        const parsed = JSON.parse(value || 'null');
        if (
            parsed
            && typeof parsed === 'object'
            && ['surat_masuk', 'surat_keluar', 'regulatory_source'].includes(parsed.purpose)
            && typeof parsed.userId === 'string'
        ) {
            return {
                purpose: parsed.purpose,
                userId: parsed.userId,
                ruleSetId: typeof parsed.ruleSetId === 'string' ? parsed.ruleSetId : undefined,
            };
        }
    } catch {
        // The signed callback is still rejected when its application payload
        // is malformed; never create an unowned cleanup lease.
    }
    throw new Error('Upload completion payload is invalid');
}

const writeGuard = canWriteMiddleware();

function authorizeTokenGeneration(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
) {
    if ((req.body as HandleUploadBody)?.type === 'blob.upload-completed') {
        // handleUpload verifies the Blob callback signature. Vercel cannot
        // carry an end-user session cookie when it posts this completion.
        return next();
    }
    void authMiddleware(req, res, (error?: unknown) => {
        if (error) return next(error);
        return writeGuard(req, res, next);
    });
}

function limitTokenGeneration(req: AuthRequest, res: Response, next: NextFunction) {
    if ((req.body as HandleUploadBody)?.type === 'blob.upload-completed') return next();
    return uploadLimiter(req, res, next);
}

// A scheduler can call this authenticated endpoint. Deletion is limited to
// expired callback-proven leases atomically reserved by the reconciler.
router.post(
    '/reconcile',
    authMiddleware as any,
    roleMiddleware(['super_admin']),
    async (req: AuthRequest, res: Response) => {
        const requestedLimit = Number(req.body?.limit || 50);
        const result = await clientBlobUploadService.cleanupExpired(requestedLimit);
        res.json({ success: true, data: result });
    },
);

/**
 * POST /api/client-upload
 * Handles Vercel Blob client-side upload token generation.
 * The @vercel/blob/client `upload()` function on the frontend calls this endpoint
 * to get a secure token, then uploads the file directly to Blob storage,
 * bypassing the 4.5MB serverless function body limit.
 */
router.post('/', authorizeTokenGeneration, limitTokenGeneration, async (req: AuthRequest, res: Response) => {
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
                            purpose: 'regulatory_source',
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
                        purpose: pathname.startsWith('surat-masuk/')
                            ? 'surat_masuk'
                            : 'surat_keluar',
                        userId: req.user?.id,
                        userEmail: req.user?.email,
                    }),
                };
            },
            onUploadCompleted: async ({ blob, tokenPayload }) => {
                const payload = completedTokenPayload(tokenPayload);
                if (payload.purpose === 'regulatory_source') {
                    const match = blob.pathname.match(REGULATORY_SOURCE_PATH);
                    if (!match || payload.ruleSetId?.toLowerCase() !== match[1].toLowerCase()) {
                        throw new Error('Regulatory upload completion is not bound to its rule set');
                    }
                }
                await clientBlobUploadService.recordCompletedUpload({
                    blobUrl: blob.url,
                    pathname: blob.pathname,
                    purpose: payload.purpose,
                    uploadedBy: payload.userId,
                });
            },
        });

        res.json(jsonResponse);
    } catch (error: any) {
        log.error({ err: error }, 'Client upload handler error');
        res.status(400).json({
            error: 'Upload request rejected',
            code: 'CLIENT_UPLOAD_REJECTED',
        });
    }
});

export default router;
