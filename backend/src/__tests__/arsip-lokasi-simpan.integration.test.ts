import type { PGlite } from '@electric-sql/pglite';
import express from 'express';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import {
    PESAN_BOKS_TUJUAN_SEDANG_DIPINJAM,
    PESAN_LOKASI_ARSIP_SEDANG_DIPINJAM,
    PESAN_LOKASI_SIMPAN_TIDAK_SESUAI,
} from '../constants/pesan-akses';
import {
    PESAN_LOKASI_ARSIP_DI_LUAR_KEWENANGAN,
    PESAN_LOKASI_ARSIP_SUDAH_DISUSUTKAN,
    PESAN_LOKASI_MASIH_MENYIMPAN_ARSIP,
} from '../services/storage-location.service';
import { bolehMemakaiLokasiUnit } from '../utils/record-unit-scope';
import { ARSIP_TERBATAS, PENGGUNA, SURAT, USER_ID, bootRangkaianDatabase, seedRangkaianFixture } from './helpers/rangkaian-pglite';

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

// Lokasi simpan (gedung/ruang/rak/boks) ditautkan ke arsip lewat
// arsip.storage_location_id; jumlah arsip per lokasi dihitung dari tabel arsip
// dengan saringan unit dan kelas yang sama dengan daftar arsip.
const LOKASI = {
    gedung: '70000000-0000-4000-8000-000000000001',
    ruang: '70000000-0000-4000-8000-000000000002',
    rak: '70000000-0000-4000-8000-000000000003',
    boks1: '70000000-0000-4000-8000-000000000004',
    boks2: '70000000-0000-4000-8000-000000000005',
    gedungBppt: '70000000-0000-4000-8000-000000000006',
} as const;
const ARSIP = {
    biasaMasuk: '71000000-0000-4000-8000-000000000001',
    biasaKeluar: '71000000-0000-4000-8000-000000000002',
    rahasia: '71000000-0000-4000-8000-000000000003',
    biasaDiRak: '71000000-0000-4000-8000-000000000004',
    tanpaLokasi: '71000000-0000-4000-8000-000000000005',
} as const;
const TIDAK_ADA = '79000000-0000-4000-8000-000000000009';

let database: PGlite;
let app: express.Express;
const sebagai = (user: object) => ({ 'x-uji-pengguna': JSON.stringify(user) });

function registrasi(extra: Record<string, unknown> = {}) {
    return {
        nomorBerkas: 'B-LOKASI/2026',
        kodeKlasifikasi: 'KU.01',
        jraKode: 'F.UJI',
        uraianBerkas: 'Berkas uji lokasi simpan',
        unitPengolah: 'SekDitjen',
        kurunWaktu: '2026',
        tanggalArsip: '2026-09-10',
        nomorItem: '1',
        uraianItem: 'Item uji lokasi simpan',
        tingkatPerkembangan: 'Asli',
        jumlah: 1,
        items: [{ nomor: '1', uraian: 'Item uji lokasi simpan', perkembangan: 'Asli', tanggal: '2026-09-10', jumlah: 1 }],
        ...extra,
    };
}

async function statusPinjam(id: string): Promise<string | null> {
    return (await database.query<any>('SELECT lending_status FROM arsip WHERE id = $1', [id])).rows[0]?.lending_status ?? null;
}

// Izin kelola per rekod bagi pengguna unit lain (pola baris grant fixture).
async function beriIzinKelola(grantId: string, userId: string, entityType: string, entityId: string, unitKerjaId: string) {
    await database.exec(`
        INSERT INTO record_access_grants (id, requester_id, target_user_id, entity_type, entity_id, unit_kerja_id, required_classification, purpose, access_mode, status, decided_by, decided_at, decision_reason, expires_at)
        VALUES ('${grantId}','${userId}','${userId}','${entityType}','${entityId}','${unitKerjaId}','terbatas','Uji izin kelola lintas unit','manage','approved','${USER_ID.approver}','2026-09-01T00:00:00Z','Kebutuhan kerja terverifikasi','2099-01-01T00:00:00Z');
    `);
}

