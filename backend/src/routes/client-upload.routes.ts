import { Router, Request, Response } from 'express';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware.js';
import { uploadLimiter } from '../middlewares/rate-limiter.middleware.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ClientUploadRoutes');

const router = Router();

// Rate-limit upload token generation
router.use(uploadLimiter);

// All routes require authentication
router.use(authMiddleware as any);

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
            onBeforeGenerateToken: async (pathname: string) => {
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
                        'application/zip',
                        'application/x-rar-compressed',
                    ],
                    maximumSizeInBytes: 10 * 1024 * 1024, // 10MB
                    tokenPayload: JSON.stringify({
                        userId: req.user?.id,
                        userEmail: req.user?.email,
                    }),
                };
            },
            onUploadCompleted: async ({ blob, tokenPayload }) => {
                // This callback fires when the upload is done (on production only)
                log.info(
                    { blobUrl: blob.url, pathname: blob.pathname, tokenPayload },
                    'Client upload completed'
                );
            },
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
