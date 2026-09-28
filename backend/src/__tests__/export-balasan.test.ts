import ExcelJS from 'exceljs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({ db: null as any, keluar: vi.fn() }));
vi.mock('../config/database.js', () => ({ db: { select: (fields: any) => holder.db.select(fields) } }));
vi.mock('../services/surat-masuk.service', () => ({ suratMasukService: { findAll: vi.fn() } }));
vi.mock('../services/surat-keluar.service', () => ({ suratKeluarService: { findAll: holder.keluar } }));
vi.mock('../services/arsip.service', () => ({ arsipService: { findAll: vi.fn() } }));

const SM = (n: number) => `00000000-0000-4000-8000-00000000c00${n}`;
let database: PGlite;
let lookup: typeof import('../services/export-balasan.js');
let exportService: typeof import('../services/export.service.js').exportService;

beforeAll(async () => {
    database = new PGlite();
    await database.exec(`CREATE TABLE surat_masuk (id uuid PRIMARY KEY, unit_kerja_id varchar(50) NOT NULL,
        nomor_surat varchar(255), sifat_surat varchar(50), is_deleted boolean DEFAULT false);
        INSERT INTO surat_masuk VALUES
          ('${SM(1)}', 'ditjen', 'SM-001/2026', 'Sangat Segera', false),
          ('${SM(2)}', 'ditjen', 'SM-002/2026', 'Rahasia', false),
          ('${SM(3)}', 'dir_ptep', 'SM-003/2026', 'Biasa', false),
          ('${SM(4)}', 'ditjen', 'SM-004/2026', 'Biasa', true);`);
    holder.db = drizzle(database);
    lookup = await import('../services/export-balasan.js');
    ({ exportService } = await import('../services/export.service.js'));
}, 60_000);
afterAll(async () => { await database?.close(); });

const rows = [
    { id: 'sk-1', unitKerjaId: 'ditjen', balasanUntuk: SM(1) },
    { id: 'sk-2', unitKerjaId: 'ditjen', balasanUntuk: SM(2) },
    { id: 'sk-3', unitKerjaId: 'ditjen', balasanUntuk: SM(3) },
    { id: 'sk-4', unitKerjaId: 'ditjen', balasanUntuk: SM(4) },
    { id: 'sk-5', unitKerjaId: 'ditjen', balasanUntuk: null },
];

describe('Balasan Untuk pada ekspor', () => {
    it('hanya menampilkan nomor surat masuk unit sama dengan kelas yang diizinkan', async () => {
        const labels = await lookup.resolveBalasanLabels(rows, ['biasa', 'terbatas']);
        expect(Object.fromEntries(labels)).toEqual({
            'sk-1': 'SM-001/2026',
            'sk-2': 'Dikecualikan',
            'sk-3': '(lintas unit)',
            'sk-4': '(tidak tersedia)',
        });
        expect((await lookup.resolveBalasanLabels(rows, ['biasa', 'terbatas', 'rahasia', 'sangat_rahasia'])).get('sk-2')).toBe('SM-002/2026');
    });

    it('workbook memakai nomor, bukan UUID, dan memuat kolom Asal Naskah', async () => {
        holder.keluar.mockResolvedValue({
            data: [
                { id: 'sk-1', noUrut: 1, unitKerjaId: 'ditjen', nomorSurat: 'KEL-1', balasanUntuk: SM(1), asalNaskah: 'tindak_lanjut' },
                { id: 'sk-6', noUrut: 2, unitKerjaId: 'ditjen', nomorSurat: 'KEL-2', balasanUntuk: null, asalNaskah: 'inisiatif' },
            ],
            pagination: { total: 2 },
        });
        const buffer = await exportService.generateExcelSuratKeluar({ unitKerjaId: 'ditjen', securityClassifications: ['biasa'] });
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer as any);
        const sheet = workbook.worksheets[0];
        expect(sheet.getRow(4).getCell(10).value).toBe('Balasan Untuk');
        expect(sheet.getRow(4).getCell(11).value).toBe('Asal Naskah');
        expect(sheet.getRow(5).getCell(10).value).toBe('SM-001/2026');
        expect(sheet.getRow(5).getCell(11).value).toBe('Tindak Lanjut');
        expect(sheet.getRow(6).getCell(11).value).toBe('Inisiatif');
        expect(JSON.stringify(sheet.getSheetValues())).not.toContain(SM(1));
    });
});
