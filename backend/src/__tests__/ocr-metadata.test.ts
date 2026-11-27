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

describe('OCR letter header fields', () => {
    const paragraph = 'Sehubungan dengan pelaksanaan kegiatan contoh tahun 2026, bersama ini kami sampaikan bahwa '
        + 'seluruh keterangan dalam surat ini adalah data fiktif yang dibuat hanya untuk pengujian pembacaan '
        + 'dokumen dan tidak menggambarkan kegiatan sungguhan.';

    it('finishes at once when the number runs straight into a long sentence', () => {
        const text = `SURAT EDARAN NOMOR 5/SE-CTH/XI/2026 TENTANG TATA CARA PENCATATAN CONTOH ${paragraph} ${paragraph}`;
        const started = performance.now();
        const result = ocrService.extractMetadata(text);
        expect(performance.now() - started).toBeLessThan(1000);
        expect(result.nomorSurat).toBe('5/SE-CTH/XI/2026');
    });

    it('reads a task letter whose number is followed by the body', () => {
        const result = ocrService.extractMetadata([
            'SURAT TUGAS',
            'Nomor: 210/ST-CTH.04/XI/2026',
            'Yang bertanda tangan di bawah ini menugaskan pegawai fiktif berikut untuk melaksanakan kegiatan contoh.',
            'Berkenaan dengan hal tersebut, kami mohon bantuan Saudara.',
            'Kota Fiktif, 25 November 2026',
        ].join('\n'));
        expect(result.nomorSurat).toBe('210/ST-CTH.04/XI/2026');
        expect(result.perihal).toBeNull();
        expect(result.tanggalSurat).toBe('2026-11-25');
    });

    it('reads a nota dinas header and ignores the house number in the letterhead', () => {
        const result = ocrService.extractMetadata([
            'KEMENTERIAN CONTOH REPUBLIK FIKTIF',
            'Jalan H. Contoh Nomor 58, Kota Fiktif 10000 Telp. 021-0000000',
            'NOTA DINAS',
            'NOMOR 300/ND-600.27.KP.03/XI/2026',
            'Yth. : Kepala Biro Contoh',
            'Dari : Sekretaris Direktorat Jenderal Contoh Pengadaan dan Pengembangan',
            'Wilayah Fiktif',
            'Hal : Permohonan Kartu Akses Pegawai di lingkungan Direktorat',
            'Jenderal Contoh',
            'Tanggal : 26 November 2026',
            '',
            paragraph,
        ].join('\n'));
        expect(result.nomorSurat).toBe('300/ND-600.27.KP.03/XI/2026');
        expect(result.penerima).toBe('Kepala Biro Contoh');
        expect(result.pengirim).toBe('Sekretaris Direktorat Jenderal Contoh Pengadaan dan Pengembangan Wilayah Fiktif');
        expect(result.perihal).toBe('Permohonan Kartu Akses Pegawai di lingkungan Direktorat Jenderal Contoh');
        expect(result.tanggalSurat).toBe('2026-11-26');
    });

    it('separates the fields of a header that arrives as one line', () => {
        const result = ocrService.extractMetadata(
            'NOTA DINAS N OMOR 78/ND-CTH.03/XI/2026 Yth. : Sekretaris Contoh Dari : Kepala Bagian Umum Contoh '
            + `Hal : Laporan Kegiatan Contoh Tanggal : 20 November 2026 ${paragraph}`,
        );
        expect(result.nomorSurat).toBe('78/ND-CTH.03/XI/2026');
        expect(result.penerima).toBe('Sekretaris Contoh');
        expect(result.pengirim).toBe('Kepala Bagian Umum Contoh');
        expect(result.perihal).toBe('Laporan Kegiatan Contoh');
        expect(result.tanggalSurat).toBe('2026-11-20');
    });

    it('stops each value where the next field of the same line begins', () => {
        const result = ocrService.extractMetadata(
            'Nomor : B/1/X/2026 Sifat : Segera Lampiran : 1 (satu) berkas Hal : Permintaan Data',
        );
        expect(result.nomorSurat).toBe('B/1/X/2026');
        expect(result.sifatSurat).toBe('SEGERA');
        expect(result.lampiran).toBe('1 (satu) berkas');
        expect(result.perihal).toBe('Permintaan Data');
    });

    it('joins a number written with spaces and reads a numeric date', () => {
        const result = ocrService.extractMetadata([
            'Nomor : B - 99 / CTH.05 / XI / 2026',
            'Tanggal : 14-11-2026',
            'Hal : Penyampaian Laporan Contoh',
        ].join('\n'));
        expect(result.nomorSurat).toBe('B-99/CTH.05/XI/2026');
        expect(result.tanggalSurat).toBe('2026-11-14');
        expect(result.perihal).toBe('Penyampaian Laporan Contoh');
    });

    it('repairs a Roman month that OCR read as digits and leaves real digits alone', () => {
        expect(ocrService.extractMetadata('Nomor : B/123/CTH.01/X1/2026').nomorSurat).toBe('B/123/CTH.01/XI/2026');
        expect(ocrService.extractMetadata('Nomor : 12/SK-CTH/1X/2026').nomorSurat).toBe('12/SK-CTH/IX/2026');
        expect(ocrService.extractMetadata('Nomor : 800/11/CTH/2026').nomorSurat).toBe('800/11/CTH/2026');
    });

    it('reads a decree number with its year and the subject under TENTANG', () => {
        const result = ocrService.extractMetadata([
            'KEPUTUSAN DIREKTUR JENDERAL CONTOH',
            'NOMOR 12 TAHUN 2026',
            'TENTANG',
            'PEMBENTUKAN TIM CONTOH',
            'TAHUN ANGGARAN 2026',
            '',
            'Menimbang : bahwa untuk keperluan pengujian perlu dibentuk tim contoh.',
        ].join('\n'));
        expect(result.nomorSurat).toBe('12 Tahun 2026');
        expect(result.perihal).toBe('PEMBENTUKAN TIM CONTOH TAHUN ANGGARAN 2026');
    });

    it('joins a subject that wraps onto a second line and stops at the addressee', () => {
        const result = ocrService.extractMetadata([
            'Hal : Tindak Lanjut Hasil Rapat Koordinasi',
            'Penyelesaian Contoh Tahun 2026',
            'Yth. Para Direktur Contoh',
            'di Kota Fiktif',
            paragraph,
        ].join('\n'));
        expect(result.perihal).toBe('Tindak Lanjut Hasil Rapat Koordinasi Penyelesaian Contoh Tahun 2026');
        expect(result.penerima).toBe('Para Direktur Contoh');
    });

    it('takes the date the letter states, not a weekday row or a date in the body', () => {
        expect(ocrService.extractMetadata([
            'Senin, 9 November 2026',
            'Dalam rangka kegiatan contoh pada tanggal 1 Desember 2026 ditugaskan pegawai berikut.',
            'Kota Fiktif, 3 November 2026',
        ].join('\n')).tanggalSurat).toBe('2026-11-03');
    });

    it('does not take an amount or a phone number for the letter number', () => {
        const result = ocrService.extractMetadata('Biaya Rp.1.000.000 dapat ditanyakan ke Telp.021-0000000 pada jam kerja.');
        expect(result.nomorSurat).toBeNull();
    });

    it('uses the title of the signer as the sender when no Dari line exists', () => {
        const result = ocrService.extractMetadata([
            'Nomor : B/123/CTH.01/XI/2026',
            'Hal : Permintaan Data Contoh',
            'Yth. Kepala Kantor Wilayah Contoh Provinsi Fiktif',
            'di Kota Rekaan',
            paragraph,
            'Direktur Jenderal Contoh,',
            '',
            'Nama Fiktif Satu',
            'NIP 000000000000000000',
        ].join('\n'));
        expect(result.pengirim).toBe('Direktur Jenderal Contoh');
        expect(result.penerima).toBe('Kepala Kantor Wilayah Contoh Provinsi Fiktif');
    });
});

