import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createInboxDatabase, letterId, type InboxFixtureLetter } from './helpers/surat-inbox-pglite';
import { normalizeSecurityClassification } from '../services/record-access.service';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({
    db: new Proxy({}, {
        get: (_target, key) => {
            const value = holder.db[key];
            return typeof value === 'function' ? value.bind(holder.db) : value;
        },
    }),
}));

// Kotak disposisi kini menyamarkan (bukan menyembunyikan) baris yang tidak
// boleh dibaca (§4.8, T10-3). checkMany tiruan: kelas biasa (dan aliasnya)
// boleh dibaca, kelas lain tidak.
const sifatById = vi.hoisted(() => new Map<string, string | null>());
vi.mock('../services/rangkaian/deps.js', async (importOriginal) => {
    const asli = await importOriginal<typeof import('../services/rangkaian/deps.js')>();
    return {
        ...asli,
        recordAccessService: {
            ...asli.recordAccessService,
            checkMany: async (_user: unknown, refs: Array<{ type: string; id: string }>) => new Map(refs.map((ref) => [
                asli.readRefKey(ref as never),
                { exists: true, allowed: normalizeSecurityClassification(sifatById.get(ref.id) ?? null) === 'biasa' },
            ])),
        },
    };
});

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
    // Surat terhapus tidak pernah tampil di kotak masuk maupun keluar (T10-6, C-9).
    { n: 10, sifatSurat: 'Biasa', isDeleted: true },
];
for (const letter of LETTERS) sifatById.set(letterId(letter.n), letter.sifatSurat);
const USER = { id: 'u', role: 'admin_unit', unitKerjaId: 'dir_bppt' };

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

describe('kotak disposisi: baris terkendali disamarkan, bukan disembunyikan', () => {
    it('mengembalikan semua 9 baris aktif; hanya kelas biasa yang terbaca', async () => {
        const result = await service.findInbox('dir_bppt', { limit: 50 }, USER);
        expect(result.data).toHaveLength(9);
        expect(result.pagination.total).toBe(9);
        const terbaca = result.data.filter((row) => !row.masked);
        const tersamar = result.data.filter((row) => row.masked);
        expect(terbaca.map((row) => row.surat.id).sort()).toEqual(lettersN(1, 2, 3, 4, 5));
        expect(tersamar).toHaveLength(4);
        for (const row of tersamar) {
            expect(row).toMatchObject({ suratMasukId: null, instruction: null, surat: { id: null, perihal: null, label: 'Dikecualikan' } });
        }
        const json = JSON.stringify(tersamar);
        for (const n of [6, 7, 8, 9]) {
            expect(json).not.toContain(letterId(n));
            expect(json).not.toContain(`Perihal uji ${n}`);
        }
        expect(JSON.stringify(result.data)).not.toContain(letterId(10));
    });

    it('baris terbaca membawa rangkaian null bila belum berangkai', async () => {
        const result = await service.findInbox('dir_bppt', { limit: 50 }, USER);
        expect(result.data.find((row) => !row.masked)).toMatchObject({ masked: false, rangkaian: null });
    });

    it('paginasi menghitung baris yang sama dengan data', async () => {
        const result = await service.findInbox('dir_bppt', { limit: 4, page: 3 }, USER);
        expect(result.data).toHaveLength(1);
        expect(result.pagination).toMatchObject({ total: 9, totalPages: 3 });
    });

    it('kotak keluar memakai predikat yang sama', async () => {
        const result = await service.findOutbox('ditjen', { limit: 50 }, ['biasa']);
        expect(suratIds(result.data)).toEqual(lettersN(1, 2, 3, 4, 5));
    });
});
