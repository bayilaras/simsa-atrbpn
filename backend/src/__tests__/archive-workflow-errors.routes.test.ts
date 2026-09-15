import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, ConflictError, ForbiddenError, ValidationError } from '../utils/errors.js';
import { publicErrorResponse, publicErrorStatus } from '../utils/public-error.js';

const mocks = vi.hoisted(() => ({ lending: vi.fn(), list: vi.fn(), storage: vi.fn(), disposition: vi.fn(), print: vi.fn() }));
vi.mock('../middlewares/auth.middleware', () => ({ authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'synthetic-user', role: 'staff', unitKerjaId: 'synthetic-unit' }; next();
} }));
vi.mock('../middlewares/role.middleware', () => ({ canWriteMiddleware: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../middlewares/validate.middleware', async importOriginal => ({ ...await importOriginal<typeof import('../middlewares/validate.middleware')>(), validateBody: () => (_req: any, _res: any, next: any) => next(), uuidParamValidator: (_req: any, _res: any, next: any) => next() }));
vi.mock('../middlewares/rate-limiter.middleware', () => ({ sensitiveLimiter: (_req: any, _res: any, next: any) => next(), uploadLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/archive-lending.service', () => ({ archiveLendingService: { findAll: mocks.list, borrow: mocks.lending, return: mocks.lending, extend: mocks.lending } }));
vi.mock('../services/storage-location.service', () => ({ storageLocationService: { create: mocks.storage, update: mocks.storage, delete: mocks.storage, generateArsipQRCode: mocks.storage } }));
vi.mock('../services/penyusutan.service', () => ({ penyusutanService: { updateStatus: mocks.disposition, addItems: mocks.disposition, removeItems: mocks.disposition, deleteBatch: mocks.disposition } }));
vi.mock('../services/print-template.service', () => ({ printTemplateService: { generateDaftarUsulMusnah: mocks.print } }));
vi.mock('../services/record-access.service', () => ({ isAllowedForClassification: () => true, allowedSecurityClassifications: () => ['biasa'] }));

import lendingRouter from '../routes/archive-lending.routes';
import storageRouter from '../routes/storage-location.routes';
import dispositionRouter from '../routes/penyusutan.routes';

const app = express();
app.use(express.json());
app.use('/lending', lendingRouter);
app.use('/storage', storageRouter);
app.use('/disposition', dispositionRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(publicErrorStatus(error)).json(publicErrorResponse(error, 'synthetic-request-id'));
});
const cases = [
    ['post', '/lending/borrow', { lendingType: 'arsip', arsipId: 'archive', borrowerName: 'Synthetic', dueDate: '2026-12-01' }, mocks.lending],
    ['put', '/lending/record/return', {}, mocks.lending],
    ['put', '/lending/record/extend', { newDueDate: '2026-12-01' }, mocks.lending],
    ['post', '/storage', { name: 'Synthetic', code: 'SYNTH', level: 'gedung' }, mocks.storage],
    ['put', '/storage/location', {}, mocks.storage],
    ['delete', '/storage/location', {}, mocks.storage],
    ['put', '/disposition/batch/status', {}, mocks.disposition],
    ['post', '/disposition/batch/items', { arsipIds: ['archive'] }, mocks.disposition],
    ['delete', '/disposition/batch/items', { arsipIds: ['archive'] }, mocks.disposition],
    ['delete', '/disposition/batch', {}, mocks.disposition],
    ['get', '/disposition/batch/print/usul-musnah', {}, mocks.print],
] as const;

beforeEach(() => { vi.resetAllMocks(); });
describe('lending search request contract', () => {
    it('forwards validated search and pagination with the authoritative unit', async () => {
        mocks.list.mockResolvedValue({data:[],pagination:{page:2,limit:5,total:0,totalPages:0}});
        const response = await request(app).get('/lending').query({search:' QA-001 ',page:2,limit:5,unitKerjaId:'another-unit'});
        expect(response.status).toBe(200);
        expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({search:'QA-001',page:2,limit:5,unitKerjaId:'synthetic-unit'}));
    });
    it.each([{page:0},{limit:10001},{status:'invalid'},{search:'x'.repeat(256)}])('rejects invalid query %j before querying', async query => {
        expect((await request(app).get('/lending').query(query)).status).toBe(400);
        expect(mocks.list).not.toHaveBeenCalled();
    });
});
describe('archive workflow error boundaries', () => {
    it.each(cases)('sanitizes unknown failure on %s %s even when its message contains old domain keywords', async (method, path, body, action) => {
        const marker = 'SYNTHETIC_PRIVATE_QUERY';
        action.mockRejectedValue(new Error(`${marker}: not found required already borrowed changed Cannot delete Unauthorized Cannot advance draft Batch not found`));
        const response = await request(app)[method](path).send(body);
        expect(action).toHaveBeenCalled();
        expect(response.status).toBe(500);
        expect(response.body).toMatchObject({ code: 'INTERNAL_ERROR', requestId: 'synthetic-request-id' });
        expect(response.text).not.toContain(marker);
    });

    it.each([
        new AppError('Batch not found', 404), new ValidationError('Can only add items to draft batches'),
        new ConflictError('Batch changed concurrently'), new ForbiddenError('Reviewer must differ from creator'),
    ])('retains explicit domain status $statusCode', async error => {
        mocks.disposition.mockRejectedValue(error);
        const response = await request(app).put('/disposition/batch/status').send({});
        expect(response.status).toBe(error.statusCode);
        expect(response.body.message).toBe(error.message);
    });
});
