import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createInboxDatabase, type InboxFixtureLetter } from './helpers/surat-inbox-pglite';

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

const PENGGUNA = '70000000-0000-4000-8000-000000000001';
const PENGGUNA_LAIN = '70000000-0000-4000-8000-000000000002';
const LETTERS: InboxFixtureLetter[] = [1, 2, 3].map(n => ({ n, sifatSurat: 'biasa' }));

let client: PGlite;
let service: typeof import('../services/notification.service').notificationService;
let kandidat: string[];
let rujukan: string[];

beforeAll(async () => {
    const fixture = await createInboxDatabase(LETTERS);
    client = fixture.client;
    holder.db = fixture.db;
    await client.exec(`
        CREATE TABLE notification_reads (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
            notification_id varchar(255) NOT NULL, read_at timestamp NOT NULL DEFAULT now(),
            UNIQUE (user_id, notification_id));
        CREATE TABLE user_preferences (user_id uuid PRIMARY KEY, notifications_enabled boolean NOT NULL DEFAULT true);`);
    ({ notificationService: service } = await import('../services/notification.service'));

    const semua = await service.getPendingSuratMasuk('ditjen', PENGGUNA, ['biasa'], new Set());
    expect(semua).toHaveLength(3);
    kandidat = semua.map(item => item.id);
    rujukan = semua.map(item => item.referenceId);
    // Riwayat baca yang panjang dan tidak terkait dengan kandidat saat ini.
    await client.query(`INSERT INTO notification_reads (user_id, notification_id)
        SELECT $1, 'surat-masuk:lama-' || g FROM generate_series(1, 400) g`, [PENGGUNA]);
    await client.query('INSERT INTO notification_reads (user_id, notification_id) VALUES ($1, $2)', [PENGGUNA, kandidat[0]]);
    await client.query('INSERT INTO notification_reads (user_id, notification_id) VALUES ($1, $2)', [PENGGUNA_LAIN, kandidat[1]]);
}, 20_000);

afterAll(async () => { await client?.close(); });

describe('read-state filtering over the current candidates', () => {
    it('hides only notifications this user has read, in the combined feed and its counts', async () => {
        const result = await service.getAllNotifications('ditjen', PENGGUNA, 20, ['biasa']);
        expect(result.notifications.map(item => item.id).sort()).toEqual([kandidat[1], kandidat[2]].sort());
        expect(result.counts.suratMasuk).toBe(2);
        expect(result.counts.total).toBe(2);
    });

    it('applies the same filter when a producer is called on its own', async () => {
        const items = await service.getPendingSuratMasuk('ditjen', PENGGUNA, ['biasa']);
        expect(items.map(item => item.referenceId).sort()).toEqual([rujukan[1], rujukan[2]].sort());

        const lain = await service.getPendingSuratMasuk('ditjen', PENGGUNA_LAIN, ['biasa']);
        expect(lain.map(item => item.referenceId).sort()).toEqual([rujukan[0], rujukan[2]].sort());
    });

    it('still honors the persisted notification opt-out', async () => {
        await client.query('INSERT INTO user_preferences (user_id, notifications_enabled) VALUES ($1, false)', [PENGGUNA_LAIN]);
        const result = await service.getAllNotifications('ditjen', PENGGUNA_LAIN, 20, ['biasa']);
        expect(result.notifications).toEqual([]);
        expect(result.counts.total).toBe(0);
    });
});