async function pinjamBoks(storageLocationId: string) {
    const { archiveLendingService } = await import('../services/archive-lending.service');
    return archiveLendingService.borrow({
        lendingType: 'box', storageLocationId, borrowerId: USER_ID.tu, borrowerName: 'Peminjam Uji', dueDate: '2099-01-01',
    }, 'sesditjen');
}

function tiruAturanArsip() {
    beforeEach(async () => {
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
}

async function lokasiArsip(id: string): Promise<string | null> {
    return (await database.query<any>('SELECT storage_location_id FROM arsip WHERE id = $1', [id])).rows[0]?.storage_location_id ?? null;
}

function cari(nodes: any[], id: string): any {
    for (const node of nodes) {
        if (node.id === id) return node;
        const anak = cari(node.children || [], id);
        if (anak) return anak;
    }
    return null;
}

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    const { default: suratMasukRouter } = await import('../routes/surat-masuk.routes');
    const { default: suratKeluarRouter } = await import('../routes/surat-keluar.routes');
    const { default: arsipRouter } = await import('../routes/arsip.routes');
    const { default: lokasiRouter } = await import('../routes/storage-location.routes');
    app = express();
    app.use(express.json());
    app.use('/api/surat-masuk', suratMasukRouter);
    app.use('/api/surat-keluar', suratKeluarRouter);
    app.use('/api/arsip', arsipRouter);
    app.use('/api/storage-locations', lokasiRouter);
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error?.statusCode || 500).json({ error: error?.message }));
}, 90_000);
afterAll(async () => { await database?.close(); });
afterEach(() => { vi.restoreAllMocks(); });
beforeEach(async () => {
    await database.exec('TRUNCATE storage_locations CASCADE;');
    await seedRangkaianFixture(database);
    await database.exec(`
        INSERT INTO storage_locations (id, unit_kerja_id, code, name, level, parent_id, capacity) VALUES
            ('${LOKASI.gedung}','sesditjen','G1','Gedung Arsip','gedung',NULL,NULL),
            ('${LOKASI.ruang}','sesditjen','G1-R1','Ruang Sentral','ruang','${LOKASI.gedung}',NULL),
            ('${LOKASI.rak}','sesditjen','G1-R1-RAK1','Rak Satu','rak','${LOKASI.ruang}',NULL),
            ('${LOKASI.boks1}','sesditjen','G1-R1-RAK1-B1','Boks Satu','box','${LOKASI.rak}',10),
            ('${LOKASI.boks2}','sesditjen','G1-R1-RAK1-B2','Boks Dua','box','${LOKASI.rak}',10),
            ('${LOKASI.gedungBppt}','dir_bppt','G1','Gedung BPPT','gedung',NULL,NULL);
        INSERT INTO arsip (id, unit_kerja_id, jenis_arsip, tahun, klasifikasi_keamanan, keterangan, storage_location_id) VALUES
            ('${ARSIP.biasaMasuk}','sesditjen','masuk',2026,'biasa','Biasa masuk di boks 1','${LOKASI.boks1}'),
            ('${ARSIP.biasaKeluar}','sesditjen','keluar',2026,'biasa','Biasa keluar di boks 1','${LOKASI.boks1}'),
            ('${ARSIP.rahasia}','sesditjen','masuk',2026,'rahasia','Rahasia di boks 1','${LOKASI.boks1}'),
            ('${ARSIP.biasaDiRak}','sesditjen','masuk',2026,'biasa','Biasa langsung di rak','${LOKASI.rak}'),
            ('${ARSIP.tanpaLokasi}','sesditjen','masuk',2026,'biasa','Belum punya lokasi',NULL);
        UPDATE arsip SET storage_location_id='${LOKASI.boks1}' WHERE id='${ARSIP_TERBATAS}';
    `);
});

