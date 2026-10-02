// backend/integration/kotak-disposisi.postgres.test.ts
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { dbState } from './helpers/db-proxy.js';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

// Mock `db` bersama untuk suite Postgres P3 (T2-5).
vi.mock('../src/config/database', () => import('./helpers/db-proxy.js'));
vi.mock('../src/config/database.js', () => import('./helpers/db-proxy.js'));

// Pengguna pemanggil untuk uji HTTP GET /api/distributions/:id (T10-4, C-1).
const auth = vi.hoisted(() => {
    const state = { user: null as { id: string; email: string; role: string; unitKerjaId: string | null } | null };
    const modul = () => ({
        authMiddleware: (req: any, _res: any, next: any) => {
            req.user = state.user ? { ...state.user } : undefined;
            next();
        },
    });
    return { state, modul };
});
vi.mock('../src/middlewares/auth.middleware', () => auth.modul());
vi.mock('../src/middlewares/auth.middleware.js', () => auth.modul());

const { distributionService } = await import('../src/services/distribution.service.js');
const { recordAccessGrantService } = await import('../src/services/record-access-grant.service.js');
const { default: distributionRouter } = await import('../src/routes/distribution.routes.js');
const { publicErrorResponse, publicErrorStatus } = await import('../src/utils/public-error.js');

const app = express();
app.use(express.json());
app.use('/api/distributions', distributionRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(publicErrorStatus(error)).json(publicErrorResponse(error));
});

// Tanpa TEST_POSTGRES_URL suite ini dilewati bersih (tidak ada Postgres lokal);
// CI menjalankannya pada PG16/17/18.
const adaPostgres = Boolean(process.env.TEST_POSTGRES_URL);

let h: RangkaianTestDatabase;
let tu: TestUser; let bppt: TestUser; let ptep: TestUser; let ktpp: TestUser; let superA: TestUser;
let smBiasa: string; let smRahasia: string; let distBppt: string; let distPtepRahasia: string; let rangkaianBiasa: string;
const audit = (u: TestUser) => ({ userId: u.id, userEmail: u.email });

/** Disposisi surat terkendali: jalur grant disposisi harus menyala saat distribute. */
async function disposisiTerkendali(input: { nomorSurat: string; perihal: string; sifatSurat: string; targetUnitId: string; instruction: string }) {
    const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: input.nomorSurat, perihal: input.perihal, sifatSurat: input.sifatSurat });
    process.env.RANGKAIAN_AJUKAN_AKSES = 'true';
    try {
        const row = await distributionService.distribute({ suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: input.targetUnitId,
            sentBy: tu.id, instruction: input.instruction }, audit(tu));
        return { sm, dist: row.id };
    } finally {
        delete process.env.RANGKAIAN_AJUKAN_AKSES;
    }
}

