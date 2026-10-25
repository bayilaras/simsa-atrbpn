# Integrasi Surat — P0 Prasyarat & Perbaikan Bug Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menyiapkan fondasi P0 integrasi surat: pre-flight produksi yang hanya-baca beserta checklist, lalu perbaikan lima bug. Kelimanya adalah 400 pada DistributeDialog, filter soft-delete yang membuang baris `is_deleted IS NULL`, `:id` yang tidak divalidasi, field fantom di InfoSection, dan normalisasi klasifikasi SQL kotak disposisi yang berbeda dari TS. Perbaikan terakhir sekaligus membuat cikal bakal `visibility-spec.ts` beserta test paritasnya.

**Architecture:** P0 tidak menambah migrasi, tabel, role, maupun endpoint baru.
- Pre-flight berupa skrip Node `.mjs` dengan daftar pemeriksaan SQL yang tetap. Skrip menjalankan semuanya dalam satu transaksi `READ ONLY` yang selalu di-`ROLLBACK`, lalu menghasilkan laporan Markdown untuk ditandatangani. Pemeriksaan divalidasi di PGlite.
- Modul baru `backend/src/services/access/visibility-spec.ts` menjadi satu-satunya sumber normalisasi klasifikasi. Bentuk TS-nya `normalizeSecurityClassification`, dipindahkan ke sini dan di-re-export dari `record-access.service.ts`. Bentuk SQL-nya `klasifikasiNormSql`/`klasifikasiInSql`.
- Kotak/keluar disposisi dan notifikasi disposisi memakai bentuk SQL tersebut.
- Sisa perbaikan bersifat lokal di validator, service, route, dan komponen React.

**Tech Stack:** Backend: Express + TypeScript, Drizzle ORM (pg / pglite), Zod, Vitest 4, supertest, `@electric-sql/pglite`, node-postgres. Frontend: React 19 JSX, Vitest + React Testing Library, ESLint.

**Spec:** docs/superpowers/specs/2026-09-26-integrasi-surat-masuk-keluar-design.md

## Global Constraints

- **Basis branch:** `git fetch origin && git switch -c feat/integrasi-surat-p0 5f57b39`. Konvensi lintas fase: satu branch per fase `feat/integrasi-surat-pN`, dibuat dari `origin/main` setelah PR fase sebelumnya dimerge; bila PR itu belum dimerge, branch ditumpuk di ujung `feat/integrasi-surat-p(N-1)` lalu di-rebase ke `origin/main` setelah merge. Satu PR per fase ke `main`. P0 adalah satu-satunya fase yang berbasis commit tetap. `5f57b39` = `origin/main` (Merge PR #14). Semua nomor baris di rencana ini mengacu ke commit tersebut. Saat mengedit, cocokkan dengan teks kode, bukan nomor baris.
- **Urutan merge:** PR P0 dimerge **setelah** PR #15 (branch `merge/local-worktree-20260926-safe`, head `3f90404`), lalu di-rebase ke `origin/main` (Task 9).
  - PR #15 menyentuh `surat-masuk.routes.ts` (:109-456), `surat-keluar.routes.ts` (:234-445), `surat-keluar.service.ts` `getStats` (:587), dan `surat-masuk.service.ts` (`getStats` + `log` di :45).
  - Hunk P0 tidak tumpang tindih dengan area itu.
- **Migrasi:** P0 **tidak** menambah migrasi. Migrasi berikutnya (P1) adalah idx **46**, `when` 1789397417667, tag `0046_rangkaian_surat`. File ditulis tangan dengan akhir baris LF dan pemisah `--> statement-breakpoint`. **Dilarang** menjalankan `drizzle-kit generate`/`npm run db:generate`.
- **Audit:** P0 tidak menambah mutasi. `distribute()` tetap memakai `auditLogService.logActionOrThrow({... entityType: 'surat_distribution'}, tx)` di dalam transaksi. Mutasi baru pada fase berikutnya wajib `logActionOrThrow(..., tx)`.
- **Role (D5):** tidak ada role baru; hanya `super_admin` dan `admin_unit`. Pengawas = FULL_ADMIN yang unit efektifnya `unit_kerja.is_unit_pengawas=true`, dan ini baru dibangun di P1/P2. **D6:** `bagian_*` hanya label.
- **Tidak boleh diubah di P0:**
  - `recordAccessService.check()`, `inspect()`, `allowedSecurityClassifications`, `isAllowedForRecordUnit`, `isAllowedForClassification`
  - `SuratMasukService.getStats`, `SuratKeluarService.getStats`
  - `arsip.service`, `ArchiveDialog`, `KlasifikasiPicker`, `dosir.service`, producer SRIKANDI
- **Salinan normalisasi SQL lain** di `surat-masuk.service.ts:45-55`, `dosir.service.ts:40-50`, `dashboard.service.ts:~45`, `global-search.service.ts:~68`, `report.service.ts:~109`, dan blok pending di `notification.service.ts:29-50` **tidak** diubah di P0. Alasannya: mengubahnya berarti mengubah daftar surat masuk atau `getStats` yang disentuh PR #15. Pemindahan salinan ini **tidak dimiliki fase mana pun di P1–P5** (tinjauan konsistensi lintas fase 2026-09-26): P2 hanya memakai `visibility-spec.ts` untuk jalur baru (`checkRead`/`checkMany`/`visibleSql`, kotak disposisi, seed Lacak, daftar rangkaian), dan P1/P3/P4 melarang menyentuh `dosir.service`/`getStats`. Konsolidasi salinan lama dicatat sebagai pekerjaan lanjutan di luar rencana ini.
- **Pre-flight hanya-baca:**
  - Koneksi lewat `PREFLIGHT_DATABASE_URL` dengan role Neon read-only. Skrip tidak pernah membaca `DATABASE_URL`.
  - Transaksi `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`, `statement_timeout` 15s, lalu `ROLLBACK`.
  - Laporan tidak memuat perihal, nomor, maupun isi surat.
- **Perintah test:**
  - Backend satu file: `cd backend && npx vitest run <path>`; seluruh suite: `cd backend && npm test`; typecheck: `cd backend && npx tsc --noEmit -p tsconfig.json`. `src/__tests__` dikecualikan dari tsc, jadi test baru diletakkan di sana.
  - Frontend: `cd frontend && npx vitest run <path>`, `cd frontend && npx eslint <files>`.
- **Commit:** setiap task diakhiri satu commit. Pesan memakai dua `-m`; `-m` kedua persis `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, sehingga ada baris kosong sebelum trailer.
- **Bahasa:** prosa dan pesan UI dalam Bahasa Indonesia; identifier tetap apa adanya.

## Review Focus

1. **Nilai `sifat_surat` dengan whitespace non-ASCII atau string kosong.**
   - TS `trim()`/`\s` membuang NBSP, TAB, U+3000, dan U+FEFF, sedangkan `trim()` Postgres hanya membuang spasi.
   - `''` menjadi `biasa` di TS (`'' || 'biasa'`), tetapi `coalesce('', 'biasa')` di SQL menghasilkan `''`.
   - Test: Task 2 memindai seluruh code point untuk memastikan `JS_WHITESPACE_CODEPOINTS` sama dengan himpunan `\s` ECMAScript. Task 2 juga menjalankan paritas TS↔SQL di PGlite atas nilai prod, variannya, dan setiap whitespace. Task 1 menguji hal yang sama untuk ekspresi SQL yang tertanam di skrip pre-flight.
2. **`instruction: null`, tipe salah, dan panjang >2000 pada `POST /api/distributions`.** Test route Task 4 memakai skema Zod asli (tidak di-mock); kasus: `null`, tidak ada, string, angka, objek, array, 2001 karakter.
3. **Baris lama dengan `is_deleted IS NULL`** yang hilang dari daftar surat keluar dan notifikasi, serta baris `is_deleted = true` yang masih muncul di notifikasi disposisi.
   - Task 5: SQL yang dirender PgDialect harus memuat `IS NOT TRUE`, baik dengan scope unit maupun `null`/super_admin.
   - Task 6: data NULL/true/false dijalankan di PGlite.
4. **`:id` yang bukan UUID** pada `/balasan`, `/with-links`, `/source`, dan `/archive-full`.
   - Kasus uji: string biasa, angka, injeksi `' OR '1'='1`, UUID kurang/lebih satu digit, UUID tanpa tanda hubung, UUID dengan spasi di belakang, dan huruf non-hex.
   - UUID huruf besar harus tetap lolos, dan `/archive` (410) tidak berubah.
   - Semua kasus diuji di Task 7 tanpa pemanggilan service maupun `recordAccessService`.
5. **Keamanan pre-flight** (Task 1):
   - pemeriksaan yang berisi DML/DDL, `SELECT … INTO`, CTE `UPDATE`, atau `;` ditolak **sebelum** transaksi dibuka;
   - satu pemeriksaan gagal tidak membatalkan yang lain (SAVEPOINT);
   - transaksi selalu diakhiri `ROLLBACK`.

   Terkait tampilan, InfoSection Task 8 juga menguji tiga hal: label disposisi kosong/whitespace dari data lama (±100 baris) disaring, klasifikasi `RAHASIA`/`Sangat Segera` hasil impor tidak lagi tampil sebagai "Biasa", dan nilai sifat `constructor` tidak merusak render.

---

## File Structure

| File | Status | Tanggung jawab |
|---|---|---|
| `backend/scripts/preflight-integrasi-surat.mjs` | BARU | Daftar pemeriksaan pre-flight (`PREFLIGHT_CHECKS`), penjaga baca-saja, runner transaksi `READ ONLY`, formatter laporan Markdown dan fixture JSON `sifat_surat`, serta CLI |
| `backend/src/__tests__/preflight-integrasi-surat.test.ts` | BARU | Menjalankan semua pemeriksaan di PGlite (fixture skema minimal), paritas kelas, penjaga tulis, dan urutan transaksi |
| `backend/package.json` | UBAH (:34) | Script `db:preflight:integrasi-surat` |
| `docs/PREFLIGHT_INTEGRASI_SURAT_P0.md` | BARU | Checklist operator: cara menjalankan, tabel keputusan per pemeriksaan, pengesahan |
| `backend/src/services/access/visibility-spec.ts` | BARU | `SECURITY_CLASSES`, `BIASA_SIFAT_ALIASES`, `JS_WHITESPACE_CODEPOINTS`, `normalizeSecurityClassification`, `klasifikasiNormSql`, `klasifikasiInSql` |
| `backend/src/services/record-access.service.ts` | UBAH (:1-3, :26, :44-66) | Impor dan re-export `normalizeSecurityClassification`, `RECOGNIZED_CLASSIFICATIONS` dari `SECURITY_CLASSES` |
| `backend/src/__tests__/fixtures/sifat-surat-produksi.json` | BARU | Daftar distinct `sifat_surat` produksi (diregenerasi dari pre-flight) |
| `backend/src/__tests__/visibility-spec.parity.test.ts` | BARU | Paritas TS↔SQL di PGlite |
| `backend/src/__tests__/helpers/surat-inbox-pglite.ts` | BARU | Fixture PGlite `unit_kerja`/`surat_masuk`/`surat_distributions` untuk test service |
| `backend/src/services/distribution.service.ts` | UBAH (:3, :15-25, :35, :~91) | `incomingSecurityCondition` → `klasifikasiInSql`; `instruction` nullable |
| `backend/src/__tests__/distribution-inbox-classification.test.ts` | BARU | `findInbox`/`findOutbox` nyata di PGlite ('Sangat Segera' tampil) |
| `backend/src/validators/schemas.ts` | UBAH (:557) | `instruction: z.string().max(2000).nullish()` |
| `backend/src/__tests__/schemas.test.ts` | UBAH (:171-190) | Kasus `instruction` null/panjang |
| `backend/src/__tests__/distribution-create-validation.routes.test.ts` | BARU | `POST /distributions` dengan validator asli |
| `backend/src/services/surat-keluar.service.ts` | UBAH (:53-55) | `is_deleted IS NOT TRUE` di `findAll` |
| `backend/src/__tests__/surat-keluar-list-deleted.test.ts` | BARU | SQL `findAll` via PgDialect |
| `backend/src/services/notification.service.ts` | UBAH (:17-24, :185-190, :326-331) | `is_deleted IS NOT TRUE` (pending & disposisi); disposisi memakai `klasifikasiInSql` |
| `backend/src/__tests__/notification-deleted-classification.test.ts` | BARU | Notifikasi pending & disposisi di PGlite |
| `backend/src/routes/surat-masuk.routes.ts` | UBAH (:499, :558, :586) | `validateIdParam()` |
| `backend/src/routes/surat-keluar.routes.ts` | UBAH (:493, :557, :587) | `validateIdParam()` |
| `backend/src/__tests__/surat-id-param.routes.test.ts` | BARU | 400 untuk `:id` tidak valid dengan middleware asli |
| `frontend/src/components/surat-masuk/InfoSection.jsx` | UBAH (seluruh file, 1-151) | Hapus field fantom; tampilkan No. Agenda (`noUrut`), Disposisi, Keterangan; label sifat yang dinormalisasi |
| `frontend/src/components/surat-masuk/__tests__/InfoSection.test.jsx` | UBAH (seluruh file) | RTL untuk perilaku baru |

---

### Task 1: Pre-flight produksi read-only dan checklist

**Files:**
- Create: `backend/scripts/preflight-integrasi-surat.mjs`
- Create: `backend/src/__tests__/preflight-integrasi-surat.test.ts`
- Create: `docs/PREFLIGHT_INTEGRASI_SURAT_P0.md`
- Modify: `backend/package.json:34` (setelah `"db:migrate": "node scripts/migrate-database.mjs",`)
- Test: `backend/src/__tests__/preflight-integrasi-surat.test.ts`

**Interfaces:**
- Consumes: `normalizeSecurityClassification(classification?: string | null): string` dari `backend/src/services/record-access.service.ts` (hanya di test); `pg.Client`; `dotenv`.
- Produces:
  - `PREFLIGHT_TRANSACTION: string`
  - `PREFLIGHT_CHECKS: Array<{ id: string; judul: string; keputusan: string; sql: string }>`
  - `assertReadOnlySql(id: string, sqlText: string): void` (throw `Error` bila bukan satu query baca)
  - `runPreflight(client: { query(text: string): Promise<{ rows: object[] }> }, checks?: typeof PREFLIGHT_CHECKS): Promise<Array<{ id; judul; keputusan; sql; rows: object[]; error: string | null }>>`
  - `formatReport(results, generatedAt?: string): string`
  - `formatSifatFixture(results): string`
  - CLI `node scripts/preflight-integrasi-surat.mjs [--format=markdown|sifat-json]`

- [ ] **Step 1: Tulis test yang gagal**

Buat `backend/src/__tests__/preflight-integrasi-surat.test.ts`:

```ts
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    PREFLIGHT_CHECKS,
    PREFLIGHT_TRANSACTION,
    assertReadOnlySql,
    formatReport,
    formatSifatFixture,
    runPreflight,
} from '../../scripts/preflight-integrasi-surat.mjs';
import { normalizeSecurityClassification } from '../services/record-access.service';

const uuid = (prefix: number, n: number) =>
    `${String(prefix).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Himpunan \s ECMAScript dihitung langsung dari mesin JS, bukan disalin.
const JS_WHITESPACE = Array.from({ length: 0x10000 }, (_, cp) => cp)
    .filter(cp => (cp < 0xd800 || cp > 0xdfff) && /\s/.test(String.fromCharCode(cp)));

const SIFAT_VALUES: Array<string | null> = [
    'Sangat Segera', 'biasa', 'Rahasia', 'Terbatas', '', null, ' Biasa ', 'sangat-segera', 'Biasa/Terbuka',
    ...JS_WHITESPACE.map(cp => {
        const ch = String.fromCharCode(cp);
        return `${ch}Sangat${ch}Segera${ch}`;
    }),
];

const L1 = uuid(1, 1); // 'Sangat Segera'
const L2 = uuid(1, 2); // 'biasa', perihal NULL
const L3 = uuid(1, 3); // 'Rahasia'
const L4 = uuid(1, 4); // 'Terbatas'

const SCHEMA = `
CREATE SCHEMA drizzle;
CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);
CREATE TABLE unit_kerja (id varchar(50) PRIMARY KEY, name varchar(255) NOT NULL, parent_id varchar(50),
    unit_type varchar(30), can_receive_distribution boolean DEFAULT true);
