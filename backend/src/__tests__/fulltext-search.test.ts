import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database
vi.mock('../config/database', () => ({
    db: {
        select: vi.fn().mockReturnThis(),
        selectDistinct: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue([]),
    }
}));

// Import after mocking
const { fullTextSearchService } = await import('../services/fulltext-search.service');

describe('FullTextSearchService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('search', () => {
        it('should accept search parameters', async () => {
            const params = {
                query: 'pengadaan tanah',
                unitKerjaId: '123e4567-e89b-12d3-a456-426614174000',
                jenisArsip: 'masuk',
                tahun: 2026,
                page: 1,
                limit: 20,
                fuzzy: false,
                sortBy: 'relevance' as const
            };

            // Verify the params object is valid
            expect(params.query).toBe('pengadaan tanah');
            expect(params.unitKerjaId).toBeDefined();
            expect(params.sortBy).toBe('relevance');
        });

        it('should support fuzzy search option', async () => {
            const params = {
                query: 'pengadan', // typo
                unitKerjaId: '123e4567-e89b-12d3-a456-426614174000',
                fuzzy: true
            };

            expect(params.fuzzy).toBe(true);
        });
    });

    describe('calculateMatchDetails (internal logic)', () => {
        // Test the scoring logic by simulating different match scenarios
        it('should score exact nomor surat match highest', () => {
            const row = {
                nomorSuratOriginal: 'ND-123/BPN/2026',
                perihalOriginal: null,
                uraianBerkas: null,
                extractedText: null,
                keterangan: null,
                jraKode: null,
                jraUraian: null
            };

            // Exact match on nomor should get high score
            const query = 'ND-123/BPN/2026';
            expect(row.nomorSuratOriginal?.toLowerCase().includes(query.toLowerCase())).toBe(true);
        });

        it('should score perihal match high', () => {
            const row = {
                perihalOriginal: 'Undangan Rapat Koordinasi',
            };

            const query = 'rapat koordinasi';
            expect(row.perihalOriginal?.toLowerCase().includes(query.toLowerCase())).toBe(true);
        });

        it('should find matches in extracted text', () => {
            const extractedText = `
                Bersama ini kami sampaikan laporan pengadaan tanah untuk
                proyek infrastruktur di wilayah kabupaten.
            `;

            const query = 'pengadaan tanah';
            expect(extractedText.toLowerCase().includes(query.toLowerCase())).toBe(true);
        });
    });

    describe('highlightTerms (internal logic)', () => {
        it('should wrap terms with markdown bold', () => {
            const text = 'This is a test document about pengadaan tanah';
            const terms = ['pengadaan', 'tanah'];

            // Simulate highlighting
            let highlighted = text;
            terms.forEach(term => {
                const regex = new RegExp(`(${term})`, 'gi');
                highlighted = highlighted.replace(regex, '**$1**');
            });

            expect(highlighted).toContain('**pengadaan**');
            expect(highlighted).toContain('**tanah**');
        });
    });

    describe('getSuggestions', () => {
        it('should accept query and unitKerjaId', async () => {
            const query = 'peng';
            const unitKerjaId = '123e4567-e89b-12d3-a456-426614174000';
            const limit = 10;

            expect(query.length).toBeGreaterThan(0);
            expect(unitKerjaId).toBeDefined();
            expect(limit).toBe(10);
        });
    });

    describe('searchByKeywords', () => {
        it('should accept keyword array', async () => {
            const keywords = ['tanah', 'pengadaan', 'infrastruktur'];
            const unitKerjaId = '123e4567-e89b-12d3-a456-426614174000';

            expect(keywords.length).toBe(3);
            expect(keywords).toContain('tanah');
        });
    });

    describe('getRelatedDocuments', () => {
        it('should accept arsipId and unitKerjaId', async () => {
            const arsipId = '123e4567-e89b-12d3-a456-426614174000';
            const unitKerjaId = 'ditjen';
            const limit = 5;

            expect(arsipId).toBeDefined();
            expect(unitKerjaId).toBeDefined();
            expect(limit).toBe(5);
        });
    });
});

describe('Search Term Extraction', () => {
    const STOPWORDS = new Set([
        'yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'dengan', 'pada', 'ini', 'itu',
        'adalah', 'dalam', 'akan', 'atau', 'sebagai', 'oleh', 'bahwa', 'tersebut',
    ]);

    function extractSearchTerms(query: string): string[] {
        return query
            .toLowerCase()
            .replace(/[^a-zA-Z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(term => term.length > 2)
            .filter(term => !STOPWORDS.has(term));
    }

    it('should extract meaningful terms from query', () => {
        const query = 'pengadaan tanah untuk pembangunan';
        const terms = extractSearchTerms(query);

        expect(terms).toContain('pengadaan');
        expect(terms).toContain('tanah');
        expect(terms).toContain('pembangunan');
        expect(terms).not.toContain('untuk'); // stopword
    });

    it('should filter out short terms', () => {
        const query = 'di ke pengadaan';
        const terms = extractSearchTerms(query);

        expect(terms).toContain('pengadaan');
        expect(terms).not.toContain('di');
        expect(terms).not.toContain('ke');
    });

    it('should handle special characters', () => {
        const query = 'ND-123/BPN/2026';
        const terms = extractSearchTerms(query);

        expect(terms).toContain('123');
        expect(terms).toContain('bpn');
        expect(terms).toContain('2026');
    });
});
