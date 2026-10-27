import type { PGlite } from '@electric-sql/pglite';
import express from 'express';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
vi.mock('../middlewares/rate-limiter.middleware', () => ({ ocrLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/blob-storage.service', () => ({
    blobStorageService: { downloadFile: vi.fn(), uploadFile: vi.fn(), uploadUntrustedFile: vi.fn(), deleteFile: vi.fn(), deleteFileGeneration: vi.fn() },
}));
vi.mock('../services/malware-scan-dispatch.service.js', () => ({ scheduleMalwareScanWake: vi.fn() }));

// F1-3: teks OCR (extracted_text) adalah isi berkas. Isi itu hanya boleh
// dicocokkan/dikutip bila check('arsip') mengizinkan baca, dan tidak pernah
// ikut di read model daftar maupun respons turunan arsip.
const ARSIP = {
    rahasia: '62000000-0000-4000-8000-000000000001',
    terbatas: '62000000-0000-4000-8000-000000000002',
    biasa: '62000000-0000-4000-8000-000000000003',
    xyz: '62000000-0000-4000-8000-000000000004',
    sangatRahasiaLama: '62000000-0000-4000-8000-000000000005',
} as const;
const PROBE = { rahasia: 'ZQXRHS', terbatas: 'ZQXTBS', biasa: 'ZQXBSA' } as const;
const GRANT_RAHASIA = '63000000-0000-4000-8000-000000000001';

let database: PGlite;
let app: express.Express;
const sebagai = (user: object) => ({ 'x-uji-pengguna': JSON.stringify(user) });

function kunciBersarang(value: unknown, keys = new Set<string>()): Set<string> {
    if (Array.isArray(value)) value.forEach(item => kunciBersarang(item, keys));
    else if (value && typeof value === 'object' && !(value instanceof Date)) {
        for (const [key, inner] of Object.entries(value)) {
            keys.add(key);
            kunciBersarang(inner, keys);
        }
    }
    return keys;
}

function tanpaIsi(value: unknown) {
    expect(kunciBersarang(value).has('extractedText')).toBe(false);
    expect(JSON.stringify(value)).not.toMatch(/ZQX(RHS|TBS|BSA)/);
}

async function beriGrantRahasia(expiresAt = '2099-01-01T00:00:00Z', decidedAt = '2026-09-01T00:00:00Z') {
    await database.exec(`
        INSERT INTO record_access_grants (id, requester_id, target_user_id, entity_type, entity_id, unit_kerja_id, required_classification, purpose, access_mode, status, decided_by, decided_at, decision_reason, expires_at)
        VALUES ('${GRANT_RAHASIA}','${USER_ID.superAdmin}','${USER_ID.superAdmin}','arsip','${ARSIP.rahasia}','sesditjen','rahasia','Pemeriksaan isi arsip rahasia terverifikasi','view','approved','${USER_ID.approver}','${decidedAt}','Kebutuhan kerja terverifikasi','${expiresAt}');
    `);
}

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    const { default: arsipRouter } = await import('../routes/arsip.routes');
    const { default: searchRouter } = await import('../routes/search.routes');
    const { default: dashboardRouter } = await import('../routes/dashboard.routes');
    app = express();
    app.use(express.json());
    app.use('/api/arsip', arsipRouter);
    app.use('/api/search', searchRouter);
    app.use('/api/dashboard', dashboardRouter);
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error?.statusCode || 500).json({ error: error?.message }));
}, 90_000);
afterAll(async () => { await database?.close(); });
afterEach(() => { vi.restoreAllMocks(); });
beforeEach(async () => {
    await seedRangkaianFixture(database);
    await database.exec(`
        INSERT INTO arsip (id, unit_kerja_id, jenis_arsip, tahun, klasifikasi_keamanan, nomor_berkas, kode_klasifikasi, uraian_berkas, extracted_text) VALUES
            ('${ARSIP.rahasia}','sesditjen','masuk',2026,'rahasia','B-1/2026','HK.01','Uraian berkas rahasia','Dokumen ${PROBE.rahasia} sengketa pertanahan wilayah'),
            ('${ARSIP.terbatas}','sesditjen','masuk',2026,'terbatas','B-2/2026','HK.01','Uraian berkas terbatas','Dokumen ${PROBE.terbatas} sengketa pertanahan wilayah'),
            ('${ARSIP.biasa}','sesditjen','masuk',2026,NULL,'B-3/2026','HK.01','Uraian berkas biasa','Dokumen ${PROBE.biasa} sengketa pertanahan wilayah'),
            ('${ARSIP.xyz}','dir_bppt','masuk',2026,'xyz','B-4/2026','HK.01','Uraian kelas tak dikenal',NULL),
            ('${ARSIP.sangatRahasiaLama}','dir_bppt','masuk',2026,'Sangat Rahasia','B-5/2026','HK.01','Uraian kelas lama',NULL);
    `);
});

