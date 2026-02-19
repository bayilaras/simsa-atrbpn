import { describe, it, expect, vi } from 'vitest';

// Import the OCR service - we'll test the metadata extraction
const ocrModule = await import('../services/ocr.service');
const ocrService = ocrModule.ocrService;

describe('OCR Metadata Extraction', () => {
    describe('extractMetadata', () => {
        it('should extract nomor surat from text', () => {
            const text = `
                Nomor: ND-123/BPN/2026
                Hal: Undangan Rapat Koordinasi
            `;
            const result = ocrService.extractMetadata(text);
            expect(result.nomorSurat).toBe('ND-123/BPN/2026');
        });

        it('should extract perihal from text', () => {
            const text = `
                Nomor: ND-123/BPN/2026
                Perihal: Undangan Rapat Koordinasi Tahunan
            `;
            const result = ocrService.extractMetadata(text);
            expect(result.perihal).toBe('Undangan Rapat Koordinasi Tahunan');
        });

        it('should extract Indonesian date format', () => {
            const text = `
                Jakarta, 15 Februari 2026
                Nomor: ND-123/BPN/2026
            `;
            const result = ocrService.extractMetadata(text);
            expect(result.tanggalSurat).toBe('2026-02-15');
        });

        it('should extract pengirim from text', () => {
            const text = `
                Dari: Kepala Biro Umum
                Nomor: ND-123/BPN/2026
            `;
            const result = ocrService.extractMetadata(text);
            expect(result.pengirim).toBe('Kepala Biro Umum');
        });

        it('should extract penerima from text', () => {
            const text = `
                Kepada Yth. Direktur Jenderal Infrastruktur
                di Tempat
            `;
            const result = ocrService.extractMetadata(text);
            expect(result.penerima).toContain('Direktur Jenderal');
        });

        it('should extract lampiran information', () => {
            const text = `
                Lampiran: 2 berkas
                Perihal: Pengiriman Data
            `;
            const result = ocrService.extractMetadata(text);
            expect(result.lampiran).toBe('2 berkas');
        });

        it('should extract sifat surat', () => {
            const text = `
                Sifat: SEGERA
                Nomor: ND-123/BPN/2026
            `;
            const result = ocrService.extractMetadata(text);
            expect(result.sifatSurat).toBe('SEGERA');
        });

        it('should detect jenis naskah dinas', () => {
            const text = `
                NOTA DINAS
                Nomor: ND-123/BPN/2026
            `;
            const result = ocrService.extractMetadata(text);
            expect(result.jenisSurat).toBe('Nota Dinas');
        });

        it('should extract keywords from content', () => {
            const text = `
                Dengan hormat, bersama ini kami sampaikan data pengadaan tanah
                untuk pembangunan infrastruktur di wilayah kabupaten. Data tersebut
                mencakup luas tanah, pemilik tanah, dan nilai ganti rugi pengadaan.
            `;
            const result = ocrService.extractMetadata(text);
            expect(result.keywords.length).toBeGreaterThan(0);
            // Keywords should include domain-relevant terms
            expect(result.keywords.some(k =>
                k.includes('tanah') || k.includes('pengadaan') || k.includes('pembangunan')
            )).toBe(true);
        });

        it('should extract summary from first paragraph', () => {
            const text = `
                Bersama ini kami sampaikan laporan bulanan mengenai pelaksanaan program
                pendaftaran tanah sistematis lengkap (PTSL) untuk periode Januari 2026.
                
                Berdasarkan data yang dikumpulkan...
            `;
            const result = ocrService.extractMetadata(text);
            expect(result.summary).toBeDefined();
            expect(result.summary?.length).toBeGreaterThan(50);
        });

        it('should handle empty text gracefully', () => {
            const result = ocrService.extractMetadata('');
            expect(result.nomorSurat).toBeNull();
            expect(result.perihal).toBeNull();
            expect(result.tanggalSurat).toBeNull();
            expect(result.keywords).toEqual([]);
        });

        it('should limit extracted text length', () => {
            const longText = 'A'.repeat(60000);
            const result = ocrService.extractMetadata(longText);
            expect(result.extractedText.length).toBeLessThanOrEqual(50000);
        });
    });

    describe('serializeMetadata and parseMetadata', () => {
        it('should serialize metadata to JSON', () => {
            const metadata = {
                nomorSurat: 'ND-123',
                perihal: 'Test',
                tanggalSurat: '2026-01-01',
                pengirim: 'Test Sender',
                extractedText: 'Full text content',
                penerima: 'Test Recipient',
                tembusan: ['CC 1', 'CC 2'],
                lampiran: '1 berkas',
                sifatSurat: 'SEGERA',
                klasifikasiKeamanan: 'BIASA',
                jenisSurat: 'Nota Dinas',
                keywords: ['keyword1', 'keyword2'],
                summary: 'Test summary'
            };

            const serialized = ocrService.serializeMetadata(metadata);
            expect(typeof serialized).toBe('string');

            const parsed = JSON.parse(serialized);
            expect(parsed.penerima).toBe('Test Recipient');
            expect(parsed.tembusan).toEqual(['CC 1', 'CC 2']);
            expect(parsed.keywords).toEqual(['keyword1', 'keyword2']);
        });

        it('should parse serialized metadata', () => {
            const json = JSON.stringify({
                penerima: 'Test',
                keywords: ['a', 'b']
            });

            const parsed = ocrService.parseMetadata(json);
            expect(parsed.penerima).toBe('Test');
            expect(parsed.keywords).toEqual(['a', 'b']);
        });

        it('should handle invalid JSON gracefully', () => {
            const parsed = ocrService.parseMetadata('invalid json');
            expect(parsed).toEqual({});
        });
    });
});

describe('OCR Date Extraction', () => {
    it('should extract various Indonesian date formats', () => {
        const testCases = [
            { text: '1 Januari 2026', expected: '2026-01-01' },
            { text: '15 Februari 2026', expected: '2026-02-15' },
            { text: '31 Desember 2025', expected: '2025-12-31' },
            { text: 'Jakarta, 5 Mei 2026', expected: '2026-05-05' },
        ];

        testCases.forEach(({ text, expected }) => {
            const result = ocrService.extractMetadata(text);
            expect(result.tanggalSurat).toBe(expected);
        });
    });
});

describe('OCR Jenis Surat Detection', () => {
    it('should detect various jenis naskah dinas', () => {
        const testCases = [
            { text: 'SURAT DINAS', expected: 'Surat Dinas' },
            { text: 'NOTA DINAS', expected: 'Nota Dinas' },
            { text: 'MEMORANDUM', expected: 'Memorandum' },
            { text: 'SURAT KEPUTUSAN', expected: 'Surat Keputusan' },
            { text: 'SURAT EDARAN', expected: 'Surat Edaran' },
            { text: 'BERITA ACARA', expected: 'Berita Acara' },
        ];

        testCases.forEach(({ text, expected }) => {
            const result = ocrService.extractMetadata(text);
            expect(result.jenisSurat).toBe(expected);
        });
    });
});
