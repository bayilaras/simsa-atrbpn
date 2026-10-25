import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../utils/errors.js';
import { publicErrorResponse, publicErrorStatus } from '../utils/public-error.js';

const mocks = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { id: 'synthetic-user', email: 'qa@example.test', role: 'admin_unit', unitKerjaId: 'unit-a' };
        next();
    },
}));
vi.mock('../middlewares/rate-limiter.middleware', () => ({
    sensitiveLimiter: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../services/dosir.service', () => ({ dosirService: { update: mocks.update } }));
vi.mock('../services/record-access.service', () => ({ allowedSecurityClassifications: () => ['biasa'] }));
vi.mock('../utils/logger', () => ({ createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) }));

import dosirRouter from '../routes/dosir.routes';

const app = express();
app.use(express.json());
app.use('/api/dosir', dosirRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(publicErrorStatus(error)).json(publicErrorResponse(error, 'synthetic-dosir-request'));
});

const dosirId = 'f3ab2f27-6759-4f0b-a995-bc874dad9828';
const invalidRangeMessage = 'Tanggal selesai tidak boleh sebelum tanggal mulai.';

beforeEach(() => { mocks.update.mockReset(); });

describe('dosir update request and error boundaries', () => {
    it('rejects an inverted pair in the request before calling the service', async () => {
        const response = await request(app).put(`/api/dosir/${dosirId}`).send({
            tanggalMulai: '2026-09-14', tanggalSelesai: '2026-09-13',
        });
        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({ success: false, details: [{ field: 'tanggalSelesai' }] });
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('returns 400 when the service rejects a partial edit against the stored date', async () => {
        mocks.update.mockRejectedValue(new ValidationError(invalidRangeMessage));
        const response = await request(app).put(`/api/dosir/${dosirId}`).send({ tanggalSelesai: '2026-09-13' });
        expect(mocks.update).toHaveBeenCalledWith(
            dosirId, { tanggalSelesai: '2026-09-13' }, 'unit-a', expect.objectContaining({ userId: 'synthetic-user' }),
        );
        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({
            success: false, message: invalidRangeMessage, code: 'VALIDATION_ERROR', requestId: 'synthetic-dosir-request',
        });
    });

    it('keeps unexpected failures at 500 without exposing internal details', async () => {
        const privateMarker = 'SYNTHETIC_PRIVATE_QUERY_AND_SIGNED_URL';
        mocks.update.mockRejectedValue(new Error(privateMarker));
        const response = await request(app).put(`/api/dosir/${dosirId}`).send({ judul: 'Revisi sintetis' });
        expect(mocks.update).toHaveBeenCalledOnce();
        expect(response.status).toBe(500);
        expect(response.body.success).toBe(false);
        expect(response.text).not.toContain(privateMarker);
        expect(response.body).not.toHaveProperty('stack');
    });

    it('keeps an inaccessible record at 404 and ignores a caller-supplied foreign unit', async () => {
        mocks.update.mockResolvedValue(undefined);
        const response = await request(app).put(`/api/dosir/${dosirId}?unitKerjaId=unit-b`).send({ judul: 'Revisi sintetis' });
        expect(mocks.update).toHaveBeenCalledWith(
            dosirId, { judul: 'Revisi sintetis' }, 'unit-a', expect.objectContaining({ userId: 'synthetic-user' }),
        );
        expect(response.status).toBe(404);
        expect(response.body).toEqual({ success: false, error: 'Dosir not found' });
    });
});
