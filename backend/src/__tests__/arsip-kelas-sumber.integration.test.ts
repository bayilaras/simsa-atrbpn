import type { PGlite } from '@electric-sql/pglite';
import express from 'express';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { kelasSumberSurat, rankKelas } from '../services/access/visibility-spec';
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

// F1-4: arsip yang lahir dari surat tidak boleh berkelas keamanan di bawah
// surat sumbernya. Bila turun, nomor/tanggal/perihal yang tersalin ke arsip
// terbaca staff/auditor unit tanpa grant atas surat sumber.
const SURAT = {
    smRahasia: '64000000-0000-4000-8000-000000000001',
    smTakDikenal: '64000000-0000-4000-8000-000000000002',
    skNull: '64000000-0000-4000-8000-000000000003',
} as const;
const GRANT = {
    smRahasia: '65000000-0000-4000-8000-000000000001',
    skNull: '65000000-0000-4000-8000-000000000002',
    arsip: '65000000-0000-4000-8000-000000000003',
} as const;
const PERIHAL_RAHASIA = 'ZQXARSIP perihal sengketa rahasia';

let database: PGlite;
let app: express.Express;
const sebagai = (user: object) => ({ 'x-uji-pengguna': JSON.stringify(user) });

function registrasi(extra: Record<string, unknown> = {}) {
    return {
        nomorBerkas: 'B-UJI/2026',
        kodeKlasifikasi: 'KU.01',
        jraKode: 'F.UJI',
        uraianBerkas: PERIHAL_RAHASIA,
        unitPengolah: 'SekDitjen',
        kurunWaktu: '2026',
        tanggalArsip: '2026-09-10',
        nomorItem: '1',
        uraianItem: PERIHAL_RAHASIA,
        tingkatPerkembangan: 'Asli',
        jumlah: 1,
        items: [{ nomor: '1', uraian: PERIHAL_RAHASIA, perkembangan: 'Asli', tanggal: '2026-09-10', jumlah: 1 }],
        ...extra,
    };
}

function grantRow(id: string, type: string, entity: string, kelas: string) {
    return `('${id}','${USER_ID.tu}','${USER_ID.tu}','${type}','${entity}','sesditjen','${kelas}','Pengarsipan surat terkendali untuk tugas resmi','manage','approved','${USER_ID.approver}','2026-09-01T00:00:00Z','Kebutuhan kerja terverifikasi','2099-01-01T00:00:00Z')`;
}

async function arsipDari(sourceId: string) {
    return (await database.query<any>(`SELECT id, klasifikasi_keamanan FROM arsip WHERE source_surat_id = $1`, [sourceId])).rows;
}

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    const { default: suratMasukRouter } = await import('../routes/surat-masuk.routes');
    const { default: suratKeluarRouter } = await import('../routes/surat-keluar.routes');
    const { default: arsipRouter } = await import('../routes/arsip.routes');
    app = express();
    app.use(express.json());
    app.use('/api/surat-masuk', suratMasukRouter);
    app.use('/api/surat-keluar', suratKeluarRouter);
    app.use('/api/arsip', arsipRouter);
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error?.statusCode || 500).json({ error: error?.message }));
}, 90_000);
afterAll(async () => { await database?.close(); });
afterEach(() => { vi.restoreAllMocks(); });
beforeEach(async () => {
    await seedRangkaianFixture(database);
    await database.exec(`
        INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, sifat_surat, nomor_surat, perihal, dari, tanggal_surat) VALUES
            ('${SURAT.smRahasia}','sesditjen',11,2026,'Rahasia','SM-R/2026','${PERIHAL_RAHASIA}','Kanwil R','2026-09-10'),
            ('${SURAT.smTakDikenal}','sesditjen',12,2026,'Kilat Khusus','SM-K/2026','Sifat tak dikenal','Kanwil K','2026-09-11');
        INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, klasifikasi_keamanan, nomor_surat, perihal, kepada, naskah_dinas, tanggal_surat, approval_status) VALUES
            ('${SURAT.skNull}','sesditjen',11,2026,NULL,'SK-N/2026','Surat keluar lama tanpa kelas','Kanwil N','Nota Dinas','2026-09-12','approved');
        INSERT INTO record_access_grants (id, requester_id, target_user_id, entity_type, entity_id, unit_kerja_id, required_classification, purpose, access_mode, status, decided_by, decided_at, decision_reason, expires_at) VALUES
            ${grantRow(GRANT.smRahasia, 'surat_masuk', SURAT.smRahasia, 'rahasia')},
            ${grantRow(GRANT.skNull, 'surat_keluar', SURAT.skNull, 'terbatas')};
    `);
    // Katalog klasifikasi/JRA aktif bukan objek uji ini; resolusi aturan
    // diganti hasil kanonik minimal agar jalur kelas keamanan yang diuji.
    const { archiveRuleAssignmentService } = await import('../services/archive-rule-assignment.service');
    vi.spyOn(archiveRuleAssignmentService, 'resolveActive').mockResolvedValue({
        snapshot: { classification: { title: 'Keuangan', type: 'fasilitatif' } },
        snapshotSha256: 'a'.repeat(64),
        cache: { kodeKlasifikasi: 'KU.01', klasifikasiArsipId: null, jraItemId: null, jraKode: 'F.UJI' },
    } as any);
    vi.spyOn(archiveRuleAssignmentService, 'attachInitialSnapshot').mockImplementation(async (tx: any, arsipId: string) => {
        const [row] = await tx.select().from(schema.arsip).where(eq(schema.arsip.id, arsipId));
        return row;
    });
});