describe('PUT /api/arsip/:id menyimpan lokasi simpan', () => {
    it('menautkan lokasi unit sendiri, mencatatnya di log audit, dan menampilkan jalurnya di detail', async () => {
        await request(app).put(`/api/arsip/${ARSIP.tanpaLokasi}`).set(sebagai(PENGGUNA.tu))
            .send({ storageLocationId: LOKASI.boks2 }).expect(200);
        expect(await lokasiArsip(ARSIP.tanpaLokasi)).toBe(LOKASI.boks2);

        const audit = (await database.query<any>(
            `SELECT changes FROM audit_log WHERE entity_type='arsip' AND entity_id=$1 AND action='update'`, [ARSIP.tanpaLokasi],
        )).rows;
        expect(audit).toHaveLength(1);
        expect(audit[0].changes.fields).toEqual(['storageLocationId']);
        expect(audit[0].changes.before.storageLocationId).toBeNull();
        expect(audit[0].changes.after.storageLocationId).toBe(LOKASI.boks2);

        const detail = await request(app).get(`/api/arsip/${ARSIP.tanpaLokasi}`).set(sebagai(PENGGUNA.tu)).expect(200);
        expect(detail.body.data.lokasiSimpan).toMatchObject({ id: LOKASI.boks2, code: 'G1-R1-RAK1-B2', name: 'Boks Dua', level: 'box' });
        expect(detail.body.data.lokasiSimpan.jalur.map((lokasi: any) => lokasi.name))
            .toEqual(['Gedung Arsip', 'Ruang Sentral', 'Rak Satu', 'Boks Dua']);
    });

    it('detail arsip tanpa lokasi mengembalikan lokasiSimpan null', async () => {
        const detail = await request(app).get(`/api/arsip/${ARSIP.tanpaLokasi}`).set(sebagai(PENGGUNA.tu)).expect(200);
        expect(detail.body.data.lokasiSimpan).toBeNull();
    });

    it.each([
        ['lokasi unit lain', LOKASI.gedungBppt],
        ['lokasi yang tidak ada', TIDAK_ADA],
    ])('menolak %s tanpa mengubah arsip', async (_kasus, storageLocationId) => {
        const response = await request(app).put(`/api/arsip/${ARSIP.tanpaLokasi}`).set(sebagai(PENGGUNA.tu))
            .send({ storageLocationId }).expect(400);
        expect(response.body.error).toBe(PESAN_LOKASI_SIMPAN_TIDAK_SESUAI);
        expect(await lokasiArsip(ARSIP.tanpaLokasi)).toBeNull();
        expect((await database.query(`SELECT id FROM audit_log WHERE entity_id='${ARSIP.tanpaLokasi}'`)).rows).toHaveLength(0);
    });

    it('super admin hanya dapat memakai lokasi milik unit arsipnya', async () => {
        await request(app).put(`/api/arsip/${ARSIP.tanpaLokasi}`).set(sebagai(PENGGUNA.superAdmin))
            .send({ storageLocationId: LOKASI.gedungBppt }).expect(400);
        expect(await lokasiArsip(ARSIP.tanpaLokasi)).toBeNull();
        await request(app).put(`/api/arsip/${ARSIP.tanpaLokasi}`).set(sebagai(PENGGUNA.superAdmin))
            .send({ storageLocationId: LOKASI.rak }).expect(200);
        expect(await lokasiArsip(ARSIP.tanpaLokasi)).toBe(LOKASI.rak);
    });

    it('null melepas arsip dari lokasinya', async () => {
        await request(app).put(`/api/arsip/${ARSIP.biasaMasuk}`).set(sebagai(PENGGUNA.tu))
            .send({ storageLocationId: null }).expect(200);
        expect(await lokasiArsip(ARSIP.biasaMasuk)).toBeNull();
    });

    it('menolak nilai yang bukan UUID', async () => {
        await request(app).put(`/api/arsip/${ARSIP.tanpaLokasi}`).set(sebagai(PENGGUNA.tu))
            .send({ storageLocationId: 'G1' }).expect(400);
        expect(await lokasiArsip(ARSIP.tanpaLokasi)).toBeNull();
    });
});

