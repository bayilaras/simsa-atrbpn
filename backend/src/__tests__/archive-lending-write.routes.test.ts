import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jakartaDate } from '../utils/jakarta-date';

// Rute tulis peminjaman: sesi dan hak tulis lebih dulu, lalu validasi, baru
// pembatas laju. Isian yang ditolak tidak boleh memakai kuota operasi sensitif.
const mocks = vi.hoisted(() => ({
    user: { id: 'qa-admin', role: 'admin_unit', unitKerjaId: 'ditjen' as string | null, email: 'qa@example.test' },
    limiter: vi.fn((_req: any, _res: any, next: any) => next()),
    service: { borrow: vi.fn(), return: vi.fn(), extend: vi.fn() },
}));
vi.mock('../middlewares/auth.middleware', () => ({ authMiddleware: (req: any, _res: any, next: any) => { req.user = { ...mocks.user }; next(); } }));
vi.mock('../middlewares/rate-limiter.middleware', () => ({ sensitiveLimiter: mocks.limiter }));
vi.mock('../services/archive-lending.service', () => ({ archiveLendingService: mocks.service }));
vi.mock('../services/storage-location.service', () => ({ storageLocationService: {} }));
import router from '../routes/archive-lending.routes';

const app = express();
app.use(express.json());
app.use('/lending', router);

const arsipId = '11111111-1111-4111-8111-111111111111';
const loanId = '33333333-3333-4333-8333-333333333331';
function geserHari(tanggal: string, hari: number): string {
    const waktu = new Date(`${tanggal}T00:00:00.000Z`);
    waktu.setUTCDate(waktu.getUTCDate() + hari);
    return waktu.toISOString().slice(0, 10);
}
const hariIni = () => jakartaDate();
const badan = (extra: Record<string, unknown> = {}) => ({
    lendingType: 'arsip', arsipId, borrowerName: 'Peminjam Uji', dueDate: geserHari(hariIni(), 7), ...extra,
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { id: 'qa-admin', role: 'admin_unit', unitKerjaId: 'ditjen', email: 'qa@example.test' };
    mocks.service.borrow.mockResolvedValue({ id: loanId });
    mocks.service.return.mockResolvedValue({ id: loanId, status: 'returned' });
    mocks.service.extend.mockResolvedValue({ id: loanId });
});

describe('POST /borrow', () => {
    it('a valid loan passes the limiter once and carries the caller class ceiling', async () => {
        await request(app).post('/lending/borrow').send(badan()).expect(201);
        expect(mocks.limiter).toHaveBeenCalledTimes(1);
        expect(mocks.service.borrow).toHaveBeenCalledWith(
            expect.objectContaining({ lendingType: 'arsip', arsipId, borrowerId: 'qa-admin' }),
            'ditjen',
            expect.objectContaining({ userId: 'qa-admin' }),
            ['biasa', 'terbatas'],
        );
    });

    it.each([
        ['a due date before today', { dueDate: geserHari(jakartaDate(), -1) }, 'Jatuh tempo tidak boleh sebelum hari ini.'],
        ['a malformed due date', { dueDate: '31-12-2099' }, 'Tanggal harus berformat TTTT-BB-HH, misalnya 2026-01-31'],
        ['a missing borrower name', { borrowerName: '' }, 'Nama peminjam wajib diisi'],
        ['a missing target', { arsipId: undefined }, 'Pilih arsip untuk peminjaman arsip, atau box untuk peminjaman box'],
    ])('rejects %s before the limiter and the service are reached', async (_label, extra, pesan) => {
        const response = await request(app).post('/lending/borrow').send(badan(extra)).expect(400);
        expect(response.body.code).toBe('VALIDATION_ERROR');
        expect(response.body.details.map((detail: any) => detail.message)).toContain(pesan);
        expect(mocks.limiter).not.toHaveBeenCalled();
        expect(mocks.service.borrow).not.toHaveBeenCalled();
    });

    it('accepts a due date of today', async () => {
        await request(app).post('/lending/borrow').send(badan({ dueDate: hariIni() })).expect(201);
        expect(mocks.service.borrow).toHaveBeenCalledWith(
            expect.objectContaining({ dueDate: hariIni() }), 'ditjen', expect.anything(), expect.anything(),
        );
    });

    it('uses the WIB calendar day, not the UTC day, as the boundary', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        // 16 September 00.30 WIB, masih 15 September menurut UTC.
        vi.setSystemTime(new Date('2026-09-15T17:30:00Z'));
        try {
            await request(app).post('/lending/borrow').send(badan({ dueDate: '2026-09-15' })).expect(400);
            await request(app).post('/lending/borrow').send(badan({ dueDate: '2026-09-16' })).expect(201);
        } finally {
            vi.useRealTimers();
        }
        expect(mocks.limiter).toHaveBeenCalledTimes(1);
    });

    it('refuses a read-only role before validation and the limiter', async () => {
        mocks.user = { ...mocks.user, role: 'auditor' };
        await request(app).post('/lending/borrow').send(badan({ dueDate: 'salah' })).expect(403);
        expect(mocks.limiter).not.toHaveBeenCalled();
        expect(mocks.service.borrow).not.toHaveBeenCalled();
    });
});

describe('PUT /:id/extend and /:id/return', () => {
    it('rejects an extension to a date before today without calling the service', async () => {
        const response = await request(app).put(`/lending/${loanId}/extend`).send({ newDueDate: geserHari(hariIni(), -1) }).expect(400);
        expect(response.body.details).toEqual([{ field: 'newDueDate', message: 'Jatuh tempo tidak boleh sebelum hari ini.' }]);
        expect(mocks.service.extend).not.toHaveBeenCalled();
    });

    it('passes a valid extension to the service', async () => {
        const baru = geserHari(hariIni(), 14);
        await request(app).put(`/lending/${loanId}/extend`).send({ newDueDate: baru }).expect(200);
        expect(mocks.service.extend).toHaveBeenCalledWith(loanId, 'ditjen', baru, expect.objectContaining({ userId: 'qa-admin' }));
    });

    it('validates the return note', async () => {
        await request(app).put(`/lending/${loanId}/return`).send({ notes: { teks: 'bukan teks' } }).expect(400);
        await request(app).put(`/lending/${loanId}/return`).send({ notes: 'x'.repeat(2001) }).expect(400);
        expect(mocks.service.return).not.toHaveBeenCalled();
        await request(app).put(`/lending/${loanId}/return`).send({ notes: 'Kembali dalam kondisi baik' }).expect(200);
        expect(mocks.service.return).toHaveBeenCalledWith(loanId, 'ditjen', 'Kembali dalam kondisi baik', expect.objectContaining({ userId: 'qa-admin' }));
        await request(app).put(`/lending/${loanId}/return`).send({}).expect(200);
        expect(mocks.service.return).toHaveBeenLastCalledWith(loanId, 'ditjen', undefined, expect.anything());
    });
});
