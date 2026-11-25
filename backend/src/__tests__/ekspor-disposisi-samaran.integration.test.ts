import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createInboxDatabase, letterId, type InboxFixtureLetter } from './helpers/surat-inbox-pglite';
import { normalizeSecurityClassification } from '../services/record-access.service';

// Rekap disposisi memakai findInbox / findOutbox yang sebenarnya di atas basis
// data: surat yang tidak boleh dibaca tersamar di berkas, persis seperti di
// layar, dan Kotak Keluar tidak memuat surat di atas plafon kelas.
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({
    db: new Proxy({}, {
        get: (_target, key) => {
            const value = holder.db[key];
            return typeof value === 'function' ? value.bind(holder.db) : value;
        },
    }),
}));

// checkMany tiruan seperti distribution-inbox-classification.test.ts: hanya
// kelas biasa (dan aliasnya) yang boleh dibaca.
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
    { n: 1, sifatSurat: 'Biasa' },
    { n: 2, sifatSurat: 'Terbatas' },
    { n: 3, sifatSurat: 'RAHASIA' },
    { n: 4, sifatSurat: 'Sangat Rahasia', distributionStatus: 'processed' },
    { n: 5, sifatSurat: 'Biasa', distributionStatus: 'processed' },
    // Surat terhapus tidak tampil di layar maupun di berkas.
    { n: 6, sifatSurat: 'Biasa', isDeleted: true },
];
for (const letter of LETTERS) sifatById.set(letterId(letter.n), letter.sifatSurat);
const USER = { id: 'u', role: 'admin_unit', unitKerjaId: 'dir_bppt' };

let client: PGlite;
let service: typeof import('../services/distribution.service').distributionService;
let ekspor: typeof import('../services/export-disposisi').eksporDisposisiService;
let excelDariTabel: typeof import('../services/export-tabel').excelDariTabel;
let pdfDariTabel: typeof import('../services/export-tabel').pdfDariTabel;

beforeAll(async () => {
    const fixture = await createInboxDatabase(LETTERS);
    client = fixture.client;
    holder.db = fixture.db;
    await client.exec(`
        UPDATE surat_distributions SET instruction = 'Instruksi uji ' || right(surat_masuk_id::text, 1),
            -- Waktu kirim berbeda supaya urutan layar dan berkas pasti sama.
            sent_at = timestamp '2026-09-01 02:00:00' + right(surat_masuk_id::text, 1)::int * interval '1 hour',
            catatan_penyelesaian = CASE WHEN status = 'processed' THEN 'Catatan uji ' || right(surat_masuk_id::text, 1) END;
    `);
    ({ distributionService: service } = await import('../services/distribution.service'));
    ({ eksporDisposisiService: ekspor } = await import('../services/export-disposisi'));
    ({ excelDariTabel, pdfDariTabel } = await import('../services/export-tabel'));
}, 60_000);

afterAll(async () => { await client?.close(); });

async function teksExcel(buffer: Buffer): Promise<string> {
    const { loadExcelJS } = await import('../utils/lazy-libraries');
    const ExcelJS = await loadExcelJS();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const baris: unknown[] = [];
    workbook.worksheets[0].eachRow((row) => baris.push(row.values));
    return JSON.stringify(baris);
}