describe('PDF text item layout', () => {
    const item = (str: string, x: number, y: number, width: number, extra: Record<string, unknown> = {}) => ({
        str, transform: [12, 0, 0, 12, x, y], width, height: 12, ...extra,
    });

    it('starts a new line on a new baseline and a blank line after a wide gap', () => {
        const text = ocrModule.joinPdfTextItems([
            item('Nomor', 50, 700, 34),
            item(': B/1/XI/2026', 100, 700, 70, { hasEOL: true }),
            item('Hal', 50, 686, 18),
            item(': Contoh', 100, 686, 44),
            item('Isi surat.', 50, 640, 50),
        ]);
        expect(text).toBe('Nomor : B/1/XI/2026\nHal : Contoh\n\nIsi surat.');
    });

    it('does not put a space inside a word that the PDF split in two', () => {
        expect(ocrModule.joinPdfTextItems([
            item('meng', 50, 700, 26),
            item('ajukan', 76, 700, 36),
            item(' ', 112, 700, 3),
            item('permohonan', 115, 700, 62),
        ])).toBe('mengajukan permohonan');
    });

    it('keeps the space-joined form for items without a position', () => {
        expect(ocrModule.joinPdfTextItems([{ str: 'Pengelolaan' }, { str: 'arsip' }, { nothing: true }])).toBe('Pengelolaan arsip');
        expect(ocrModule.joinPdfTextItems(null)).toBe('');
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