CREATE TABLE users (id uuid PRIMARY KEY, role varchar(50) NOT NULL, unit_kerja_id varchar(50));
CREATE TABLE surat_masuk (id uuid PRIMARY KEY, unit_kerja_id varchar(50) NOT NULL, tahun integer NOT NULL,
    sifat_surat varchar(50), perihal text, disposisi text[], tanggal_surat date, is_deleted boolean DEFAULT false,
    created_by uuid, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE surat_keluar (id uuid PRIMARY KEY, unit_kerja_id varchar(50) NOT NULL, balasan_untuk uuid,
    klasifikasi_keamanan varchar(30));
CREATE INDEX idx_surat_keluar_balasan ON surat_keluar (balasan_untuk) WHERE balasan_untuk IS NOT NULL;
CREATE TABLE surat_distributions (id uuid PRIMARY KEY, surat_masuk_id uuid NOT NULL, source_unit_id varchar(50) NOT NULL,
    target_unit_id varchar(50) NOT NULL, status varchar(20) NOT NULL DEFAULT 'sent', sent_at timestamp NOT NULL DEFAULT now());
`;

let database: PGlite;
let results: Awaited<ReturnType<typeof runPreflight>>;
const byId = (id: string) => {
    const result = results.find(item => item.id === id);
    if (!result) throw new Error(`pemeriksaan ${id} tidak ada`);
    return result;
};

beforeAll(async () => {
    database = new PGlite();
    await database.exec(SCHEMA);
    await database.exec(`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
            SELECT 'h' || g, CASE WHEN g = 45 THEN 1789397416667 ELSE g END FROM generate_series(0, 45) AS g;
        INSERT INTO unit_kerja (id, name) VALUES ('ditjen', 'Ditjen'), ('sesditjen', 'Sesditjen'),
            ('dir_bppt', 'Dit. BPPT'), ('direktorat-ptep', 'Direktorat PTEP');
        INSERT INTO users (id, role, unit_kerja_id) VALUES
            ('${uuid(9, 1)}', 'admin_unit', 'sesditjen'), ('${uuid(9, 2)}', 'admin_sesditjen', NULL);
    `);
    for (const [index, sifat] of SIFAT_VALUES.entries()) {
        await database.query(
            `INSERT INTO surat_masuk (id, unit_kerja_id, tahun, sifat_surat, perihal, tanggal_surat)
             VALUES ($1, 'ditjen', 2026, $2, $3, '2026-09-01')`,
            [uuid(1, index + 1), sifat, index === 1 ? null : `Perihal ${index + 1}`],
        );
    }
    await database.exec(`
        UPDATE surat_masuk SET disposisi = ARRAY['BPPT', ' Dit.  BPPT ', ''] WHERE id = '${L1}';
        INSERT INTO surat_distributions (id, surat_masuk_id, source_unit_id, target_unit_id, status) VALUES
            ('${uuid(2, 1)}', '${L1}', 'ditjen', 'dir_bppt', 'sent'),
            ('${uuid(2, 2)}', '${L1}', 'ditjen', 'dir_bppt', 'received'),
            ('${uuid(2, 3)}', '${L2}', 'ditjen', 'dir_bppt', 'rejected'),
            ('${uuid(2, 4)}', '${L2}', 'ditjen', 'dir_bppt', 'sent'),
            ('${uuid(2, 5)}', '${L3}', 'ditjen', 'dir_bppt', 'terkirim'),
            ('${uuid(2, 6)}', '${L4}', 'ditjen', 'ditjen', 'processed');
        INSERT INTO surat_keluar (id, unit_kerja_id, balasan_untuk, klasifikasi_keamanan) VALUES
            ('${uuid(3, 1)}', 'ditjen', '${L1}', 'biasa'),
            ('${uuid(3, 2)}', 'dir_bppt', '${L2}', NULL);
    `);
    results = await runPreflight(database);
}, 60_000);

afterAll(async () => { await database?.close(); });

describe('pre-flight P0 integrasi surat di PGlite', () => {
    it('menjalankan setiap pemeriksaan tanpa galat', () => {
        expect(results.filter(result => result.error).map(result => [result.id, result.error])).toEqual([]);
        expect(results.map(result => result.id)).toEqual(PREFLIGHT_CHECKS.map(check => check.id));
    });

    it('melaporkan status migrasi, unit kerja, dan pengguna', () => {
        expect(byId('status_migrasi').rows).toEqual([{ jumlah_migrasi: 46, migrasi_terakhir_when: '1789397416667' }]);
        const direktorat = Object.fromEntries(byId('unit_kerja_direktorat').rows.map((row: any) => [row.unit_id, row.ada]));
        expect(direktorat).toMatchObject({ ditjen: true, sesditjen: true, dir_bppt: true, dir_ptep: false, dir_ktpp: false, dir_plp: false });
        expect(byId('unit_kerja_id_direktorat_dash').rows).toEqual([{ id: 'direktorat-ptep', name: 'Direktorat PTEP' }]);
        expect(byId('pengguna_per_role_unit').rows).toEqual([
            { role: 'admin_sesditjen', unit_kerja_id: '(NULL)', jumlah: 1 },
            { role: 'admin_unit', unit_kerja_id: 'sesditjen', jumlah: 1 },
        ]);
    });

    it('mendeteksi distribusi aktif ganda, status tak dikenal, dan target = sumber', () => {
        expect(byId('distribusi_aktif_ganda').rows).toEqual([expect.objectContaining({
            surat_masuk_id: L1, target_unit_id: 'dir_bppt', jumlah: 2, statuses: ['sent', 'received'],
        })]);
        expect(byId('distribusi_status_tak_dikenal').rows).toEqual([
            { id: uuid(2, 5), surat_masuk_id: L3, target_unit_id: 'dir_bppt', status: 'terkirim' },
        ]);
        expect(byId('distribusi_target_sama_dengan_sumber').rows).toEqual([{ jumlah: 1 }]);
        expect(byId('distribusi_per_status').rows).toEqual([
            { status: 'processed', jumlah: 1 }, { status: 'received', jumlah: 1 }, { status: 'rejected', jumlah: 1 },
            { status: 'sent', jumlah: 2 }, { status: 'terkirim', jumlah: 1 },
        ]);
    });

    it('menandai index manual yang ada dan tidak menemukan bentrok objek 0046', () => {
        const objects = Object.fromEntries(byId('index_dan_objek_bentrok').rows.map((row: any) => [row.nama, row.sudah_ada]));
        expect(objects.idx_surat_keluar_balasan).toBe(true);
        expect(Object.entries(objects).filter(([nama, ada]) => nama !== 'idx_surat_keluar_balasan' && ada)).toEqual([]);
        expect(byId('kolom_bentrok').rows).toEqual([]);
        expect(byId('index_manual_surat').rows).toContainEqual(expect.objectContaining({
            tablename: 'surat_keluar', indexname: 'idx_surat_keluar_balasan',
        }));
    });

    it('meringkas data lama, label disposisi, dan balasan lintas unit', () => {
        expect(byId('data_lama_ringkasan').rows[0]).toMatchObject({
            total: SIFAT_VALUES.length, hidup: SIFAT_VALUES.length, tanpa_pembuat: SIFAT_VALUES.length,
            berlabel_disposisi: 1, perihal_kosong: 1,
        });
        expect(byId('label_disposisi').rows).toEqual(expect.arrayContaining([
            { label_norm: 'bppt', jumlah: 1 }, { label_norm: 'dit. bppt', jumlah: 1 }, { label_norm: '', jumlah: 1 },
        ]));
        expect(byId('balasan_lintas_unit').rows).toEqual([{ balasan_same_unit: 1, balasan_lintas_unit: 1 }]);
    });

    it('menghitung kelas baru yang identik dengan normalizeSecurityClassification untuk setiap nilai', () => {
        const rows = byId('sifat_surat_kelas').rows as Array<{ nilai: string | null; kelas_lama: string; kelas_baru: string }>;
        expect(rows).toHaveLength(SIFAT_VALUES.length);
        const mismatches = rows
            .filter(row => row.kelas_baru !== normalizeSecurityClassification(row.nilai))
            .map(row => ({ nilai: row.nilai, sql: row.kelas_baru, ts: normalizeSecurityClassification(row.nilai) }));
        expect(mismatches).toEqual([]);
        expect(rows.find(row => row.nilai === 'Sangat Segera')).toMatchObject({ kelas_lama: 'sangat_segera', kelas_baru: 'biasa' });
    });

    it('menghitung disposisi terbuka per kelas lama dan baru', () => {
        expect(byId('distribusi_terbuka_per_kelas').rows).toEqual([
            { kelas_baru: 'biasa', kelas_lama: 'biasa', status: 'sent', jumlah: 1 },
            { kelas_baru: 'biasa', kelas_lama: 'sangat_segera', status: 'received', jumlah: 1 },
            { kelas_baru: 'biasa', kelas_lama: 'sangat_segera', status: 'sent', jumlah: 1 },
        ]);
    });

    it('menghasilkan fixture JSON berisi semua nilai distinct sifat_surat', () => {
        expect(new Set(JSON.parse(formatSifatFixture(results)))).toEqual(new Set(SIFAT_VALUES));
    });
});

describe('disiplin transaksi dan penjaga baca-saja', () => {
    it('membuka satu transaksi READ ONLY, mengisolasi kegagalan per pemeriksaan, dan selalu ROLLBACK', async () => {
        const statements: string[] = [];
        const client = {
            async query(text: string) {
                statements.push(text);
                if (text === 'SELECT 1 AS gagal') throw Object.assign(new Error('boom'), { code: '42P01' });
                return { rows: text === 'SELECT 2 AS ok' ? [{ ok: 2 }] : [] };
            },
        };
        const out = await runPreflight(client, [
            { id: 'a', judul: 'A', keputusan: 'x', sql: 'SELECT 1 AS gagal' },
            { id: 'b', judul: 'B', keputusan: 'y', sql: 'SELECT 2 AS ok' },
        ]);
        expect(statements.slice(0, 3)).toEqual([
            PREFLIGHT_TRANSACTION,
            "SET LOCAL statement_timeout = '15s'",
            'SET LOCAL standard_conforming_strings = on',
        ]);
        expect(statements).toContain('ROLLBACK TO SAVEPOINT preflight_check');
        expect(statements.at(-1)).toBe('ROLLBACK');
        expect(out.map(result => [result.id, result.error])).toEqual([['a', '42P01: boom'], ['b', null]]);
        expect(out[1].rows).toEqual([{ ok: 2 }]);
    });

    it.each([
        'DELETE FROM surat_distributions',
        'SELECT 1; DROP TABLE unit_kerja',
        'WITH x AS (UPDATE unit_kerja SET name = name RETURNING id) SELECT * FROM x',
        'SELECT * INTO salinan FROM unit_kerja',
        'CREATE TABLE t (id int)',
        'VALUES (1)',
    ])('menolak SQL non-baca sebelum membuka transaksi: %s', async (sqlText) => {
        const statements: string[] = [];
        const client = { async query(text: string) { statements.push(text); return { rows: [] }; } };
        await expect(runPreflight(client, [{ id: 'jahat', judul: 'J', keputusan: '-', sql: sqlText }]))
            .rejects.toThrow(/jahat/);
        expect(statements).toEqual([]);
    });

    it('semua pemeriksaan bawaan lolos penjaga baca-saja dan ber-id unik', () => {
        for (const check of PREFLIGHT_CHECKS) expect(() => assertReadOnlySql(check.id, check.sql)).not.toThrow();
        expect(new Set(PREFLIGHT_CHECKS.map(check => check.id)).size).toBe(PREFLIGHT_CHECKS.length);
    });

    it('menulis laporan markdown dengan sel yang di-escape dan blok pengesahan', () => {
        const text = formatReport([
            { id: 'contoh', judul: 'Contoh', keputusan: 'Harus 0 baris', sql: 'SELECT 1', rows: [{ nilai: 'a|b', daftar: ['x', null], kosong: null }], error: null },
            { id: 'rusak', judul: 'Rusak', keputusan: '-', sql: 'SELECT 1', rows: [], error: '42P01: relation missing' },
        ], '2026-09-26T00:00:00.000Z');
        expect(text).toContain('# Laporan Pre-flight P0 Integrasi Surat');
        expect(text).toContain('Ringkasan: 2 pemeriksaan, 1 gagal.');
        expect(text).toContain('| nilai | daftar | kosong |');
        expect(text).toContain('| a\\|b | {x, NULL} | NULL |');
        expect(text).toContain('**GAGAL:** 42P01: relation missing');
        expect(text).toContain('## Pengesahan');
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/preflight-integrasi-surat.test.ts`
Expected: FAIL, galat resolusi modul `../../scripts/preflight-integrasi-surat.mjs` (file belum ada).

- [ ] **Step 3: Implementasi runner**

Buat `backend/scripts/preflight-integrasi-surat.mjs` (LF sesuai `.gitattributes`):

```js
#!/usr/bin/env node
// Pre-flight produksi P0 Integrasi Surat. HANYA BACA: semua pemeriksaan berjalan
// dalam satu transaksi READ ONLY yang selalu di-ROLLBACK. Jangan menambah
// pemeriksaan yang menulis; assertReadOnlySql menolaknya sebelum koneksi dipakai.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Client } from 'pg';

export const PREFLIGHT_TRANSACTION = 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY';
const MAX_ROWS_PER_CHECK = 500;

// Harus sama dengan BIASA_SIFAT_ALIASES dan JS_WHITESPACE_CODEPOINTS di
// src/services/access/visibility-spec.ts. Paritas dijaga oleh
// src/__tests__/preflight-integrasi-surat.test.ts (sifat_surat_kelas).
const BIASA_LIST = `'biasa', 'biasa/terbuka', 'terbuka', 'segera', 'sangat_segera', 'undangan', 'penting'`;
const JS_WHITESPACE_CODEPOINTS = [
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];
const WS = JS_WHITESPACE_CODEPOINTS.map(cp => `\\u${cp.toString(16).padStart(4, '0')}`).join('');

function kelasLamaSql(column) {
  return `CASE WHEN lower(coalesce(${column}, 'biasa')) IN (${BIASA_LIST}) THEN 'biasa' `
    + `ELSE replace(replace(lower(coalesce(${column}, 'biasa')), ' ', '_'), '-', '_') END`;
}

function kelasBaruSql(column) {
  const base = `regexp_replace(lower(regexp_replace(coalesce(nullif(${column}, ''), 'biasa'), `
    + `'^[${WS}]+|[${WS}]+$', '', 'g')), '[${WS}-]+', '_', 'g')`;
  return `CASE WHEN ${base} IN (${BIASA_LIST}) THEN 'biasa' ELSE ${base} END`;
}

export const PREFLIGHT_CHECKS = [
  {
    id: 'status_migrasi',
    judul: 'Rantai migrasi yang sudah diterapkan',
    keputusan: 'Harus jumlah_migrasi = 46 (0000-0045) dan migrasi_terakhir_when = 1789397416667. Selain itu: HENTIKAN, samakan migrasi dulu.',
    sql: `SELECT count(*)::int AS jumlah_migrasi, max(created_at)::text AS migrasi_terakhir_when
FROM drizzle.__drizzle_migrations`,
  },
  {
    id: 'unit_kerja_semua',
    judul: 'Seluruh baris unit_kerja',
    keputusan: 'Arsipkan sebagai bukti. Cocokkan nama resmi; koreksi nama lewat PUT /api/settings/unit-kerja/:id (super_admin).',
    sql: `SELECT id, name, parent_id, unit_type, can_receive_distribution
FROM unit_kerja
ORDER BY id`,
  },
  {
    id: 'unit_kerja_direktorat',
    judul: 'Keberadaan unit ditjen, sesditjen, dan dir_*',
    keputusan: 'Unit dengan ada=false akan dibuat oleh 0047 (P1). parent_id/unit_type yang sudah terisi tidak ditimpa.',
    sql: `SELECT expected.id AS unit_id, (u.id IS NOT NULL) AS ada, u.parent_id, u.unit_type, u.can_receive_distribution
FROM (VALUES ('ditjen'), ('sesditjen'), ('dir_bppt'), ('dir_ptep'), ('dir_ktpp'), ('dir_plp')) AS expected(id)
LEFT JOIN unit_kerja u ON u.id = expected.id
ORDER BY expected.id`,
  },
  {
    id: 'unit_kerja_id_direktorat_dash',
    judul: 'Unit ber-id direktorat-* (0047 fail-closed)',
    keputusan: 'Harus 0 baris. Bila ada, 0047 akan RAISE: putuskan pemetaan bersama pemilik data sebelum P1 (tidak ada rename otomatis).',
    sql: `SELECT id, name
FROM unit_kerja
WHERE id ~ '^direktorat-'
ORDER BY id`,
  },
  {
    id: 'pengguna_per_role_unit',
    judul: 'Jumlah pengguna per role dan unit',
    keputusan: 'Identifikasi calon pengawas (admin_unit di sesditjen/ditjen, admin_dirjen, admin_sesditjen). staff/auditor tidak mendapat jangkauan lintas unit (D5).',
    sql: `SELECT role, coalesce(unit_kerja_id, '(NULL)') AS unit_kerja_id, count(*)::int AS jumlah
FROM users
GROUP BY role, unit_kerja_id
ORDER BY role, unit_kerja_id`,
  },
  {
    id: 'distribusi_per_status',
    judul: 'Jumlah surat_distributions per status',
    keputusan: 'Arsipkan sebagai bukti baseline.',
    sql: `SELECT status, count(*)::int AS jumlah
FROM surat_distributions
GROUP BY status
ORDER BY status`,
  },
  {
    id: 'distribusi_status_tak_dikenal',
    judul: 'Distribusi dengan status di luar sent/received/processed/rejected',
    keputusan: 'Harus 0 baris; bila ada, precheck 0046 akan RAISE. Rekonsiliasi lewat aplikasi (terima/proses/tolak) sebelum P1.',
    sql: `SELECT id, surat_masuk_id, target_unit_id, status
FROM surat_distributions
WHERE status IS NULL OR status NOT IN ('sent', 'received', 'processed', 'rejected')
ORDER BY sent_at, id`,
  },
  {
    id: 'distribusi_aktif_ganda',
    judul: 'Distribusi non-rejected ganda per (surat_masuk_id, target_unit_id)',
    keputusan: 'Harus 0 baris; bila ada, precheck 0046 dan index unik aktif akan gagal. Rekonsiliasi: target menolak baris yang lebih baru dengan alasan.',
    sql: `SELECT surat_masuk_id, target_unit_id, count(*)::int AS jumlah,
       array_agg(id::text ORDER BY sent_at, id) AS distribusi_ids,
       array_agg(status ORDER BY sent_at, id) AS statuses
FROM surat_distributions
WHERE status <> 'rejected'
GROUP BY surat_masuk_id, target_unit_id
HAVING count(*) > 1
ORDER BY jumlah DESC, surat_masuk_id, target_unit_id`,
  },
  {
    id: 'distribusi_target_sama_dengan_sumber',
    judul: 'Distribusi dengan target = sumber',
    keputusan: 'Catat jumlahnya. P3 menolak baris baru seperti ini; baris lama tetap ikut backfill langkah 1.',
    sql: `SELECT count(*)::int AS jumlah
FROM surat_distributions
WHERE target_unit_id = source_unit_id`,
  },
  {
    id: 'index_dan_objek_bentrok',
    judul: 'Objek yang akan dibuat 0046 (index, constraint, tabel, sequence)',
    keputusan: 'idx_surat_keluar_balasan boleh true atau false (0046 memakai IF NOT EXISTS). Semua objek lain harus false; bila true, 0046 akan gagal.',
    sql: `SELECT o.nama, o.jenis,
       CASE o.jenis
         WHEN 'index' THEN EXISTS (SELECT 1 FROM pg_indexes i WHERE i.schemaname = 'public' AND i.indexname = o.nama)
         WHEN 'constraint' THEN EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = o.nama)
         ELSE to_regclass('public.' || o.nama) IS NOT NULL
       END AS sudah_ada
