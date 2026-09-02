import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import suratMasukRouter from '../surat-masuk.routes';
import { suratMasukService } from '../../services/surat-masuk.service';

// Mock Middlewares
vi.mock('../../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, res: any, next: any) => {
        req.user = { id: 'user-1', email: 'test@example.com', role: 'admin_dirjen', unitKerjaId: 'ditjen' };
        next();
    },
}));

vi.mock('../../middlewares/role.middleware', () => ({
    canWriteMiddleware: () => (req: any, res: any, next: any) => next(),
}));

vi.mock('../../middlewares/validate.middleware', () => ({
    validateBody: () => (req: any, res: any, next: any) => next(),
    validateQuery: () => (req: any, res: any, next: any) => {
        // Mock validation by just passing query as validated
        res.locals.validatedQuery = req.query;
        next();
    },
    validateIdParam: () => (req: any, res: any, next: any) => next(),
}));

// Mock Service
vi.mock('../../services/surat-masuk.service', () => ({
    suratMasukService: {
        findAll: vi.fn(),
        findById: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock('../../services/record-access.service', () => ({
    allowedSecurityClassifications: vi.fn(() => ['biasa', 'terbatas']),
    isAllowedForClassification: vi.fn(() => true),
    recordAccessService: {
        check: vi.fn(async () => ({
            exists: true,
            allowed: true,
            mutable: true,
            unitKerjaId: 'ditjen',
            classification: 'biasa',
            grantId: null,
            accessPurpose: null,
            grantAccessMode: null,
            grantExpiresAt: null,
        })),
    },
}));

// Mock Audit Log
vi.mock('../../services/audit-log.service', () => ({
    default: {
        logAction: vi.fn(),
    },
}));

// Setup Express App
const app = express();
app.use(express.json());
app.use('/api/surat-masuk', suratMasukRouter);

describe('SuratMasukRoutes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('GET /api/surat-masuk', () => {
        it('should return list of surat masuk', async () => {
            const mockData = {
                data: [{ id: '1', perihal: 'Test' }],
                pagination: { total: 1 },
            };
            (suratMasukService.findAll as any).mockResolvedValue(mockData);

            const res = await request(app).get('/api/surat-masuk');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveLength(1);
            expect(suratMasukService.findAll).toHaveBeenCalledWith(expect.objectContaining({
                unitKerjaId: 'ditjen', // Default value
            }));
        });
    });

    describe('GET /api/surat-masuk/:id', () => {
        it('should return surat detail', async () => {
            const mockSurat = { id: '123', perihal: 'Detail', sifatSurat: 'biasa' };
            (suratMasukService.findById as any).mockResolvedValue(mockSurat);

            const res = await request(app).get('/api/surat-masuk/123');

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual({
                ...mockSurat,
                hasFile: false,
                filePath: null,
            });
        });

        it('should return 404 if not found', async () => {
            (suratMasukService.findById as any).mockResolvedValue(null);

            const res = await request(app).get('/api/surat-masuk/999');

            expect(res.status).toBe(404);
        });
    });
});