describe('rekap disposisi di atas basis data', () => {
    it('Kotak Masuk: baris berkas sama dengan baris layar, surat terkendali tersamar', async () => {
        const layar = await service.findInbox('dir_bppt', { limit: 50 }, USER);
        const tabel = await ekspor.tabel({ kotak: 'inbox', unitKerjaId: 'dir_bppt' }, USER, ['biasa']);

        expect(tabel.baris).toHaveLength(layar.data.length);
        expect(tabel.baris).toHaveLength(5);
        // Kolom 2-3 = nomor dan perihal, kolom 6-7 = instruksi dan catatan.
        layar.data.forEach((row, i) => {
            const sel = tabel.baris[i];
            if (row.masked) {
                expect([sel[1], sel[2], sel[5], sel[6]]).toEqual(['Dikecualikan', '-', '-', '-']);
            } else {
                expect([sel[1], sel[2], sel[5]]).toEqual([row.surat.nomorSurat, row.surat.perihal, row.instruction]);
            }
            expect(sel[3]).toBe('Direktorat Jenderal');
            expect(sel[4]).toBe('Direktorat BPPT');
        });
        expect(layar.data.filter((row) => row.masked)).toHaveLength(3);

        const teks = await teksExcel(await excelDariTabel(tabel));
        for (const n of [1, 5]) {
            expect(teks).toContain(`SM-${n}/2026`);
            expect(teks).toContain(`Perihal uji ${n}`);
        }
        expect(teks).toContain('Catatan uji 5');
        for (const n of [2, 3, 4, 6]) {
            expect(teks).not.toContain(`SM-${n}/2026`);
            expect(teks).not.toContain(`Perihal uji ${n}`);
            expect(teks).not.toContain(`Instruksi uji ${n}`);
            expect(teks).not.toContain(`Catatan uji ${n}`);
            expect(teks).not.toContain(letterId(n));
        }
    });

    it('PDF Kotak Masuk tidak menulis isi surat tersamar', async () => {
        const { loadPdfKit } = await import('../utils/lazy-libraries');
        const PDFDocument = await loadPdfKit();
        const tertulis: string[] = [];
        const asli = PDFDocument.prototype.text;
        vi.spyOn(PDFDocument.prototype as any, 'text').mockImplementation(function (this: any, ...args: any[]) {
            tertulis.push(String(args[0]));
            return (asli as any).apply(this, args);
        });
        try {
            const tabel = await ekspor.tabel({ kotak: 'inbox', unitKerjaId: 'dir_bppt' }, USER, ['biasa']);
            const buffer = await pdfDariTabel(tabel);
            expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
        } finally {
            vi.restoreAllMocks();
        }
        const teks = tertulis.join('\n');
        expect(teks).toContain('SM-1/2026');
        expect(teks).toContain('Dikecualikan');
        for (const n of [2, 3, 4, 6]) {
            expect(teks).not.toContain(`SM-${n}/2026`);
            expect(teks).not.toContain(`Perihal uji ${n}`);
            expect(teks).not.toContain(`Instruksi uji ${n}`);
        }
    });

    it('tanpa pemanggil semua baris Kotak Masuk tersamar', async () => {
        const tabel = await ekspor.tabel({ kotak: 'inbox', unitKerjaId: 'dir_bppt' }, undefined, []);
        expect(tabel.baris.map((sel) => sel[1])).toEqual(Array(5).fill('Dikecualikan'));
        expect(JSON.stringify(tabel.baris)).not.toMatch(/SM-\d|Perihal uji|Instruksi uji|Catatan uji/);
    });

    it('penyaring status mempersempit berkas seperti layar', async () => {
        const layar = await service.findInbox('dir_bppt', { status: 'processed', limit: 50 }, USER);
        const tabel = await ekspor.tabel({ kotak: 'inbox', unitKerjaId: 'dir_bppt', status: 'processed' }, USER, ['biasa']);
        expect(tabel.baris).toHaveLength(layar.data.length);
        expect(tabel.baris.map((sel) => sel[8])).toEqual(['Selesai', 'Selesai']);
    });

    it('Kotak Keluar hanya memuat surat dalam plafon kelas pemanggil', async () => {
        const layar = await service.findOutbox('ditjen', { limit: 50 }, ['biasa', 'terbatas']);
        const tabel = await ekspor.tabel({ kotak: 'outbox', unitKerjaId: 'ditjen' }, USER, ['biasa', 'terbatas']);
        expect(tabel.baris.map((sel) => sel[1]).sort()).toEqual(layar.data.map((row) => row.surat.nomorSurat).sort());
        expect(tabel.baris.map((sel) => sel[1]).sort()).toEqual(['SM-1/2026', 'SM-2/2026', 'SM-5/2026']);
        expect(tabel.baris.every((sel) => sel[3] === 'Direktorat Jenderal' && sel[4] === 'Direktorat BPPT')).toBe(true);
        const teks = JSON.stringify(tabel.baris);
        for (const n of [3, 4, 6]) expect(teks).not.toContain(`SM-${n}/2026`);
    });
});
