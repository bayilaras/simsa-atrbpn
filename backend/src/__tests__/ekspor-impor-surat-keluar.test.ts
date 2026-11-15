import { beforeEach, describe, expect, it, vi } from 'vitest';

// Excel Surat Keluar yang diekspor SIMSA dapat diimpor kembali lewat impor
// berkas (CSV/XLSX) tanpa kehilangan jenis dan kode klasifikasi.
const mocks = vi.hoisted(() => ({
    findAll: vi.fn(), createImported: vi.fn(), existing: vi.fn(),
    identityKey: (data: { nomorSurat?: string; linkDokumen?: string | null }) => ({ nomor: data.nomorSurat, link: data.linkDokumen }),
}));
vi.mock('../services/surat-keluar.service.js', () => ({ suratKeluarService: {
    findAll: mocks.findAll, createImported: mocks.createImported, importIdentityKey: mocks.identityKey,
    existingImportIdentities: mocks.existing,
    importMatches: async (keys: any) => (await import('./helpers/import-matches.js')).recordedMatches(await mocks.existing(keys)),
} }));
vi.mock('../services/surat-masuk.service.js', () => ({ suratMasukService: {
    findAll: vi.fn(), createImported: vi.fn(), importIdentityKey: mocks.identityKey, existingImportIdentities: mocks.existing,
    importMatches: async (keys: any) => (await import('./helpers/import-matches.js')).recordedMatches(await mocks.existing(keys)),
} }));
vi.mock('../services/export-unit-pengolah', () => ({ namaUnitPengolah: async () => 'Unit Uji', namaUnitPerBaris: async () => null, namaUnitBaris: () => '-' }));
vi.mock('../services/export-balasan', () => ({ ASAL_NASKAH_LABEL: {}, resolveBalasanLabels: async () => new Map() }));
vi.mock('../utils/logger', () => ({ createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) }));

const { exportService } = await import('../services/export.service');
const { fileImportService } = await import('../services/file-import.service.js');
const { upload } = await import('./helpers/import-file-fixtures.js');

const audit = { userId: '11111111-1111-4111-8111-111111111111', role: 'admin_unit' };
const surat = (id: string, over: Record<string, unknown>) => ({
    id, noUrut: Number(id), nomorSurat: `SK-${id}/2026`, tanggalSurat: '2026-11-0' + id, perihal: `Perihal ${id}`,
    kepada: 'Kanwil', naskahDinas: 'Nota Dinas', sifatSurat: 'biasa', balasanUntuk: null,
    createdAt: new Date('2026-11-01T02:00:00Z'), ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.createImported.mockResolvedValue({ id: 'baru' });
    mocks.existing.mockImplementation(async (keys: unknown[]) => keys.map(() => false));
});

describe('ekspor Excel Surat Keluar lalu impor ulang', () => {
    it('jenis dan kode klasifikasi tetap sama', async () => {
        mocks.findAll.mockResolvedValue({ data: [
            surat('1', { klasifikasiFasilitatif: 'Tata Usaha', klasifikasiFasilitatifKode: 'TU.01' }),
            surat('2', { klasifikasiSubstantif: 'Pengadaan Tanah', klasifikasiSubstantifKode: 'PT.02' }),
            surat('3', {}),
        ], pagination: { total: 3 } });
        const excel = await exportService.generateExcelSuratKeluar({ unitKerjaId: 'unit-a' });

        const result = await fileImportService.importSurat('surat-keluar', upload(excel, 'surat-keluar.xlsx'), undefined, 'unit-b', audit);
        expect(result).toMatchObject({ importedRows: 3, skippedRows: 0, errors: [] });
        const dibuat = mocks.createImported.mock.calls.map(([record]) => record);
        expect(dibuat.map(record => ({
            nomorSurat: record.nomorSurat,
            tanggalSurat: record.tanggalSurat,
            klasifikasiFasilitatif: record.klasifikasiFasilitatif,
            klasifikasiFasilitatifKode: record.klasifikasiFasilitatifKode,
            klasifikasiSubstantif: record.klasifikasiSubstantif,
            klasifikasiSubstantifKode: record.klasifikasiSubstantifKode,
        }))).toEqual([
            { nomorSurat: 'SK-1/2026', tanggalSurat: '2026-11-01', klasifikasiFasilitatif: 'Tata Usaha', klasifikasiFasilitatifKode: 'TU.01', klasifikasiSubstantif: null, klasifikasiSubstantifKode: null },
            { nomorSurat: 'SK-2/2026', tanggalSurat: '2026-11-02', klasifikasiFasilitatif: null, klasifikasiFasilitatifKode: null, klasifikasiSubstantif: 'Pengadaan Tanah', klasifikasiSubstantifKode: 'PT.02' },
            { nomorSurat: 'SK-3/2026', tanggalSurat: '2026-11-03', klasifikasiFasilitatif: null, klasifikasiFasilitatifKode: null, klasifikasiSubstantif: null, klasifikasiSubstantifKode: null },
        ]);
        expect(dibuat.every(record => record.unitKerjaId === 'unit-b')).toBe(true);
    });
});