describe('bolehMemakaiLokasiUnit', () => {
    const req = (user: object) => ({ user, query: {} }) as any;
    it('hanya unit sendiri atau super admin', () => {
        expect(bolehMemakaiLokasiUnit(req(PENGGUNA.tu), 'sesditjen')).toBe(true);
        expect(bolehMemakaiLokasiUnit(req(PENGGUNA.tu), 'dir_bppt')).toBe(false);
        expect(bolehMemakaiLokasiUnit(req(PENGGUNA.bppt), 'sesditjen')).toBe(false);
        expect(bolehMemakaiLokasiUnit(req(PENGGUNA.superAdmin), 'dir_bppt')).toBe(true);
        expect(bolehMemakaiLokasiUnit(req({ role: 'user', unitKerjaId: 'sesditjen' }), 'sesditjen')).toBe(false);
    });
});

describe('POST /api/surat-masuk/:id/archive-full dengan lokasi simpan', () => {
    tiruAturanArsip();

    it('menyimpan lokasi pada arsip baru dan mencatatnya di log audit', async () => {
        await request(app).post(`/api/surat-masuk/${SURAT.smTunggal}/archive-full`).set(sebagai(PENGGUNA.tu))
            .send(registrasi({ storageLocationId: LOKASI.boks2 })).expect(200);
        const [row] = (await database.query<any>(
            'SELECT id, storage_location_id FROM arsip WHERE source_surat_id = $1', [SURAT.smTunggal],
        )).rows;
        expect(row.storage_location_id).toBe(LOKASI.boks2);
        const [audit] = (await database.query<any>(
            `SELECT changes FROM audit_log WHERE entity_type='arsip' AND entity_id=$1 AND action='create'`, [row.id],
        )).rows;
        expect(audit.changes.after.storageLocationId).toBe(LOKASI.boks2);
    });

    it('tanpa lokasi tetap dapat diarsipkan', async () => {
        await request(app).post(`/api/surat-masuk/${SURAT.smTunggal}/archive-full`).set(sebagai(PENGGUNA.tu))
            .send(registrasi()).expect(200);
        const [row] = (await database.query<any>(
            'SELECT storage_location_id FROM arsip WHERE source_surat_id = $1', [SURAT.smTunggal],
        )).rows;
        expect(row.storage_location_id).toBeNull();
    });

    it('menolak lokasi unit lain: tidak ada arsip dan surat tetap belum diarsipkan', async () => {
        const response = await request(app).post(`/api/surat-masuk/${SURAT.smTunggal}/archive-full`).set(sebagai(PENGGUNA.tu))
            .send(registrasi({ storageLocationId: LOKASI.gedungBppt })).expect(400);
        expect(response.body.error).toBe(PESAN_LOKASI_SIMPAN_TIDAK_SESUAI);
        expect((await database.query('SELECT id FROM arsip WHERE source_surat_id = $1', [SURAT.smTunggal])).rows).toHaveLength(0);
        const [surat] = (await database.query<any>('SELECT is_archived FROM surat_masuk WHERE id = $1', [SURAT.smTunggal])).rows;
        expect(surat.is_archived).toBe(false);
    });
});

describe('POST /api/surat-keluar/:id/archive-full dengan lokasi simpan', () => {
    tiruAturanArsip();
    beforeEach(async () => {
        await database.exec(`UPDATE surat_keluar SET approval_status = 'approved' WHERE id = '${SURAT.skBpptTunggal}'`);
    });

    it('menyimpan lokasi pada arsip baru dan mencatatnya di log audit', async () => {
        await request(app).post(`/api/surat-keluar/${SURAT.skBpptTunggal}/archive-full`).set(sebagai(PENGGUNA.bppt))
            .send(registrasi({ storageLocationId: LOKASI.gedungBppt })).expect(200);
        const [row] = (await database.query<any>(
            'SELECT id, jenis_arsip, storage_location_id FROM arsip WHERE source_surat_id = $1', [SURAT.skBpptTunggal],
        )).rows;
        expect(row).toMatchObject({ jenis_arsip: 'keluar', storage_location_id: LOKASI.gedungBppt });
        const [audit] = (await database.query<any>(
            `SELECT changes FROM audit_log WHERE entity_type='arsip' AND entity_id=$1 AND action='create'`, [row.id],
        )).rows;
        expect(audit.changes.after.storageLocationId).toBe(LOKASI.gedungBppt);
    });

    it('menolak lokasi unit lain: tidak ada arsip dan surat tetap belum diarsipkan', async () => {
        const response = await request(app).post(`/api/surat-keluar/${SURAT.skBpptTunggal}/archive-full`).set(sebagai(PENGGUNA.bppt))
            .send(registrasi({ storageLocationId: LOKASI.boks1 })).expect(400);
        expect(response.body.error).toBe(PESAN_LOKASI_SIMPAN_TIDAK_SESUAI);
        expect((await database.query('SELECT id FROM arsip WHERE source_surat_id = $1', [SURAT.skBpptTunggal])).rows).toHaveLength(0);
        const [surat] = (await database.query<any>('SELECT is_archived FROM surat_keluar WHERE id = $1', [SURAT.skBpptTunggal])).rows;
        expect(surat.is_archived).toBe(false);
    });
});

