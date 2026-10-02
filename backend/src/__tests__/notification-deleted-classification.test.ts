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
];

let client: PGlite;
let service: typeof import('../services/notification.service').notificationService;

beforeAll(async () => {
    const fixture = await createInboxDatabase(LETTERS);
    client = fixture.client;
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
});
