import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
    createInboxDatabase,
    distributionId,
    letterId,
    type InboxFixtureLetter,
} from './helpers/surat-inbox-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({
    db: new Proxy({}, {
        get: (_target, key) => {
            const value = holder.db[key];
            return typeof value === 'function' ? value.bind(holder.db) : value;
        },
    }),
}));
vi.mock('../services/arsip.service', () => ({ arsipService: { getExpiring: async () => [] } }));

const LETTERS: InboxFixtureLetter[] = [
    { n: 1, sifatSurat: 'Sangat Segera' },
    { n: 2, sifatSurat: 'Biasa', isDeleted: true },
    { n: 3, sifatSurat: 'biasa', isDeleted: null, distributionStatus: 'received' },
    { n: 4, sifatSurat: 'Rahasia' },
    { n: 5, sifatSurat: 'biasa', distributionStatus: 'processed' },
    // Surat baru (tanggal hari ini) agar prioritas tidak ditentukan umur surat.
    { n: 6, sifatSurat: 'Kilat', distributionStatus: 'processed' },
    { n: 7, sifatSurat: 'Amat Segera / Kilat', distributionStatus: 'processed' },
    { n: 8, sifatSurat: 'Sangat Rahasia', distributionStatus: 'processed' },
    { n: 9, sifatSurat: 'Undangan', distributionStatus: 'processed' },
];
const SURAT_BARU = [6, 7, 8, 9];
const SEMUA_KELAS = ['biasa', 'terbatas', 'rahasia', 'sangat_rahasia'];

let client: PGlite;
let service: typeof import('../services/notification.service').notificationService;

beforeAll(async () => {
    const fixture = await createInboxDatabase(LETTERS);
    client = fixture.client;
    await client.query(
        `UPDATE surat_masuk SET tanggal_surat = CURRENT_DATE WHERE id = ANY($1::uuid[])`,
        [SURAT_BARU.map(letterId)],
    );
    holder.db = fixture.db;
    ({ notificationService: service } = await import('../services/notification.service'));
}, 20_000);

afterAll(async () => { await client?.close(); });

describe('notifikasi disposisi', () => {
    it('hanya memuat disposisi terbuka atas surat hidup yang kelasnya terbaca, termasuk Sangat Segera', async () => {
        const items = await service.getDistributionNotifications('dir_bppt', 'user-1', ['biasa'], new Set(), 'admin_unit');
        expect(items.map(item => item.referenceId).sort()).toEqual([distributionId(1), distributionId(3)].sort());
    });
});

describe('notifikasi surat masuk pending', () => {
    it('menyertakan baris lama is_deleted NULL dan tetap membuang is_deleted TRUE', async () => {
        const items = await service.getPendingSuratMasuk('ditjen', 'user-1', ['biasa'], new Set());
        const ids = items.map(item => item.referenceId);
        expect(ids).toContain(letterId(3));
        expect(ids).toContain(letterId(5));
        expect(ids).not.toContain(letterId(2));
        expect(ids).not.toContain(letterId(4));
    });

    it('memuat sifat Sangat Segera yang tersimpan seperti di sumber sebagai surat mendesak', async () => {
        const items = await service.getPendingSuratMasuk('ditjen', 'user-1', ['biasa'], new Set());
        expect(items.find(item => item.referenceId === letterId(1))).toMatchObject({
            type: 'urgent', title: 'Surat Sangat Segera belum diproses',
        });
    });

    it('sifat urgensi Kilat dan Amat Segera/Kilat menjadi notifikasi mendesak, bukan Biasa', async () => {
        const items = await service.getPendingSuratMasuk('ditjen', 'user-1', ['biasa'], new Set());
        expect(items.find(item => item.referenceId === letterId(6))).toMatchObject({
            type: 'urgent', title: 'Surat Kilat belum diproses',
        });
        expect(items.find(item => item.referenceId === letterId(7))).toMatchObject({
            type: 'urgent', title: 'Surat Amat Segera/Kilat belum diproses',
        });
        expect(items.find(item => item.referenceId === letterId(9))).toMatchObject({
            type: 'info', title: 'Surat Biasa belum diproses',
        });
    });

    it('surat berkelas keamanan berlabel kelasnya; prioritasnya tetap menurut umur surat', async () => {
        const items = await service.getPendingSuratMasuk('ditjen', 'user-1', SEMUA_KELAS, new Set());
        expect(items.find(item => item.referenceId === letterId(8))).toMatchObject({
            type: 'info', title: 'Surat Sangat Rahasia belum diproses',
        });
        expect(items.find(item => item.referenceId === letterId(4))).toMatchObject({
            type: 'urgent', title: 'Surat Rahasia belum diproses',
        });
    });
});