// Izin kelola per rekod tidak membuka jalur tulis bagi pengguna unit lain:
// permintaan berhenti di pemeriksaan akses, sebelum lokasi simpan diperiksa.
describe('pemegang izin kelola dari unit lain tidak mengubah lokasi simpan', () => {
    tiruAturanArsip();
    const GRANT_UJI = '72000000-0000-4000-8000-000000000001';

    it('PUT arsip: lokasi tidak dapat diganti maupun dilepas', async () => {
        await beriIzinKelola(GRANT_UJI, USER_ID.bppt, 'arsip', ARSIP.biasaMasuk, 'sesditjen');
        for (const storageLocationId of [LOKASI.boks2, LOKASI.gedungBppt, null]) {
            await request(app).put(`/api/arsip/${ARSIP.biasaMasuk}`).set(sebagai(PENGGUNA.bppt))
                .send({ storageLocationId }).expect(404);
        }
        expect(await lokasiArsip(ARSIP.biasaMasuk)).toBe(LOKASI.boks1);
        expect((await database.query(`SELECT id FROM audit_log WHERE entity_id='${ARSIP.biasaMasuk}'`)).rows).toHaveLength(0);
    });

    it('archive-full surat masuk dengan lokasi tidak mengarsipkan surat', async () => {
        await beriIzinKelola(GRANT_UJI, USER_ID.bppt, 'surat_masuk', SURAT.smTunggal, 'sesditjen');
        await request(app).post(`/api/surat-masuk/${SURAT.smTunggal}/archive-full`).set(sebagai(PENGGUNA.bppt))
            .send(registrasi({ storageLocationId: LOKASI.boks2 })).expect(404);
        expect((await database.query('SELECT id FROM arsip WHERE source_surat_id = $1', [SURAT.smTunggal])).rows).toHaveLength(0);
    });

    it('archive-full surat keluar dengan lokasi tidak mengarsipkan surat', async () => {
        // Fixture: PENGGUNA.tu memegang izin kelola atas skBpptNull milik dir_bppt.
        await database.exec(`UPDATE surat_keluar SET approval_status = 'approved' WHERE id = '${SURAT.skBpptNull}'`);
        await request(app).post(`/api/surat-keluar/${SURAT.skBpptNull}/archive-full`).set(sebagai(PENGGUNA.tu))
            .send(registrasi({ storageLocationId: LOKASI.gedungBppt })).expect(404);
        expect((await database.query('SELECT id FROM arsip WHERE source_surat_id = $1', [SURAT.skBpptNull])).rows).toHaveLength(0);
    });

    it('admin dengan unit dari peran tetap dapat melepas lokasi arsip unitnya', async () => {
        await request(app).put(`/api/arsip/${ARSIP.biasaMasuk}`).set(sebagai(PENGGUNA.adminSesNull))
            .send({ storageLocationId: null }).expect(200);
        expect(await lokasiArsip(ARSIP.biasaMasuk)).toBeNull();
    });
});

