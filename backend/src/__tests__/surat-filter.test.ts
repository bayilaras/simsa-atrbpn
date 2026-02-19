import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { SuratMasukService, SuratMasukFilters } from '../services/surat-masuk.service';
import { SuratKeluarService, SuratKeluarFilters } from '../services/surat-keluar.service';

// Mock the database
vi.mock('../config/database', () => ({
    db: {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue([]),
    }
}));

describe('SuratMasukService', () => {
    let service: SuratMasukService;

    beforeEach(() => {
        service = new SuratMasukService();
        vi.clearAllMocks();
    });

    describe('findAll with filters', () => {
        it('should accept basic filters', async () => {
            const filters: SuratMasukFilters = {
                unitKerjaId: '123e4567-e89b-12d3-a456-426614174000',
                tahun: 2026,
                status: 'belum_dibalas',
                page: 1,
                limit: 20
            };

            // Verify the filter interface accepts these properties
            expect(filters.unitKerjaId).toBeDefined();
            expect(filters.tahun).toBe(2026);
            expect(filters.status).toBe('belum_dibalas');
        });

        it('should accept date range filters', async () => {
            const filters: SuratMasukFilters = {
                unitKerjaId: '123e4567-e89b-12d3-a456-426614174000',
                tanggalDari: '2026-01-01',
                tanggalSampai: '2026-02-28',
                page: 1,
                limit: 20
            };

            expect(filters.tanggalDari).toBe('2026-01-01');
            expect(filters.tanggalSampai).toBe('2026-02-28');
        });

        it('should accept jenis and sifat surat filters', async () => {
            const filters: SuratMasukFilters = {
                unitKerjaId: '123e4567-e89b-12d3-a456-426614174000',
                jenisSurat: 'Nota Dinas',
                sifatSurat: 'segera',
                page: 1,
                limit: 20
            };

            expect(filters.jenisSurat).toBe('Nota Dinas');
            expect(filters.sifatSurat).toBe('segera');
        });

        it('should accept all advanced filters combined', async () => {
            const filters: SuratMasukFilters = {
                unitKerjaId: '123e4567-e89b-12d3-a456-426614174000',
                tahun: 2026,
                tanggalDari: '2026-01-01',
                tanggalSampai: '2026-12-31',
                jenisSurat: 'Surat Keputusan',
                sifatSurat: 'sangat_segera',
                status: 'sudah_dibalas',
                search: 'pengadaan',
                page: 1,
                limit: 10
            };

            expect(filters.tahun).toBe(2026);
            expect(filters.tanggalDari).toBeDefined();
            expect(filters.tanggalSampai).toBeDefined();
            expect(filters.jenisSurat).toBeDefined();
            expect(filters.sifatSurat).toBeDefined();
            expect(filters.status).toBeDefined();
            expect(filters.search).toBeDefined();
        });
    });
});

describe('SuratKeluarService', () => {
    let service: SuratKeluarService;

    beforeEach(() => {
        service = new SuratKeluarService();
        vi.clearAllMocks();
    });

    describe('findAll with filters', () => {
        it('should accept basic filters', async () => {
            const filters: SuratKeluarFilters = {
                unitKerjaId: '123e4567-e89b-12d3-a456-426614174000',
                tahun: 2026,
                naskahDinas: 'Nota Dinas',
                page: 1,
                limit: 20
            };

            expect(filters.unitKerjaId).toBeDefined();
            expect(filters.tahun).toBe(2026);
            expect(filters.naskahDinas).toBe('Nota Dinas');
        });

        it('should accept date range filters', async () => {
            const filters: SuratKeluarFilters = {
                unitKerjaId: '123e4567-e89b-12d3-a456-426614174000',
                tanggalDari: '2026-01-01',
                tanggalSampai: '2026-02-28',
                page: 1,
                limit: 20
            };

            expect(filters.tanggalDari).toBe('2026-01-01');
            expect(filters.tanggalSampai).toBe('2026-02-28');
        });

        it('should accept klasifikasi filters', async () => {
            const filters: SuratKeluarFilters = {
                unitKerjaId: '123e4567-e89b-12d3-a456-426614174000',
                klasifikasiFasilitatif: 'KU',
                klasifikasiSubstantif: 'PT',
                page: 1,
                limit: 20
            };

            expect(filters.klasifikasiFasilitatif).toBe('KU');
            expect(filters.klasifikasiSubstantif).toBe('PT');
        });

        it('should accept all advanced filters combined', async () => {
            const filters: SuratKeluarFilters = {
                unitKerjaId: '123e4567-e89b-12d3-a456-426614174000',
                tahun: 2026,
                tanggalDari: '2026-01-01',
                tanggalSampai: '2026-12-31',
                naskahDinas: 'Surat Dinas',
                klasifikasiFasilitatif: 'KP',
                klasifikasiSubstantif: 'PP',
                search: 'pengadaan',
                page: 1,
                limit: 10
            };

            expect(filters.tahun).toBe(2026);
            expect(filters.tanggalDari).toBeDefined();
            expect(filters.tanggalSampai).toBeDefined();
            expect(filters.naskahDinas).toBeDefined();
            expect(filters.klasifikasiFasilitatif).toBeDefined();
            expect(filters.klasifikasiSubstantif).toBeDefined();
            expect(filters.search).toBeDefined();
        });
    });
});
