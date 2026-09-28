import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(process.cwd(), '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('dokumentasi Integrasi Surat P5', () => {
    it('PANDUAN menjelaskan rangkaian, pemberkasan, koreksi, data lama, notifikasi, dan ekspor', () => {
        const panduan = read('PANDUAN_PENGGUNAAN_SIMSA.md');
        for (const text of [
            '### 5.4 Rangkaian Surat & Lacak Surat',
            '### 5.5 Berkas Rangkaian, Koreksi Berkas & Data Lama',
            'Berkaskan ke Direktorat (Unit Pengolah)',
            'Koreksi Berkas',
            'super_admin lain',
            'Tutup massal data lama',
            'Berkas Rangkaian adalah berkas naskah',
            'Dosir adalah map kasus',
            'Bukti penutupan berkas',
            'lewat batas waktu',
            'Asal Naskah',
            'Balasan Untuk',
            'Perlu Dilengkapi',
            'Tandai Inisiatif',
        ]) expect(panduan, text).toContain(text);
    });

    it('dokumen manajemen surat dan SUMMARY memuat halaman Rangkaian Surat', () => {
        expect(read('docs/SUMMARY.md')).toContain('(manajemen-surat/rangkaian-surat.md)');
        const rangkaian = read('docs/manajemen-surat/rangkaian-surat.md');
        expect(rangkaian).toContain('Koreksi Berkas');
        expect(rangkaian).toContain('data lama');
        expect(read('docs/manajemen-surat/distribusi.md')).toContain('Batas waktu');
        expect(read('docs/manajemen-surat/surat-keluar.md')).toContain('Surat Inisiatif');
    });

    it('runbook operator memuat gerbang backfill data lama', () => {
        const pointer = read('docs/OPERASIONAL_BACKEND.md');
        expect(pointer).toContain('RUNBOOK_INTEGRASI_SURAT_P5.md');

        const runbook = read('docs/RUNBOOK_INTEGRASI_SURAT_P5.md');
        for (const text of [
            'rangkaian:backfill-lama:plan',
            'rangkaian:backfill-lama:apply',
            'rangkaian:backfill-lama:isi-pengolah:plan',
            'rangkaian:backfill-lama:isi-pengolah:apply',
            '--approved-sha256=',
            'RANGKAIAN_DISPOSISI_LAMA_READ',
            '0048_rangkaian_pengerasan',
            'simsa_api',
            'NEON_RUNTIME_DATABASE_URL',
            'neon-database.mjs migrate --apply',
            'RANGKAIAN_DATA_LAMA_SEBELUM',
            'export DATABASE_URL="$NEON_RUNTIME_DATABASE_URL"',
            'tidak berlaku setelah 0048 diterapkan',
        ]) expect(runbook, text).toContain(text);
    });
});
