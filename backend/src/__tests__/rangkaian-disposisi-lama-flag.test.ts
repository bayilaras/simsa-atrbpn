import fs from 'node:fs';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRangkaianP5Database, P5_IDS, seedRangkaianBase } from './helpers/rangkaian-p5-pglite.js';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database.js', () => ({
    db: {
        select: (...args: any[]) => holder.db.select(...args),
        execute: (query: any) => holder.db.execute(query),
        transaction: (run: any) => holder.db.transaction(run),
    },
    pool: { end: async () => {} },
}));

const SM = '00000000-0000-4000-8000-000000000611';
const RS = '00000000-0000-4000-8000-000000000711';
const bpptUser = { id: P5_IDS.bppt, role: 'admin_unit', unitKerjaId: 'dir_bppt' };

let database: PGlite;
let spec: typeof import('../services/access/visibility-spec.js');
let access: typeof import('../services/record-access.service.js');

beforeAll(async () => {
    database = await createRangkaianP5Database();
    await seedRangkaianBase(database);
    await database.exec(`
        INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal, sifat_surat, disposisi)
        VALUES ('${SM}', 'ditjen', 7001, 2023, 'B-1/2023', 'Surat lama biasa', 'Biasa', ARRAY['BPPT']);
        INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, judul, tahun, selesai_at)
        VALUES ('${RS}', 'RS-2023-900011', 'data_lama', 'selesai', 'ditjen', 'Surat lama biasa', 2023, now());
        INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber)
        VALUES ('${RS}', '${SM}', 'ditjen', 'induk', 'data_lama');
        INSERT INTO rangkaian_peserta (rangkaian_id, unit_kerja_id, peran, label_asal)
        VALUES ('${RS}', 'dir_bppt', 'disposisi_lama', 'BPPT');
    `);
    holder.db = drizzle(database);
    spec = await import('../services/access/visibility-spec.js');
    access = await import('../services/record-access.service.js');
}, 180_000);
afterAll(async () => { await database?.close(); });
afterEach(() => { vi.unstubAllEnvs(); });

/** Himpunan jangkauan persis seperti yang dipakai checkRead: opsi diturunkan dari flag saat panggilan. */
const jangkauan = async () => ((await holder.db.execute(
    sql`SELECT j.unit_kerja_id AS unit FROM ${spec.jangkauanUnitsSql(sql`${RS}::uuid`, { disposisiLama: spec.isDisposisiLamaReadEnabled() })} AS j ORDER BY 1`,
)).rows as Array<{ unit: string }>).map((row) => row.unit);

