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
            // Final fix wave P5: CTRL-2 diamandemen, pra-cek 0048 lengkap, TimeZone, CTRL-5.
            'menahan SELURUH rilis P5',
            "WHERE status IN ('pending', 'approved') GROUP BY rangkaian_id HAVING count(*) > 1",
            "psql \"$NEON_RUNTIME_DATABASE_URL\" -c 'SHOW TimeZone;'",
            'RANGKAIAN_TUTUP_MASSAL_DATA_LAMA',
            'commit merge P4',
        ]) expect(runbook, text).toContain(text);
    });

    it('dokumen rilis gabungan memuat gerbang CTRL-5 dan penahanan seluruh P5', () => {
        const rilis = read('docs/RILIS_INTEGRASI_SURAT_P0_P5.md');
        for (const text of [
            '| P5-CTRL5 |',
            'RANGKAIAN_TUTUP_MASSAL_DATA_LAMA=true',
            'tahan seluruh P5',
            'sifat_tak_dikenal',
            'P0–P4 di-merge berurutan dengan CI hijau pada setiap head hasil rebase (§1); P5 **baru** di-merge di langkah 11 (§3), setelah pre-0048 langkah 10 bersih.',
        ]) expect(rilis, text).toContain(text);
        expect(read('docs/RUNBOOK_INTEGRASI_SURAT_P3.md')).toContain('Jalankan langkah ini dari commit merge P4');
    });

    it('runbook P5 dan dokumen rilis memuat langkah privileged pg_trgm sebelum 0049 (Task 14)', () => {
        const runbook = read('docs/RUNBOOK_INTEGRASI_SURAT_P5.md');
        const rilis = read('docs/RILIS_INTEGRASI_SURAT_P0_P5.md');
        for (const dokumen of [runbook, rilis]) {
            for (const text of [
                'backend/src/db/grants/0003_optional_pg_trgm.sql',
                '0049_lacak_trgm',
                'NEON_ADMIN_DATABASE_URL',
                'DROP INDEX IF EXISTS surat_masuk_nomor_norm_trgm_idx',
            ]) expect(dokumen, text).toContain(text);
            // Urutan bertahap: langkah privileged ditulis sebelum perintah migrasi yang membawa 0049.
            expect(dokumen.indexOf('0003_optional_pg_trgm.sql')).toBeLessThan(dokumen.lastIndexOf('neon-database.mjs migrate --apply'));
        }
        expect(rilis).not.toContain('Tugas opsional 14 (pg_trgm) dan 15 (re-key limiter) dilewati');
        expect(rilis).toContain('Tugas opsional 14 (pg_trgm) **dikerjakan**');
        expect(rilis).toContain('journal berisi 50 entri (idx 0–49)');
    });
});
