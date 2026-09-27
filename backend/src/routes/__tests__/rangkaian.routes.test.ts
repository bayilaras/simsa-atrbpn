import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Router pakai `../services/...` (relatif dari backend/src/routes/); test ini
// berada di backend/src/routes/__tests__/, sehingga path mock harus `../../services/...`.
// Beberapa berkas sumber memakai ekstensi `.js` pada impornya dan lainnya
// tidak; resolver Vite/Vitest menormalkan keduanya ke berkas .ts yang sama,
// jadi vi.mock di bawah ini efektif untuk kedua gaya impor tersebut.

vi.mock('../../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { id: 'user-1', email: 'user@example.test', role: 'admin_unit', unitKerjaId: 'dir_bppt' };
        next();
    },
}));

vi.mock('../../services/rangkaian-read.service.js', () => ({
    rangkaianReadService: { getDetail: vi.fn(), findRangkaianIdBySurat: vi.fn() },
}));

vi.mock('../../services/record-access.service.js', () => ({
    recordAccessService: { checkRead: vi.fn() },
}));

vi.mock('../../services/audit-log.service.js', () => ({
    default: { logActionOrThrow: vi.fn() },
}));

import { rangkaianReadService } from '../../services/rangkaian-read.service.js';
import { recordAccessService } from '../../services/record-access.service.js';
import auditLogService from '../../services/audit-log.service.js';

const getDetail = rangkaianReadService.getDetail as ReturnType<typeof vi.fn>;
const findRangkaianIdBySurat = rangkaianReadService.findRangkaianIdBySurat as ReturnType<typeof vi.fn>;
const checkRead = recordAccessService.checkRead as ReturnType<typeof vi.fn>;
const logActionOrThrow = auditLogService.logActionOrThrow as ReturnType<typeof vi.fn>;

let app: express.Express;

const RID = '50000000-0000-4000-8000-000000000001';
const FINAL_ID = '50000000-0000-4000-8000-000000000009';
const SID = '30000000-0000-4000-8000-000000000001';

function detail(overrides: Record<string, unknown> = {}) {
    return {
        rangkaian: { id: RID, kode: 'RS-1', status: 'aktif', asal: 'internal', judul: 'Judul', tahun: 2026, unitPencatat: { id: 'sesditjen', nama: 'Sesditjen' }, unitPengolah: null, klasifikasiItemId: null, lanjutanDariId: null, selesaiAt: null, selesaiManual: false, diberkaskanAt: null, createdAt: '2026-01-01T00:00:00.000Z' },
        dialihkanDari: null,
        aksesMelalui: 'owner',
        peserta: [],
        anggota: [],
        relasi: [],
        disposisi: [],
        rangkaianTerkait: [],
        aksiDiizinkan: [],
        truncated: false,
        ...overrides,
    };
}

function readAllowed(overrides: Record<string, unknown> = {}) {
    return {
        exists: true, allowed: true, mutable: false, unitKerjaId: 'sesditjen', classification: 'biasa',
        grantId: null, accessPurpose: null, grantAccessMode: null, grantExpiresAt: null,
        via: 'owner', rangkaianId: null, masked: false,
        ...overrides,
    };
}

beforeEach(async () => {
    vi.clearAllMocks();
    const { default: rangkaianRouter } = await import('../rangkaian.routes');
    app = express();
    app.use(express.json());
    app.use('/api/rangkaian', rangkaianRouter);
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error?.statusCode || 500).json({ error: error?.message }));
});

describe('GET /api/rangkaian/:id — audit sebelum respons, fail-closed', () => {
    it('kegagalan audit menghasilkan 500 tanpa data di body', async () => {
        getDetail.mockResolvedValue(detail({ aksesMelalui: 'pengawas' }));
        logActionOrThrow.mockRejectedValue(new Error('audit_log tidak dapat ditulis'));

        const res = await request(app).get(`/api/rangkaian/${RID}`);

        expect(res.status).toBe(500);
        expect(res.body.data).toBeUndefined();
    });

    it('aksesMelalui owner tidak memicu audit', async () => {
        getDetail.mockResolvedValue(detail({ aksesMelalui: 'owner' }));

        await request(app).get(`/api/rangkaian/${RID}`).expect(200);

        expect(logActionOrThrow).not.toHaveBeenCalled();
    });

    it('aksesMelalui peserta menulis audit sebelum respons dengan via dan dialihkanDari', async () => {
        let auditedBeforeResponse = false;
        logActionOrThrow.mockImplementation(async () => { auditedBeforeResponse = true; });
        getDetail.mockResolvedValue(detail({
            rangkaian: { ...detail().rangkaian, id: FINAL_ID },
            dialihkanDari: { id: RID, kode: 'RS-1' },
            aksesMelalui: 'peserta',
        }));

        const res = await request(app).get(`/api/rangkaian/${RID}`).expect(200);

        expect(auditedBeforeResponse).toBe(true);
        expect(logActionOrThrow).toHaveBeenCalledWith(expect.objectContaining({
            action: 'view_via_rangkaian',
            entityType: 'rangkaian_surat',
            entityId: FINAL_ID,
            changes: expect.objectContaining({ via: 'peserta', rangkaianId: FINAL_ID, dialihkanDari: RID }),
        }));
        expect(res.body.data.rangkaian.id).toBe(FINAL_ID);
    });

    it('rangkaian tidak ditemukan (null dari service) -> 404 tanpa audit', async () => {
        getDetail.mockResolvedValue(null);

        await request(app).get(`/api/rangkaian/${RID}`).expect(404);

        expect(logActionOrThrow).not.toHaveBeenCalled();
    });
});