FROM (VALUES
  ('idx_surat_keluar_balasan', 'index'),
  ('surat_masuk_nomor_norm_idx', 'index'),
  ('surat_keluar_nomor_norm_idx', 'index'),
  ('surat_distributions_active_target_uidx', 'index'),
  ('surat_distributions_target_status_idx', 'index'),
  ('surat_distributions_rangkaian_idx', 'index'),
  ('surat_distributions_status_check', 'constraint'),
  ('surat_keluar_asal_naskah_check', 'constraint'),
  ('rangkaian_surat', 'relation'),
  ('rangkaian_anggota', 'relation'),
  ('rangkaian_relasi', 'relation'),
  ('rangkaian_peserta', 'relation'),
  ('rangkaian_koreksi_berkas', 'relation'),
  ('disposisi_label_unit', 'relation'),
  ('rangkaian_surat_kode_seq', 'relation')
) AS o(nama, jenis)
ORDER BY o.jenis, o.nama`,
  },
  {
    id: 'kolom_bentrok',
    judul: 'Kolom yang akan ditambahkan 0046',
    keputusan: 'Harus 0 baris.',
    sql: `SELECT c.table_name::text AS table_name, c.column_name::text AS column_name
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND (c.table_name::text, c.column_name::text) IN (
    ('unit_kerja', 'is_unit_pengawas'), ('surat_keluar', 'asal_naskah'),
    ('surat_distributions', 'rangkaian_id'), ('surat_distributions', 'batas_waktu'),
    ('surat_distributions', 'penanggung_jawab'), ('surat_distributions', 'processed_by'),
    ('surat_distributions', 'penyelesaian_surat_keluar_id'), ('surat_distributions', 'catatan_penyelesaian'),
    ('surat_distributions', 'ditutup_pengawas'))
ORDER BY 1, 2`,
  },
  {
    id: 'index_manual_surat',
    judul: 'Seluruh index pada tabel surat dan unit_kerja',
    keputusan: 'Arsipkan. Index yang tidak berasal dari rantai migrasi (mis. dari add_soft_delete_and_indexes.sql) dicatat sebagai index manual.',
    sql: `SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename IN ('surat_masuk', 'surat_keluar', 'surat_distributions', 'unit_kerja')
ORDER BY tablename, indexname`,
  },
  {
    id: 'ekstensi',
    judul: 'Ketersediaan dan instalasi pg_trgm / pgcrypto',
    keputusan: 'pg_trgm tidak memblokir P0-P4. Bila installed_version NULL, fase opsional P5 memerlukan langkah privileged satu kali.',
    sql: `SELECT e.name, e.default_version, e.installed_version
FROM pg_available_extensions e
WHERE e.name IN ('pg_trgm', 'pgcrypto')
ORDER BY e.name`,
  },
  {
    id: 'data_lama_ringkasan',
    judul: 'Ringkasan surat_masuk (indikasi data lama)',
    keputusan: 'Menjawab pertanyaan terbuka #2: bila ada sekitar 2.047 surat lama (created_by NULL, berlabel disposisi), backfill langkah 2 (P5) diperlukan.',
    sql: `SELECT count(*)::int AS total,
       count(*) FILTER (WHERE is_deleted IS NOT TRUE)::int AS hidup,
       count(*) FILTER (WHERE created_by IS NULL)::int AS tanpa_pembuat,
       count(*) FILTER (WHERE coalesce(cardinality(disposisi), 0) > 0)::int AS berlabel_disposisi,
       count(*) FILTER (WHERE nullif(trim(perihal), '') IS NULL)::int AS perihal_kosong,
       min(tanggal_surat)::text AS tanggal_surat_min, max(tanggal_surat)::text AS tanggal_surat_max,
       min(created_at)::text AS dibuat_min, max(created_at)::text AS dibuat_max
FROM surat_masuk`,
  },
  {
    id: 'data_lama_per_unit_tahun',
    judul: 'surat_masuk per unit dan tahun',
    keputusan: 'Arsipkan sebagai baseline volume untuk P4 (target p95 Lacak) dan P5.',
    sql: `SELECT unit_kerja_id, tahun, count(*)::int AS jumlah,
       count(*) FILTER (WHERE created_by IS NULL)::int AS tanpa_pembuat
FROM surat_masuk
GROUP BY unit_kerja_id, tahun
ORDER BY unit_kerja_id, tahun`,
  },
  {
    id: 'label_disposisi',
    judul: 'Label disposisi bebas (normalisasi langkah 2)',
    keputusan: 'Masukan seed disposisi_label_unit (P5). Label kosong dicatat dan diabaikan.',
    sql: `SELECT lower(regexp_replace(trim(d.label), '\\s+', ' ', 'g')) AS label_norm, count(*)::int AS jumlah
FROM surat_masuk
CROSS JOIN LATERAL unnest(disposisi) AS d(label)
GROUP BY 1
ORDER BY jumlah DESC, label_norm`,
  },
  {
    id: 'balasan_lintas_unit',
    judul: 'balasan_untuk same-unit vs lintas unit',
    keputusan: 'Baris lintas unit tidak dimasukkan backfill langkah 2 dan ditinjau TU.',
    sql: `SELECT count(*) FILTER (WHERE sk.unit_kerja_id = sm.unit_kerja_id)::int AS balasan_same_unit,
       count(*) FILTER (WHERE sk.unit_kerja_id <> sm.unit_kerja_id)::int AS balasan_lintas_unit
FROM surat_keluar sk
JOIN surat_masuk sm ON sm.id = sk.balasan_untuk`,
  },
  {
    id: 'sifat_surat_distinct',
    judul: 'Nilai distinct surat_masuk.sifat_surat',
    keputusan: 'Regenerasi backend/src/__tests__/fixtures/sifat-surat-produksi.json dengan --format=sifat-json lalu jalankan test paritas.',
    sql: `SELECT sifat_surat AS nilai, format('%L', sifat_surat) AS literal, count(*)::int AS jumlah,
       count(*) FILTER (WHERE is_deleted IS NOT TRUE)::int AS jumlah_hidup
FROM surat_masuk
GROUP BY sifat_surat
ORDER BY jumlah DESC, literal`,
  },
  {
    id: 'klasifikasi_keamanan_keluar_distinct',
    judul: 'Nilai distinct surat_keluar.klasifikasi_keamanan',
    keputusan: 'NULL diperlakukan terbatas (spec 4.4). Nilai di luar biasa/terbatas/rahasia/sangat_rahasia dicatat untuk reklasifikasi.',
    sql: `SELECT klasifikasi_keamanan AS nilai, format('%L', klasifikasi_keamanan) AS literal, count(*)::int AS jumlah
FROM surat_keluar
GROUP BY klasifikasi_keamanan
ORDER BY jumlah DESC, literal`,
  },
  {
    id: 'sifat_surat_kelas',
    judul: 'Kelas keamanan per nilai sifat_surat: SQL lama vs normalisasi P0',
    keputusan: 'Baris dengan kelas_lama berbeda dari kelas_baru adalah surat yang tampil/berubah di kotak disposisi setelah P0.',
    sql: `SELECT s.sifat_surat AS nilai, format('%L', s.sifat_surat) AS literal,
       ${kelasLamaSql('s.sifat_surat')} AS kelas_lama,
       ${kelasBaruSql('s.sifat_surat')} AS kelas_baru,
       count(*)::int AS jumlah
FROM surat_masuk s
GROUP BY s.sifat_surat
ORDER BY jumlah DESC, literal`,
  },
  {
    id: 'distribusi_terbuka_per_kelas',
    judul: 'Distribusi sent/received per kelas (lama vs P0)',
    keputusan: 'Jumlah dengan kelas_lama berbeda dari kelas_baru = disposisi yang baru muncul di kotak disposisi setelah P0; umumkan ke direktorat. Kelas terkendali yang masih terbuka menjadi masukan kebijakan 4.12.',
    sql: `SELECT ${kelasBaruSql('sm.sifat_surat')} AS kelas_baru,
       ${kelasLamaSql('sm.sifat_surat')} AS kelas_lama,
       sd.status, count(*)::int AS jumlah
FROM surat_distributions sd
JOIN surat_masuk sm ON sm.id = sd.surat_masuk_id
WHERE sd.status IN ('sent', 'received')
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3`,
  },
];

const FORBIDDEN_SQL = /\b(insert|update|delete|merge|alter|create|drop|truncate|grant|revoke|comment|vacuum|analyze|reindex|cluster|copy|call|do|lock|refresh|listen|notify|set|reset|begin|start|commit|rollback|savepoint|release|prepare|execute|into|discard)\b/i;

export function assertReadOnlySql(id, sqlText) {
  const text = String(sqlText ?? '').trim();
  if (!/^(select|with)\b/i.test(text) || text.includes(';') || FORBIDDEN_SQL.test(text)) {
    throw new Error(`Pemeriksaan pre-flight "${id}" bukan satu query baca`);
  }
}

export async function runPreflight(client, checks = PREFLIGHT_CHECKS) {
  for (const check of checks) assertReadOnlySql(check.id, check.sql);
  await client.query(PREFLIGHT_TRANSACTION);
  try {
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query('SET LOCAL standard_conforming_strings = on');
    const results = [];
    for (const check of checks) {
      await client.query('SAVEPOINT preflight_check');
      try {
        const { rows } = await client.query(check.sql);
        await client.query('RELEASE SAVEPOINT preflight_check');
        results.push({ ...check, rows, error: null });
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT preflight_check');
        results.push({ ...check, rows: [], error: `${error.code ? `${error.code}: ` : ''}${error.message}` });
      }
    }
    return results;
  } finally {
    await client.query('ROLLBACK');
  }
}

function cell(value) {
  let text;
  if (value === null || value === undefined) text = 'NULL';
  else if (Array.isArray(value)) text = `{${value.map(item => (item === null ? 'NULL' : String(item))).join(', ')}}`;
  else if (value instanceof Date) text = value.toISOString();
  else text = String(value);
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function formatReport(results, generatedAt = new Date().toISOString()) {
  const failed = results.filter(result => result.error);
  const lines = [
    '# Laporan Pre-flight P0 Integrasi Surat',
    '',
    `Dibuat: ${generatedAt}`,
    'Mode: transaksi READ ONLY, REPEATABLE READ, statement_timeout 15s, diakhiri ROLLBACK.',
    '',
    `Ringkasan: ${results.length} pemeriksaan, ${failed.length} gagal.`,
    '',
  ];
  for (const result of results) {
    lines.push(`## ${result.id} — ${result.judul}`, '', `Keputusan: ${result.keputusan}`, '');
    if (result.error) {
      lines.push(`**GAGAL:** ${cell(result.error)}`, '');
      continue;
    }
    if (result.rows.length === 0) {
      lines.push('_(0 baris)_', '');
      continue;
    }
    const columns = Object.keys(result.rows[0]);
    lines.push(`| ${columns.join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`);
    for (const row of result.rows.slice(0, MAX_ROWS_PER_CHECK)) {
      lines.push(`| ${columns.map(column => cell(row[column])).join(' | ')} |`);
    }
    if (result.rows.length > MAX_ROWS_PER_CHECK) {
      lines.push('', `_(${result.rows.length - MAX_ROWS_PER_CHECK} baris lain tidak ditampilkan)_`);
    }
    lines.push('');
  }
  lines.push(
    '## Pengesahan',
    '',
    '- Dijalankan oleh (nama/jabatan):',
    '- Basis data (host Neon, cabang) dan waktu:',
    '- Ditinjau pemilik keamanan:',
    '- Keputusan lanjut ke P1 (ya/tidak, alasan):',
    '',
  );
  return lines.join('\n');
}