describe('helper kelas sumber', () => {
    it('memeringkat kelas ternormalisasi dan gagal-tertutup untuk kelas tak dikenal', () => {
        expect(['biasa', 'Terbatas', 'RAHASIA', 'sangat rahasia', 'Segera'].map(rankKelas)).toEqual([0, 1, 2, 3, 0]);
        expect(rankKelas('Kilat Khusus')).toBeNull();
        expect(rankKelas('__proto__')).toBeNull();
    });

    it('surat masuk dari sifat, surat keluar dari klasifikasi dengan NULL = terbatas', () => {
        expect(kelasSumberSurat('surat_masuk', { sifatSurat: 'Sangat Rahasia' })).toBe('sangat_rahasia');
        expect(kelasSumberSurat('surat_masuk', { sifatSurat: 'Penting', klasifikasiKeamanan: 'rahasia' })).toBe('biasa');
        expect(kelasSumberSurat('surat_keluar', { klasifikasiKeamanan: null, sifatSurat: 'biasa' })).toBe('terbatas');
        expect(kelasSumberSurat('surat_keluar', { klasifikasiKeamanan: 'rahasia' })).toBe('rahasia');
    });
});

describe('POST /api/surat-masuk/:id/archive-full mempertahankan kelas sumber', () => {
    it.each(['biasa', 'terbatas'])('admin_unit ber-grant kelola: body %s untuk surat Rahasia → 422 tanpa baris arsip', async kelas => {
        const response = await request(app).post(`/api/surat-masuk/${SURAT.smRahasia}/archive-full`)
            .set(sebagai(PENGGUNA.tu)).send(registrasi({ klasifikasiKeamanan: kelas })).expect(422);
        expect(response.body.error).toBe('Klasifikasi arsip tidak boleh lebih rendah dari surat sumber');
        expect(await arsipDari(SURAT.smRahasia)).toEqual([]);
        const sm = (await database.query<any>(`SELECT is_archived FROM surat_masuk WHERE id = '${SURAT.smRahasia}'`)).rows[0];
        expect(sm.is_archived).toBe(false);
    });

    it('tanpa kelas di body → arsip rahasia; staff unit yang sama tidak dapat membacanya', async () => {
        const response = await request(app).post(`/api/surat-masuk/${SURAT.smRahasia}/archive-full`)
            .set(sebagai(PENGGUNA.tu)).send(registrasi()).expect(200);
        expect(response.body.data).toMatchObject({ sourceSuratId: SURAT.smRahasia, klasifikasiKeamanan: 'rahasia' });
        const [row] = await arsipDari(SURAT.smRahasia);
        expect(row.klasifikasi_keamanan).toBe('rahasia');

        await request(app).get(`/api/arsip/${row.id}`).set(sebagai(PENGGUNA.staffSes)).expect(404);
        const list = await request(app).get('/api/arsip').query({ unitKerjaId: 'sesditjen', limit: '100' })
            .set(sebagai(PENGGUNA.staffSes)).expect(200);
        expect(list.body.data.map((item: any) => item.id)).not.toContain(row.id);
        expect(JSON.stringify(list.body)).not.toContain('ZQXARSIP');
    });

    it('admin_unit ber-grant boleh memilih kelas sumber rahasia walau di atas plafon perannya', async () => {
        await request(app).post(`/api/surat-masuk/${SURAT.smRahasia}/archive-full`)
            .set(sebagai(PENGGUNA.tu)).send(registrasi({ klasifikasiKeamanan: 'rahasia' })).expect(200);
        expect((await arsipDari(SURAT.smRahasia))[0].klasifikasi_keamanan).toBe('rahasia');
    });

    it('kelas di atas sumber dan di atas plafon peran tetap 403', async () => {
        await request(app).post(`/api/surat-masuk/${SURAT.smRahasia}/archive-full`)
            .set(sebagai(PENGGUNA.tu)).send(registrasi({ klasifikasiKeamanan: 'sangat_rahasia' })).expect(403);
        expect(await arsipDari(SURAT.smRahasia)).toEqual([]);
    });

    it('sifat surat tak dikenal ditolak: rute 404, layanan ValidationError', async () => {
        await request(app).post(`/api/surat-masuk/${SURAT.smTakDikenal}/archive-full`)
            .set(sebagai(PENGGUNA.superAdmin)).send(registrasi()).expect(404);
        const { arsipService } = await import('../services/arsip.service');
        await expect(arsipService.archiveFromSuratMasuk(SURAT.smTakDikenal, { ...registrasi(), createdBy: USER_ID.superAdmin } as any, 'sesditjen'))
            .rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/tidak dikenali/) });
        expect(await arsipDari(SURAT.smTakDikenal)).toEqual([]);
    });
});