describe('read model daftar arsip tanpa isi OCR', () => {
    it.each([
        ['super_admin', PENGGUNA.superAdmin],
        ['admin_unit', PENGGUNA.tu],
        ['staff', PENGGUNA.staffSes],
    ])('GET /api/arsip untuk %s tidak memuat extractedText', async (_label, user) => {
        const response = await request(app).get('/api/arsip').query({ unitKerjaId: 'sesditjen', limit: '100' }).set(sebagai(user)).expect(200);
        expect(response.body.data.length).toBeGreaterThan(0);
        tanpaIsi(response.body);
    });

    it('daftar legal hold memuat baris tanpa isi OCR', async () => {
        await database.exec(`UPDATE arsip SET legal_hold = true, legal_hold_reason = 'Perkara pengadilan berjalan', legal_hold_placed_at = now() WHERE id = '${ARSIP.rahasia}'`);
        const { arsipService } = await import('../services/arsip.service');
        const holds = await arsipService.getLegalHolds('sesditjen', ['biasa', 'terbatas', 'rahasia', 'sangat_rahasia']);
        expect(holds.map(row => row.id)).toEqual([ARSIP.rahasia]);
        tanpaIsi(holds);
    });

    it('proyeksi expiring, lifecycle, kandidat, berita acara, dan daftar penyusutan tidak memilih extractedText', async () => {
        const { arsipService } = await import('../services/arsip.service');
        const { penyusutanService } = await import('../services/penyusutan.service');
        const select = vi.spyOn(holder.db, 'select');
        const kelas = ['biasa', 'terbatas', 'rahasia', 'sangat_rahasia'];
        await arsipService.getExpiring('sesditjen', 30, kelas);
        await arsipService.getLifecycleNotifications('sesditjen', kelas);
        await arsipService.getDisposalCandidates('sesditjen', { securityClassifications: kelas });
        await arsipService.generateDisposalReportData('sesditjen', undefined, kelas);
        await penyusutanService.getCandidates('sesditjen', 'pemusnahan', kelas);
        await penyusutanService.generateDaftarArsipAktif('sesditjen', 2026, kelas);
        await penyusutanService.generateDaftarArsipInaktif('sesditjen', 2026, kelas);
        expect(select.mock.calls.length).toBeGreaterThanOrEqual(7);
        for (const [selection] of select.mock.calls) {
            expect(Object.keys(selection ?? {})).not.toContain('extractedText');
        }
        const lifecycle = await arsipService.getLifecycleNotifications('sesditjen', kelas);
        expect(lifecycle.summary.total).toBe(4);
        tanpaIsi(lifecycle);
    });

    it('detail batch penyusutan, layanan arsip, dan autentikasi tidak memuat isi OCR arsip', async () => {
        const batchId = '64000000-0000-4000-8000-000000000001';
        const layananId = '64000000-0000-4000-8000-000000000002';
        const autentikasiId = '64000000-0000-4000-8000-000000000003';
        await database.exec(`
            INSERT INTO penyusutan_arsip (id, unit_kerja_id, jenis_penyusutan) VALUES ('${batchId}','sesditjen','pemindahan');
            INSERT INTO penyusutan_items (penyusutan_id, arsip_id) VALUES ('${batchId}','${ARSIP.terbatas}');
            INSERT INTO layanan_arsip (id, jenis_layanan, arsip_id, keperluan, diajukan_oleh) VALUES ('${layananId}','penggandaan','${ARSIP.rahasia}','Keperluan uji','${USER_ID.tu}');
            INSERT INTO autentikasi (id, nomor_berita_acara, tanggal_autentikasi, kegiatan, jumlah_arsip) VALUES ('${autentikasiId}','BA-1/2026','2026-10-01','Alih media uji',1);
            INSERT INTO arsip_elektronik (arsip_id, format_file, autentikasi_id) VALUES ('${ARSIP.rahasia}','PDF','${autentikasiId}');
        `);
        const { penyusutanService } = await import('../services/penyusutan.service');
        const { layananArsipService } = await import('../services/layanan-arsip.service');
        const { autentikasiService } = await import('../services/autentikasi.service');

        const batch = await penyusutanService.findById(batchId, 'sesditjen', ['biasa', 'terbatas']);
        expect(batch?.items.map(item => item.arsip.id)).toEqual([ARSIP.terbatas]);
        tanpaIsi(batch);

        const layanan = await layananArsipService.findById(layananId, { unitScope: 'sesditjen', canReviewUnit: true });
        expect(layanan?.arsip.id).toBe(ARSIP.rahasia);
        tanpaIsi(layanan);

        const autentikasi = await autentikasiService.findById(autentikasiId);
        expect(autentikasi?.itemArsip.map(item => item.arsip.uraianBerkas)).toEqual(['Uraian berkas rahasia']);
        tanpaIsi(autentikasi);
    }, 30_000);

    it('QR arsip hanya mengembalikan identitas label dan kelas untuk gerbang rute', async () => {
        const { storageLocationService } = await import('../services/storage-location.service');
        const result = await storageLocationService.generateArsipQRCode(ARSIP.rahasia, 'https://frontend.example.test', 'sesditjen');
        expect(result.arsip).toEqual({ id: ARSIP.rahasia, nomorBerkas: 'B-1/2026', kodeKlasifikasi: 'HK.01', klasifikasiKeamanan: 'rahasia' });
    });
});