export function formatSifatFixture(results) {
  const check = results.find(result => result.id === 'sifat_surat_distinct');
  if (!check || check.error) throw new Error('Pemeriksaan sifat_surat_distinct gagal; fixture tidak dibuat');
  return `${JSON.stringify(check.rows.map(row => row.nilai), null, 2)}\n`;
}

async function main() {
  dotenv.config({ quiet: true });
  const connectionString = process.env.PREFLIGHT_DATABASE_URL?.trim();
  if (!connectionString) throw new Error('PREFLIGHT_DATABASE_URL wajib diisi (gunakan role Neon read-only)');
  const formatArg = process.argv.find(arg => arg.startsWith('--format='));
  const format = formatArg ? formatArg.slice('--format='.length) : 'markdown';
  if (!['markdown', 'sifat-json'].includes(format)) throw new Error(`Format tidak dikenal: ${format}`);
  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000, application_name: 'simsa-preflight-p0' });
  try {
    await client.connect();
    const results = await runPreflight(client);
    process.stdout.write(format === 'sifat-json' ? formatSifatFixture(results) : `${formatReport(results)}\n`);
    if (results.some(result => result.error)) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Jangan mencetak connection string atau parameter.
    console.error(`Pre-flight gagal${error.code ? ` [${error.code}]` : ''}: ${error.message}`);
    process.exitCode = 1;
  });
}
```

Catatan: `'\\s+'` di pemeriksaan `label_disposisi` ditulis dalam template literal JS, sehingga SQL yang terkirim berisi `'\s+'`. `standard_conforming_strings = on` memastikan backslash diteruskan ke mesin regex.

- [ ] **Step 4: Tambahkan script npm**

Di `backend/package.json`, sisipkan setelah baris `"db:migrate": "node scripts/migrate-database.mjs",`:

```json
    "db:preflight:integrasi-surat": "node scripts/preflight-integrasi-surat.mjs",
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/preflight-integrasi-surat.test.ts`
Expected: PASS (17 test: 8 di blok PGlite, 9 di blok disiplin transaksi).

- [ ] **Step 6: Tulis checklist operator**

Buat `docs/PREFLIGHT_INTEGRASI_SURAT_P0.md`:

````markdown
# Checklist Pre-flight P0 — Integrasi Surat Masuk & Keluar

Pre-flight ini **hanya membaca** database produksi dan wajib selesai serta disahkan sebelum P1 (migrasi 0046/0047) dimulai.

- Skrip: `backend/scripts/preflight-integrasi-surat.mjs`
- Spesifikasi: `docs/superpowers/specs/2026-09-26-integrasi-surat-masuk-keluar-design.md` §10 (P0)

## Pengaman

- Semua pemeriksaan berjalan dalam satu transaksi `READ ONLY` dengan `REPEATABLE READ` dan `statement_timeout` 15 detik, lalu diakhiri `ROLLBACK`.
- Skrip menolak pemeriksaan yang memuat DML/DDL atau `;` sebelum koneksi dipakai.
- Gunakan role Neon **read-only** atau compute read replica. Jangan memakai kredensial migrator/aplikasi.
- Connection string hanya diberikan lewat variabel lingkungan `PREFLIGHT_DATABASE_URL` dan tidak pernah ditulis ke repo atau laporan.
- Laporan tidak memuat perihal, nomor, maupun isi surat. Isinya hanya id teknis, nama unit, label disposisi, nilai `sifat_surat`, dan hitungan.

## Langkah

1. Siapkan role read-only di konsol Neon (proyek produksi SIMSA), lalu salin connection string-nya.
2. Jalankan dari mesin operator:

   ```bash
   cd backend
   PREFLIGHT_DATABASE_URL='<connection string read-only>' npm run db:preflight:integrasi-surat > ../preflight-p0.md
   PREFLIGHT_DATABASE_URL='<connection string read-only>' node scripts/preflight-integrasi-surat.mjs --format=sifat-json > src/__tests__/fixtures/sifat-surat-produksi.json
   ```

   Exit code 1 berarti ada pemeriksaan yang gagal (bagian **GAGAL** di laporan). Perbaiki izin atau koneksi lalu ulangi.
3. Jalankan test paritas dengan fixture produksi: `cd backend && npx vitest run src/__tests__/visibility-spec.parity.test.ts`. Hasilnya harus PASS. Bila gagal, **jangan** lanjut ke P1; laporkan nilai yang tidak cocok.
4. Tinjau setiap bagian laporan memakai tabel keputusan di bawah.
5. Simpan laporan sebagai `docs/HASIL_PREFLIGHT_INTEGRASI_SURAT_P0_<YYYY-MM-DD>.md`, isi blok **Pengesahan**, lalu commit bersama fixture JSON.

## Tabel keputusan

| Pemeriksaan | Lulus bila | Bila tidak lulus |
|---|---|---|
| `status_migrasi` | 46 migrasi, terakhir `1789397416667` | Hentikan; samakan rantai migrasi dulu |
| `unit_kerja_direktorat` | Informasi | Unit `ada=false` akan dibuat 0047 |
| `unit_kerja_id_direktorat_dash` | 0 baris | 0047 akan RAISE; putuskan pemetaan bersama pemilik data |
| `distribusi_status_tak_dikenal` | 0 baris | Precheck 0046 RAISE; rekonsiliasi lewat aplikasi |
| `distribusi_aktif_ganda` | 0 baris | Precheck 0046 RAISE; target menolak baris yang lebih baru |
| `index_dan_objek_bentrok` | Hanya `idx_surat_keluar_balasan` yang boleh `true` | Objek lain yang sudah ada membuat 0046 gagal; selidiki asalnya |
| `kolom_bentrok` | 0 baris | Selidiki perubahan skema manual |
| `ekstensi` | Informasi | `pg_trgm` hanya dibutuhkan fase opsional P5 |
| `data_lama_ringkasan`, `data_lama_per_unit_tahun` | Informasi | Menentukan apakah backfill langkah 2 (P5) diperlukan |
| `label_disposisi`, `balasan_lintas_unit` | Informasi | Masukan untuk seed `disposisi_label_unit` dan tinjauan TU |
| `sifat_surat_distinct`, `sifat_surat_kelas` | Test paritas PASS | Jangan lanjut; laporkan nilai yang tidak cocok |
| `distribusi_terbuka_per_kelas` | Informasi | Umumkan jumlah disposisi yang baru tampil setelah P0 |
| `pengguna_per_role_unit` | Informasi | Daftar calon pengawas untuk sign-off keamanan |

## Pengesahan

Pengesahan diisi pada blok **Pengesahan** di laporan hasil. Pengisinya adalah operator yang menjalankan, lalu pemilik keamanan yang meninjau.
````

- [ ] **Step 7: Commit**

```bash
git add backend/scripts/preflight-integrasi-surat.mjs backend/src/__tests__/preflight-integrasi-surat.test.ts backend/package.json docs/PREFLIGHT_INTEGRASI_SURAT_P0.md
git commit -m "feat(preflight): tambah pre-flight produksi read-only P0 integrasi surat" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Cikal bakal `visibility-spec.ts` dan test paritas TS↔SQL

**Files:**
- Create: `backend/src/services/access/visibility-spec.ts`
- Create: `backend/src/__tests__/fixtures/sifat-surat-produksi.json`
- Create: `backend/src/__tests__/visibility-spec.parity.test.ts`
- Modify: `backend/src/services/record-access.service.ts:1-3` (impor), `:26` (`RECOGNIZED_CLASSIFICATIONS`), `:44-66` (hapus fungsi lokal)
- Test: `backend/src/__tests__/visibility-spec.parity.test.ts`, regresi `backend/src/__tests__/record-access-policy.test.ts`

**Interfaces:**
- Consumes: `sql`, `inArray`, `type AnyColumn`, `type SQL` dari `drizzle-orm`.
- Produces:
  - `SECURITY_CLASSES: readonly ['biasa','terbatas','rahasia','sangat_rahasia']`
  - `BIASA_SIFAT_ALIASES: readonly ['biasa','biasa/terbuka','terbuka','segera','sangat_segera','undangan','penting']`
  - `JS_WHITESPACE_CODEPOINTS: readonly number[]`
  - `PG_TRIM_PATTERN: string`
  - `PG_SEPARATOR_PATTERN: string`
  - `normalizeSecurityClassification(classification?: string | null): string`
  - `klasifikasiNormSql(column: AnyColumn | SQL): SQL<string>`
  - `klasifikasiInSql(column: AnyColumn | SQL, classes: readonly string[] | null | undefined): SQL | undefined`
  - `record-access.service.ts` tetap mengekspor `normalizeSecurityClassification` (re-export, fungsi yang sama)

- [ ] **Step 1: Buat fixture nilai produksi awal**

Buat `backend/src/__tests__/fixtures/sifat-surat-produksi.json`. Isinya nilai dari form (`TambahSuratMasuk.jsx:110-117`), enum validator (`schemas.ts:145`), dan label impor Excel (`migration.service.ts:159`). File ini diganti keluaran `--format=sifat-json` pada gerbang Task 9.

```json
[
  "biasa",
  "segera",
  "sangat_segera",
  "rahasia",
  "undangan",
  "penting",
  "Biasa",
  "Segera",
  "Sangat Segera",
  "Rahasia",
  "Terbatas",
  "Sangat Rahasia",
  "Biasa/Terbuka",
  "Undangan",
  "Penting",
  "",
  null
]
```

- [ ] **Step 2: Tulis test yang gagal**

Buat `backend/src/__tests__/visibility-spec.parity.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    BIASA_SIFAT_ALIASES,
    JS_WHITESPACE_CODEPOINTS,
    SECURITY_CLASSES,
    klasifikasiInSql,
    klasifikasiNormSql,
    normalizeSecurityClassification,
} from '../services/access/visibility-spec';
import * as recordAccess from '../services/record-access.service';

const productionValues = JSON.parse(
    readFileSync(new URL('./fixtures/sifat-surat-produksi.json', import.meta.url), 'utf8'),
) as Array<string | null>;

function variants(value: string | null): Array<string | null> {
    if (value === null) return [null];
    const spaced = value.replace(/_/g, ' ');
    return [
        value,
        value.toUpperCase(),
        spaced,
        value.replace(/_/g, '-'),
        value.replace(/_/g, ' - '),
        ` ${value}\t`,
        ` ${spaced} `,
        `﻿${spaced.toUpperCase()}　`,
    ];
}

const BASE_VALUES: Array<string | null> = [...new Set<string | null>([
    ...productionValues,
    ...BIASA_SIFAT_ALIASES,
    ...SECURITY_CLASSES,
    '',
    '   ',
    'klasifikasi-tidak-dikenal',
    'SÉGERA',
    'constructor',
])];

const CASES: Array<string | null> = [
    ...new Set(BASE_VALUES.flatMap(variants)),
    ...JS_WHITESPACE_CODEPOINTS.map(cp => {
        const ch = String.fromCodePoint(cp);
        return `${ch}Sangat${ch}Segera${ch}`;
    }),
];

// Keputusan kelas: nilai di luar kelas yang dikenal selalu ditolak oleh
// inArray(…, allowedClasses), jadi string tak dikenal yang berbeda setara.
const decide = (value: string) =>
    (SECURITY_CLASSES as readonly string[]).includes(value) ? value : '__tidak_dikenal__';

let client: PGlite;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client);
}, 20_000);

afterAll(async () => { await client?.close(); });

async function sqlClass(value: string | null): Promise<string> {
    const result = await db.execute(sql`select ${klasifikasiNormSql(sql`${value}::text`)} as kelas`);
    return (result.rows[0] as { kelas: string }).kelas;
}

describe('visibility-spec: normalisasi klasifikasi', () => {
    it('JS_WHITESPACE_CODEPOINTS persis sama dengan himpunan \\s ECMAScript', () => {
        const found: number[] = [];
        for (let cp = 0; cp <= 0x10ffff; cp += 1) {
            if (cp >= 0xd800 && cp <= 0xdfff) continue;
            if (/^\s$/u.test(String.fromCodePoint(cp))) found.push(cp);
        }
        expect([...JS_WHITESPACE_CODEPOINTS]).toEqual(found);
        for (const cp of found) expect(String.fromCodePoint(cp).trim()).toBe('');
    });

    it('record-access.service tetap mengekspor fungsi yang sama', () => {
        expect(recordAccess.normalizeSecurityClassification).toBe(normalizeSecurityClassification);
    });

    it('memetakan setiap nilai produksi dan variannya ke kelas yang sama di TS dan SQL', async () => {
        const mismatches: Array<{ value: string | null; ts: string; sql: string }> = [];
        for (const value of CASES) {
            const ts = normalizeSecurityClassification(value);
            const fromSql = await sqlClass(value);
            if (decide(ts) !== decide(fromSql)) mismatches.push({ value, ts, sql: fromSql });
        }
        expect(mismatches).toEqual([]);
    }, 60_000);

    it('menghasilkan string ternormalisasi identik untuk masukan ASCII', async () => {
        const asciiCases = CASES.filter(value => value === null || /^[\x00-\x7f]*$/.test(value));
        for (const value of asciiCases) {
            expect({ value, sql: await sqlClass(value) }).toEqual({ value, sql: normalizeSecurityClassification(value) });
        }
    }, 60_000);

    it('Sangat Segera, string kosong, dan NULL menjadi biasa; Sangat Rahasia tetap terkendali', async () => {
        for (const value of ['Sangat Segera', '', null, ' Biasa ', 'Biasa/Terbuka']) {
            expect(normalizeSecurityClassification(value)).toBe('biasa');
            expect(await sqlClass(value)).toBe('biasa');
        }
        expect(await sqlClass('Sangat Rahasia')).toBe('sangat_rahasia');
        expect(normalizeSecurityClassification('Sangat Rahasia')).toBe('sangat_rahasia');
    });

    it('klasifikasiInSql: undefined/null tanpa filter, [] selalu false, daftar menjadi IN', async () => {
        expect(klasifikasiInSql(sql`'biasa'`, undefined)).toBeUndefined();
        expect(klasifikasiInSql(sql`'biasa'`, null)).toBeUndefined();
        const evaluate = async (value: string | null, classes: string[]) => {
            const result = await db.execute(sql`select (${klasifikasiInSql(sql`${value}::text`, classes)}) as ok`);
            return (result.rows[0] as { ok: boolean }).ok;
        };
        expect(await evaluate('Sangat Segera', [])).toBe(false);
        expect(await evaluate('Sangat Segera', ['biasa'])).toBe(true);
        expect(await evaluate('Sangat Segera', ['terbatas'])).toBe(false);
        expect(await evaluate(' TERBATAS ', ['biasa', 'terbatas'])).toBe(true);
        expect(await evaluate('klasifikasi-aneh', [...SECURITY_CLASSES])).toBe(false);
    });
});
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/visibility-spec.parity.test.ts`
Expected: FAIL, modul `../services/access/visibility-spec` tidak ditemukan.

- [ ] **Step 4: Implementasi `visibility-spec.ts`**

Buat `backend/src/services/access/visibility-spec.ts`:

