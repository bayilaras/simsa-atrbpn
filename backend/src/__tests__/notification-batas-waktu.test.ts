import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { suratMasuk } from '../db/schema/surat-masuk';
import { jakartaDate } from '../utils/jakarta-date';
import { createRangkaianP5Database, seedRangkaianBase } from './helpers/rangkaian-p5-pglite.js';

const queue: any[] = [];
const chain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') { const value = queue.shift() ?? []; return (resolve: any) => resolve(value); }
        return () => chain;
    },
});
vi.mock('../config/database', () => ({ db: { select: () => chain } }));
vi.mock('../services/arsip.service', () => ({ arsipService: { getExpiring: async () => [] } }));

const { notificationService, deadlineUrgency, notDataLamaIncomingCondition } = await import('../services/notification.service');
const UUID = '550e8400-e29b-41d4-a716-446655440001';
const hari = (offset: number) => jakartaDate(new Date(Date.now() + offset * 86_400_000));

describe('urgensi batas waktu disposisi', () => {
    beforeEach(() => { queue.length = 0; });

    it('mendesak bila batas waktu ≤ 2 hari lagi atau terlewati', () => {
        expect(deadlineUrgency(null, '2026-09-26')).toBeNull();
        expect(deadlineUrgency('2026-09-29', '2026-09-26')).toBeNull();
        expect(deadlineUrgency('2026-09-28', '2026-09-26')).toEqual({ type: 'urgent', sisaHari: 2 });
        expect(deadlineUrgency('2026-09-26', '2026-09-26')).toEqual({ type: 'urgent', sisaHari: 0 });
        expect(deadlineUrgency('2026-09-20', '2026-09-26')).toEqual({ type: 'urgent', sisaHari: -6 });
    });

    it.each([
        [1, 'Batas waktu disposisi 1 hari lagi'],
        [0, 'Batas waktu disposisi hari ini'],
        [-3, 'Disposisi lewat batas waktu 3 hari'],
    ])('distribusi baru dengan batas waktu H%s menjadi urgent', async (offset, title) => {
        queue.push([{ id: UUID, suratMasukId: '550e8400-e29b-41d4-a716-446655440098', status: 'received', instruction: 'Mohon ditindaklanjuti', nomorSurat: 'SM-9',
            sentAt: new Date(), updatedAt: new Date(), batasWaktu: hari(offset) }]);
        const [notification] = await notificationService.getDistributionNotifications('dir_bppt', 'user-1', null, new Set(), 'admin_unit');
        expect(notification).toMatchObject({ type: 'urgent', title, state: 'awaiting_processing' });
        expect(notification.id).toBe(`distribusi:${UUID}:awaiting_processing:urgent`);
    });

    it('tanpa batas waktu tetap memakai urgensi usia lama', async () => {
        queue.push([{ id: UUID, suratMasukId: '550e8400-e29b-41d4-a716-446655440098', status: 'sent', instruction: null, nomorSurat: 'SM-1', sentAt: new Date(), updatedAt: new Date(), batasWaktu: null }]);
        const [notification] = await notificationService.getDistributionNotifications('dir_bppt', 'user-1', null, new Set(), 'admin_unit');
        expect(notification).toMatchObject({ type: 'info', title: 'Distribusi menunggu penerimaan' });
    });
});

describe('masking tetap berlaku dengan urgensi batas waktu (P3 §4.8)', () => {
    beforeEach(() => { queue.length = 0; });

    it('baris tersamar tetap "Dikecualikan" meski judulnya memakai urgensi batas waktu', async () => {
        const { recordAccessService } = await import('../services/record-access.service');
        const SM_ID = '550e8400-e29b-41d4-a716-446655440099';
        const spy = vi.spyOn(recordAccessService, 'checkMany')
            .mockResolvedValue(new Map([[`surat_masuk:${SM_ID}`, { allowed: false }]]) as any);
        try {
            queue.push([{ id: UUID, suratMasukId: SM_ID, status: 'received', instruction: 'Instruksi rahasia',
                nomorSurat: 'R-1', perihal: 'Perihal rahasia', sentAt: new Date(), updatedAt: new Date(), batasWaktu: hari(0) }]);
            const [notification] = await notificationService.getDistributionNotifications(
                'dir_bppt', 'user-1', null, new Set(), 'admin_unit', { id: 'user-1', role: 'admin_unit', unitKerjaId: 'dir_bppt' });
            expect(notification).toMatchObject({ type: 'urgent', title: 'Batas waktu disposisi hari ini', message: 'Dikecualikan' });
            expect(JSON.stringify(notification)).not.toContain('R-1');
        } finally {
            spy.mockRestore();
        }
    });
});

describe('pengecualian data lama pada notifikasi surat masuk', () => {
    let database: PGlite;
    beforeAll(async () => {
        database = await createRangkaianP5Database();
        await seedRangkaianBase(database);
        await database.exec(`
            INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun) VALUES
              ('00000000-0000-4000-8000-000000000a01', 'ditjen', 1, 2023),
              ('00000000-0000-4000-8000-000000000a02', 'ditjen', 2, 2023),
              ('00000000-0000-4000-8000-000000000a03', 'ditjen', 3, 2023);
            INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, judul, tahun) VALUES
              ('00000000-0000-4000-8000-000000000b01', 'RS-2023-990001', 'data_lama', 'selesai', 'ditjen', 'Lama selesai', 2023),
              ('00000000-0000-4000-8000-000000000b02', 'RS-2023-990002', 'data_lama', 'aktif', 'ditjen', 'Lama dibuka kembali', 2023);
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber) VALUES
              ('00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-000000000a01', 'ditjen', 'induk', 'data_lama'),
              ('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-000000000a02', 'ditjen', 'induk', 'data_lama');`);
    }, 180_000);
    afterAll(async () => { await database?.close(); });

    it('surat induk rangkaian data lama yang tertutup tidak dinotifikasi; yang dibuka kembali tetap', async () => {
        const rows = await drizzle(database).select({ id: suratMasuk.id }).from(suratMasuk)
            .where(notDataLamaIncomingCondition()).orderBy(suratMasuk.id);
        expect(rows.map((row) => row.id.slice(-3))).toEqual(['a02', 'a03']);
    });
});