// Peminjaman per boks menandai dan mengembalikan arsip lewat tautan lokasinya,
// jadi tautan itu tidak boleh berubah selama arsip atau boksnya dipinjam.
describe('lokasi simpan dan peminjaman', () => {
    tiruAturanArsip();

    it('arsip di boks yang dipinjam tidak dapat dipindah atau dilepas sampai boks dikembalikan', async () => {
        const pinjaman = await pinjamBoks(LOKASI.boks1);
        expect(await statusPinjam(ARSIP.biasaMasuk)).toBe('borrowed');
        for (const storageLocationId of [LOKASI.boks2, null]) {
            const response = await request(app).put(`/api/arsip/${ARSIP.biasaMasuk}`).set(sebagai(PENGGUNA.tu))
                .send({ storageLocationId }).expect(409);
            expect(response.body.error).toBe(PESAN_LOKASI_ARSIP_SEDANG_DIPINJAM);
        }
        expect(await lokasiArsip(ARSIP.biasaMasuk)).toBe(LOKASI.boks1);
        // Metadata lain tetap dapat dikoreksi selama dipinjam.
        await request(app).put(`/api/arsip/${ARSIP.biasaMasuk}`).set(sebagai(PENGGUNA.tu))
            .send({ keterangan: 'Koreksi saat dipinjam' }).expect(200);

        const { archiveLendingService } = await import('../services/archive-lending.service');
        await archiveLendingService.return(pinjaman.id, 'sesditjen');
        expect(await statusPinjam(ARSIP.biasaMasuk)).toBe('available');
        await request(app).put(`/api/arsip/${ARSIP.biasaMasuk}`).set(sebagai(PENGGUNA.tu))
            .send({ storageLocationId: LOKASI.boks2 }).expect(200);
        expect(await lokasiArsip(ARSIP.biasaMasuk)).toBe(LOKASI.boks2);
        expect(await statusPinjam(ARSIP.biasaMasuk)).toBe('available');
    });

    it('arsip tidak dapat dimasukkan ke boks yang sedang dipinjam', async () => {
        await pinjamBoks(LOKASI.boks1);
        const response = await request(app).put(`/api/arsip/${ARSIP.tanpaLokasi}`).set(sebagai(PENGGUNA.tu))
            .send({ storageLocationId: LOKASI.boks1 }).expect(409);
        expect(response.body.error).toBe(PESAN_BOKS_TUJUAN_SEDANG_DIPINJAM);
        expect(await lokasiArsip(ARSIP.tanpaLokasi)).toBeNull();
        expect(await statusPinjam(ARSIP.tanpaLokasi)).toBe('available');
    });

    it('surat tidak dapat diarsipkan ke boks yang sedang dipinjam', async () => {
        await pinjamBoks(LOKASI.boks1);
        const response = await request(app).post(`/api/surat-masuk/${SURAT.smTunggal}/archive-full`).set(sebagai(PENGGUNA.tu))
            .send(registrasi({ storageLocationId: LOKASI.boks1 })).expect(409);
        expect(response.body.error).toBe(PESAN_BOKS_TUJUAN_SEDANG_DIPINJAM);
        expect((await database.query('SELECT id FROM arsip WHERE source_surat_id = $1', [SURAT.smTunggal])).rows).toHaveLength(0);
        const [surat] = (await database.query<any>('SELECT is_archived FROM surat_masuk WHERE id = $1', [SURAT.smTunggal])).rows;
        expect(surat.is_archived).toBe(false);
    });

    it('arsip yang dipinjam sendiri tidak dapat dipindah lokasinya', async () => {
        const { archiveLendingService } = await import('../services/archive-lending.service');
        await archiveLendingService.borrow({
            lendingType: 'arsip', arsipId: ARSIP.biasaDiRak, borrowerId: USER_ID.tu, borrowerName: 'Peminjam Uji', dueDate: '2099-01-01',
        }, 'sesditjen');
        const response = await request(app).put(`/api/arsip/${ARSIP.biasaDiRak}`).set(sebagai(PENGGUNA.tu))
            .send({ storageLocationId: LOKASI.boks2 }).expect(409);
        expect(response.body.error).toBe(PESAN_LOKASI_ARSIP_SEDANG_DIPINJAM);
        expect(await lokasiArsip(ARSIP.biasaDiRak)).toBe(LOKASI.rak);
    });
});

