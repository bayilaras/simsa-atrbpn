import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const queue: any[] = [];
    const chain: any = {};
    for (const method of ['select', 'from', 'where']) chain[method] = vi.fn(() => chain);
    chain.limit = vi.fn(async () => queue.shift() || []);
    return { chain, queue, masuk: vi.fn(), keluar: vi.fn(), arsip: vi.fn() };
});
vi.mock('../config/database', () => ({ db: mocks.chain }));
vi.mock('../services/surat-masuk.service.js', () => ({ suratMasukService: { create: mocks.masuk } }));
vi.mock('../services/surat-keluar.service.js', () => ({ suratKeluarService: { create: mocks.keluar } }));
vi.mock('../services/arsip.service.js', () => ({ arsipService: { create: mocks.arsip } }));
const { migrationService } = await import('../services/migration.service');
const actor = { userId: 'operator-a', userEmail: 'operator@example.test', ipAddress: '127.0.0.1' };
const types = [
    ['importSuratMasuk', 'masuk', 'Nomor Surat,Tanggal Surat,Perihal,Dari,Kepada', 'SM-1', 'tanggalSurat'],
    ['importSuratKeluar', 'keluar', 'Nomor Surat,Tanggal Surat,Perihal,Dari,Kepada', 'SK-1', 'tanggalSurat'],
    ['importArsip', 'arsip', 'Nomor Berkas,Tanggal,Uraian,Dari,Kepada', 'AR-1', 'tanggalArsip'],
] as const;
const csv = (header: string, number: string, date: string) => `${header}\n${number},${date},Arsip sumber,Unit A,Unit B`;

describe('CSV date fidelity and mutation-free preview', () => {
    beforeEach(() => {
        vi.clearAllMocks(); mocks.queue.length = 0;
        mocks.masuk.mockResolvedValue({ id: 'a' });
        mocks.keluar.mockResolvedValue({ id: 'b' });
        mocks.arsip.mockResolvedValue({ id: 'c' });
    });

    it.each(types)('%s rejects missing, rollover, and trailing-garbage dates without replacement', async (method, create, header, number) => {
        for (const date of ['', '31/02/2026', '29/02/2025', '2026-13-01', '28/08/2026garbage', '28/08/2026 99:00:00']) {
            const result = await migrationService[method](csv(header, number, date), 'unit-a', actor);
            expect(result).toMatchObject({ success: false, imported: 0, skipped: 1 });
            expect(result.rows).toEqual([expect.objectContaining({ row: 2, status: 'invalid', sourceDate: date })]);
            expect(result.errors[0]).toContain(date || '(kosong)');
        }
        expect(mocks[create]).not.toHaveBeenCalled();
        expect(mocks.chain.select).not.toHaveBeenCalled();
    });

    it.each(types)('%s previews leap-day normalization without writes, then revalidates on import', async (method, create, header, number, field) => {
        const source = csv(header, number, '29/02/2024 13:05:02');
        const preview = await migrationService[method](source, 'unit-a', actor, { dryRun: true });
        expect(preview).toMatchObject({ success: true, dryRun: true, imported: 0, valid: 1 });
        expect(preview.rows).toEqual([expect.objectContaining({ row: 2, status: 'valid', sourceDate: '29/02/2024 13:05:02', normalizedDate: '2024-02-29' })]);
        expect(mocks[create]).not.toHaveBeenCalled();
        // A concurrent import can turn a previously valid preview into a duplicate.
        mocks.queue.push([{ id: 'concurrent-record' }]);
        const imported = await migrationService[method](source, 'unit-a', actor);
        expect(imported).toMatchObject({ imported: 0, duplicates: 1 });
        expect(mocks[create]).not.toHaveBeenCalled();
        await migrationService[method](source, 'unit-a', actor);
        expect(mocks[create]).toHaveBeenCalledWith(expect.objectContaining({ [field]: '2024-02-29', tahun: 2024, unitKerjaId: 'unit-a' }), actor);
    });

    it('detects duplicates inside one preview and reports every record', async () => {
        const result = await migrationService.importSuratMasuk([
            'Nomor Surat,Tanggal Surat,Perihal,Dari',
            'SM-1,2026-09-11,Arsip sumber,Unit A',
            'SM-1,2026-09-11,Arsip sumber,Unit A',
            'SM-2,2026-09-11,,Unit A',
        ].join('\n'), 'unit-a', actor, { dryRun: true });
        expect(result).toMatchObject({ imported: 0, valid: 1, duplicates: 1, skipped: 1, success: false });
        expect(result.rows.map(row => [row.row, row.status])).toEqual([[2, 'valid'], [3, 'duplicate'], [4, 'invalid']]);
        expect(mocks.masuk).not.toHaveBeenCalled();
    });

    it('preserves partial-import and failed-critical-audit counts with row diagnostics', async () => {
        mocks.masuk.mockRejectedValueOnce(new Error('audit unavailable')).mockResolvedValueOnce({ id: 'good' });
        const result = await migrationService.importSuratMasuk([
            'Nomor Surat,Tanggal Surat,Perihal,Dari',
            'SM-1,2026-09-11,Arsip satu,Unit A',
            'SM-2,2026-09-11,Arsip dua,Unit A',
        ].join('\n'), 'unit-a', actor);
        expect(result).toMatchObject({ success: false, imported: 1, skipped: 1 });
        expect(result.rows.map(row => row.status)).toEqual(['invalid', 'imported']);
        expect(result.errors[0]).toContain('audit unavailable');
    });

    it.each(['__proto__', 'constructor', 'Perihal,Perihal'])('rejects unsafe or ambiguous CSV headers: %s', async header => {
        const result = await migrationService.importSuratMasuk(`Nomor Surat,Tanggal Surat,${header}\nSM-1,2026-09-11,Arsip`, 'unit-a', actor, { dryRun: true });
        expect(result.success).toBe(false);
        expect(result.errors[0]).toMatch(/Header CSV/);
        expect(mocks.chain.select).not.toHaveBeenCalled();
    });

    it('rejects a batch over 1,000 records before reading or writing database rows', async () => {
        const source = ['Nomor Surat,Tanggal Surat,Perihal,Dari', ...Array.from({ length: 1001 }, (_, index) => `SM-${index},2026-09-11,Arsip,Unit A`)].join('\n');
        const result = await migrationService.importSuratMasuk(source, 'unit-a', actor, { dryRun: true });
        expect(result).toMatchObject({ success: false, imported: 0, rows: [] });
        expect(result.errors[0]).toContain('1.000');
        expect(mocks.chain.select).not.toHaveBeenCalled();
    });

    it('accepts UTF-8 BOM, quoted delimiters, and embedded newlines on the patched parser', async () => {
        const result = await migrationService.importSuratMasuk('\ufeffNomor Surat,Tanggal Surat,Perihal,Dari\nSM-1,2026-09-11,"Arsip, tanah\nbaris kedua",Unit A', 'unit-a', actor);
        expect(result).toMatchObject({ success: true, imported: 1 });
        expect(mocks.masuk).toHaveBeenCalledWith(expect.objectContaining({ perihal: 'Arsip, tanah\nbaris kedua' }), actor);
    });
});