describe.skipIf(!adaPostgres)('kotak disposisi dan penyelesaian di PostgreSQL', () => {
    beforeAll(async () => {
        h = await createRangkaianTestDatabase('kotak');
        dbState.db = h.db;
        await h.seedUnits();
        tu = await h.seedUser('admin_unit', 'sesditjen');
        bppt = await h.seedUser('admin_unit', 'dir_bppt');
        ptep = await h.seedUser('admin_unit', 'dir_ptep');
        ktpp = await h.seedUser('admin_unit', 'dir_ktpp');
        superA = await h.seedUser('super_admin', null);
        smBiasa = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-30/2026', perihal: 'Undangan koordinasi' });
        const biasa = await distributionService.distributeMany({ suratMasukId: smBiasa, sourceUnitId: 'sesditjen', sentBy: tu.id,
            targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }, { unitKerjaId: 'dir_ptep' }], instruksi: 'Mohon hadir' }, audit(tu));
        distBppt = biasa.find((r) => r.targetUnitId === 'dir_bppt')!.id;
        rangkaianBiasa = biasa[0].rangkaianId!;
        ({ sm: smRahasia, dist: distPtepRahasia } = await disposisiTerkendali({
            nomorSurat: 'R-30/2026', perihal: 'Tukar guling kawasan', sifatSurat: 'Rahasia', targetUnitId: 'dir_ptep', instruction: 'Isi rahasia',
        }));
    }, 120_000);
    afterEach(() => {
        vi.useRealTimers();
        auth.state.user = null;
        delete process.env.RANGKAIAN_AJUKAN_AKSES;
    });
    afterAll(async () => { await h?.close(); });

    it('baris surat yang tidak boleh dibaca tampil tersamar tanpa id surat, perihal, atau instruksi', async () => {
        const { data, pagination } = await distributionService.findInbox('dir_ptep', {}, ptep);
        expect(pagination.total).toBe(2);
        const rahasia = data.find((row: any) => row.id === distPtepRahasia)!;
        expect(rahasia).toMatchObject({
            masked: true, suratMasukId: null, instruction: null, catatanPenyelesaian: null, rejectionReason: null,
            surat: { id: null, perihal: null, label: 'Dikecualikan' }, sourceUnit: { id: 'sesditjen' },
        });
        expect(JSON.stringify(rahasia)).not.toContain(smRahasia);
        expect(JSON.stringify(rahasia)).not.toContain('Tukar guling');
        expect(JSON.stringify(rahasia)).not.toContain('R-30/2026');
        expect(data.find((row: any) => row.surat.id === smBiasa)).toMatchObject({ masked: false, instruction: 'Mohon hadir' });
    });

    it('filter lewat batas memakai tanggal Jakarta', async () => {
        await h.query("UPDATE surat_distributions SET batas_waktu = '2026-09-26' WHERE id = $1", [distBppt]);
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-26T17:30:00Z')); // 27 Sep 00.30 WIB
        expect((await distributionService.findInbox('dir_bppt', { lewatBatas: true }, bppt)).data.map((r: any) => r.id)).toEqual([distBppt]);
        vi.setSystemTime(new Date('2026-09-26T16:30:00Z')); // 26 Sep 23.30 WIB
        expect((await distributionService.findInbox('dir_bppt', { lewatBatas: true }, bppt)).data).toEqual([]);
    });

    it('surat masuk terhapus tidak tampil di kotak disposisi (T10-6)', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-34/2026', perihal: 'Akan dihapus' });
        const [row] = await distributionService.distributeMany({ suratMasukId: sm, sourceUnitId: 'sesditjen', sentBy: tu.id,
            targets: [{ unitKerjaId: 'dir_plp' }] }, audit(tu));
        await h.query('UPDATE surat_masuk SET is_deleted = true WHERE id = $1', [sm]);
        const { data, pagination } = await distributionService.findInbox('dir_plp', {}, bppt);
        expect(data.map((r: any) => r.id)).not.toContain(row.id);
        expect(pagination.total).toBe(0);
    });

    it('penyelesaian mewajibkan checkRead atas induk (403) dan dapat dibuka setelah grant disetujui', async () => {
        await expect(distributionService.process(distPtepRahasia, 'dir_ptep', audit(ptep), { catatanPenyelesaian: 'Sudah dikoordinasikan dengan TU' }, ptep))
            .rejects.toMatchObject({ statusCode: 403 });
        const [{ status }] = await h.query('SELECT status FROM surat_distributions WHERE id = $1', [distPtepRahasia]);
        expect(status).toBe('sent');
        const [grant] = await h.query<{ id: string }>("SELECT id FROM record_access_grants WHERE target_user_id = $1 AND entity_id = $2 AND status = 'pending'", [ptep.id, smRahasia]);
        await recordAccessGrantService.approve(grant.id, superA.id, 'Disetujui untuk tindak lanjut', new Date(Date.now() + 3600_000), audit(superA));
        const selesai = await distributionService.process(distPtepRahasia, 'dir_ptep', audit(ptep), { catatanPenyelesaian: 'Sudah dikoordinasikan dengan TU' }, ptep);
        expect(selesai).toMatchObject({ status: 'processed', processedBy: ptep.id, receivedBy: ptep.id, catatanPenyelesaian: 'Sudah dikoordinasikan dengan TU' });
        const [g] = await h.query('SELECT status, revoked_by FROM record_access_grants WHERE id = $1', [grant.id]);
        expect(g).toEqual({ status: 'revoked', revoked_by: ptep.id });
        const aksi = await h.query<{ action: string }>("SELECT action FROM audit_log WHERE entity_type = 'surat_distribution' AND entity_id = $1 ORDER BY created_at, action", [distPtepRahasia]);
        expect(aksi.map((a) => a.action)).toEqual(expect.arrayContaining(['receive_distribution', 'process_distribution']));
    });

    it('penyelesaian dengan surat keluar: harus approved, milik unit target, dan anggota rangkaian yang sama', async () => {
        const skLuar = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'ND-L/2026', approvalStatus: 'approved' });
        await expect(distributionService.process(distBppt, 'dir_bppt', audit(bppt), { penyelesaianSuratKeluarId: skLuar }, bppt))
            .rejects.toMatchObject({ statusCode: 422 });
        const skDraft = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'ND-D/2026', approvalStatus: 'draft' });
        await h.query("INSERT INTO rangkaian_anggota (rangkaian_id, surat_keluar_id, unit_kerja_id, sumber) VALUES ($1, $2, 'dir_bppt', 'aplikasi')", [rangkaianBiasa, skDraft]);
        await expect(distributionService.process(distBppt, 'dir_bppt', audit(bppt), { penyelesaianSuratKeluarId: skDraft }, bppt))
            .rejects.toMatchObject({ statusCode: 422 });
        expect(await distributionService.kandidatPenyelesaian(distBppt, 'dir_bppt', bppt)).toEqual([]);
        await h.query("UPDATE surat_keluar SET approval_status = 'approved' WHERE id = $1", [skDraft]);
        expect((await distributionService.kandidatPenyelesaian(distBppt, 'dir_bppt', bppt)).map((k) => k.id)).toEqual([skDraft]);
        // Unit lain tidak mendapat kandidat dari disposisi yang bukan miliknya.
        expect(await distributionService.kandidatPenyelesaian(distBppt, 'dir_ptep', ptep)).toEqual([]);
        const selesai = await distributionService.process(distBppt, 'dir_bppt', audit(bppt), { penyelesaianSuratKeluarId: skDraft }, bppt);
        expect(selesai).toMatchObject({ status: 'processed', processedBy: bppt.id, penyelesaianSuratKeluarId: skDraft, receivedBy: bppt.id });
    });

    it('kandidat penyelesaian tidak membocorkan SK Rahasia unit sendiri tanpa grant (T10-7)', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-35/2026' });
        const [dist] = await distributionService.distributeMany({ suratMasukId: sm, sourceUnitId: 'sesditjen', sentBy: tu.id,
            targets: [{ unitKerjaId: 'dir_bppt' }] }, audit(tu));
        const skRahasia = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'ND-R/2026', approvalStatus: 'approved', klasifikasiKeamanan: 'rahasia' });
        await h.query("INSERT INTO rangkaian_anggota (rangkaian_id, surat_keluar_id, unit_kerja_id, sumber) VALUES ($1, $2, 'dir_bppt', 'aplikasi')", [dist.rangkaianId, skRahasia]);
        expect(await distributionService.kandidatPenyelesaian(dist.id, 'dir_bppt', bppt)).toEqual([]);
    });

    it('Tolak mencabut grant disposisi dan tetap tersedia untuk baris tersamar', async () => {
        const { sm, dist } = await disposisiTerkendali({
            nomorSurat: 'T-36/2026', perihal: 'Batas wilayah', sifatSurat: 'Terbatas', targetUnitId: 'dir_ktpp', instruction: 'Isi terbatas',
        });
        const ditolak = await distributionService.reject(dist, 'Salah', 'dir_ktpp', audit(ktpp));
        expect(ditolak).toMatchObject({ status: 'rejected', rejectionReason: 'Salah' });
        const grants = await h.query("SELECT status, decided_by FROM record_access_grants WHERE entity_id = $1 AND target_user_id = $2", [sm, ktpp.id]);
        expect(grants).toEqual([{ status: 'denied', decided_by: ktpp.id }]);
    });

    it('receive ∥ process pada disposisi yang sama selesai tanpa 40P01', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-33/2026' });
        const [dist] = await distributionService.distributeMany({ suratMasukId: sm, sourceUnitId: 'sesditjen', sentBy: tu.id,
            targets: [{ unitKerjaId: 'dir_ktpp' }] }, audit(tu));
        const hasil = await Promise.allSettled([
            distributionService.receive(dist.id, ktpp.id, 'dir_ktpp', audit(ktpp)),
            distributionService.process(dist.id, 'dir_ktpp', audit(ktpp), { catatanPenyelesaian: 'Sudah ditangani langsung' }, ktpp),
        ]);
        for (const r of hasil) {
            if (r.status === 'rejected') expect(r.reason).toMatchObject({ statusCode: 400 });
        }
        expect(hasil[1].status).toBe('fulfilled');
        const [row] = await h.query('SELECT status, received_by, processed_by FROM surat_distributions WHERE id = $1', [dist.id]);
        expect(row).toEqual({ status: 'processed', received_by: ktpp.id, processed_by: ktpp.id });
    });

    describe('GET /api/distributions/:id (T10-4, C-1)', () => {
        it('target tanpa grant atas surat Terbatas hanya menerima routing', async () => {
            const { sm, dist } = await disposisiTerkendali({
                nomorSurat: 'T-32/2026', perihal: 'Sengketa batas', sifatSurat: 'Terbatas', targetUnitId: 'dir_bppt', instruction: 'Isi terbatas',
            });
            auth.state.user = bppt;
            const res = await request(app).get(`/api/distributions/${dist}`).expect(200);
            expect(res.body.data).toMatchObject({ id: dist, masked: true, suratMasukId: null, instruction: null, targetUnitId: 'dir_bppt' });
            expect(res.body.data.surat.id).toBeNull();
            expect(res.body.data.surat.perihal).toBeNull();
            for (const bocor of [sm, 'Sengketa batas', 'T-32/2026', 'Isi terbatas']) expect(res.text).not.toContain(bocor);

            // (b) unit sumber admin_unit atas surat Terbatas miliknya sendiri tanpa grant.
            auth.state.user = tu;
            const sumber = await request(app).get(`/api/distributions/${dist}`).expect(200);
            expect(sumber.body.data).toMatchObject({ masked: true, suratMasukId: null, surat: { id: null, perihal: null } });
            expect(sumber.text).not.toContain('Sengketa batas');
        });

        it('(a) super_admin tanpa grant atas surat Rahasia menerima bentuk tersamar', async () => {
            auth.state.user = superA;
            const res = await request(app).get(`/api/distributions/${distPtepRahasia}`).expect(200);
            expect(res.body.data.surat.perihal).toBeNull();
            expect(res.body.data.surat.id).toBeNull();
            expect(res.text).not.toContain(smRahasia);
            expect(res.text).not.toContain('Tukar guling');
        });

        it('(c) target dengan grant disposisi disetujui menerima baris penuh dan tepat satu audit view_via_rangkaian', async () => {
            const { sm, dist } = await disposisiTerkendali({
                nomorSurat: 'R-37/2026', perihal: 'Aset strategis', sifatSurat: 'Rahasia', targetUnitId: 'dir_ptep', instruction: 'Isi rahasia lain',
            });
            const [grant] = await h.query<{ id: string }>("SELECT id FROM record_access_grants WHERE target_user_id = $1 AND entity_id = $2 AND status = 'pending'", [ptep.id, sm]);
            await recordAccessGrantService.approve(grant.id, superA.id, 'Disetujui untuk tindak lanjut', new Date(Date.now() + 3600_000), audit(superA));
            auth.state.user = ptep;
            const res = await request(app).get(`/api/distributions/${dist}`).expect(200);
            expect(res.body.data).toMatchObject({ id: dist, suratMasukId: sm, instruction: 'Isi rahasia lain', surat: { id: sm, perihal: 'Aset strategis' } });
            // P4 (P4-D-21): GET /distributions/:id yang terbaca mengirim masked:false eksplisit.
            expect(res.body.data.masked).toBe(false);
            const log = await h.query<{ user_id: string; changes: any }>(
                "SELECT user_id, changes FROM audit_log WHERE action = 'view_via_rangkaian' AND entity_type = 'surat_masuk' AND entity_id = $1", [sm]);
            expect(log).toHaveLength(1);
            expect(log[0].user_id).toBe(ptep.id);
            expect(log[0].changes).toMatchObject({ grantId: grant.id, distribusiId: dist });
        });

        it('Terima ditolak 403 untuk surat yang belum dapat dibaca, tetapi Tolak diizinkan', async () => {
            const { sm, dist } = await disposisiTerkendali({
                nomorSurat: 'T-38/2026', perihal: 'Tata ruang', sifatSurat: 'Terbatas', targetUnitId: 'dir_plp', instruction: 'Isi terbatas',
            });
            const plp = await h.seedUser('admin_unit', 'dir_plp');
            auth.state.user = plp;
            await request(app).put(`/api/distributions/${dist}/receive`).expect(403);
            const tolak = await request(app).put(`/api/distributions/${dist}/reject`).send({ reason: 'Bukan kewenangan unit kami' }).expect(200);
            // A-I1: respons Tolak untuk surat yang tidak terbaca wajib tersamar (§4.8).
            expect(tolak.body.data).toMatchObject({ id: dist, suratMasukId: null, instruction: null, masked: true });
            for (const bocor of [sm, 'Tata ruang', 'T-38/2026', 'Isi terbatas']) expect(tolak.text).not.toContain(bocor);
            const [row] = await h.query('SELECT status FROM surat_distributions WHERE id = $1', [dist]);
            expect(row.status).toBe('rejected');
        });
    });
});
