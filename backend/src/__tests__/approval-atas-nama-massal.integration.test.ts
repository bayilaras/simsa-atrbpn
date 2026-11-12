import type { PGlite } from '@electric-sql/pglite';
import express from 'express';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { PENGGUNA, USER_ID, bootRangkaianDatabase, seedRangkaianFixture } from './helpers/rangkaian-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({
    get db() { return holder.db; },
    pool: { query: async () => { throw new Error('pool tidak dipakai dalam uji ini'); } },
}));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        const raw = req.headers['x-uji-pengguna'];
        req.user = raw ? { email: 'uji@example.test', ...JSON.parse(String(raw)) } : undefined;
        next();
    },
}));
vi.mock('../services/blob-storage.service', () => ({
    blobStorageService: { downloadFile: vi.fn(), uploadFile: vi.fn(), uploadUntrustedFile: vi.fn(), deleteFile: vi.fn(), deleteFileGeneration: vi.fn() },
}));
vi.mock('../services/malware-scan-dispatch.service.js', () => ({ scheduleMalwareScanWake: vi.fn() }));
const emailMocks = vi.hoisted(() => ({ sendApprovalNotification: vi.fn(async () => ({ sent: true, status: 'sent' })) }));
vi.mock('../services/email.service.js', () => ({ emailService: emailMocks }));

// Pengajuan atas nama pembuat yang sudah tidak bertugas, dan pengajuan /
// persetujuan massal. Aturan dua orang tidak berubah: pengaju tidak pernah
// menjadi penyetuju suratnya.
const ORANG = {
    bppt2: '71000000-0000-4000-8000-000000000001',
    nonaktif: '71000000-0000-4000-8000-000000000002',
} as const;
const SK = {
    milik1: '72000000-0000-4000-8000-000000000001',
    milik2: '72000000-0000-4000-8000-000000000002',
    pembuatAktif: '72000000-0000-4000-8000-000000000003',
    pembuatNonaktif: '72000000-0000-4000-8000-000000000004',
    pembuatPindah: '72000000-0000-4000-8000-000000000005',
    rahasiaNonaktif: '72000000-0000-4000-8000-000000000006',
} as const;
const ID_ACAK = '72000000-0000-4000-8000-0000000000ff';
const BPPT2 = { id: ORANG.bppt2, role: 'admin_unit', unitKerjaId: 'dir_bppt' };

let database: PGlite;
let app: express.Express;
const sebagai = (user: object) => ({ 'x-uji-pengguna': JSON.stringify(user) });

async function statusSurat(id: string) {
    return (await database.query<any>(`SELECT approval_status, current_approver_id FROM surat_keluar WHERE id = $1`, [id])).rows[0];
}
async function auditSurat(id: string) {
    return (await database.query<any>(
        `SELECT user_id, action, changes FROM audit_log WHERE entity_type = 'surat_keluar' AND entity_id = $1 AND action = 'status_change' ORDER BY created_at, id`,
        [id],
    )).rows;
}
const ajukan = (user: object, suratId: string, nextApproverId: string, notes?: string) =>
    request(app).post('/api/approval/submit').set(sebagai(user)).send({ suratId, nextApproverId, ...(notes ? { notes } : {}) });

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    const { default: approvalRouter } = await import('../routes/approval.routes');
    const { default: suratKeluarRouter } = await import('../routes/surat-keluar.routes');
    app = express();
    app.use(express.json());
    app.use('/api/approval', approvalRouter);
    app.use('/api/surat-keluar', suratKeluarRouter);
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error?.statusCode || 500).json({ error: error?.message }));
}, 90_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => {
    emailMocks.sendApprovalNotification.mockClear();
    await seedRangkaianFixture(database);
    await database.exec(`
        UPDATE users SET name = 'Admin BPPT' WHERE id = '${USER_ID.bppt}';
        UPDATE users SET name = 'Admin PTEP' WHERE id = '${USER_ID.ptep}';
        INSERT INTO users (id, email, name, role, unit_kerja_id, is_active) VALUES
            ('${ORANG.bppt2}','bppt2@example.test','Admin BPPT Kedua','admin_unit','dir_bppt',true),
            ('${ORANG.nonaktif}','lama@example.test','Admin Lama','admin_unit','dir_bppt',false);
        INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, klasifikasi_keamanan, nomor_surat, perihal, kepada, naskah_dinas, tanggal_surat, approval_status, created_by) VALUES
            ('${SK.milik1}','dir_bppt',21,2026,'biasa','ND-21/BPPT/2026','Milik sendiri satu','Kanwil','Nota Dinas','2026-09-21','draft','${USER_ID.bppt}'),
            ('${SK.milik2}','dir_bppt',22,2026,'biasa','ND-22/BPPT/2026','Milik sendiri dua','Kanwil','Nota Dinas','2026-09-22','draft','${USER_ID.bppt}'),
            ('${SK.pembuatAktif}','dir_bppt',23,2026,'biasa','ND-23/BPPT/2026','Pembuat masih aktif','Kanwil','Nota Dinas','2026-09-23','draft','${ORANG.bppt2}'),
            ('${SK.pembuatNonaktif}','dir_bppt',24,2026,'biasa','ND-24/BPPT/2026','Pembuat nonaktif','Kanwil','Nota Dinas','2026-09-24','draft','${ORANG.nonaktif}'),
            ('${SK.pembuatPindah}','dir_bppt',25,2026,'biasa','ND-25/BPPT/2026','Pembuat pindah unit','Kanwil','Nota Dinas','2026-09-25','rejected','${USER_ID.ptep}'),
            ('${SK.rahasiaNonaktif}','dir_bppt',26,2026,'rahasia','ND-26/BPPT/2026','Rahasia pembuat nonaktif','Kanwil','Nota Dinas','2026-09-26','draft','${ORANG.nonaktif}');
    `);
});

