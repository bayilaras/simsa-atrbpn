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