describe('pencarian isi OCR bergerbang grant', () => {
    const fulltext = (user: object, q: string) => request(app).get('/api/arsip/search/fulltext')
        .query({ q, unitKerjaId: 'sesditjen' }).set(sebagai(user)).expect(200);
    const konten = (user: object, q: string) => request(app).get('/api/search/content')
        .query({ q }).set(sebagai(user)).expect(200);

    it('super_admin dan admin_unit tanpa grant tidak dapat mencocokkan isi terkendali', async () => {
        for (const [user, probe] of [[PENGGUNA.superAdmin, PROBE.rahasia], [PENGGUNA.tu, PROBE.terbatas]] as const) {
            const cari = await fulltext(user, probe);
            expect(cari.body).toMatchObject({ total: 0, data: [] });
            expect((await konten(user, probe)).body.data).toEqual([]);
            const kata = await request(app).get('/api/arsip/search/keywords')
                .query({ keywords: probe, unitKerjaId: 'sesditjen' }).set(sebagai(user)).expect(200);
            expect(kata.body).toMatchObject({ total: 0, data: [] });
        }
    });

    it('arsip biasa tetap dapat dicari isinya oleh staff unit sendiri', async () => {
        const cari = await fulltext(PENGGUNA.staffSes, PROBE.biasa);
        expect(cari.body.total).toBe(1);
        expect(cari.body.data[0]).toMatchObject({ id: ARSIP.biasa, matchedFields: ['extractedText'] });
        expect(cari.body.data[0].matchSnippet).toContain(PROBE.biasa);
        expect((await konten(PENGGUNA.staffSes, PROBE.biasa)).body.data.map((row: any) => row.id)).toEqual([ARSIP.biasa]);
    });

    it('isi terkendali muncul setelah grant aktif dan hilang lagi setelah grant kedaluwarsa', async () => {
        await beriGrantRahasia();
        const cari = await fulltext(PENGGUNA.superAdmin, PROBE.rahasia);
        expect(cari.body.total).toBe(1);
        expect(cari.body.data[0].highlightedText).toContain(`**${PROBE.rahasia}**`);
        const isi = await konten(PENGGUNA.superAdmin, PROBE.rahasia);
        expect(isi.body.data.map((row: any) => row.id)).toEqual([ARSIP.rahasia]);
        expect(isi.body.data[0].excerpt.toUpperCase()).toContain(PROBE.rahasia);

        await database.exec(`UPDATE record_access_grants SET decided_at = '2025-12-01T00:00:00Z', expires_at = '2026-01-01T00:00:00Z' WHERE id = '${GRANT_RAHASIA}'`);
        expect((await fulltext(PENGGUNA.superAdmin, PROBE.rahasia)).body.total).toBe(0);
        expect((await konten(PENGGUNA.superAdmin, PROBE.rahasia)).body.data).toEqual([]);
    });

    it('metadata terkendali tetap dapat dicari menurut kebijakan list lama, tetapi tanpa cuplikan isi', async () => {
        const cari = await fulltext(PENGGUNA.superAdmin, 'Uraian berkas rahasia');
        expect(cari.body.data.map((row: any) => row.id)).toEqual([ARSIP.rahasia]);
        expect(cari.body.data[0].highlightedText).toBeNull();
        tanpaIsi(cari.body);
    });

    it('arsip terkait hanya mencocokkan isi arsip yang boleh dibaca', async () => {
        const terkait = () => request(app).get(`/api/arsip/${ARSIP.biasa}/related`)
            .query({ unitKerjaId: 'sesditjen' }).set(sebagai(PENGGUNA.superAdmin)).expect(200);
        expect((await terkait()).body.data).toEqual([]);
        await beriGrantRahasia();
        expect((await terkait()).body.data.map((row: any) => row.id)).toEqual([ARSIP.rahasia]);
    });

    it('wildcard LIKE pada kueri diperlakukan sebagai karakter biasa', async () => {
        for (const q of ['%', '_']) {
            expect((await fulltext(PENGGUNA.staffSes, q)).body.total).toBe(0);
        }
        expect((await konten(PENGGUNA.staffSes, '__')).body.data).toEqual([]);
    });
});

