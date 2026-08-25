import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ids = {
    surat: '11111111-1111-4111-8111-111111111111',
    approver: '22222222-2222-4222-8222-222222222222',
};

const mocks = vi.hoisted(() => ({
    user: {
        id: '33333333-3333-4333-8333-333333333333',
        email: 'user@example.test',
        name: 'Test User',
        role: 'staff',
        unitKerjaId: 'unit-a' as string | null,
    },
    approval: {
        submit: vi.fn(),
        approve: vi.fn(),
        reject: vi.fn(),
        getHistory: vi.fn(),
    },
    signature: {
        sign: vi.fn(),
    },
}));

vi.mock('../middlewares/auth.middleware.js', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { ...mocks.user };
        next();
    },
}));

vi.mock('../middlewares/role.middleware.js', () => ({
    canWriteMiddleware: () => (req: any, res: any, next: any) => {
        if (['staff', 'auditor', 'user'].includes(req.user?.role)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        next();
    },
}));

vi.mock('../services/approval.service.js', () => ({
    approvalService: mocks.approval,
}));
vi.mock('../services/signature.service.js', () => ({
    signatureService: mocks.signature,
}));

const { default: approvalRouter } = await import('../routes/approval.routes.js');

const app = express();
app.use(express.json());
app.use('/approval', approvalRouter);
app.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error.statusCode || 500).json({ error: error.message });
});

describe('approval route security', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.assign(mocks.user, {
            role: 'staff',
            unitKerjaId: 'unit-a',
        });
        mocks.approval.submit.mockResolvedValue({ id: 'request-1' });
        mocks.approval.approve.mockResolvedValue({ success: true });
        mocks.approval.reject.mockResolvedValue({ success: true });
        mocks.approval.getHistory.mockResolvedValue([]);
        mocks.signature.sign.mockResolvedValue({});
    });

    it.each(['staff', 'auditor'])('applies canWrite to every endpoint for read-only %s', async (role) => {
        Object.assign(mocks.user, { role, unitKerjaId: 'unit-a' });

        await request(app).get('/approval/pending').expect(403);
        await request(app).get(`/approval/history/${ids.surat}`).expect(403);
        await request(app).post('/approval/submit').send({
            suratId: ids.surat,
            nextApproverId: ids.approver,
        }).expect(403);
        await request(app).post('/approval/approve').send({ suratId: ids.surat }).expect(403);
        await request(app).post('/approval/reject').send({
            suratId: ids.surat,
            notes: 'Tidak sesuai',
        }).expect(403);
        await request(app).post('/approval/sign').send({
            suratId: ids.surat,
            passphrase: 'secret',
        }).expect(403);

        expect(mocks.approval.submit).not.toHaveBeenCalled();
        expect(mocks.approval.approve).not.toHaveBeenCalled();
        expect(mocks.approval.reject).not.toHaveBeenCalled();
        expect(mocks.approval.getHistory).not.toHaveBeenCalled();
        expect(mocks.signature.sign).not.toHaveBeenCalled();
    });

    it('passes the immutable role-derived admin unit and complete actor to submit', async () => {
        Object.assign(mocks.user, { role: 'admin_dirjen', unitKerjaId: 'forged-unit' });

        await request(app).post('/approval/submit').send({
            suratId: ids.surat,
            nextApproverId: ids.approver,
            notes: 'Mohon tinjau',
        }).expect(200);

        expect(mocks.approval.submit).toHaveBeenCalledWith(
            ids.surat,
            expect.objectContaining({
                id: mocks.user.id,
                role: 'admin_dirjen',
                unitKerjaId: 'forged-unit',
            }),
            ids.approver,
            'ditjen',
            'Mohon tinjau',
        );
    });

    it('passes the role-derived admin unit to history and signing services', async () => {
        Object.assign(mocks.user, { role: 'admin_sesditjen', unitKerjaId: 'forged-unit' });

        await request(app).get(`/approval/history/${ids.surat}`).expect(200);
        await request(app).post('/approval/sign').send({
            suratId: ids.surat,
            passphrase: 'secret',
        }).expect(200);

        expect(mocks.approval.getHistory).toHaveBeenCalledWith(ids.surat, 'sesditjen');
        expect(mocks.signature.sign).toHaveBeenCalledWith(
            ids.surat,
            expect.objectContaining({ role: 'admin_sesditjen', unitKerjaId: 'forged-unit' }),
            'sesditjen',
            'secret',
        );
    });

    it('uses explicit all-unit read scope only for super_admin history', async () => {
        Object.assign(mocks.user, { role: 'super_admin', unitKerjaId: null });

        await request(app).get(`/approval/history/${ids.surat}`).expect(200);

        expect(mocks.approval.getHistory).toHaveBeenCalledWith(ids.surat, null);
    });

    it('rejects malformed history IDs before invoking the service', async () => {
        Object.assign(mocks.user, { role: 'admin_dirjen', unitKerjaId: 'ditjen' });
        await request(app).get('/approval/history/not-a-uuid').expect(400);
        expect(mocks.approval.getHistory).not.toHaveBeenCalled();
    });
});