describe('RANGKAIAN_DISPOSISI_LAMA_READ', () => {
    it.each([
        [undefined, false], ['', false], ['false', false], ['1', false], ['TRUE', false], [' true ', false], ['true', true],
    ])('membaca nilai %s sebagai %s', (value, expected) => {
        expect(spec.isDisposisiLamaReadEnabled({ RANGKAIAN_DISPOSISI_LAMA_READ: value } as NodeJS.ProcessEnv)).toBe(expected);
    });

    it('.env.example mendokumentasikan flag dalam keadaan mati', () => {
        const text = fs.readFileSync(path.resolve(process.cwd(), '.env.example'), 'utf8');
        expect(text).toMatch(/^RANGKAIAN_DISPOSISI_LAMA_READ=false$/m);
    });

    it('peserta data lama tidak masuk jangkauan dan tidak memberi akses saat flag mati', async () => {
        vi.stubEnv('RANGKAIAN_DISPOSISI_LAMA_READ', 'false');
        expect(await jangkauan()).toEqual(['ditjen']);
        const result = await access.recordAccessService.checkRead(bpptUser, 'surat_masuk', SM, holder.db);
        expect(result.allowed).toBe(false);
    });

    it('peserta aktif memberi akses baca via peserta saat flag menyala', async () => {
        vi.stubEnv('RANGKAIAN_DISPOSISI_LAMA_READ', 'true');
        expect(await jangkauan()).toEqual(['dir_bppt', 'ditjen']);
        const result = await access.recordAccessService.checkRead(bpptUser, 'surat_masuk', SM, holder.db);
        expect(result).toMatchObject({ allowed: true, via: 'peserta', mutable: false });
    });

    it('peserta yang sudah berakhir tidak memberi akses meski flag menyala', async () => {
        vi.stubEnv('RANGKAIAN_DISPOSISI_LAMA_READ', 'true');
        await database.exec(`UPDATE rangkaian_peserta SET berakhir_at = now(), berakhir_by = '${P5_IDS.superA}',
            alasan_berakhir = 'Dicabut setelah verifikasi TU' WHERE rangkaian_id = '${RS}'`);
        expect(await jangkauan()).toEqual(['ditjen']);
        expect((await access.recordAccessService.checkRead(bpptUser, 'surat_masuk', SM, holder.db)).allowed).toBe(false);
    });

    it('unit pengolah memberi akses tanpa flag — alasan P5 menunda pengolah dari label (spec:356)', async () => {
        vi.stubEnv('RANGKAIAN_DISPOSISI_LAMA_READ', 'false');
        await database.exec(`UPDATE rangkaian_peserta SET berakhir_at = NULL, berakhir_by = NULL, alasan_berakhir = NULL WHERE rangkaian_id = '${RS}'`);
        expect((await access.recordAccessService.checkRead(bpptUser, 'surat_masuk', SM, holder.db)).allowed).toBe(false);
        await database.exec(`UPDATE rangkaian_surat SET unit_pengolah_id = 'dir_bppt' WHERE id = '${RS}'`);
        try {
            expect((await access.recordAccessService.checkRead(bpptUser, 'surat_masuk', SM, holder.db)).allowed).toBe(true);
        } finally {
            await database.exec(`UPDATE rangkaian_surat SET unit_pengolah_id = NULL WHERE id = '${RS}'`);
        }
    });

    it('setiap kode non-test yang MEMBACA baris rangkaian_peserta (FROM/JOIN/simbol Drizzle) melewati flag', () => {
        const root = path.resolve(process.cwd(), 'src');
        const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) return entry.name === '__tests__' ? [] : walk(full);
            return entry.name.endsWith('.ts') ? [full] : [];
        });
        // Pengecualian tertutup: skema Drizzle (definisi tabel) dan rangkaian.service.ts P1
        // (gabung hanya MEMINDAHKAN baris peserta; bukan jalur baca, jangkauannya lewat jangkauanUnitsSql).
        const PENGECUALIAN = ['db/schema/rangkaian-surat.ts', 'services/rangkaian.service.ts'];
        // rangkaian-data-lama.service.ts (B-I2, dipersempit N-M1): peserta hanya dibaca untuk
        // MENGECUALIKAN rangkaian dari Tutup massal (predikat NOT, fail closed); tidak pernah
        // memberi jangkauan baca. Pengecualian dipersempit ke SATU baca yang ditandai penanda
        // GUARD-EXEMPT-B-I2 di sekitar `calonPengolahBelumDiisiSql`, bukan seluruh file: baca
        // rangkaian_peserta baru di file ini, di luar penanda, tetap gagal guard.
        const DATA_LAMA_FILE = 'services/rangkaian-data-lama.service.ts';
        const DATA_LAMA_MARKER_AWAL = '// GUARD-EXEMPT-B-I2:';
        const DATA_LAMA_MARKER_AKHIR = '// /GUARD-EXEMPT-B-I2';
        // Pola baca baris rangkaian_peserta: FROM/JOIN (dengan skema opsional dan tanda kutip),
        // koma-join, atau simbol Drizzle rangkaianPeserta.
        const POLA_BACA = /\b(?:FROM|JOIN)\s+(?:"?public"?\.)?"?rangkaian_peserta\b|,\s*"?rangkaian_peserta\b|\brangkaianPeserta\b/i;
        // Bukti melewati flag: memanggil isDisposisiLamaReadEnabled, atau memakai KonteksBaca.disposisiLamaRead /
        // opsi JangkauanOptions.disposisiLama yang hanya diisi dari flag tersebut.
        const LEWAT_FLAG = /isDisposisiLamaReadEnabled|disposisiLamaRead|disposisiLama\b/;
        const offenders = walk(root)
            .map((file) => ({ file, rel: path.relative(root, file).replaceAll('\\', '/') }))
            .filter(({ rel }) => !PENGECUALIAN.includes(rel))
            .flatMap(({ file, rel }) => {
                const content = fs.readFileSync(file, 'utf8');
                if (!POLA_BACA.test(content)) return [];
                if (LEWAT_FLAG.test(content)) return [];
                if (rel !== DATA_LAMA_FILE) return [rel];
                // Wilayah antar-penanda saja yang boleh memuat baca rangkaian_peserta.
                const awal = content.indexOf(DATA_LAMA_MARKER_AWAL);
                const akhir = content.indexOf(DATA_LAMA_MARKER_AKHIR);
                if (awal < 0 || akhir < awal) return [rel]; // penanda hilang/rusak: gagal guard
                const ditandai = content.slice(awal, akhir + DATA_LAMA_MARKER_AKHIR.length);
                const sisaFile = content.slice(0, awal) + content.slice(akhir + DATA_LAMA_MARKER_AKHIR.length);
                if (!POLA_BACA.test(ditandai)) return [rel]; // penanda tidak menandai baca apa pun
                return POLA_BACA.test(sisaFile) ? [rel] : [];
            });
        expect(offenders).toEqual([]);
    });

    // Uji-diri pola guard (C-9): memastikan bentuk FROM public., dikutip, dan koma-join tertangkap.
    it('pola guard menangkap bentuk FROM public., dikutip, dan koma-join', () => {
        const POLA_BACA = /\b(?:FROM|JOIN)\s+(?:"?public"?\.)?"?rangkaian_peserta\b|,\s*"?rangkaian_peserta\b|\brangkaianPeserta\b/i;
        expect(POLA_BACA.test('SELECT * FROM public.rangkaian_peserta jk_p')).toBe(true);
        expect(POLA_BACA.test('SELECT * FROM "rangkaian_peserta" jk_p')).toBe(true);
        expect(POLA_BACA.test('SELECT * FROM foo, rangkaian_peserta jk_p')).toBe(true);
    });
});