describe('pengajuan atas nama pembuat yang tidak lagi bertugas', () => {
    it('pembuat masih aktif di unit surat: orang lain tetap ditolak', async () => {
        const res = await ajukan(PENGGUNA.bppt, SK.pembuatAktif, USER_ID.superAdmin).expect(403);
        expect(res.body.error).toBe('Hanya pembuat surat yang dapat mengajukan persetujuan.');
        await ajukan(PENGGUNA.superAdmin, SK.pembuatAktif, USER_ID.bppt).expect(403);
        expect((await statusSurat(SK.pembuatAktif)).approval_status).toBe('draft');
        await request(app).get(`/api/approval/approvers/${SK.pembuatAktif}`).set(sebagai(PENGGUNA.bppt)).expect(403);
    });

    it('pembuat nonaktif: admin unit surat mengajukan; riwayat dan audit mencatat atas nama siapa', async () => {
        const daftar = await request(app).get(`/api/approval/approvers/${SK.pembuatNonaktif}`).set(sebagai(PENGGUNA.bppt)).expect(200);
        expect(daftar.body.atasNamaPembuat).toBe('Admin Lama');
        const idPenyetuju = daftar.body.data.map((item: any) => item.id);
        expect(idPenyetuju).toContain(ORANG.bppt2);
        expect(idPenyetuju).not.toContain(USER_ID.bppt);
        expect(idPenyetuju).not.toContain(ORANG.nonaktif);

        await ajukan(PENGGUNA.bppt, SK.pembuatNonaktif, ORANG.bppt2, 'Mohon ditinjau').expect(200);
        expect(await statusSurat(SK.pembuatNonaktif)).toEqual({ approval_status: 'pending', current_approver_id: ORANG.bppt2 });

        const permintaan = (await database.query<any>(`SELECT requester_id FROM approval_requests WHERE entity_id = '${SK.pembuatNonaktif}'`)).rows;
        expect(permintaan).toEqual([{ requester_id: USER_ID.bppt }]);
        const riwayat = await request(app).get(`/api/approval/history/${SK.pembuatNonaktif}`).set(sebagai(PENGGUNA.bppt)).expect(200);
        expect(riwayat.body.data[0]).toMatchObject({
            action: 'SUBMIT',
            userName: 'Admin BPPT',
            notes: 'Diajukan atas nama pembuat surat (Admin Lama). Mohon ditinjau',
        });
        const audit = await auditSurat(SK.pembuatNonaktif);
        expect(audit).toHaveLength(1);
        expect(audit[0].user_id).toBe(USER_ID.bppt);
        expect(audit[0].changes).toMatchObject({
            before: { approvalStatus: 'draft' },
            after: { approvalStatus: 'pending', currentApproverId: ORANG.bppt2 },
            atasNamaPembuat: ORANG.nonaktif,
        });

        // Aturan dua orang: pengaju pengganti tidak dapat menyetujui pengajuannya.
        await request(app).post('/api/approval/approve').set(sebagai(PENGGUNA.bppt)).send({ suratId: SK.pembuatNonaktif }).expect(409);
        await request(app).post('/api/approval/approve').set(sebagai(BPPT2)).send({ suratId: SK.pembuatNonaktif }).expect(200);
        expect((await statusSurat(SK.pembuatNonaktif)).approval_status).toBe('approved');
        expect((await auditSurat(SK.pembuatNonaktif)).map(row => row.changes.tindakan)).toEqual(['ajukan_persetujuan', 'setujui']);
    });

    it('pengaju pengganti tidak boleh menunjuk dirinya sebagai penyetuju', async () => {
        await ajukan(PENGGUNA.bppt, SK.pembuatNonaktif, USER_ID.bppt).expect(400);
        expect((await statusSurat(SK.pembuatNonaktif)).approval_status).toBe('draft');
    });

    it('pembuat pindah unit: super admin mengajukan ulang surat yang ditolak', async () => {
        await ajukan(PENGGUNA.superAdmin, SK.pembuatPindah, USER_ID.bppt).expect(200);
        expect(await statusSurat(SK.pembuatPindah)).toEqual({ approval_status: 'pending', current_approver_id: USER_ID.bppt });
        const [audit] = await auditSurat(SK.pembuatPindah);
        expect(audit.changes).toMatchObject({ before: { approvalStatus: 'rejected' }, atasNamaPembuat: USER_ID.ptep });
        // Pembuat lama (kini di unit lain) tidak lagi dapat mengajukan.
        await database.exec(`UPDATE surat_keluar SET approval_status = 'draft', current_approver_id = NULL WHERE id = '${SK.pembuatPindah}'; DELETE FROM approval_requests WHERE entity_id = '${SK.pembuatPindah}';`);
        await ajukan(PENGGUNA.ptep, SK.pembuatPindah, USER_ID.superAdmin).expect(404);
    });

    it('admin unit lain dan staf tetap ditolak; plafon kelas keamanan tetap berlaku', async () => {
        await ajukan(PENGGUNA.plp, SK.pembuatNonaktif, USER_ID.superAdmin).expect(404);
        await ajukan(PENGGUNA.staffSes, SK.pembuatNonaktif, USER_ID.superAdmin).expect(403);
        const res = await ajukan(PENGGUNA.bppt, SK.rahasiaNonaktif, USER_ID.superAdmin).expect(403);
        expect(res.body.error).toBe('Hanya pembuat surat yang dapat mengajukan persetujuan.');
        expect((await statusSurat(SK.rahasiaNonaktif)).approval_status).toBe('draft');
        expect(await auditSurat(SK.rahasiaNonaktif)).toEqual([]);
    });

    it('detail surat memberi petunjuk pengajuan atas nama hanya bila berlaku', async () => {
        const nonaktif = await request(app).get(`/api/surat-keluar/${SK.pembuatNonaktif}`).set(sebagai(PENGGUNA.bppt)).expect(200);
        expect(nonaktif.body.data.pengajuanAtasNama).toEqual({ namaPembuat: 'Admin Lama' });
        const aktif = await request(app).get(`/api/surat-keluar/${SK.pembuatAktif}`).set(sebagai(PENGGUNA.bppt)).expect(200);
        expect(aktif.body.data.pengajuanAtasNama).toBeNull();
        const milik = await request(app).get(`/api/surat-keluar/${SK.milik1}`).set(sebagai(PENGGUNA.bppt)).expect(200);
        expect(milik.body.data.pengajuanAtasNama).toBeNull();
    });
});

