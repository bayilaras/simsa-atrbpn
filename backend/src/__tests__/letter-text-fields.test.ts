import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    LETTER_FORM_TEXT_MAX_CHARS,
    extractLetterMetadata,
    joinPdfTextItems,
    readLetterFormFields,
} from '../services/letter-text-fields.js';

const layoutCases = JSON.parse(readFileSync(new URL('./fixtures/pdf-text-lines.json', import.meta.url), 'utf8')) as {
    kasus: Array<{ nama: string; items: unknown; teks: string }>;
};

const SURAT_DINAS = [
    'KEMENTERIAN CONTOH REPUBLIK FIKTIF',
    'DIREKTORAT JENDERAL CONTOH',
    'Jalan Contoh Nomor 1, Kota Fiktif 10000 Telepon (000) 0000000',
    '',
    'Kota Fiktif, 12 November 2026',
    'Nomor : B/123/CTH.01/XI/2026',
    'Sifat : Segera',
    'Lampiran : 1 (satu) berkas',
    'Hal : Permintaan Data Contoh Triwulan IV',
    '',
    'Yth. Kepala Kantor Wilayah Contoh Provinsi Fiktif',
    'di Kota Rekaan',
    '',
    'Sehubungan dengan nota dinas Kepala Biro Contoh, bersama ini kami sampaikan surat tugas terlampir.',
    '',
    'Direktur Jenderal Contoh,',
    '',
    'Nama Fiktif Satu',
    'NIP 000000000000000000',
].join('\n');

const NOTA_DINAS = [
    'KEMENTERIAN CONTOH REPUBLIK FIKTIF',
    'NOTA DINAS',
    'Nomor: 78/ND-CTH.03/XI/2026',
    'Yth. : Sekretaris Direktorat Jenderal Contoh',
    'Dari : Kepala Bagian Umum Contoh',
    'Hal : Laporan Kegiatan Contoh',
    'Tanggal : 20 November 2026',
    '',
    'Sehubungan dengan pelaksanaan kegiatan contoh, bersama ini kami laporkan hasilnya.',
].join('\n');

describe('PDF text item layout shared with the browser reader', () => {
    it.each(layoutCases.kasus)('$nama', ({ items, teks }) => {
        expect(joinPdfTextItems(items)).toBe(teks);
    });
});

