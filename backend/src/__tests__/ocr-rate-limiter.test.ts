import express, { type NextFunction, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { AuthRequest } from '../middlewares/auth.middleware';
import {
    OCR_RATE_LIMIT_MAX,
    ocrLimiter,
} from '../middlewares/rate-limiter.middleware';

function createApp() {
    const app = express();
    app.post('/ocr', (req: AuthRequest, _res: Response, next: NextFunction) => {
        req.user = {
            id: req.header('x-test-user') || 'anonymous-test-user',
            email: 'test@example.go.id',
            name: 'Test User',
            role: 'staff',
            unitKerjaId: 'ditjen',
        };
        next();
    }, ocrLimiter, (_req, res) => res.json({ success: true }));
    return app;
}

describe('ocrLimiter', () => {
    it('returns Retry-After at the limit and isolates quota per authenticated user', async () => {
        const app = createApp();
        const firstUser = `ocr-user-a-${Date.now()}`;
        const secondUser = `ocr-user-b-${Date.now()}`;

        for (let attempt = 0; attempt < OCR_RATE_LIMIT_MAX; attempt += 1) {
            await request(app).post('/ocr').set('x-test-user', firstUser).expect(200);
        }

        const limited = await request(app)
            .post('/ocr')
            .set('x-test-user', firstUser)
            .expect(429);
        expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

        await request(app).post('/ocr').set('x-test-user', secondUser).expect(200);
    });
});