describe('pengajuan dan persetujuan massal', () => {
    it('mengajukan beberapa surat: hasil per surat, yang gagal tidak membatalkan yang lain, satu audit per surat', async () => {
        const res = await request(app).post('/api/approval/submit-bulk').set(sebagai(PENGGUNA.bppt)).send({
            suratIds: [SK.milik1, SK.pembuatAktif, ID_ACAK, SK.milik2],
            nextApproverId: ORANG.bppt2,
        }).expect(200);
        expect(res.body.data).toMatchObject({ berhasil: 2, gagal: 2 });
        expect(res.body.data.hasil).toEqual([
            { suratId: SK.milik1, berhasil: true },
            { suratId: SK.pembuatAktif, berhasil: false, pesan: 'Hanya pembuat surat yang dapat mengajukan persetujuan.' },
            { suratId: ID_ACAK, berhasil: false, pesan: 'Surat keluar tidak ditemukan.' },
            { suratId: SK.milik2, berhasil: true },
        ]);
        expect(await statusSurat(SK.milik1)).toEqual({ approval_status: 'pending', current_approver_id: ORANG.bppt2 });
        expect(await statusSurat(SK.milik2)).toEqual({ approval_status: 'pending', current_approver_id: ORANG.bppt2 });
        expect((await statusSurat(SK.pembuatAktif)).approval_status).toBe('draft');
        expect(await auditSurat(SK.milik1)).toHaveLength(1);
        expect(await auditSurat(SK.milik2)).toHaveLength(1);
        expect(await auditSurat(SK.pembuatAktif)).toEqual([]);
        expect(emailMocks.sendApprovalNotification).not.toHaveBeenCalled();
    });

    it('pengaju yang menunjuk dirinya sendiri ditolak untuk setiap surat', async () => {
        const res = await request(app).post('/api/approval/submit-bulk').set(sebagai(PENGGUNA.bppt)).send({
            suratIds: [SK.milik1, SK.milik2],
            nextApproverId: USER_ID.bppt,
        }).expect(200);
        expect(res.body.data).toMatchObject({ berhasil: 0, gagal: 2 });
        expect((await statusSurat(SK.milik1)).approval_status).toBe('draft');
    });

    it('menyetujui beberapa surat: hanya yang menunggu penyetuju ini; pengaju tidak dapat menyetujui sendiri', async () => {
        await request(app).post('/api/approval/submit-bulk').set(sebagai(PENGGUNA.bppt)).send({
            suratIds: [SK.milik1, SK.milik2],
            nextApproverId: ORANG.bppt2,
        }).expect(200);

        const sendiri = await request(app).post('/api/approval/approve-bulk').set(sebagai(PENGGUNA.bppt)).send({
            suratIds: [SK.milik1, SK.milik2],
        }).expect(200);
        expect(sendiri.body.data).toMatchObject({ berhasil: 0, gagal: 2 });
        expect((await statusSurat(SK.milik1)).approval_status).toBe('pending');

        const res = await request(app).post('/api/approval/approve-bulk').set(sebagai(BPPT2)).send({
            suratIds: [SK.milik1, SK.pembuatAktif, SK.milik2],
            notes: 'Disetujui bersama',
        }).expect(200);
        expect(res.body.data).toMatchObject({ berhasil: 2, gagal: 1 });
        expect(res.body.data.hasil[1]).toEqual({
            suratId: SK.pembuatAktif,
            berhasil: false,
            pesan: 'Surat tidak sedang menunggu persetujuan pengguna ini.',
        });
        expect(await statusSurat(SK.milik1)).toEqual({ approval_status: 'approved', current_approver_id: null });
        expect(await statusSurat(SK.milik2)).toEqual({ approval_status: 'approved', current_approver_id: null });
        expect((await statusSurat(SK.pembuatAktif)).approval_status).toBe('draft');
        const audit = await auditSurat(SK.milik1);
        expect(audit.map(row => [row.user_id, row.changes.tindakan])).toEqual([
            [USER_ID.bppt, 'ajukan_persetujuan'],
            [ORANG.bppt2, 'setujui'],
        ]);
        const riwayat = (await database.query<any>(
            `SELECT h.action, h.notes FROM approval_history h JOIN approval_requests r ON r.id = h.request_id WHERE r.entity_id = '${SK.milik2}' AND h.action = 'APPROVE'`,
        )).rows;
        expect(riwayat).toEqual([{ action: 'APPROVE', notes: 'Disetujui bersama' }]);
    });

    it('penolakan tunggal juga tercatat pada jejak audit', async () => {
        await ajukan(PENGGUNA.bppt, SK.milik1, ORANG.bppt2).expect(200);
        await request(app).post('/api/approval/reject').set(sebagai(BPPT2)).send({ suratId: SK.milik1, notes: 'Perbaiki tujuan' }).expect(200);
        expect((await auditSurat(SK.milik1)).map(row => row.changes.tindakan)).toEqual(['ajukan_persetujuan', 'tolak']);
    });
});