describe('POST /api/surat-keluar/:id/archive-full', () => {
    it('surat keluar lama (NULL) tanpa kelas di body → arsip terbatas', async () => {
        const response = await request(app).post(`/api/surat-keluar/${SURAT.skNull}/archive-full`)
            .set(sebagai(PENGGUNA.tu)).send(registrasi({ uraianBerkas: 'Arsip SK lama' })).expect(200);
        expect(response.body.data.klasifikasiKeamanan).toBe('terbatas');
        expect((await arsipDari(SURAT.skNull))[0].klasifikasi_keamanan).toBe('terbatas');
    });

    it('surat keluar lama (NULL) dengan body biasa → 422 tanpa baris arsip', async () => {
        await request(app).post(`/api/surat-keluar/${SURAT.skNull}/archive-full`)
            .set(sebagai(PENGGUNA.tu)).send(registrasi({ klasifikasiKeamanan: 'biasa' })).expect(422);
        expect(await arsipDari(SURAT.skNull)).toEqual([]);
    });
});

describe('PUT /api/arsip/:id pada arsip tertaut', () => {
    // Disisipkan langsung (bukan lewat archive-full) agar uji PUT berdiri
    // sendiri; trigger 0021 tetap memeriksa kecocokan metadata sumber.
    const ARSIP_TERTAUT = '66000000-0000-4000-8000-000000000001';
    async function arsipRahasiaTertaut() {
        await database.exec(`
            INSERT INTO arsip (id, unit_kerja_id, jenis_arsip, source_surat_id, tahun, klasifikasi_keamanan, nomor_berkas, uraian_berkas,
                nomor_surat_original, tanggal_surat_original, perihal_original)
            VALUES ('${ARSIP_TERTAUT}','sesditjen','masuk','${SURAT.smRahasia}',2026,'rahasia','B-UJI/2026','${PERIHAL_RAHASIA}',
                'SM-R/2026','2026-09-10','${PERIHAL_RAHASIA}');
            UPDATE surat_masuk SET is_archived = true WHERE id = '${SURAT.smRahasia}';
            INSERT INTO record_access_grants (id, requester_id, target_user_id, entity_type, entity_id, unit_kerja_id, required_classification, purpose, access_mode, status, decided_by, decided_at, decision_reason, expires_at)
            VALUES ${grantRow(GRANT.arsip, 'arsip', ARSIP_TERTAUT, 'rahasia')};
        `);
        return ARSIP_TERTAUT;
    }

    it.each(['biasa', 'terbatas'])('menurunkan ke %s di bawah kelas sumber → 422, kelas tetap', async kelas => {
        const id = await arsipRahasiaTertaut();
        const response = await request(app).put(`/api/arsip/${id}`).set(sebagai(PENGGUNA.tu))
            .send({ klasifikasiKeamanan: kelas }).expect(422);
        expect(response.body.error).toBe('Klasifikasi arsip tidak boleh lebih rendah dari surat sumber');
        expect((await arsipDari(SURAT.smRahasia))[0].klasifikasi_keamanan).toBe('rahasia');
        await request(app).get(`/api/arsip/${id}`).set(sebagai(PENGGUNA.staffSes)).expect(404);
    });

    it('perubahan metadata lain tanpa kelas tetap berhasil', async () => {
        const id = await arsipRahasiaTertaut();
        const response = await request(app).put(`/api/arsip/${id}`).set(sebagai(PENGGUNA.tu))
            .send({ keterangan: 'Koreksi lokasi fisik' }).expect(200);
        expect(response.body.data).toMatchObject({ keterangan: 'Koreksi lokasi fisik', klasifikasiKeamanan: 'rahasia' });
    });
});
