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
        getPending: vi.fn(),
        listEligibleApprovers: vi.fn(),
        getSubmissionContext: vi.fn(),
        submitMany: vi.fn(),
        approveMany: vi.fn(),
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
    BATAS_PERSETUJUAN_MASSAL: 100,
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
        mocks.approval.getPending.mockResolvedValue([]);
        mocks.approval.listEligibleApprovers.mockResolvedValue([]);
        mocks.approval.getSubmissionContext.mockResolvedValue({ approvers: [], atasNamaPembuat: null });
        mocks.approval.submitMany.mockResolvedValue([]);
        mocks.approval.approveMany.mockResolvedValue([]);
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

        await request(app).post('/approval/submit-bulk').send({
            suratIds: [ids.surat],
            nextApproverId: ids.approver,
        }).expect(403);
        await request(app).post('/approval/approve-bulk').send({ suratIds: [ids.surat] }).expect(403);

        expect(mocks.approval.submit).not.toHaveBeenCalled();
        expect(mocks.approval.approve).not.toHaveBeenCalled();
        expect(mocks.approval.reject).not.toHaveBeenCalled();
        expect(mocks.approval.getHistory).not.toHaveBeenCalled();
        expect(mocks.approval.submitMany).not.toHaveBeenCalled();
        expect(mocks.approval.approveMany).not.toHaveBeenCalled();
    });

    it('bulk endpoints accept 1 to 100 letters and report a per-letter result', async () => {
        Object.assign(mocks.user, { role: 'admin_dirjen', unitKerjaId: 'forged-unit' });
        const idKe = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
        const seratusSatu = Array.from({ length: 101 }, (_, n) => idKe(n));

        await request(app).post('/approval/submit-bulk').send({ suratIds: [], nextApproverId: ids.approver }).expect(400);
        await request(app).post('/approval/submit-bulk').send({ suratIds: seratusSatu, nextApproverId: ids.approver }).expect(400);
        await request(app).post('/approval/approve-bulk').send({ suratIds: seratusSatu }).expect(400);
        await request(app).post('/approval/approve-bulk').send({ suratIds: ['bukan-uuid'] }).expect(400);
        expect(mocks.approval.submitMany).not.toHaveBeenCalled();
        expect(mocks.approval.approveMany).not.toHaveBeenCalled();

        mocks.approval.submitMany.mockResolvedValue([
            { suratId: idKe(1), berhasil: true },
            { suratId: idKe(2), berhasil: false, pesan: 'Hanya pembuat surat yang dapat mengajukan persetujuan.' },
        ]);
        const submit = await request(app).post('/approval/submit-bulk').send({
            suratIds: [idKe(1), idKe(2)],
            nextApproverId: ids.approver,
        }).expect(200);
        expect(submit.body.data).toMatchObject({ berhasil: 1, gagal: 1 });
        expect(submit.body.data.hasil).toHaveLength(2);
        expect(mocks.approval.submitMany).toHaveBeenCalledWith(
            [idKe(1), idKe(2)],
            expect.objectContaining({ id: mocks.user.id, role: 'admin_dirjen' }),
            ids.approver,
            'ditjen',
            undefined,
        );

        mocks.approval.approveMany.mockResolvedValue([{ suratId: idKe(1), berhasil: true }]);
        const approve = await request(app).post('/approval/approve-bulk').send({
            suratIds: [idKe(1)],
            notes: 'Setuju',
        }).expect(200);
        expect(approve.body.data).toMatchObject({ berhasil: 1, gagal: 0 });
        expect(mocks.approval.approveMany).toHaveBeenCalledWith(
            [idKe(1)],
            expect.objectContaining({ id: mocks.user.id }),
            'ditjen',
            'Setuju',
        );
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

    it('passes the role-derived admin unit to history', async () => {
        Object.assign(mocks.user, { role: 'admin_sesditjen', unitKerjaId: 'forged-unit' });

        await request(app).get(`/approval/history/${ids.surat}`).expect(200);

        expect(mocks.approval.getHistory).toHaveBeenCalledWith(ids.surat, 'sesditjen');
    });

    it('does not expose a signing endpoint', async () => {
        Object.assign(mocks.user, { role: 'admin_sesditjen', unitKerjaId: null });

        await request(app).post('/approval/sign').send({
            suratId: ids.surat,
            passphrase: 'secret',
        }).expect(404);
    });

    it('loads only the authenticated approver queue', async () => {
        Object.assign(mocks.user, { role: 'admin_dirjen', unitKerjaId: 'forged-unit' });

        await request(app).get('/approval/pending').expect(200);

        expect(mocks.approval.getPending).toHaveBeenCalledWith(expect.objectContaining({
            id: mocks.user.id,
            role: 'admin_dirjen',
        }));
    });

    it('resolves eligible approvers using the record scope', async () => {
        Object.assign(mocks.user, { role: 'admin_sesditjen', unitKerjaId: 'forged-unit' });

        await request(app).get(`/approval/approvers/${ids.surat}`).expect(200);

        expect(mocks.approval.getSubmissionContext).toHaveBeenCalledWith(
            ids.surat,
            expect.objectContaining({ id: mocks.user.id, role: 'admin_sesditjen' }),
            'sesditjen',
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