```ts
import { inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * Sumber tunggal predikat klasifikasi keamanan (P0: normalisasi saja; P2
 * menambah aturan role, pengawas/peserta, dan visibleSql). Bentuk TS dan SQL
 * WAJIB setara. Paritas dijaga oleh src/__tests__/visibility-spec.parity.test.ts.
 */
export const SECURITY_CLASSES = ['biasa', 'terbatas', 'rahasia', 'sangat_rahasia'] as const;

/** Nilai `sifat_surat` lama yang menyatakan urgensi/jenis, bukan kerahasiaan. */
export const BIASA_SIFAT_ALIASES = [
    'biasa',
    'biasa/terbuka',
    'terbuka',
    'segera',
    'sangat_segera',
    'undangan',
    'penting',
] as const;

/** Code point yang cocok dengan `\s` dan dibuang `String.prototype.trim` (ECMAScript). */
export const JS_WHITESPACE_CODEPOINTS: readonly number[] = [
    0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680,
    0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
    0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];

// `trim()` Postgres hanya membuang spasi; kelas eksplisit ini membuat SQL
// membuang whitespace yang sama dengan JS (NBSP, TAB, U+3000, U+FEFF, ...).
const PG_WHITESPACE_CLASS = JS_WHITESPACE_CODEPOINTS
    .map(cp => `\\u${cp.toString(16).padStart(4, '0')}`)
    .join('');
export const PG_TRIM_PATTERN = `^[${PG_WHITESPACE_CLASS}]+|[${PG_WHITESPACE_CLASS}]+$`;
export const PG_SEPARATOR_PATTERN = `[${PG_WHITESPACE_CLASS}-]+`;

const BIASA_ALIAS_SET: ReadonlySet<string> = new Set(BIASA_SIFAT_ALIASES);

export function normalizeSecurityClassification(
    classification?: string | null,
): string {
    const normalized = (classification || 'biasa')
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_');

    // Kolom lama `sifatSurat` mencampur urgensi/jenis dengan keamanan. Nilai
    // non-rahasia yang dikenali adalah rekaman kelas biasa.
    return BIASA_ALIAS_SET.has(normalized) ? 'biasa' : normalized;
}

/**
 * Padanan SQL `normalizeSecurityClassification`: '' dan NULL → 'biasa',
 * trim whitespace JS, lower, `[\s-]+` → '_', lalu pemetaan alias → 'biasa'.
 */
export function klasifikasiNormSql(column: AnyColumn | SQL): SQL<string> {
    const base = sql`regexp_replace(lower(regexp_replace(coalesce(nullif(${column}, ''), 'biasa'), ${PG_TRIM_PATTERN}::text, '', 'g')), ${PG_SEPARATOR_PATTERN}::text, '_', 'g')`;
    const aliases = sql.join(BIASA_SIFAT_ALIASES.map(alias => sql`${alias}`), sql`, `);
    return sql<string>`(CASE WHEN ${base} IN (${aliases}) THEN 'biasa' ELSE ${base} END)`;
}

/**
 * Filter kelas: `undefined`/`null` berarti tanpa filter (pemanggil lama),
 * `[]` berarti tidak ada kelas yang boleh dibaca.
 */
export function klasifikasiInSql(
    column: AnyColumn | SQL,
    classes: readonly string[] | null | undefined,
): SQL | undefined {
    if (classes === undefined || classes === null) return undefined;
    if (classes.length === 0) return sql`false`;
    return inArray(klasifikasiNormSql(column), [...classes]);
}
```

- [ ] **Step 5: Pindahkan fungsi TS dari `record-access.service.ts`**

Di `backend/src/services/record-access.service.ts`, ganti baris 3:

```ts
import { and, desc, eq, gt } from 'drizzle-orm';
```

menjadi:

```ts
import { and, desc, eq, gt } from 'drizzle-orm';
import { normalizeSecurityClassification, SECURITY_CLASSES } from './access/visibility-spec';

// Impor lama `normalizeSecurityClassification` dari modul ini tetap berlaku.
export { normalizeSecurityClassification };
```

Ganti baris 26:

```ts
const RECOGNIZED_CLASSIFICATIONS = ['biasa', 'terbatas', 'rahasia', 'sangat_rahasia'];
```

menjadi:

```ts
const RECOGNIZED_CLASSIFICATIONS: string[] = [...SECURITY_CLASSES];
```

Lalu hapus seluruh fungsi lokal `export function normalizeSecurityClassification(...) { ... }` (baris 45-66, dari `export function normalizeSecurityClassification(` sampai `return normalized;\n}` sebelum `export function isAllowedForRecordUnit`).

- [ ] **Step 6: Jalankan test, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/visibility-spec.parity.test.ts src/__tests__/record-access-policy.test.ts src/__tests__/record-access-grant.service.test.ts src/__tests__/preflight-integrasi-surat.test.ts`
Expected: PASS semua.

Run: `cd backend && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0 tanpa keluaran.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/access/visibility-spec.ts backend/src/services/record-access.service.ts backend/src/__tests__/visibility-spec.parity.test.ts backend/src/__tests__/fixtures/sifat-surat-produksi.json
git commit -m "feat(access): sumber tunggal normalisasi klasifikasi TS dan SQL dengan test paritas" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Kotak & keluar disposisi memakai normalisasi yang sama ('Sangat Segera' tampil)

**Files:**
- Create: `backend/src/__tests__/helpers/surat-inbox-pglite.ts`
- Create: `backend/src/__tests__/distribution-inbox-classification.test.ts`
- Modify: `backend/src/services/distribution.service.ts:3` (impor), `:15-25` (`incomingSecurityCondition`)
- Test: `backend/src/__tests__/distribution-inbox-classification.test.ts`, regresi `backend/src/__tests__/distribution.service.test.ts`

**Interfaces:**
- Consumes: `klasifikasiInSql(column, classes)` dari Task 2; `DistributionService.findInbox(unitKerjaId: string, filters?: DistributionFilters, securityClassifications?: string[] | null)`; `findOutbox` (signature sama).
- Produces:
  - `letterId(n: number): string`
  - `distributionId(n: number): string`
  - `interface InboxFixtureLetter { n: number; sifatSurat: string | null; isDeleted?: boolean | null; distributionStatus?: 'sent' | 'received' | 'processed' | 'rejected' }`
  - `createInboxDatabase(letters: InboxFixtureLetter[]): Promise<{ client: PGlite; db: PgliteDatabase }>`

- [ ] **Step 1: Buat helper fixture PGlite**

Buat `backend/src/__tests__/helpers/surat-inbox-pglite.ts`:

