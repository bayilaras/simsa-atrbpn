import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseError, ForbiddenError, ServiceUnavailableError, ValidationError } from '../utils/errors.js';
import { publicErrorResponse, publicErrorStatus } from '../utils/public-error.js';

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), updateUser: vi.fn(), limit: vi.fn() }));
vi.mock('../config/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock('better-auth/node', () => ({ toNodeHandler: () => (_req: any, res: any) => res.sendStatus(404) }));
vi.mock('../config/database', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: mocks.limit }) }) }) } }));
vi.mock('../services/user-management.service.js', () => ({ default: { updateUser: mocks.updateUser } }));
import router from '../routes/auth.routes';

const app = express();
app.use(express.json());
app.use('/auth', router);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(publicErrorStatus(error)).json(publicErrorResponse(error, 'legacy-auth-fault-test'));
});
const marker = 'Invalid sudah not found SYNTHETIC_IDENTITY_SECRET';

beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: 'actor', email: 'actor@example.test' } });
    mocks.limit.mockResolvedValue([{ role: 'super_admin' }]);
});

describe('legacy auth role error boundary', () => {
    it.each([new Error(marker), new DatabaseError(marker), new ServiceUnavailableError(marker)])('sanitizes provider and database failures ($name)', async error => {
        mocks.updateUser.mockRejectedValue(error);
        const response = await request(app).put('/auth/users/target/role').send({ role: 'admin_unit', unitKerjaId: 'unit-a' });
        expect(response.status).toBe(error instanceof ServiceUnavailableError ? 503 : 500);
        expect(response.body.requestId).toBe('legacy-auth-fault-test');
        expect(response.text).not.toContain(marker);
    });
    it.each([new ForbiddenError('Aktor bukan super admin aktif.'), new ValidationError('Invalid unitKerjaId')])('preserves explicit domain rejection ($name)', async error => {
        mocks.updateUser.mockRejectedValue(error);
        const response = await request(app).put('/auth/users/target/role').send({ role: 'admin_unit', unitKerjaId: 'unit-a' });
        expect(response.status).toBe(error.statusCode);
        expect(response.body.message).toBe(error.message);
    });
    it('still rejects missing sessions and non-admin roles before mutation', async () => {
        mocks.getSession.mockResolvedValueOnce(null);
        await request(app).put('/auth/users/target/role').send({ role: 'admin_unit', unitKerjaId: 'unit-a' }).expect(401);
        mocks.limit.mockResolvedValueOnce([{ role: 'staff' }]);
        await request(app).put('/auth/users/target/role').send({ role: 'admin_unit', unitKerjaId: 'unit-a' }).expect(403);
        expect(mocks.updateUser).not.toHaveBeenCalled();
    });
    it.each(['admin_unit', 'admin_dirjen', 'admin_sesditjen', 'staff', 'auditor'])('keeps the legacy global user directory restricted from %s', async role => {
        mocks.limit.mockResolvedValueOnce([{ role, unitKerjaId: 'unit-a', isActive: true }]);
        await request(app).get('/auth/users').expect(403);
        expect(mocks.updateUser).not.toHaveBeenCalled();
    });
    it.each(['admin_dirjen', 'admin_sesditjen', 'staff', 'auditor', 'user'])('does not allow new legacy role assignment through the compatibility endpoint: %s', async role => {
        await request(app).put('/auth/users/target/role').send({ role, unitKerjaId: 'unit-a' }).expect(400);
        expect(mocks.updateUser).not.toHaveBeenCalled();
    });
});
