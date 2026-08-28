import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const securityState = vi.hoisted(() => ({
    authCalls: 0,
    blockedStatus: null as number | null,
    user: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'admin@example.go.id',
        name: 'Admin',
        role: 'super_admin',
        unitKerjaId: null as string | null,
    },
}));

vi.mock('../../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, res: any, next: any) => {
        securityState.authCalls += 1;
        if (securityState.blockedStatus) {
            return res.status(securityState.blockedStatus).json({ error: 'Blocked by centralized auth' });
        }
        req.user = { ...securityState.user };
        next();
    },
}));

vi.mock('../../middlewares/rate-limiter.middleware', () => ({
    sensitiveLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../services/user-management.service', () => ({
    default: {
        listUsers: vi.fn().mockResolvedValue({ data: [], pagination: { total: 0 } }),
        createUser: vi.fn().mockResolvedValue({ id: '22222222-2222-4222-8222-222222222222' }),
        updateUser: vi.fn().mockResolvedValue({ id: '22222222-2222-4222-8222-222222222222' }),
        deactivateUser: vi.fn().mockResolvedValue({
            id: '22222222-2222-4222-8222-222222222222',
            isActive: false,
        }),
    },
}));

vi.mock('../../services/audit-log.service', () => ({
    default: {
        listLogs: vi.fn().mockResolvedValue({ data: [], pagination: { total: 0 } }),
        getEntityHistory: vi.fn().mockResolvedValue([]),
        logAction: vi.fn(),
    },
}));

import userManagementRouter from '../user-management.routes';
import auditLogRouter from '../audit-log.routes';
import userManagementService from '../../services/user-management.service';
import auditLogService from '../../services/audit-log.service';
import { ConflictError, ForbiddenError } from '../../utils/errors.js';

const app = express();
app.use(express.json());
app.use('/api/users', userManagementRouter);
app.use('/api/audit-log', auditLogRouter);

describe('centralized authentication on privileged routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        securityState.authCalls = 0;
        securityState.blockedStatus = null;
        securityState.user = {
            id: '11111111-1111-4111-8111-111111111111',
            email: 'admin@example.go.id',
            name: 'Admin',
            role: 'super_admin',
            unitKerjaId: null,
        };
    });

    it('does not let user management bypass a central account-state rejection', async () => {
        securityState.blockedStatus = 403;

        const response = await request(app).get('/api/users');

        expect(response.status).toBe(403);
        expect(securityState.authCalls).toBe(1);
        expect(userManagementService.listUsers).not.toHaveBeenCalled();
    });

    it('requires super_admin after centralized authentication', async () => {
        securityState.user.role = 'admin_dirjen';

        const response = await request(app).get('/api/users');

        expect(response.status).toBe(403);
        expect(userManagementService.listUsers).not.toHaveBeenCalled();
    });

    it('allows an active super_admin to use user management', async () => {
        const response = await request(app).get('/api/users');

        expect(response.status).toBe(200);
        expect(userManagementService.listUsers).toHaveBeenCalledOnce();
    });

    it('rejects self-deactivation through the generic update endpoint', async () => {
        const response = await request(app)
            .put(`/api/users/${securityState.user.id}`)
            .send({ role: 'super_admin', isActive: false });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/tidak dapat menonaktifkan akun sendiri/);
        expect(userManagementService.updateUser).not.toHaveBeenCalled();
    });

    it('rejects self-demotion but permits an unchanged self role', async () => {
        const demotion = await request(app)
            .put(`/api/users/${securityState.user.id}`)
            .send({ role: 'staff' });

        expect(demotion.status).toBe(400);
        expect(userManagementService.updateUser).not.toHaveBeenCalled();

        const profileOnly = await request(app)
            .put(`/api/users/${securityState.user.id}`)
            .send({ role: 'super_admin', jabatan: 'Administrator Sistem' });

        expect(profileOnly.status).toBe(200);
        expect(userManagementService.updateUser).toHaveBeenCalledOnce();
    });

    it('returns a conflict when a mandate change would orphan a pending approval', async () => {
        vi.mocked(userManagementService.updateUser).mockRejectedValueOnce(
            new ConflictError('Pengguna masih menjadi penyetuju aktif untuk surat pending.'),
        );

        const response = await request(app)
            .put('/api/users/22222222-2222-4222-8222-222222222222')
            .send({ role: 'staff' });

        expect(response.status).toBe(409);
        expect(response.body.error).toMatch(/masih menjadi penyetuju aktif/);
    });

    it('maps a transaction-time stale administrator rejection on create', async () => {
        vi.mocked(userManagementService.createUser).mockRejectedValueOnce(
            new ForbiddenError('Aktor bukan super admin aktif. Muat ulang sesi Anda.'),
        );

        const response = await request(app)
            .post('/api/users')
            .send({
                email: 'new-admin@example.go.id',
                name: 'New Admin',
                role: 'super_admin',
                unitKerjaId: null,
            });

        expect(response.status).toBe(403);
        expect(response.body.error).toMatch(/bukan super admin aktif/);
    });

    it('rejects self-deactivation through the dedicated delete endpoint', async () => {
        const response = await request(app)
            .delete(`/api/users/${securityState.user.id}`);

        expect(response.status).toBe(400);
        expect(userManagementService.deactivateUser).not.toHaveBeenCalled();
    });

    it('returns a conflict when deactivation would remove the last active super admin', async () => {
        vi.mocked(userManagementService.deactivateUser).mockRejectedValueOnce(
            new ConflictError('Minimal satu super admin aktif harus tetap tersedia.'),
        );

        const response = await request(app)
            .delete('/api/users/22222222-2222-4222-8222-222222222222');

        expect(response.status).toBe(409);
        expect(response.body.error).toMatch(/Minimal satu super admin aktif/);
    });

    it('does not let audit-log routes bypass a central account-state rejection', async () => {
        securityState.blockedStatus = 403;

        const response = await request(app).get('/api/audit-log');

        expect(response.status).toBe(403);
        expect(securityState.authCalls).toBe(1);
        expect(auditLogService.listLogs).not.toHaveBeenCalled();
    });

    it('applies the audit_log read permission after authentication', async () => {
        securityState.user.role = 'staff';
        securityState.user.unitKerjaId = 'ditjen';

        const response = await request(app).get('/api/audit-log');

        expect(response.status).toBe(403);
        expect(auditLogService.listLogs).not.toHaveBeenCalled();
    });
});