describe('GET /api/surat-keluar?persetujuan= mempersempit daftar kerja persetujuan', () => {
    const idDaftar = async (user: object, persetujuan: string) => {
        const res = await request(app).get('/api/surat-keluar').query({ persetujuan, limit: 100 }).set(sebagai(user)).expect(200);
        return res.body.data.map((row: any) => row.id).sort();
    };

    it('draft_saya: hanya surat buatan pengguna yang belum diajukan', async () => {
        expect(await idDaftar(PENGGUNA.bppt, 'draft_saya')).toEqual([SK.milik1, SK.milik2]);
        await ajukan(PENGGUNA.bppt, SK.milik1, ORANG.bppt2).expect(200);
        expect(await idDaftar(PENGGUNA.bppt, 'draft_saya')).toEqual([SK.milik2]);
        expect(await idDaftar(BPPT2, 'draft_saya')).toEqual([SK.pembuatAktif]);
    });

    it('menunggu_saya: hanya surat yang menunggu keputusan pengguna', async () => {
        expect(await idDaftar(BPPT2, 'menunggu_saya')).toEqual([]);
        await ajukan(PENGGUNA.bppt, SK.milik1, ORANG.bppt2).expect(200);
        expect(await idDaftar(BPPT2, 'menunggu_saya')).toEqual([SK.milik1]);
        expect(await idDaftar(PENGGUNA.bppt, 'menunggu_saya')).toEqual([]);
        await request(app).get('/api/surat-keluar').query({ persetujuan: 'lainnya' }).set(sebagai(BPPT2)).expect(400);
    });
});