describe('jumlah arsip per lokasi mengikuti unit dan plafon kelas pembaca', () => {
    // Boks 1: 2 Biasa (masuk + keluar), 1 Terbatas, 1 Rahasia. Rak: 1 Biasa langsung.
    it.each([
        ['staff (Biasa)', PENGGUNA.staffSes, { boks1: 2, rak: 3, masuk: 2, keluar: 1 }],
        ['admin unit (Biasa + Terbatas)', PENGGUNA.tu, { boks1: 3, rak: 4, masuk: 3, keluar: 1 }],
        ['super admin (semua kelas)', PENGGUNA.superAdmin, { boks1: 4, rak: 5, masuk: 4, keluar: 1 }],
    ])('pohon lokasi untuk %s', async (_kasus, user, harapan) => {
        const response = await request(app).get('/api/storage-locations/tree?unitKerjaId=sesditjen').set(sebagai(user)).expect(200);
        const boks1 = cari(response.body.data, LOKASI.boks1);
        const boks2 = cari(response.body.data, LOKASI.boks2);
        const rak = cari(response.body.data, LOKASI.rak);
        const gedung = cari(response.body.data, LOKASI.gedung);
        expect(boks1).toMatchObject({ currentCount: harapan.boks1, arsipCount: harapan.boks1 });
        expect(boks2).toMatchObject({ currentCount: 0, arsipCount: 0 });
        expect(rak).toMatchObject({ currentCount: 1, arsipCount: harapan.rak });
        expect(gedung).toMatchObject({
            currentCount: 0, arsipCount: harapan.rak, arsipMasukCount: harapan.masuk, arsipKeluarCount: harapan.keluar,
        });
    });

    it('detail dan daftar lokasi memakai hitungan yang sama', async () => {
        const detail = await request(app).get(`/api/storage-locations/${LOKASI.gedung}`).set(sebagai(PENGGUNA.staffSes)).expect(200);
        expect(detail.body.data).toMatchObject({ id: LOKASI.gedung, currentCount: 0, arsipCount: 3 });
        const daftar = await request(app).get('/api/storage-locations?level=box').set(sebagai(PENGGUNA.staffSes)).expect(200);
        expect(daftar.body.data.map((lokasi: any) => [lokasi.code, lokasi.currentCount]))
            .toEqual([['G1-R1-RAK1-B1', 2], ['G1-R1-RAK1-B2', 0]]);
    });

    it('nilai kolom current_count yang tersimpan tidak dipakai', async () => {
        await database.exec(`UPDATE storage_locations SET current_count = 99 WHERE id = '${LOKASI.boks2}'`);
        const response = await request(app).get('/api/storage-locations/tree').set(sebagai(PENGGUNA.tu)).expect(200);
        expect(cari(response.body.data, LOKASI.boks2).currentCount).toBe(0);
    });
});

describe('GET /api/arsip?storageLocationId menyaring dengan aturan daftar biasa', () => {
    const ids = (response: request.Response) => response.body.data.map((row: any) => row.id).sort();

    it('mencakup sub-lokasi dan hanya kelas yang boleh dilihat pembaca', async () => {
        const staff = await request(app).get(`/api/arsip?storageLocationId=${LOKASI.gedung}`).set(sebagai(PENGGUNA.staffSes)).expect(200);
        expect(ids(staff)).toEqual([ARSIP.biasaMasuk, ARSIP.biasaKeluar, ARSIP.biasaDiRak].sort());
        expect(staff.body.pagination.total).toBe(3);

        const tu = await request(app).get(`/api/arsip?storageLocationId=${LOKASI.boks1}&jenisSurat=masuk`).set(sebagai(PENGGUNA.tu)).expect(200);
        expect(ids(tu)).toEqual([ARSIP_TERBATAS, ARSIP.biasaMasuk].sort());
    });

    it('jumlah di pohon lokasi sama dengan jumlah baris daftar arsip', async () => {
        for (const user of [PENGGUNA.staffSes, PENGGUNA.tu, PENGGUNA.superAdmin]) {
            const pohon = await request(app).get('/api/storage-locations/tree?unitKerjaId=sesditjen').set(sebagai(user)).expect(200);
            const daftar = await request(app).get(`/api/arsip?unitKerjaId=sesditjen&storageLocationId=${LOKASI.gedung}`).set(sebagai(user)).expect(200);
            expect(daftar.body.pagination.total).toBe(cari(pohon.body.data, LOKASI.gedung).arsipCount);
        }
    });

    it('unit lain tidak memperoleh arsip lewat id lokasi', async () => {
        const response = await request(app).get(`/api/arsip?storageLocationId=${LOKASI.boks1}`).set(sebagai(PENGGUNA.bppt)).expect(200);
        expect(response.body.data).toEqual([]);
        expect(response.body.pagination.total).toBe(0);
    });
});

