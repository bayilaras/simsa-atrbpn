import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { KOLOM_ARSIP, KOLOM_SURAT_KELUAR, KOLOM_SURAT_MASUK } from '../services/access/kolom-rekaman';

// Pola akses yang hanya boleh muncul di tempat yang tercatat. Daftar di bawah
// sama persis dengan kode sekarang: menambah pemakaian menggagalkan tes ini,
// mengurangi pemakaian berarti daftarnya ikut dikurangi.

const sourceRoot = path.resolve(process.cwd(), 'src');

function tsFiles(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) return entry.name === '__tests__' ? [] : tsFiles(absolute);
        return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [absolute] : [];
    });
}

const sources = tsFiles(sourceRoot).map((file) => ({
    file: path.relative(sourceRoot, file).replaceAll('\\', '/'),
    lines: fs.readFileSync(file, 'utf8').split(/\r?\n/),
}));

function countPerFile(match: (line: string) => boolean, skip: (file: string) => boolean = () => false) {
    const counts: Record<string, number> = {};
    for (const { file, lines } of sources) {
        if (skip(file)) continue;
        const count = lines.filter(match).length;
        if (count > 0) counts[file] = count;
    }
    return counts;
}

describe('pola akses kelas keamanan', () => {
    it('normalisasi kelas lokal di SQL hanya di tempat yang tercatat; yang baru memakai klasifikasiNormSql', () => {
        // Utang lama: tiap tempat menormalisasi sendiri. Penyatuan ke
        // klasifikasiNormSql bisa mengubah hasil untuk nilai non-kanonik,
        // jadi dikerjakan per tempat bersama tesnya.
        const tercatat = {
            'services/archive-lending.service.ts': 1,
            'services/arsip-elektronik.service.ts': 1,
            'services/arsip-terjaga.service.ts': 1,
            'services/arsip-vital.service.ts': 1,
            'services/arsip.service.ts': 2,
            'services/dashboard.service.ts': 4,
            'services/fulltext-search.service.ts': 1,
            'services/global-search.service.ts': 4,
            'services/layanan-arsip.service.ts': 1,
            'services/penyusutan.service.ts': 2,
            'services/report.service.ts': 3,
            'services/retention-governance.service.ts': 2,
            'services/surat-keluar.service.ts': 2,
            'services/surat-masuk.service.ts': 2,
        };
        const counts = countPerFile(
            (line) => /lower\(coalesce\(|replace\(lower\(/.test(line) && /sifat|klasifikasi_keamanan|klasifikasiKeamanan/i.test(line),
            (file) => file.startsWith('services/access/'),
        );
        expect(counts).toEqual(tercatat);
    });

    it('baris arsip penuh hanya dipilih di jalur detail dan kunci tulis', () => {
        const tercatat = {
            // Sumber proyeksi daftar (tanpa kolom isi).
            'services/access/kolom-rekaman.ts': 1,
            // Proyeksi detail, dipakai setelah check().
            'services/arsip.service.ts': 1,
            // Kunci baris SELECT ... FOR UPDATE pada jalur tulis; baris tidak dikirim ke klien.
            'services/penyusutan.service.ts': 3,
        };
        expect(countPerFile((line) => /getTableColumns\(\s*arsip\s*\)/.test(line))).toEqual(tercatat);
    });

    it('relasi arsip memilih kolom secara eksplisit, bukan baris penuh', () => {
        expect(countPerFile((line) => /\barsip:\s*true\b/.test(line))).toEqual({});
    });

    it('kolom isi hanya dirujuk di berkas yang tercatat', () => {
        // filePath tidak diperiksa di sini: namanya umum, dan respons surat
        // menggantinya dengan endpoint berkas (sanitizeSuratRecord).
        const tercatat: Record<string, Record<string, string>> = {
            extractedText: {
                'middlewares/sanitize.middleware.ts': 'tidak disanitasi sebagai HTML',
                'services/arsip.service.ts': 'tipe baris daftar tanpa teks OCR',
                'services/autentikasi.service.ts': 'dibuang dari relasi arsip',
                'services/bulk-upload.service.ts': 'ditulis saat konfirmasi unggah massal',
                'services/fulltext-search.service.ts': 'pencarian isi dengan gerbang baca per arsip',
                'services/global-search.service.ts': 'pencarian isi dengan gerbang baca per arsip',
                'services/layanan-arsip.service.ts': 'dibuang dari relasi arsip',
                'services/ocr-process.service.ts': 'skema hasil OCR',
                'services/ocr.service.ts': 'pemrosesan OCR',
            },
            linkDokumen: {
                'services/export.service.ts': 'kolom ekspor surat keluar',
                'services/google-drive-import.service.ts': 'impor',
                'services/google-sheets-import-mapping.ts': 'impor',
                'services/import-sync.ts': 'impor sinkron',
                'services/surat-import-identity.ts': 'impor sinkron',
                'services/surat-keluar.service.ts': 'impor sinkron',
                'validators/schemas.ts': 'validasi masukan',
            },
            fileOriginalName: {
                'routes/file-access.routes.ts': 'unduhan berkas setelah pemeriksaan akses',
                'routes/surat-keluar.routes.ts': 'unggah berkas',
                'routes/surat-masuk.routes.ts': 'unggah berkas',
                'services/surat-keluar.service.ts': 'lampiran',
                'services/surat-masuk.service.ts': 'lampiran',
                'validators/schemas.ts': 'validasi masukan',
            },
        };
        const registri = { ...KOLOM_ARSIP, ...KOLOM_SURAT_MASUK, ...KOLOM_SURAT_KELUAR } as Record<string, string>;
        const kolomIsi = Object.keys(registri).filter((key) => registri[key] === 'isi' && key !== 'filePath').sort();
        expect(kolomIsi).toEqual(Object.keys(tercatat).sort());

        for (const kolom of kolomIsi) {
            const snake = kolom.replace(/[A-Z]/g, (huruf) => `_${huruf.toLowerCase()}`);
            const pola = new RegExp(`\\b(${kolom}|${snake})\\b`);
            const berkas = Object.keys(countPerFile(
                (line) => pola.test(line),
                (file) => file.startsWith('db/schema/') || file === 'services/access/kolom-rekaman.ts',
            )).sort();
            expect(berkas, `berkas yang merujuk ${kolom}`).toEqual(Object.keys(tercatat[kolom]).sort());
        }
    });
});
