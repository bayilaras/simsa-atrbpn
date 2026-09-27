import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createInboxDatabase, letterId, type InboxFixtureLetter } from './helpers/surat-inbox-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({
    db: new Proxy({}, {
        get: (_target, key) => {
            const value = holder.db[key];
            return typeof value === 'function' ? value.bind(holder.db) : value;
        },
    }),
}));

const LETTERS: InboxFixtureLetter[] = [
    { n: 1, sifatSurat: 'Sangat Segera' },
    { n: 2, sifatSurat: 'sangat-segera' },
    { n: 3, sifatSurat: ' Biasa ' },
    { n: 4, sifatSurat: '' },
    { n: 5, sifatSurat: null },
    { n: 6, sifatSurat: 'Terbatas' },
    { n: 7, sifatSurat: 'RAHASIA' },
    { n: 8, sifatSurat: 'Sangat Rahasia' },
    { n: 9, sifatSurat: 'klasifikasi-aneh' },
];

let client: PGlite;
let service: typeof import('../services/distribution.service').distributionService;

beforeAll(async () => {
    const fixture = await createInboxDatabase(LETTERS);
    client = fixture.client;
    holder.db = fixture.db;
    ({ distributionService: service } = await import('../services/distribution.service'));
}, 20_000);

afterAll(async () => { await client?.close(); });

const suratIds = (rows: Array<{ suratMasukId: string }>) => rows.map(row => row.suratMasukId).sort();
const lettersN = (...ns: number[]) => ns.map(letterId).sort();

describe('kotak disposisi: klasifikasi dinormalisasi seperti normalizeSecurityClassification', () => {
    it('menampilkan semua sifat setara biasa, termasuk Sangat Segera, string kosong, dan NULL', async () => {
        const result = await service.findInbox('dir_bppt', { limit: 50 }, ['biasa']);
        expect(suratIds(result.data)).toEqual(lettersN(1, 2, 3, 4, 5));
        expect(result.pagination.total).toBe(5);
    });

    it('menambah Terbatas hanya bila role boleh membacanya', async () => {
        const result = await service.findInbox('dir_bppt', { limit: 50 }, ['biasa', 'terbatas']);
        expect(suratIds(result.data)).toEqual(lettersN(1, 2, 3, 4, 5, 6));
    });

    it('lingkup super_admin melihat semua kelas yang dikenal, tetapi tidak nilai tak dikenal', async () => {
        const result = await service.findInbox('dir_bppt', { limit: 50 }, ['biasa', 'terbatas', 'rahasia', 'sangat_rahasia']);
        expect(suratIds(result.data)).toEqual(lettersN(1, 2, 3, 4, 5, 6, 7, 8));
    });

    it('lingkup kelas kosong tidak mengembalikan apa pun', async () => {
        const result = await service.findInbox('dir_bppt', { limit: 50 }, []);
        expect(result.data).toEqual([]);
        expect(result.pagination.total).toBe(0);
    });

    it('kotak keluar memakai predikat yang sama', async () => {
        const result = await service.findOutbox('ditjen', { limit: 50 }, ['biasa']);
        expect(suratIds(result.data)).toEqual(lettersN(1, 2, 3, 4, 5));
    });
});