describe('GET /api/rangkaian/by-surat/:jenis/:suratId — gerbang checkRead sebelum resolusi rangkaian', () => {
    it('surat tak terbaca (checkRead allowed=false) -> 404 tanpa pernah menyentuh rangkaian', async () => {
        checkRead.mockResolvedValue(readAllowed({ allowed: false, exists: true }));

        const res = await request(app).get(`/api/rangkaian/by-surat/surat_masuk/${SID}`).expect(404);

        expect(findRangkaianIdBySurat).not.toHaveBeenCalled();
        expect(getDetail).not.toHaveBeenCalled();
        expect(res.body).toEqual({ success: false, error: 'Surat tidak ditemukan' });
    });

    it('surat soft-deleted (exists tapi allowed=false) menghasilkan 404 identik dengan surat yang benar-benar tidak ada', async () => {
        checkRead.mockResolvedValueOnce(readAllowed({ exists: true, allowed: false }));
        const dihapus = await request(app).get(`/api/rangkaian/by-surat/surat_masuk/${SID}`);

        checkRead.mockResolvedValueOnce(readAllowed({ exists: false, allowed: false }));
        const takAda = await request(app).get(`/api/rangkaian/by-surat/surat_masuk/${SID}`);

        expect(dihapus.status).toBe(404);
        expect(takAda.status).toBe(404);
        expect(dihapus.body).toEqual(takAda.body);
        expect(logActionOrThrow).not.toHaveBeenCalled();
    });

    it('surat terbaca tapi bukan anggota rangkaian apa pun -> 200 data null, checkRead dipanggil lebih dulu', async () => {
        const urutan: string[] = [];
        checkRead.mockImplementation(async () => { urutan.push('checkRead'); return readAllowed(); });
        findRangkaianIdBySurat.mockImplementation(async () => { urutan.push('findRangkaianIdBySurat'); return null; });

        const res = await request(app).get(`/api/rangkaian/by-surat/surat_masuk/${SID}`).expect(200);

        expect(res.body).toEqual({ success: true, data: null });
        expect(urutan).toEqual(['checkRead', 'findRangkaianIdBySurat']);
        expect(getDetail).not.toHaveBeenCalled();
        expect(logActionOrThrow).not.toHaveBeenCalled();
    });

    it('surat anggota rangkaian lintas unit -> audit ditulis dengan entityId rangkaian yang di-resolve', async () => {
        checkRead.mockResolvedValue(readAllowed());
        findRangkaianIdBySurat.mockResolvedValue(RID);
        getDetail.mockResolvedValue(detail({ aksesMelalui: 'pengawas' }));

        await request(app).get(`/api/rangkaian/by-surat/surat_masuk/${SID}`).expect(200);

        expect(logActionOrThrow).toHaveBeenCalledWith(expect.objectContaining({
            action: 'view_via_rangkaian',
            entityType: 'rangkaian_surat',
            entityId: RID,
        }));
    });

    it('kegagalan audit pada by-surat menghasilkan 500 tanpa data di body', async () => {
        checkRead.mockResolvedValue(readAllowed());
        findRangkaianIdBySurat.mockResolvedValue(RID);
        getDetail.mockResolvedValue(detail({ aksesMelalui: 'peserta' }));
        logActionOrThrow.mockRejectedValue(new Error('audit_log tidak dapat ditulis'));

        const res = await request(app).get(`/api/rangkaian/by-surat/surat_masuk/${SID}`);

        expect(res.status).toBe(500);
        expect(res.body.data).toBeUndefined();
    });
});