```ts
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

export const letterId = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const distributionId = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export interface InboxFixtureLetter {
    n: number;
    sifatSurat: string | null;
    /** undefined → false; null meniru baris lama dengan is_deleted NULL. */
    isDeleted?: boolean | null;
    distributionStatus?: 'sent' | 'received' | 'processed' | 'rejected';
}

// Kolom persis seperti schema Drizzle yang dibaca findInbox/findOutbox dan
// notification.service (surat-distribution.ts, surat-masuk.ts, unit-kerja.ts).
const SCHEMA_SQL = `
CREATE TABLE unit_kerja (id varchar(50) PRIMARY KEY, name varchar(255) NOT NULL);
CREATE TABLE surat_masuk (
    id uuid PRIMARY KEY, unit_kerja_id varchar(50) NOT NULL, nomor_surat varchar(255), perihal text, dari text,
    tanggal_surat date, sifat_surat varchar(50), status varchar(50) DEFAULT 'belum_dibalas',
    is_archived boolean DEFAULT false, is_deleted boolean DEFAULT false,
    created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE surat_distributions (
    id uuid PRIMARY KEY, surat_masuk_id uuid NOT NULL REFERENCES surat_masuk(id),
    source_unit_id varchar(50) NOT NULL, target_unit_id varchar(50) NOT NULL, cc_units text, instruction text,
    status varchar(20) NOT NULL DEFAULT 'sent', rejection_reason text,
    sent_at timestamp NOT NULL DEFAULT now(), received_at timestamp, processed_at timestamp,
    sent_by uuid, received_by uuid,
    created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
`;

export async function createInboxDatabase(letters: InboxFixtureLetter[]) {
    const client = new PGlite();
    await client.exec(SCHEMA_SQL);
    await client.exec(`INSERT INTO unit_kerja (id, name) VALUES ('ditjen', 'Direktorat Jenderal'), ('dir_bppt', 'Direktorat BPPT')`);
    for (const letter of letters) {
        await client.query(
            `INSERT INTO surat_masuk (id, unit_kerja_id, nomor_surat, perihal, dari, tanggal_surat, sifat_surat, is_deleted)
             VALUES ($1, 'ditjen', $2, $3, 'Instansi Uji', '2026-09-01', $4, $5)`,
            [
                letterId(letter.n),
                `SM-${letter.n}/2026`,
                `Perihal uji ${letter.n}`,
                letter.sifatSurat,
                letter.isDeleted === undefined ? false : letter.isDeleted,
            ],
        );
        await client.query(
            `INSERT INTO surat_distributions (id, surat_masuk_id, source_unit_id, target_unit_id, status)
             VALUES ($1, $2, 'ditjen', 'dir_bppt', $3)`,
            [distributionId(letter.n), letterId(letter.n), letter.distributionStatus ?? 'sent'],
        );
    }
    return { client, db: drizzle(client) };
}
```

- [ ] **Step 2: Tulis test yang gagal**

Buat `backend/src/__tests__/distribution-inbox-classification.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createInboxDatabase, letterId, type InboxFixtureLetter } from './helpers/surat-inbox-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({
    db: new Proxy({}, {
        get: (_target, key) => {
            const value = holder.db[key];
            return typeof value === 'function' ? value.bind(holder.db) : value;
        },
    }),
}));

const LETTERS: InboxFixtureLetter[] = [
    { n: 1, sifatSurat: 'Sangat Segera' },
    { n: 2, sifatSurat: 'sangat-segera' },
    { n: 3, sifatSurat: ' Biasa ' },
    { n: 4, sifatSurat: '' },
    { n: 5, sifatSurat: null },
    { n: 6, sifatSurat: 'Terbatas' },
    { n: 7, sifatSurat: 'RAHASIA' },
    { n: 8, sifatSurat: 'Sangat Rahasia' },
    { n: 9, sifatSurat: 'klasifikasi-aneh' },
];

let client: PGlite;
let service: typeof import('../services/distribution.service').distributionService;

beforeAll(async () => {
    const fixture = await createInboxDatabase(LETTERS);
    client = fixture.client;
    holder.db = fixture.db;
    ({ distributionService: service } = await import('../services/distribution.service'));
}, 20_000);

afterAll(async () => { await client?.close(); });

const suratIds = (rows: Array<{ suratMasukId: string }>) => rows.map(row => row.suratMasukId).sort();
const lettersN = (...ns: number[]) => ns.map(letterId).sort();

describe('kotak disposisi: klasifikasi dinormalisasi seperti normalizeSecurityClassification', () => {
    it('menampilkan semua sifat setara biasa, termasuk Sangat Segera, string kosong, dan NULL', async () => {
        const result = await service.findInbox('dir_bppt', { limit: 50 }, ['biasa']);
        expect(suratIds(result.data)).toEqual(lettersN(1, 2, 3, 4, 5));
        expect(result.pagination.total).toBe(5);
    });

    it('menambah Terbatas hanya bila role boleh membacanya', async () => {
        const result = await service.findInbox('dir_bppt', { limit: 50 }, ['biasa', 'terbatas']);
        expect(suratIds(result.data)).toEqual(lettersN(1, 2, 3, 4, 5, 6));
    });

    it('lingkup super_admin melihat semua kelas yang dikenal, tetapi tidak nilai tak dikenal', async () => {
        const result = await service.findInbox('dir_bppt', { limit: 50 }, ['biasa', 'terbatas', 'rahasia', 'sangat_rahasia']);
        expect(suratIds(result.data)).toEqual(lettersN(1, 2, 3, 4, 5, 6, 7, 8));
    });

    it('lingkup kelas kosong tidak mengembalikan apa pun', async () => {
        const result = await service.findInbox('dir_bppt', { limit: 50 }, []);
        expect(result.data).toEqual([]);
        expect(result.pagination.total).toBe(0);
    });

    it('kotak keluar memakai predikat yang sama', async () => {
        const result = await service.findOutbox('ditjen', { limit: 50 }, ['biasa']);
        expect(suratIds(result.data)).toEqual(lettersN(1, 2, 3, 4, 5));
    });
});
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/distribution-inbox-classification.test.ts`
Expected: FAIL. Test pertama hanya menerima surat 5, karena SQL lama menjatuhkan 'Sangat Segera', 'sangat-segera', ' Biasa ', dan '' ke cabang ELSE. Test ketiga juga gagal karena `'Sangat Rahasia'` tidak terbaca sebagai `sangat_rahasia`.

- [ ] **Step 4: Implementasi**

Di `backend/src/services/distribution.service.ts`, ganti baris 3:

```ts
import { eq, and, desc, sql, or, notInArray, inArray } from 'drizzle-orm';
```

menjadi:

```ts
import { eq, and, desc, sql, or, notInArray } from 'drizzle-orm';
import { klasifikasiInSql } from './access/visibility-spec';
```

Ganti baris 15-25 (seluruh `function incomingSecurityCondition`):

```ts
function incomingSecurityCondition(classes: string[] | null | undefined) {
    if (classes === undefined || classes === null) return undefined;
    if (classes.length === 0) return sql`false`;
    const normalized = sql<string>`CASE
        WHEN lower(coalesce(${suratMasuk.sifatSurat}, 'biasa'))
            IN ('biasa', 'biasa/terbuka', 'terbuka', 'segera', 'sangat_segera', 'undangan', 'penting')
        THEN 'biasa'
        ELSE replace(replace(lower(coalesce(${suratMasuk.sifatSurat}, 'biasa')), ' ', '_'), '-', '_')
    END`;
    return inArray(normalized, classes);
}
```

menjadi:

```ts
function incomingSecurityCondition(classes: string[] | null | undefined) {
    // Normalisasi identik dengan normalizeSecurityClassification (TS) yang
    // dipakai check(); lihat services/access/visibility-spec.ts.
    return klasifikasiInSql(suratMasuk.sifatSurat, classes);
}
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/distribution-inbox-classification.test.ts src/__tests__/distribution.service.test.ts src/__tests__/distribution-layanan.routes.test.ts`
Expected: PASS semua.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/distribution.service.ts backend/src/__tests__/helpers/surat-inbox-pglite.ts backend/src/__tests__/distribution-inbox-classification.test.ts
git commit -m "fix(distribusi): samakan normalisasi klasifikasi kotak disposisi dengan kebijakan TS" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `createDistributionSchema.instruction` menerima `null` (bug 400 DistributeDialog)

**Files:**
- Modify: `backend/src/validators/schemas.ts:557`
- Modify: `backend/src/services/distribution.service.ts:35` (tipe `instruction`) dan audit `changes.after.instruction` (sekitar :91)
- Modify: `backend/src/__tests__/schemas.test.ts:171-182` (tambah kasus setelah `'accepts with optional fields'`)
- Create: `backend/src/__tests__/distribution-create-validation.routes.test.ts`
- Test: kedua file test di atas

**Interfaces:**
- Consumes: `POST /api/distributions` body dari `frontend/src/components/DistributeDialog.jsx:85-90` (`instruction: instruction || null`).
- Produces:
  - `createDistributionSchema` dengan `instruction?: string | null | undefined`
  - `DistributionService.distribute(data: { suratMasukId: string; sourceUnitId: string; targetUnitId: string; instruction?: string | null; ccUnits?: string[]; sentBy?: string }, auditContext?: CriticalAuditContext)`

- [ ] **Step 1: Tulis test yang gagal**

Di `backend/src/__tests__/schemas.test.ts`, di dalam `describe('createDistributionSchema', ...)`, tepat setelah test `'accepts with optional fields'`, tambahkan:

```ts
    it('accepts instruction: null as sent by DistributeDialog', () => {
        const result = createDistributionSchema.safeParse({
            suratMasukId: validUUID,
            sourceUnitId: 'unit-a',
            targetUnitId: 'unit-b',
            instruction: null,
        });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.instruction).toBeNull();
    });

    it('rejects an instruction longer than 2000 characters', () => {
        const result = createDistributionSchema.safeParse({
            suratMasukId: validUUID,
            sourceUnitId: 'unit-a',
            targetUnitId: 'unit-b',
            instruction: 'x'.repeat(2001),
        });
        expect(result.success).toBe(false);
    });
```

Buat `backend/src/__tests__/distribution-create-validation.routes.test.ts`:

```ts
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    distribution: { distribute: vi.fn() },
    recordAccess: { check: vi.fn() },
}));

vi.mock('../middlewares/auth.middleware.js', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { id: 'user-1', email: 'tu@example.test', name: 'Petugas TU', role: 'admin_unit', unitKerjaId: 'ditjen' };
        next();
    },
}));
vi.mock('../middlewares/role.middleware.js', () => ({
    canWriteMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../services/distribution.service.js', () => ({ distributionService: mocks.distribution }));
vi.mock('../services/record-access.service.js', () => ({
    recordAccessService: mocks.recordAccess,
    allowedSecurityClassifications: () => ['biasa', 'terbatas'],
    isAllowedForClassification: () => true,
}));
vi.mock('../services/audit-log.service.js', () => ({
    default: { logAction: vi.fn(), logActionOrThrow: vi.fn() },
}));

// validate.middleware TIDAK di-mock: skema Zod asli yang diuji.
const { default: distributionRouter } = await import('../routes/distribution.routes.js');

const app = express();
app.use(express.json());
app.use('/distributions', distributionRouter);

const BASE = {
    suratMasukId: '550e8400-e29b-41d4-a716-446655440001',
    sourceUnitId: 'ditjen',
    targetUnitId: 'dir_bppt',
};

describe('POST /distributions dengan validator asli', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.recordAccess.check.mockResolvedValue({
            exists: true, allowed: true, mutable: true, unitKerjaId: 'ditjen', classification: 'biasa',
        });
        mocks.distribution.distribute.mockResolvedValue({ id: 'dist-1', status: 'sent' });
    });

    it('menerima instruction: null persis seperti yang dikirim DistributeDialog', async () => {
        const res = await request(app).post('/distributions').send({ ...BASE, instruction: null });
        expect(res.status).toBe(201);
        expect(mocks.distribution.distribute).toHaveBeenCalledWith(
            expect.objectContaining({ ...BASE, instruction: null }),
            expect.objectContaining({ userId: 'user-1' }),
        );
    });

    it('menerima distribusi tanpa field instruction', async () => {
        const res = await request(app).post('/distributions').send(BASE);
        expect(res.status).toBe(201);
        expect(mocks.distribution.distribute.mock.calls[0][0].instruction).toBeUndefined();
    });

    it('tetap menerima instruksi berupa string', async () => {
        const res = await request(app).post('/distributions').send({ ...BASE, instruction: 'Mohon ditindaklanjuti' });
        expect(res.status).toBe(201);
        expect(mocks.distribution.distribute.mock.calls[0][0].instruction).toBe('Mohon ditindaklanjuti');
    });

    it.each([
        ['angka', 123],
        ['objek', { text: 'x' }],
        ['array', ['a']],
        ['2001 karakter', 'x'.repeat(2001)],
    ])('menolak instruction bertipe %s dengan 400 sebelum menyentuh service', async (_label, instruction) => {
        const res = await request(app).post('/distributions').send({ ...BASE, instruction });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Validation failed');
        expect(res.body.details.map((detail: { field: string }) => detail.field)).toContain('instruction');
        expect(mocks.recordAccess.check).not.toHaveBeenCalled();
        expect(mocks.distribution.distribute).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/schemas.test.ts src/__tests__/distribution-create-validation.routes.test.ts`
Expected: FAIL pada `'accepts instruction: null as sent by DistributeDialog'` (`success` false) dan `'menerima instruction: null …'` (status 400, bukan 201).

- [ ] **Step 3: Implementasi**

Di `backend/src/validators/schemas.ts` baris 557, ganti:

```ts
    instruction: z.string().max(2000).optional(),
```

menjadi:

```ts
    // DistributeDialog mengirim `instruction: null` bila instruksi dikosongkan.
    instruction: z.string().max(2000).nullish(),
```

Di `backend/src/services/distribution.service.ts`, pada parameter `distribute` (baris 35), ganti:

```ts
        instruction?: string;
```

menjadi:

```ts
        instruction?: string | null;
```

Masih di file itu, pada blok audit `changes.after` di dalam `distribute`, ganti:

```ts
                        instruction: data.instruction,
```

menjadi:

```ts
                        instruction: data.instruction ?? null,
```

Hanya ganti kemunculan di dalam `changes.after`. Baris `instruction: data.instruction,` di `.values({...})` insert dibiarkan, karena Drizzle menerima `null`.

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/schemas.test.ts src/__tests__/distribution-create-validation.routes.test.ts src/__tests__/distribution.service.test.ts src/__tests__/distribution-layanan.routes.test.ts`
Expected: PASS semua.

Run: `cd backend && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/validators/schemas.ts backend/src/services/distribution.service.ts backend/src/__tests__/schemas.test.ts backend/src/__tests__/distribution-create-validation.routes.test.ts
git commit -m "fix(distribusi): terima instruction null dari DistributeDialog" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Daftar surat keluar menyertakan baris lama `is_deleted IS NULL`

**Files:**
- Modify: `backend/src/services/surat-keluar.service.ts:53-55`
- Create: `backend/src/__tests__/surat-keluar-list-deleted.test.ts`
- Test: file baru dan regresi `backend/src/__tests__/surat-keluar.service.test.ts`

**Interfaces:**
- Consumes: `SuratKeluarService.findAll(filters: SuratKeluarFilters)`.
- Produces: kondisi WHERE `findAll` berisi `"surat_keluar"."is_deleted" IS NOT TRUE`, tanpa perubahan signature.

- [ ] **Step 1: Tulis test yang gagal**

Buat `backend/src/__tests__/surat-keluar-list-deleted.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const resultQueue: any[] = [];
const whereConditions: any[] = [];

const mockChain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') {
            const value = resultQueue.shift() ?? [];
            return (resolve: any) => resolve(value);
        }
        return (...args: any[]) => {
            if (prop === 'where') whereConditions.push(args[0]);
            return mockChain;
        };
    },
});

vi.mock('../config/database', () => ({
    db: {
        select: () => mockChain,
        insert: () => mockChain,
        update: () => mockChain,
        delete: () => mockChain,
    },
}));

const { SuratKeluarService } = await import('../services/surat-keluar.service');
const dialect = new PgDialect();
const render = (condition: any) => dialect.sqlToQuery(condition).sql;

describe('SuratKeluarService.findAll: filter soft-delete', () => {
    beforeEach(() => {
        resultQueue.length = 0;
        whereConditions.length = 0;
    });

    it.each([
        ['unit tertentu', { unitKerjaId: 'dir_bppt' }],
        ['semua unit (super_admin)', { unitKerjaId: null }],
        ['dengan pencarian dan kelas', { unitKerjaId: 'dir_bppt', search: 'nota', securityClassifications: ['biasa', 'terbatas'] }],
    ])('memakai IS NOT TRUE agar baris lama is_deleted NULL tetap tampil: %s', async (_label, filters) => {
        resultQueue.push([{ count: 0 }], []);
        await new SuratKeluarService().findAll(filters as any);
        const [countWhere, dataWhere] = whereConditions;
        for (const condition of [countWhere, dataWhere]) {
            const text = render(condition);
            expect(text).toMatch(/"surat_keluar"\."is_deleted" IS NOT TRUE/i);
            expect(text).not.toMatch(/"is_deleted" = \$/);
        }
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/surat-keluar-list-deleted.test.ts`
Expected: FAIL. SQL yang dirender berisi `"surat_keluar"."is_deleted" = $1` dan tidak memuat `IS NOT TRUE`.

- [ ] **Step 3: Implementasi**

Di `backend/src/services/surat-keluar.service.ts`, di awal `findAll`, ganti:

```ts
        const conditions = [
            eq(suratKeluar.isDeleted, false),  // Exclude soft-deleted records
        ];
```

menjadi:

```ts
        const conditions = [
            // Baris lama bisa ber-is_deleted NULL; hanya TRUE yang berarti terhapus.
            sql`${suratKeluar.isDeleted} IS NOT TRUE`,
        ];
```

`sql` dan `eq` sudah diimpor di baris 3, dan `eq` masih dipakai di tempat lain di file ini.

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/surat-keluar-list-deleted.test.ts src/__tests__/surat-keluar.service.test.ts src/__tests__/surat-keluar-stats.integration.test.ts`
Expected: PASS semua.

Run: `cd backend && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0. Tipe array `conditions` menjadi `SQL[]` dan `push` berikutnya menerima `SQL`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/surat-keluar.service.ts backend/src/__tests__/surat-keluar-list-deleted.test.ts
git commit -m "fix(surat-keluar): sertakan baris lama is_deleted NULL di daftar" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Notifikasi mengabaikan surat terhapus secara benar dan selaras dengan kotak disposisi

**Files:**
- Modify: `backend/src/services/notification.service.ts:17-24` (impor), `:185-190` (`getPendingSuratMasuk` where), `:326-331` (`getDistributionNotifications` where)
- Create: `backend/src/__tests__/notification-deleted-classification.test.ts`
- Test: file baru dan regresi `backend/src/__tests__/notification.service.test.ts`, `backend/src/__tests__/notification-unit-scope.routes.test.ts`

**Interfaces:**
- Consumes: `klasifikasiInSql` (Task 2), `createInboxDatabase`/`letterId`/`distributionId` (Task 3), `notificationService.getPendingSuratMasuk(unitKerjaId, userId, securityClassifications?, knownReadIds?)`, `notificationService.getDistributionNotifications(unitKerjaId, userId, securityClassifications?, knownReadIds?, userRole?)`.
- Produces: signature tetap. Notifikasi disposisi kini memakai predikat kelas yang sama dengan `findInbox` dan tidak memuat surat `is_deleted = true`. Notifikasi pending memuat baris `is_deleted IS NULL`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `backend/src/__tests__/notification-deleted-classification.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
    createInboxDatabase,
    distributionId,
    letterId,
    type InboxFixtureLetter,
} from './helpers/surat-inbox-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({
    db: new Proxy({}, {
        get: (_target, key) => {
            const value = holder.db[key];
            return typeof value === 'function' ? value.bind(holder.db) : value;
        },
    }),
}));
vi.mock('../services/arsip.service', () => ({ arsipService: { getExpiring: async () => [] } }));

const LETTERS: InboxFixtureLetter[] = [
    { n: 1, sifatSurat: 'Sangat Segera' },
    { n: 2, sifatSurat: 'Biasa', isDeleted: true },
    { n: 3, sifatSurat: 'biasa', isDeleted: null, distributionStatus: 'received' },
    { n: 4, sifatSurat: 'Rahasia' },
    { n: 5, sifatSurat: 'biasa', distributionStatus: 'processed' },
];

let client: PGlite;
let service: typeof import('../services/notification.service').notificationService;

beforeAll(async () => {
    const fixture = await createInboxDatabase(LETTERS);
    client = fixture.client;
    holder.db = fixture.db;
    ({ notificationService: service } = await import('../services/notification.service'));
}, 20_000);

afterAll(async () => { await client?.close(); });

describe('notifikasi disposisi', () => {
    it('hanya memuat disposisi terbuka atas surat hidup yang kelasnya terbaca, termasuk Sangat Segera', async () => {
        const items = await service.getDistributionNotifications('dir_bppt', 'user-1', ['biasa'], new Set(), 'admin_unit');
        expect(items.map(item => item.referenceId).sort()).toEqual([distributionId(1), distributionId(3)].sort());
    });
});

describe('notifikasi surat masuk pending', () => {
    it('menyertakan baris lama is_deleted NULL dan tetap membuang is_deleted TRUE', async () => {
        const items = await service.getPendingSuratMasuk('ditjen', 'user-1', ['biasa'], new Set());
        const ids = items.map(item => item.referenceId);
        expect(ids).toContain(letterId(3));
        expect(ids).toContain(letterId(5));
        expect(ids).not.toContain(letterId(2));
        expect(ids).not.toContain(letterId(4));
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/notification-deleted-classification.test.ts`
Expected: FAIL.
- Test disposisi mendapat `[distributionId(2), distributionId(3)]`: surat terhapus 2 ikut muncul, sedangkan 'Sangat Segera' (1) hilang.
- Test pending tidak memuat `letterId(3)`.

- [ ] **Step 3: Implementasi**

Di `backend/src/services/notification.service.ts`, setelah blok impor `from '../utils/notification-id.js';` (baris 21-24), tambahkan:

```ts
import { klasifikasiInSql } from './access/visibility-spec';
```

Di `getPendingSuratMasuk`, ganti:

```ts
                eq(suratMasuk.isDeleted, false),
                incomingSecurityCondition(securityClassifications),
```

menjadi:

```ts
                // Baris lama bisa ber-is_deleted NULL; hanya TRUE yang berarti terhapus.
                sql`${suratMasuk.isDeleted} IS NOT TRUE`,
                incomingSecurityCondition(securityClassifications),
```

`incomingSecurityCondition` lokal di notifikasi pending sengaja dipertahankan (lihat Global Constraints). Blok pending harus tetap setara dengan daftar surat masuk yang belum diubah.

Di `getDistributionNotifications`, ganti:

```ts
            .where(and(
                eq(suratDistributions.targetUnitId, unitKerjaId),
                inArray(suratDistributions.status, ['sent', 'received']),
                incomingSecurityCondition(securityClassifications),
            ))
```

menjadi:

```ts
            .where(and(
                eq(suratDistributions.targetUnitId, unitKerjaId),
                inArray(suratDistributions.status, ['sent', 'received']),
                sql`${suratMasuk.isDeleted} IS NOT TRUE`,
                // Predikat yang sama dengan DistributionService.findInbox.
                klasifikasiInSql(suratMasuk.sifatSurat, securityClassifications),
            ))
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/notification-deleted-classification.test.ts src/__tests__/notification.service.test.ts src/__tests__/notification-unit-scope.routes.test.ts src/__tests__/notification-id.test.ts`
Expected: PASS semua.

Run: `cd backend && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/notification.service.ts backend/src/__tests__/notification-deleted-classification.test.ts
git commit -m "fix(notifikasi): filter is_deleted IS NOT TRUE dan selaraskan kelas notifikasi disposisi" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `validateIdParam` pada `/balasan`, `/with-links`, `/source`, `/archive-full`

**Files:**
- Modify: `backend/src/routes/surat-masuk.routes.ts:499` (`/:id/archive-full`), `:558` (`/:id/balasan`), `:586` (`/:id/with-links`)
- Modify: `backend/src/routes/surat-keluar.routes.ts:493` (`/:id/archive-full`), `:557` (`/:id/source`), `:587` (`/:id/with-links`)
- Create: `backend/src/__tests__/surat-id-param.routes.test.ts`
- Test: file baru dan regresi `backend/src/routes/__tests__/surat-masuk.routes.test.ts`, `backend/src/routes/__tests__/surat-file-security.routes.test.ts`, `backend/src/__tests__/record-unit-scope.routes.test.ts`

**Interfaces:**
- Consumes: `validateIdParam(paramName = 'id')` dari `backend/src/middlewares/validate.middleware.ts:72-85` (400 `{ success: false, error: 'Invalid ID format', message }`).
- Produces: enam route di atas mengembalikan 400 untuk `:id` non-UUID sebelum memanggil service, `recordAccessService`, maupun `canWriteMiddleware`. `POST /:id/archive` (410) tidak diubah.

- [ ] **Step 1: Tulis test yang gagal**

Buat `backend/src/__tests__/surat-id-param.routes.test.ts`:

```ts
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    suratMasuk: { findById: vi.fn(), findByIdWithLinks: vi.fn(), getBalasan: vi.fn() },
    suratKeluar: { findById: vi.fn(), findByIdWithLinks: vi.fn(), getSourceSuratMasuk: vi.fn() },
    recordAccess: { check: vi.fn() },
}));

vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { id: 'user-1', email: 'admin@example.test', role: 'admin_unit', unitKerjaId: 'ditjen' };
        next();
    },
}));
vi.mock('../middlewares/role.middleware', () => ({
    canWriteMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../services/surat-masuk.service', () => ({ suratMasukService: mocks.suratMasuk }));
vi.mock('../services/surat-keluar.service', () => ({ suratKeluarService: mocks.suratKeluar }));
vi.mock('../services/record-access.service', () => ({
    allowedSecurityClassifications: () => ['biasa', 'terbatas'],
    isAllowedForClassification: () => true,
    recordAccessService: mocks.recordAccess,
}));
vi.mock('../services/audit-log.service', () => ({
    default: { logAction: vi.fn(), logActionOrThrow: vi.fn() },
}));

// validate.middleware TIDAK di-mock.
const { default: suratMasukRouter } = await import('../routes/surat-masuk.routes');
const { default: suratKeluarRouter } = await import('../routes/surat-keluar.routes');

const app = express();
app.use(express.json());
app.use('/api/surat-masuk', suratMasukRouter);
app.use('/api/surat-keluar', suratKeluarRouter);

const ROUTES: Array<[method: 'get' | 'post', template: string]> = [
    ['get', '/api/surat-masuk/:id/balasan'],
    ['get', '/api/surat-masuk/:id/with-links'],
    ['post', '/api/surat-masuk/:id/archive-full'],
    ['get', '/api/surat-keluar/:id/source'],
    ['get', '/api/surat-keluar/:id/with-links'],
    ['post', '/api/surat-keluar/:id/archive-full'],
];

const INVALID_IDS = [
    'not-a-uuid',
    '123',
    "1' OR '1'='1",
    '550e8400-e29b-41d4-a716-44665544000',
    '550e8400-e29b-41d4-a716-4466554400000',
    '550e8400e29b41d4a716446655440000',
    '550e8400-e29b-41d4-a716-446655440000 ',
    'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz',
];

const CASES = ROUTES.flatMap(([method, template]) =>
    INVALID_IDS.map(id => [method, template, id] as const));

const allServiceMocks = () => [
    ...Object.values(mocks.suratMasuk),
    ...Object.values(mocks.suratKeluar),
    mocks.recordAccess.check,
];

describe('validasi :id pada route turunan surat', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.suratMasuk.findById.mockResolvedValue(null);
        mocks.suratMasuk.findByIdWithLinks.mockResolvedValue(null);
        mocks.suratKeluar.findById.mockResolvedValue(null);
        mocks.suratKeluar.findByIdWithLinks.mockResolvedValue(null);
    });

    it.each(CASES)('%s %s dengan id %j → 400 tanpa menyentuh service', async (method, template, id) => {
        const res = await request(app)[method](template.replace(':id', encodeURIComponent(id))).send({});
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ success: false, error: 'Invalid ID format' });
        for (const mock of allServiceMocks()) expect(mock).not.toHaveBeenCalled();
    });

    it.each(ROUTES)('%s %s dengan UUID valid (termasuk huruf besar) diteruskan ke handler', async (method, template) => {
        for (const id of ['550e8400-e29b-41d4-a716-446655440000', '550E8400-E29B-41D4-A716-446655440000']) {
            const res = await request(app)[method](template.replace(':id', id)).send({});
            expect(res.status).toBe(404);
        }
    });

    it('POST /:id/archive tetap 410 dan tidak berubah', async () => {
        await request(app).post('/api/surat-masuk/not-a-uuid/archive').send({}).expect(410);
        await request(app).post('/api/surat-keluar/not-a-uuid/archive').send({}).expect(410);
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/surat-id-param.routes.test.ts`
Expected: FAIL. Semua kasus `CASES` mendapat 404, bukan 400, dan `findById`/`findByIdWithLinks` terpanggil.

- [ ] **Step 3: Implementasi**

`backend/src/routes/surat-masuk.routes.ts`. `validateIdParam` sudah diimpor di baris 9; urutannya sama dengan `DELETE /:id`, yaitu `validateIdParam()` sebelum `canWriteMiddleware()`.

```ts
router.post('/:id/archive-full', canWriteMiddleware(), async (req: AuthRequest, res, next) => {
```
→
```ts
router.post('/:id/archive-full', validateIdParam(), canWriteMiddleware(), async (req: AuthRequest, res, next) => {
```

```ts
router.get('/:id/balasan', async (req: AuthRequest, res, next) => {
```
→
```ts
router.get('/:id/balasan', validateIdParam(), async (req: AuthRequest, res, next) => {
```

```ts
router.get('/:id/with-links', async (req: AuthRequest, res, next) => {
```
→
```ts
router.get('/:id/with-links', validateIdParam(), async (req: AuthRequest, res, next) => {
```

`backend/src/routes/surat-keluar.routes.ts` (`validateIdParam` sudah diimpor di baris 9):

```ts
router.post('/:id/archive-full', canWriteMiddleware(), async (req: AuthRequest, res, next) => {
```
→
```ts
router.post('/:id/archive-full', validateIdParam(), canWriteMiddleware(), async (req: AuthRequest, res, next) => {
```

```ts
router.get('/:id/source', async (req: AuthRequest, res, next) => {
```
→
```ts
router.get('/:id/source', validateIdParam(), async (req: AuthRequest, res, next) => {
```

```ts
router.get('/:id/with-links', async (req: AuthRequest, res, next) => {
```
→
```ts
router.get('/:id/with-links', validateIdParam(), async (req: AuthRequest, res, next) => {
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/surat-id-param.routes.test.ts src/routes/__tests__/surat-masuk.routes.test.ts src/routes/__tests__/surat-file-security.routes.test.ts src/__tests__/record-unit-scope.routes.test.ts`
Expected: PASS semua. `surat-file-security` memakai UUID valid; test lain me-mock `validateIdParam`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/surat-masuk.routes.ts backend/src/routes/surat-keluar.routes.ts backend/src/__tests__/surat-id-param.routes.test.ts
git commit -m "fix(surat): validasi UUID :id pada route balasan, with-links, source, archive-full" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: InfoSection tanpa field fantom, tampilkan Disposisi & Keterangan

**Files:**
- Modify: `frontend/src/components/surat-masuk/InfoSection.jsx` (seluruh file, baris 1-151)
- Modify: `frontend/src/components/surat-masuk/__tests__/InfoSection.test.jsx` (seluruh file)
- Test: file di atas dan regresi `frontend/src/components/surat-masuk/__tests__/InfoSection.rules.test.jsx`

**Interfaces:**
- Consumes: objek `surat` dari `GET /api/surat-masuk/:id` (kolom `surat_masuk`, `backend/src/db/schema/surat-masuk.ts:7-37`): `perihal`, `nomorSurat`, `tanggalSurat`, `noUrut`, `dari`, `kepada`, `jenisSurat`, `sifatSurat`, `klasifikasiKode`, `klasifikasiUraian`, `disposisi: string[] | null`, `keterangan: string | null`, `linkDokumen`.
- Produces: `export function InfoSection({ surat })`. Props tidak berubah. `tanggalDiterima`, `noAgenda`, dan `catatan` tidak dibaca lagi. `<ul aria-label="Disposisi">` hanya dirender bila ada label.

- [ ] **Step 1: Tulis test yang gagal**

Ganti seluruh isi `frontend/src/components/surat-masuk/__tests__/InfoSection.test.jsx`:

```jsx
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { InfoSection } from '../InfoSection';

describe('InfoSection', () => {
    const mockSurat = {
        perihal: 'Test Surat Penting',
        nomorSurat: '123/TEST/2024',
        tanggalSurat: '2024-02-13T00:00:00.000Z',
        noUrut: 17,
        tahun: 2024,
        dari: 'Kementerian Pusat',
        kepada: 'Unit Teknis',
        jenisSurat: 'Undangan',
        sifatSurat: 'segera',
        klasifikasi: 'UMUM',
        linkDokumen: 'https://example.com/doc',
        disposisi: ['Dit. BPPT', 'Kabag Umum'],
        keterangan: 'Harap hadir tepat waktu',
    };

    it('menampilkan kolom surat_masuk yang nyata', () => {
        render(<InfoSection surat={mockSurat} />);

        expect(screen.getByText('Test Surat Penting')).toBeInTheDocument();
        expect(screen.getByText('123/TEST/2024')).toBeInTheDocument();
        expect(screen.getByText('Kementerian Pusat')).toBeInTheDocument();
        expect(screen.getByText('Unit Teknis')).toBeInTheDocument();
        expect(screen.getByText('Undangan')).toBeInTheDocument();
        expect(screen.getByText('Segera')).toBeInTheDocument();
        const agenda = screen.getByText('No. Agenda').parentElement;
        expect(within(agenda).getByText('17')).toBeInTheDocument();
    });

    it('tidak merender field fantom yang tidak pernah dikirim API', () => {
        render(<InfoSection surat={{
            ...mockSurat,
            tanggalDiterima: '2024-02-14T00:00:00.000Z',
            noAgenda: 'AGENDA-001',
            catatan: 'Catatan fantom',
        }} />);

        expect(screen.queryByText('Tanggal Diterima')).not.toBeInTheDocument();
        expect(screen.queryByText('AGENDA-001')).not.toBeInTheDocument();
        expect(screen.queryByText('Catatan')).not.toBeInTheDocument();
        expect(screen.queryByText('Catatan fantom')).not.toBeInTheDocument();
    });

    it('menampilkan label disposisi sebagai daftar dan membuang label kosong data lama', () => {
        render(<InfoSection surat={{ ...mockSurat, disposisi: ['Dit. BPPT', '  ', '', 'Kabag Umum ', null] }} />);

        const list = screen.getByRole('list', { name: 'Disposisi' });
        expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Dit. BPPT', 'Kabag Umum']);
    });

    it.each([[null], [[]], [['', '   ']], ['BPPT']])('menampilkan keadaan kosong bila disposisi %j', (disposisi) => {
        render(<InfoSection surat={{ ...mockSurat, disposisi }} />);

        expect(screen.getByText('Belum ada disposisi')).toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'Disposisi' })).not.toBeInTheDocument();
    });

    it('menampilkan keterangan multi-baris bila ada', () => {
        render(<InfoSection surat={{ ...mockSurat, keterangan: 'Baris satu\nBaris dua' }} />);

        expect(screen.getByText('Keterangan')).toBeInTheDocument();
        expect(screen.getByText(/Baris satu/)).toHaveClass('whitespace-pre-line');
    });

    it.each([[null], [''], ['   ']])('menyembunyikan keterangan bila %j', (keterangan) => {
        render(<InfoSection surat={{ ...mockSurat, keterangan }} />);

        expect(screen.queryByText('Keterangan')).not.toBeInTheDocument();
    });

    it('menampilkan "-" untuk No. Agenda bila noUrut tidak ada', () => {
        render(<InfoSection surat={{ ...mockSurat, noUrut: null }} />);

        const agenda = screen.getByText('No. Agenda').parentElement;
        expect(within(agenda).getByText('-')).toBeInTheDocument();
    });

    it.each([
        ['Sangat Segera', 'Sangat Segera'],
        ['sangat-segera', 'Sangat Segera'],
        ['RAHASIA', 'Rahasia'],
        ['Sangat Rahasia', 'Sangat Rahasia'],
        ['Terbatas', 'Terbatas'],
        [null, 'Biasa'],
        ['', 'Biasa'],
        ['constructor', 'constructor'],
    ])('memberi label sifat %j sebagai %s', (sifatSurat, label) => {
        render(<InfoSection surat={{ ...mockSurat, jenisSurat: 'Nota Dinas', sifatSurat }} />);

        const sifat = screen.getByText('Sifat Surat').parentElement;
        expect(within(sifat).getByText(label)).toBeInTheDocument();
    });

    it('merender link dokumen bila ada', () => {
        render(<InfoSection surat={mockSurat} />);

        const link = screen.getByText('https://example.com/doc');
        expect(link).toBeInTheDocument();
        expect(link.closest('a')).toHaveAttribute('href', 'https://example.com/doc');
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd frontend && npx vitest run src/components/surat-masuk/__tests__/InfoSection.test.jsx`
Expected: FAIL.
- `within(agenda).getByText('17')` tidak ditemukan.
- 'Tanggal Diterima' masih ada.
- Daftar `Disposisi` belum ada.
- `'Sangat Segera'` mentah masih dilabeli "Biasa".

- [ ] **Step 3: Implementasi**

Ganti seluruh isi `frontend/src/components/surat-masuk/InfoSection.jsx`:

```jsx
import { FileText, Calendar, Hash, Building, User, Sparkles, Link2, ExternalLink, Send } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { format } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { useAppConfig } from '@/context/app-config-context';
import { SuratRetentionSummary } from '@/components/SuratRetentionSummary';

const SIFAT_LABELS = new Map([
    ['biasa', 'Biasa'],
    ['biasa/terbuka', 'Biasa/Terbuka'],
    ['terbuka', 'Terbuka'],
    ['segera', 'Segera'],
    ['sangat_segera', 'Sangat Segera'],
    ['undangan', 'Undangan'],
    ['penting', 'Penting'],
    ['terbatas', 'Terbatas'],
    ['rahasia', 'Rahasia'],
    ['sangat_rahasia', 'Sangat Rahasia'],
]);
const SIFAT_DESTRUCTIVE = new Set(['sangat_segera', 'rahasia', 'sangat_rahasia']);
const SIFAT_EMPHASIS = new Set(['segera', 'terbatas']);

// Normalisasi sama dengan normalizeSecurityClassification (backend) tanpa
// pemetaan kelas, agar nilai impor seperti "Sangat Segera" atau "RAHASIA"
// tidak tampil sebagai "Biasa".
function sifatKey(value) {
    const raw = typeof value === 'string' && value.length > 0 ? value : 'biasa';
    return raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function sifatBadge(value) {
    const key = sifatKey(value);
    const fallback = typeof value === 'string' && value.trim() ? value.trim() : 'Biasa';
    return {
        label: SIFAT_LABELS.get(key) || fallback,
        variant: SIFAT_DESTRUCTIVE.has(key) ? 'destructive' : SIFAT_EMPHASIS.has(key) ? 'default' : 'secondary',
    };
}

function disposisiLabels(value) {
    if (!Array.isArray(value)) return [];
    return value
        .filter((label) => typeof label === 'string' && label.trim().length > 0)
        .map((label) => label.trim());
}

export function InfoSection({ surat }) {
    const { capabilities } = useAppConfig();
    const formatDate = (dateString) => {
        if (!dateString) return '-';
        try {
            return format(new Date(dateString), 'dd MMMM yyyy', { locale: localeId });
        } catch {
            return dateString;
        }
    };
    const sifat = sifatBadge(surat.sifatSurat);
    const disposisi = disposisiLabels(surat.disposisi);
    const keterangan = typeof surat.keterangan === 'string' ? surat.keterangan.trim() : '';
    const noAgenda = surat.noUrut !== null && surat.noUrut !== undefined && surat.noUrut !== ''
        ? String(surat.noUrut)
        : '-';

    return (
        <Card className="shadow-sm hover:shadow-md transition-shadow duration-200">
            <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-emerald-600" />
                    Informasi Surat
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Perihal Highlight Section */}
                <div className="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 p-4 rounded-xl border border-emerald-100 dark:border-emerald-900/50">
                    <label className="text-xs uppercase tracking-wider font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                        <Sparkles className="h-3 w-3" />
                        Perihal
                    </label>
                    <p className="text-lg font-semibold text-foreground dark:text-white mt-1 leading-relaxed">
                        {surat.perihal}
                    </p>
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1 p-3 bg-muted/30 rounded-lg">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nomor Surat</label>
                        <p className="font-mono text-sm bg-background px-3 py-2 rounded-md border">{surat.nomorSurat}</p>
                    </div>
                    <div className="space-y-1 p-3 bg-muted/30 rounded-lg">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tanggal Surat</label>
                        <p className="flex items-center gap-2 text-sm">
                            <Calendar className="h-4 w-4 text-emerald-600" />
                            {formatDate(surat.tanggalSurat)}
                        </p>
                    </div>
                    <div className="space-y-1 p-3 bg-muted/30 rounded-lg">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">No. Agenda</label>
                        <p className="flex items-center gap-2 text-sm">
                            <Hash className="h-4 w-4 text-blue-600" />
                            <span>{noAgenda}</span>
                        </p>
                    </div>
                </div>

                <Separator />

                {/* Sender/Recipient */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2 p-4 border rounded-xl bg-gradient-to-br from-blue-50/50 to-indigo-50/50 dark:from-blue-950/20 dark:to-indigo-950/20">
                        <label className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wide flex items-center gap-1">
                            <Building className="h-3 w-3" />
                            Dari
                        </label>
                        <p className="font-medium">{surat.dari}</p>
                    </div>
                    <div className="space-y-2 p-4 border rounded-xl bg-gradient-to-br from-purple-50/50 to-pink-50/50 dark:from-purple-950/20 dark:to-pink-950/20">
                        <label className="text-xs font-semibold text-purple-700 dark:text-purple-400 uppercase tracking-wide flex items-center gap-1">
                            <User className="h-3 w-3" />
                            Kepada
                        </label>
                        <p className="font-medium">{surat.kepada || <span className="text-muted-foreground italic">-</span>}</p>
                    </div>
                </div>

                {/* Type & Classification */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Jenis Surat</label>
                        <p className="text-sm font-medium">{surat.jenisSurat || '-'}</p>
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sifat Surat</label>
                        <Badge variant={sifat.variant} className="mt-1">
                            {sifat.label}
                        </Badge>
                    </div>
                    <div className="space-y-1 col-span-2 sm:col-span-1">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Klasifikasi</label>
                        <p className="text-sm font-medium">{surat.klasifikasiKode || surat.klasifikasi || '-'}</p>
                        {surat.klasifikasiUraian && <p className="text-sm text-muted-foreground">{surat.klasifikasiUraian}</p>}
                    </div>
                </div>

                {/* Disposisi (label tampilan; routing ada di Kotak Disposisi) */}
                <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                        <Send className="h-3 w-3" />
                        Disposisi
                    </label>
                    {disposisi.length > 0 ? (
                        <ul aria-label="Disposisi" className="flex flex-wrap gap-2">
                            {disposisi.map((label, index) => (
                                <li key={`${index}-${label}`}>
                                    <Badge variant="outline">{label}</Badge>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-muted-foreground italic">Belum ada disposisi</p>
                    )}
                </div>

                <SuratRetentionSummary surat={surat} />

                {/* Link Dokumen */}
                {capabilities.files && surat.linkDokumen && (
                    <>
                        <Separator />
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Link Dokumen</label>
                            <a
                                href={surat.linkDokumen}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-100 dark:border-blue-900/50 hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors group"
                            >
                                <div className="bg-blue-500 p-2 rounded-lg">
                                    <Link2 className="h-4 w-4 text-white" />
                                </div>
                                <span className="text-blue-700 dark:text-blue-300 group-hover:underline truncate flex-1">
                                    {surat.linkDokumen}
                                </span>
                                <ExternalLink className="h-4 w-4 text-blue-500 shrink-0" />
                            </a>
                        </div>
                    </>
                )}

                {/* Keterangan */}
                {keterangan && (
                    <>
                        <Separator />
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Keterangan</label>
                            <div className="bg-amber-50 dark:bg-amber-950/30 p-4 rounded-lg border border-amber-100 dark:border-amber-900/50">
                                <p className="text-sm leading-relaxed whitespace-pre-line">{keterangan}</p>
                            </div>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
```

- [ ] **Step 4: Jalankan test dan lint, pastikan lulus**

Run: `cd frontend && npx vitest run src/components/surat-masuk/__tests__/InfoSection.test.jsx src/components/surat-masuk/__tests__/InfoSection.rules.test.jsx src/pages/surat-archive-dialog.test.jsx src/pages/surat-pagination-recovery.test.jsx`
Expected: PASS semua.

Run: `cd frontend && npx eslint src/components/surat-masuk/InfoSection.jsx src/components/surat-masuk/__tests__/InfoSection.test.jsx`
Expected: tanpa error.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/surat-masuk/InfoSection.jsx frontend/src/components/surat-masuk/__tests__/InfoSection.test.jsx
git commit -m "fix(surat-masuk): hapus field fantom InfoSection, tampilkan disposisi dan keterangan" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Verifikasi penuh, gerbang pre-flight, dan urutan merge dengan PR #15

**Files:**
- Modify (hanya setelah pre-flight produksi dijalankan operator): `backend/src/__tests__/fixtures/sifat-surat-produksi.json`
- Create (oleh operator): `docs/HASIL_PREFLIGHT_INTEGRASI_SURAT_P0_<YYYY-MM-DD>.md`
- Test: seluruh suite backend dan frontend

**Interfaces:**
- Consumes: semua keluaran Task 1-8; laporan pre-flight produksi.
- Produces: branch `feat/integrasi-surat-p0` yang sudah di-rebase di atas `origin/main` (termasuk PR #15), semua test hijau, fixture paritas berisi nilai produksi, dan laporan pre-flight yang ditandatangani (kriteria selesai P0 di §10 spec).

- [ ] **Step 1: Jalankan seluruh suite**

Run: `cd backend && npm test`
Expected: PASS semua, tanpa test yang gagal atau dilewati selain yang memang sudah `skip` di `5f57b39`.

Run: `cd backend && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

Run: `cd frontend && npm test`
Expected: PASS semua.

Run: `cd frontend && npx eslint src/components/surat-masuk`
Expected: tanpa error.

- [ ] **Step 2: Gerbang pre-flight produksi (operator, bukan agen)**

Agen **tidak** memegang kredensial produksi. Serahkan `docs/PREFLIGHT_INTEGRASI_SURAT_P0.md` ke operator, yang lalu menjalankan langkah 1-5 di checklist tersebut. Hasilnya:
- `docs/HASIL_PREFLIGHT_INTEGRASI_SURAT_P0_<YYYY-MM-DD>.md` yang blok Pengesahannya sudah terisi;
- `backend/src/__tests__/fixtures/sifat-surat-produksi.json` yang sudah diregenerasi.

Setelah kedua file diterima, jalankan:

Run: `cd backend && npx vitest run src/__tests__/visibility-spec.parity.test.ts`
Expected: PASS. Bila FAIL, P0 **belum selesai**. Laporkan nilai `mismatches` ke pemilik keamanan dan perbaiki `visibility-spec.ts` beserta konstanta di `preflight-integrasi-surat.mjs` bersamaan, lalu ulangi Task 1 Step 5 dan langkah ini.

```bash
git add backend/src/__tests__/fixtures/sifat-surat-produksi.json docs/HASIL_PREFLIGHT_INTEGRASI_SURAT_P0_*.md
git commit -m "test(access): fixture paritas sifat_surat produksi dan laporan pre-flight P0" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Rebase setelah PR #15 masuk ke main**

Run: `git fetch origin && git merge-base --is-ancestor 3f90404 origin/main && echo PR15_MERGED || echo PR15_BELUM`
Expected: `PR15_MERGED`. Bila `PR15_BELUM`, berhenti di sini dan tunggu. P0 tidak boleh dimerge sebelum PR #15.

Run: `git rebase origin/main`
Expected: tanpa konflik, karena hunk P0 tidak tumpang tindih dengan PR #15. Bila ada konflik di `surat-masuk.routes.ts` atau `surat-keluar.routes.ts`, pertahankan versi PR #15 untuk logging dan `getStats`, lalu terapkan ulang `validateIdParam()` persis seperti Task 7 Step 3. Setelah itu `git add` file tersebut dan `git rebase --continue`.

Run: `cd backend && npm test && npx tsc --noEmit -p tsconfig.json && cd ../frontend && npm test`
Expected: PASS semua.

- [ ] **Step 4: Push dan buka PR (setelah konfirmasi pengguna)**

```bash
git push -u origin feat/integrasi-surat-p0
gh pr create --base main --head feat/integrasi-surat-p0 --title "Integrasi surat P0: pre-flight produksi dan perbaikan bug" --body "$(cat <<'EOF'
Ringkasan P0 (spec docs/superpowers/specs/2026-09-26-integrasi-surat-masuk-keluar-design.md, bagian 10).

Pre-flight:
- Skrip pre-flight produksi read-only: backend/scripts/preflight-integrasi-surat.mjs
- Checklist operator: docs/PREFLIGHT_INTEGRASI_SURAT_P0.md
- Laporan bertanda tangan: docs/HASIL_PREFLIGHT_INTEGRASI_SURAT_P0_*.md

Perbaikan:
- visibility-spec.ts: normalisasi klasifikasi TS dan SQL dari satu sumber, dengan test paritas atas nilai sifat_surat produksi.
- Kotak/keluar disposisi dan notifikasi disposisi kini menampilkan 'Sangat Segera', string kosong, dan NULL sebagai biasa.
- createDistributionSchema.instruction menerima null (sebelumnya DistributeDialog mendapat 400).
- Daftar surat keluar dan notifikasi memakai is_deleted IS NOT TRUE.
- validateIdParam dipasang pada /balasan, /with-links, /source, dan /archive-full.
- InfoSection tanpa field fantom; kini menampilkan disposisi dan keterangan.

Tidak ada migrasi, role baru, atau perubahan check().
Dimerge setelah PR #15.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Cakupan spec (§10 baris P0, §4, §11):**

| Butir spec P0 | Task |
|---|---|
| Pre-flight: baris `unit_kerja` termasuk `dir_*`/`direktorat-*` | 1 (`unit_kerja_semua`, `unit_kerja_direktorat`, `unit_kerja_id_direktorat_dash`) |
| Duplikat distribusi aktif | 1 (`distribusi_aktif_ganda`, predikat sama dengan precheck 0046) |
| Status distribusi tak dikenal | 1 (`distribusi_status_tak_dikenal`, `distribusi_per_status`) |
| Index manual `idx_surat_keluar_balasan` | 1 (`index_dan_objek_bentrok`, `index_manual_surat`) |
| pg_trgm | 1 (`ekstensi`) |
| Keberadaan data lama (2.047) | 1 (`data_lama_ringkasan`, `data_lama_per_unit_tahun`, `label_disposisi`, `balasan_lintas_unit`) |
| Distinct `sifat_surat` | 1 (`sifat_surat_distinct`, `sifat_surat_kelas`, `--format=sifat-json`) |
| Jumlah distribusi sent/received per kelas | 1 (`distribusi_terbuka_per_kelas`, kelas lama vs baru) |
| Laporan pre-flight ditandatangani | 1 (blok Pengesahan, checklist) + 9 Step 2 |
| `instruction` `.nullish()` + route test distribusi tanpa instruksi | 4 |
| `is_deleted IS NOT TRUE` di list keluar (`surat-keluar.service.ts:54`) | 5 |
| `is_deleted IS NOT TRUE` di notifikasi | 6 |
| `validateIdParam` pada `/balasan`, `/with-links`, `/source`, `/archive-full` | 7 |
| Field fantom InfoSection + disposisi & keterangan (RTL) | 8 |
| Normalisasi SQL `incomingSecurityCondition` = TS; cikal bakal `visibility-spec.ts`; test paritas atas semua `sifat_surat` prod; 'Sangat Segera' → biasa tampil di inbox | 2 + 3 (+ 9 Step 2 untuk fixture prod) |
| Dimerge setelah PR #15 | Global Constraints + 9 Step 3 |
| §11 "transaksi batal bila `logActionOrThrow` gagal" | Tidak ada mutasi baru di P0; test yang ada (`distribution.service.test.ts` "rolls back distribution creation…") tetap dijalankan di Task 3-4 |

**Placeholder:** tidak ada "TBD", "tambahkan validasi", maupun "mirip Task N". Ada dua teks berkurung siku yang disengaja:
- `<connection string read-only>` di checklist dan `<YYYY-MM-DD>` pada nama file laporan. Keduanya diisi operator saat eksekusi, dan kredensial tidak boleh ditulis di repo.
- Isi fixture JSON produksi baru diketahui setelah pre-flight berjalan. Karena itu fixture awal memuat nilai yang diketahui dari kode, dan regenerasinya adalah langkah gerbang yang eksplisit (9 Step 2).

**Konsistensi nama:**
- `SECURITY_CLASSES`, `BIASA_SIFAT_ALIASES`, `JS_WHITESPACE_CODEPOINTS`, `PG_TRIM_PATTERN`, `PG_SEPARATOR_PATTERN`, `normalizeSecurityClassification`, `klasifikasiNormSql`, `klasifikasiInSql`: didefinisikan di Task 2 dan dipakai dengan nama yang sama di Task 3 dan 6.
- `PREFLIGHT_CHECKS`, `PREFLIGHT_TRANSACTION`, `assertReadOnlySql`, `runPreflight`, `formatReport`, `formatSifatFixture`: didefinisikan di Task 1 dan dipakai di test serta checklist.
- `createInboxDatabase`, `letterId`, `distributionId`, `InboxFixtureLetter`: didefinisikan di Task 3 dan dipakai ulang di Task 6.
- Id pemeriksaan di checklist sama persis dengan `PREFLIGHT_CHECKS[].id`.

**Ambiguitas spec yang diputuskan:**
1. **Cakupan normalisasi SQL.** Spec P0 hanya menyebut `incomingSecurityCondition` di `distribution.service.ts`. Salinan lain di surat-masuk list, dosir, dashboard, global-search, report, dan notifikasi pending tidak diubah, karena mengubahnya akan menggeser daftar surat masuk/`getStats` yang disentuh PR #15. Pengecualian: notifikasi **disposisi** ikut diubah agar badge sama dengan isi kotak disposisi. Sisanya dipindahkan di P2 sesuai §4.3.
2. **Paritas TS↔SQL ditegakkan secara nyata.**
   - SQL memakai kelas whitespace eksplisit ECMAScript (bukan `trim()` Postgres) dan `nullif(col,'')`, karena TS memetakan `''` ke `biasa`. Perilaku TS tidak berubah.
   - Untuk non-ASCII, paritas didefinisikan pada **keputusan kelas**: nilai tak dikenal selalu ditolak `inArray`. Paritas string persis hanya diwajibkan untuk ASCII, karena `lower()` Postgres bergantung locale.
3. **`validateIdParam` tidak dipasang pada `POST /:id/archive`.** Endpoint ini selalu 410 (jalur dinonaktifkan), dan test mengunci perilaku tersebut.
4. **"No. Agenda" dipertahankan dari `noUrut`** (§1 spec: Nomor Agenda = `surat_masuk.no_urut`), bukan dihapus. `tanggalDiterima` dan `catatan` dihapus karena tidak ada kolomnya.
5. **Label sifat di InfoSection dinormalisasi.** Tanpa normalisasi, nilai impor seperti `Rahasia` atau `Sangat Segera` tampil sebagai "Biasa", padahal perbaikan tampilan informasi memang cakupan butir InfoSection.
6. **`findInbox`/`findOutbox` belum menyaring surat terhapus.** Itu bukan butir P0 dan menjadi bagian kotak disposisi bertopeng P3. Akibatnya, badge notifikasi disposisi (sudah menyaring) bisa lebih kecil daripada isi kotak selama surat sumber yang terhapus masih punya disposisi terbuka.
7. **Pre-flight berbentuk skrip Node, bukan file `.sql` untuk psql.** Pola ini sama dengan `migrate-database.mjs`; bentuk ini bisa diuji di PGlite, menjamin transaksi `READ ONLY` + `ROLLBACK`, dan menghasilkan laporan serta fixture sekaligus. SQL setiap pemeriksaan tetap tertulis utuh di `PREFLIGHT_CHECKS`.

## Catatan Konsistensi Lintas Fase (2026-09-26)

Perubahan dari tinjauan konsistensi P0–P5 terhadap berkas ini:

- Branch diganti dari `feat/integrasi-surat` menjadi `feat/integrasi-surat-p0` (Global Constraints, Task 9 `git push`/`gh pr create`); konvensi lintas fase: satu branch `feat/integrasi-surat-pN` per fase dari `origin/main` setelah PR fase sebelumnya dimerge.
- Klaim "salinan normalisasi SQL lain dipindahkan ke `visibility-spec.ts` di P2" dikoreksi: tidak ada fase P1–P5 yang memilikinya (P2 hanya memakai `visibility-spec.ts` untuk jalur baru). Dicatat sebagai pekerjaan lanjutan.
- Tidak ada perubahan kode: ekspor `visibility-spec.ts` P0 (`SECURITY_CLASSES`, `normalizeSecurityClassification`, `klasifikasiNormSql(column: AnyColumn | SQL)` dengan `coalesce(nullif(col, ''), 'biasa')`, `klasifikasiInSql`, …) kini dikutip persis di "Consumes" P2; P1 Task 10 dan P2 Task 2 menambahkan fungsi ke berkas ini (gabungkan impor `drizzle-orm`).