describe('DELETE /api/storage-locations/:id', () => {
    const masihAda = async (id: string) =>
        (await database.query(`SELECT id FROM storage_locations WHERE id='${id}'`)).rows.length === 1;

    it('menolak lokasi yang masih menyimpan arsip', async () => {
        const response = await request(app).delete(`/api/storage-locations/${LOKASI.boks1}`).set(sebagai(PENGGUNA.tu)).expect(409);
        expect(response.body.error).toBe(PESAN_LOKASI_MASIH_MENYIMPAN_ARSIP);
        expect(await masihAda(LOKASI.boks1)).toBe(true);
    });

    it('arsip di luar plafon kelas penghapus tetap menahan lokasi, tanpa menyuruh memindahkannya', async () => {
        await database.exec(`UPDATE arsip SET storage_location_id = NULL WHERE id <> '${ARSIP.rahasia}'`);
        const response = await request(app).delete(`/api/storage-locations/${LOKASI.boks1}`).set(sebagai(PENGGUNA.tu)).expect(409);
        expect(response.body.error).toBe(PESAN_LOKASI_ARSIP_DI_LUAR_KEWENANGAN);
        expect(await masihAda(LOKASI.boks1)).toBe(true);

        const superAdmin = await request(app).delete(`/api/storage-locations/${LOKASI.boks1}?unitKerjaId=sesditjen`)
            .set(sebagai(PENGGUNA.superAdmin)).expect(409);
        expect(superAdmin.body.error).toBe(PESAN_LOKASI_MASIH_MENYIMPAN_ARSIP);
    });

    it('arsip yang penyusutannya sudah dilaksanakan menahan lokasi dengan keterangan yang sesuai', async () => {
        await database.exec(`
            UPDATE arsip SET storage_location_id = NULL WHERE id <> '${ARSIP.biasaMasuk}';
            UPDATE arsip SET disposal_status = 'executed' WHERE id = '${ARSIP.biasaMasuk}';
        `);
        const response = await request(app).delete(`/api/storage-locations/${LOKASI.boks1}`).set(sebagai(PENGGUNA.tu)).expect(409);
        expect(response.body.error).toBe(PESAN_LOKASI_ARSIP_SUDAH_DISUSUTKAN);
        expect(await masihAda(LOKASI.boks1)).toBe(true);
    });

    it('menghapus lokasi kosong', async () => {
        await request(app).delete(`/api/storage-locations/${LOKASI.boks2}`).set(sebagai(PENGGUNA.tu)).expect(200);
        expect((await database.query(`SELECT id FROM storage_locations WHERE id='${LOKASI.boks2}'`)).rows).toHaveLength(0);
    });
});

describe('dashboard: isi boks dihitung dari arsip', () => {
    it.each([
        ['staff', ['biasa'], 2],
        ['admin unit', ['biasa', 'terbatas'], 3],
    ])('kapasitas gedung untuk %s', async (_kasus, kelas, isi) => {
        const { dashboardService } = await import('../services/dashboard.service');
        const data: any = await dashboardService.getWidgetData('sesditjen', kelas);
        expect(data.storageCapacity).toEqual([
            expect.objectContaining({ id: LOKASI.gedung, totalCapacity: 20, boxCount: 2, currentCount: isi, usagePercent: Math.round((isi / 20) * 100) }),
        ]);
    });
});