describe('letter form fields', () => {
    it('reads the fields a person would otherwise retype', () => {
        expect(readLetterFormFields(SURAT_DINAS)).toEqual({
            nomorSurat: 'B/123/CTH.01/XI/2026',
            tanggalSurat: '2026-11-12',
            perihal: 'Permintaan Data Contoh Triwulan IV',
            pengirim: 'Direktur Jenderal Contoh',
            penerima: 'Kepala Kantor Wilayah Contoh Provinsi Fiktif',
            jenisSurat: null,
        });
    });

    it('agrees with the bulk upload reader on the fields both return', () => {
        for (const text of [SURAT_DINAS, NOTA_DINAS]) {
            const form = readLetterFormFields(text);
            const bulk = extractLetterMetadata(text);
            expect({ ...form, jenisSurat: null }).toEqual({
                nomorSurat: bulk.nomorSurat,
                tanggalSurat: bulk.tanggalSurat,
                perihal: bulk.perihal,
                pengirim: bulk.pengirim,
                penerima: bulk.penerima,
                jenisSurat: null,
            });
        }
    });

    it('leaves out sifat and the security class', () => {
        const fields = readLetterFormFields(`${SURAT_DINAS}\nKlasifikasi : RAHASIA`);
        expect(Object.keys(fields).sort()).toEqual(['jenisSurat', 'nomorSurat', 'penerima', 'pengirim', 'perihal', 'tanggalSurat']);
    });

    it('takes the document type from a title line only', () => {
        expect(readLetterFormFields(NOTA_DINAS).jenisSurat).toBe('Nota Dinas');
        // The same words inside a sentence describe another document.
        expect(readLetterFormFields(SURAT_DINAS).jenisSurat).toBeNull();
        expect(extractLetterMetadata(SURAT_DINAS).jenisSurat).toBe('Nota Dinas');
    });

    it.each([
        ['SURAT EDARAN', 'Surat Edaran'],
        ['SURAT TUGAS', 'Surat Tugas'],
        ['SURAT PERINTAH PELAKSANA TUGAS', 'Surat Perintah'],
        ['BERITA ACARA SERAH TERIMA', 'Berita Acara'],
        ['MEMORANDUM', 'Memorandum'],
        ['KEPUTUSAN DIREKTUR JENDERAL CONTOH', 'Keputusan'],
        ['PERATURAN MENTERI CONTOH', 'Peraturan'],
    ])('reads the title %s as %s', (title, jenis) => {
        expect(readLetterFormFields(`KEMENTERIAN CONTOH\n${title}\nNOMOR 5/CTH/XI/2026`).jenisSurat).toBe(jenis);
    });

    it.each([
        'Surat Tugas',                         // not a capitalised title
        'SURAT TUGAS DAN SURAT PERINTAH 2026', // digits: a sentence or a list entry
        'DAFTAR SURAT TUGAS',
        'KEPUTUSAN',                           // a bare word names nothing
    ])('does not take "%s" as a title', (line) => {
        expect(readLetterFormFields(`KEMENTERIAN CONTOH\n${line}\nNomor: 5/CTH/XI/2026`).jenisSurat).toBeNull();
    });

    it('ignores a title that appears below the header', () => {
        const body = Array.from({ length: 40 }, (_, index) => `Baris isi ke-${index + 1}.`).join('\n');
        expect(readLetterFormFields(`Nomor: 5/CTH/XI/2026\n${body}\nSURAT TUGAS`).jenisSurat).toBeNull();
    });

    it('does not return a date that is not on the calendar', () => {
        const fields = readLetterFormFields('Nomor: 5/CTH/II/2026\nTanggal : 31 Februari 2026\nHal : Contoh');
        expect(fields.tanggalSurat).toBeNull();
        expect(readLetterFormFields('Kota Fiktif, 29 Februari 2028').tanggalSurat).toBe('2028-02-29');
        expect(readLetterFormFields('Kota Fiktif, 29 Februari 2026').tanggalSurat).toBeNull();
    });

    it('returns nothing for text without letter fields', () => {
        expect(readLetterFormFields('Daftar hadir peserta rapat.')).toEqual({
            nomorSurat: null, tanggalSurat: null, perihal: null, pengirim: null, penerima: null, jenisSurat: null,
        });
    });

    it('reads only the first part of an oversized text', () => {
        const filler = 'x'.repeat(LETTER_FORM_TEXT_MAX_CHARS);
        expect(readLetterFormFields(`${filler}\nNomor: 9/CTH/XI/2026`).nomorSurat).toBeNull();
        expect(readLetterFormFields(`Nomor: 9/CTH/XI/2026\n${filler}`).nomorSurat).toBe('9/CTH/XI/2026');
    });

    it.each([
        ['one long line of number labels', 'No '.repeat(Math.floor(LETTER_FORM_TEXT_MAX_CHARS / 3))],
        ['a number followed by one long sentence', `Nomor: 5/CTH/XI/2026 ${'kata '.repeat(3900)}`],
        ['many short lines of labels', 'Nomor : \nHal : \nYth. \nDari : \n'.repeat(700)],
        ['digits and separators', '1/'.repeat(LETTER_FORM_TEXT_MAX_CHARS / 2)],
        ['whitespace only', ' \t'.repeat(LETTER_FORM_TEXT_MAX_CHARS / 2)],
    ])('stays fast on %s', (_name, text) => {
        const started = performance.now();
        readLetterFormFields(text);
        expect(performance.now() - started).toBeLessThan(1000);
    });
});