describe('supervisi isu kepatuhan', () => {
    it('hanya memuat kelas yang dikenali kebijakan role', async () => {
        const { supervisionService } = await import('../services/supervision.service');
        const { kelasUntukRole } = await import('../services/access/visibility-spec');
        const superAdmin = (await supervisionService.getComplianceIssues(200, kelasUntukRole('super_admin'))).map(row => row.id);
        expect(superAdmin).toContain(ARSIP.sangatRahasiaLama);
        expect(superAdmin).toContain(ARSIP.rahasia);
        expect(superAdmin).not.toContain(ARSIP.xyz);
        const admin = (await supervisionService.getComplianceIssues(200, kelasUntukRole('admin_unit'))).map(row => row.id);
        expect(admin).toEqual(expect.arrayContaining([ARSIP.terbatas, ARSIP.biasa]));
        expect(admin).not.toContain(ARSIP.rahasia);
        expect(admin).not.toContain(ARSIP.sangatRahasiaLama);
    });
});

describe('batas parameter dasbor', () => {
    it.each(['-5', 'abc', '999999'])('daysAhead=%s tidak menghasilkan 500', async daysAhead => {
        await request(app).get('/api/dashboard/expiring').query({ daysAhead }).set(sebagai(PENGGUNA.tu)).expect(200);
        await request(app).get('/api/arsip/expiring').query({ daysAhead }).set(sebagai(PENGGUNA.tu)).expect(200);
    });

    it.each(['0', 'abc', '999999'])('limit recent=%s tidak menghasilkan 500', async limit => {
        await request(app).get('/api/dashboard/recent').query({ limit }).set(sebagai(PENGGUNA.tu)).expect(200);
    });
});
