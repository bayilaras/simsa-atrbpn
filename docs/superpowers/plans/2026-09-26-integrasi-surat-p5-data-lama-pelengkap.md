# Integrasi Surat — P5 Data Lama, Koreksi Berkas & Pelengkap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menuntaskan fase P5 Integrasi Surat: backfill label disposisi data lama (langkah 2) yang bergerbang dry-run → CSV → sign-off → `--apply`, flag `RANGKAIAN_DISPOSISI_LAMA_READ`, Tutup massal data lama, Koreksi Berkas maker-checker, migrasi pengerasan `0048` (`surat_distributions.rangkaian_id SET NOT NULL`), notifikasi batas waktu, ekspor "Balasan Untuk" sebagai nomor + kolom "Asal Naskah", pembaruan PANDUAN; ditambah dua tugas opsional bergerbang (pg_trgm, re-key `generalLimiter` per user).

**Architecture:** Semua perubahan menumpang pada tabel dan layanan P1–P4 tanpa mengubah `check()`. Skrip backfill langkah 2 adalah `.mjs` mandiri (pola `migrate-database.mjs`) yang menulis lewat SQL ber-parameter, diaudit ke `audit_log`, dan hanya menerapkan rencana yang SHA-256-nya sama dengan CSV yang disetujui. Flag data lama dibaca saat panggilan di satu-satunya fragmen jangkauan (`visibility-spec.ts`), sehingga `checkRead`, `checkMany`, seed Lacak, dan daftar rangkaian ikut tunduk. Koreksi Berkas dan Tutup massal hidup di dua service baru ber-SQL mentah dalam `db.transaction` + `logActionOrThrow(tx)`, diekspos lewat router `rangkaian-berkas.routes.ts` yang dipasang sebelum router rangkaian P2.

**Tech Stack:** Express + TypeScript, Drizzle ORM (`sql` mentah), PostgreSQL/Neon, PGlite (`@electric-sql/pglite` + `contrib/pgcrypto`, opsional `contrib/pg_trgm`), Vitest 4, Supertest, React 19 JSX + Vitest/RTL, ExcelJS, express-rate-limit 8, Zod 4.

**Spec:** docs/superpowers/specs/2026-09-26-integrasi-surat-masuk-keluar-design.md

## Global Constraints

- **Git:** kerjakan di branch `feat/integrasi-surat-p5`: `git fetch origin && git switch -c feat/integrasi-surat-p5 origin/main` setelah PR P4 dimerge. Konvensi lintas fase: satu branch per fase `feat/integrasi-surat-pN`, dibuat dari `origin/main` setelah PR fase sebelumnya dimerge; bila PR itu belum dimerge, branch ditumpuk di ujung `feat/integrasi-surat-p(N-1)` lalu di-rebase ke `origin/main` setelah merge. Satu PR per fase ke `main`.
- **Prasyarat fase:** P1–P4 sudah dimerge. Kriteria keluar P3 terpenuhi di setiap lingkungan target: `SELECT count(*) FROM surat_distributions WHERE rangkaian_id IS NULL` = 0. Bila salah satu antarmuka di bagian **Interfaces → Consumes** tidak ditemukan oleh langkah verifikasi, hentikan: P5 tidak boleh membuat ulang antarmuka P1–P4.
- **D5:** tidak ada role baru. Hanya `super_admin` dan `admin_unit` yang diberikan; pengawas = role FULL_ADMIN **dan** unit efektif ber-`unit_kerja.is_unit_pengawas = true`.
- **D6:** `bagian_*` dan label Kabag (`'Kabag Program dan Hukum'`, `'Kabag Kepegawaian Keuangan dan Umum'`) **label-saja**. Pemetaan tidak boleh merutekannya; `disposisi_label_unit.unit_kerja_id` untuk keduanya `NULL`. Keputusan D6 (2026-09-26) menggantikan kalimat §3 langkah 2.1 "kedua label kabag → sesditjen".
- `recordAccessService.check()` dan `inspect()` tidak diubah. Aplikasi tidak pernah memakai `DELETE` pada tabel `rangkaian_*`.
- Migrasi: SQL tulis tangan, akhir baris **LF**, dipisah `--> statement-breakpoint`, journal berurutan (`0048` → `when` 1789397419667; opsional `0049` → 1789397420667). **Jangan** jalankan drizzle-kit. Setelah menambah migrasi, perbarui `EXPECTED_MIGRATIONS_JSON` untuk `db:grants:converge` dan jalankan `npm run test:migration-manifest` dari root.
- Setiap mutasi: dalam satu transaksi, diaudit dengan `auditLogService.logActionOrThrow(data, tx)` (skrip `.mjs` menulis `audit_log` langsung dalam transaksi yang sama). Handler GET bebas efek samping.
- Semua SQL ber-parameter (template `sql` Drizzle atau `$n` node-postgres). Tidak ada interpolasi string nilai pengguna.
- Flag default **mati**: `RANGKAIAN_DISPOSISI_LAMA_READ` hanya menyala untuk string persis `true` (tanpa `trim`, sama dengan `isDisposisiLamaReadEnabled` P2 di `visibility-spec.ts`). Flag hanya dinyalakan setelah sign-off pemilik keamanan atas CSV dry-run (§13 pertanyaan 1).
- Urutan rilis P5: deploy kode (flag mati) → `db:migrate` (0048) → `db:grants:converge` → dry-run backfill → sign-off CSV → `--apply --approved-sha256=<hash>` → (terpisah, setelah sign-off) nyalakan flag.
- Pesan pengguna dan prosa dalam Bahasa Indonesia; kode, nama tabel, dan identifier persis seperti spec.
- Perintah test backend dijalankan dari root repo: `npm --prefix backend exec -- vitest run <path>`; frontend: `npm --prefix frontend exec -- vitest run <path>`; typecheck backend: `npm --prefix backend exec -- tsc --noEmit`.
- Pesan commit diakhiri baris kosong lalu `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

#### Amandemen pra-eksekusi global (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p5-data-lama-pelengkap/preflight-rulings.md`.


1. **Commands (BLOCKING) [P5-G-1].** Every "Run:" line and GC#26 changes as follows:

   | Plan form | Replace with |
   |---|---|
   | `npm --prefix backend exec -- vitest run <path>` | `cd backend && npx vitest run <path>` |
   | `npm --prefix frontend exec -- vitest run <path>` | `cd frontend && npx vitest run <path>` |
   | `npm --prefix backend exec -- tsc --noEmit` | `cd backend && npx tsc --noEmit -p tsconfig.json` |

   - Keep `npm run test:migration-manifest` at the repo root.
   - Keep the Postgres form `cd backend && TEST_POSTGRES_URL=… npx vitest run --config vitest.postgres.config.ts <file>`.
   - New GC#26 text: "Perintah test mengikuti P3 GC#37: backend `cd backend && npx vitest run <file>`; frontend `cd frontend && npx vitest run <file>`; typecheck `cd backend && npx tsc --noEmit -p tsconfig.json`. Jangan memakai `npm --prefix … exec` (cwd tetap root sehingga konfigurasi vitest dan path relatif `process.cwd()` salah)."
2. **Workspace (REQUIRED) [P5-G-2].** P5 runs in its own worktree on `feat/integrasi-surat-p5`. Until P4 merges, stack that branch on the final P4 tip; the P4 tip must contain P3 backend and frontend. Every command runs from that worktree root.
3. **No re-implementation (REQUIRED) [P5-G-3].** Each task's Step 1 grep also checks the P3/P4 symbols listed under that task. If a symbol is missing, stop. Never copy a P3/P4 predicate into P5.
   - **(delta P3) Workspace base.** P5 stacks on the P4 tip. That tip must itself sit on the post-final-fix tip of the single branch `feat/integrasi-surat-p3`: both P3 tracks were merged at d890ff2 (see P4-D-1).
   - **(delta P3) Confirmed symbol locations (real P3 @ b4d86fa):**

     | Symbol | Location |
     |---|---|
     | `anggotaMemblokirSql`, `disposisiTerbukaSql` | `rangkaian.service.ts:182, 201`; re-exported at `deps.ts:42` |
     | `dalamCakupanPengawasSql` | `deps.ts:53` |
     | `tingkatAksesRangkaian` | `deps.ts:58` |
     | `denganRetryDeadlock` | `utils/deadlock-retry.ts:15`; re-exported at `deps.ts:60` |
     | `isPengawas` | `deps.ts:87` |
     | `pengawasUntukUnit` | `deps.ts:96` |
     | `loadJangkauan` | `deps.ts:107`, flag-aware |
     | `lockSuratKeluarRows` / `kunciSurat` | `deps.ts:112, 126` |
     | `lockRangkaian` | `deps.ts:155` |
     | `berkasService.unitDalamJangkauanBerkas` | `rangkaian/berkas.service.ts:69-83`, **not** re-exported by deps |

     The fix wave (in flux) adds `tingkatRangkaianPenuh` and `BATAS_NODE_DETAIL` to deps, and rewrites `disposisiTerbukaSql` into a split-count form with the same semantics and signature (C-M1).
   - **(delta P3) `restore()` guard (P3 concurrency carry-forward 1).** `surat-keluar.service.ts:503` and `surat-masuk.service.ts:481` `restore()` have no rangkaian guard, lock or recompute, and are unreachable today. No P5 task may route or call `restore()`. If a later task needs it, it first goes through `guardSuratMasukMutation`/the SK lock plus a recompute, with 409 on `diberkaskan`.
4. **Lock order and retry (REQUIRED) [P5-G-4] RECHECK-AFTER-P3.** Add a new GC:
   > "Urutan kunci P3 (G-LOCK) berlaku untuk setiap transaksi tulis P5: baris `surat_keluar` (FOR UPDATE ORDER BY id) → `surat_masuk` → `rangkaian_surat` (satu pernyataan ORDER BY id) → `surat_distributions`; id dibaca tanpa kunci dulu, lalu dikunci, lalu diperiksa ulang. Setiap transaksi milik layanan P5 dibungkus `denganRetryDeadlock` (`backend/src/utils/deadlock-retry.ts`, re-export `services/rangkaian/deps.ts`); skrip backfill mengulang satu batch maksimal 3× untuk 40P01/40001."
5. **Data-lama cutoff (REQUIRED) [P5-G-5] RECHECK-AFTER-P4.** Add a new GC:
   > "Batas data lama satu definisi dengan P4 D7: env `RANGKAIAN_DATA_LAMA_SEBELUM` (ISO-8601 berzona, regex sama dengan `ISO_BERZONA` P4) atau `min(created_at)` rangkaian `asal <> 'data_lama'`; bila keduanya tidak ada, skrip backfill berhenti dengan galat."
6. **Release gate (REQUIRED) [P5-G-6].** The PR description gets a "Gerbang rilis P5" table. Each row is recorded as signed or refused before production:
   - (a) The label-derived `unit_pengolah_id` is deferred (spec:356 vs spec:358).
   - (b) No peserta is added to a `diberkaskan` rangkaian (RB:106 item 9).
   - (c) `RANGKAIAN_DISPOSISI_LAMA_READ` is enabled, based on the CSV (§13 Q1).
   - (d) Tasks 14 and 15 are skipped.
   - (e) The §13 Q2 answer: does legacy data exist in production?
   - **(delta P3) Added rows:**
     - (f) The `dilewati` remediation: hold 0048, or the 0048 prelude (critic C-3).
     - (g) Spec owner. `data_lama` SM anggota count as `surat_masuk_belum_ditangani` in the P1 facts. A pengawas gabung of a backfilled `data_lama` rangkaian into a live one therefore keeps the target `aktif` until a manual Tandai Selesai. This is P3 concurrency carry-forward 2 (#102) and spec review T12. Decide: accept and document, or exclude `sumber='data_lama'` anggota from that fact in a P1-owned change.
     - (h) Legacy SMs with an unknown `sifat_surat` class stay masked for peserta even after the flag (P3 spec-review Minor 1). The owner accepts this, or maps the classes first. Task 4 item 5 reports the count.
     - (i) Prerequisites: the P3 C-12 gate and the P4 gate are signed; CI "Backend Tests (PostgreSQL 16/17/18)" is green on the P5 head, including the 0048 PGlite and Postgres suites; frontend and backend ship in one deploy.
7. **GC#20 (REQUIRED) [P5-G-7].** Replace "Setelah menambah migrasi, perbarui `EXPECTED_MIGRATIONS_JSON` untuk `db:grants:converge` dan jalankan `npm run test:migration-manifest` dari root." with:
   > "Setelah menambah migrasi, jalankan `npm run test:migration-manifest` dari root. Tidak ada berkas repo `EXPECTED_MIGRATIONS_JSON`; nilainya dihitung saat deploy oleh `.github/scripts/build-migration-manifest.py` dari journal."
8. **Production DB path and role (REQUIRED) [P5-G-8].** Replace the GC "Urutan rilis P5" with:
   > "deploy kode (flag mati) → `scripts/neon-database.mjs migrate --apply` lalu `verify-runtime` (0048; pola `docs/RUNBOOK_INTEGRASI_SURAT_P1.md` langkah 3) → dry-run backfill sebagai `simsa_api` (`NEON_RUNTIME_DATABASE_URL` lewat prompt tersembunyi) → sign-off CSV + SHA → `--apply --approved-sha256=<hash>` sebagai `simsa_api` → (terpisah, setelah sign-off) nyalakan flag. Jangan memakai `simsa_maintenance`/`simsa_operator`."


**Kontroler:** [CTRL-2] bila backfill P3 produksi melaporkan baris dilewati, TAHAN migrasi 0048; prelude yang mematikan trigger 0046 tidak dipakai. [CTRL-3] Tugas 1-8, 11, 12 dikerjakan di branch feat/integrasi-surat-p5 dari ujung P3 2a61bb7 paralel dengan P4; di-merge ke ujung P4 sebelum Tugas 9, 10, 13 dan review akhir P5. Tugas 14 dan 15 (opsional) DILEWATI (gerbang rilis d). Jangan mengubah file frontend P4 (Lacak/Berkas Rangkaian) di tugas 1-8, 11, 12.


## Review Focus

1. **Flag data lama bocor lewat jalur lain.** Satu jalur baca (misalnya kueri daftar rangkaian atau `requestViaRangkaian`) membaca `rangkaian_peserta` tanpa melewati flag. Test: `rangkaian-disposisi-lama-flag.test.ts` (Task 2) memuat matriks `checkRead` flag mati/nyala/peserta berakhir **dan** guard sumber yang gagal bila berkas `src/` non-test menyebut `rangkaian_peserta` tanpa memanggil `isDisposisiLamaReadEnabled`.
2. **Label Kabag/bagian ikut dirutekan (melanggar D6) atau label ke unit pemilik membuat peserta.** Test: `backfill-rangkaian-lama.test.ts` kasus "D6: label Kabag tetap label-saja…" dan "pemetaan yang menunjuk unit bagian ditolak" (Task 3), plus fixture SM3/SM5/SM7 (Task 5).
3. **`--apply` di luar sign-off, tidak idempoten, atau menghidupkan kembali peserta yang sudah dicabut.** Test (Task 5): apply tanpa/beda SHA ditolak; dijalankan dua kali → jumlah baris semua tabel identik; peserta yang diberi `berakhir_at` tidak muncul lagi setelah apply ulang.
4. **Koreksi Berkas: pengaju menyetujui sendiri, koreksi basi, GUC bocor/mengizinkan perubahan lain.** Test (Task 6): 403 untuk pengaju; 409 bila berkas sudah berubah; trigger menolak UPDATE tanpa GUC, dengan GUC ke koreksi `pending`, dan dengan nilai yang berbeda dari baris `approved`; `current_setting('simsa.berkas_koreksi', true)` kosong setelah transaksi.
5. **Ekspor membocorkan nomor surat masuk lintas unit atau terkendali lewat kolom "Balasan Untuk".** Test: `export-balasan.test.ts` (Task 12) — nomor hanya untuk surat masuk unit yang sama dengan kelas yang diizinkan; lainnya `(lintas unit)` / `Dikecualikan` / `(tidak tersedia)`; UUID mentah tidak pernah muncul di workbook.

---

## File Structure

**Baru**
- `backend/src/db/migrations/0048_rangkaian_pengerasan.sql` — pengerasan `rangkaian_id NOT NULL`, satu Koreksi Berkas terbuka per rangkaian, CHECK konsistensi putusan.
- `backend/src/__tests__/helpers/rangkaian-p5-pglite.ts` — PGlite termigrasi penuh + seed unit/user/klasifikasi/berkas untuk test P5. (Nama berbeda dari helper P2 `helpers/rangkaian-pglite.ts` yang sudah ada; P5 **tidak** menimpa helper P2.)
- `backend/src/__tests__/rangkaian-disposisi-lama-flag.test.ts`
- `backend/scripts/backfill-rangkaian-lama.mjs` — backfill langkah 2 (dry-run default, `--apply --approved-sha256=…`).
- `backend/src/__tests__/backfill-rangkaian-lama.test.ts`
- `backend/src/services/rangkaian-koreksi.service.ts` — Koreksi Berkas (ajukan/putuskan/daftar).
- `backend/src/__tests__/rangkaian-koreksi.service.test.ts`
- `backend/src/services/rangkaian-data-lama.service.ts` — ringkasan & Tutup massal data lama.
- `backend/src/__tests__/rangkaian-data-lama.service.test.ts`
- `backend/src/validators/rangkaian-berkas.schemas.ts`
- `backend/src/routes/rangkaian-berkas.routes.ts`
- `backend/src/__tests__/rangkaian-berkas.routes.test.ts`
- `backend/src/services/export-balasan.ts` — resolusi nomor "Balasan Untuk" bertopeng.
- `backend/src/__tests__/export-balasan.test.ts`
- `backend/src/__tests__/notification-batas-waktu.test.ts`
- `backend/src/__tests__/panduan-rangkaian.docs.test.ts`
- `frontend/src/components/surat/KoreksiBerkasSection.jsx` + `.test.jsx`
- `frontend/src/components/surat/TutupMassalDataLama.jsx` + `.test.jsx`
- `frontend/src/services/rangkaian.service.p5.test.js`
- `docs/manajemen-surat/rangkaian-surat.md`
- Opsional: `backend/src/db/grants/0003_optional_pg_trgm.sql`, `backend/src/db/migrations/0049_lacak_trgm.sql`, `backend/src/middlewares/rate-limit-subject.middleware.ts`, `backend/src/__tests__/general-limiter-per-user.test.ts`.

**Diubah**
- `backend/src/db/migrations/meta/_journal.json`, `backend/src/db/schema/surat-distribution.ts` (`rangkaianId.notNull()`), `backend/src/__tests__/migration-chain.integration.test.ts`
- `backend/src/services/access/visibility-spec.ts` (hanya bila `jangkauanUnitsSql`/`isDisposisiLamaReadEnabled` menyimpang dari bentuk kanonik P1/P2), `backend/.env.example`
- `backend/package.json` (skrip `rangkaian:backfill-lama:plan|apply`)
- `backend/src/app.ts` (mount router berkas sebelum router rangkaian), `backend/src/middlewares/demo-access.middleware.ts`, `backend/src/__tests__/demo-access.middleware.test.ts`, `backend/src/__tests__/mutation-audit-policy.test.ts`
- `frontend/src/services/rangkaian.service.js`, `frontend/src/components/surat/AlurSuratPanel.jsx` (+ test-nya), `frontend/src/components/lacak/BerkasRangkaianTab.jsx` (P4, + test-nya)
- `backend/src/services/notification.service.ts`
- `backend/src/services/export.service.ts` (:128-224), `backend/src/__tests__/export-completeness.test.ts`
- `PANDUAN_PENGGUNAAN_SIMSA.md`, `docs/manajemen-surat/{surat-masuk,surat-keluar,distribusi}.md`, `docs/SUMMARY.md`, `docs/OPERASIONAL_BACKEND.md`
- Opsional: `backend/src/db/grants/0001_bootstrap_cloud_sql_roles.sql` tidak diubah (pola saja); `scripts/neon-database-policy.mjs`, test PGlite rantai migrasi, `backend/src/middlewares/rate-limiter.middleware.ts`, `backend/src/app.ts:344`.

---

### Task 1: Helper PGlite rangkaian & migrasi pengerasan 0048

**Files:**
- Create: `backend/src/__tests__/helpers/rangkaian-p5-pglite.ts`
- Create: `backend/src/db/migrations/0048_rangkaian_pengerasan.sql`
- Modify: `backend/src/db/migrations/meta/_journal.json` (tambah entri idx 48 setelah entri idx 47)
- Modify: `backend/src/db/schema/surat-distribution.ts` (kolom `rangkaianId` dari P1)
- Modify: `backend/integration/helpers/rangkaian-db.ts` (harness Postgres P3 Task 2: opsi `stopBefore`) dan `backend/integration/backfill-rangkaian-disposisi.postgres.test.ts` (P3 Task 2: skenario data lama `rangkaian_id NULL` berhenti sebelum 0048)
- Test: `backend/src/__tests__/migration-chain.integration.test.ts` (tambah dua `it` di dalam `describe('PostgreSQL migration chain')`)

**Interfaces:**
- Consumes (P1): tabel `surat_distributions.rangkaian_id`, `rangkaian_surat`, `rangkaian_anggota`, `rangkaian_koreksi_berkas`, `unit_kerja.is_unit_pengawas`, `unit_kerja.parent_id/unit_type/can_receive_distribution`, journal idx 46 (`0046_rangkaian_surat`) dan 47 (`0047_unit_kerja_direktorat`); Drizzle `suratDistributions.rangkaianId`.
- Produces: `createRangkaianTestDatabase(options?: { stopBefore?: string }): Promise<PGlite>`, `applyMigrationTag(db, tag)`, `journalEntries`, `P5_IDS`, `seedRangkaianBase(db): Promise<{ klasA: number; klasB: number }>`, `seedBerkasDiberkaskan(db, klasA): Promise<{ rangkaianId: string; suratMasukId: string }>`; indeks `rangkaian_koreksi_berkas_terbuka_uidx`; constraint `rangkaian_koreksi_berkas_putusan_check`, `rangkaian_koreksi_berkas_berubah_check`.

- [ ] **Step 1: Verifikasi antarmuka P1 tersedia**

Run: `rg -n "\"tag\": \"0047_unit_kerja_direktorat\"" backend/src/db/migrations/meta/_journal.json; rg -n "rangkaian_id" backend/src/db/schema/surat-distribution.ts`
Expected: satu baris journal idx 47 dan satu baris `rangkaianId: uuid('rangkaian_id')`. Bila tidak ada, hentikan (P1 belum dimerge).

- [ ] **Step 2: Tulis helper PGlite (dipakai Task 1, 2, 4–7, 11)**

```ts
// backend/src/__tests__/helpers/rangkaian-p5-pglite.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { enterTestMigratorRole } from './database-role-fixture.js';

type JournalEntry = { idx: number; when: number; tag: string };

const migrationsDir = fileURLToPath(new URL('../../db/migrations/', import.meta.url));

export const journalEntries = (JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
) as { entries: JournalEntry[] }).entries;

export async function applyMigrationTag(database: PGlite, tag: string): Promise<void> {
    const statements = readFileSync(join(migrationsDir, `${tag}.sql`), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean);
    for (const statement of statements) await database.exec(statement);
}

/** Rantai migrasi lengkap (atau berhenti sebelum `stopBefore`) di PGlite terisolasi. */
export async function createRangkaianTestDatabase(options: { stopBefore?: string } = {}): Promise<PGlite> {
    const database = new PGlite({ extensions: { pgcrypto } });
    await database.waitReady;
    await database.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await enterTestMigratorRole(database);
    for (const entry of journalEntries) {
        if (entry.tag === options.stopBefore) break;
        await applyMigrationTag(database, entry.tag);
    }
    return database;
}

export const P5_IDS = {
    superA: '00000000-0000-4000-8000-0000000005a1',
    superB: '00000000-0000-4000-8000-0000000005b2',
    tu: '00000000-0000-4000-8000-0000000005c3',
    bppt: '00000000-0000-4000-8000-0000000005d4',
    ruleSet: '00000000-0000-4000-8000-0000000005e5',
    berkas: '00000000-0000-4000-8000-000000000701',
    suratBerkas: '00000000-0000-4000-8000-000000000601',
} as const;

/** Unit ditjen/sesditjen/dir_*, empat pengguna, dan dua butir klasifikasi draf. */
export async function seedRangkaianBase(database: PGlite): Promise<{ klasA: number; klasB: number }> {
    const hash = 'a'.repeat(64);
    await database.exec(`
        INSERT INTO unit_kerja (id, name) VALUES
          ('ditjen', 'Direktorat Jenderal'), ('sesditjen', 'Sekretariat Direktorat Jenderal')
        ON CONFLICT (id) DO NOTHING;
        INSERT INTO unit_kerja (id, name, parent_id, unit_type, can_receive_distribution) VALUES
          ('dir_bppt', 'Dit. BPPT', 'ditjen', 'direktorat', true),
          ('dir_ptep', 'Dit. PTEP', 'ditjen', 'direktorat', true),
          ('dir_ktpp', 'Dit. KTPP', 'ditjen', 'direktorat', true),
          ('dir_plp', 'Dit. PLP', 'ditjen', 'direktorat', true)
        ON CONFLICT (id) DO NOTHING;
        UPDATE unit_kerja SET is_unit_pengawas = true WHERE id IN ('ditjen', 'sesditjen');
        INSERT INTO users (id, email, role, unit_kerja_id) VALUES
          ('${P5_IDS.superA}', 'super-a@example.test', 'super_admin', NULL),
          ('${P5_IDS.superB}', 'super-b@example.test', 'super_admin', NULL),
          ('${P5_IDS.tu}', 'tu@example.test', 'admin_unit', 'sesditjen'),
          ('${P5_IDS.bppt}', 'bppt@example.test', 'admin_unit', 'dir_bppt');
        INSERT INTO regulatory_rule_sets (
          id, instrument_type, version, name, legal_basis, regulation_number,
          status, effective_from, created_by, source_document_sha256,
          source_document_blob_url, source_document_mime_type,
          source_document_size_bytes, source_document_page_count,
          source_document_verified_at, source_document_verified_by,
          completeness_manifest_sha256, completeness_verified_at,
          impact_report_sha256, impact_report_generated_at, metadata
        ) VALUES (
          '${P5_IDS.ruleSet}', 'klasifikasi', 'p5-test', 'Edisi uji P5',
          'Regulasi uji', 'TEST/P5', 'draft', '2026-01-01', '${P5_IDS.superA}', '${hash}',
          'https://store.private.blob.vercel-storage.com/regulatory-sources/${P5_IDS.ruleSet}/source.pdf',
          'application/pdf', 1000, 1, now(), '${P5_IDS.superA}', '${hash}', now(),
          '${hash}', now(), '{"contentHash":"${hash}","contentItemCount":2}'::jsonb
        );
        INSERT INTO klasifikasi_arsip (rule_set_id, kode, source_record_key, jenis, tipe, content_hash) VALUES
          ('${P5_IDS.ruleSet}', 'KU.01', 'p5:kementerian:0001', 'Keuangan', 'fasilitatif', '${hash}'),
          ('${P5_IDS.ruleSet}', 'KU.02', 'p5:kementerian:0002', 'Keuangan', 'fasilitatif', '${hash}');
    `);
    const klas = (await database.query<{ id: number }>(
        `SELECT id FROM klasifikasi_arsip WHERE rule_set_id = '${P5_IDS.ruleSet}' ORDER BY kode`,
    )).rows;
    return { klasA: klas[0].id, klasB: klas[1].id };
}

/** Rangkaian TU → BPPT (+PTEP) yang sudah diberkaskan di dir_bppt dengan klasifikasi klasA. */
export async function seedBerkasDiberkaskan(database: PGlite, klasA: number) {
    await database.exec(`
        INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal, sifat_surat, klasifikasi_item_id)
        VALUES ('${P5_IDS.suratBerkas}', 'sesditjen', 9001, 2026, 'SM-P5/1/2026', 'Berkas uji koreksi', 'Biasa', ${klasA});
        INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, unit_pengolah_id, judul, tahun, klasifikasi_item_id, selesai_at)
        VALUES ('${P5_IDS.berkas}', 'RS-2026-900001', 'surat_masuk', 'selesai', 'sesditjen', 'dir_bppt',
                'Berkas uji koreksi', 2026, ${klasA}, now());
        INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran)
        VALUES ('${P5_IDS.berkas}', '${P5_IDS.suratBerkas}', 'sesditjen', 'induk');
        INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status, rangkaian_id, penanggung_jawab)
        VALUES ('${P5_IDS.suratBerkas}', 'sesditjen', 'dir_bppt', 'processed', '${P5_IDS.berkas}', true),
               ('${P5_IDS.suratBerkas}', 'sesditjen', 'dir_ptep', 'processed', '${P5_IDS.berkas}', false);
        UPDATE rangkaian_surat SET status = 'diberkaskan', diberkaskan_at = now(), diberkaskan_by = '${P5_IDS.superA}'
         WHERE id = '${P5_IDS.berkas}';
    `);
    return { rangkaianId: P5_IDS.berkas, suratMasukId: P5_IDS.suratBerkas };
}
```

- [ ] **Step 3: Tulis test 0048 yang gagal**

Tambahkan di akhir `describe('PostgreSQL migration chain', …)` pada `backend/src/__tests__/migration-chain.integration.test.ts`, lalu tambahkan impor di atas berkas: `import { P5_IDS, seedBerkasDiberkaskan, seedRangkaianBase } from './helpers/rangkaian-p5-pglite.js';`

```ts
    it('0048 menolak pengerasan selama masih ada disposisi tanpa rangkaian_id', async () => {
        const database = await createDatabase();
        const hardening = journal.entries.find((entry) => entry.tag === '0048_rangkaian_pengerasan');
        expect(hardening).toBeDefined();
        for (const entry of journal.entries) {
            if (entry.tag === hardening!.tag) break;
            await applyMigration(database, entry);
        }
        await database.exec(`
            INSERT INTO unit_kerja (id, name) VALUES ('unit-p5-asal', 'Asal P5'), ('unit-p5-tujuan', 'Tujuan P5');
            INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun)
            VALUES ('00000000-0000-4000-8000-000000000481', 'unit-p5-asal', 1, 2026);
            INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status)
            VALUES ('00000000-0000-4000-8000-000000000481', 'unit-p5-asal', 'unit-p5-tujuan', 'sent');
        `);
        await expect(applyMigration(database, hardening!))
            .rejects.toThrow(/0048: surat_distributions\.rangkaian_id masih NULL/);
    }, PGLITE_MIGRATION_TIMEOUT_MS);

    it('0048 mengeraskan rangkaian_id dan membatasi satu Koreksi Berkas terbuka', async () => {
        const database = await createDatabase();
        for (const entry of journal.entries) await applyMigration(database, entry);

        const column = await database.query<{ is_nullable: string }>(`
            SELECT is_nullable FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'surat_distributions' AND column_name = 'rangkaian_id'`);
        expect(column.rows).toEqual([{ is_nullable: 'NO' }]);

        const { klasA, klasB } = await seedRangkaianBase(database);
        const { rangkaianId } = await seedBerkasDiberkaskan(database, klasA);
        const insertKoreksi = (unit: string) => database.exec(`
            INSERT INTO rangkaian_koreksi_berkas (rangkaian_id, unit_pengolah_lama, unit_pengolah_baru,
              klasifikasi_lama, klasifikasi_baru, alasan, diajukan_by)
            VALUES ('${rangkaianId}', 'dir_bppt', '${unit}', ${klasA}, ${klasB}, 'Salah pilih saat pemberkasan', '${P5_IDS.superA}')`);
        await insertKoreksi('dir_ptep');
        await expect(insertKoreksi('dir_bppt')).rejects.toThrow(/rangkaian_koreksi_berkas_terbuka_uidx/);
        await expect(database.exec(`
            INSERT INTO rangkaian_koreksi_berkas (rangkaian_id, unit_pengolah_lama, unit_pengolah_baru,
              klasifikasi_lama, klasifikasi_baru, alasan, diajukan_by, status)
            VALUES ('${rangkaianId}', 'dir_bppt', 'dir_bppt', ${klasA}, ${klasA}, 'Tidak mengubah apa pun', '${P5_IDS.superA}', 'denied')`))
            .rejects.toThrow(/rangkaian_koreksi_berkas_(putusan|berubah)_check/);
    }, PGLITE_MIGRATION_TIMEOUT_MS);
```

- [ ] **Step 4: Jalankan test, pastikan gagal**

Run: `npm --prefix backend exec -- vitest run src/__tests__/migration-chain.integration.test.ts -t "0048"`
Expected: FAIL — `expect(hardening).toBeDefined()` gagal (journal belum memuat 0048).

- [ ] **Step 5: Tulis migrasi dan entri journal**

`backend/src/db/migrations/0048_rangkaian_pengerasan.sql` (LF):

```sql
-- 0048 (P5): pengerasan rangkaian. Hanya dijalankan setelah backfill langkah 1
-- (backend/scripts/backfill-rangkaian-disposisi.mjs --apply) menuntaskan
-- surat_distributions.rangkaian_id di lingkungan ini.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM surat_distributions WHERE rangkaian_id IS NULL) THEN
    RAISE EXCEPTION '0048: surat_distributions.rangkaian_id masih NULL; jalankan backfill langkah 1 (backfill-rangkaian-disposisi.mjs --apply) dulu';
  END IF;
  IF EXISTS (SELECT 1 FROM rangkaian_koreksi_berkas WHERE status IN ('pending', 'approved')
             GROUP BY rangkaian_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION '0048: lebih dari satu Koreksi Berkas terbuka per rangkaian, rekonsiliasi dulu';
  END IF;
  IF EXISTS (SELECT 1 FROM rangkaian_koreksi_berkas
             WHERE (status = 'pending') <> (diputuskan_by IS NULL)
                OR (diputuskan_by IS NULL) <> (diputuskan_at IS NULL)
                OR (unit_pengolah_baru = unit_pengolah_lama AND klasifikasi_baru = klasifikasi_lama)) THEN
    RAISE EXCEPTION '0048: baris rangkaian_koreksi_berkas tidak konsisten, rekonsiliasi dulu';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE surat_distributions ALTER COLUMN rangkaian_id SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX rangkaian_koreksi_berkas_terbuka_uidx
  ON rangkaian_koreksi_berkas (rangkaian_id) WHERE status IN ('pending', 'approved');
--> statement-breakpoint
ALTER TABLE rangkaian_koreksi_berkas
  ADD CONSTRAINT rangkaian_koreksi_berkas_putusan_check
    CHECK ((status = 'pending') = (diputuskan_by IS NULL)
       AND (diputuskan_by IS NULL) = (diputuskan_at IS NULL)),
  ADD CONSTRAINT rangkaian_koreksi_berkas_berubah_check
    CHECK (unit_pengolah_baru <> unit_pengolah_lama OR klasifikasi_baru <> klasifikasi_lama);
```

Tambahkan entri terakhir pada `entries` di `_journal.json` (setelah objek idx 47):

```json
    {
      "idx": 48,
      "version": "7",
      "when": 1789397419667,
      "tag": "0048_rangkaian_pengerasan",
      "breakpoints": true
    }
```

Pada `backend/src/db/schema/surat-distribution.ts`, ubah kolom P1 menjadi:

```ts
    rangkaianId: uuid('rangkaian_id').notNull().references(() => rangkaianSurat.id),
```

- [ ] **Step 6: Jalankan test, pastikan lulus; jalankan typecheck dan manifest**

Run: `npm --prefix backend exec -- vitest run src/__tests__/migration-chain.integration.test.ts`
Expected: PASS (termasuk test lama "applies every journaled migration…").
Run: `npm --prefix backend exec -- tsc --noEmit`
Expected: tanpa error. Bila ada jalur insert `suratDistributions` tanpa `rangkaianId`, itu pelanggaran invarian P3 — perbaiki pemanggilnya agar melewati `rangkaianService.ensureForSuratMasuk`, bukan melonggarkan kolom.
Run: `npm run test:migration-manifest`
Expected: PASS.

- [ ] **Step 6b: Jaga test Postgres P3 yang sengaja memakai `rangkaian_id NULL` (lintas fase)**

Harness P3 (`backend/integration/helpers/rangkaian-db.ts`) menjalankan **seluruh** journal, sehingga setelah 0048 skenario backfill langkah 1 (distribusi lama tanpa rangkaian) tidak lagi dapat disisipkan. Tambahkan opsi berhenti — ubah tanda tangan dan baris migrasi di harness P3 menjadi:

```ts
export async function createRangkaianTestDatabase(label: string, options: { stopBefore?: string } = {}) {
```

```ts
        const semua = loadMigrations();
        const batas = options.stopBefore ? semua.findIndex((migration) => migration.tag === options.stopBefore) : -1;
        if (options.stopBefore && batas < 0) throw new Error(`Migrasi ${options.stopBefore} tidak ada di journal`);
        await migrateDatabase(connection, batas >= 0 ? semua.slice(0, batas) : semua);
```

Di `backend/integration/backfill-rangkaian-disposisi.postgres.test.ts`, ganti `h = await createRangkaianTestDatabase('backfill');` menjadi:

```ts
    h = await createRangkaianTestDatabase('backfill', { stopBefore: '0048_rangkaian_pengerasan' });
```

Run: `cd backend && TEST_POSTGRES_URL=postgresql://simsa_test:simsa_test@127.0.0.1:5432/simsa_test npx vitest run --config vitest.postgres.config.ts integration`
Expected: PASS. Test P3 lain yang gagal dengan `null value in column "rangkaian_id"` adalah pelanggaran invarian P3 — perbaiki fixture-nya agar melewati `rangkaianService.ensureForSuratMasuk`/mengisi `rangkaianId`, jangan menambah `stopBefore` di luar skenario data lama.

- [ ] **Step 7: Commit**

```bash
git add backend/src/db/migrations/0048_rangkaian_pengerasan.sql backend/src/db/migrations/meta/_journal.json backend/src/db/schema/surat-distribution.ts backend/src/__tests__/helpers/rangkaian-p5-pglite.ts backend/src/__tests__/migration-chain.integration.test.ts backend/integration/helpers/rangkaian-db.ts backend/integration/backfill-rangkaian-disposisi.postgres.test.ts
git commit -m "feat(rangkaian): harden rangkaian_id NOT NULL and single open berkas correction (0048)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


#### Amandemen pra-eksekusi Task 1 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p5-data-lama-pelengkap/preflight-rulings.md`.


1. **Helper name (REQUIRED) [P5-T1-4].** In `backend/src/__tests__/helpers/rangkaian-p5-pglite.ts`, rename `createRangkaianTestDatabase` to `createRangkaianP5Database`, keeping the signature `(options: { stopBefore?: string } = {}) => Promise<PGlite>`. Update Produces and every import in Tasks 1, 2, 4, 5, 6, 7 and 11.
2. **Lift the P2 cap (BLOCKING, carry-forward FR:37) [P5-T1-3] RECHECK-AFTER-P4.**
   - **Files:** add Modify `backend/src/__tests__/helpers/rangkaian-pglite.ts`.
   - **Step 2b (new):** replace the body of `bootRangkaianDatabase` with a journal-driven loop that accepts an optional `stopBefore`:
     ```ts
     import { PGlite } from '@electric-sql/pglite';
     import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
     import { enterTestMigratorRole } from './database-role-fixture';
     import { applyMigrationTag, journalEntries } from './rangkaian-p5-pglite.js';

     /** Rantai migrasi penuh sesuai urutan journal (termasuk 0048+), atau berhenti sebelum `stopBefore`. */
     export async function bootRangkaianDatabase(options: { stopBefore?: string } = {}): Promise<PGlite> {
         const database = new PGlite({ extensions: { pgcrypto } });
         await database.waitReady;
         await enterTestMigratorRole(database);
         for (const entry of journalEntries) {
             if (entry.tag === options.stopBefore) break;
             await applyMigrationTag(database, entry.tag);
         }
         return database;
     }
     ```
   - Remove the now-unused `readdirSync`/`fileURLToPath` imports only if nothing else in that file uses them.
   - Do not change any fixture or snapshot.
   - **Step 6 run list (additions):**
     - P2 suites: `src/__tests__/rangkaian-read.integration.test.ts`, `src/__tests__/record-access-read.integration.test.ts`, `src/__tests__/visibility-parity.property.integration.test.ts`, `src/__tests__/rangkaian-akses.routes.integration.test.ts`, `src/__tests__/record-access-check.snapshot.integration.test.ts`.
     - P4 suites: `src/__tests__/lacak-ranking.integration.test.ts`, `src/__tests__/lacak-probing.integration.test.ts`, `src/__tests__/rangkaian-daftar.integration.test.ts`, `src/__tests__/perlu-dilengkapi.integration.test.ts`, `src/__tests__/asal-naskah.integration.test.ts`.
     - Never pass `-u`. Expected: every suite PASS on the full chain.
     - RECHECK-AFTER-P4: first confirm those file names exist, and that no P4 fixture inserts a NULL `rangkaian_id`.
     - **(delta P3) P3 PGlite suites also boot through `bootRangkaianDatabase`,** so add them to the run list:
       - `src/__tests__/grant-eligibility.integration.test.ts`
       - `src/__tests__/guard-surat-masuk.integration.test.ts`
       - `src/__tests__/rangkaian-link.integration.test.ts`
       - `src/__tests__/tindak-lanjut.integration.test.ts`

       Every `surat_distributions` insert in them supplies `rangkaian_id` (grant-eligibility :102, rangkaian-link :170, tindak-lanjut :94), so they should pass on the full chain unchanged.
     - `helpers/surat-inbox-pglite.ts` (used by `distribution-inbox-classification.test.ts` and `notification-deleted-classification.test.ts`) builds its own hand-written DDL with a nullable `rangkaian_id` (:25-32) and does not use the journal. 0048 does not affect it; leave it alone.
     - The P2 helper cap is unchanged in P3: `rangkaian-pglite.ts:12` still filters `<= 47`, so FR:37 still applies. P3 added no migration: the journal ends at 0047 (`backend/src/db/migrations/meta/_journal.json`), so idx 48 is still free.
   - Add the helper to Step 7 `git add`.
3. **0046-scoped tests (BLOCKING) [P5-T1-1].** In `migration-chain.integration.test.ts`, in both `it('0046 mengunci rangkaian yang diberkaskan…')` and `it('0046 menegakkan siklus hidup rangkaian_koreksi_berkas…')`, replace
   ```ts
           for (const entry of journal.entries) {
               await applyMigration(database, entry);
           }
   ```
   with
   ```ts
           // Semantik 0046 (termasuk jalur legacy rangkaian_id NULL dan lebih dari satu koreksi terbuka) diuji sebelum pengerasan 0048.
           const sebelum0048 = journal.entries.findIndex((entry) => entry.tag === '0048_rangkaian_pengerasan');
           for (const entry of sebelum0048 < 0 ? journal.entries : journal.entries.slice(0, sebelum0048)) {
               await applyMigration(database, entry);
           }
   ```
   Replace the Step 6 Expected line with: "PASS: test lama 0046 tetap lulus karena berhenti sebelum 0048; test 0048 baru lulus."
4. **Constraint test (BLOCKING) [P5-T1-2].** In `it('0048 mengeraskan rangkaian_id dan membatasi satu Koreksi Berkas terbuka', …)`, replace the last `await expect(database.exec(\`INSERT … 'denied')\`)).rejects.toThrow(/rangkaian_koreksi_berkas_(putusan|berubah)_check/);` with:
   ```ts
           // Trigger BEFORE INSERT (0046) menolak status non-pending lebih dulu; CHECK berjalan sebelum indeks unik.
           await expect(database.exec(`
               INSERT INTO rangkaian_koreksi_berkas (rangkaian_id, unit_pengolah_lama, unit_pengolah_baru,
                 klasifikasi_lama, klasifikasi_baru, alasan, diajukan_by)
               VALUES ('${rangkaianId}', 'dir_bppt', 'dir_bppt', ${klasA}, ${klasA}, 'Tidak mengubah apa pun', '${P5_IDS.superA}')`))
               .rejects.toThrow(/rangkaian_koreksi_berkas_berubah_check/);
           const putusan = await database.query<{ def: string }>(`
               SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'rangkaian_koreksi_berkas_putusan_check'`);
           expect(putusan.rows).toHaveLength(1);
           expect(putusan.rows[0].def).toMatch(/diputuskan_by IS NULL/);
   ```
5. **0048 message and header (REQUIRED / ADVISORY) [P5-T1-5, P5-T1-6] RECHECK-AFTER-P3.** Replace the header comment and the first `RAISE EXCEPTION` with:
   ```sql
   -- 0048 (P5): pengerasan rangkaian. Hanya dijalankan setelah backfill langkah 1 P3
   -- (`npm run db:backfill:rangkaian-disposisi`) melaporkan sisaTanpaRangkaian: 0 dan daftar
   -- `dilewati` (P3 C-6) kosong atau sudah diputuskan. Catatan: migrasi yang MENAMBAH kolom
   -- rangkaian_surat wajib CREATE OR REPLACE FUNCTION rangkaian_guard_status() (RB P1 butir 4).
   ```
   ```sql
       RAISE EXCEPTION '0048: surat_distributions.rangkaian_id masih NULL; jalankan npm run db:backfill:rangkaian-disposisi dan selesaikan daftar dilewati (rangkaian diberkaskan) dulu';
   ```
   Update the test regex `/0048: surat_distributions\.rangkaian_id masih NULL/` only if the prefix changes. It does not change.
6. **Step 6b (REQUIRED) [P5-T1-7] RECHECK-AFTER-P3.** After changing the harness, run `rg -n "surat_distributions" backend/integration` and read each insert:
   - Legacy scenarios that must keep a NULL `rangkaian_id` get `stopBefore: '0048_rangkaian_pengerasan'`. This covers the backfill test, including the P3 C-6 `dilewati` case, and any other test the grep shows inserting NULL on purpose.
   - Every other fixture that inserts NULL is fixed to fill `rangkaian_id`.
   - **(delta P3) Confirmed discovery result on real P3 @ b4d86fa.** The only NULL-inserting callers are the three backfill databases in `backfill-rangkaian-disposisi.postgres.test.ts`: `'backfill'` (:21, inserts :25-31), `'ditolak'` (:94, :98-99) and `'berkas'` (:140, :157, :165). They all use `h.insertDistribusi` without `rangkaianId`.
   - All other P3 Postgres inserts pass `rangkaianId`: `ajukan-akses` :52, `berkas` :71 and :169, and `status-turunan` :119, :122 and :137.
   - The harness signature is still `createRangkaianTestDatabase(label)` (`rangkaian-db.ts:28`), and `insertDistribusi` defaults to `rangkaianId ?? null` (:116-120). Critic C-4 applies exactly as written.
   - The only application writer is `distribution.service.ts:220-230` (Drizzle), and it always sets `rangkaianId: ensured.rangkaianId`. No raw `INSERT INTO surat_distributions` exists outside tests and scripts, so the `.notNull()` schema change breaks no production insert in tsc.
7. **Performance (ADVISORY) [P5-T1-8].** See Tasks 6 and 7.


**C-3 (critic) — Tasks 1, 13: `dilewati` rows cannot be remediated at runtime — REQUIRED [P5-C-3]**


- **No application role can fix these rows.** `surat_distributions_closed_guard` is `BEFORE INSERT OR UPDATE OR DELETE` (0046:406-408), and it resolves candidate rangkaian through the SM's anggota rows (0046:278-296). No role can therefore fill, change or delete the `rangkaian_id` of a distribution whose SM is an anggota of a `diberkaskan` rangkaian.
- **The release blocks indefinitely.** Real P3 step 1 skips such rows (`dilewati`, the C-6 branch in `backfill-rangkaian-disposisi.mjs`), so the 0048 precheck (P5 Task 1 Step 5) would block the release indefinitely.
- **The owner decision in P5-T1-5 is not executable.** P5-T1-5 asks for "an owner decision" but names no option that can be carried out.
- **Content:** by construction these rows are `processed`/`rejected`. P3 berkaskan refuses open disposisi, including NULL rows, through the C-6 `disposisiTerbukaSql` (P3:5980-5987), so filling `rangkaian_id` only records existing membership.
- **(delta P3) Confirmed on real code, and the P3 reviews corrected.**
  - `rangkaian_guard_closed()` (`0046_rangkaian_surat.sql:257-312`) has **no** GUC bypass. It collects candidate rangkaian through the SM's anggota rows (:276-290), and only `rangkaian_guard_status()` honours `simsa.berkas_koreksi` (:343). So the P3 final reviews' "stay NULL until Koreksi Berkas or a GUC path exists" (concurrency carry-forward 3) and "Koreksi Berkas is the only exit" (spec review) are both wrong: Koreksi Berkas changes `rangkaian_surat`, never `surat_distributions`. This amendment's options (i)/(ii) remain the only executable ones.
  - The real script skips two statuses, not one: `if (rs.status !== 'aktif' && rs.status !== 'selesai')` (`backfill-rangkaian-disposisi.mjs:72-73`), so a `dilewati` entry can also be `digabung`. That only happens when a concurrent gabung moved the anggota between the unlocked membership read (:59-61) and the lock. It is transient, and a plain re-run attaches the row to the gabung target.
  - The pre-0048 listing query above already shows the current membership status. Filter it with `AND r.status = 'diberkaskan'` for the decision on gate row (f), and re-run the step-1 script for the rest.
- Binding:
  - The runbook pre-0048 step lists the rows:
    ```sql
    SELECT d.id, d.surat_masuk_id, d.status, a.rangkaian_id, r.status AS status_rangkaian
      FROM surat_distributions d
      JOIN rangkaian_anggota a ON a.surat_masuk_id = d.surat_masuk_id
      JOIN rangkaian_surat r ON r.id = a.rangkaian_id
     WHERE d.rangkaian_id IS NULL;
    ```
  - The owner chooses, recorded as a new release-gate row (f):
    - **(i)** hold 0048: P5 ships without the hardening, and the Koreksi uniqueness index is absent until it lands;
    - **(ii)** a reviewed prelude at the top of 0048, executed by the migration owner (`simsa_migrator`) in the migration transaction:
      ```sql
      ALTER TABLE surat_distributions DISABLE TRIGGER surat_distributions_closed_guard;
      UPDATE surat_distributions d SET rangkaian_id = a.rangkaian_id, updated_at = now()
        FROM rangkaian_anggota a
       WHERE d.rangkaian_id IS NULL AND a.surat_masuk_id = d.surat_masuk_id;
      ALTER TABLE surat_distributions ENABLE TRIGGER surat_distributions_closed_guard;
      ```
      Add one `audit_log` insert per filled row. Put this before the NULL precheck.
  - Test for option (ii): a PGlite case seeds a NULL `processed` row on a `diberkaskan` member SM with `stopBefore: '0048_rangkaian_pengerasan'`, then applies 0048. The row is filled, the trigger is enabled afterwards (`pg_trigger.tgenabled = 'O'`), and one audit row exists.


**C-4 (critic) — Task 1 (Step 6b): the real P3 harness defaults `rangkaian_id` to NULL — REQUIRED, RECHECK-AFTER-P3 [P5-C-4]**


- **(delta P3)** Re-confirmed at b4d86fa with the same lines (`rangkaian-db.ts:28, 116-120`). The backfill suite's three databases are at `backfill-rangkaian-disposisi.postgres.test.ts:21, 94, 140`. No other P3 Postgres suite inserts NULL (see Task 1 item 6).
- **Default NULL.** `backend/integration/helpers/rangkaian-db.ts:116-119` (P3 @ 15b5852): `insertDistribusi` writes `input.rangkaianId ?? null`.
- **Three databases rely on it.** The real backfill suite calls the helper without `rangkaianId` in three separate databases: 'backfill' `:21-31`, 'ditolak' `:94-99` and 'berkas' `:140-165`.
- **No options parameter yet.** The real signature is `createRangkaianTestDatabase(label)`. P5-T1-4 describes a P3 `(label, options)` shape that does not exist yet; P5 Step 6b adds the parameter.
- **The discovery grep misses helper calls.** P5-T1-7's grep `rg -n "surat_distributions" backend/integration` does not match `h.insertDistribusi(` call sites, so a later P3 suite that only uses the helper is missed.
- Binding:
  - Discovery is `rg -n "insertDistribusi\(|surat_distributions|suratDistributions" backend/integration backend/src/__tests__`.
  - Every database that inserts NULL on purpose is created with `{ stopBefore: '0048_rangkaian_pengerasan' }`. That covers all three in the backfill suite.
  - The harness records `stopBefore`. `insertDistribusi` without `rangkaianId` throws `Error('rangkaianId wajib setelah 0048; buat database dengan stopBefore untuk skenario lama')` unless the database was created with `stopBefore`, so the failure is loud instead of a 23502 mid-test.
- Step 6 run list also adds the P1 suite `src/__tests__/rangkaian.service.integration.test.ts`. It applies the full journal (`:349`), and every `disposisi()` call passes a rangkaian id (`:446-734`), so it should pass unchanged.


**C-10 (critic) — Task 1: readiness does not detect 0048 — ADVISORY [P5-C-10]**


- scan-p5 N3 received no ruling.
- `readiness.service.ts` checks column presence (`:118-130`) and trigger names (`:223`), but not these:
  - `surat_distributions.rangkaian_id` NOT NULL;
  - `rangkaian_koreksi_berkas_terbuka_uidx`;
  - the two new CHECKs.
- Optional: add them, with a `readiness.service.test.ts` case, so that a held 0048 (C-3 (i)) shows in readiness and not only in the runbook.


**C-11 (critic) — Task 1: the migration number is a rebase-time fact — ADVISORY [P5-C-11]**


- Today `origin/main` ends at 0045 and the integration branches at 0047 (`git ls-tree`). P5 hard-codes idx 48 and `when` 1789397419667 (P5:21).
- After every rebase onto `origin/main`:
  - re-derive idx and `when` from the journal tail;
  - run `npm run test:migration-manifest`.
- `migrate-database.mjs:28-36` rejects a non-contiguous idx or a non-increasing `when`.



### Task 2: Flag `RANGKAIAN_DISPOSISI_LAMA_READ` pada fragmen jangkauan tunggal

**Files:**
- Modify (hanya bila verifikasi Step 4 menunjukkan penyimpangan): `backend/src/services/access/visibility-spec.ts` (`jangkauanUnitsSql` milik P1, `isDisposisiLamaReadEnabled` milik P2)
- Modify: `backend/.env.example`
- Test: `backend/src/__tests__/rangkaian-disposisi-lama-flag.test.ts`

**Interfaces:**
- Consumes (P1, `backend/src/services/access/visibility-spec.ts`): `jangkauanUnitsSql(rangkaianId: SQLWrapper | string, options?: { disposisiLama?: boolean }): SQL` — satu-satunya definisi himpunan jangkauan §4.5 (subquery ber-kurung, satu kolom `unit_kerja_id`).
- Consumes (P2, berkas yang sama): `isDisposisiLamaReadEnabled(env?: NodeJS.ProcessEnv): boolean` (hanya string persis `'true'`), `jangkauanSql(rangkaianId, unitKerjaId, disposisiLamaRead)` (dirakit dari `jangkauanUnitsSql`), `resolveKonteksBaca(user, executor, env?)` → `KonteksBaca.disposisiLamaRead`; `recordAccessService.checkRead(user, type, id, executor)` di `backend/src/services/record-access.service.ts`. (P1) tabel `rangkaian_peserta`.
- Produces: tidak ada fungsi baru. P5 **tidak** membuat `config/rangkaian-flags.ts` dan tidak membuat fungsi jangkauan kedua; task ini mengunci perilaku flag pada fungsi yang sudah ada (dan memperbaikinya di tempat bila menyimpang) serta menambah `.env.example`.

- [ ] **Step 1: Verifikasi antarmuka P1/P2**

Run: `rg -n "export function (jangkauanUnitsSql|jangkauanSql|isDisposisiLamaReadEnabled|visibleSql)|async checkRead" backend/src/services`
Expected: lima hit (`jangkauanUnitsSql`, `jangkauanSql`, `isDisposisiLamaReadEnabled`, `visibleSql` di `access/visibility-spec.ts`; `checkRead` di `record-access.service.ts`). Bila salah satu tidak ada, hentikan: P5 tidak boleh membuat ulang antarmuka P1/P2.

- [ ] **Step 2: Tulis test yang gagal**

```ts
// backend/src/__tests__/rangkaian-disposisi-lama-flag.test.ts
import fs from 'node:fs';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRangkaianTestDatabase, P5_IDS, seedRangkaianBase } from './helpers/rangkaian-p5-pglite.js';

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
    database = await createRangkaianTestDatabase();
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

    it('setiap kode non-test yang membaca rangkaian_peserta melewati flag', () => {
        const root = path.resolve(process.cwd(), 'src');
        const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) return entry.name === '__tests__' ? [] : walk(full);
            return entry.name.endsWith('.ts') ? [full] : [];
        });
        // Pengecualian tertutup: skema Drizzle (definisi tabel) dan rangkaian.service.ts P1
        // (gabung hanya MEMINDAHKAN baris peserta; bukan jalur baca, jangkauannya lewat jangkauanUnitsSql).
        const PENGECUALIAN = ['db/schema/rangkaian-surat.ts', 'services/rangkaian.service.ts'];
        // Bukti melewati flag: memanggil isDisposisiLamaReadEnabled, atau memakai KonteksBaca.disposisiLamaRead /
        // opsi JangkauanOptions.disposisiLama yang hanya diisi dari flag tersebut.
        const LEWAT_FLAG = /isDisposisiLamaReadEnabled|disposisiLamaRead|disposisiLama\b/;
        const offenders = walk(root)
            .map((file) => ({ file, rel: path.relative(root, file).replaceAll('\\', '/') }))
            .filter(({ rel }) => !PENGECUALIAN.includes(rel))
            .filter(({ file }) => /rangkaian_peserta|rangkaianPeserta/.test(fs.readFileSync(file, 'utf8')))
            .filter(({ file }) => !LEWAT_FLAG.test(fs.readFileSync(file, 'utf8')))
            .map(({ rel }) => rel);
        expect(offenders).toEqual([]);
    });
});
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `npm --prefix backend exec -- vitest run src/__tests__/rangkaian-disposisi-lama-flag.test.ts`
Expected: FAIL — `.env.example mendokumentasikan flag dalam keadaan mati` (baris flag belum ada). Test lain seharusnya sudah PASS karena gating dibangun P1/P2; bila ada yang gagal, perbaiki di Step 4.

- [ ] **Step 4: Implementasi minimal**

Tambahkan di `backend/.env.example` (di bagian konfigurasi fitur):

```
# Integrasi Surat P5: peserta disposisi data lama memberi jangkauan baca hanya
# bila bernilai persis "true". Nyalakan HANYA setelah sign-off CSV backfill.
RANGKAIAN_DISPOSISI_LAMA_READ=false
```

Lalu pastikan dua fungsi di `backend/src/services/access/visibility-spec.ts` berbentuk kanonik berikut (tidak ada fungsi jangkauan kedua, tidak ada berkas flag terpisah). Bila berbeda, **ubah fungsi yang sudah ada** — jangan menambah salinan:

> **Alias internal WAJIB tetap berprefiks `jk_`** (`jk_r`, `jk_a`, `jk_d`,
> `jk_p` di bawah). Task 3 fase P2 (review 2026-09-27) menemukan bahwa alias
> polos `r`/`a`/`d`/`p` bertabrakan dengan alias tabel yang wajar dipakai
> pemanggil (mis. P4 menulis `FROM rangkaian_surat r` lalu memanggil
> `jangkauanSql(sql.raw('r.id'), ...)`): kondisi `r.id = ${id}` diam-diam
> menjadi tautologi yang terikat ke alias LOKAL fungsi ini, bukan ke baris
> pemanggil, sehingga jangkauan satu rangkaian membocorkan SEMUA rangkaian
> lain yang unit pencatat/pengolah/anggota/distribusi/pesertanya kebetulan
> sama. **Mengembalikan alias ke `r`/`a`/`d`/`p` (atau nama pendek apa pun
> yang lazim dipakai pemanggil) akan mereproduksi kebocoran lintas rangkaian
> ini.** `aliasAman` (diekspor dari `visibility-spec.ts`) menolak alias
> pemanggil berprefiks `jk_` maupun nama bekas `ra`/`g`/`j`; setiap `SQLWrapper`
> mentah yang disisipkan ke `jangkauanUnitsSql`/`jangkauanSql` (parameter
> `rangkaianId`) harus dikualifikasi dengan alias tabel pemanggil yang BUKAN
> `jk_*` — lihat JSDoc di atas kedua fungsi itu.

```ts
// P2 — dibaca saat panggilan, tanpa cache modul.
export function isDisposisiLamaReadEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.RANGKAIAN_DISPOSISI_LAMA_READ === 'true';
}

// P1 — cabang rangkaian_peserta hanya ada bila options.disposisiLama (diisi dari flag di atas).
// Alias jk_r/jk_a/jk_d/jk_p DICADANGKAN (lihat catatan di atas) — jangan
// menggantinya dengan alias polos r/a/d/p.
export function jangkauanUnitsSql(rangkaianId: SQLWrapper | string, options: JangkauanOptions = {}): SQL {
    const id = typeof rangkaianId === 'string' ? sql`${rangkaianId}::uuid` : rangkaianId;
    const peserta = options.disposisiLama
        ? sql`UNION SELECT jk_p.unit_kerja_id FROM rangkaian_peserta jk_p
              WHERE jk_p.rangkaian_id = ${id} AND jk_p.berakhir_at IS NULL`
        : sql``;
    return sql`(
        SELECT jk_r.unit_pencatat_id AS unit_kerja_id FROM rangkaian_surat jk_r WHERE jk_r.id = ${id}
        UNION SELECT jk_r.unit_pengolah_id FROM rangkaian_surat jk_r
              WHERE jk_r.id = ${id} AND jk_r.unit_pengolah_id IS NOT NULL
        UNION SELECT jk_a.unit_kerja_id FROM rangkaian_anggota jk_a WHERE jk_a.rangkaian_id = ${id}
        UNION SELECT jk_d.target_unit_id FROM surat_distributions jk_d
              WHERE jk_d.rangkaian_id = ${id} AND jk_d.status <> 'rejected'
        ${peserta}
    )`;
}
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `npm --prefix backend exec -- vitest run src/__tests__/rangkaian-disposisi-lama-flag.test.ts`
Expected: PASS (12 test). Bila guard sumber mencantumkan berkas lain (misalnya layanan P3 yang menampilkan chip peserta), ubah berkas itu agar mengambil peserta lewat `jangkauanUnitsSql(id, { disposisiLama: isDisposisiLamaReadEnabled() })` atau `KonteksBaca.disposisiLamaRead` — jangan menambah pengecualian pada guard.
Run: `npm --prefix backend exec -- vitest run src/__tests__/record-access-policy.test.ts src/__tests__/record-access-grant.service.test.ts src/services/access/__tests__/visibility-spec.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/access/visibility-spec.ts backend/.env.example backend/src/__tests__/rangkaian-disposisi-lama-flag.test.ts
git commit -m "feat(rangkaian): lock RANGKAIAN_DISPOSISI_LAMA_READ gating on the single jangkauan fragment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


#### Amandemen pra-eksekusi Task 2 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p5-data-lama-pelengkap/preflight-rulings.md`.


1. **Source guard (BLOCKING) [P5-T2-1] RECHECK-AFTER-P3/P4.** In `it('setiap kode non-test yang membaca rangkaian_peserta melewati flag', …)`, replace the content filter `/rangkaian_peserta|rangkaianPeserta/` with `/\b(?:FROM|JOIN)\s+rangkaian_peserta\b|\brangkaianPeserta\b/i`, and rename the test to `'setiap kode non-test yang MEMBACA baris rangkaian_peserta (FROM/JOIN/simbol Drizzle) melewati flag'`. `PENGECUALIAN` stays closed.
   - Replace the Step 5 note with: "Guard hanya menangkap jalur baca data. `services/readiness.service.ts` (katalog/privilege) tidak cocok dengan pola baca. Bila berkas P3/P4 muncul sebagai pelanggar, alihkan bacaannya lewat `jangkauanUnitsSql(id, { disposisiLama: isDisposisiLamaReadEnabled() })` atau `KonteksBaca.disposisiLamaRead`; jangan menambah pengecualian."
   - The guard was verified against real P2: every file that FROM/JOINs `rangkaian_peserta` carries a flag token, and `readiness.service.ts` no longer matches.
   - **(delta P3) Re-verified on real P3 @ b4d86fa.** No P3 file under `services/rangkaian/*` mentions `rangkaian_peserta`. The only non-test readers are:
     - `visibility-spec.ts:125` and `rangkaian-read.service.ts:261`, both flag-gated;
     - the P1 gabung move `rangkaian.service.ts:637-641`, which is `FROM rangkaian_peserta t` inside an UPDATE. It is already in the plan's closed `PENGECUALIAN` list (P5:479).
     - `readiness.service.ts:129, 190, 343` do not match the narrowed pattern, nor critic C-9's broader one: the table name is single-quoted there.
2. **Pengolah leak case (REQUIRED) [P5-T2-2].** Add as the last test:
   ```ts
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
   ```
   If the `rangkaian_peserta` CHECK requires the three `berakhir_*` columns to be NULL together, reactivate the row with a fresh insert instead. Step 5 Expected: PASS (13 tests).


**C-9 (critic) — Task 2: guard pattern gaps — ADVISORY [P5-C-9]**


- The narrowed pattern misses three forms:
  - `FROM public.rangkaian_peserta`;
  - quoted `"rangkaian_peserta"`;
  - comma joins.
- Use `/\b(?:FROM|JOIN)\s+(?:"?public"?\.)?"?rangkaian_peserta\b|,\s*"?rangkaian_peserta\b|\brangkaianPeserta\b/i`.
- Add three string cases as a self-test of the pattern.



### Task 3: Skrip backfill langkah 2 — pemetaan label (D6) dan normalisasi

**Files:**
- Create: `backend/scripts/backfill-rangkaian-lama.mjs` (bagian konstanta, normalisasi, validasi pemetaan)
- Test: `backend/src/__tests__/backfill-rangkaian-lama.test.ts`

**Interfaces:**
- Consumes (P1): tabel `disposisi_label_unit(label_norm, unit_kerja_id, perlu_verifikasi, catatan)`, `unit_kerja.unit_type`.
- Produces: `LABEL_SEED`, `normalizeLabel(label)`, `resolveLabel(label)`, `seedCte()`, `BASE_CTE`, `assertPemetaanSah(client)`, `ACTOR`, `BATCH_SIZE`.

- [ ] **Step 1: Tulis test yang gagal**

```ts
// backend/src/__tests__/backfill-rangkaian-lama.test.ts
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    assertPemetaanSah,
    LABEL_SEED,
    normalizeLabel,
    resolveLabel,
} from '../../scripts/backfill-rangkaian-lama.mjs';
import { createRangkaianTestDatabase, seedRangkaianBase } from './helpers/rangkaian-p5-pglite.js';

// Frekuensi label pada snapshot DB lama (spec §3, instruksi P5).
const LEGACY_LABELS: Array<[string, string | null, string]> = [
    ['BPPT', 'dir_bppt', 'terpetakan'],
    ['Sesditjen', 'sesditjen', 'terpetakan'],
    ['Dit. BPPT', 'dir_bppt', 'terpetakan'],
    ['Kabag Program dan Hukum', null, 'label_saja'],
    ['KTPP', 'dir_ktpp', 'terpetakan'],
    ['Kabag Kepegawaian Keuangan dan Umum', null, 'label_saja'],
    ['SekDitjen', 'sesditjen', 'terpetakan'],
    ['DIRJEN', 'ditjen', 'terpetakan'],
    ['PTEP', 'dir_ptep', 'terpetakan'],
    ['Dit. PTEP', 'dir_ptep', 'terpetakan'],
    ['Ditjen', 'ditjen', 'terpetakan'],
    ['Dit. KTPP', 'dir_ktpp', 'terpetakan'],
    ['', null, 'kosong'],
];

let database: PGlite;
beforeAll(async () => {
    database = await createRangkaianTestDatabase();
    await seedRangkaianBase(database);
}, 180_000);
afterAll(async () => { await database?.close(); });

describe('pemetaan label disposisi lama', () => {
    it.each(LEGACY_LABELS)('%s → %s (%s)', (label, unit, status) => {
        expect(resolveLabel(label)).toMatchObject({ unit, status });
    });

    it('D6: label Kabag tetap label-saja dan tidak ada seed yang menunjuk unit bagian', () => {
        const kabag = LABEL_SEED.filter((entry: any) => entry.label.startsWith('kabag'));
        expect(kabag).toHaveLength(2);
        expect(kabag.every((entry: any) => entry.unit === null && /D6/.test(entry.catatan))).toBe(true);
        expect(LABEL_SEED.some((entry: any) => String(entry.unit).startsWith('bagian'))).toBe(false);
        expect(Object.isFrozen(LABEL_SEED)).toBe(true);
    });

    it('normalisasi JS identik dengan normalisasi SQL spec', async () => {
        for (const [label] of [...LEGACY_LABELS, ['  Dit.   BPPT  ', null, ''] as [string, null, string]]) {
            const { rows } = await database.query<{ norm: string }>(
                `SELECT lower(regexp_replace(trim($1::text), '\\s+', ' ', 'g')) AS norm`, [label]);
            expect(normalizeLabel(label)).toBe(rows[0].norm);
        }
    });

    it('pemetaan yang menunjuk unit bagian atau unit tak dikenal ditolak sebelum dry-run', async () => {
        await expect(assertPemetaanSah(database)).resolves.toBeUndefined();
        await database.exec(`
            INSERT INTO unit_kerja (id, name, unit_type, can_receive_distribution)
            VALUES ('bagian_umum', 'Bagian Umum', 'bagian', false) ON CONFLICT (id) DO NOTHING;
            INSERT INTO disposisi_label_unit (label_norm, unit_kerja_id) VALUES ('bagian umum', 'bagian_umum');`);
        await expect(assertPemetaanSah(database)).rejects.toThrow(/bagian umum.*bagian_umum.*D6/);
        await database.exec(`DELETE FROM disposisi_label_unit WHERE label_norm = 'bagian umum'`);
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm --prefix backend exec -- vitest run src/__tests__/backfill-rangkaian-lama.test.ts`
Expected: FAIL — `Failed to load url ../../scripts/backfill-rangkaian-lama.mjs`.

- [ ] **Step 3: Implementasi minimal (bagian awal skrip)**

```js
#!/usr/bin/env node
// backend/scripts/backfill-rangkaian-lama.mjs
// Backfill langkah 2 (spec §3): label bebas surat_masuk.disposisi → peserta
// rangkaian data lama. Default dry-run (tanpa tulis). --apply hanya menerapkan
// rencana yang SHA-256-nya sama dengan laporan yang sudah disign-off.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Client } from 'pg';

export const ACTOR = 'system:backfill-rangkaian-lama';
export const BATCH_SIZE = 500;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const D6 = 'D6: label jabatan/bagian hanya label, tidak dirutekan';

export const LABEL_SEED = Object.freeze([
  { label: 'bppt', unit: 'dir_bppt', catatan: null },
  { label: 'dit. bppt', unit: 'dir_bppt', catatan: null },
  { label: 'ptep', unit: 'dir_ptep', catatan: null },
  { label: 'dit. ptep', unit: 'dir_ptep', catatan: null },
  { label: 'ktpp', unit: 'dir_ktpp', catatan: null },
  { label: 'dit. ktpp', unit: 'dir_ktpp', catatan: null },
  { label: 'plp', unit: 'dir_plp', catatan: null },
  { label: 'dit. plp', unit: 'dir_plp', catatan: null },
  { label: 'sesditjen', unit: 'sesditjen', catatan: null },
  { label: 'sekditjen', unit: 'sesditjen', catatan: null },
  { label: 'dirjen', unit: 'ditjen', catatan: null },
  { label: 'ditjen', unit: 'ditjen', catatan: null },
  { label: 'kabag program dan hukum', unit: null, catatan: D6 },
  { label: 'kabag kepegawaian keuangan dan umum', unit: null, catatan: D6 },
].map(entry => Object.freeze(entry)));

/** Sama dengan SQL: lower(regexp_replace(trim(label), '\s+', ' ', 'g')). */
export function normalizeLabel(label) {
  return String(label ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function resolveLabel(label) {
  const labelNorm = normalizeLabel(label);
  if (!labelNorm) return { labelNorm, unit: null, status: 'kosong' };
  const seed = LABEL_SEED.find(entry => entry.label === labelNorm);
  if (!seed) return { labelNorm, unit: null, status: 'tidak_dikenal' };
  return { labelNorm, unit: seed.unit, status: seed.unit ? 'terpetakan' : 'label_saja' };
}

const SEED_PARAM_COUNT = LABEL_SEED.length * 3;
export const seedParams = () => LABEL_SEED.flatMap(entry => [entry.label, entry.unit, entry.catatan]);
const seedValues = LABEL_SEED
  .map((_, i) => `($${i * 3 + 1}::varchar, $${i * 3 + 2}::varchar, $${i * 3 + 3}::text)`)
  .join(', ');

// Seed kode menang atas baris tabel dengan label yang sama; baris tabel lain
// (misalnya ejaan tambahan hasil tinjauan) ikut dipakai dan ikut di-hash.
export const BASE_CTE = `
seed(label_norm, unit_kerja_id, catatan) AS (VALUES ${seedValues}),
peta AS (
  SELECT d.label_norm::varchar AS label_norm, d.unit_kerja_id::varchar AS unit_kerja_id, d.catatan
    FROM disposisi_label_unit d
   WHERE NOT EXISTS (SELECT 1 FROM seed s WHERE s.label_norm = d.label_norm)
  UNION ALL
  SELECT s.label_norm, s.unit_kerja_id, s.catatan FROM seed s
),
label AS (
  SELECT sm.id AS surat_masuk_id, sm.unit_kerja_id AS pemilik, l.label AS label_asal,
         lower(regexp_replace(trim(coalesce(l.label, '')), '\\s+', ' ', 'g')) AS label_norm
    FROM surat_masuk sm
   CROSS JOIN LATERAL unnest(sm.disposisi) AS l(label)
   WHERE sm.is_deleted IS NOT TRUE
),
rute AS (
  SELECT lb.surat_masuk_id, lb.pemilik, p.unit_kerja_id, min(lb.label_asal) AS label_asal
    FROM label lb
    JOIN peta p ON p.label_norm = lb.label_norm
   WHERE p.unit_kerja_id IS NOT NULL AND p.unit_kerja_id <> lb.pemilik
   GROUP BY lb.surat_masuk_id, lb.pemilik, p.unit_kerja_id
)`;

/** D6 fail-closed: pemetaan tidak boleh menunjuk unit tak dikenal atau unit bagian. */
export async function assertPemetaanSah(client) {
  const { rows } = await client.query(`WITH ${BASE_CTE}
    SELECT p.label_norm, p.unit_kerja_id
      FROM peta p LEFT JOIN unit_kerja uk ON uk.id = p.unit_kerja_id
     WHERE p.unit_kerja_id IS NOT NULL
       AND (uk.id IS NULL OR uk.id LIKE 'bagian\\_%' OR uk.unit_type = 'bagian')
     ORDER BY p.label_norm`, seedParams());
  if (rows.length > 0) {
    const detail = rows.map(row => `"${row.label_norm}" → ${row.unit_kerja_id}`).join(', ');
    throw new Error(`Pemetaan tidak sah (unit tidak ada atau unit bagian; D6): ${detail}`);
  }
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npm --prefix backend exec -- vitest run src/__tests__/backfill-rangkaian-lama.test.ts`
Expected: PASS (16 test).

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/backfill-rangkaian-lama.mjs backend/src/__tests__/backfill-rangkaian-lama.test.ts
git commit -m "feat(rangkaian): legacy disposition label mapping with D6 label-only Kabag

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


#### Amandemen pra-eksekusi Task 3 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p5-data-lama-pelengkap/preflight-rulings.md`.


1. **D6 regex (BLOCKING) [P5-T3-1].** Replace `.rejects.toThrow(/bagian umum.*bagian_umum.*D6/)` with `.rejects.toThrow(/D6\).*"bagian umum" → bagian_umum/)`.
2. **CTE split and legacy scope (BLOCKING, security) [P5-T3-2] RECHECK-AFTER-P3/P4.** Replace the `BASE_CTE` block with:
   ```js
   // Seed kode menang atas baris tabel dengan label yang sama; baris tabel lain ikut dipakai dan ikut di-hash.
   export const PETA_CTE = `
   seed(label_norm, unit_kerja_id, catatan) AS (VALUES ${seedValues}),
   peta AS (
     SELECT d.label_norm::varchar AS label_norm, d.unit_kerja_id::varchar AS unit_kerja_id, d.catatan
       FROM disposisi_label_unit d
      WHERE NOT EXISTS (SELECT 1 FROM seed s WHERE s.label_norm = d.label_norm)
     UNION ALL
     SELECT s.label_norm, s.unit_kerja_id, s.catatan FROM seed s
   )`;

   /** Parameter $${SEED_PARAM_COUNT + 1} = batas data lama (timestamptz). Hanya label bebas DATA LAMA (spec §3 langkah 2). */
   export const BASE_CTE = `${PETA_CTE},
   label AS (
     SELECT sm.id AS surat_masuk_id, sm.unit_kerja_id AS pemilik, l.label AS label_asal,
            lower(regexp_replace(trim(coalesce(l.label, '')), '\\s+', ' ', 'g')) AS label_norm
       FROM surat_masuk sm
      CROSS JOIN LATERAL unnest(sm.disposisi) AS l(label)
      WHERE sm.is_deleted IS NOT TRUE
        AND sm.created_at < $${SEED_PARAM_COUNT + 1}::timestamptz
   ),
   kandidat AS (
     SELECT lb.surat_masuk_id, lb.pemilik, p.unit_kerja_id, lb.label_asal,
            EXISTS (SELECT 1 FROM surat_distributions sd
                     WHERE sd.surat_masuk_id = lb.surat_masuk_id AND sd.target_unit_id = p.unit_kerja_id) AS sudah_didisposisikan
       FROM label lb
       JOIN peta p ON p.label_norm = lb.label_norm
      WHERE p.unit_kerja_id IS NOT NULL AND p.unit_kerja_id <> lb.pemilik
   ),
   rute AS (
     SELECT surat_masuk_id, pemilik, unit_kerja_id, min(label_asal) AS label_asal
       FROM kandidat
      WHERE NOT sudah_didisposisikan
      GROUP BY surat_masuk_id, pemilik, unit_kerja_id
   )`;
   ```
   - `assertPemetaanSah(client)` uses `WITH ${PETA_CTE}` and `seedParams()` only, so its signature and the Task 3 test calls are unchanged.
   - Every query that embeds `BASE_CTE` (`PEMETAAN_SQL`, the totals query, `BATCH_SQL`, and the balasan plan query if it uses `label`/`rute`) is called with `[...seedParams(), batas, …]`.
   - In `BATCH_SQL`, the cursor placeholder becomes `$${SEED_PARAM_COUNT + 2}::uuid`.
   - **(delta P3) Confirmed.** P3 `distribute` appends the target unit **name** as a compatibility label: `SET disposisi = array_append(coalesce(disposisi, '{}'), ${target.name})` guarded by `NOT (… @> ARRAY[name])` (`distribution.service.ts:266-269`). The line may shift under fix-wave C-I1. Each such label co-exists with a real distribution row, so `sudah_didisposisikan` excludes it whatever the status (including `rejected`), and the cutoff excludes P3-era letters. Both halves of this amendment are needed: a pre-cutoff SM disposed during the P3 era is caught only by the `sudah_didisposisikan` clause.
3. **Cutoff resolver (REQUIRED) [P5-G-5] RECHECK-AFTER-P4.** Add this to `backfill-rangkaian-lama.mjs` and export it:
   ```js
   const ISO_BERZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;

   /** Satu definisi dengan P4 D7 (resolveBatasDataLama); tanpa env dan tanpa rangkaian non-data-lama → berhenti (fail closed). */
   export async function resolveBatasDataLama(client, env = process.env) {
     const mentah = env.RANGKAIAN_DATA_LAMA_SEBELUM?.trim();
     if (mentah) {
       if (!ISO_BERZONA.test(mentah) || Number.isNaN(Date.parse(mentah))) {
         throw new Error('RANGKAIAN_DATA_LAMA_SEBELUM harus ISO-8601 dengan zona waktu, mis. 2026-10-05T00:00:00+07:00');
       }
       return new Date(mentah).toISOString();
     }
     const { rows: [row] } = await client.query(`SELECT min(created_at) AS batas FROM rangkaian_surat WHERE asal <> 'data_lama'`);
     if (!row?.batas) throw new Error('Batas data lama tidak dapat ditentukan: isi RANGKAIAN_DATA_LAMA_SEBELUM dengan waktu kode P3 aktif');
     return new Date(row.batas).toISOString();
   }
   ```
   Add two unit tests: an invalid env value throws, and no env plus no rangkaian throws.
4. **Whitespace parity (ADVISORY) [P5-T3-3].** Optionally replace `trim(coalesce(l.label, ''))` in `label` with `regexp_replace(coalesce(l.label, ''), <PG_TRIM_PATTERN>, '', 'g')`, using the pattern string exported by `visibility-spec.ts`. If you do, add a `' BPPT '` case to the JS/SQL parity test.


**C-6 (critic) — Tasks 3, 4: the DB fallback of the cutoff diverges from P4's value exactly in the deploy window — REQUIRED [P5-C-6]**


- Real P3 step 1 inserts rangkaian without `created_at` (`backfill-rangkaian-disposisi.mjs:95-97`), so the value is `now()` of the **first** run. The P3 runbook schedules that run before the P3 deploy (§2).
- The `min(created_at)` fallback is therefore earlier than the P3 go-live that the P4 runbook writes into `RANGKAIAN_DATA_LAMA_SEBELUM`.
- Legacy letters created in between (the P2 writer is still live, P3 runbook §2) fall **outside** the P5 label scope under the fallback, but **inside** it under P4's value.
- Binding: C-1 (`--apply` requires the shell env). The DB fallback stays for dry-run only, printed as `sumberBatas: 'db'`. Keep the two resolver unit tests of Task 3 item 3, and add "`--apply` without the shell env throws" (C-1).



### Task 4: Skrip backfill — dry-run, CSV, dan SHA-256 rencana (tanpa tulis)

**Files:**
- Modify: `backend/scripts/backfill-rangkaian-lama.mjs` (tambah `buildPlan`, `csvCell`, `toCsv`, `writePlanFiles`)
- Test: `backend/src/__tests__/backfill-rangkaian-lama.test.ts` (tambah fixture dan `describe('dry-run')`)

**Interfaces:**
- Consumes (P1): `rangkaian_anggota`, `rangkaian_surat`, `rangkaian_peserta`, `surat_keluar.balasan_untuk/approval_status`, `surat_masuk.disposisi text[]`.
- Produces: `buildPlan(client): Promise<{ pemetaan: Row[]; balasan: Row[]; total: Totals; sha256: string }>`, `csvCell(value)`, `toCsv(rows, columns)`, `writePlanFiles(outDir, plan)`.

- [ ] **Step 1: Tulis fixture dan test yang gagal**

Tambahkan di `backfill-rangkaian-lama.test.ts` — perluas impor dari skrip dengan `buildPlan, writePlanFiles` dan tambahkan fixture berikut ke `beforeAll` setelah `seedRangkaianBase(database)`:

```ts
const S = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
const K = (n: number) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`;
const R8 = '00000000-0000-4000-8000-000000000308';

async function seedLegacy(db: PGlite) {
    await db.exec(`
        INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal, sifat_surat, disposisi, status, is_deleted) VALUES
          ('${S(1)}', 'ditjen', 101, 2023, 'B-1/2023', 'Pengadaan tanah jalan tol', 'Biasa', ARRAY['BPPT','Dit. BPPT','Kabag Program dan Hukum'], 'sudah_dibalas', false),
          ('${S(2)}', 'ditjen', 102, 2023, 'ND-2/2023', NULL, 'Biasa', ARRAY['PTEP','KTPP'], 'belum_dibalas', false),
          ('${S(3)}', 'ditjen', 103, 2023, NULL, '   ', 'Biasa', ARRAY['  DIRJEN ','SekDitjen'], 'belum_dibalas', false),
          ('${S(4)}', 'ditjen', 104, 2023, 'B-4/2023', 'Label kosong', 'Biasa', ARRAY[''], 'belum_dibalas', false),
          ('${S(5)}', 'ditjen', 105, 2023, 'B-5/2023', 'Hanya Kabag', 'Biasa', ARRAY['Kabag Kepegawaian Keuangan dan Umum'], 'belum_dibalas', false),
          ('${S(6)}', 'ditjen', 106, 2023, 'B-6/2023', 'Label asing', 'Biasa', ARRAY['Bagian Entah'], 'belum_dibalas', false),
          ('${S(7)}', 'sesditjen', 107, 2023, 'B-7/2023', 'Milik sendiri', 'Biasa', ARRAY['Sesditjen'], 'belum_dibalas', false),
          ('${S(8)}', 'ditjen', 108, 2023, 'B-8/2023', 'Sudah dirangkai langkah 1', 'Biasa', ARRAY['BPPT'], 'belum_dibalas', false),
          ('${S(9)}', 'ditjen', 109, 2023, 'B-9/2023', 'Terhapus', 'Biasa', ARRAY['BPPT'], 'belum_dibalas', true),
          ('${S(10)}', 'ditjen', 110, 2023, 'B-10/2023', 'Label formula', 'Biasa', ARRAY['=HYPERLINK("x")'], 'belum_dibalas', false);
        INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, judul, tahun)
        VALUES ('${R8}', 'RS-2023-800008', 'surat_masuk', 'aktif', 'ditjen', 'Sudah dirangkai langkah 1', 2023);
        INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran)
        VALUES ('${R8}', '${S(8)}', 'ditjen', 'induk');
        INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status, rangkaian_id)
        VALUES ('${S(8)}', 'ditjen', 'dir_bppt', 'sent', '${R8}');
        INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, nomor_surat, balasan_untuk, approval_status) VALUES
          ('${K(1)}', 'ditjen', 201, 2023, 'KEL-1/2023', '${S(1)}', 'approved'),
          ('${K(2)}', 'dir_ptep', 202, 2023, 'KEL-2/2023', '${S(1)}', 'approved'),
          ('${K(3)}', 'ditjen', 203, 2023, 'KEL-3/2023', '${S(2)}', 'draft'),
          ('${K(4)}', 'ditjen', 204, 2023, 'KEL-4/2023', '${S(7)}', 'approved');
    `);
}

const TABLES = ['rangkaian_surat', 'rangkaian_anggota', 'rangkaian_relasi', 'rangkaian_peserta', 'disposisi_label_unit', 'audit_log', 'surat_masuk'];
async function counts(db: PGlite) {
    const out: Record<string, number> = {};
    for (const table of TABLES) out[table] = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
    return out;
}
```

Panggil `await seedLegacy(database);` di akhir `beforeAll`. Lalu tambahkan:

```ts
describe('dry-run', () => {
    it('tidak menulis apa pun dan menghasilkan rencana deterministik', async () => {
        const before = await counts(database);
        const first = await buildPlan(database);
        const second = await buildPlan(database);
        expect(await counts(database)).toEqual(before);
        expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(second.sha256).toBe(first.sha256);
        expect(first.total).toEqual({
            surat_target: 4, rangkaian_baru: 3, peserta_baru: 5,
            balasan_akan_ditautkan: 1, balasan_lintas_unit: 2,
        });
    });

    it('melaporkan label → unit → jumlah termasuk label kosong, label-saja, dan tak dikenal', async () => {
        const { pemetaan } = await buildPlan(database);
        const row = (norm: string) => pemetaan.find((item: any) => item.label_norm === norm);
        expect(row('bppt')).toMatchObject({ unit_kerja_id: 'dir_bppt', status: 'terpetakan', jumlah_surat: 2, jumlah_surat_dirutekan: 2 });
        expect(row('dirjen')).toMatchObject({ unit_kerja_id: 'ditjen', status: 'terpetakan', jumlah_surat_dirutekan: 0 });
        expect(row('kabag program dan hukum')).toMatchObject({ unit_kerja_id: null, status: 'label_saja', jumlah_surat_dirutekan: 0 });
        expect(row('')).toMatchObject({ status: 'kosong', jumlah_surat: 1 });
        expect(row('bagian entah')).toMatchObject({ status: 'tidak_dikenal' });
        expect(pemetaan.some((item: any) => item.label_norm === 'bppt' && item.jumlah_label === 3)).toBe(false);
    });

    it('menandai balasan lintas unit untuk ditinjau TU dan draf lama dilewati', async () => {
        const { balasan } = await buildPlan(database);
        const byKeluar = Object.fromEntries(balasan.map((item: any) => [item.surat_keluar_id, item.tindakan]));
        expect(byKeluar).toEqual({
            [K(1)]: 'akan_ditautkan',
            [K(2)]: 'lintas_unit_ditinjau_tu',
            [K(3)]: 'dilewati_belum_disetujui',
            [K(4)]: 'lintas_unit_ditinjau_tu',
        });
    });

    it('menulis CSV yang aman dari formula spreadsheet', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'rangkaian-lama-'));
        const plan = await buildPlan(database);
        writePlanFiles(dir, plan);
        const csv = readFileSync(join(dir, 'pemetaan-label.csv'), 'utf8');
        expect(csv.split('\n')[0]).toBe('label_norm,contoh_label,unit_kerja_id,status,jumlah_label,jumlah_surat,jumlah_surat_dirutekan');
        expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
        expect(JSON.parse(readFileSync(join(dir, 'ringkasan.json'), 'utf8'))).toMatchObject({ sha256: plan.sha256 });
        expect(readFileSync(join(dir, 'balasan-ditinjau.csv'), 'utf8')).toContain('lintas_unit_ditinjau_tu');
    });
});
```

Catatan fixture: `peserta_baru` = SM1→dir_bppt, SM2→dir_ptep, SM2→dir_ktpp, SM3→sesditjen, SM8(R8)→dir_bppt = 5; `rangkaian_baru` = SM1, SM2, SM3 (SM8 sudah punya R8).

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm --prefix backend exec -- vitest run src/__tests__/backfill-rangkaian-lama.test.ts -t "dry-run"`
Expected: FAIL — `buildPlan is not a function`.

- [ ] **Step 3: Implementasi minimal**

Tambahkan ke `backfill-rangkaian-lama.mjs`:

```js
const PEMETAAN_SQL = `WITH ${BASE_CTE}
SELECT lb.label_norm,
       min(lb.label_asal) AS contoh_label,
       p.unit_kerja_id,
       CASE WHEN lb.label_norm = '' THEN 'kosong'
            WHEN p.label_norm IS NULL THEN 'tidak_dikenal'
            WHEN p.unit_kerja_id IS NULL THEN 'label_saja'
            ELSE 'terpetakan' END AS status,
       count(*)::int AS jumlah_label,
       count(DISTINCT lb.surat_masuk_id)::int AS jumlah_surat,
       (count(DISTINCT lb.surat_masuk_id)
          FILTER (WHERE p.unit_kerja_id IS NOT NULL AND p.unit_kerja_id <> lb.pemilik))::int AS jumlah_surat_dirutekan
  FROM label lb
  LEFT JOIN peta p ON p.label_norm = lb.label_norm
 GROUP BY lb.label_norm, p.label_norm, p.unit_kerja_id
 ORDER BY lb.label_norm`;

const TOTAL_SQL = `WITH ${BASE_CTE},
target AS (
  SELECT t.surat_masuk_id, ra.rangkaian_id
    FROM (SELECT DISTINCT surat_masuk_id FROM rute) t
    LEFT JOIN rangkaian_anggota ra ON ra.surat_masuk_id = t.surat_masuk_id
)
SELECT
  (SELECT count(*) FROM target)::int AS surat_target,
  (SELECT count(*) FROM target WHERE rangkaian_id IS NULL)::int AS rangkaian_baru,
  (SELECT count(*) FROM rute r JOIN target t ON t.surat_masuk_id = r.surat_masuk_id
    WHERE t.rangkaian_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM rangkaian_peserta rp
                       WHERE rp.rangkaian_id = t.rangkaian_id
                         AND rp.unit_kerja_id = r.unit_kerja_id
                         AND rp.peran = 'disposisi_lama'))::int AS peserta_baru`;

const BALASAN_SQL = `WITH ${BASE_CTE},
target AS (SELECT DISTINCT surat_masuk_id FROM rute)
SELECT sm.id AS surat_masuk_id, sm.nomor_surat AS nomor_masuk, sm.unit_kerja_id AS unit_masuk,
       sk.id AS surat_keluar_id, sk.nomor_surat AS nomor_keluar, sk.unit_kerja_id AS unit_keluar,
       sk.approval_status,
       CASE WHEN sk.unit_kerja_id <> sm.unit_kerja_id THEN 'lintas_unit_ditinjau_tu'
            WHEN ska.id IS NOT NULL THEN 'sudah_anggota'
            WHEN sk.approval_status <> 'approved' THEN 'dilewati_belum_disetujui'
            WHEN rs.status = 'diberkaskan' THEN 'dilewati_diberkaskan'
            ELSE 'akan_ditautkan' END AS tindakan
  FROM surat_keluar sk
  JOIN surat_masuk sm ON sm.id = sk.balasan_untuk AND sm.is_deleted IS NOT TRUE
  LEFT JOIN target t ON t.surat_masuk_id = sm.id
  LEFT JOIN rangkaian_anggota sma ON sma.surat_masuk_id = sm.id
  LEFT JOIN rangkaian_surat rs ON rs.id = sma.rangkaian_id
  LEFT JOIN rangkaian_anggota ska ON ska.surat_keluar_id = sk.id
 WHERE sk.is_deleted IS NOT TRUE
   AND (t.surat_masuk_id IS NOT NULL OR sk.unit_kerja_id <> sm.unit_kerja_id)
 ORDER BY sm.id, sk.id`;

/** Rencana lengkap tanpa efek samping; SHA-256 menutup pemetaan, balasan, dan total. */
export async function buildPlan(client) {
  await assertPemetaanSah(client);
  const params = seedParams();
  const pemetaan = (await client.query(PEMETAAN_SQL, params)).rows;
  const balasan = (await client.query(BALASAN_SQL, params)).rows;
  const counted = (await client.query(TOTAL_SQL, params)).rows[0];
  const total = {
    surat_target: counted.surat_target,
    rangkaian_baru: counted.rangkaian_baru,
    peserta_baru: counted.peserta_baru,
    balasan_akan_ditautkan: balasan.filter(row => row.tindakan === 'akan_ditautkan').length,
    balasan_lintas_unit: balasan.filter(row => row.tindakan === 'lintas_unit_ditinjau_tu').length,
  };
  const sha256 = createHash('sha256').update(JSON.stringify({ pemetaan, balasan, total })).digest('hex');
  return { pemetaan, balasan, total, sha256 };
}

export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows, columns) {
  return `${[columns.join(','), ...rows.map(row => columns.map(column => csvCell(row[column])).join(','))].join('\n')}\n`;
}

const PEMETAAN_COLUMNS = ['label_norm', 'contoh_label', 'unit_kerja_id', 'status', 'jumlah_label', 'jumlah_surat', 'jumlah_surat_dirutekan'];
const BALASAN_COLUMNS = ['surat_masuk_id', 'nomor_masuk', 'unit_masuk', 'surat_keluar_id', 'nomor_keluar', 'unit_keluar', 'approval_status', 'tindakan'];

export function writePlanFiles(outDir, plan) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'pemetaan-label.csv'), toCsv(plan.pemetaan, PEMETAAN_COLUMNS));
  writeFileSync(join(outDir, 'balasan-ditinjau.csv'), toCsv(plan.balasan, BALASAN_COLUMNS));
  writeFileSync(join(outDir, 'ringkasan.json'), `${JSON.stringify({ sha256: plan.sha256, total: plan.total }, null, 2)}\n`);
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npm --prefix backend exec -- vitest run src/__tests__/backfill-rangkaian-lama.test.ts`
Expected: PASS (20 test).

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/backfill-rangkaian-lama.mjs backend/src/__tests__/backfill-rangkaian-lama.test.ts
git commit -m "feat(rangkaian): dry-run plan, CSV report and plan hash for legacy backfill

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


#### Amandemen pra-eksekusi Task 4 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p5-data-lama-pelengkap/preflight-rulings.md`.


1. **Plan signature and totals (REQUIRED) [P5-T4-1].**
   - The signature becomes `buildPlan(client, { batas })`. The result adds `batasDataLama` and `calonPengolah: Row[]` (see Task 5 item 1).
   - `total` adds `sudah_didisposisikan` and `peserta_dilewati_diberkaskan` (see Task 5 item 3). `sudah_didisposisikan` is `SELECT count(DISTINCT (surat_masuk_id, unit_kerja_id))::int FROM kandidat WHERE sudah_didisposisikan`, which counts distinct (surat, unit) pairs, not label occurrences.
   - The SHA-256 payload includes `batasDataLama`, `pemetaan`, `balasan`, `calonPengolah` and `total`.
   - `writePlanFiles` also writes `calon-pengolah.csv` with the header `surat_masuk_id,nomor_surat,calon_unit_pengolah`, and puts `batasDataLama` into `ringkasan.json`.
2. **Test updates (REQUIRED) [P5-T4-1].**
   - Add `const BATAS_UJI = '2100-01-01T00:00:00.000Z';` near the fixture constants. Every `buildPlan(database)` becomes `buildPlan(database, { batas: BATAS_UJI })`, and every `applyPlan(database, { approvedSha256 })` becomes `applyPlan(database, { approvedSha256, batas: BATAS_UJI })`.
   - The first dry-run test expects:
     ```ts
             expect(first.total).toEqual({
                 surat_target: 3, rangkaian_baru: 3, peserta_baru: 4,
                 balasan_akan_ditautkan: 1, balasan_lintas_unit: 2,
                 sudah_didisposisikan: 1, peserta_dilewati_diberkaskan: 0,
             });
             expect(first.batasDataLama).toBe(BATAS_UJI);
     ```
   - `PEMETAAN_SQL` stays a label → unit report, so the pemetaan test (`bppt` `jumlah_surat: 2, jumlah_surat_dirutekan: 2`) is unchanged. The effect of the new exclusion appears only in `total.sudah_didisposisikan`, in `rute`, and in the apply results.
   - `TOTAL_SQL` computes `peserta_dilewati_diberkaskan` as the rute rows whose target rangkaian has `status = 'diberkaskan'` and no `disposisi_lama` peserta for that unit. `peserta_baru` excludes those rows.
   - Fixture note (replaces the plan's note): `peserta_baru` = SM1→dir_bppt, SM2→dir_ptep, SM2→dir_ktpp, SM3→sesditjen = 4. SM8→dir_bppt is `sudah_didisposisikan` because SM8 already has an explicit distribution to dir_bppt. `rangkaian_baru` = SM1, SM2, SM3.
   - Add:
     ```ts
         it('hanya surat sebelum batas data lama yang dirutekan; batas ikut menentukan SHA', async () => {
             const awal = await buildPlan(database, { batas: '2000-01-01T00:00:00.000Z' });
             expect(awal.total).toMatchObject({ surat_target: 0, rangkaian_baru: 0, peserta_baru: 0 });
             expect(awal.sha256).not.toBe((await buildPlan(database, { batas: BATAS_UJI })).sha256);
         });
     ```
3. **Report location (REQUIRED) [P5-T4-3].**
   - In `parseArgs`, the default `outDir` becomes `null`. `main()` resolves `options.outDir ?? mkdtempSync(join(os.tmpdir(), 'laporan-rangkaian-lama-'))` and prints `Laporan: <dir>`.
   - Append `backend/laporan-rangkaian-lama/` to the root `.gitignore`.
   - The `parseArgs` test stays as written.
   - Runbook examples use `--out=<direktori di luar repo>`.
4. **Resume note (ADVISORY) [P5-T4-2].** The runbook states that an apply which stops midway needs a new dry-run and a new sign-off. Already-applied surat then show as `sudah_anggota`, which changes the SHA.
5. **(delta P3) Unknown sifat classes in the dry-run (ADVISORY; P3 spec-review carry-forward "Handle unknown `sifat_surat` classes", Minor 1).**
   - A routed legacy SM whose normalized class (`normalizeSecurityClassification`, P2 `visibility-spec.ts:40-59`) is neither Biasa nor a known controlled class stays **masked** for peserta after the flag, and cannot be requested through Ajukan Akses (`requiresExplicitAccessGrant` is false; `rangkaian-read.service.ts:440`).
   - Add `sifat_tak_dikenal` to `total`: the count of distinct routed SMs whose normalized `sifat_surat` is not in the known set. Add a column `sifat_tidak_dikenal` (boolean) to `pemetaan-label.csv`.
   - It is part of the SHA payload, so that the signer sees how many routed letters will stay masked.
   - Release-gate row (h) records the decision.


**C-2 (critic) — Tasks 4, 5, 7, 13: the deferred pengolah has no executable path — REQUIRED (spec:358; contradicts the "Cost if wrong" of P5-T5-1 and runbook step 8 of P5-T13-1) [P5-C-2]**


- **Ubah Unit Pengolah cannot apply it.** P3 `berkasService.ubahUnitPengolah` accepts only a unit in `unitDalamJangkauanBerkas` (P3:6591-6597). That set is the non-rejected distribution targets plus the anggota units (P3:6485-6492; spec §9).
  - `disposisi_lama` peserta are not in it.
  - A backfilled `data_lama` rangkaian has no distribution to its label units.
- **Koreksi Berkas cannot apply it either.** After P5-T6-1 it uses the same predicate and answers 422.
- So "through P3 Ubah Unit Pengolah or a Koreksi" (P5-T5-1) and runbook step 8 (P5-T13-1) cannot apply `calonUnitPengolah`.
- **(delta P3) Confirmed on real code.** `ubahUnitPengolah` refuses any unit outside `unitDalamJangkauanBerkas` with 422 "Disposisikan dulu ke unit ini" (`berkas.service.ts:217-224`). That set is the non-rejected distribution targets plus the live anggota units (:69-83), with no peserta branch. Ubah is also limited to `aktif`/`selesai` (:221).
- **Tutup massal then locks the choice in.** It files every `data_lama` rangkaian with `coalesce(rs.unit_pengolah_id, rs.unit_pencatat_id)` (P5:1844, 1878), and `diberkaskan` is terminal (`0046_rangkaian_surat.sql:331-346`). Spec:358 is thereby abandoned permanently and silently.
- Binding:
  1. **Two outcomes for release-gate row (a)** (P5-G-6):
     - "isi": apply the label-derived pengolah per spec:358, after the security owner signs `calon-pengolah.csv`;
     - "tidak": spec:358 is waived, and the berkas go to the pencatat.
  2. **A pengolah mode in the backfill script**, SHA-bound: either as an `--isi-pengolah` option of `--apply` (the chosen mode is part of the SHA payload), or as a separate later run `--isi-pengolah --approved-sha256=<sha>`. For each `calonPengolah` row (already in the Task 4 payload) whose rangkaian still has `asal='data_lama' AND status='selesai' AND unit_pengolah_id IS NULL`:
     - lock by id (`ORDER BY id FOR UPDATE`) and set `unit_pengolah_id`;
     - write one audit row: `action: 'update'`, `changes: { before: { unitPengolahId: null }, after: { unitPengolahId }, sumber: 'backfill-rangkaian-lama', aksesBaru: [unit] }`;
     - refuse on an SHA mismatch.

     Tests: S1 gets `dir_bppt`; a second run changes nothing; a `diberkaskan` row or one with a non-NULL pengolah is skipped.
  3. **Runbook order:** `--apply` → decision on gate (a) → pengolah mode if the decision is "isi" → only then Tutup massal of data lama.
     - The Task 10 UI copy and PANDUAN (P5:3165) state that Tutup massal files a berkas with no pengolah to the pencatat.
  4. **Access is not flag-controlled.** The runbook states that pengolah access is not controlled by the flag: after the pengolah mode runs, unsetting `RANGKAIAN_DISPOSISI_LAMA_READ` no longer revokes it (`visibility-spec.ts:130-131`).


**C-6 (critic) — Tasks 3, 4: the DB fallback of the cutoff diverges from P4's value exactly in the deploy window — REQUIRED [P5-C-6]**


- Real P3 step 1 inserts rangkaian without `created_at` (`backfill-rangkaian-disposisi.mjs:95-97`), so the value is `now()` of the **first** run. The P3 runbook schedules that run before the P3 deploy (§2).
- The `min(created_at)` fallback is therefore earlier than the P3 go-live that the P4 runbook writes into `RANGKAIAN_DATA_LAMA_SEBELUM`.
- Legacy letters created in between (the P2 writer is still live, P3 runbook §2) fall **outside** the P5 label scope under the fallback, but **inside** it under P4's value.
- Binding: C-1 (`--apply` requires the shell env). The DB fallback stays for dry-run only, printed as `sumberBatas: 'db'`. Keep the two resolver unit tests of Task 3 item 3, and add "`--apply` without the shell env throws" (C-1).


**C-12 (critic) — Tasks 4, 5: fixture totals verified by hand; test ordering — ADVISORY [P5-C-12]**


- **Totals.** The amended totals (P5-T4-1 and P5-T5-4) were not executed in scratch. Recomputed by hand from the fixture (P5:793-817):
  - routes: SM1→dir_bppt, SM2→dir_ptep, SM2→dir_ktpp and SM3→sesditjen;
  - SM8→dir_bppt is `sudah_didisposisikan` (distribution at P5:810-811);
  - balasan: K1 is `akan_ditautkan`, K2 and K4 are `lintas_unit_ditinjau_tu`, K3 is `dilewati_belum_disetujui`.

  That gives `{ surat_target: 3, rangkaian_baru: 3, peserta_baru: 4, balasan_akan_ditautkan: 1, balasan_lintas_unit: 2, sudah_didisposisikan: 1, peserta_dilewati_diberkaskan: 0 }`, which matches the amendment. The `bppt` pemetaan row (`jumlah_surat: 2`, `jumlah_surat_dirutekan: 2`) is unchanged.
- **Test ordering.** The Task 5 item 4 test ("tidak menambah peserta ke rangkaian yang sudah diberkaskan") needs rs1 from an earlier apply test. It also mutates the shared `beforeAll` database: it changes SM1's labels and sets rs1 to `diberkaskan`. Keep it the last test in the file, or call `applyPlan` inside it first when rs1 is absent.



### Task 5: Skrip backfill — `--apply` bergerbang, idempoten, diaudit

**Files:**
- Modify: `backend/scripts/backfill-rangkaian-lama.mjs` (tambah `applyPlan`, `parseArgs`, `main`)
- Modify: `backend/package.json` (skrip npm)
- Test: `backend/src/__tests__/backfill-rangkaian-lama.test.ts` (tambah `describe('apply')`)

**Interfaces:**
- Consumes (P1): sequence `rangkaian_surat_kode_seq`, trigger `rangkaian_guard_closed()` (menolak anggota/relasi pada rangkaian `diberkaskan`), CHECK `rangkaian_selesai_manual_check`; (P3) kriteria keluar backfill langkah 1.
- Produces: `applyPlan(client, { approvedSha256 }): Promise<Summary>`, `parseArgs(argv)`, npm `rangkaian:backfill-lama:plan`, `rangkaian:backfill-lama:apply`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan impor `applyPlan, parseArgs` lalu:

```ts
describe('apply', () => {
    it('menolak tanpa SHA, dengan SHA berbeda, atau bila langkah 1 belum tuntas', async () => {
        await expect(applyPlan(database, { approvedSha256: null })).rejects.toThrow(/--approved-sha256/);
        await expect(applyPlan(database, { approvedSha256: 'f'.repeat(64) })).rejects.toThrow(/Rencana berubah sejak sign-off/);
        const stepOneIncomplete = { query: async () => ({ rows: [{ n: 3 }] }) };
        await expect(applyPlan(stepOneIncomplete, { approvedSha256: 'a'.repeat(64) }))
            .rejects.toThrow(/Backfill langkah 1 belum tuntas: 3 baris/);
    });

    it('menerapkan rencana yang disetujui tanpa menulis ulang status surat masuk', async () => {
        const statusBefore = (await database.query('SELECT id, status FROM surat_masuk ORDER BY id')).rows;
        const plan = await buildPlan(database);
        const summary = await applyPlan(database, { approvedSha256: plan.sha256 });
        expect(summary).toEqual({ suratDiproses: 4, rangkaianBaru: 3, pesertaBaru: 5, balasanDitautkan: 1, balasanDilewatiDiberkaskan: 0 });
        expect((await database.query('SELECT id, status FROM surat_masuk ORDER BY id')).rows).toEqual(statusBefore);

        const rangkaian = (await database.query<any>(`
            SELECT ra.surat_masuk_id, rs.asal, rs.status, rs.selesai_manual, rs.unit_pencatat_id, rs.unit_pengolah_id, rs.judul, ra.sumber
              FROM rangkaian_surat rs JOIN rangkaian_anggota ra ON ra.rangkaian_id = rs.id AND ra.peran = 'induk'
             WHERE rs.asal = 'data_lama' ORDER BY ra.surat_masuk_id`)).rows;
        expect(rangkaian).toEqual([
            { surat_masuk_id: S(1), asal: 'data_lama', status: 'selesai', selesai_manual: false, unit_pencatat_id: 'ditjen', unit_pengolah_id: 'dir_bppt', judul: 'Pengadaan tanah jalan tol', sumber: 'data_lama' },
            { surat_masuk_id: S(2), asal: 'data_lama', status: 'selesai', selesai_manual: false, unit_pencatat_id: 'ditjen', unit_pengolah_id: null, judul: 'ND-2/2023', sumber: 'data_lama' },
            { surat_masuk_id: S(3), asal: 'data_lama', status: 'selesai', selesai_manual: false, unit_pencatat_id: 'ditjen', unit_pengolah_id: null, judul: '(tanpa perihal)', sumber: 'data_lama' },
        ]);
        const peserta = (await database.query<any>(`
            SELECT ra.surat_masuk_id, rp.unit_kerja_id, rp.label_asal FROM rangkaian_peserta rp
              JOIN rangkaian_anggota ra ON ra.rangkaian_id = rp.rangkaian_id AND ra.peran = 'induk'
             ORDER BY ra.surat_masuk_id, rp.unit_kerja_id`)).rows;
        expect(peserta.map((row) => `${row.surat_masuk_id.slice(-2)}:${row.unit_kerja_id}`))
            .toEqual(['01:dir_bppt', '02:dir_ktpp', '02:dir_ptep', '03:sesditjen', '08:dir_bppt']);
        expect((await database.query(`SELECT status, unit_pengolah_id FROM rangkaian_surat WHERE id = '${R8}'`)).rows)
            .toEqual([{ status: 'aktif', unit_pengolah_id: null }]);
        expect((await database.query(`SELECT jenis_relasi FROM rangkaian_relasi`)).rows).toEqual([{ jenis_relasi: 'balasan' }]);
        expect((await database.query(`SELECT count(*)::int AS n FROM rangkaian_anggota WHERE surat_keluar_id IN ('${K(2)}','${K(3)}','${K(4)}')`)).rows[0]).toEqual({ n: 0 });
        expect((await database.query(`SELECT label_norm, unit_kerja_id FROM disposisi_label_unit WHERE label_norm LIKE 'kabag%' ORDER BY 1`)).rows)
            .toEqual([
                { label_norm: 'kabag kepegawaian keuangan dan umum', unit_kerja_id: null },
                { label_norm: 'kabag program dan hukum', unit_kerja_id: null },
            ]);
        expect((await database.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log WHERE user_email = 'system:backfill-rangkaian-lama'`)).rows[0].n)
            .toBeGreaterThanOrEqual(3 + 5 + 1);
    });

    it('idempoten: dijalankan dua kali, jumlah baris identik', async () => {
        const before = await counts(database);
        const plan = await buildPlan(database);
        expect(plan.total).toMatchObject({ rangkaian_baru: 0, peserta_baru: 0, balasan_akan_ditautkan: 0 });
        expect(await applyPlan(database, { approvedSha256: plan.sha256 }))
            .toEqual({ suratDiproses: 4, rangkaianBaru: 0, pesertaBaru: 0, balasanDitautkan: 0, balasanDilewatiDiberkaskan: 0 });
        expect(await counts(database)).toEqual(before);
    });

    it('tidak menghidupkan kembali peserta yang sudah dicabut', async () => {
        await database.exec(`UPDATE rangkaian_peserta SET berakhir_at = now(),
            berakhir_by = '00000000-0000-4000-8000-0000000005a1', alasan_berakhir = 'Bukan penerima disposisi sebenarnya'
            WHERE unit_kerja_id = 'dir_ptep'`);
        const plan = await buildPlan(database);
        await applyPlan(database, { approvedSha256: plan.sha256 });
        expect((await database.query(`SELECT count(*)::int AS n, bool_and(berakhir_at IS NOT NULL) AS dicabut
            FROM rangkaian_peserta WHERE unit_kerja_id = 'dir_ptep'`)).rows).toEqual([{ n: 1, dicabut: true }]);
    });

    it('parseArgs hanya menerima argumen yang dikenal', () => {
        expect(parseArgs(['--apply', `--approved-sha256=${'A'.repeat(64)}`, '--out=laporan-x']))
            .toMatchObject({ apply: true, approvedSha256: 'a'.repeat(64) });
        expect(() => parseArgs(['--force'])).toThrow(/Argumen tidak dikenal/);
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm --prefix backend exec -- vitest run src/__tests__/backfill-rangkaian-lama.test.ts -t "apply"`
Expected: FAIL — `applyPlan is not a function`.

- [ ] **Step 3: Implementasi minimal**

Tambahkan ke `backfill-rangkaian-lama.mjs`:

```js
const BATCH_SQL = `WITH ${BASE_CTE},
batch AS (
  SELECT DISTINCT surat_masuk_id FROM rute
   WHERE surat_masuk_id > $${SEED_PARAM_COUNT + 1}::uuid
   ORDER BY 1 LIMIT ${BATCH_SIZE}
)
SELECT r.surat_masuk_id, r.pemilik, r.unit_kerja_id, r.label_asal, uk.unit_type
  FROM rute r
  JOIN batch b ON b.surat_masuk_id = r.surat_masuk_id
  JOIN unit_kerja uk ON uk.id = r.unit_kerja_id
 ORDER BY r.surat_masuk_id, r.unit_kerja_id`;

async function inTransaction(client, work) {
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('simsa:backfill-rangkaian-lama', 0))");
    const result = await work();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function audit(client, action, entityType, entityId, changes) {
  await client.query(
    `INSERT INTO audit_log (user_email, action, entity_type, entity_id, changes)
     VALUES ($1::varchar, $2::varchar, $3::varchar, $4::uuid, $5::jsonb)`,
    [ACTOR, action, entityType, entityId, JSON.stringify(changes)]);
}

async function seedLabelTable(client) {
  const { rows } = await client.query(
    `INSERT INTO disposisi_label_unit (label_norm, unit_kerja_id, perlu_verifikasi, catatan)
     SELECT label_norm, unit_kerja_id, false, catatan FROM (VALUES ${seedValues}) AS seed(label_norm, unit_kerja_id, catatan)
     ON CONFLICT (label_norm) DO UPDATE
       SET unit_kerja_id = EXCLUDED.unit_kerja_id, perlu_verifikasi = EXCLUDED.perlu_verifikasi, catatan = EXCLUDED.catatan
     WHERE (disposisi_label_unit.unit_kerja_id, disposisi_label_unit.perlu_verifikasi, disposisi_label_unit.catatan)
           IS DISTINCT FROM (EXCLUDED.unit_kerja_id, EXCLUDED.perlu_verifikasi, EXCLUDED.catatan)
     RETURNING label_norm, unit_kerja_id`, seedParams());
  for (const row of rows) {
    await audit(client, 'update', 'disposisi_label_unit', null, { labelNorm: row.label_norm, unitKerjaId: row.unit_kerja_id });
  }
}

async function applySurat(client, suratId, routes, summary) {
  const { rows: [sm] } = await client.query(
    `SELECT id, unit_kerja_id, tahun, COALESCE(NULLIF(trim(perihal), ''), nomor_surat, '(tanpa perihal)') AS judul
       FROM surat_masuk WHERE id = $1::uuid AND is_deleted IS NOT TRUE FOR UPDATE`, [suratId]);
  if (!sm) return;
  summary.suratDiproses += 1;

  let { rows: [induk] } = await client.query(
    `SELECT ra.id AS anggota_id, ra.rangkaian_id, rs.status
       FROM rangkaian_anggota ra JOIN rangkaian_surat rs ON rs.id = ra.rangkaian_id
      WHERE ra.surat_masuk_id = $1::uuid FOR UPDATE OF rs`, [suratId]);
  if (!induk) {
    const direktorat = [...new Set(routes.filter(route => route.unit_type === 'direktorat').map(route => route.unit_kerja_id))];
    const pengolah = direktorat.length === 1 ? direktorat[0] : null;
    const { rows: [rangkaian] } = await client.query(
      `INSERT INTO rangkaian_surat (kode, asal, status, unit_pencatat_id, unit_pengolah_id, judul, tahun, selesai_at, selesai_manual)
       VALUES ('RS-' || $1::int || '-' || lpad(nextval('rangkaian_surat_kode_seq')::text, 6, '0'),
               'data_lama', 'selesai', $2::varchar, $3::varchar, $4::text, $1::int, now(), false)
       RETURNING id, kode`, [sm.tahun, sm.unit_kerja_id, pengolah, sm.judul]);
    const { rows: [anggota] } = await client.query(
      `INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber)
       VALUES ($1::uuid, $2::uuid, $3::varchar, 'induk', 'data_lama') RETURNING id`,
      [rangkaian.id, suratId, sm.unit_kerja_id]);
    await audit(client, 'create', 'rangkaian_surat', rangkaian.id, {
      kode: rangkaian.kode, asal: 'data_lama', status: 'selesai', suratMasukId: suratId, unitPengolahId: pengolah,
    });
    induk = { anggota_id: anggota.id, rangkaian_id: rangkaian.id, status: 'selesai' };
    summary.rangkaianBaru += 1;
  }

  for (const route of routes) {
    // NOT EXISTS atas SEMUA baris (termasuk yang berakhir): peserta yang dicabut tidak dihidupkan lagi.
    const { rows: inserted } = await client.query(
      `INSERT INTO rangkaian_peserta (rangkaian_id, unit_kerja_id, peran, label_asal)
       SELECT $1::uuid, $2::varchar, 'disposisi_lama', $3::text
        WHERE NOT EXISTS (SELECT 1 FROM rangkaian_peserta
                           WHERE rangkaian_id = $1::uuid AND unit_kerja_id = $2::varchar AND peran = 'disposisi_lama')
       RETURNING id`, [induk.rangkaian_id, route.unit_kerja_id, route.label_asal]);
    if (inserted.length > 0) {
      await audit(client, 'update', 'rangkaian_surat', induk.rangkaian_id, {
        pesertaDisposisiLama: route.unit_kerja_id, labelAsal: route.label_asal, memberiAksesSaatFlagMati: false,
      });
      summary.pesertaBaru += 1;
    }
  }

  const { rows: balasan } = await client.query(
    `SELECT sk.id, sk.unit_kerja_id FROM surat_keluar sk
      WHERE sk.balasan_untuk = $1::uuid AND sk.unit_kerja_id = $2::varchar
        AND sk.is_deleted IS NOT TRUE AND sk.approval_status = 'approved'
        AND NOT EXISTS (SELECT 1 FROM rangkaian_anggota ra WHERE ra.surat_keluar_id = sk.id)
      ORDER BY sk.id`, [suratId, sm.unit_kerja_id]);
  for (const sk of balasan) {
    if (induk.status === 'diberkaskan') { summary.balasanDilewatiDiberkaskan += 1; continue; }
    const { rows: [anggota] } = await client.query(
      `INSERT INTO rangkaian_anggota (rangkaian_id, surat_keluar_id, unit_kerja_id, peran, sumber)
       VALUES ($1::uuid, $2::uuid, $3::varchar, 'anggota', 'data_lama') RETURNING id`,
      [induk.rangkaian_id, sk.id, sk.unit_kerja_id]);
    const { rows: [relasi] } = await client.query(
      `INSERT INTO rangkaian_relasi (rangkaian_id, dari_anggota_id, ke_anggota_id, jenis_relasi, keterangan)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'balasan', 'Data lama: balasan_untuk') RETURNING id`,
      [induk.rangkaian_id, anggota.id, induk.anggota_id]);
    await audit(client, 'create', 'rangkaian_relasi', relasi.id, {
      rangkaianId: induk.rangkaian_id, suratKeluarId: sk.id, suratMasukId: suratId, jenisRelasi: 'balasan', sumber: 'data_lama',
    });
    summary.balasanDitautkan += 1;
  }
}

export async function applyPlan(client, { approvedSha256 }) {
  if (!/^[a-f0-9]{64}$/.test(approvedSha256 ?? '')) {
    throw new Error('--apply membutuhkan --approved-sha256=<sha256 dari ringkasan.json dry-run yang sudah disetujui>');
  }
  const { rows: [pending] } = await client.query('SELECT count(*)::int AS n FROM surat_distributions WHERE rangkaian_id IS NULL');
  if (pending.n !== 0) throw new Error(`Backfill langkah 1 belum tuntas: ${pending.n} baris surat_distributions tanpa rangkaian_id`);
  const plan = await buildPlan(client);
  if (plan.sha256 !== approvedSha256) {
    throw new Error(`Rencana berubah sejak sign-off (sha256 kini ${plan.sha256}); jalankan dry-run ulang dan minta sign-off baru`);
  }

  const summary = { suratDiproses: 0, rangkaianBaru: 0, pesertaBaru: 0, balasanDitautkan: 0, balasanDilewatiDiberkaskan: 0 };
  await inTransaction(client, () => seedLabelTable(client));
  let after = ZERO_UUID;
  for (;;) {
    const { rows } = await client.query(BATCH_SQL, [...seedParams(), after]);
    if (rows.length === 0) break;
    const grouped = new Map();
    for (const row of rows) {
      if (!grouped.has(row.surat_masuk_id)) grouped.set(row.surat_masuk_id, []);
      grouped.get(row.surat_masuk_id).push(row);
    }
    await inTransaction(client, async () => {
      for (const [suratId, routes] of grouped) await applySurat(client, suratId, routes, summary);
    });
    after = [...grouped.keys()].at(-1);
  }
  return summary;
}

export function parseArgs(argv) {
  const options = { apply: false, approvedSha256: null, outDir: resolve(process.cwd(), 'laporan-rangkaian-lama') };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg.startsWith('--approved-sha256=')) options.approvedSha256 = arg.slice('--approved-sha256='.length).trim().toLowerCase();
    else if (arg.startsWith('--out=')) options.outDir = resolve(arg.slice('--out='.length));
    else throw new Error(`Argumen tidak dikenal: ${arg}`);
  }
  return options;
}

async function main() {
  dotenv.config({ quiet: true });
  if (!process.env.DATABASE_URL?.trim()) throw new Error('DATABASE_URL wajib diisi untuk backfill rangkaian lama');
  const options = parseArgs(process.argv.slice(2));
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    const plan = await buildPlan(client);
    writePlanFiles(options.outDir, plan);
    console.log(`Dry-run selesai. Laporan: ${options.outDir}`);
    console.log(`Total: ${JSON.stringify(plan.total)}`);
    console.log(`SHA-256 rencana (untuk sign-off): ${plan.sha256}`);
    if (options.apply) {
      const summary = await applyPlan(client, { approvedSha256: options.approvedSha256 });
      console.log(`Apply selesai: ${JSON.stringify(summary)}`);
      console.log('Peserta data lama BELUM memberi akses sampai RANGKAIAN_DISPOSISI_LAMA_READ=true disetujui.');
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Backfill rangkaian lama gagal${error.code ? ` [${error.code}]` : ''}: ${error.message}`);
    process.exitCode = 1;
  });
}
```

Tambahkan di `backend/package.json` → `scripts`, tepat setelah `files:letter-scan-backfill:apply`:

```json
    "rangkaian:backfill-lama:plan": "node scripts/backfill-rangkaian-lama.mjs",
    "rangkaian:backfill-lama:apply": "node scripts/backfill-rangkaian-lama.mjs --apply",
```

(Pemakaian apply: `npm --prefix backend run rangkaian:backfill-lama:apply -- --approved-sha256=<hash>`.)

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npm --prefix backend exec -- vitest run src/__tests__/backfill-rangkaian-lama.test.ts`
Expected: PASS (25 test).

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/backfill-rangkaian-lama.mjs backend/package.json backend/src/__tests__/backfill-rangkaian-lama.test.ts
git commit -m "feat(rangkaian): gated idempotent apply for legacy disposition backfill

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


#### Amandemen pra-eksekusi Task 5 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p5-data-lama-pelengkap/preflight-rulings.md`.


1. **No label-derived pengolah (BLOCKING, security) [P5-T5-1].** In `applySurat`, rename `pengolah` to `calonPengolah`, pass `null` as `unit_pengolah_id` in the `INSERT INTO rangkaian_surat`, and write the audit as:
   ```js
       await audit(client, 'create', 'rangkaian_surat', rangkaian.id, {
         kode: rangkaian.kode, asal: 'data_lama', status: 'selesai', suratMasukId: suratId,
         unitPengolahId: null, calonUnitPengolah: calonPengolah, // spec:356: pengolah memberi jangkauan tanpa flag; ditunda sampai sign-off (gerbang rilis P5)
       });
   ```
   `buildPlan` produces `calonPengolah` rows: one per new rangkaian whose routes contain exactly one `direktorat` unit.
2. **Lock order and retry (REQUIRED) [P5-T5-2] RECHECK-AFTER-P3.**
   - In `applySurat`, move the balasan read before the SM lock:
     ```js
       const { rows: calonBalasan } = await client.query(
         `SELECT sk.id FROM surat_keluar sk
           WHERE sk.balasan_untuk = $1::uuid AND sk.is_deleted IS NOT TRUE AND sk.approval_status = 'approved'
           ORDER BY sk.id`, [suratId]);
       if (calonBalasan.length > 0) {
         // G-LOCK: surat_keluar (ORDER BY id) → surat_masuk → rangkaian_surat.
         await client.query('SELECT id FROM surat_keluar WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
           [calonBalasan.map(row => row.id)]);
       }
     ```
     Then keep the SM `FOR UPDATE` and the rangkaian lock. Change `FOR UPDATE OF rs` to lock by id: `SELECT ... FROM rangkaian_surat WHERE id = $1 FOR UPDATE` after reading `ra.rangkaian_id` unlocked.
   - Keep the existing balasan query after the locks, with its `NOT EXISTS (… rangkaian_anggota …)` re-check.
   - Wrap `inTransaction` so that one batch is retried up to 3 times when `error.code` is `'40P01'` or `'40001'`:
     ```js
     async function inTransaction(client, work, percobaan = 3) {
       for (let ke = 1; ; ke += 1) {
         await client.query('BEGIN');
         try {
           await client.query("SELECT pg_advisory_xact_lock(hashtextextended('simsa:backfill-rangkaian-lama', 0))");
           const result = await work();
           await client.query('COMMIT');
           return result;
         } catch (error) {
           await client.query('ROLLBACK').catch(() => {});
           if (ke < percobaan && (error?.code === '40P01' || error?.code === '40001')) continue;
           throw error;
         }
       }
     }
     ```
     `summary` counters must be applied only after a successful commit. Accumulate per-batch counts in a local object and merge them after `inTransaction` returns.
   - **(delta P3) Confirmed deadlock partner.** P3 `tautan`/`tautanKeSurat`/`gabung` lock `kunciSurat(sp, { suratKeluarIds, suratMasukIds })` (SK ORDER BY id, then SM) and then `lockRangkaian` (`rangkaian-link.service.ts:80-82`; `deps.ts:126-129, 155-170`). This is the SK → SM → R order the amended `applySurat` follows. P3's step-1 script takes SM then R, with no SK (`backfill-rangkaian-disposisi.mjs:44-71`). The concurrency review verified it deadlock-free against P3 writers, which all take SM first.
3. **No peserta on `diberkaskan` (REQUIRED) [P5-T5-3].**
   - In the peserta loop, add `if (induk.status === 'diberkaskan') { summary.pesertaDilewatiDiberkaskan += 1; continue; }` before the INSERT.
   - Initialize the counter in `summary`.
   - `buildPlan` counts these routes as `peserta_dilewati_diberkaskan` and excludes them from `peserta_baru`.
4. **Test updates (REQUIRED) [P5-T5-4].**
   - Summary expectation: `{ suratDiproses: 3, rangkaianBaru: 3, pesertaBaru: 4, balasanDitautkan: 1, balasanDilewatiDiberkaskan: 0, pesertaDilewatiDiberkaskan: 0 }`.
   - In the S1 rangkaian row: `unit_pengolah_id: null`.
   - Peserta list: `['01:dir_bppt', '02:dir_ktpp', '02:dir_ptep', '03:sesditjen']`.
   - Audit: `.toBeGreaterThanOrEqual(3 + 4 + 1)`.
   - Idempotent run: `{ suratDiproses: 3, rangkaianBaru: 0, pesertaBaru: 0, balasanDitautkan: 0, balasanDilewatiDiberkaskan: 0, pesertaDilewatiDiberkaskan: 0 }`.
   - Add a check that the S1 create audit has `changes.calonUnitPengolah === 'dir_bppt'`.
   - Add at the end of `describe('apply')`:
     ```ts
         it('tidak menambah peserta ke rangkaian yang sudah diberkaskan (fail closed, RB P1 butir 9)', async () => {
             const { rows: [rs1] } = await database.query<{ id: string }>(`
                 SELECT ra.rangkaian_id AS id FROM rangkaian_anggota ra WHERE ra.surat_masuk_id = '${S(1)}' AND ra.peran = 'induk'`);
             await database.exec(`
                 UPDATE surat_masuk SET disposisi = array_append(disposisi, 'PLP') WHERE id = '${S(1)}';
                 UPDATE rangkaian_surat SET status = 'diberkaskan', unit_pengolah_id = 'ditjen', klasifikasi_item_id = (SELECT min(id) FROM klasifikasi_arsip),
                        diberkaskan_at = now(), diberkaskan_by = '${P5_IDS.superA}' WHERE id = '${rs1.id}';`);
             const plan = await buildPlan(database, { batas: BATAS_UJI });
             expect(plan.total).toMatchObject({ peserta_baru: 0, peserta_dilewati_diberkaskan: 1 });
             const summary = await applyPlan(database, { approvedSha256: plan.sha256, batas: BATAS_UJI });
             expect(summary).toMatchObject({ pesertaBaru: 0, pesertaDilewatiDiberkaskan: 1 });
             expect((await database.query(`SELECT count(*)::int AS n FROM rangkaian_peserta WHERE rangkaian_id = '${rs1.id}' AND unit_kerja_id = 'dir_plp'`)).rows[0]).toEqual({ n: 0 });
         });
     ```
     If the 0046 CHECK for `diberkaskan` needs other columns, set them the same way `seedBerkasDiberkaskan` does.
5. **Role and connection (REQUIRED) [P5-T5-5].** Add this header comment above `main()`:
   ```js
   // Dijalankan sebagai role runtime `simsa_api`: DATABASE_URL diisi dari NEON_RUNTIME_DATABASE_URL lewat prompt
   // tersembunyi (docs/RUNBOOK_INTEGRASI_SURAT_P1.md). Jangan memakai simsa_maintenance/simsa_operator: tanpa grant
   // rangkaian_*, dan menambah grant mengubah hash grants/0002 serta pin Neon (RB P1 butir 5, P3 T2-3).
   ```
   `main()` resolves `const batas = await resolveBatasDataLama(client)`, passes it to `buildPlan`/`applyPlan`, and prints it.
6. **Smaller consistency items (ADVISORY) [P5-T5-6].**
   - The judul uses `COALESCE(NULLIF(regexp_replace(perihal, <PG_TRIM_PATTERN>, '', 'g'), ''), nomor_surat, '(tanpa perihal)')`.
   - The Ambiguitas section notes that a balasan linked into an existing `aktif` step-1 rangkaian waits for the next recompute.
   - Optionally rename the npm scripts to `db:backfill:rangkaian-lama` / `db:backfill:rangkaian-lama:apply`, placed next to `db:backfill:rangkaian-disposisi`. If you do, update the docs test (P5:3113) and the runbook.
7. **(delta P3) `data_lama` anggota and auto-selesai (ADVISORY test and gate row; P3 concurrency carry-forward 2 (#102), spec review T12).**
   - P1's fact `surat_masuk_belum_ditangani` counts every live SM anggota without an approved reply, including `sumber='data_lama'`.
   - A pengawas gabung of a backfilled `data_lama` rangkaian (status `selesai`) into a live rangkaian moves those SMs into the target, and the target can then never auto-close.
   - Add one PGlite case to the Task 5 suite: after `applyPlan`, call `rangkaianService.gabung` with a live target and the S1 rangkaian, then `recomputeStatus`.
     - Expected by reading P1: the target stays `aktif`, and the `surat_masuk_belum_ditangani` fact is ≥ 1.
     - If P1 refuses gabung of a `data_lama` source, assert that refusal instead. Either way, the observed behaviour is what gate row (g) signs.
   - Record the result in release-gate row (g). P5 does **not** change the P1 fact without the owner's decision.


**C-1 (critic) — Tasks 5, 13: the backfill entry point must not fall back to `backend/.env` — REQUIRED (security/ops) [P5-C-1]**


- P5:1253-1255: `main()` runs `dotenv.config()` before checking `DATABASE_URL`. Two consequences:
  - An operator who forgets the shell export silently targets whatever `backend/.env` holds: a dev DB, or production through a non-runtime role.
  - The P5-G-5 resolver then reads a `RANGKAIAN_DATA_LAMA_SEBELUM` from that file.
  - P5-T5-5 only adds a comment, so neither is prevented.
- Real P3 fixed exactly this for step 1:
  - `backfill-rangkaian-disposisi.mjs:136-145` [F3] captures `DATABASE_URL` before `dotenv.config` and throws without it;
  - `:33-36` logs `current_user`/`current_database()` before the first batch.
- Binding shape of `main()`, merged with Task 4 item 3 and Task 5 item 5:
  ```js
  async function main() {
    // [F3] pola P3: nilai shell ditangkap SEBELUM dotenv; skrip ini tidak memakai fallback backend/.env.
    const urlShell = process.env.DATABASE_URL?.trim();
    const batasShell = process.env.RANGKAIAN_DATA_LAMA_SEBELUM?.trim();
    dotenv.config({ quiet: true });
    if (!urlShell) throw new Error('DATABASE_URL harus diset eksplisit di shell (NEON_RUNTIME_DATABASE_URL, role simsa_api); skrip ini tidak memakai backend/.env');
    const options = parseArgs(process.argv.slice(2));
    const client = new Client({ connectionString: urlShell, connectionTimeoutMillis: 10_000 });
    await client.connect();
    try {
      const { rows: [identitas] } = await client.query('SELECT current_user AS db_user, current_database() AS db_name');
      const batas = await resolveBatasDataLama(client, { RANGKAIAN_DATA_LAMA_SEBELUM: batasShell });
      console.log(JSON.stringify({ dbUser: identitas.db_user, dbName: identitas.db_name, batasDataLama: batas, sumberBatas: batasShell ? 'env' : 'db' }));
      if (options.apply && !batasShell) {
        throw new Error('--apply mewajibkan RANGKAIAN_DATA_LAMA_SEBELUM di shell, sama persis dengan nilai Vercel (runbook Deploy P4)');
      }
      // lanjut: buildPlan(client, { batas }), writePlanFiles, applyPlan(client, { approvedSha256, batas }) seperti amandemen Task 4/5.
    } finally {
      await client.end();
    }
  }
  ```
- Drop the `dotenv` import entirely if no other variable needs it.
- **(delta P3) Confirmed on b4d86fa.** The [F3] capture before `dotenv.config` is at `backfill-rangkaian-disposisi.mjs:136-145`, and the identity log at :34-36. The P3 script only logs, and does not refuse a wrong role (ledger `progress.md:48`). The binding shape above, which prints the first JSON line and has the runbook stop when `dbUser` ≠ `simsa_api`, stays. Optionally fail closed in code: `if (identitas.db_user !== 'simsa_api' && process.env.ALLOW_NON_RUNTIME_ROLE !== '1') throw …`.
- Runbook: stop if the first JSON line shows a `dbUser` other than `simsa_api` or the wrong `dbName`. This is the same rule as the P3 runbook §4.
- Test: `--apply` without the shell env throws, run through an exported helper that wraps the check.


**C-2 (critic) — Tasks 4, 5, 7, 13: the deferred pengolah has no executable path — REQUIRED (spec:358; contradicts the "Cost if wrong" of P5-T5-1 and runbook step 8 of P5-T13-1) [P5-C-2]**


- **Ubah Unit Pengolah cannot apply it.** P3 `berkasService.ubahUnitPengolah` accepts only a unit in `unitDalamJangkauanBerkas` (P3:6591-6597). That set is the non-rejected distribution targets plus the anggota units (P3:6485-6492; spec §9).
  - `disposisi_lama` peserta are not in it.
  - A backfilled `data_lama` rangkaian has no distribution to its label units.
- **Koreksi Berkas cannot apply it either.** After P5-T6-1 it uses the same predicate and answers 422.
- So "through P3 Ubah Unit Pengolah or a Koreksi" (P5-T5-1) and runbook step 8 (P5-T13-1) cannot apply `calonUnitPengolah`.
- **(delta P3) Confirmed on real code.** `ubahUnitPengolah` refuses any unit outside `unitDalamJangkauanBerkas` with 422 "Disposisikan dulu ke unit ini" (`berkas.service.ts:217-224`). That set is the non-rejected distribution targets plus the live anggota units (:69-83), with no peserta branch. Ubah is also limited to `aktif`/`selesai` (:221).
- **Tutup massal then locks the choice in.** It files every `data_lama` rangkaian with `coalesce(rs.unit_pengolah_id, rs.unit_pencatat_id)` (P5:1844, 1878), and `diberkaskan` is terminal (`0046_rangkaian_surat.sql:331-346`). Spec:358 is thereby abandoned permanently and silently.
- Binding:
  1. **Two outcomes for release-gate row (a)** (P5-G-6):
     - "isi": apply the label-derived pengolah per spec:358, after the security owner signs `calon-pengolah.csv`;
     - "tidak": spec:358 is waived, and the berkas go to the pencatat.
  2. **A pengolah mode in the backfill script**, SHA-bound: either as an `--isi-pengolah` option of `--apply` (the chosen mode is part of the SHA payload), or as a separate later run `--isi-pengolah --approved-sha256=<sha>`. For each `calonPengolah` row (already in the Task 4 payload) whose rangkaian still has `asal='data_lama' AND status='selesai' AND unit_pengolah_id IS NULL`:
     - lock by id (`ORDER BY id FOR UPDATE`) and set `unit_pengolah_id`;
     - write one audit row: `action: 'update'`, `changes: { before: { unitPengolahId: null }, after: { unitPengolahId }, sumber: 'backfill-rangkaian-lama', aksesBaru: [unit] }`;
     - refuse on an SHA mismatch.

     Tests: S1 gets `dir_bppt`; a second run changes nothing; a `diberkaskan` row or one with a non-NULL pengolah is skipped.
  3. **Runbook order:** `--apply` → decision on gate (a) → pengolah mode if the decision is "isi" → only then Tutup massal of data lama.
     - The Task 10 UI copy and PANDUAN (P5:3165) state that Tutup massal files a berkas with no pengolah to the pencatat.
  4. **Access is not flag-controlled.** The runbook states that pengolah access is not controlled by the flag: after the pengolah mode runs, unsetting `RANGKAIAN_DISPOSISI_LAMA_READ` no longer revokes it (`visibility-spec.ts:130-131`).


**C-12 (critic) — Tasks 4, 5: fixture totals verified by hand; test ordering — ADVISORY [P5-C-12]**


- **Totals.** The amended totals (P5-T4-1 and P5-T5-4) were not executed in scratch. Recomputed by hand from the fixture (P5:793-817):
  - routes: SM1→dir_bppt, SM2→dir_ptep, SM2→dir_ktpp and SM3→sesditjen;
  - SM8→dir_bppt is `sudah_didisposisikan` (distribution at P5:810-811);
  - balasan: K1 is `akan_ditautkan`, K2 and K4 are `lintas_unit_ditinjau_tu`, K3 is `dilewati_belum_disetujui`.

  That gives `{ surat_target: 3, rangkaian_baru: 3, peserta_baru: 4, balasan_akan_ditautkan: 1, balasan_lintas_unit: 2, sudah_didisposisikan: 1, peserta_dilewati_diberkaskan: 0 }`, which matches the amendment. The `bppt` pemetaan row (`jumlah_surat: 2`, `jumlah_surat_dirutekan: 2`) is unchanged.
- **Test ordering.** The Task 5 item 4 test ("tidak menambah peserta ke rangkaian yang sudah diberkaskan") needs rs1 from an earlier apply test. It also mutates the shared `beforeAll` database: it changes SM1's labels and sets rs1 to `diberkaskan`. Keep it the last test in the file, or call `applyPlan` inside it first when rs1 is absent.



### Task 6: Service Koreksi Berkas (maker-checker via GUC `simsa.berkas_koreksi`)

**Files:**
- Create: `backend/src/services/rangkaian-koreksi.service.ts`
- Test: `backend/src/__tests__/rangkaian-koreksi.service.test.ts`

**Interfaces:**
- Consumes (P1): tabel `rangkaian_koreksi_berkas`, trigger kedua pada `rangkaian_surat` (izin hanya bila `current_setting('simsa.berkas_koreksi', true)` = id koreksi `approved` dan nilai baru sama persis), CHECK `diputuskan_by <> diajukan_by`; (Task 1) `rangkaian_koreksi_berkas_terbuka_uidx`; `LogActionData.entityType` `'rangkaian_surat'` (ditambahkan P1 Task 9); `auditLogService.logActionOrThrow`, `CriticalAuditContext`; `hasPostgresErrorCode`.
- Produces: `default export rangkaianKoreksiService` dengan `ajukan(actor, rangkaianId, input, auditContext?)`, `putuskan(actor, koreksiId, input, auditContext?)`, `daftar(actor, rangkaianId)`; `unitDalamJangkauanBerkas(executor, rangkaianId)`; tipe `KoreksiActor`, `AjukanKoreksiInput`, `PutuskanKoreksiInput`, `KoreksiBerkasDto`.

- [ ] **Step 1: Tulis test yang gagal**

```ts
// backend/src/__tests__/rangkaian-koreksi.service.test.ts
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRangkaianTestDatabase, P5_IDS, seedBerkasDiberkaskan, seedRangkaianBase } from './helpers/rangkaian-p5-pglite.js';

const holder = vi.hoisted(() => ({ db: null as any, audit: vi.fn() }));
vi.mock('../config/database.js', () => ({
    db: {
        execute: (query: any) => holder.db.execute(query),
        transaction: (run: any) => holder.db.transaction(run),
    },
}));
vi.mock('../services/audit-log.service.js', () => ({ default: { logActionOrThrow: holder.audit } }));

const superA = { id: P5_IDS.superA, email: 'super-a@example.test', role: 'super_admin', unitKerjaId: null };
const superB = { id: P5_IDS.superB, email: 'super-b@example.test', role: 'super_admin', unitKerjaId: null };
const tu = { id: P5_IDS.tu, email: 'tu@example.test', role: 'admin_unit', unitKerjaId: 'sesditjen' };
const ALASAN = 'Unit pengolah salah pilih saat pemberkasan';

let database: PGlite;
let klasA: number;
let klasB: number;
let service: typeof import('../services/rangkaian-koreksi.service.js').default;

beforeEach(async () => {
    database = await createRangkaianTestDatabase();
    ({ klasA, klasB } = await seedRangkaianBase(database));
    await seedBerkasDiberkaskan(database, klasA);
    holder.db = drizzle(database);
    holder.audit.mockReset();
    service = (await import('../services/rangkaian-koreksi.service.js')).default;
}, 180_000);
afterEach(async () => { await database?.close(); });

const berkas = async () => (await database.query<any>(
    `SELECT status, unit_pengolah_id, klasifikasi_item_id FROM rangkaian_surat WHERE id = '${P5_IDS.berkas}'`)).rows[0];

describe('Koreksi Berkas', () => {
    it('super_admin lain menyetujui → koreksi diterapkan persis dan status tetap diberkaskan', async () => {
        const koreksi = await service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: klasB, alasan: ALASAN });
        expect(koreksi).toMatchObject({ status: 'pending', unitPengolahLama: 'dir_bppt', unitPengolahBaru: 'dir_ptep' });
        const hasil = await service.putuskan(superB, koreksi.id, { keputusan: 'setuju' });
        expect(hasil).toMatchObject({ status: 'applied', diputuskanBy: P5_IDS.superB });
        expect(await berkas()).toEqual({ status: 'diberkaskan', unit_pengolah_id: 'dir_ptep', klasifikasi_item_id: klasB });
        expect(holder.audit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'update', entityType: 'rangkaian_surat', entityId: P5_IDS.berkas,
        }), expect.anything());
        const guc = await database.query<{ v: string | null }>(`SELECT current_setting('simsa.berkas_koreksi', true) AS v`);
        expect(guc.rows[0].v ?? '').toBe('');
    });

    it('pengaju tidak boleh memutuskan koreksinya sendiri', async () => {
        const koreksi = await service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: klasA, alasan: ALASAN });
        await expect(service.putuskan(superA, koreksi.id, { keputusan: 'setuju' })).rejects.toMatchObject({ statusCode: 403 });
        expect(await berkas()).toMatchObject({ unit_pengolah_id: 'dir_bppt' });
    });

    it('hanya super_admin aktif yang dapat mengajukan dan memutuskan', async () => {
        await expect(service.ajukan(tu, P5_IDS.berkas, { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: klasA, alasan: ALASAN }))
            .rejects.toMatchObject({ statusCode: 403 });
        const koreksi = await service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: klasA, alasan: ALASAN });
        await database.exec(`UPDATE users SET is_active = false WHERE id = '${P5_IDS.superB}'`);
        await expect(service.putuskan(superB, koreksi.id, { keputusan: 'setuju' })).rejects.toMatchObject({ statusCode: 403 });
    });

    it('unit di luar jangkauan ditolak 422 dan koreksi tanpa perubahan ditolak 400', async () => {
        await expect(service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_plp', klasifikasiBaru: klasA, alasan: ALASAN }))
            .rejects.toMatchObject({ statusCode: 422, message: 'Disposisikan dulu ke unit ini.' });
        await expect(service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_bppt', klasifikasiBaru: klasA, alasan: ALASAN }))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    it('hanya satu koreksi terbuka per rangkaian', async () => {
        await service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: klasA, alasan: ALASAN });
        await expect(service.ajukan(superB, P5_IDS.berkas, { unitPengolahBaru: 'sesditjen', klasifikasiBaru: klasA, alasan: ALASAN }))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    it('koreksi basi (berkas berubah sejak diajukan) ditolak 409', async () => {
        const koreksi = await service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: klasA, alasan: ALASAN });
        await database.exec(`ALTER TABLE rangkaian_surat DISABLE TRIGGER USER;
            UPDATE rangkaian_surat SET klasifikasi_item_id = ${klasB} WHERE id = '${P5_IDS.berkas}';
            ALTER TABLE rangkaian_surat ENABLE TRIGGER USER;`);
        await expect(service.putuskan(superB, koreksi.id, { keputusan: 'setuju' })).rejects.toMatchObject({ statusCode: 409 });
    });

    it('penolakan mencatat denied tanpa mengubah berkas', async () => {
        const koreksi = await service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: klasA, alasan: ALASAN });
        expect(await service.putuskan(superB, koreksi.id, { keputusan: 'tolak', catatan: 'Unit sudah benar' }))
            .toMatchObject({ status: 'denied' });
        expect(await berkas()).toMatchObject({ unit_pengolah_id: 'dir_bppt', klasifikasi_item_id: klasA });
        await expect(service.putuskan(superB, koreksi.id, { keputusan: 'setuju' })).rejects.toMatchObject({ statusCode: 409 });
    });

    it('trigger DB menolak perubahan tanpa GUC, dengan koreksi pending, atau nilai berbeda', async () => {
        await expect(database.exec(`UPDATE rangkaian_surat SET unit_pengolah_id = 'dir_ptep' WHERE id = '${P5_IDS.berkas}'`)).rejects.toThrow();
        const koreksi = await service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: klasB, alasan: ALASAN });
        const attempt = (unit: string, klas: number) => database.exec(`BEGIN;
            SELECT set_config('simsa.berkas_koreksi', '${koreksi.id}', true);
            UPDATE rangkaian_surat SET unit_pengolah_id = '${unit}', klasifikasi_item_id = ${klas} WHERE id = '${P5_IDS.berkas}';
            COMMIT;`);
        await expect(attempt('dir_ptep', klasB)).rejects.toThrow();
        await database.exec('ROLLBACK');
        await database.exec(`UPDATE rangkaian_koreksi_berkas SET status = 'approved', diputuskan_by = '${P5_IDS.superB}', diputuskan_at = now()
            WHERE id = '${koreksi.id}'`);
        await expect(attempt('dir_ptep', klasA)).rejects.toThrow();
        await database.exec('ROLLBACK');
        await expect(attempt('sesditjen', klasB)).rejects.toThrow();
        await database.exec('ROLLBACK');
        expect(await berkas()).toMatchObject({ unit_pengolah_id: 'dir_bppt', klasifikasi_item_id: klasA });
        await expect(database.exec(`UPDATE rangkaian_koreksi_berkas SET diputuskan_by = diajukan_by WHERE id = '${koreksi.id}'`)).rejects.toThrow();
    });

    it('daftar menandai siapa yang boleh memutuskan dan kandidat unit dari jangkauan', async () => {
        const koreksi = await service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: klasA, alasan: ALASAN });
        const bagiA = await service.daftar(superA, P5_IDS.berkas);
        expect(bagiA).toMatchObject({ dapatMengajukan: false, koreksi: [{ id: koreksi.id, dapatDiputuskan: false }] });
        expect(bagiA.kandidatUnit.map((unit) => unit.id).sort()).toEqual(['dir_bppt', 'dir_ptep', 'sesditjen']);
        const bagiB = await service.daftar(superB, P5_IDS.berkas);
        expect(bagiB.koreksi[0].dapatDiputuskan).toBe(true);
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm --prefix backend exec -- vitest run src/__tests__/rangkaian-koreksi.service.test.ts`
Expected: FAIL — `Cannot find module '../services/rangkaian-koreksi.service.js'`.

- [ ] **Step 3: Implementasi minimal**

```ts
// backend/src/services/rangkaian-koreksi.service.ts
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../config/database.js';
import auditLogService, { type CriticalAuditContext } from './audit-log.service.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.js';
import { hasPostgresErrorCode } from '../utils/postgres-errors.js';

export interface KoreksiActor { id: string; email: string; role: string; unitKerjaId: string | null }
export interface AjukanKoreksiInput { unitPengolahBaru: string; klasifikasiBaru: number; alasan: string }
export interface PutuskanKoreksiInput { keputusan: 'setuju' | 'tolak'; catatan?: string }

type Executor = { execute: (query: SQL) => Promise<unknown> };

interface KoreksiRow {
    id: string; rangkaian_id: string; unit_pengolah_lama: string; unit_pengolah_baru: string;
    klasifikasi_lama: number; klasifikasi_baru: number; alasan: string; status: string;
    diajukan_by: string; diajukan_at: Date | string; diputuskan_by: string | null; diputuskan_at: Date | string | null;
}
interface BerkasRow { id: string; kode: string; status: string; unit_pengolah_id: string | null; klasifikasi_item_id: number | null }

export interface KoreksiBerkasDto {
    id: string; rangkaianId: string; status: string; alasan: string;
    unitPengolahLama: string; unitPengolahBaru: string; klasifikasiLama: number; klasifikasiBaru: number;
    diajukanBy: string; diajukanAt: Date | string; diputuskanBy: string | null; diputuskanAt: Date | string | null;
}

async function rows<T>(executor: Executor, query: SQL): Promise<T[]> {
    const result = await executor.execute(query) as { rows?: T[] } | T[];
    return Array.isArray(result) ? result : (result.rows ?? []);
}

const toDto = (row: KoreksiRow): KoreksiBerkasDto => ({
    id: row.id, rangkaianId: row.rangkaian_id, status: row.status, alasan: row.alasan,
    unitPengolahLama: row.unit_pengolah_lama, unitPengolahBaru: row.unit_pengolah_baru,
    klasifikasiLama: Number(row.klasifikasi_lama), klasifikasiBaru: Number(row.klasifikasi_baru),
    diajukanBy: row.diajukan_by, diajukanAt: row.diajukan_at, diputuskanBy: row.diputuskan_by, diputuskanAt: row.diputuskan_at,
});

async function assertActiveSuperAdmin(tx: Executor, actor: KoreksiActor): Promise<void> {
    const [user] = await rows<{ role: string; is_active: boolean }>(tx,
        sql`SELECT role, is_active FROM users WHERE id = ${actor.id} FOR SHARE`);
    if (!user || user.role !== 'super_admin' || user.is_active !== true) {
        throw new ForbiddenError('Koreksi Berkas hanya dapat dilakukan oleh super_admin aktif.');
    }
}

async function lockBerkas(tx: Executor, rangkaianId: string): Promise<BerkasRow> {
    const [berkas] = await rows<BerkasRow>(tx, sql`
        SELECT id, kode, status, unit_pengolah_id, klasifikasi_item_id
          FROM rangkaian_surat WHERE id = ${rangkaianId} FOR UPDATE`);
    if (!berkas) throw new NotFoundError('Rangkaian');
    if (berkas.status !== 'diberkaskan') {
        throw new ConflictError('Koreksi Berkas hanya untuk rangkaian yang sudah diberkaskan.');
    }
    return berkas;
}

/** Spec §9: unit pengolah hanya dari target disposisi non-rejected, penulis anggota, atau pemilik induk. */
export async function unitDalamJangkauanBerkas(executor: Executor, rangkaianId: string): Promise<string[]> {
    const result = await rows<{ unit_kerja_id: string }>(executor, sql`
        SELECT target_unit_id AS unit_kerja_id FROM surat_distributions
         WHERE rangkaian_id = ${rangkaianId} AND status <> 'rejected'
        UNION
        SELECT unit_kerja_id FROM rangkaian_anggota WHERE rangkaian_id = ${rangkaianId}
        ORDER BY 1`);
    return result.map((row) => row.unit_kerja_id);
}

async function assertUnitDalamJangkauan(tx: Executor, rangkaianId: string, lama: string | null, baru: string) {
    if (lama === baru) return;
    if (!(await unitDalamJangkauanBerkas(tx, rangkaianId)).includes(baru)) {
        throw new AppError('Disposisikan dulu ke unit ini.', 422);
    }
}

export const rangkaianKoreksiService = {
    async ajukan(actor: KoreksiActor, rangkaianId: string, input: AjukanKoreksiInput, auditContext?: CriticalAuditContext) {
        try {
            return await db.transaction(async (tx) => {
                await assertActiveSuperAdmin(tx, actor);
                const berkas = await lockBerkas(tx, rangkaianId);
                if (berkas.unit_pengolah_id === input.unitPengolahBaru
                    && Number(berkas.klasifikasi_item_id) === input.klasifikasiBaru) {
                    throw new ValidationError('Koreksi tidak mengubah unit pengolah maupun klasifikasi.');
                }
                await assertUnitDalamJangkauan(tx, rangkaianId, berkas.unit_pengolah_id, input.unitPengolahBaru);
                const [klasifikasi] = await rows<{ id: number }>(tx,
                    sql`SELECT id FROM klasifikasi_arsip WHERE id = ${input.klasifikasiBaru}`);
                if (!klasifikasi) throw new ValidationError('Klasifikasi arsip tidak ditemukan.');
                const [koreksi] = await rows<KoreksiRow>(tx, sql`
                    INSERT INTO rangkaian_koreksi_berkas
                      (rangkaian_id, unit_pengolah_lama, unit_pengolah_baru, klasifikasi_lama, klasifikasi_baru, alasan, diajukan_by)
                    VALUES (${rangkaianId}, ${berkas.unit_pengolah_id}, ${input.unitPengolahBaru},
                            ${berkas.klasifikasi_item_id}, ${input.klasifikasiBaru}, ${input.alasan.trim()}, ${actor.id})
                    RETURNING *`);
                await auditLogService.logActionOrThrow({
                    userId: actor.id, userEmail: actor.email, ipAddress: auditContext?.ipAddress,
                    action: 'create', entityType: 'rangkaian_surat', entityId: rangkaianId,
                    changes: {
                        koreksiBerkas: 'diajukan', koreksiBerkasId: koreksi.id, alasan: koreksi.alasan,
                        before: { unitPengolahId: berkas.unit_pengolah_id, klasifikasiItemId: berkas.klasifikasi_item_id },
                        usulan: { unitPengolahId: input.unitPengolahBaru, klasifikasiItemId: input.klasifikasiBaru },
                    },
                }, tx);
                return toDto(koreksi);
            });
        } catch (error) {
            if (hasPostgresErrorCode(error, '23505')) {
                throw new ConflictError('Masih ada Koreksi Berkas yang belum diputuskan untuk rangkaian ini.');
            }
            throw error;
        }
    },

    async putuskan(actor: KoreksiActor, koreksiId: string, input: PutuskanKoreksiInput, auditContext?: CriticalAuditContext) {
        return db.transaction(async (tx) => {
            await assertActiveSuperAdmin(tx, actor);
            const [koreksi] = await rows<KoreksiRow>(tx,
                sql`SELECT * FROM rangkaian_koreksi_berkas WHERE id = ${koreksiId} FOR UPDATE`);
            if (!koreksi) throw new NotFoundError('Koreksi Berkas');
            if (koreksi.status !== 'pending') throw new ConflictError('Koreksi Berkas sudah diputuskan.');
            if (koreksi.diajukan_by === actor.id) {
                throw new ForbiddenError('Pengaju tidak boleh memutuskan Koreksi Berkas miliknya sendiri.');
            }
            const base = {
                userId: actor.id, userEmail: actor.email, ipAddress: auditContext?.ipAddress,
                entityType: 'rangkaian_surat' as const, entityId: koreksi.rangkaian_id,
            };

            if (input.keputusan === 'tolak') {
                const [denied] = await rows<KoreksiRow>(tx, sql`
                    UPDATE rangkaian_koreksi_berkas SET status = 'denied', diputuskan_by = ${actor.id}, diputuskan_at = now()
                     WHERE id = ${koreksiId} RETURNING *`);
                await auditLogService.logActionOrThrow({
                    ...base, action: 'status_change',
                    changes: { koreksiBerkas: 'ditolak', koreksiBerkasId: koreksiId, catatan: input.catatan?.trim() || null },
                }, tx);
                return toDto(denied);
            }

            const berkas = await lockBerkas(tx, koreksi.rangkaian_id);
            if (berkas.unit_pengolah_id !== koreksi.unit_pengolah_lama
                || Number(berkas.klasifikasi_item_id) !== Number(koreksi.klasifikasi_lama)) {
                throw new ConflictError('Berkas sudah berubah sejak koreksi diajukan; tolak koreksi ini lalu ajukan koreksi baru.');
            }
            await assertUnitDalamJangkauan(tx, koreksi.rangkaian_id, koreksi.unit_pengolah_lama, koreksi.unit_pengolah_baru);

            await tx.execute(sql`UPDATE rangkaian_koreksi_berkas
                SET status = 'approved', diputuskan_by = ${actor.id}, diputuskan_at = now() WHERE id = ${koreksiId}`);
            await tx.execute(sql`SELECT set_config('simsa.berkas_koreksi', ${koreksiId}, true)`);
            await tx.execute(sql`UPDATE rangkaian_surat
                SET unit_pengolah_id = ${koreksi.unit_pengolah_baru}, klasifikasi_item_id = ${koreksi.klasifikasi_baru}, updated_at = now()
                WHERE id = ${koreksi.rangkaian_id}`);
            await tx.execute(sql`SELECT set_config('simsa.berkas_koreksi', '', true)`);
            const [applied] = await rows<KoreksiRow>(tx, sql`
                UPDATE rangkaian_koreksi_berkas SET status = 'applied' WHERE id = ${koreksiId} RETURNING *`);
            await auditLogService.logActionOrThrow({
                ...base, action: 'update',
                changes: {
                    koreksiBerkas: 'diterapkan', koreksiBerkasId: koreksiId,
                    diajukanBy: koreksi.diajukan_by, diputuskanBy: actor.id, alasan: koreksi.alasan,
                    before: { unitPengolahId: koreksi.unit_pengolah_lama, klasifikasiItemId: koreksi.klasifikasi_lama },
                    after: { unitPengolahId: koreksi.unit_pengolah_baru, klasifikasiItemId: koreksi.klasifikasi_baru },
                },
            }, tx);
            return toDto(applied);
        });
    },

    async daftar(actor: KoreksiActor, rangkaianId: string) {
        const [berkas] = await rows<BerkasRow>(db, sql`
            SELECT id, kode, status, unit_pengolah_id, klasifikasi_item_id FROM rangkaian_surat WHERE id = ${rangkaianId}`);
        if (!berkas) throw new NotFoundError('Rangkaian');
        const koreksi = await rows<KoreksiRow>(db, sql`
            SELECT * FROM rangkaian_koreksi_berkas WHERE rangkaian_id = ${rangkaianId} ORDER BY diajukan_at DESC, id`);
        const kandidatUnit = berkas.status === 'diberkaskan'
            ? await rows<{ id: string; name: string }>(db, sql`
                SELECT uk.id, uk.name FROM unit_kerja uk
                 WHERE uk.id IN (
                   SELECT target_unit_id FROM surat_distributions WHERE rangkaian_id = ${rangkaianId} AND status <> 'rejected'
                   UNION SELECT unit_kerja_id FROM rangkaian_anggota WHERE rangkaian_id = ${rangkaianId})
                 ORDER BY uk.name`)
            : [];
        const superAdmin = actor.role === 'super_admin';
        return {
            rangkaian: {
                id: berkas.id, kode: berkas.kode, status: berkas.status,
                unitPengolahId: berkas.unit_pengolah_id,
                klasifikasiItemId: berkas.klasifikasi_item_id === null ? null : Number(berkas.klasifikasi_item_id),
            },
            dapatMengajukan: superAdmin && berkas.status === 'diberkaskan' && !koreksi.some((row) => row.status === 'pending'),
            kandidatUnit,
            koreksi: koreksi.map((row) => ({
                ...toDto(row),
                dapatDiputuskan: superAdmin && row.status === 'pending' && row.diajukan_by !== actor.id,
            })),
        };
    },
};

export default rangkaianKoreksiService;
```

- [ ] **Step 4: Jalankan test, pastikan lulus; typecheck**

Run: `npm --prefix backend exec -- vitest run src/__tests__/rangkaian-koreksi.service.test.ts`
Expected: PASS (9 test).
Run: `npm --prefix backend exec -- tsc --noEmit`
Expected: tanpa error (bila `'rangkaian_surat'` belum ada di union `LogActionData.entityType`, P1/P3 belum lengkap — hentikan).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/rangkaian-koreksi.service.ts backend/src/__tests__/rangkaian-koreksi.service.test.ts
git commit -m "feat(rangkaian): maker-checker berkas correction applied through simsa.berkas_koreksi

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


#### Amandemen pra-eksekusi Task 6 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p5-data-lama-pelengkap/preflight-rulings.md`.


1. **P3 unit predicate (REQUIRED) [P5-T6-1] RECHECK-AFTER-P3.**
   - Delete `export async function unitDalamJangkauanBerkas` from `rangkaian-koreksi.service.ts` and drop it from Produces.
   - Import `berkasService` from `./rangkaian/berkas.service.js`, or through `./rangkaian/deps.js` if P3 re-exports it there.
   - `assertUnitDalamJangkauan` uses `await berkasService.unitDalamJangkauanBerkas(tx, rangkaianId)`.
   - `daftar.kandidatUnit` becomes:
     ```ts
             const unitIds = berkas.status === 'diberkaskan' ? await berkasService.unitDalamJangkauanBerkas(db, rangkaianId) : [];
             const kandidatUnit = unitIds.length
                 ? await rows<{ id: string; name: string }>(db, sql`SELECT id, name FROM unit_kerja WHERE id = ANY(${unitIds}::varchar[]) ORDER BY name`)
                 : [];
     ```
   - Add a test: a unit whose only link to the berkas is an anggota surat that was soft-deleted is refused by `ajukan` with 422.
   - **(delta P3) Confirmed.**
     - `berkasService.unitDalamJangkauanBerkas(executor: Executor, rangkaianId: string): Promise<string[]>` is at `rangkaian/berkas.service.ts:69-83`. It filters soft-deleted SMs on the distribution branch (:75) and soft-deleted members on the anggota branch (:81). `deps.ts` does **not** re-export it, so import it from `./rangkaian/berkas.service.js`.
     - For the id → name map, reuse the P3 pattern in `opsiBerkas` (:110-112: `SELECT id, name FROM unit_kerja WHERE id = ANY(${textArraySql(ids)}) ORDER BY name`), with `textArraySql` from `./rangkaian/sql-rows.js`.
     - P3 also has `berkasService.aksesBaru(executor, rangkaianId, units)` (:86-89, flag-aware through `loadJangkauan`). Use it for the "gains access" side of critic C-7 instead of a new diff helper.
2. **Lock order and retry (REQUIRED) [P5-T6-2] RECHECK-AFTER-P3.**
   - `putuskan` follows the order:
     1. `SELECT rangkaian_id FROM rangkaian_koreksi_berkas WHERE id = ${koreksiId}` (no lock).
     2. `lockBerkas(tx, rangkaianId)`.
     3. `SELECT * FROM rangkaian_koreksi_berkas WHERE id = ${koreksiId} FOR UPDATE`.
     4. Re-check `status`, `rangkaian_id` and the self-approval rule.

     The `tolak` branch also locks R first, for one uniform order.
   - Wrap both service bodies: `return denganRetryDeadlock(() => db.transaction(async (tx) => { … }))`. In `ajukan`, keep `try { … } catch (error) { if (hasPostgresErrorCode(error, '23505', 'rangkaian_koreksi_berkas_terbuka_uidx')) throw new ConflictError(…); throw error; }` around the wrapper, not inside it.
   - Add a unit test with the same mock pattern as P3 C-4: the first `db.transaction` rejects with `{ cause: { code: '40P01' } }` and the second resolves.
3. **Access delta (REQUIRED) [P5-T6-3].**
   - In `putuskan` (setuju), compute `const sebelum = await berkasService.unitDalamJangkauanBerkas(tx, rangkaianId)` together with the current pengolah, before the UPDATE.
   - After the UPDATE, set `unitKehilanganAkses` = `[koreksi.unit_pengolah_lama]` when that unit is no longer pengolah and is not in `sebelum` (the non-pengolah jangkauan). Otherwise set it to `[]`.
   - Add `unitKehilanganAkses` to the audit `changes` and to the `daftar` DTO of each koreksi.
   - Task 9 shows it in the confirmation step.
   - Test: correcting pengolah from `dir_bppt` to `dir_ptep` on the fixture (where `dir_bppt` is also a disposisi target) gives `unitKehilanganAkses: []`.
   - **(delta P3) Confirmed.**
     - `denganRetryDeadlock<T>(run, percobaan = 3)` (`utils/deadlock-retry.ts:15-23`) retries on 40P01 and 40001 through `hasPostgresErrorCode`, which walks `.cause`. It turns exhaustion into `ConflictError(PESAN_KONFLIK_BERSAMAAN)` (409). `run` must open its own `db.transaction` (doc :11-13).
     - The `{ cause: { code: '40P01' } }` mock pattern matches.
     - P3's own Berkas paths lock anggota SMs before R (`kunci`, `berkas.service.ts:52-62`). A Koreksi on a `diberkaskan` berkas holds only R and K. Membership is frozen by 0046, and no P3 path holds R and then waits on K, so R → K is cycle-free without the SM pre-lock.
4. **Suite speed (ADVISORY) [P5-T1-8].** Build the PGlite database in `beforeAll` and reset only the `rangkaian_koreksi_berkas` rows and the berkas row per test.
5. **(delta P3) Authorization before state (ADVISORY; P3 access carry-forward 8: "T14 `kunci` 409-before-auth race; Koreksi Berkas path").**
   - In `putuskan`, after the locks, check in this order:
     1. existence of the koreksi, else 404;
     2. the self-approval rule (maker ≠ checker), else 403;
     3. `status === 'diajukan'` and `rangkaian_id` unchanged, else 409.

     The route-level `roleMiddleware(['super_admin'])` runs before the service.
   - The P3 race (a 409 on a membership change reported before `assertPeran`) cannot occur on the Koreksi path: a `diberkaskan` berkas has frozen membership (0046 `rangkaian_guard_closed`). Record this in the Self-Review.


**C-7 (critic) — Task 6: audit the real access delta — REQUIRED (spec:740) [P5-C-7]**


- P5-T6-3 derives `unitKehilanganAkses` from `unitDalamJangkauanBerkas`. That set omits the pengolah branch and the active peserta, which count when the flag is on.
- Real jangkauan is `jangkauanUnitsSql` (`visibility-spec.ts:122-137`): pencatat, pengolah, anggota units, non-rejected targets, plus active peserta when the flag is on.
- An old pengolah that is also a peserta keeps its access, yet the amendment reports it as lost.
- Binding:
  - In `putuskan` (setuju), in the same transaction, capture `const sebelum = await loadJangkauan(tx, rangkaianId)` (real P3 `deps.ts`, flag-aware) before the UPDATE and `sesudah` after it.
  - Set `unitKehilanganAkses = sebelum − sesudah` and `unitMendapatAkses = sesudah − sebelum`. The latter is expected to be `[]` because P5-T6-1 restricts the new pengolah; assert it.
  - Both go into the audit `changes` and the confirmation step.
- Tests:
  - Keep the fixture test: `dir_bppt` is a target, so the result is `[]`.
  - Add one where the old pengolah is not otherwise in jangkauan, giving `[old]`.



### Task 7: Service Tutup massal data lama

**Files:**
- Create: `backend/src/services/rangkaian-data-lama.service.ts`
- Test: `backend/src/__tests__/rangkaian-data-lama.service.test.ts`

**Interfaces:**
- Consumes (P3): `isPengawas(user, executor?)` di `backend/src/services/rangkaian/deps.ts` (adapter tunggal P3 atas `resolveKonteksBaca(...).pengawas` P2 di `visibility-spec.ts`: pengawas = role FULL_ADMIN non-super_admin + unit efektif `is_unit_pengawas`; super_admin ditangani terpisah oleh pemanggil); (P1) CHECK `rangkaian_berkas_check`, trigger `rangkaian_guard_closed`; `auditLogService.logActionOrThrow`.
- Produces: `default export rangkaianDataLamaService` dengan `ringkasan(actor)` → `{ dapatMenutup: boolean; perTahun: Array<{ tahun: number; jumlah: number }> }` dan `tutupMassal(actor, filter, auditContext?)` → `{ jumlah, tanpaKlasifikasi, contoh, contohTanpaKlasifikasi, terpotong, diterapkan }`; tipe `TutupMassalFilter`.

- [ ] **Step 1: Verifikasi `isPengawas` (P3)**

Run: `rg -n "export (async )?function isPengawas" backend/src/services/rangkaian/deps.ts`
Expected: satu hit. Bila tidak ada, hentikan (P3 Task 1 wajib menyediakan `isPengawas` di atas `resolveKonteksBaca` P2, spec §11 unit test). Jangan membuat salinan di `record-access.service.ts`.

- [ ] **Step 2: Tulis test yang gagal**

```ts
// backend/src/__tests__/rangkaian-data-lama.service.test.ts
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRangkaianTestDatabase, P5_IDS, seedRangkaianBase } from './helpers/rangkaian-p5-pglite.js';

const holder = vi.hoisted(() => ({ db: null as any, audit: vi.fn() }));
vi.mock('../config/database.js', () => ({
    db: {
        select: (...args: any[]) => holder.db.select(...args),
        execute: (query: any) => holder.db.execute(query),
        transaction: (run: any) => holder.db.transaction(run),
    },
}));
vi.mock('../services/audit-log.service.js', () => ({ default: { logActionOrThrow: holder.audit } }));

const superA = { id: P5_IDS.superA, email: 'super-a@example.test', role: 'super_admin', unitKerjaId: null };
const tu = { id: P5_IDS.tu, email: 'tu@example.test', role: 'admin_unit', unitKerjaId: 'sesditjen' };
const bppt = { id: P5_IDS.bppt, email: 'bppt@example.test', role: 'admin_unit', unitKerjaId: 'dir_bppt' };
const id = (n: number) => `00000000-0000-4000-8000-0000000009${String(n).padStart(2, '0')}`;

let database: PGlite;
let klasA: number;
let klasB: number;
let service: typeof import('../services/rangkaian-data-lama.service.js').default;

beforeEach(async () => {
    database = await createRangkaianTestDatabase();
    ({ klasA, klasB } = await seedRangkaianBase(database));
    const rs = (n: number, tahun: number, asal: string, status: string, pengolah: string | null, klasSm: number | null) => `
        INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal, klasifikasi_item_id)
        VALUES ('${id(n)}', 'ditjen', ${n}, ${tahun}, 'L-${n}', 'Lama ${n}', ${klasSm ?? 'NULL'});
        INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, unit_pengolah_id, judul, tahun, selesai_at)
        VALUES ('${id(50 + n)}', 'RS-${tahun}-7000${n}', '${asal}', '${status}', 'ditjen', ${pengolah ? `'${pengolah}'` : 'NULL'}, 'Lama ${n}', ${tahun},
                ${status === 'selesai' ? 'now()' : 'NULL'});
        INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber)
        VALUES ('${id(50 + n)}', '${id(n)}', 'ditjen', 'induk', 'data_lama');`;
    await database.exec([
        rs(1, 2022, 'data_lama', 'selesai', 'dir_bppt', klasA),
        rs(2, 2022, 'data_lama', 'selesai', null, null),
        rs(3, 2023, 'data_lama', 'selesai', null, klasA),
        rs(4, 2023, 'data_lama', 'aktif', null, klasA),
        rs(5, 2023, 'surat_masuk', 'selesai', null, klasA),
    ].join('\n'));
    holder.db = drizzle(database);
    holder.audit.mockReset();
    service = (await import('../services/rangkaian-data-lama.service.js')).default;
}, 180_000);
afterEach(async () => { await database?.close(); });

const status = async () => (await database.query<any>(`
    SELECT kode, status, unit_pengolah_id, klasifikasi_item_id FROM rangkaian_surat ORDER BY kode`)).rows;

describe('Tutup massal data lama', () => {
    it('ringkasan hanya mengizinkan super_admin dan admin pengawas', async () => {
        expect(await service.ringkasan(superA)).toEqual({ dapatMenutup: true, perTahun: [{ tahun: 2022, jumlah: 2 }, { tahun: 2023, jumlah: 1 }] });
        expect((await service.ringkasan(tu)).dapatMenutup).toBe(true);
        expect(await service.ringkasan(bppt)).toEqual({ dapatMenutup: false, perTahun: [] });
        await expect(service.tutupMassal(bppt, { dryRun: true })).rejects.toMatchObject({ statusCode: 403 });
    });

    it('pratinjau tidak mengubah apa pun dan memisahkan rangkaian tanpa klasifikasi', async () => {
        const before = await status();
        const preview = await service.tutupMassal(superA, { dryRun: true });
        expect(preview).toMatchObject({ jumlah: 2, tanpaKlasifikasi: 1, contoh: ['RS-2022-70001', 'RS-2023-70003'], contohTanpaKlasifikasi: ['RS-2022-70002'], terpotong: false, diterapkan: 0 });
        expect(await status()).toEqual(before);
        expect(holder.audit).not.toHaveBeenCalled();
    });

    it('menerapkan hanya bila expectedCount cocok dengan pratinjau', async () => {
        await expect(service.tutupMassal(superA, { dryRun: false, konfirmasi: true, expectedCount: 5 }))
            .rejects.toMatchObject({ statusCode: 409 });
        const hasil = await service.tutupMassal(tu, { dryRun: false, konfirmasi: true, expectedCount: 2 });
        expect(hasil.diterapkan).toBe(2);
        expect(await status()).toEqual([
            { kode: 'RS-2022-70001', status: 'diberkaskan', unit_pengolah_id: 'dir_bppt', klasifikasi_item_id: klasA },
            { kode: 'RS-2022-70002', status: 'selesai', unit_pengolah_id: null, klasifikasi_item_id: null },
            { kode: 'RS-2023-70003', status: 'diberkaskan', unit_pengolah_id: 'ditjen', klasifikasi_item_id: klasA },
            { kode: 'RS-2023-70004', status: 'aktif', unit_pengolah_id: null, klasifikasi_item_id: null },
            { kode: 'RS-2023-70005', status: 'selesai', unit_pengolah_id: null, klasifikasi_item_id: null },
        ]);
        expect(holder.audit).toHaveBeenCalledTimes(2);
        expect(holder.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'status_change', entityType: 'rangkaian_surat' }), expect.anything());
    });

    it('klasifikasi pengganti dan filter tahun diterapkan pada kandidat yang tepat', async () => {
        const preview = await service.tutupMassal(superA, { dryRun: true, tahun: 2022, klasifikasiItemId: klasB });
        expect(preview).toMatchObject({ jumlah: 2, tanpaKlasifikasi: 0 });
        await service.tutupMassal(superA, { dryRun: false, konfirmasi: true, expectedCount: 2, tahun: 2022, klasifikasiItemId: klasB });
        expect((await status()).filter((row) => row.kode.startsWith('RS-2022')).map((row) => row.klasifikasi_item_id)).toEqual([klasB, klasB]);
    });
});
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `npm --prefix backend exec -- vitest run src/__tests__/rangkaian-data-lama.service.test.ts`
Expected: FAIL — `Cannot find module '../services/rangkaian-data-lama.service.js'`.

- [ ] **Step 4: Implementasi minimal**

```ts
// backend/src/services/rangkaian-data-lama.service.ts
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../config/database.js';
import auditLogService, { type CriticalAuditContext } from './audit-log.service.js';
import { isPengawas } from './rangkaian/deps.js';
import { ConflictError, ForbiddenError } from '../utils/errors.js';

export interface DataLamaActor { id: string; email: string; role: string; unitKerjaId: string | null }
export interface TutupMassalFilter {
    tahun?: number;
    unitPencatatId?: string;
    klasifikasiItemId?: number;
    dryRun: boolean;
    konfirmasi?: true;
    expectedCount?: number;
}

const MAKS_PER_PANGGILAN = 500;
type Executor = { execute: (query: SQL) => Promise<unknown> };
interface Kandidat { id: string; kode: string; unit_pengolah_final: string; klasifikasi_final: number | null }

async function rows<T>(executor: Executor, query: SQL): Promise<T[]> {
    const result = await executor.execute(query) as { rows?: T[] } | T[];
    return Array.isArray(result) ? result : (result.rows ?? []);
}

async function dapatMenutup(actor: DataLamaActor): Promise<boolean> {
    if (actor.role === 'super_admin') return true;
    return isPengawas(actor, db);
}

export const rangkaianDataLamaService = {
    async ringkasan(actor: DataLamaActor) {
        if (!(await dapatMenutup(actor))) return { dapatMenutup: false, perTahun: [] };
        const perTahun = await rows<{ tahun: number; jumlah: number }>(db, sql`
            SELECT tahun, count(*)::int AS jumlah FROM rangkaian_surat
             WHERE asal = 'data_lama' AND status = 'selesai'
             GROUP BY tahun ORDER BY tahun`);
        return { dapatMenutup: true, perTahun: perTahun.map((row) => ({ tahun: Number(row.tahun), jumlah: Number(row.jumlah) })) };
    },

    async tutupMassal(actor: DataLamaActor, filter: TutupMassalFilter, auditContext?: CriticalAuditContext) {
        if (!(await dapatMenutup(actor))) {
            throw new ForbiddenError('Tutup massal data lama hanya untuk super_admin atau admin unit pengawas.');
        }
        return db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('simsa:tutup-massal-data-lama', 0))`);
            const kandidat = await rows<Kandidat>(tx, sql`
                SELECT rs.id, rs.kode,
                       coalesce(rs.unit_pengolah_id, rs.unit_pencatat_id) AS unit_pengolah_final,
                       coalesce(${filter.klasifikasiItemId ?? null}::int, rs.klasifikasi_item_id, sm.klasifikasi_item_id) AS klasifikasi_final
                  FROM rangkaian_surat rs
                  JOIN rangkaian_anggota ra ON ra.rangkaian_id = rs.id AND ra.peran = 'induk'
                  LEFT JOIN surat_masuk sm ON sm.id = ra.surat_masuk_id
                 WHERE rs.asal = 'data_lama' AND rs.status = 'selesai'
                   AND (${filter.tahun ?? null}::int IS NULL OR rs.tahun = ${filter.tahun ?? null}::int)
                   AND (${filter.unitPencatatId ?? null}::varchar IS NULL OR rs.unit_pencatat_id = ${filter.unitPencatatId ?? null}::varchar)
                   AND NOT EXISTS (SELECT 1 FROM surat_distributions d
                                    WHERE d.rangkaian_id = rs.id AND d.status IN ('sent', 'received'))
                   AND NOT EXISTS (SELECT 1 FROM rangkaian_anggota a2 JOIN surat_keluar sk ON sk.id = a2.surat_keluar_id
                                    WHERE a2.rangkaian_id = rs.id AND sk.is_deleted IS NOT TRUE
                                      AND sk.approval_status IN ('draft', 'pending', 'rejected'))
                 ORDER BY rs.tahun, rs.kode
                 LIMIT ${MAKS_PER_PANGGILAN + 1}
                 FOR UPDATE OF rs`);
            const terpotong = kandidat.length > MAKS_PER_PANGGILAN;
            const dipilih = kandidat.slice(0, MAKS_PER_PANGGILAN);
            const siap = dipilih.filter((row) => row.klasifikasi_final !== null);
            const tanpaKlasifikasi = dipilih.filter((row) => row.klasifikasi_final === null).map((row) => row.kode);
            const pratinjau = {
                jumlah: siap.length,
                tanpaKlasifikasi: tanpaKlasifikasi.length,
                contoh: siap.slice(0, 10).map((row) => row.kode),
                contohTanpaKlasifikasi: tanpaKlasifikasi.slice(0, 10),
                terpotong,
            };
            if (filter.dryRun) return { ...pratinjau, diterapkan: 0 };
            if (filter.konfirmasi !== true || filter.expectedCount !== siap.length) {
                throw new ConflictError('Jumlah rangkaian berubah sejak pratinjau; ulangi pratinjau sebelum menutup massal.');
            }
            for (const row of siap) {
                await tx.execute(sql`
                    UPDATE rangkaian_surat
                       SET status = 'diberkaskan', unit_pengolah_id = ${row.unit_pengolah_final},
                           klasifikasi_item_id = ${Number(row.klasifikasi_final)},
                           diberkaskan_at = now(), diberkaskan_by = ${actor.id}, updated_at = now()
                     WHERE id = ${row.id} AND status = 'selesai' AND asal = 'data_lama'`);
                await auditLogService.logActionOrThrow({
                    userId: actor.id, userEmail: actor.email, ipAddress: auditContext?.ipAddress,
                    action: 'status_change', entityType: 'rangkaian_surat', entityId: row.id,
                    changes: {
                        status: { from: 'selesai', to: 'diberkaskan' }, tutupMassalDataLama: true,
                        unitPengolahId: row.unit_pengolah_final, klasifikasiItemId: Number(row.klasifikasi_final),
                    },
                }, tx);
            }
            return { ...pratinjau, diterapkan: siap.length };
        });
    },
};

export default rangkaianDataLamaService;
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `npm --prefix backend exec -- vitest run src/__tests__/rangkaian-data-lama.service.test.ts`
Expected: PASS (4 test).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/rangkaian-data-lama.service.ts backend/src/__tests__/rangkaian-data-lama.service.test.ts
git commit -m "feat(rangkaian): previewed bulk filing of legacy rangkaian for supervisors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


#### Amandemen pra-eksekusi Task 7 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p5-data-lama-pelengkap/preflight-rulings.md`.


1. **Consumes (REQUIRED) [P5-G-3] RECHECK-AFTER-P3.** The Step 1 grep becomes:
   `rg -n "export (async )?function isPengawas|dalamCakupanPengawasSql|anggotaMemblokirSql|disposisiTerbukaSql|denganRetryDeadlock" backend/src/services/rangkaian/deps.ts`
   Expected: all five are present (P3 T1, C-7, T12-1, C-4).
   - **(delta P3) Confirmed** on real P3 @ b4d86fa at `deps.ts:87` (`export async function isPengawas`), :53, :42 and :60. The P5 lock-by-id pattern should reuse `lockRangkaian(tx, ids)` (`deps.ts:155-170`: one statement, `ORDER BY id FOR UPDATE`) instead of hand-writing it. The 422 message for an unknown klasifikasi in P3 is `AppError('Klasifikasi berkas tidak ditemukan', 422)` (`berkas.service.ts:195-196`); critic C-8 applies.
2. **Scope for pengawas (BLOCKING, security) [P5-T7-2].**
   - Import `dalamCakupanPengawasSql` from `./rangkaian/deps.js`.
   - Add a helper:
     ```ts
     const lingkupPengawas = (actor: DataLamaActor): SQL =>
         actor.role === 'super_admin' ? sql`true` : dalamCakupanPengawasSql(sql.raw('rs.unit_pencatat_id'));
     ```
   - In `ringkasan`, alias the table (`FROM rangkaian_surat rs`) and add `AND ${lingkupPengawas(actor)}`.
   - In the candidate query, add `AND ${lingkupPengawas(actor)}`.
3. **Fallback klasifikasi (BLOCKING, irreversible data) [P5-T7-1].**
   - Replace `coalesce(${filter.klasifikasiItemId ?? null}::int, rs.klasifikasi_item_id, sm.klasifikasi_item_id)` with `coalesce(rs.klasifikasi_item_id, sm.klasifikasi_item_id, ${filter.klasifikasiItemId ?? null}::int)`.
   - Before the transaction, add:
     ```ts
             if (filter.klasifikasiItemId !== undefined) {
                 const [ada] = await rows<{ id: number }>(db, sql`SELECT id FROM klasifikasi_arsip WHERE id = ${filter.klasifikasiItemId}`);
                 if (!ada) throw new ValidationError('Klasifikasi pengganti tidak ditemukan.');
             }
     ```
     Import `ValidationError` from `../utils/errors.js`. If klasifikasi items live in another table in the real schema, use the FK target table of `rangkaian_surat.klasifikasi_item_id`.
4. **Blockers from P3 (REQUIRED) [P5-T7-3] RECHECK-AFTER-P3.** Replace the two `AND NOT EXISTS (…)` blocks with `AND (${anggotaMemblokirSql(sql.raw('rs.id'))} + ${disposisiTerbukaSql(sql.raw('rs.id'))}) = 0`, imported from `./rangkaian/deps.js`.
   - **(delta P3) Confirmed, in flux.** At b4d86fa the builders use the inner aliases `a`, `k`, `r`, `d`, `sm` and `ma` (`rangkaian.service.ts:184-207`). The Tutup massal candidate query itself joins `sm` for the induk klasifikasi, so the argument must be exactly `sql.raw('rs.id')`: never `sm.*` and never an alias that the builders reuse.
   - Fix-wave C-M1 rewrites `disposisiTerbukaSql` as a sum of two counts (same semantics, same signature). Re-run the Task 7 suite on the post-fix tip.
5. **Lock by id, guarded update, retry (REQUIRED) [P5-T7-4] RECHECK-AFTER-P3.** Restructure `tutupMassal`:
   1. Select `id` of up to 501 candidates with the full predicate and no lock, `ORDER BY rs.tahun, rs.kode`.
   2. Lock with `SELECT id FROM rangkaian_surat WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`.
   3. Re-run the candidate SELECT (the same predicate plus `AND rs.id = ANY(${ids}::uuid[])`), `ORDER BY rs.tahun, rs.kode`, to get `kandidat` under the lock.
   4. For each UPDATE, take the result and audit only when one row changed (`rowCount === 1`, or `RETURNING id` has one row). Count `diterapkan` from the audited rows.
   5. Wrap the whole body: `return denganRetryDeadlock(() => db.transaction(async (tx) => { … }))`.

   The advisory lock stays.
6. **Test updates (BLOCKING / REQUIRED).**
   - In `'klasifikasi pengganti dan filter tahun diterapkan pada kandidat yang tepat'`, replace the last expectation with:
     ```ts
             // Fallback saja: rs1 memakai klasifikasi induk (klasA), rs2 tanpa klasifikasi memakai pengganti (klasB).
             expect((await status()).filter((row) => row.kode.startsWith('RS-2022')).map((row) => row.klasifikasi_item_id)).toEqual([klasA, klasB]);
     ```
   - Add:
     ```ts
         it('pengawas hanya menutup rangkaian yang pencatatnya dalam cakupannya', async () => {
             await database.exec(`
                 INSERT INTO unit_kerja (id, name, parent_id, unit_type, can_receive_distribution)
                 VALUES ('bagian_umum', 'Bagian Umum', 'sesditjen', 'bagian', false) ON CONFLICT (id) DO NOTHING;
                 INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal, klasifikasi_item_id)
                 VALUES ('${id(9)}', 'bagian_umum', 9, 2022, 'L-9', 'Lama bagian', ${klasA});
                 INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, judul, tahun, selesai_at)
                 VALUES ('${id(59)}', 'RS-2022-70009', 'data_lama', 'selesai', 'bagian_umum', 'Lama bagian', 2022, now());
                 INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber)
                 VALUES ('${id(59)}', '${id(9)}', 'bagian_umum', 'induk', 'data_lama');`);
             expect((await service.ringkasan(tu)).perTahun).toEqual([{ tahun: 2022, jumlah: 2 }, { tahun: 2023, jumlah: 1 }]);
             expect((await service.tutupMassal(tu, { dryRun: true })).contoh).not.toContain('RS-2022-70009');
             expect((await service.ringkasan(superA)).perTahun).toEqual([{ tahun: 2022, jumlah: 3 }, { tahun: 2023, jumlah: 1 }]);
             expect((await service.tutupMassal(superA, { dryRun: true })).contoh).toContain('RS-2022-70009');
         });

         it('klasifikasi pengganti yang tidak ada ditolak 400', async () => {
             await expect(service.tutupMassal(superA, { dryRun: true, klasifikasiItemId: 99_999_999 }))
                 .rejects.toMatchObject({ statusCode: 400 });
         });
     ```
   - Step 5 Expected: PASS (6 tests).
   - Also run `cd backend && npx tsc --noEmit -p tsconfig.json`.
7. **Suite speed (ADVISORY) [P5-T1-8].** Optionally build the PGlite database once in `beforeAll` and reset the fixture rows per test.


**C-2 (critic) — Tasks 4, 5, 7, 13: the deferred pengolah has no executable path — REQUIRED (spec:358; contradicts the "Cost if wrong" of P5-T5-1 and runbook step 8 of P5-T13-1) [P5-C-2]**


- **Ubah Unit Pengolah cannot apply it.** P3 `berkasService.ubahUnitPengolah` accepts only a unit in `unitDalamJangkauanBerkas` (P3:6591-6597). That set is the non-rejected distribution targets plus the anggota units (P3:6485-6492; spec §9).
  - `disposisi_lama` peserta are not in it.
  - A backfilled `data_lama` rangkaian has no distribution to its label units.
- **Koreksi Berkas cannot apply it either.** After P5-T6-1 it uses the same predicate and answers 422.
- So "through P3 Ubah Unit Pengolah or a Koreksi" (P5-T5-1) and runbook step 8 (P5-T13-1) cannot apply `calonUnitPengolah`.
- **(delta P3) Confirmed on real code.** `ubahUnitPengolah` refuses any unit outside `unitDalamJangkauanBerkas` with 422 "Disposisikan dulu ke unit ini" (`berkas.service.ts:217-224`). That set is the non-rejected distribution targets plus the live anggota units (:69-83), with no peserta branch. Ubah is also limited to `aktif`/`selesai` (:221).
- **Tutup massal then locks the choice in.** It files every `data_lama` rangkaian with `coalesce(rs.unit_pengolah_id, rs.unit_pencatat_id)` (P5:1844, 1878), and `diberkaskan` is terminal (`0046_rangkaian_surat.sql:331-346`). Spec:358 is thereby abandoned permanently and silently.
- Binding:
  1. **Two outcomes for release-gate row (a)** (P5-G-6):
     - "isi": apply the label-derived pengolah per spec:358, after the security owner signs `calon-pengolah.csv`;
     - "tidak": spec:358 is waived, and the berkas go to the pencatat.
  2. **A pengolah mode in the backfill script**, SHA-bound: either as an `--isi-pengolah` option of `--apply` (the chosen mode is part of the SHA payload), or as a separate later run `--isi-pengolah --approved-sha256=<sha>`. For each `calonPengolah` row (already in the Task 4 payload) whose rangkaian still has `asal='data_lama' AND status='selesai' AND unit_pengolah_id IS NULL`:
     - lock by id (`ORDER BY id FOR UPDATE`) and set `unit_pengolah_id`;
     - write one audit row: `action: 'update'`, `changes: { before: { unitPengolahId: null }, after: { unitPengolahId }, sumber: 'backfill-rangkaian-lama', aksesBaru: [unit] }`;
     - refuse on an SHA mismatch.

     Tests: S1 gets `dir_bppt`; a second run changes nothing; a `diberkaskan` row or one with a non-NULL pengolah is skipped.
  3. **Runbook order:** `--apply` → decision on gate (a) → pengolah mode if the decision is "isi" → only then Tutup massal of data lama.
     - The Task 10 UI copy and PANDUAN (P5:3165) state that Tutup massal files a berkas with no pengolah to the pencatat.
  4. **Access is not flag-controlled.** The runbook states that pengolah access is not controlled by the flag: after the pengolah mode runs, unsetting `RANGKAIAN_DISPOSISI_LAMA_READ` no longer revokes it (`visibility-spec.ts:130-131`).


**C-8 (critic) — Task 7: align with P3 and the real `deps.ts` — ADVISORY [P5-C-8]**


- **Status code.** For an unknown replacement klasifikasi, P3 `berkaskan` answers 422 `AppError('Klasifikasi berkas tidak ditemukan', 422)` (P3:6569-6570), while P5-T7-1 answers 400. Use the same 422 and message, and change the Task 7 test to `statusCode: 422`.
- **`dalamCakupanPengawasSql` import.** Real `deps.ts` (P3 @ ef08b69) does not yet re-export `dalamCakupanPengawasSql`, `anggotaMemblokirSql` or `disposisiTerbukaSql` (they land with P3 C-7/T12-1, P3:5541, 7630).
  - If `dalamCakupanPengawasSql` is still missing at Task 7 Step 1, import it from `./access/visibility-spec.js` (P2 export `:265`, as P4-T16 does) instead of stopping.
  - The P5-G-3 stop rule stays for the P3 blocker builders.
  - **(delta P3) Corrected.** Real merged P3 @ b4d86fa re-exports `dalamCakupanPengawasSql` (`deps.ts:53`) and both builders (`deps.ts:42`). Import all three from `./rangkaian/deps.js`; the fallback bullet above is moot. The 422 status and message are confirmed at `berkas.service.ts:195-196`.



### Task 8: Route berkas (Koreksi Berkas + Tutup massal), skema, mount, allowlist demo

**Files:**
- Create: `backend/src/validators/rangkaian-berkas.schemas.ts`
- Create: `backend/src/routes/rangkaian-berkas.routes.ts`
- Modify: `backend/src/app.ts` (sisipkan tepat sebelum baris `app.use('/api/rangkaian', rangkaianRoutes);` P2 Task 9, yaitu sesudah baris `rangkaianDaftarRoutes` P4 Task 6)
- Modify: `backend/src/middlewares/demo-access.middleware.ts` (daftar `ALLOWED_METADATA_ROUTES`, :45 dst.)
- Modify: `backend/src/__tests__/demo-access.middleware.test.ts`, `backend/src/__tests__/mutation-audit-policy.test.ts` (:39-57)
- Test: `backend/src/__tests__/rangkaian-berkas.routes.test.ts`

**Interfaces:**
- Consumes: `rangkaianKoreksiService` (Task 6), `rangkaianDataLamaService` (Task 7), `authMiddleware`, `roleMiddleware(['super_admin'])`, `canWriteMiddleware()`, `sensitiveLimiter`, `validateBody`, `validateIdParam`; mount P2 `app.use('/api/rangkaian', rangkaianRoutes)`.
- Produces: `GET /api/rangkaian/data-lama/ringkasan`, `POST /api/rangkaian/data-lama/tutup-massal`, `GET|POST /api/rangkaian/:id/koreksi-berkas`, `POST /api/rangkaian/koreksi-berkas/:koreksiId/putuskan`; skema `ajukanKoreksiBerkasSchema`, `putuskanKoreksiBerkasSchema`, `tutupMassalDataLamaSchema`.

- [ ] **Step 1: Tulis test yang gagal**

```ts
// backend/src/__tests__/rangkaian-berkas.routes.test.ts
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    user: { id: '550e8400-e29b-41d4-a716-446655440001', email: 'super@example.test', name: 'Super', role: 'super_admin', unitKerjaId: null as string | null },
    ajukan: vi.fn(), putuskan: vi.fn(), daftar: vi.fn(), ringkasan: vi.fn(), tutupMassal: vi.fn(),
}));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => { req.user = { ...mocks.user }; next(); },
}));
vi.mock('../middlewares/rate-limiter.middleware', () => ({ sensitiveLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/rangkaian-koreksi.service', () => ({
    default: { ajukan: mocks.ajukan, putuskan: mocks.putuskan, daftar: mocks.daftar },
}));
vi.mock('../services/rangkaian-data-lama.service', () => ({
    default: { ringkasan: mocks.ringkasan, tutupMassal: mocks.tutupMassal },
}));

import router from '../routes/rangkaian-berkas.routes';

const app = express();
app.use(express.json());
app.use('/api/rangkaian', router);
app.use((error: any, _req: any, res: any, _next: any) => res.status(error?.statusCode || 500).json({ error: error?.message }));

const RID = '550e8400-e29b-41d4-a716-446655440701';
const KID = '550e8400-e29b-41d4-a716-446655440801';

describe('rangkaian berkas routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.user.role = 'super_admin';
        mocks.user.unitKerjaId = null;
    });

    it('mengajukan koreksi berkas dengan konteks audit', async () => {
        mocks.ajukan.mockResolvedValue({ id: KID, status: 'pending' });
        const body = { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: 7, alasan: 'Salah pilih unit pengolah' };
        const response = await request(app).post(`/api/rangkaian/${RID}/koreksi-berkas`).send(body).expect(201);
        expect(response.body).toEqual({ success: true, data: { id: KID, status: 'pending' } });
        expect(mocks.ajukan).toHaveBeenCalledWith(expect.objectContaining({ id: mocks.user.id }), RID, body,
            expect.objectContaining({ userId: mocks.user.id, userEmail: mocks.user.email }));
    });

    it('menolak admin_unit, alasan pendek, dan id tidak valid', async () => {
        await request(app).post(`/api/rangkaian/${RID}/koreksi-berkas`).send({ unitPengolahBaru: 'dir_ptep', klasifikasiBaru: 7, alasan: 'pendek' }).expect(400);
        await request(app).post('/api/rangkaian/koreksi-berkas/bukan-uuid/putuskan').send({ keputusan: 'setuju' }).expect(400);
        await request(app).post(`/api/rangkaian/koreksi-berkas/${KID}/putuskan`).send({ keputusan: 'mungkin' }).expect(400);
        mocks.user.role = 'admin_unit';
        mocks.user.unitKerjaId = 'sesditjen';
        await request(app).post(`/api/rangkaian/${RID}/koreksi-berkas`).send({ unitPengolahBaru: 'dir_ptep', klasifikasiBaru: 7, alasan: 'Salah pilih unit pengolah' }).expect(403);
        await request(app).post(`/api/rangkaian/koreksi-berkas/${KID}/putuskan`).send({ keputusan: 'setuju' }).expect(403);
        expect(mocks.ajukan).not.toHaveBeenCalled();
        expect(mocks.putuskan).not.toHaveBeenCalled();
    });

    it('memutuskan koreksi dan membaca daftar koreksi', async () => {
        mocks.putuskan.mockResolvedValue({ id: KID, status: 'applied' });
        mocks.daftar.mockResolvedValue({ koreksi: [] });
        await request(app).post(`/api/rangkaian/koreksi-berkas/${KID}/putuskan`).send({ keputusan: 'setuju' }).expect(200);
        expect(mocks.putuskan).toHaveBeenCalledWith(expect.anything(), KID, { keputusan: 'setuju' }, expect.anything());
        await request(app).get(`/api/rangkaian/${RID}/koreksi-berkas`).expect(200);
        expect(mocks.daftar).toHaveBeenCalledWith(expect.anything(), RID);
    });

    it('tutup massal: penerapan wajib konfirmasi + expectedCount dan role baca-saja ditolak', async () => {
        mocks.tutupMassal.mockResolvedValue({ jumlah: 2, diterapkan: 0 });
        await request(app).post('/api/rangkaian/data-lama/tutup-massal').send({ dryRun: false }).expect(400);
        await request(app).post('/api/rangkaian/data-lama/tutup-massal').send({ dryRun: true, tahun: 2023 }).expect(200);
        expect(mocks.tutupMassal).toHaveBeenCalledWith(expect.anything(), { dryRun: true, tahun: 2023 }, expect.anything());
        mocks.user.role = 'staff';
        mocks.user.unitKerjaId = 'sesditjen';
        await request(app).post('/api/rangkaian/data-lama/tutup-massal').send({ dryRun: true }).expect(403);
    });

    it('ringkasan data lama tersedia sebagai GET tanpa efek samping', async () => {
        mocks.ringkasan.mockResolvedValue({ dapatMenutup: true, perTahun: [] });
        await request(app).get('/api/rangkaian/data-lama/ringkasan').expect(200);
        expect(mocks.tutupMassal).not.toHaveBeenCalled();
    });

    it('router berkas dipasang sebelum router rangkaian utama', () => {
        const source = fs.readFileSync(path.resolve(process.cwd(), 'src/app.ts'), 'utf8');
        const berkas = source.indexOf("app.use('/api/rangkaian', rangkaianBerkasRoutes)");
        const utama = source.indexOf("app.use('/api/rangkaian', rangkaianRoutes)");
        expect(berkas).toBeGreaterThan(-1);
        expect(utama).toBeGreaterThan(berkas);
    });
});
```

Tambahkan di `demo-access.middleware.test.ts` (dalam `describe('metadata-only demo API access')`):

```ts
    it.each([
        ['GET', '/api/rangkaian/data-lama/ringkasan'],
        ['POST', '/api/rangkaian/data-lama/tutup-massal'],
        ['GET', `/api/rangkaian/${id}/koreksi-berkas`],
        ['POST', `/api/rangkaian/${id}/koreksi-berkas`],
        ['POST', `/api/rangkaian/koreksi-berkas/${secondId}/putuskan`],
    ])('mengizinkan route berkas rangkaian P5 %s %s', async (method, url) => {
        const { app, downstream } = testApp(true);
        const call = method === 'GET' ? request(app).get(url) : request(app).post(url).send({ dryRun: true });
        expect((await call).status).toBe(200);
        expect(downstream.calls).toBe(1);
    });
```

Tambahkan `'services/rangkaian-koreksi.service.ts'` dan `'services/rangkaian-data-lama.service.ts'` ke array `transactionalServices` di `mutation-audit-policy.test.ts`.

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm --prefix backend exec -- vitest run src/__tests__/rangkaian-berkas.routes.test.ts src/__tests__/demo-access.middleware.test.ts src/__tests__/mutation-audit-policy.test.ts`
Expected: FAIL — `Cannot find module '../routes/rangkaian-berkas.routes'` dan demo route 403.

- [ ] **Step 3: Implementasi minimal**

```ts
// backend/src/validators/rangkaian-berkas.schemas.ts
import { z } from 'zod';

export const ajukanKoreksiBerkasSchema = z.object({
    unitPengolahBaru: z.string().trim().min(1).max(50),
    klasifikasiBaru: z.coerce.number().int().positive(),
    alasan: z.string().trim().min(10, 'Alasan minimal 10 karakter.').max(2000),
}).strict();

export const putuskanKoreksiBerkasSchema = z.object({
    keputusan: z.enum(['setuju', 'tolak']),
    catatan: z.string().trim().max(2000).optional(),
}).strict();

export const tutupMassalDataLamaSchema = z.object({
    tahun: z.coerce.number().int().min(1900).max(2100).optional(),
    unitPencatatId: z.string().trim().min(1).max(50).optional(),
    klasifikasiItemId: z.coerce.number().int().positive().optional(),
    dryRun: z.boolean().default(true),
    konfirmasi: z.literal(true).optional(),
    expectedCount: z.number().int().min(0).optional(),
}).strict().superRefine((value, ctx) => {
    if (!value.dryRun && (value.konfirmasi !== true || value.expectedCount === undefined)) {
        ctx.addIssue({ code: 'custom', message: 'Penerapan membutuhkan konfirmasi dan expectedCount dari pratinjau.' });
    }
});
```

```ts
// backend/src/routes/rangkaian-berkas.routes.ts
import { Router, type NextFunction, type Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middlewares/auth.middleware';
import { sensitiveLimiter } from '../middlewares/rate-limiter.middleware';
import { canWriteMiddleware, roleMiddleware } from '../middlewares/role.middleware';
import { validateBody, validateIdParam } from '../middlewares/validate.middleware';
import rangkaianKoreksiService from '../services/rangkaian-koreksi.service';
import rangkaianDataLamaService from '../services/rangkaian-data-lama.service';
import {
    ajukanKoreksiBerkasSchema,
    putuskanKoreksiBerkasSchema,
    tutupMassalDataLamaSchema,
} from '../validators/rangkaian-berkas.schemas';

// Auth dipasang per route (bukan router.use) karena router ini berbagi prefix
// /api/rangkaian dengan router P2; permintaan yang tidak cocok diteruskan tanpa
// verifikasi sesi ganda.
const router = Router();
const auditContext = (req: AuthRequest) => ({ userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip });

router.get('/data-lama/ringkasan', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        res.json({ success: true, data: await rangkaianDataLamaService.ringkasan(req.user!) });
    } catch (error) { next(error); }
});

router.post('/data-lama/tutup-massal', authMiddleware, canWriteMiddleware(), sensitiveLimiter,
    validateBody(tutupMassalDataLamaSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            res.json({ success: true, data: await rangkaianDataLamaService.tutupMassal(req.user!, req.body, auditContext(req)) });
        } catch (error) { next(error); }
    });

router.get('/:id/koreksi-berkas', authMiddleware, roleMiddleware(['super_admin']), validateIdParam(),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            res.json({ success: true, data: await rangkaianKoreksiService.daftar(req.user!, String(req.params.id)) });
        } catch (error) { next(error); }
    });

router.post('/:id/koreksi-berkas', authMiddleware, roleMiddleware(['super_admin']), sensitiveLimiter, validateIdParam(),
    validateBody(ajukanKoreksiBerkasSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const data = await rangkaianKoreksiService.ajukan(req.user!, String(req.params.id), req.body, auditContext(req));
            res.status(201).json({ success: true, data });
        } catch (error) { next(error); }
    });

router.post('/koreksi-berkas/:koreksiId/putuskan', authMiddleware, roleMiddleware(['super_admin']), sensitiveLimiter,
    validateIdParam('koreksiId'), validateBody(putuskanKoreksiBerkasSchema),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const data = await rangkaianKoreksiService.putuskan(req.user!, String(req.params.koreksiId), req.body, auditContext(req));
            res.json({ success: true, data });
        } catch (error) { next(error); }
    });

export default router;
```

Di `backend/src/app.ts`: tambahkan `import rangkaianBerkasRoutes from './routes/rangkaian-berkas.routes';` di blok impor route, lalu tepat **sebelum** baris P2 `app.use('/api/rangkaian', rangkaianRoutes);` sisipkan:

```ts
app.use('/api/rangkaian', rangkaianBerkasRoutes); // P5: Koreksi Berkas & Tutup massal data lama (sebelum router utama)
```

Urutan final yang diharapkan:

```ts
app.use('/api/rangkaian', rangkaianDaftarRoutes);  // P4 Task 6: hanya GET / (auth per-route)
app.use('/api/rangkaian', rangkaianBerkasRoutes);  // P5 Task 8: /data-lama/*, /:id/koreksi-berkas, /koreksi-berkas/:koreksiId/putuskan (auth per-route)
app.use('/api/rangkaian', rangkaianRoutes);        // P2 Task 9 (+P3): router.use(authMiddleware); /lacak, /tautan, ... sebelum /:id dan /by-surat
```

Di `demo-access.middleware.ts`, tambahkan dua entri di `ALLOWED_METADATA_ROUTES` (di samping entri rangkaian P3):

```ts
    { methods: GET, path: exact(`/rangkaian/(?:data-lama/ringkasan|${UUID}/koreksi-berkas)`) },
    { methods: POST, path: exact(`/rangkaian/(?:data-lama/tutup-massal|${UUID}/koreksi-berkas|koreksi-berkas/${UUID}/putuskan)`) },
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npm --prefix backend exec -- vitest run src/__tests__/rangkaian-berkas.routes.test.ts src/__tests__/demo-access.middleware.test.ts src/__tests__/mutation-audit-policy.test.ts`
Expected: PASS.
Run: `npm --prefix backend exec -- tsc --noEmit`
Expected: tanpa error.

- [ ] **Step 5: Commit**

```bash
git add backend/src/validators/rangkaian-berkas.schemas.ts backend/src/routes/rangkaian-berkas.routes.ts backend/src/app.ts backend/src/middlewares/demo-access.middleware.ts backend/src/__tests__/rangkaian-berkas.routes.test.ts backend/src/__tests__/demo-access.middleware.test.ts backend/src/__tests__/mutation-audit-policy.test.ts
git commit -m "feat(rangkaian): expose berkas correction and legacy bulk filing endpoints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


#### Amandemen pra-eksekusi Task 8 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p5-data-lama-pelengkap/preflight-rulings.md`.


1. **Mount anchor and order (REQUIRED) [P5-T8-1] RECHECK-AFTER-P4.**
   - In Files, replace "sesudah baris `rangkaianDaftarRoutes`" with "tepat sebelum `app.use('/api/rangkaian', rangkaianRoutes)`".
   - Replace the "Urutan final yang diharapkan" block with:
     ```ts
     app.use('/api/rangkaian', rangkaianDaftarRoutes);           // P4 Task 6
     app.use('/api/rangkaian', rangkaianPerluDilengkapiRoutes);  // P4 Task 18 (D7)
     app.use('/api/rangkaian', rangkaianBerkasRoutes);           // P5 Task 8
     app.use('/api/rangkaian', rangkaianRoutes);                 // P2/P3
     ```
   - The P5 source-order test also asserts `rangkaianPerluDilengkapiRoutes` < `rangkaianBerkasRoutes`.
2. **Write middleware (ADVISORY) [P5-T8-2].** On `POST /:id/koreksi-berkas` and `POST /koreksi-berkas/:koreksiId/putuskan`, insert `canWriteMiddleware()` directly after `authMiddleware`. Expected responses are unchanged, because super_admin passes.
3. **Commands (BLOCKING) [P5-G-1].** Use the `cd backend && npx vitest run …` form. The existing `mutation-audit-policy.test.ts` resolves `src/` from `process.cwd()`.



### Task 9: UI Koreksi Berkas (maker-checker) di panel Alur Surat

**Files:**
- Modify: `frontend/src/services/rangkaian.service.js` (objek `rangkaianService` dari P3)
- Create: `frontend/src/services/rangkaian.service.p5.test.js`
- Create: `frontend/src/components/surat/KoreksiBerkasSection.jsx`
- Create: `frontend/src/components/surat/KoreksiBerkasSection.test.jsx`
- Modify: `frontend/src/components/surat/AlurSuratPanel.jsx` (P2) dan setiap test yang me-render panel itu

**Interfaces:**
- Consumes (P3): `rangkaianService` (export bernama) di `frontend/src/services/rangkaian.service.js`; (P2) `AlurSuratPanel.jsx` dengan objek `rangkaian` berisi `id`, `status`; `useAuth` (`@/context/AuthContext`), `KlasifikasiPicker` (`onChange(kode, item)`), komponen UI `Button`, `Label`, `Textarea`.
- Produces: `rangkaianService.getKoreksiBerkas(rangkaianId)`, `.ajukanKoreksiBerkas(rangkaianId, payload)`, `.putuskanKoreksiBerkas(koreksiId, payload)`, `.getRingkasanDataLama()`, `.tutupMassalDataLama(payload)`; komponen default `KoreksiBerkasSection({ rangkaianId, status })`.

- [ ] **Step 1: Tulis test yang gagal**

```js
// frontend/src/services/rangkaian.service.p5.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('./api', () => ({ default: apiMock, api: apiMock }))
const { rangkaianService } = await import('./rangkaian.service')

describe('rangkaianService P5 contracts', () => {
    beforeEach(() => {
        apiMock.get.mockReset().mockResolvedValue({ data: { ok: true } })
        apiMock.post.mockReset().mockResolvedValue({ data: { ok: true } })
    })

    it('memanggil endpoint Koreksi Berkas dan Tutup massal yang tepat', async () => {
        await rangkaianService.getKoreksiBerkas('r 1')
        await rangkaianService.ajukanKoreksiBerkas('r1', { alasan: 'x' })
        await rangkaianService.putuskanKoreksiBerkas('k1', { keputusan: 'setuju' })
        await rangkaianService.getRingkasanDataLama()
        expect(await rangkaianService.tutupMassalDataLama({ dryRun: true })).toEqual({ ok: true })
        expect(apiMock.get.mock.calls).toEqual([['/api/rangkaian/r%201/koreksi-berkas'], ['/api/rangkaian/data-lama/ringkasan']])
        expect(apiMock.post.mock.calls).toEqual([
            ['/api/rangkaian/r1/koreksi-berkas', { alasan: 'x' }],
            ['/api/rangkaian/koreksi-berkas/k1/putuskan', { keputusan: 'setuju' }],
            ['/api/rangkaian/data-lama/tutup-massal', { dryRun: true }],
        ])
    })
})
```

```jsx
// frontend/src/components/surat/KoreksiBerkasSection.test.jsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import KoreksiBerkasSection from './KoreksiBerkasSection'

const mocks = vi.hoisted(() => ({
    user: { id: 'super-b', role: 'super_admin' },
    getKoreksiBerkas: vi.fn(), ajukanKoreksiBerkas: vi.fn(), putuskanKoreksiBerkas: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('@/services/rangkaian.service', () => ({
    rangkaianService: {
        getKoreksiBerkas: mocks.getKoreksiBerkas,
        ajukanKoreksiBerkas: mocks.ajukanKoreksiBerkas,
        putuskanKoreksiBerkas: mocks.putuskanKoreksiBerkas,
    },
}))
vi.mock('@/components/KlasifikasiPicker', () => ({
    KlasifikasiPicker: ({ onChange, id }) => (
        <button type="button" id={id} onClick={() => onChange('KU.02', { id: 7, kode: 'KU.02' })}>Pilih KU.02</button>
    ),
}))

const dataKosong = {
    rangkaian: { id: 'r1', kode: 'RS-2026-000001', status: 'diberkaskan', unitPengolahId: 'dir_bppt', klasifikasiItemId: 3 },
    dapatMengajukan: true,
    kandidatUnit: [{ id: 'dir_bppt', name: 'Dit. BPPT' }, { id: 'dir_ptep', name: 'Dit. PTEP' }],
    koreksi: [],
}

describe('KoreksiBerkasSection', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.user = { id: 'super-b', role: 'super_admin' }
    })
    afterEach(cleanup)

    it('tidak tampil untuk admin_unit atau rangkaian yang belum diberkaskan', () => {
        mocks.user = { id: 'u1', role: 'admin_unit' }
        const { container, rerender } = render(<KoreksiBerkasSection rangkaianId="r1" status="diberkaskan" />)
        expect(container).toBeEmptyDOMElement()
        mocks.user = { id: 'super-b', role: 'super_admin' }
        rerender(<KoreksiBerkasSection rangkaianId="r1" status="selesai" />)
        expect(container).toBeEmptyDOMElement()
        expect(mocks.getKoreksiBerkas).not.toHaveBeenCalled()
    })

    it('mengajukan koreksi lewat konfirmasi dua langkah', async () => {
        mocks.getKoreksiBerkas.mockResolvedValue(dataKosong)
        mocks.ajukanKoreksiBerkas.mockResolvedValue({ id: 'k1', status: 'pending' })
        render(<KoreksiBerkasSection rangkaianId="r1" status="diberkaskan" />)
        fireEvent.change(await screen.findByLabelText('Unit pengolah baru'), { target: { value: 'dir_ptep' } })
        fireEvent.click(screen.getByRole('button', { name: 'Pilih KU.02' }))
        const lanjut = screen.getByRole('button', { name: 'Lanjutkan' })
        fireEvent.change(screen.getByLabelText('Alasan koreksi'), { target: { value: 'pendek' } })
        expect(lanjut).toBeDisabled()
        fireEvent.change(screen.getByLabelText('Alasan koreksi'), { target: { value: 'Salah pilih unit pengolah' } })
        fireEvent.click(lanjut)
        expect(screen.getByText(/dir_bppt → dir_ptep/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Ajukan Koreksi Berkas' }))
        await waitFor(() => expect(mocks.ajukanKoreksiBerkas).toHaveBeenCalledWith('r1', {
            unitPengolahBaru: 'dir_ptep', klasifikasiBaru: 7, alasan: 'Salah pilih unit pengolah',
        }))
        expect(mocks.getKoreksiBerkas).toHaveBeenCalledTimes(2)
    })

    it('hanya super_admin lain yang melihat tombol Setujui/Tolak', async () => {
        mocks.getKoreksiBerkas.mockResolvedValue({
            ...dataKosong,
            dapatMengajukan: false,
            koreksi: [
                { id: 'k1', status: 'pending', unitPengolahLama: 'dir_bppt', unitPengolahBaru: 'dir_ptep', klasifikasiLama: 3, klasifikasiBaru: 7, alasan: 'Salah pilih unit pengolah', dapatDiputuskan: true },
                { id: 'k0', status: 'denied', unitPengolahLama: 'dir_bppt', unitPengolahBaru: 'sesditjen', klasifikasiLama: 3, klasifikasiBaru: 3, alasan: 'Percobaan sebelumnya', dapatDiputuskan: false },
            ],
        })
        mocks.putuskanKoreksiBerkas.mockResolvedValue({ id: 'k1', status: 'applied' })
        render(<KoreksiBerkasSection rangkaianId="r1" status="diberkaskan" />)
        expect(await screen.findByText('Ditolak')).toBeInTheDocument()
        expect(screen.getAllByRole('button', { name: 'Setujui' })).toHaveLength(1)
        fireEvent.click(screen.getByRole('button', { name: 'Setujui' }))
        fireEvent.click(screen.getByRole('button', { name: 'Ya, terapkan koreksi' }))
        await waitFor(() => expect(mocks.putuskanKoreksiBerkas).toHaveBeenCalledWith('k1', { keputusan: 'setuju' }))
    })
})
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm --prefix frontend exec -- vitest run src/services/rangkaian.service.p5.test.js src/components/surat/KoreksiBerkasSection.test.jsx`
Expected: FAIL — `rangkaianService.getKoreksiBerkas is not a function` dan `Failed to resolve import "./KoreksiBerkasSection"`.

- [ ] **Step 3: Implementasi minimal**

Tambahkan properti berikut ke objek `rangkaianService` di `frontend/src/services/rangkaian.service.js`:

```js
    async getKoreksiBerkas(rangkaianId) {
        const response = await api.get(`/api/rangkaian/${encodeURIComponent(rangkaianId)}/koreksi-berkas`)
        return response.data
    },
    async ajukanKoreksiBerkas(rangkaianId, payload) {
        const response = await api.post(`/api/rangkaian/${encodeURIComponent(rangkaianId)}/koreksi-berkas`, payload)
        return response.data
    },
    async putuskanKoreksiBerkas(koreksiId, payload) {
        const response = await api.post(`/api/rangkaian/koreksi-berkas/${encodeURIComponent(koreksiId)}/putuskan`, payload)
        return response.data
    },
    async getRingkasanDataLama() {
        const response = await api.get('/api/rangkaian/data-lama/ringkasan')
        return response.data
    },
    async tutupMassalDataLama(payload) {
        const response = await api.post('/api/rangkaian/data-lama/tutup-massal', payload)
        return response.data
    },
```

```jsx
// frontend/src/components/surat/KoreksiBerkasSection.jsx
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { KlasifikasiPicker } from '@/components/KlasifikasiPicker'
import { useAuth } from '@/context/AuthContext'
import { rangkaianService } from '@/services/rangkaian.service'

const STATUS_LABEL = { pending: 'Menunggu keputusan', approved: 'Disetujui', applied: 'Diterapkan', denied: 'Ditolak' }
const FORM_AWAL = { unitPengolahBaru: '', klasifikasiBaru: null, klasifikasiKode: '', alasan: '' }

export default function KoreksiBerkasSection({ rangkaianId, status }) {
    const { user } = useAuth()
    const aktif = user?.role === 'super_admin' && status === 'diberkaskan'
    const [data, setData] = useState(null)
    const [error, setError] = useState('')
    const [form, setForm] = useState(FORM_AWAL)
    const [konfirmasi, setKonfirmasi] = useState(false)
    const [akanDisetujui, setAkanDisetujui] = useState(null)
    const [busy, setBusy] = useState(false)

    const muat = useCallback(async () => {
        try {
            const hasil = await rangkaianService.getKoreksiBerkas(rangkaianId)
            setData(hasil)
            setForm(prev => ({ ...prev, unitPengolahBaru: prev.unitPengolahBaru || hasil.rangkaian.unitPengolahId || '' }))
            setError('')
        } catch (err) {
            setError(err?.message || 'Koreksi Berkas belum dapat dimuat.')
        }
    }, [rangkaianId])

    useEffect(() => { if (aktif) muat() }, [aktif, muat])

    if (!aktif) return null
    if (!data) return error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null

    const lama = data.rangkaian
    const unitBaru = form.unitPengolahBaru || lama.unitPengolahId
    const klasBaru = form.klasifikasiBaru ?? lama.klasifikasiItemId
    const berubah = unitBaru !== lama.unitPengolahId || klasBaru !== lama.klasifikasiItemId
    const siap = berubah && form.alasan.trim().length >= 10

    const kirim = async (aksi) => {
        setBusy(true)
        try {
            await aksi()
            setForm(FORM_AWAL)
            setKonfirmasi(false)
            setAkanDisetujui(null)
            await muat()
        } catch (err) {
            setError(err?.message || 'Permintaan gagal.')
        } finally {
            setBusy(false)
        }
    }

    return (
        <section aria-labelledby="koreksi-berkas-judul" className="space-y-3 rounded-md border p-3">
            <h3 id="koreksi-berkas-judul" className="text-sm font-semibold">Koreksi Berkas</h3>
            <p className="text-xs text-muted-foreground">
                Status diberkaskan tidak dapat dibuka kembali. Koreksi unit pengolah atau klasifikasi diajukan satu super_admin
                dan diputuskan super_admin lain.
            </p>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            {data.koreksi.length > 0 && (
                <ul className="space-y-2">
                    {data.koreksi.map(item => (
                        <li key={item.id} className="rounded border p-2 text-sm">
                            <div className="font-medium">{STATUS_LABEL[item.status] || item.status}</div>
                            <div>Unit pengolah: {item.unitPengolahLama} → {item.unitPengolahBaru}</div>
                            <div>Klasifikasi: {item.klasifikasiLama} → {item.klasifikasiBaru}</div>
                            <div className="text-muted-foreground">Alasan: {item.alasan}</div>
                            {item.dapatDiputuskan && (akanDisetujui === item.id ? (
                                <div className="mt-2 flex gap-2">
                                    <Button size="sm" disabled={busy}
                                        onClick={() => kirim(() => rangkaianService.putuskanKoreksiBerkas(item.id, { keputusan: 'setuju' }))}>
                                        Ya, terapkan koreksi
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => setAkanDisetujui(null)}>Batal</Button>
                                </div>
                            ) : (
                                <div className="mt-2 flex gap-2">
                                    <Button size="sm" disabled={busy} onClick={() => setAkanDisetujui(item.id)}>Setujui</Button>
                                    <Button size="sm" variant="outline" disabled={busy}
                                        onClick={() => kirim(() => rangkaianService.putuskanKoreksiBerkas(item.id, { keputusan: 'tolak' }))}>
                                        Tolak
                                    </Button>
                                </div>
                            ))}
                        </li>
                    ))}
                </ul>
            )}

            {data.dapatMengajukan && (konfirmasi ? (
                <div className="space-y-2 text-sm">
                    <p>Unit pengolah: {lama.unitPengolahId} → {unitBaru}</p>
                    <p>Klasifikasi: {lama.klasifikasiItemId} → {klasBaru}{form.klasifikasiKode ? ` (${form.klasifikasiKode})` : ''}</p>
                    <p className="text-muted-foreground">Keduanya menentukan retensi. Periksa kembali sebelum mengajukan.</p>
                    <div className="flex gap-2">
                        <Button disabled={busy} onClick={() => kirim(() => rangkaianService.ajukanKoreksiBerkas(rangkaianId, {
                            unitPengolahBaru: unitBaru, klasifikasiBaru: klasBaru, alasan: form.alasan.trim(),
                        }))}>Ajukan Koreksi Berkas</Button>
                        <Button variant="outline" onClick={() => setKonfirmasi(false)}>Kembali</Button>
                    </div>
                </div>
            ) : (
                <div className="space-y-2">
                    <Label htmlFor="koreksi-unit">Unit pengolah baru</Label>
                    <select id="koreksi-unit" className="w-full rounded border p-2 text-sm" value={unitBaru || ''}
                        onChange={event => setForm(prev => ({ ...prev, unitPengolahBaru: event.target.value }))}>
                        {data.kandidatUnit.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                    </select>
                    <KlasifikasiPicker id="koreksi-klasifikasi" label="Klasifikasi berkas baru" value={form.klasifikasiKode}
                        onChange={(kode, item) => setForm(prev => ({ ...prev, klasifikasiKode: kode || '', klasifikasiBaru: item?.id ?? null }))} />
                    <Label htmlFor="koreksi-alasan">Alasan koreksi</Label>
                    <Textarea id="koreksi-alasan" value={form.alasan}
                        onChange={event => setForm(prev => ({ ...prev, alasan: event.target.value }))} />
                    <Button disabled={!siap} onClick={() => setKonfirmasi(true)}>Lanjutkan</Button>
                </div>
            ))}
        </section>
    )
}
```

Di `frontend/src/components/surat/AlurSuratPanel.jsx`: tambahkan `import KoreksiBerkasSection from './KoreksiBerkasSection'` dan render `<KoreksiBerkasSection rangkaianId={detail.rangkaian.id} status={detail.rangkaian.status} />` tepat setelah elemen `<AlurSuratActions detail={detail} onChanged={muatUlang} />` yang dipasang P3 Task 25 (tombol **Berkaskan ke Direktorat (Unit Pengolah)** / **Gabungkan Rangkaian** berada di dalam `AlurSuratActions`, bukan langsung di panel). Pakai nama variabel respons yang dipakai panel di titik itu. Pada setiap berkas test yang me-render `AlurSuratPanel` (cari dengan `rg -l "AlurSuratPanel" frontend/src --glob "*.test.jsx"`), tambahkan:

```js
vi.mock('@/components/surat/KoreksiBerkasSection', () => ({ default: () => null }))
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npm --prefix frontend exec -- vitest run src/services/rangkaian.service.p5.test.js src/components/surat`
Expected: PASS (termasuk test `AlurSuratPanel` yang sudah ada).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/rangkaian.service.js frontend/src/services/rangkaian.service.p5.test.js frontend/src/components/surat/KoreksiBerkasSection.jsx frontend/src/components/surat/KoreksiBerkasSection.test.jsx frontend/src/components/surat/AlurSuratPanel.jsx frontend/src/components/surat/*.test.jsx
git commit -m "feat(rangkaian-ui): maker-checker Koreksi Berkas section in Alur Surat panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


#### Amandemen pra-eksekusi Task 9 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p5-data-lama-pelengkap/preflight-rulings.md`.


1. **Names instead of ids (REQUIRED) [P5-T9-1].**
   - Task 6 `daftar` returns:
     ```ts
     rangkaian: { id, kode, status, unitPengolah: { id, nama } | null, klasifikasi: { id, kode, jenis } | null }
     koreksi[i]: { …, unitPengolahLama: { id, nama }, unitPengolahBaru: { id, nama },
                   klasifikasiLama: { id, kode, jenis }, klasifikasiBaru: { id, kode, jenis }, unitKehilanganAkses: string[] }
     ```
     Build these with one `unit_kerja` lookup and one klasifikasi lookup per call.
   - `KoreksiBerkasSection` renders `{u.nama}` and `` `${k.kode} – ${k.jenis}` ``, never raw ids.
   - Adjust the section and service tests to the new DTO.
2. **Panel wiring (REQUIRED) [P5-T9-2] RECHECK-AFTER-P3/P4.**
   - Render `<KoreksiBerkasSection rangkaianId={d.rangkaian.id} status={d.rangkaian.status} onChanged={muatUlang} />` directly after `<AlurSuratActions detail={d} onChanged={muatUlang} />`. Use the real detail variable and reload function names in the P3/P4 panel.
   - `KoreksiBerkasSection` accepts `onChanged` and calls `onChanged?.()` after a successful `ajukan` or `putuskan`, after its own reload.
   - **(delta P3) Confirmed on real P3 @ b4d86fa:**
     - `const d = state.data` (`AlurSuratPanel.jsx:127`);
     - `muatUlang` (:65-68, which bumps `muatKe` and calls the parent's `onChanged`);
     - the slot `<AlurSuratActions detail={d} onChanged={muatUlang} />` (:170);
     - `d.rangkaian.id` and `d.rangkaian.status` exist (`RangkaianDetail.rangkaian`, `rangkaian-read.service.ts:105-120`).

     The panel also has a parent-driven `muatUlangKe` prop (:56, :96); the section does not need it.
3. **Test locations (REQUIRED) [P5-T9-3].**
   - Create the component test as `frontend/src/components/surat/__tests__/KoreksiBerkasSection.test.jsx`, with imports adjusted to `'../KoreksiBerkasSection'`.
   - Merge the P5 service cases into the existing `frontend/src/services/rangkaian.service.test.js` instead of creating `rangkaian.service.p5.test.js`. Its `./api` mock already has `get`, `post` and `put` after P3 T18-3.
4. **Flaky reload assertion (REQUIRED) [P5-T9-4].** Replace the synchronous `expect(mocks.getKoreksiBerkas).toHaveBeenCalledTimes(2)` after a click with `await waitFor(() => expect(mocks.getKoreksiBerkas).toHaveBeenCalledTimes(2))`.
5. **Mocks and staging (REQUIRED) [P5-T9-5] RECHECK-AFTER-P4.**
   - Run `rg -l "AlurSuratPanel" frontend/src --glob "*.test.jsx"`. In every listed file that renders the real panel (not a `vi.mock` of it), add `vi.mock('@/components/surat/KoreksiBerkasSection', () => ({ default: () => null }))`.
   - Replace Step 5's `git add … frontend/src/components/surat/*.test.jsx` with an explicit list of every file edited: at least `frontend/src/components/surat/__tests__/AlurSuratPanel.test.jsx`, `frontend/src/components/surat/__tests__/AlurSuratPanel.rangkaian-id.test.jsx` (P4) and `frontend/src/pages/SuratMasukDetail.alur.test.jsx`, plus the new files.
   - Step 4 runs `cd frontend && npx vitest run src/services/rangkaian.service.test.js src/components/surat src/pages && npx eslint src/components/surat/KoreksiBerkasSection.jsx src/components/surat/AlurSuratPanel.jsx src/services/rangkaian.service.js`.
   - **(delta P3) Corrected file list.** Real P3 @ b4d86fa renders the **real** panel, which needs the mock, in:
     - `src/components/surat/__tests__/AlurSuratPanel.test.jsx` (no `AuthContext` mock, so a real `useAuth` throws there);
     - `src/pages/SuratKeluarDetail.no-loop.test.jsx`;
     - `src/pages/SuratKeluarDetail.rules.test.jsx`;
     - `src/pages/SuratMasukDetail.alur-refresh.test.jsx`;
     - `src/pages/SuratMasukDetail.no-loop.test.jsx`;
     - `src/pages/surat-archive-dialog.test.jsx`;
     - plus P4's `__tests__/AlurSuratPanel.rangkaian-id.test.jsx` and any P4 `LacakSurat` test that does not mock the panel.

     `src/pages/SuratMasukDetail.alur.test.jsx` (:13) and `SuratMasukDetail.aksi.test.jsx` (:17) **mock** `AlurSuratPanel`, so they need no change. The earlier amendment listed `SuratMasukDetail.alur.test.jsx` by mistake. Stage exactly the edited files.
6. **(delta P3) Server-authoritative section visibility (ADVISORY).**
   - P3 made `aksiDiizinkan` authoritative in the UI; the P3 frontend release gate reads "UI treats `aksiDiizinkan` as authoritative". None of the P3 panel components calls `useAuth` (no match in `components/surat/*`).
   - Prefer returning `dapatMengajukan`/`dapatMemutuskan` flags from the Task 6 `daftar` DTO (computed server-side: super_admin, maker ≠ checker) over a `useAuth()` role check in `KoreksiBerkasSection`. That also removes the `useAuth` provider dependency behind item 5.
   - If the role check stays, item 5 is mandatory.
7. **(delta P3) Names in the P3 gabung and ubah-pengolah previews (ADVISORY; P3 frontend carry-forward 2, M2/M3).**
   - `AlurSuratActions.jsx:75, 108` maps gabung preview ids through the target's `peserta`, so new units show as raw ids.
   - `:225-230` shows a speculative access preview, while `PUT /unit-pengolah` already returns `aksesBaru` (`berkas.service.ts:231`).
   - Task 9 already introduces the "names, never ids" DTO pattern (item 1). If Task 9 touches `AlurSuratActions.jsx` anyway, apply the same pattern here: `pratinjauGabung` returns `{id, nama}`, and the ubah-pengolah dialog shows the server's `aksesBaru`. Otherwise record it in the P5 PR as a P3 follow-up.


**C-13 (critic) — Task 9: section reload vs panel remount — ADVISORY, RECHECK-AFTER-P3 [P5-C-13]**


- In the real panel, `muatUlang` bumps `muatKe` and calls the parent `onChanged` (`AlurSuratPanel.jsx:60-64`).
- While reloading, the panel renders only the loading card (`:86`), which unmounts `KoreksiBerkasSection`.
- So when `onChanged` is provided:
  - the section's own reload is redundant;
  - a success message kept in section state is lost.
- Show success with a toast, and skip the section's own reload when `onChanged` exists.
- The panel variable `d` (`:115`) and `muatUlang` exist; P3 T25 `AlurSuratActions` has not landed yet.
- **(delta P3) Line numbers on merged P3 @ b4d86fa:** `muatUlang` :65-68, `setState({ loading: true, … })` inside `muat()` :81, the loading card that unmounts children :98-107, `const d` :127. `AlurSuratActions` **has** landed, with the slot at :170. Its own actions follow the same "toast plus `onChanged`" pattern (`AlurSuratActions.jsx:32`), which confirms this recommendation.



### Task 10: UI "Tutup massal data lama" di tab Berkas Rangkaian

**Files:**
- Create: `frontend/src/components/surat/TutupMassalDataLama.jsx`
- Create: `frontend/src/components/surat/TutupMassalDataLama.test.jsx`
- Modify: `frontend/src/components/lacak/BerkasRangkaianTab.jsx` (P4 Task 12, isi tab **Berkas Rangkaian** di `LacakSurat.jsx`) dan `frontend/src/components/lacak/BerkasRangkaianTab.test.jsx

**Interfaces:**
- Consumes: `rangkaianService.getRingkasanDataLama()`, `.tutupMassalDataLama(payload)` (Task 9); (P4) `BerkasRangkaianTab()` di `components/lacak/BerkasRangkaianTab.jsx` dengan state `filter.asal` dan `resource.reload()`; `KlasifikasiPicker`.
- Produces: komponen default `TutupMassalDataLama({ onSelesai? })`. Ini **satu-satunya** UI Tutup massal (P4 tidak membangunnya); kontrak endpoint persis Task 7–8: body `{ tahun?, unitPencatatId?, klasifikasiItemId?, dryRun, konfirmasi?, expectedCount? }` → `{ jumlah, tanpaKlasifikasi, contoh, contohTanpaKlasifikasi, terpotong, diterapkan }`.

- [ ] **Step 1: Tulis test yang gagal**

```jsx
// frontend/src/components/surat/TutupMassalDataLama.test.jsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TutupMassalDataLama from './TutupMassalDataLama'

const mocks = vi.hoisted(() => ({ ringkasan: vi.fn(), tutup: vi.fn() }))
vi.mock('@/services/rangkaian.service', () => ({
    rangkaianService: { getRingkasanDataLama: mocks.ringkasan, tutupMassalDataLama: mocks.tutup },
}))
vi.mock('@/components/KlasifikasiPicker', () => ({
    KlasifikasiPicker: ({ onChange }) => <button type="button" onClick={() => onChange('KU.01', { id: 3 })}>Pilih KU.01</button>,
}))

describe('TutupMassalDataLama', () => {
    beforeEach(() => vi.clearAllMocks())
    afterEach(cleanup)

    it('tersembunyi bila pengguna bukan pengawas atau layanan belum tersedia', async () => {
        mocks.ringkasan.mockResolvedValue({ dapatMenutup: false, perTahun: [] })
        const { container } = render(<TutupMassalDataLama />)
        await waitFor(() => expect(mocks.ringkasan).toHaveBeenCalled())
        expect(container).toBeEmptyDOMElement()
    })

    it('pratinjau lalu penerapan mengirim expectedCount dari pratinjau', async () => {
        mocks.ringkasan.mockResolvedValue({ dapatMenutup: true, perTahun: [{ tahun: 2022, jumlah: 5 }, { tahun: 2023, jumlah: 2 }] })
        mocks.tutup
            .mockResolvedValueOnce({ jumlah: 4, tanpaKlasifikasi: 1, contoh: ['RS-2022-000001'], contohTanpaKlasifikasi: ['RS-2022-000009'], terpotong: false, diterapkan: 0 })
            .mockResolvedValueOnce({ jumlah: 4, tanpaKlasifikasi: 1, contoh: [], contohTanpaKlasifikasi: [], terpotong: false, diterapkan: 4 })
        render(<TutupMassalDataLama />)
        fireEvent.change(await screen.findByLabelText('Tahun'), { target: { value: '2022' } })
        fireEvent.click(screen.getByRole('button', { name: 'Pratinjau' }))
        expect(await screen.findByText(/4 rangkaian siap diberkaskan/)).toBeInTheDocument()
        const terapkan = screen.getByRole('button', { name: 'Tutup massal 4 rangkaian' })
        expect(terapkan).toBeDisabled()
        fireEvent.click(screen.getByLabelText(/Saya memahami/))
        fireEvent.click(terapkan)
        await waitFor(() => expect(mocks.tutup).toHaveBeenLastCalledWith({ tahun: 2022, dryRun: false, konfirmasi: true, expectedCount: 4 }))
        expect(await screen.findByText('4 rangkaian diberkaskan.')).toBeInTheDocument()
    })

    it('memanggil onSelesai setelah penerapan agar daftar dimuat ulang', async () => {
        const onSelesai = vi.fn()
        mocks.ringkasan.mockResolvedValue({ dapatMenutup: true, perTahun: [{ tahun: 2022, jumlah: 1 }] })
        mocks.tutup
            .mockResolvedValueOnce({ jumlah: 1, tanpaKlasifikasi: 0, contoh: [], contohTanpaKlasifikasi: [], terpotong: false, diterapkan: 0 })
            .mockResolvedValueOnce({ jumlah: 1, tanpaKlasifikasi: 0, contoh: [], contohTanpaKlasifikasi: [], terpotong: false, diterapkan: 1 })
        render(<TutupMassalDataLama onSelesai={onSelesai} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Pratinjau' }))
        fireEvent.click(await screen.findByLabelText(/Saya memahami/))
        fireEvent.click(screen.getByRole('button', { name: 'Tutup massal 1 rangkaian' }))
        await waitFor(() => expect(onSelesai).toHaveBeenCalledTimes(1))
    })

    it('mengubah filter membatalkan pratinjau', async () => {
        mocks.ringkasan.mockResolvedValue({ dapatMenutup: true, perTahun: [{ tahun: 2022, jumlah: 5 }] })
        mocks.tutup.mockResolvedValue({ jumlah: 5, tanpaKlasifikasi: 0, contoh: [], contohTanpaKlasifikasi: [], terpotong: false, diterapkan: 0 })
        render(<TutupMassalDataLama />)
        fireEvent.click(await screen.findByRole('button', { name: 'Pratinjau' }))
        await screen.findByText(/5 rangkaian siap diberkaskan/)
        fireEvent.click(screen.getByRole('button', { name: 'Pilih KU.01' }))
        expect(screen.queryByRole('button', { name: /Tutup massal 5/ })).not.toBeInTheDocument()
    })
})
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm --prefix frontend exec -- vitest run src/components/surat/TutupMassalDataLama.test.jsx`
Expected: FAIL — `Failed to resolve import "./TutupMassalDataLama"`.

- [ ] **Step 3: Implementasi minimal**

```jsx
// frontend/src/components/surat/TutupMassalDataLama.jsx
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { KlasifikasiPicker } from '@/components/KlasifikasiPicker'
import { rangkaianService } from '@/services/rangkaian.service'

export default function TutupMassalDataLama({ onSelesai } = {}) {
    const [ringkasan, setRingkasan] = useState(null)
    const [tahun, setTahun] = useState('')
    const [klasifikasi, setKlasifikasi] = useState({ id: null, kode: '' })
    const [pratinjau, setPratinjau] = useState(null)
    const [paham, setPaham] = useState(false)
    const [hasil, setHasil] = useState(null)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        let aktif = true
        // Promise.resolve().then(...) mengubah TypeError sinkron (mock/layanan lama) menjadi penolakan yang tertangani.
        Promise.resolve()
            .then(() => rangkaianService.getRingkasanDataLama())
            .then(data => { if (aktif) setRingkasan(data) })
            .catch(() => { if (aktif) setRingkasan({ dapatMenutup: false, perTahun: [] }) })
        return () => { aktif = false }
    }, [])

    if (!ringkasan?.dapatMenutup) return null

    const filter = { ...(tahun ? { tahun: Number(tahun) } : {}), ...(klasifikasi.id ? { klasifikasiItemId: klasifikasi.id } : {}) }
    const resetPratinjau = () => { setPratinjau(null); setPaham(false); setHasil(null) }

    const jalankan = async (payload, setter) => {
        setBusy(true)
        setError('')
        try { setter(await rangkaianService.tutupMassalDataLama(payload)) }
        catch (err) { setError(err?.message || 'Permintaan gagal.') }
        finally { setBusy(false) }
    }

    return (
        <section aria-labelledby="tutup-massal-judul" className="space-y-3 rounded-md border p-3">
            <h3 id="tutup-massal-judul" className="text-sm font-semibold">Tutup massal data lama</h3>
            <p className="text-xs text-muted-foreground">
                Memberkaskan rangkaian data lama berstatus selesai. Unit pengolah memakai nilai tercatat atau unit pencatat;
                klasifikasi memakai klasifikasi berkas/induk atau pilihan di bawah. Maksimal 500 rangkaian per penerapan.
            </p>
            <Label htmlFor="tutup-massal-tahun">Tahun</Label>
            <select id="tutup-massal-tahun" className="w-full rounded border p-2 text-sm" value={tahun}
                onChange={event => { setTahun(event.target.value); resetPratinjau() }}>
                <option value="">Semua tahun</option>
                {ringkasan.perTahun.map(row => <option key={row.tahun} value={row.tahun}>{row.tahun} ({row.jumlah})</option>)}
            </select>
            <KlasifikasiPicker id="tutup-massal-klasifikasi" label="Klasifikasi untuk rangkaian tanpa klasifikasi" value={klasifikasi.kode}
                onChange={(kode, item) => { setKlasifikasi({ id: item?.id ?? null, kode: kode || '' }); resetPratinjau() }} />
            <Button variant="outline" disabled={busy} onClick={() => jalankan({ ...filter, dryRun: true }, setPratinjau)}>Pratinjau</Button>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {pratinjau && !hasil && (
                <div className="space-y-2 text-sm">
                    <p>{pratinjau.jumlah} rangkaian siap diberkaskan; {pratinjau.tanpaKlasifikasi} dilewati karena belum berklasifikasi.</p>
                    {pratinjau.terpotong && <p>Hasil lebih dari 500; ulangi setelah penerapan ini.</p>}
                    <label className="flex items-center gap-2">
                        <input type="checkbox" checked={paham} onChange={event => setPaham(event.target.checked)} />
                        Saya memahami status diberkaskan tidak dapat dibuka kembali.
                    </label>
                    <Button disabled={busy || !paham || pratinjau.jumlah === 0}
                        onClick={() => jalankan({ ...filter, dryRun: false, konfirmasi: true, expectedCount: pratinjau.jumlah }, data => { setHasil(data); onSelesai?.() })}>
                        {`Tutup massal ${pratinjau.jumlah} rangkaian`}
                    </Button>
                </div>
            )}
            {hasil && <p className="text-sm">{hasil.diterapkan} rangkaian diberkaskan.</p>}
        </section>
    )
}
```

Di `frontend/src/components/lacak/BerkasRangkaianTab.jsx` (P4): tambahkan `import TutupMassalDataLama from '@/components/surat/TutupMassalDataLama'`, lalu sisipkan tepat sebelum `<div className="overflow-x-auto rounded-md border">`:

```jsx
            {filter.asal === 'data_lama' && <TutupMassalDataLama onSelesai={resource.reload} />}
```

Komponen menyembunyikan dirinya sendiri untuk non-pengawas (`dapatMenutup: false`). Di `frontend/src/components/lacak/BerkasRangkaianTab.test.jsx` (P4), tambahkan `vi.mock('@/components/surat/TutupMassalDataLama', () => ({ default: () => <div data-testid="tutup-massal-slot" /> }))` di bawah mock layanan, dan tambahkan test berikut di dalam `describe('Tab Berkas Rangkaian')`:

```jsx
    it('menyisipkan Tutup massal P5 hanya saat filter asal data lama', async () => {
        mount()
        await screen.findByRole('link', { name: 'RS-2026-000001' })
        expect(screen.queryByTestId('tutup-massal-slot')).toBeNull()
        fireEvent.change(screen.getByLabelText('Asal'), { target: { value: 'data_lama' } })
        expect(await screen.findByTestId('tutup-massal-slot')).toBeInTheDocument()
    })
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npm --prefix frontend exec -- vitest run src/components/surat/TutupMassalDataLama.test.jsx src/components/lacak src/pages`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/surat/TutupMassalDataLama.jsx frontend/src/components/surat/TutupMassalDataLama.test.jsx frontend/src/components/lacak/BerkasRangkaianTab.jsx frontend/src/components/lacak/BerkasRangkaianTab.test.jsx
git commit -m "feat(rangkaian-ui): previewed bulk closing of legacy rangkaian in Berkas Rangkaian tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


#### Amandemen pra-eksekusi Task 10 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p5-data-lama-pelengkap/preflight-rulings.md`.


1. **P4 anchors (REQUIRED) [P5-T10-1] RECHECK-AFTER-P4.** Before Step 1, run `rg -n "filter.asal|resource.reload|overflow-x-auto rounded-md border" frontend/src/components/lacak/BerkasRangkaianTab.jsx`. Expected: all three are present. P4 amendment P4-T12-1 changes only the kode cell. Insert the slot before the `<div className="overflow-x-auto rounded-md border">` anchor text.
2. **Stale P4 assertion (ADVISORY) [P5-T10-2].** In P4's `BerkasRangkaianTab.test.jsx`, the case "filter asal data lama … tanpa aksi mutasi (Tutup massal milik P5)" becomes a slot-presence assertion: the P5 slot mock renders once `asal = data_lama`. Delete the `queryByRole('button', { name: 'Tutup massal data lama' })` null assertion.
3. **Commands (BLOCKING) [P5-G-1].** Use the `cd frontend && npx vitest run …` form.



### Task 11: Notifikasi batas waktu disposisi dan pengecualian data lama

**Files:**
- Modify: `backend/src/services/notification.service.ts` (fungsi bantu di atas `export class NotificationService`; `getPendingSuratMasuk` :164-230; `getDistributionNotifications` :307-354)
- Test: `backend/src/__tests__/notification-batas-waktu.test.ts`

**Interfaces:**
- Consumes (P1): Drizzle `suratDistributions.batasWaktu` (`date`, string `YYYY-MM-DD`), tabel `rangkaian_anggota`, `rangkaian_surat.asal/status`; `jakartaDate()` dari `utils/jakarta-date.ts`.
- Produces: `deadlineUrgency(batasWaktu, today?)`, `deadlineTitle(sisaHari)`, `notDataLamaIncomingCondition()`.

- [ ] **Step 1: Tulis test yang gagal**

```ts
// backend/src/__tests__/notification-batas-waktu.test.ts
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { suratMasuk } from '../db/schema/surat-masuk';
import { jakartaDate } from '../utils/jakarta-date';
import { createRangkaianTestDatabase, seedRangkaianBase } from './helpers/rangkaian-p5-pglite.js';

const queue: any[] = [];
const chain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') { const value = queue.shift() ?? []; return (resolve: any) => resolve(value); }
        return () => chain;
    },
});
vi.mock('../config/database', () => ({ db: { select: () => chain } }));
vi.mock('../services/arsip.service', () => ({ arsipService: { getExpiring: async () => [] } }));

const { notificationService, deadlineUrgency, notDataLamaIncomingCondition } = await import('../services/notification.service');
const UUID = '550e8400-e29b-41d4-a716-446655440001';
const hari = (offset: number) => jakartaDate(new Date(Date.now() + offset * 86_400_000));

describe('urgensi batas waktu disposisi', () => {
    beforeEach(() => { queue.length = 0; });

    it('mendesak bila batas waktu ≤ 2 hari lagi atau terlewati', () => {
        expect(deadlineUrgency(null, '2026-09-26')).toBeNull();
        expect(deadlineUrgency('2026-09-29', '2026-09-26')).toBeNull();
        expect(deadlineUrgency('2026-09-28', '2026-09-26')).toEqual({ type: 'urgent', sisaHari: 2 });
        expect(deadlineUrgency('2026-09-26', '2026-09-26')).toEqual({ type: 'urgent', sisaHari: 0 });
        expect(deadlineUrgency('2026-09-20', '2026-09-26')).toEqual({ type: 'urgent', sisaHari: -6 });
    });

    it.each([
        [1, 'Batas waktu disposisi 1 hari lagi'],
        [0, 'Batas waktu disposisi hari ini'],
        [-3, 'Disposisi lewat batas waktu 3 hari'],
    ])('distribusi baru dengan batas waktu H%s menjadi urgent', async (offset, title) => {
        queue.push([{ id: UUID, status: 'received', instruction: 'Mohon ditindaklanjuti', nomorSurat: 'SM-9',
            sentAt: new Date(), updatedAt: new Date(), batasWaktu: hari(offset) }]);
        const [notification] = await notificationService.getDistributionNotifications('dir_bppt', 'user-1', null, new Set(), 'admin_unit');
        expect(notification).toMatchObject({ type: 'urgent', title, state: 'awaiting_processing' });
        expect(notification.id).toBe(`distribusi:${UUID}:awaiting_processing:urgent`);
    });

    it('tanpa batas waktu tetap memakai urgensi usia lama', async () => {
        queue.push([{ id: UUID, status: 'sent', instruction: null, nomorSurat: 'SM-1', sentAt: new Date(), updatedAt: new Date(), batasWaktu: null }]);
        const [notification] = await notificationService.getDistributionNotifications('dir_bppt', 'user-1', null, new Set(), 'admin_unit');
        expect(notification).toMatchObject({ type: 'info', title: 'Distribusi menunggu penerimaan' });
    });
});

describe('pengecualian data lama pada notifikasi surat masuk', () => {
    let database: PGlite;
    beforeAll(async () => {
        database = await createRangkaianTestDatabase();
        await seedRangkaianBase(database);
        await database.exec(`
            INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun) VALUES
              ('00000000-0000-4000-8000-000000000a01', 'ditjen', 1, 2023),
              ('00000000-0000-4000-8000-000000000a02', 'ditjen', 2, 2023),
              ('00000000-0000-4000-8000-000000000a03', 'ditjen', 3, 2023);
            INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, judul, tahun) VALUES
              ('00000000-0000-4000-8000-000000000b01', 'RS-2023-990001', 'data_lama', 'selesai', 'ditjen', 'Lama selesai', 2023),
              ('00000000-0000-4000-8000-000000000b02', 'RS-2023-990002', 'data_lama', 'aktif', 'ditjen', 'Lama dibuka kembali', 2023);
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber) VALUES
              ('00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-000000000a01', 'ditjen', 'induk', 'data_lama'),
              ('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-000000000a02', 'ditjen', 'induk', 'data_lama');`);
    }, 180_000);
    afterAll(async () => { await database?.close(); });

    it('surat induk rangkaian data lama yang tertutup tidak dinotifikasi; yang dibuka kembali tetap', async () => {
        const rows = await drizzle(database).select({ id: suratMasuk.id }).from(suratMasuk)
            .where(notDataLamaIncomingCondition()).orderBy(suratMasuk.id);
        expect(rows.map((row) => row.id.slice(-3))).toEqual(['a02', 'a03']);
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm --prefix backend exec -- vitest run src/__tests__/notification-batas-waktu.test.ts`
Expected: FAIL — `deadlineUrgency is not a function`.

- [ ] **Step 3: Implementasi minimal**

Di `notification.service.ts`, tambahkan impor `import { jakartaDate } from '../utils/jakarta-date.js';` lalu tambahkan sebelum `export interface Notification`:

```ts
const DEADLINE_WINDOW_DAYS = 2;

/** Spec §5: distribusi dengan batas_waktu ≤ 2 hari (atau terlewati) selalu mendesak. Tanggal dibanding pada kalender Jakarta. */
export function deadlineUrgency(
    batasWaktu: string | null | undefined,
    today: string = jakartaDate(),
): { type: 'urgent'; sisaHari: number } | null {
    if (!batasWaktu) return null;
    const sisaHari = Math.round(
        (Date.parse(`${batasWaktu}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
    );
    if (!Number.isFinite(sisaHari) || sisaHari > DEADLINE_WINDOW_DAYS) return null;
    return { type: 'urgent', sisaHari };
}

export function deadlineTitle(sisaHari: number): string {
    if (sisaHari < 0) return `Disposisi lewat batas waktu ${Math.abs(sisaHari)} hari`;
    if (sisaHari === 0) return 'Batas waktu disposisi hari ini';
    return `Batas waktu disposisi ${sisaHari} hari lagi`;
}

/** Spec §5/§8: surat induk rangkaian data lama yang tertutup tidak masuk daftar kerja/notifikasi. */
export function notDataLamaIncomingCondition(): SQL {
    return sql`NOT EXISTS (
        SELECT 1 FROM rangkaian_anggota notif_ra
        JOIN rangkaian_surat notif_rs ON notif_rs.id = notif_ra.rangkaian_id
        WHERE notif_ra.surat_masuk_id = ${suratMasuk.id}
          AND notif_rs.asal = 'data_lama'
          AND notif_rs.status <> 'aktif'
    )`;
}
```

Di `getPendingSuratMasuk`, tambahkan `notDataLamaIncomingCondition(),` sebagai argumen terakhir `and(...)` pada `.where(...)`.

Di `getDistributionNotifications`, tambahkan `batasWaktu: suratDistributions.batasWaktu,` ke objek `select`, lalu ganti isi `rows.map(...)` dengan:

```ts
        return rows.map(row => {
            const urgency = ageUrgency(row.updatedAt || row.sentAt, new Date(), 1, 3);
            const deadline = deadlineUrgency(row.batasWaktu);
            const type = deadline ? deadline.type : urgency.type;
            const state = row.status === 'sent' ? 'awaiting_receipt' : 'awaiting_processing';
            const notification: Notification = {
                id: statefulId('distribusi', row.id, state, type),
                type,
                category: 'distribusi',
                title: deadline
                    ? deadlineTitle(deadline.sisaHari)
                    : row.status === 'sent'
                        ? 'Distribusi menunggu penerimaan'
                        : 'Distribusi menunggu tindak lanjut',
                message: `${row.nomorSurat || 'Surat'} - ${excerpt(row.instruction || row.perihal)}`,
                daysLeft: deadline ? deadline.sisaHari : urgency.ageDays,
                referenceId: row.id,
                createdAt: row.updatedAt || row.sentAt,
                isRead: false,
                state,
            };
            return notification;
        }).filter(item => !readIds.has(item.id));
```

- [ ] **Step 4: Jalankan test, pastikan lulus (termasuk regresi)**

Run: `npm --prefix backend exec -- vitest run src/__tests__/notification-batas-waktu.test.ts src/__tests__/notification.service.test.ts src/__tests__/notification-unit-scope.routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/notification.service.ts backend/src/__tests__/notification-batas-waktu.test.ts
git commit -m "feat(notifikasi): disposition deadline urgency and legacy rangkaian exclusion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


#### Amandemen pra-eksekusi Task 11 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p5-data-lama-pelengkap/preflight-rulings.md`.


1. **Merge into P3 (BLOCKING, security) [P5-T11-1] RECHECK-AFTER-P3.** Replace the Step 3 instruction "ganti isi `rows.map(...)`" with the following changes to P3's version of `getDistributionNotifications`, which has 6 parameters including `user?: RecordUser`, selects `suratMasukId`, and masks via `checkMany`:
   - Add `batasWaktu: suratDistributions.batasWaktu,` to the existing `select` object. Keep `suratMasukId`.
   - In the existing `rows.map`:
     - After `const urgency = …`, add `const deadline = deadlineUrgency(row.batasWaktu);` and `const type = deadline ? deadline.type : urgency.type;`.
     - Use `type` in `statefulId('distribusi', row.id, state, type)` and in the `type` field.
     - Set `title: deadline ? deadlineTitle(deadline.sisaHari) : <P3 title expression unchanged>`.
     - Set `daysLeft: deadline ? deadline.sisaHari : urgency.ageDays`.
   - **Do not touch the `message` expression.** It keeps P3's masked branch (`'Dikecualikan'` when the row is not allowed).
   - Add to `notification-batas-waktu.test.ts`. The mock must target the module that real P3 `notification.service.ts` imports `checkMany` from; if it imports via `./rangkaian/deps.js`, mock that module instead.
     ```ts
     const aksesMock = vi.hoisted(() => ({ allowed: true }));
     vi.mock('../services/record-access.service', async (importOriginal) => {
         const asli = await importOriginal<typeof import('../services/record-access.service')>();
         return {
             ...asli,
             recordAccessService: {
                 ...asli.recordAccessService,
                 checkMany: async (_user: unknown, refs: Array<{ type: 'surat_masuk'; id: string }>) =>
                     new Map(refs.map((ref) => [asli.readRefKey(ref), { allowed: aksesMock.allowed, masked: !aksesMock.allowed } as never])),
             },
         };
     });
     ```
     ```ts
         it('baris tersamar tetap "Dikecualikan" meski judulnya memakai urgensi batas waktu', async () => {
             aksesMock.allowed = false;
             queue.push([{ id: UUID, suratMasukId: '550e8400-e29b-41d4-a716-446655440099', status: 'received', instruction: 'Instruksi rahasia',
                 nomorSurat: 'R-1', perihal: 'Perihal rahasia', sentAt: new Date(), updatedAt: new Date(), batasWaktu: hari(0) }]);
             const [notification] = await notificationService.getDistributionNotifications(
                 'dir_bppt', 'user-1', null, new Set(), 'admin_unit', { id: 'user-1', role: 'admin_unit', unitKerjaId: 'dir_bppt' });
             expect(notification).toMatchObject({ type: 'urgent', title: 'Batas waktu disposisi hari ini', message: 'Dikecualikan' });
             expect(JSON.stringify(notification)).not.toContain('R-1');
             aksesMock.allowed = true;
         });
     ```
   - The existing P5 cases that call the 5-argument form stay as they are; they exercise P3's no-`user` path.
   - Step 4 also runs `src/__tests__/notification.service.test.ts`, which contains P3's masking case.
   - **(delta P3) Confirmed code, corrected test mock.**
     - Real P3 @ b4d86fa has `getDistributionNotifications(unitKerjaId, userId, securityClassifications?, knownReadIds?, userRole = 'user', user?: RecordUser)` (`notification.service.ts:319-326`). The select includes `suratMasukId` (:331). `checkMany` runs only when `user` is present (:350-352). The masking is `message: bolehDibaca(row.suratMasukId) ? … : LABEL_DIKECUALIKAN` (:366-368). `recordAccessService`, `readRefKey` and `LABEL_DIKECUALIKAN` come from `./rangkaian/deps.js` (:25).
     - Replace the `vi.mock('../services/record-access.service', …importOriginal…)` block with P3's own pattern (`notification.service.test.ts:144-168`): `const { recordAccessService } = await import('../services/record-access.service'); const spy = vi.spyOn(recordAccessService, 'checkMany').mockResolvedValue(new Map([[\`surat_masuk:${SM_ID}\`, { allowed: false }]]) as any);`, with `spy.mockRestore()` in `finally`. `deps.ts` re-exports the same singleton, so the spy reaches the service. The Map key is `readRefKey` = `${type}:${id.toLowerCase()}`.
     - **In flux:** P3 access M-5 recommends making the no-`user` path mask-all instead of fail-open (:353-354). If the fix wave or P4 applies it, the P5 cases that use the 5-argument form must pass a `user` and stub `checkMany` as `allowed: true`, or they will see `'Dikecualikan'`. Recheck on the P5 base.
2. **Negative `daysLeft` rendering (ADVISORY) [P5-T11-2].** In `frontend/src/components/app-header.jsx` (the `notif.category === 'surat-masuk' ? … : …` expression), render `` notif.daysLeft < 0 ? `lewat ${-notif.daysLeft} hari` : `${notif.daysLeft} hari lagi` `` for the non-surat-masuk branch.
3. **Two data-lama definitions (ADVISORY) [P5-T11-3] RECHECK-AFTER-P4.** Add one sentence to Self-Review item 8: the notification exclusion (induk of a closed `data_lama` rangkaian) intentionally differs from the D7 cutoff. SMs outside any rangkaian keep notifying, as they do today.



### Task 12: Ekspor "Balasan Untuk" sebagai nomor + kolom "Asal Naskah"

**Files:**
- Create: `backend/src/services/export-balasan.ts`
- Modify: `backend/src/services/export.service.ts` (`generateExcelSuratKeluar`, :128-224)
- Test: `backend/src/__tests__/export-balasan.test.ts`

**Interfaces:**
- Consumes (P1): Drizzle `suratKeluar.asalNaskah` (`'inisiatif' | 'tindak_lanjut' | null`); `normalizeSecurityClassification` (re-export `record-access.service.ts`); `suratKeluarService.findAll`.
- Produces: `resolveBalasanLabels(rows, allowedClasses): Promise<Map<string, string>>`, `ASAL_NASKAH_LABEL`, konstanta `BALASAN_DIKECUALIKAN`, `BALASAN_LINTAS_UNIT`, `BALASAN_TIDAK_TERSEDIA`.

- [ ] **Step 1: Tulis test yang gagal**

```ts
// backend/src/__tests__/export-balasan.test.ts
import ExcelJS from 'exceljs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({ db: null as any, keluar: vi.fn() }));
vi.mock('../config/database.js', () => ({ db: { select: (fields: any) => holder.db.select(fields) } }));
vi.mock('../services/surat-masuk.service', () => ({ suratMasukService: { findAll: vi.fn() } }));
vi.mock('../services/surat-keluar.service', () => ({ suratKeluarService: { findAll: holder.keluar } }));
vi.mock('../services/arsip.service', () => ({ arsipService: { findAll: vi.fn() } }));

const SM = (n: number) => `00000000-0000-4000-8000-00000000c00${n}`;
let database: PGlite;
let lookup: typeof import('../services/export-balasan.js');
let exportService: typeof import('../services/export.service.js').exportService;

beforeAll(async () => {
    database = new PGlite();
    await database.exec(`CREATE TABLE surat_masuk (id uuid PRIMARY KEY, unit_kerja_id varchar(50) NOT NULL,
        nomor_surat varchar(255), sifat_surat varchar(50), is_deleted boolean DEFAULT false);
        INSERT INTO surat_masuk VALUES
          ('${SM(1)}', 'ditjen', 'SM-001/2026', 'Sangat Segera', false),
          ('${SM(2)}', 'ditjen', 'SM-002/2026', 'Rahasia', false),
          ('${SM(3)}', 'dir_ptep', 'SM-003/2026', 'Biasa', false),
          ('${SM(4)}', 'ditjen', 'SM-004/2026', 'Biasa', true);`);
    holder.db = drizzle(database);
    lookup = await import('../services/export-balasan.js');
    ({ exportService } = await import('../services/export.service.js'));
}, 60_000);
afterAll(async () => { await database?.close(); });

const rows = [
    { id: 'sk-1', unitKerjaId: 'ditjen', balasanUntuk: SM(1) },
    { id: 'sk-2', unitKerjaId: 'ditjen', balasanUntuk: SM(2) },
    { id: 'sk-3', unitKerjaId: 'ditjen', balasanUntuk: SM(3) },
    { id: 'sk-4', unitKerjaId: 'ditjen', balasanUntuk: SM(4) },
    { id: 'sk-5', unitKerjaId: 'ditjen', balasanUntuk: null },
];

describe('Balasan Untuk pada ekspor', () => {
    it('hanya menampilkan nomor surat masuk unit sama dengan kelas yang diizinkan', async () => {
        const labels = await lookup.resolveBalasanLabels(rows, ['biasa', 'terbatas']);
        expect(Object.fromEntries(labels)).toEqual({
            'sk-1': 'SM-001/2026',
            'sk-2': 'Dikecualikan',
            'sk-3': '(lintas unit)',
            'sk-4': '(tidak tersedia)',
        });
        expect((await lookup.resolveBalasanLabels(rows, ['biasa', 'terbatas', 'rahasia', 'sangat_rahasia'])).get('sk-2')).toBe('SM-002/2026');
    });

    it('workbook memakai nomor, bukan UUID, dan memuat kolom Asal Naskah', async () => {
        holder.keluar.mockResolvedValue({
            data: [
                { id: 'sk-1', noUrut: 1, unitKerjaId: 'ditjen', nomorSurat: 'KEL-1', balasanUntuk: SM(1), asalNaskah: 'tindak_lanjut' },
                { id: 'sk-6', noUrut: 2, unitKerjaId: 'ditjen', nomorSurat: 'KEL-2', balasanUntuk: null, asalNaskah: 'inisiatif' },
            ],
            pagination: { total: 2 },
        });
        const buffer = await exportService.generateExcelSuratKeluar({ unitKerjaId: 'ditjen', securityClassifications: ['biasa'] });
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer as any);
        const sheet = workbook.worksheets[0];
        expect(sheet.getRow(4).getCell(10).value).toBe('Balasan Untuk');
        expect(sheet.getRow(4).getCell(11).value).toBe('Asal Naskah');
        expect(sheet.getRow(5).getCell(10).value).toBe('SM-001/2026');
        expect(sheet.getRow(5).getCell(11).value).toBe('Tindak Lanjut');
        expect(sheet.getRow(6).getCell(11).value).toBe('Inisiatif');
        expect(JSON.stringify(sheet.getSheetValues())).not.toContain(SM(1));
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm --prefix backend exec -- vitest run src/__tests__/export-balasan.test.ts`
Expected: FAIL — `Cannot find module '../services/export-balasan.js'`.

- [ ] **Step 3: Implementasi minimal**

```ts
// backend/src/services/export-balasan.ts
import { inArray } from 'drizzle-orm';
import { db } from '../config/database.js';
import { suratMasuk } from '../db/schema/surat-masuk.js';
import { normalizeSecurityClassification } from './record-access.service.js';

export const BALASAN_DIKECUALIKAN = 'Dikecualikan';
export const BALASAN_LINTAS_UNIT = '(lintas unit)';
export const BALASAN_TIDAK_TERSEDIA = '(tidak tersedia)';
export const ASAL_NASKAH_LABEL: Record<string, string> = { inisiatif: 'Inisiatif', tindak_lanjut: 'Tindak Lanjut' };

const CHUNK = 1000;

/**
 * Nomor "Balasan Untuk" per baris surat keluar. Nomor hanya tampil untuk surat
 * masuk hidup milik unit yang sama dengan kelas yang boleh dibaca pengekspor
 * (penyamaran §4.8); selain itu label pengganti, tidak pernah UUID mentah.
 */
export async function resolveBalasanLabels(
    rows: Array<{ id: string; unitKerjaId: string; balasanUntuk?: string | null }>,
    allowedClasses: string[] | null | undefined,
): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((row) => row.balasanUntuk).filter((value): value is string => Boolean(value)))];
    const found = new Map<string, { unitKerjaId: string; nomorSurat: string | null; sifatSurat: string | null; isDeleted: boolean | null }>();
    for (let start = 0; start < ids.length; start += CHUNK) {
        const chunk = await db.select({
            id: suratMasuk.id, unitKerjaId: suratMasuk.unitKerjaId, nomorSurat: suratMasuk.nomorSurat,
            sifatSurat: suratMasuk.sifatSurat, isDeleted: suratMasuk.isDeleted,
        }).from(suratMasuk).where(inArray(suratMasuk.id, ids.slice(start, start + CHUNK)));
        for (const item of chunk) found.set(item.id, item);
    }
    const labels = new Map<string, string>();
    for (const row of rows) {
        if (!row.balasanUntuk) continue;
        const source = found.get(row.balasanUntuk);
        if (!source || source.isDeleted) labels.set(row.id, BALASAN_TIDAK_TERSEDIA);
        else if (source.unitKerjaId !== row.unitKerjaId) labels.set(row.id, BALASAN_LINTAS_UNIT);
        else if (Array.isArray(allowedClasses) && !allowedClasses.includes(normalizeSecurityClassification(source.sifatSurat))) {
            labels.set(row.id, BALASAN_DIKECUALIKAN);
        } else labels.set(row.id, source.nomorSurat || '(tanpa nomor)');
    }
    return labels;
}
```

Di `backend/src/services/export.service.ts`:
1. Tambahkan impor `import { ASAL_NASKAH_LABEL, resolveBalasanLabels } from './export-balasan';`.
2. Ubah komentar JSDoc kolom (:128-131) menjadi `… Tanggal Input, Balasan Untuk (nomor), Asal Naskah, Klasifikasi Arsip, Klasifikasi Kode, Klasifikasi Jenis`.
3. Setelah `const data = requireCompleteExport(result);` di `generateExcelSuratKeluar`, tambahkan:
```ts
        const balasanLabels = await resolveBalasanLabels(data, filters.securityClassifications);
```
4. Ganti `worksheet.mergeCells('A1:M1')` dan `worksheet.mergeCells('A2:M2')` di fungsi ini menjadi `'A1:N1'` dan `'A2:N2'`.
5. Ganti `headers` dan `colWidths`:
```ts
        const headers = [
            'ID', 'No Urut', 'Jenis Surat', 'Nomor Surat', 'Tanggal Surat',
            'Perihal', 'Tujuan', 'Link Dokumen', 'Tanggal Input', 'Balasan Untuk', 'Asal Naskah',
            'Klasifikasi Arsip', 'Klasifikasi Kode', 'Klasifikasi Jenis'
        ];
        const colWidths = [20, 10, 18, 28, 15, 40, 25, 30, 18, 24, 16, 28, 15, 15];
```
6. Pada `rowData`, ganti `item.balasanUntuk || '',` dengan dua elemen:
```ts
                balasanLabels.get(item.id) || '',
                ASAL_NASKAH_LABEL[item.asalNaskah ?? ''] || '',
```
7. Ganti perataan kolom menjadi `cell.alignment = i === 5 || i === 6 || i === 7 || i === 11 ? LEFT_ALIGN : CENTER_ALIGN;`.

- [ ] **Step 4: Jalankan test, pastikan lulus (termasuk regresi ekspor)**

Run: `npm --prefix backend exec -- vitest run src/__tests__/export-balasan.test.ts src/__tests__/export-completeness.test.ts src/__tests__/export-completeness.routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/export-balasan.ts backend/src/services/export.service.ts backend/src/__tests__/export-balasan.test.ts
git commit -m "feat(export): show masked Balasan Untuk number and Asal Naskah column

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


#### Amandemen pra-eksekusi Task 12 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p5-data-lama-pelengkap/preflight-rulings.md`.


1. **Document "Balasan Untuk" (ADVISORY) [P5-T12-1] RECHECK-AFTER-P3.** No code change. In Task 13's PANDUAN 11.8 text, add: "Sejak integrasi rangkaian, kolom ini hanya terisi untuk balasan dari unit yang sama; rantai lintas unit terlihat di panel Alur Surat."
   - **(delta P3) Confirmed.** The P3 create path writes `balasan_untuk` only for a same-unit `balasan` to a surat masuk (`rangkaian/tindak-lanjut.service.ts:316-319`). The legacy PUT (`surat-keluar.routes.ts:336-357`) is also restricted to the same unit. `batalRelasi` clears it when the matching relasi is cancelled (`rangkaian-link.service.ts:326-332`), so the sentence is accurate. Add a clause: "dan dikosongkan bila relasi balasannya dibatalkan".



### Task 13: PANDUAN, dokumen manajemen surat, dan runbook backfill

**Files:**
- Modify: `PANDUAN_PENGGUNAAN_SIMSA.md` (Daftar Isi :10-44; bagian 5.3 :448-466; sisipkan 5.4 dan 5.5 sebelum `## 6.`; 6.2 Dosir :522; 11.1 Notifikasi :883; 11.8 Ekspor :972)
- Create: `docs/manajemen-surat/rangkaian-surat.md`
- Modify: `docs/manajemen-surat/distribusi.md`, `docs/manajemen-surat/surat-keluar.md`, `docs/manajemen-surat/surat-masuk.md`, `docs/SUMMARY.md` (:23-25), `docs/OPERASIONAL_BACKEND.md`
- Test: `backend/src/__tests__/panduan-rangkaian.docs.test.ts`

**Interfaces:**
- Consumes: nama fitur dari Task 5–12 dan spec §7–§9.
- Produces: dokumentasi pengguna dan runbook operator.

- [ ] **Step 1: Tulis test yang gagal**

```ts
// backend/src/__tests__/panduan-rangkaian.docs.test.ts
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
        const runbook = read('docs/OPERASIONAL_BACKEND.md');
        expect(runbook).toContain('rangkaian:backfill-lama:plan');
        expect(runbook).toContain('--approved-sha256=');
        expect(runbook).toContain('RANGKAIAN_DISPOSISI_LAMA_READ');
        expect(runbook).toContain('0048_rangkaian_pengerasan');
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm --prefix backend exec -- vitest run src/__tests__/panduan-rangkaian.docs.test.ts`
Expected: FAIL — `expected … to contain '### 5.4 Rangkaian Surat & Lacak Surat'` dan berkas `rangkaian-surat.md` tidak ada.

- [ ] **Step 3: Tulis dokumentasi**

Di Daftar Isi PANDUAN, di bawah `- 5.3 Distribusi Surat`, tambahkan:

```markdown
   - 5.4 Rangkaian Surat & Lacak Surat
   - 5.5 Berkas Rangkaian, Koreksi Berkas & Data Lama
```

Pada 5.3 Distribusi Surat, tambahkan setelah daftar langkah (sebelum diagram):

```markdown
Setiap disposisi dapat diberi **batas waktu**. Notifikasi kategori Distribusi menjadi **mendesak** (merah) bila batas waktu tinggal 2 hari atau kurang, pada hari-H, atau sudah **lewat batas waktu**. Filter "lewat batas waktu" di Kotak Disposisi menampilkan baris yang terlambat.
```

Sisipkan sebelum `## 6. Siklus Hidup Arsip`:

```markdown
### 5.4 Rangkaian Surat & Lacak Surat

**Rangkaian Surat** menghimpun surat masuk, disposisi, tindak lanjut, dan surat keluar dalam satu urusan dengan kode `RS-YYYY-NNNNNN`. Panel **Alur Surat** di detail surat menampilkan pencatat → pengolah, status tindak lanjut per penerima, linimasa, dan rangkaian terkait. Node yang tidak boleh Anda baca tampil abu-abu bertuliskan "Dikecualikan".

- **Lacak Surat** (menu Surat ▸ Lacak Surat): ketik nomor atau perihal (minimal 3 karakter). Hasil dikelompokkan per rangkaian dengan pratinjau rantai.
- **Surat Inisiatif**: Surat Keluar ▸ Buat Surat Inisiatif memulai surat keluar tanpa induk surat masuk; kolom **Asal Naskah** mencatat `Inisiatif` atau `Tindak Lanjut`.
- Tulis hanya untuk admin di unit yang berwenang; membuka detail lintas unit tidak pernah mengubah status disposisi.

### 5.5 Berkas Rangkaian, Koreksi Berkas & Data Lama

**Berkaskan ke Direktorat (Unit Pengolah).** Setelah rangkaian selesai, admin unit pengolah, pencatat, atau pengawas memilih unit pengolah (hanya dari unit yang sudah terlibat) dan klasifikasi berkas, lalu mengonfirmasi dua kali. Rangkaian menjadi *diberkaskan*, dikunci sistem, dan tampil di tab **Berkas Rangkaian** unit pengolah. Berkas Rangkaian adalah berkas naskah; Dosir adalah map kasus manual dan tidak dipakai untuk pemberkasan rangkaian.

**Bukti penutupan berkas.** Panel Alur Surat menampilkan "Bukti penutupan berkas: RS-…, tgl …". Gunakan tanggal dan kode itu sebagai *evidence* saat mencatat pemicu retensi `berkas_ditutup`/`kegiatan_selesai` pada arsip anggota; pemberkasan tidak memulai retensi secara otomatis.

**Koreksi Berkas.** Status diberkaskan tidak dapat dibuka kembali. Bila unit pengolah atau klasifikasi salah pilih:
1. Super admin membuka panel Alur Surat ▸ **Koreksi Berkas**, memilih unit/klasifikasi baru, menulis alasan (minimal 10 karakter), memeriksa ringkasan, lalu **Ajukan Koreksi Berkas**.
2. Seorang **super_admin lain** membuka rangkaian yang sama dan memilih **Setujui** (lalu **Ya, terapkan koreksi**) atau **Tolak**. Pengaju tidak dapat memutuskan koreksinya sendiri.
3. Hanya perubahan yang disetujui yang diterapkan, persis sesuai usulan, dan seluruh langkah tercatat di Audit Log.

**Data lama.** Surat dari aplikasi lama dengan label disposisi (misalnya "BPPT", "Dit. PTEP") dirangkai sebagai rangkaian *data lama* berstatus selesai dan disembunyikan dari daftar kerja. Label "Kabag …" hanya label, tidak pernah menjadi tujuan disposisi. Direktorat pada label lama baru dapat membaca surat tersebut setelah pemilik keamanan menyetujui laporan pemetaan.

**Tutup massal data lama** (super admin dan admin unit pengawas): tab Berkas Rangkaian ▸ pilih tahun (opsional) dan klasifikasi pengganti untuk rangkaian tanpa klasifikasi ▸ **Pratinjau** ▸ centang pernyataan ▸ **Tutup massal N rangkaian**. Bila jumlah berubah sejak pratinjau, sistem menolak dan Anda perlu mengulang pratinjau.
```

Pada 6.2 Pemberkasan (Dosir), tambahkan kalimat: `Untuk berkas naskah surat masuk–keluar gunakan Berkas Rangkaian (5.5); Dosir tetap map kasus manual.`

Pada 11.1 Notifikasi, tambahkan butir: `- **Distribusi**: mendesak bila batas waktu disposisi ≤ 2 hari, hari ini, atau lewat batas waktu. Surat data lama yang sudah ditutup tidak dinotifikasi.`

Ganti isi 11.8 Ekspor Data dengan:

```markdown
### 11.8 Ekspor Data
- Pada halaman daftar surat/arsip, klik tombol **"Ekspor"** untuk mengunduh data dalam format PDF, Excel, atau CSV.
- Ekspor Excel Surat Keluar menampilkan **Balasan Untuk** sebagai nomor surat masuk (bukan kode internal). Bila surat masuk berada di unit lain tertulis `(lintas unit)`, bila kelasnya tidak boleh Anda baca tertulis `Dikecualikan`, dan bila sudah dihapus tertulis `(tidak tersedia)`. Kolom **Asal Naskah** berisi `Inisiatif` atau `Tindak Lanjut`.
```

`docs/manajemen-surat/rangkaian-surat.md`:

```markdown
# 🧵 Rangkaian Surat

Rangkaian Surat menyatukan surat masuk, disposisi, tindak lanjut, dan surat keluar dalam satu berkas naskah berkode `RS-YYYY-NNNNNN`.

## Melacak Rangkaian
1. Buka **Surat ▸ Lacak Surat**.
2. Ketik nomor atau perihal (minimal 3 karakter).
3. Klik kartu rangkaian untuk melihat panel **Alur Surat**.

## Memberkaskan ke Direktorat
1. Pastikan tidak ada disposisi terbuka dan tidak ada surat keluar draf/menunggu/ditolak di rangkaian.
2. Klik **Berkaskan ke Direktorat (Unit Pengolah)**, pilih unit pengolah dan klasifikasi, lalu konfirmasi dua kali.

## Koreksi Berkas
Super admin mengajukan koreksi unit pengolah/klasifikasi dengan alasan minimal 10 karakter; super admin **lain** menyetujui atau menolak. Status diberkaskan sendiri tidak dapat dibuka kembali.

## Surat data lama
Surat dari aplikasi lama dirangkai sebagai data lama berstatus selesai. Label Kabag tetap label saja. Super admin atau admin unit pengawas dapat memakai **Tutup massal data lama** di tab Berkas Rangkaian setelah melihat pratinjau.
```

`docs/SUMMARY.md`: setelah baris `* [🔄 Distribusi Surat](manajemen-surat/distribusi.md)` tambahkan `* [🧵 Rangkaian Surat](manajemen-surat/rangkaian-surat.md)`.

`docs/manajemen-surat/distribusi.md`: di bawah `### Langkah 3: Pilih Tujuan` tambahkan `Batas waktu (opsional) menentukan urgensi notifikasi: mendesak saat tersisa 2 hari atau kurang dan saat lewat batas waktu.`

`docs/manajemen-surat/surat-keluar.md`: di bawah `## Menambah Surat Keluar Baru` tambahkan `Pilih **Buat Surat Inisiatif** untuk surat tanpa surat masuk induk, atau **Tindak Lanjut Surat Masuk…** untuk membalas. Kolom ekspor **Asal Naskah** mencatat pilihan ini.`

`docs/manajemen-surat/surat-masuk.md`: di bawah `### Tombol Aksi di Detail:` tambahkan `- **Alur Surat**: menampilkan rangkaian, disposisi, dan tindak lanjut surat ini (lihat [Rangkaian Surat](rangkaian-surat.md)).`

`docs/OPERASIONAL_BACKEND.md`: tambahkan bagian baru di akhir:

```markdown
## Integrasi Surat P5: pengerasan dan backfill data lama

1. Pastikan backfill langkah 1 tuntas: `SELECT count(*) FROM surat_distributions WHERE rangkaian_id IS NULL` harus 0.
2. `npm --prefix backend run db:migrate` menerapkan `0048_rangkaian_pengerasan` (gagal dengan pesan jelas bila langkah 1 belum tuntas), lalu segera `db:grants:converge` dengan `EXPECTED_MIGRATIONS_JSON` terbaru.
3. Dry-run: `npm --prefix backend run rangkaian:backfill-lama:plan -- --out=laporan-rangkaian-lama`. Kirim `pemetaan-label.csv`, `balasan-ditinjau.csv`, dan `ringkasan.json` (berisi SHA-256) ke pemilik keamanan. Jangan commit laporan ini.
4. Setelah sign-off tertulis atas SHA-256 tersebut: `npm --prefix backend run rangkaian:backfill-lama:apply -- --approved-sha256=<sha256>`. Bila data berubah sejak dry-run, skrip menolak; ulangi langkah 3.
5. Skrip idempoten dan dapat dijalankan ulang. Peserta yang sudah dicabut tidak dihidupkan kembali.
6. Nyalakan `RANGKAIAN_DISPOSISI_LAMA_READ=true` hanya setelah sign-off terpisah; sampai saat itu peserta data lama tidak memberi akses baca.
7. Baris `lintas_unit_ditinjau_tu` pada `balasan-ditinjau.csv` diserahkan ke TU untuk ditautkan manual lewat **Tautkan ke Rangkaian**.
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npm --prefix backend exec -- vitest run src/__tests__/panduan-rangkaian.docs.test.ts`
Expected: PASS (3 test).

- [ ] **Step 5: Commit**

```bash
git add PANDUAN_PENGGUNAAN_SIMSA.md docs/manajemen-surat/rangkaian-surat.md docs/manajemen-surat/distribusi.md docs/manajemen-surat/surat-keluar.md docs/manajemen-surat/surat-masuk.md docs/SUMMARY.md docs/OPERASIONAL_BACKEND.md backend/src/__tests__/panduan-rangkaian.docs.test.ts
git commit -m "docs(rangkaian): user guide for berkas correction, legacy data and exports; backfill runbook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


#### Amandemen pra-eksekusi Task 13 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p5-data-lama-pelengkap/preflight-rulings.md`.


1. **Dedicated runbook (REQUIRED) [P5-T13-1].**
   - Files: create `docs/RUNBOOK_INTEGRASI_SURAT_P5.md`. `docs/OPERASIONAL_BACKEND.md` gets only a pointer paragraph.
   - The runbook has these sections:
     1. Prasyarat: pre-flight P0 §13 Q2 answered in writing. If there is no legacy data, stop after step 3.
     2. Backup.
     3. Pre-0048 checks, run as `simsa_api` via the hidden prompt:
        - `SELECT count(*) FROM surat_distributions WHERE rangkaian_id IS NULL` = 0.
        - The P3 `dilewati` list is empty or decided.
     4. `scripts/neon-database.mjs migrate --apply`, then `verify-runtime` (0048).
     5. Dry-run with `--out=<dir di luar repo>` as `simsa_api` over `NEON_RUNTIME_DATABASE_URL`. Record `batasDataLama`. Send the 4 files, including `calon-pengolah.csv`.
     6. Written sign-off of the SHA.
     7. `--apply --approved-sha256=<sha>`. If it stops midway, do a new dry-run and a new sign-off.
     8. Enable the flag separately, after a separate sign-off. Pengolah candidates are applied after that sign-off through Ubah Unit Pengolah or Koreksi Berkas.
     9. Rollback: redeploy the previous code. The data stays read-compatible.
   - The Task 13 docs test reads this runbook.
2. **Docs test (REQUIRED) [P5-T13-3].** Assert that the runbook contains `simsa_api`, `NEON_RUNTIME_DATABASE_URL`, `neon-database.mjs migrate --apply`, `RANGKAIAN_DATA_LAMA_SEBELUM`, and the npm script names actually used.
3. **D7 user docs (ADVISORY) [P5-T13-2].** Add a PANDUAN subsection "Perlu Dilengkapi" covering the tab, the six categories, the badge and Tandai Inisiatif, with one docs-test assertion.
4. **Existing appendix text.** Replace the plan's `OPERASIONAL_BACKEND.md` steps 2–4 with the pointer. The Cloud-SQL-style `npm --prefix backend run db:migrate` / `db:grants:converge` lines do not apply to production Neon.
5. **(delta P3) Carry-forwards from the P3 final reviews (REQUIRED to document; one ADVISORY code option).**
   - **Step-1 existing path is unaudited** (P3 spec review "Audit enrichment on the backfill's existing-rangkaian path"; concurrency #16).
     - P3 `backfill-rangkaian-disposisi.mjs:109-111` fills `rangkaian_id` on the existing-rangkaian path without an `audit_log` row. Only new rangkaian are audited (:103-106).
     - The P5 runbook pre-flight states this: run a `rangkaian_id`-change query on `surat_distributions.updated_at` if an audit trail is needed.
     - ADVISORY: patch P3's script to write one `audit_log` row per batch per existing rangkaian (`action 'update'`, `changes: { langkah: 'backfill-1', distribusiDiisi }`). Idempotent re-runs write nothing, because `rowCount` is 0.
   - **Step-1 re-run guidance** (P3 concurrency M3, in the fix wave). Re-run exit ≠ 0 with 40P01/40001 as-is, since the script is idempotent. The P5 runbook points to the P3 runbook section after the fix wave, and does not restate it.
   - **`--apply` wording** (P3 ledger Task 2, `progress.md:43`). P3 `db:backfill:rangkaian-disposisi` has no `--apply`/dry-run mode; every run writes. The P5 runbook and the 0048 message name it without flags (Task 1 item 5 already does). P5's own script keeps its `--apply` flag.
   - **Anchor for the P3 runbook edit (critic C-5 item 9), in flux.** At b4d86fa, §6 reads "Redeploy P2. … kolom `rangkaian_id` … diabaikan oleh P2" (`RUNBOOK_INTEGRASI_SURAT_P3.md:129-133`). The fix wave (S-I2) rewrites it: the floor becomes the last deployed production release with schema 0047 kept, and the wrong "P2 ignores" claim is removed. Append the P5 sentence "tidak berlaku setelah 0048 diterapkan; lantai rollback setelah 0048 adalah kode P3+" to the **post-fix** §6, anchored by its heading `## 6. Rollback`, not by the old text. Production has never run P1/P2, so the pre-integration release that the fix wave names also writes NULL `rangkaian_id` and is invalid after 0048.


**C-1 (critic) — Tasks 5, 13: the backfill entry point must not fall back to `backend/.env` — REQUIRED (security/ops) [P5-C-1]**


- P5:1253-1255: `main()` runs `dotenv.config()` before checking `DATABASE_URL`. Two consequences:
  - An operator who forgets the shell export silently targets whatever `backend/.env` holds: a dev DB, or production through a non-runtime role.
  - The P5-G-5 resolver then reads a `RANGKAIAN_DATA_LAMA_SEBELUM` from that file.
  - P5-T5-5 only adds a comment, so neither is prevented.
- Real P3 fixed exactly this for step 1:
  - `backfill-rangkaian-disposisi.mjs:136-145` [F3] captures `DATABASE_URL` before `dotenv.config` and throws without it;
  - `:33-36` logs `current_user`/`current_database()` before the first batch.
- Binding shape of `main()`, merged with Task 4 item 3 and Task 5 item 5:
  ```js
  async function main() {
    // [F3] pola P3: nilai shell ditangkap SEBELUM dotenv; skrip ini tidak memakai fallback backend/.env.
    const urlShell = process.env.DATABASE_URL?.trim();
    const batasShell = process.env.RANGKAIAN_DATA_LAMA_SEBELUM?.trim();
    dotenv.config({ quiet: true });
    if (!urlShell) throw new Error('DATABASE_URL harus diset eksplisit di shell (NEON_RUNTIME_DATABASE_URL, role simsa_api); skrip ini tidak memakai backend/.env');
    const options = parseArgs(process.argv.slice(2));
    const client = new Client({ connectionString: urlShell, connectionTimeoutMillis: 10_000 });
    await client.connect();
    try {
      const { rows: [identitas] } = await client.query('SELECT current_user AS db_user, current_database() AS db_name');
      const batas = await resolveBatasDataLama(client, { RANGKAIAN_DATA_LAMA_SEBELUM: batasShell });
      console.log(JSON.stringify({ dbUser: identitas.db_user, dbName: identitas.db_name, batasDataLama: batas, sumberBatas: batasShell ? 'env' : 'db' }));
      if (options.apply && !batasShell) {
        throw new Error('--apply mewajibkan RANGKAIAN_DATA_LAMA_SEBELUM di shell, sama persis dengan nilai Vercel (runbook Deploy P4)');
      }
      // lanjut: buildPlan(client, { batas }), writePlanFiles, applyPlan(client, { approvedSha256, batas }) seperti amandemen Task 4/5.
    } finally {
      await client.end();
    }
  }
  ```
- Drop the `dotenv` import entirely if no other variable needs it.
- **(delta P3) Confirmed on b4d86fa.** The [F3] capture before `dotenv.config` is at `backfill-rangkaian-disposisi.mjs:136-145`, and the identity log at :34-36. The P3 script only logs, and does not refuse a wrong role (ledger `progress.md:48`). The binding shape above, which prints the first JSON line and has the runbook stop when `dbUser` ≠ `simsa_api`, stays. Optionally fail closed in code: `if (identitas.db_user !== 'simsa_api' && process.env.ALLOW_NON_RUNTIME_ROLE !== '1') throw …`.
- Runbook: stop if the first JSON line shows a `dbUser` other than `simsa_api` or the wrong `dbName`. This is the same rule as the P3 runbook §4.
- Test: `--apply` without the shell env throws, run through an exported helper that wraps the check.


**C-2 (critic) — Tasks 4, 5, 7, 13: the deferred pengolah has no executable path — REQUIRED (spec:358; contradicts the "Cost if wrong" of P5-T5-1 and runbook step 8 of P5-T13-1) [P5-C-2]**


- **Ubah Unit Pengolah cannot apply it.** P3 `berkasService.ubahUnitPengolah` accepts only a unit in `unitDalamJangkauanBerkas` (P3:6591-6597). That set is the non-rejected distribution targets plus the anggota units (P3:6485-6492; spec §9).
  - `disposisi_lama` peserta are not in it.
  - A backfilled `data_lama` rangkaian has no distribution to its label units.
- **Koreksi Berkas cannot apply it either.** After P5-T6-1 it uses the same predicate and answers 422.
- So "through P3 Ubah Unit Pengolah or a Koreksi" (P5-T5-1) and runbook step 8 (P5-T13-1) cannot apply `calonUnitPengolah`.
- **(delta P3) Confirmed on real code.** `ubahUnitPengolah` refuses any unit outside `unitDalamJangkauanBerkas` with 422 "Disposisikan dulu ke unit ini" (`berkas.service.ts:217-224`). That set is the non-rejected distribution targets plus the live anggota units (:69-83), with no peserta branch. Ubah is also limited to `aktif`/`selesai` (:221).
- **Tutup massal then locks the choice in.** It files every `data_lama` rangkaian with `coalesce(rs.unit_pengolah_id, rs.unit_pencatat_id)` (P5:1844, 1878), and `diberkaskan` is terminal (`0046_rangkaian_surat.sql:331-346`). Spec:358 is thereby abandoned permanently and silently.
- Binding:
  1. **Two outcomes for release-gate row (a)** (P5-G-6):
     - "isi": apply the label-derived pengolah per spec:358, after the security owner signs `calon-pengolah.csv`;
     - "tidak": spec:358 is waived, and the berkas go to the pencatat.
  2. **A pengolah mode in the backfill script**, SHA-bound: either as an `--isi-pengolah` option of `--apply` (the chosen mode is part of the SHA payload), or as a separate later run `--isi-pengolah --approved-sha256=<sha>`. For each `calonPengolah` row (already in the Task 4 payload) whose rangkaian still has `asal='data_lama' AND status='selesai' AND unit_pengolah_id IS NULL`:
     - lock by id (`ORDER BY id FOR UPDATE`) and set `unit_pengolah_id`;
     - write one audit row: `action: 'update'`, `changes: { before: { unitPengolahId: null }, after: { unitPengolahId }, sumber: 'backfill-rangkaian-lama', aksesBaru: [unit] }`;
     - refuse on an SHA mismatch.

     Tests: S1 gets `dir_bppt`; a second run changes nothing; a `diberkaskan` row or one with a non-NULL pengolah is skipped.
  3. **Runbook order:** `--apply` → decision on gate (a) → pengolah mode if the decision is "isi" → only then Tutup massal of data lama.
     - The Task 10 UI copy and PANDUAN (P5:3165) state that Tutup massal files a berkas with no pengolah to the pencatat.
  4. **Access is not flag-controlled.** The runbook states that pengolah access is not controlled by the flag: after the pengolah mode runs, unsetting `RANGKAIAN_DISPOSISI_LAMA_READ` no longer revokes it (`visibility-spec.ts:130-131`).


**C-3 (critic) — Tasks 1, 13: `dilewati` rows cannot be remediated at runtime — REQUIRED [P5-C-3]**


- **No application role can fix these rows.** `surat_distributions_closed_guard` is `BEFORE INSERT OR UPDATE OR DELETE` (0046:406-408), and it resolves candidate rangkaian through the SM's anggota rows (0046:278-296). No role can therefore fill, change or delete the `rangkaian_id` of a distribution whose SM is an anggota of a `diberkaskan` rangkaian.
- **The release blocks indefinitely.** Real P3 step 1 skips such rows (`dilewati`, the C-6 branch in `backfill-rangkaian-disposisi.mjs`), so the 0048 precheck (P5 Task 1 Step 5) would block the release indefinitely.
- **The owner decision in P5-T1-5 is not executable.** P5-T1-5 asks for "an owner decision" but names no option that can be carried out.
- **Content:** by construction these rows are `processed`/`rejected`. P3 berkaskan refuses open disposisi, including NULL rows, through the C-6 `disposisiTerbukaSql` (P3:5980-5987), so filling `rangkaian_id` only records existing membership.
- **(delta P3) Confirmed on real code, and the P3 reviews corrected.**
  - `rangkaian_guard_closed()` (`0046_rangkaian_surat.sql:257-312`) has **no** GUC bypass. It collects candidate rangkaian through the SM's anggota rows (:276-290), and only `rangkaian_guard_status()` honours `simsa.berkas_koreksi` (:343). So the P3 final reviews' "stay NULL until Koreksi Berkas or a GUC path exists" (concurrency carry-forward 3) and "Koreksi Berkas is the only exit" (spec review) are both wrong: Koreksi Berkas changes `rangkaian_surat`, never `surat_distributions`. This amendment's options (i)/(ii) remain the only executable ones.
  - The real script skips two statuses, not one: `if (rs.status !== 'aktif' && rs.status !== 'selesai')` (`backfill-rangkaian-disposisi.mjs:72-73`), so a `dilewati` entry can also be `digabung`. That only happens when a concurrent gabung moved the anggota between the unlocked membership read (:59-61) and the lock. It is transient, and a plain re-run attaches the row to the gabung target.
  - The pre-0048 listing query above already shows the current membership status. Filter it with `AND r.status = 'diberkaskan'` for the decision on gate row (f), and re-run the step-1 script for the rest.
- Binding:
  - The runbook pre-0048 step lists the rows:
    ```sql
    SELECT d.id, d.surat_masuk_id, d.status, a.rangkaian_id, r.status AS status_rangkaian
      FROM surat_distributions d
      JOIN rangkaian_anggota a ON a.surat_masuk_id = d.surat_masuk_id
      JOIN rangkaian_surat r ON r.id = a.rangkaian_id
     WHERE d.rangkaian_id IS NULL;
    ```
  - The owner chooses, recorded as a new release-gate row (f):
    - **(i)** hold 0048: P5 ships without the hardening, and the Koreksi uniqueness index is absent until it lands;
    - **(ii)** a reviewed prelude at the top of 0048, executed by the migration owner (`simsa_migrator`) in the migration transaction:
      ```sql
      ALTER TABLE surat_distributions DISABLE TRIGGER surat_distributions_closed_guard;
      UPDATE surat_distributions d SET rangkaian_id = a.rangkaian_id, updated_at = now()
        FROM rangkaian_anggota a
       WHERE d.rangkaian_id IS NULL AND a.surat_masuk_id = d.surat_masuk_id;
      ALTER TABLE surat_distributions ENABLE TRIGGER surat_distributions_closed_guard;
      ```
      Add one `audit_log` insert per filled row. Put this before the NULL precheck.
  - Test for option (ii): a PGlite case seeds a NULL `processed` row on a `diberkaskan` member SM with `stopBefore: '0048_rangkaian_pengerasan'`, then applies 0048. The row is filled, the trigger is enabled afterwards (`pg_trigger.tgenabled = 'O'`), and one audit row exists.


**C-5 (critic) — Task 13: runbook completeness — REQUIRED (production readiness) [P5-C-5]**


Add to `docs/RUNBOOK_INTEGRASI_SURAT_P5.md` (P5-T13-1), in this order:
1. **Backup.**
   - Follow `docs/BACKUP_NEON.md`, using the helper of the checkout currently in production (pre-0048).
   - Backups after 0048 need the P5 checkout, because the bundle manifest binds the migration chain (`scripts/neon-backup-core.mjs:43-58`).
2. **Deploy P5 code with `RANGKAIAN_DISPOSISI_LAMA_READ` unset.** This is the P5-G-8 order; the amended section list omits the code deploy.
   - Confirm the flag is not `true` in the Vercel backend env **before `--apply`**.
   - Production code has honoured it since P2 (`visibility-spec.ts:277-279`), so a pre-set flag makes every new peserta row grant access as soon as it is written, before the flag sign-off.
3. **Pre-0048 query and the `dilewati` decision** (C-3).
4. **Migrate.**
   - Run `scripts/neon-database.mjs migrate --apply` and then `verify-runtime`.
   - Then run the `simsa_api` privilege queries of `RUNBOOK_INTEGRASI_SURAT_P1.md` step 4. `verify-runtime` does not check the `rangkaian_*` tables.
5. **Dry-run and apply.**
   - Use the P3 runbook §4 shell block: `export DATABASE_URL="$NEON_RUNTIME_DATABASE_URL"`. The P1 block fills `NEON_QUERY_DATABASE_URL`, which the Node script does not read.
   - Also `export RANGKAIAN_DATA_LAMA_SEBELUM='<nilai tercatat di runbook Deploy P4>'` (P4 critic C-6).
   - Check the first JSON line (C-1).
   - Confirm `SHOW TimeZone` is `UTC` for `simsa_api` (P4-T22-3). `surat_masuk.created_at` is `timestamp` (`db/schema/surat-masuk.ts:36`) and is compared with `$::timestamptz`.
6. **SHA stability.**
   - The SHA covers state evaluated at apply time: `sudah_anggota`, the totals, and now `sudah_didisposisikan` (P5:959, 1219-1221).
   - Any of these between dry-run and apply forces a new dry-run and sign-off: an edit of legacy labels, a new disposisi, or a tautan.
   - Run dry-run → sign-off → apply within one short window.
7. **Gate (a).** Decide gate (a) and run the pengolah mode (C-2) before any Tutup massal of data lama.
8. **Flag enable and rollback.**
   - Enabling the flag means setting the env var **and redeploying**; Vercel applies env only to new deployments.
   - Flag rollback means unset and redeploy. That revokes all cross-unit access derived from the backfill only while the pengolah is still NULL (C-2 item 4).
9. **Rollback floor after 0048 is P3 code.**
   - P2's `POST /api/distributions` writes a NULL `rangkaian_id` (P3 runbook §2), which 0048 rejects with 23502.
   - Update the P3 runbook §6 ("Redeploy P2") with "tidak berlaku setelah 0048 diterapkan".
   - **(delta P3) In flux.** The fix wave (S-I2) rewrites P3 §6: the floor becomes "last deployed production release with schema 0047 kept", and the "P2 ignores `rangkaian_id`" claim is removed. Anchor on the heading `## 6. Rollback` of the post-fix file and add the 0048 sentence there (Task 13 item 5). The conclusion does not change: after 0048 only P3+ code is a valid rollback target, because every earlier release inserts distributions without `rangkaian_id`.
   - A schema rollback is a forward migration `ALTER COLUMN rangkaian_id DROP NOT NULL`, never a manual edit.

The docs test (P5-T13-3) also asserts:
- `RANGKAIAN_DISPOSISI_LAMA_READ`;
- `export DATABASE_URL="$NEON_RUNTIME_DATABASE_URL"`;
- the rollback-floor sentence.



### Task 14 (OPSIONAL, BERGERBANG): pg_trgm untuk Lacak

> **Gerbang — kerjakan HANYA bila kedua syarat terpenuhi dan tercatat di PR:** (a) pengukuran P4 (EXPLAIN pada 50 ribu baris sintetis) menunjukkan p95 `/api/rangkaian/lacak` > 150 ms; (b) pemilik database menyetujui siapa yang menjalankan langkah privileged satu kali di Neon (spec §13 pertanyaan 3). Bila salah satu tidak terpenuhi, lewati task ini seluruhnya. Setelah `0049` dijurnal, **setiap** lingkungan (demo, lokal, preview, prod) wajib memasang `pg_trgm` sebelum `db:migrate`.

**Files:**
- Create: `backend/src/db/grants/0003_optional_pg_trgm.sql` (dijalankan administrator grant via psql, pola `grants/0001:353-380`)
- Create: `backend/src/db/migrations/0049_lacak_trgm.sql`; Modify: `_journal.json` (idx 49, `when` 1789397420667)
- Modify: `scripts/neon-database-policy.mjs` (:60, bootstrap Neon baru), `backend/src/__tests__/database-role-policy.test.ts`
- Modify: setiap test PGlite yang menjalankan rantai penuh: `backend/src/__tests__/migration-chain.integration.test.ts`, `backend/src/__tests__/helpers/rangkaian-p5-pglite.ts`, harness Postgres P3 `backend/integration/helpers/rangkaian-db.ts` (butuh `pg_trgm` terpasang di database uji), `backend/src/__tests__/bulk-upload.service.integration.test.ts`, `backend/src/__tests__/regulatory-governance.migration.test.ts`, `backend/src/__tests__/retention-governance.migration.test.ts`, `scripts/neon-database-policy.test.mjs`

**Interfaces:**
- Consumes (P1): ekspresi indeks `lower(regexp_replace(coalesce(nomor_surat,''),'[^0-9A-Za-z]+','','g'))`.
- Produces: indeks `surat_masuk_nomor_norm_trgm_idx`, `surat_keluar_nomor_norm_trgm_idx`, `surat_masuk_perihal_trgm_idx`, `surat_keluar_perihal_trgm_idx`. Kode pencarian tidak berubah.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `database-role-policy.test.ts` (di `describe` yang sudah memuat `bootstrapSql`):

```ts
    it('memasang pg_trgm opsional hanya lewat langkah privileged yang diverifikasi', () => {
        const trgm = fs.readFileSync(path.resolve(process.cwd(), 'src/db/grants/0003_optional_pg_trgm.sql'), 'utf8');
        expect(trgm).toContain('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public');
        expect(trgm).toContain('extension_record.extversion <> extension_record.default_version');
        const migration = fs.readFileSync(path.resolve(process.cwd(), 'src/db/migrations/0049_lacak_trgm.sql'), 'utf8');
        expect(migration).not.toMatch(/CREATE\s+EXTENSION/i);
        expect(migration).toContain("RAISE EXCEPTION '0049: extension pg_trgm belum dipasang");
    });
```

(Pastikan `fs` dan `path` diimpor di berkas test tersebut; bila belum, tambahkan `import fs from 'node:fs'; import path from 'node:path';`.)

Tambahkan di `migration-chain.integration.test.ts`:

```ts
    it('0049 gagal keras bila pg_trgm belum dipasang', async () => {
        const database = new PGlite({ extensions: { pgcrypto } });
        openDatabases.push(database);
        await database.waitReady;
        await database.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto');
        await enterTestMigratorRole(database);
        for (const entry of journal.entries) {
            if (entry.tag === '0049_lacak_trgm') {
                await expect(applyMigration(database, entry)).rejects.toThrow(/0049: extension pg_trgm belum dipasang/);
                return;
            }
            await applyMigration(database, entry);
        }
        throw new Error('0049_lacak_trgm tidak dijurnal');
    }, PGLITE_MIGRATION_TIMEOUT_MS);
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm --prefix backend exec -- vitest run src/__tests__/database-role-policy.test.ts src/__tests__/migration-chain.integration.test.ts -t "pg_trgm|0049"`
Expected: FAIL — `ENOENT … 0003_optional_pg_trgm.sql` dan `0049_lacak_trgm tidak dijurnal`.

- [ ] **Step 3: Implementasi**

`backend/src/db/grants/0003_optional_pg_trgm.sql`:

```sql
-- Langkah privileged satu kali (opsional) untuk indeks trigram Lacak Surat.
-- Dijalankan oleh administrator grant (pemilik database), BUKAN migrator:
--   psql "$GRANT_ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/src/db/grants/0003_optional_pg_trgm.sql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
DO $trgm_preflight$
DECLARE
    extension_record record;
BEGIN
    SELECT e.extversion,
           available.default_version,
           n.nspname AS schema_name,
           pg_catalog.pg_get_userbyid(e.extowner) AS owner_name
    INTO extension_record
    FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
    JOIN pg_catalog.pg_available_extensions available ON available.name = e.extname
    WHERE e.extname = 'pg_trgm';

    IF NOT FOUND
       OR extension_record.extversion <> extension_record.default_version
       OR extension_record.schema_name <> 'public'
       OR extension_record.owner_name <> current_user THEN
        RAISE EXCEPTION 'pg_trgm must use the engine default version in public and be owned by the grant administrator';
    END IF;
END
$trgm_preflight$;
COMMIT;
```

`backend/src/db/migrations/0049_lacak_trgm.sql` (LF):

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    RAISE EXCEPTION '0049: extension pg_trgm belum dipasang; jalankan langkah privileged backend/src/db/grants/0003_optional_pg_trgm.sql dulu';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX surat_masuk_nomor_norm_trgm_idx ON surat_masuk
  USING gin ((lower(regexp_replace(coalesce(nomor_surat,''),'[^0-9A-Za-z]+','','g'))) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX surat_keluar_nomor_norm_trgm_idx ON surat_keluar
  USING gin ((lower(regexp_replace(coalesce(nomor_surat,''),'[^0-9A-Za-z]+','','g'))) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX surat_masuk_perihal_trgm_idx ON surat_masuk USING gin ((lower(perihal)) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX surat_keluar_perihal_trgm_idx ON surat_keluar USING gin ((lower(perihal)) gin_trgm_ops);
```

Entri journal:

```json
    {
      "idx": 49,
      "version": "7",
      "when": 1789397420667,
      "tag": "0049_lacak_trgm",
      "breakpoints": true
    }
```

Di `scripts/neon-database-policy.mjs`, tepat setelah baris `await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public');` tambahkan `await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public');`.

Pada setiap test PGlite rantai penuh di daftar **Files** (kecuali test "0049 gagal keras" di atas): tambahkan `import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';` (di `.mjs`: `const { pg_trgm } = requireBackend('@electric-sql/pglite/contrib/pg_trgm');`), ubah konstruktor menjadi `new PGlite({ extensions: { pgcrypto, pg_trgm } })`, dan tambahkan `await database.exec('CREATE EXTENSION IF NOT EXISTS pg_trgm');` tepat setelah `CREATE EXTENSION IF NOT EXISTS pgcrypto`.

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npm --prefix backend exec -- vitest run src/__tests__/database-role-policy.test.ts src/__tests__/migration-chain.integration.test.ts src/__tests__/bulk-upload.service.integration.test.ts src/__tests__/regulatory-governance.migration.test.ts src/__tests__/retention-governance.migration.test.ts src/__tests__/backfill-rangkaian-lama.test.ts`
Expected: PASS.
Run: `node --test --test-concurrency=1 scripts/neon-database-policy.test.mjs` lalu `npm run test:migration-manifest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/grants/0003_optional_pg_trgm.sql backend/src/db/migrations/0049_lacak_trgm.sql backend/src/db/migrations/meta/_journal.json scripts/neon-database-policy.mjs scripts/neon-database-policy.test.mjs backend/src/__tests__
git commit -m "feat(lacak): optional pg_trgm indexes behind a privileged one-off extension step

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


#### Amandemen pra-eksekusi Task 14 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p5-data-lama-pelengkap/preflight-rulings.md`.


1. **Skip (SKIP) [P5-T14-1].** Do not execute. Record in the PR: "Task 14 (pg_trgm) dilewati: gerbang (a) menunggu angka p95 P4 yang tercatat, gerbang (b) belum ada sign-off pemilik DB." If the task is revived later, index `USING gin (perihal gin_trgm_ops)` instead of `lower(perihal)`, and add every full-chain PGlite suite to its Files list.



### Task 15 (OPSIONAL, BERGERBANG): re-key `generalLimiter` per pengguna terautentikasi

> **Gerbang:** kerjakan hanya setelah sign-off keamanan tertulis (spec §6 "tugas terpisah … dengan sign-off"). Perilaku baru aktif hanya bila `GENERAL_LIMITER_PER_USER=true`; default tetap per IP. Biaya: satu verifikasi sesi tambahan per request `/api`. Limiter **tidak** di-skip untuk siapa pun.

**Files:**
- Create: `backend/src/middlewares/rate-limit-subject.middleware.ts`
- Modify: `backend/src/middlewares/rate-limiter.middleware.ts` (:16-29 `generalLimiter`)
- Modify: `backend/src/app.ts:344`
- Test: `backend/src/__tests__/general-limiter-per-user.test.ts`

**Interfaces:**
- Consumes: `verifyRequestIdentity(req)` (`services/request-identity.service.ts`), `createRateLimiterStore('general')`, `ipKeyGenerator` (express-rate-limit 8).
- Produces: `createRateLimitSubjectMiddleware(enabled?, verify?)`, `generalLimiterKey(req)`, `createGeneralLimiter(options?)`; `generalLimiter` tetap diekspor.

- [ ] **Step 1: Tulis test yang gagal**

```ts
// backend/src/__tests__/general-limiter-per-user.test.ts
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/rate-limits.js', async (importOriginal) => {
    const { MemoryStore } = await import('express-rate-limit');
    return { ...await importOriginal<typeof import('../config/rate-limits.js')>(), createRateLimiterStore: () => new MemoryStore() };
});

const { createGeneralLimiter, generalLimiterKey } = await import('../middlewares/rate-limiter.middleware.js');
const { createRateLimitSubjectMiddleware } = await import('../middlewares/rate-limit-subject.middleware.js');

function appWith(enabled: boolean) {
    const verify = vi.fn(async (req: any) => {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token === 'rusak') throw new Error('invalid');
        return token ? { provider: 'better-auth' as const, subject: token, tokenKind: 'better-auth-session' as const } : null;
    });
    const app = express();
    app.use('/api', createRateLimitSubjectMiddleware(enabled, verify));
    app.use('/api', createGeneralLimiter({ max: 2, perUser: enabled }));
    app.get('/api/ping', (_req, res) => res.sendStatus(204));
    return app;
}

describe('generalLimiter per pengguna', () => {
    it('saat flag mati, semua pengguna di belakang satu IP berbagi kuota', async () => {
        const app = appWith(false);
        await request(app).get('/api/ping').set('Authorization', 'Bearer user-a').expect(204);
        await request(app).get('/api/ping').set('Authorization', 'Bearer user-b').expect(204);
        await request(app).get('/api/ping').set('Authorization', 'Bearer user-c').expect(429);
    });

    it('saat flag menyala, kuota terpisah per identitas terverifikasi; anonim dan token rusak tetap per IP', async () => {
        const app = appWith(true);
        for (const user of ['user-a', 'user-b']) {
            await request(app).get('/api/ping').set('Authorization', `Bearer ${user}`).expect(204);
            await request(app).get('/api/ping').set('Authorization', `Bearer ${user}`).expect(204);
            await request(app).get('/api/ping').set('Authorization', `Bearer ${user}`).expect(429);
        }
        await request(app).get('/api/ping').expect(204);
        await request(app).get('/api/ping').set('Authorization', 'Bearer rusak').expect(204);
        await request(app).get('/api/ping').expect(429);
    });

    it('kunci pengguna dan kunci IP berada di namespace terpisah', () => {
        expect(generalLimiterKey({ rateLimitSubject: 'better-auth:u1', ip: '192.0.2.1' } as any)).toBe('user:better-auth:u1');
        expect(generalLimiterKey({ ip: '192.0.2.1' } as any)).toBe('ip:192.0.2.1');
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm --prefix backend exec -- vitest run src/__tests__/general-limiter-per-user.test.ts`
Expected: FAIL — `createGeneralLimiter is not a function` / modul `rate-limit-subject.middleware.js` tidak ada.

- [ ] **Step 3: Implementasi**

```ts
// backend/src/middlewares/rate-limit-subject.middleware.ts
import type { Request, RequestHandler } from 'express';
import { verifyRequestIdentity, type VerifiedRequestIdentity } from '../services/request-identity.service.js';

export type RateLimitSubjectRequest = Request & { rateLimitSubject?: string };

/**
 * Menempelkan identitas TERVERIFIKASI (bukan cookie mentah) sebagai kunci
 * generalLimiter. Identitas tidak valid/absen tetap dihitung per IP, sehingga
 * merotasi token palsu tidak memberi kuota baru.
 */
export function createRateLimitSubjectMiddleware(
    enabled = process.env.GENERAL_LIMITER_PER_USER?.trim() === 'true',
    verify: (req: Request) => Promise<VerifiedRequestIdentity | null> = verifyRequestIdentity,
): RequestHandler {
    return async (req, _res, next) => {
        if (!enabled) return next();
        try {
            const identity = await verify(req);
            if (identity && (identity.provider !== 'firebase' || identity.emailVerified === true)) {
                (req as RateLimitSubjectRequest).rateLimitSubject = `${identity.provider}:${identity.subject}`;
            }
        } catch {
            // Sesi tidak valid: tetap dihitung per IP; authMiddleware route menolak belakangan.
        }
        next();
    };
}
```

Di `rate-limiter.middleware.ts`: ubah impor menjadi `import { ipKeyGenerator, rateLimit } from 'express-rate-limit';`, tambahkan `import type { RateLimitSubjectRequest } from './rate-limit-subject.middleware.js';`, dan ganti deklarasi `generalLimiter` (:16-29) dengan:

```ts
export function generalLimiterKey(req: RateLimitSubjectRequest): string {
    return req.rateLimitSubject ? `user:${req.rateLimitSubject}` : `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

export function createGeneralLimiter(options: { max?: number; perUser?: boolean } = {}) {
    const perUser = options.perUser ?? process.env.GENERAL_LIMITER_PER_USER?.trim() === 'true';
    return rateLimit({
        store: createRateLimiterStore('general'),
        passOnStoreError: false,
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: options.max ?? (isDev ? 1000 : 500),
        ...(perUser ? { keyGenerator: generalLimiterKey } : {}),
        message: {
            error: 'Too Many Requests',
            message: 'Too many requests from this IP, please try again after 15 minutes',
        },
        standardHeaders: true,
        legacyHeaders: false,
    });
}

// Every deployed instance uses the same database-backed policy counters.
export const generalLimiter = createGeneralLimiter();
```

Di `backend/src/app.ts`, tambahkan impor `import { createRateLimitSubjectMiddleware } from './middlewares/rate-limit-subject.middleware';` dan ganti baris 343-344 menjadi:

```ts
// Apply general rate limiting to all API routes (per verified user when GENERAL_LIMITER_PER_USER=true)
app.use('/api', createRateLimitSubjectMiddleware());
app.use('/api', generalLimiter);
```

Tambahkan di `backend/.env.example`:

```
# Opsional, butuh sign-off: kuota generalLimiter per pengguna terverifikasi (default per IP).
GENERAL_LIMITER_PER_USER=false
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npm --prefix backend exec -- vitest run src/__tests__/general-limiter-per-user.test.ts src/__tests__/deployed-rate-limit-policy.test.ts src/__tests__/ocr-rate-limiter.test.ts src/__tests__/shared-rate-limit-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/middlewares/rate-limit-subject.middleware.ts backend/src/middlewares/rate-limiter.middleware.ts backend/src/app.ts backend/.env.example backend/src/__tests__/general-limiter-per-user.test.ts
git commit -m "feat(rate-limit): optional per-verified-user key for generalLimiter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


#### Amandemen pra-eksekusi Task 15 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p5-data-lama-pelengkap/preflight-rulings.md`.


1. **Skip (SKIP) [P5-T15-1].** Do not execute. Record in the PR: "Task 15 (re-key generalLimiter) dilewati: belum ada sign-off keamanan dan estimasi beban."



## Verifikasi akhir fase

- [ ] Run: `npm --prefix backend exec -- vitest run` → Expected: PASS seluruh suite backend.
- [ ] Run: `npm --prefix backend exec -- tsc --noEmit` → Expected: tanpa error.
- [ ] Run: `npm --prefix frontend exec -- vitest run` → Expected: PASS.
- [ ] Run: `npm run test:migration-manifest` → Expected: PASS.
- [ ] Bila `TEST_POSTGRES_URL` tersedia: `npm --prefix backend run test:postgres-locks` → Expected: PASS.
- [ ] Kriteria P5 (§10): skrip idempoten (Task 5), CSV pemetaan disetujui (runbook Task 13, di luar kode), peserta data lama tidak memberi akses saat flag mati (Task 2), koreksi berkas hanya berhasil dengan GUC + baris approved oleh super_admin berbeda (Task 6).

---

## Self-Review

**Cakupan spec (§3, §5, §8, §9, §10-P5, §11):**
- §3 langkah 2 (dry-run → CSV → sign-off → `--apply`, idempoten, batch 500, audit, `judul` COALESCE, anggota induk `sumber='data_lama'`, peserta `disposisi_lama`, balasan same-unit + laporan lintas unit, `unit_pengolah_id` hanya bila tepat satu direktorat, `surat_masuk.status` tidak ditulis) → Task 3–5.
- Flag `RANGKAIAN_DISPOSISI_LAMA_READ` → Task 2 (satu fragmen jangkauan + guard sumber).
- Tutup massal data lama (§5 tabel, §7 tab Berkas Rangkaian) → Task 7, 8, 10.
- Koreksi Berkas (§5 dua endpoint, §9 maker-checker, GUC, trigger) → Task 6, 8, 9; pengerasan satu koreksi terbuka → Task 1.
- Migrasi pengerasan `SET NOT NULL` → Task 1 (`0048`).
- Notifikasi batas waktu + pengecualian data lama (§5 notification.service) → Task 11.
- Ekspor "Balasan Untuk" sebagai nomor + "Asal Naskah" → Task 12.
- PANDUAN + docs/manajemen-surat + bukti penutupan berkas (§9 Retensi) + Dosir vs Berkas Rangkaian → Task 13.
- Opsional pg_trgm (§6 Performa) → Task 14; re-key `generalLimiter` (§6 Rate limit) → Task 15.
- §11 "backfill langkah 2 pada fixture yang meniru agregat lama (ejaan label, label kosong, balasan lintas unit)" → fixture Task 4; "koreksi berkas dengan dan tanpa GUC" → Task 6.

**Pemindaian placeholder:** tidak ada TBD/TODO. Ketergantungan pada nama P1–P4 (`jangkauanUnitsSql`, `isDisposisiLamaReadEnabled`, `isPengawas` (P3 `rangkaian/deps.ts`), `checkRead`, `rangkaianService` frontend, `AlurSuratPanel`, `BerkasRangkaianTab`) diberi langkah verifikasi `rg` dengan instruksi berhenti, bukan tebakan.

**Konsistensi tipe/nama:** `P5_IDS`, `createRangkaianTestDatabase`, `seedRangkaianBase`, `seedBerkasDiberkaskan` dipakai konsisten di Task 1/2/5/6/7/11. Payload frontend (`unitPengolahBaru`, `klasifikasiBaru`, `alasan`, `keputusan`, `dryRun`, `konfirmasi`, `expectedCount`) sama dengan skema Zod Task 8 dan service Task 6/7. Status koreksi `pending → approved → applied | denied` sesuai CHECK 0046 + 0048.

**Ambiguitas spec yang diselesaikan:**
1. §3 langkah 2.1 memetakan kedua label Kabag → `sesditjen` (`perlu_verifikasi=true`), tetapi D6 (keputusan lebih baru) menyatakan label-saja. Plan mengikuti D6: `unit_kerja_id NULL`, `perlu_verifikasi=false`, catatan "D6"; bila tabel sudah berisi pemetaan lama, `--apply` meng-upsert (dan mengaudit) nilai D6.
2. Gerbang sign-off diwujudkan sebagai SHA-256 atas pemetaan + balasan + total; `--apply` wajib `--approved-sha256` yang cocok.
3. Balasan data lama hanya ditautkan bila surat keluar `approved`; draf impor lama dilaporkan `dilewati_belum_disetujui` agar tidak menjadi anggota pemblokir (§8) yang mengunci selesai/berkaskan selamanya. Balasan hanya diproses untuk surat yang memang menjadi target rangkaian (label terpetakan atau rangkaian langkah 1); surat yang hanya punya balasan tetap "tunggal".
4. "Tutup massal" = memberkaskan rangkaian `data_lama` berstatus `selesai`; unit pengolah = nilai tercatat atau pencatat (pemilik induk, selalu di jangkauan), klasifikasi = berkas → induk → pengganti; rangkaian tanpa klasifikasi dilewati dan dilaporkan; penerapan butuh `expectedCount` dari pratinjau.
5. Koreksi unit pengolah dibatasi ke jangkauan §9 yang sama dengan PUT unit-pengolah (422 "Disposisikan dulu ke unit ini."), dan koreksi basi ditolak 409.
6. "Baris data lama dikecualikan" pada notifikasi = surat induk rangkaian `data_lama` yang tidak `aktif`; rangkaian yang dibuka kembali otomatis tetap dinotifikasi.
7. Nomor "Balasan Untuk" disamarkan sesuai §4.8 (unit sama + kelas diizinkan); lainnya label pengganti. Ekspor PDF surat keluar tidak memiliki kolom balasan sehingga tidak diubah.
8. Nomor migrasi pengerasan = `0048` (journal berikutnya setelah 0047); pg_trgm = `0049` hanya bila gerbang Task 14 terpenuhi.
9. Endpoint baca tambahan `GET /api/rangkaian/:id/koreksi-berkas` dan `GET /api/rangkaian/data-lama/ringkasan` ditambahkan agar UI digerakkan server (hak aksi dihitung backend), karena tabel §5 hanya mencantumkan endpoint tulis.
10. Kejadian Koreksi Berkas di linimasa panel (§7) untuk non-super_admin belum ditambahkan ke builder `GET /api/rangkaian/:id` P2; riwayat lengkap tetap tersedia bagi super_admin di bagian Koreksi Berkas dan Audit Log.

## Catatan Konsistensi Lintas Fase (2026-09-26)

Perubahan dari tinjauan konsistensi P0–P5 terhadap berkas ini:

- Task 2 ditulis ulang: tidak membuat `config/rangkaian-flags.ts` dan tidak membuat `jangkauanUnitSql`; mengonsumsi `jangkauanUnitsSql` (P1) dan `isDisposisiLamaReadEnabled` (P2, string persis `'true'`, tanpa `trim`) di `visibility-spec.ts`, menguncinya dengan test matriks + guard sumber (pengecualian tertutup: skema Drizzle dan `rangkaian.service.ts` P1), dan menambah `.env.example`.
- Task 1: helper PGlite P5 diganti nama menjadi `helpers/rangkaian-p5-pglite.ts` (sebelumnya menimpa helper P2 `rangkaian-pglite.ts`); ditambah Step 6b — opsi `stopBefore` pada harness Postgres P3 dan test backfill P3 berhenti sebelum `0048` agar skenario `rangkaian_id NULL` tetap dapat diuji.
- Task 7: `isPengawas` dikonsumsi dari `backend/src/services/rangkaian/deps.ts` (P3), bukan `record-access.service.ts`.
- Task 8/10: kontrak Tutup massal tunggal (`{ tahun?, unitPencatatId?, klasifikasiItemId?, dryRun, konfirmasi?, expectedCount? }` → `{ jumlah, tanpaKlasifikasi, contoh, contohTanpaKlasifikasi, terpotong, diterapkan }`); UI P5 kini satu-satunya dan disisipkan ke `BerkasRangkaianTab.jsx` (P4) saat filter asal `data_lama`, dengan `onSelesai` → `resource.reload`. Urutan mount final `/api/rangkaian` dicantumkan.
- Task 9: `KoreksiBerkasSection` dipasang setelah `<AlurSuratActions …/>` (P3 Task 25), tempat tombol Berkaskan/Gabung sebenarnya berada.
- Branch `feat/integrasi-surat-p5` ditambahkan; Global Constraints flag disamakan (tanpa `trim`). Migrasi dikonfirmasi: 0048 `when` 1789397419667, opsional 0049 `when` 1789397420667; tidak diklaim fase lain.

**2026-09-27** — Task 3 fase P2 (review fix round 1) mengganti seluruh alias internal `jangkauanUnitsSql`/`jangkauanSql`/`grantAktifSql`/`jangkauanRekamanSql` di `visibility-spec.ts` dari `r`/`a`/`d`/`p`/`j`/`g`/`ra` menjadi prefiks tercadang `jk_` (`jk_r`/`jk_a`/`jk_d`/`jk_p`/`jk_j`/`jk_g`/`jk_ra`), karena alias polos itu bertabrakan dengan alias tabel yang wajar dipakai pemanggil dan membocorkan jangkauan lintas rangkaian yang tidak berkaitan (lihat blok kode kanonik di atas, yang sudah diperbarui). Bagian ini P5 **wajib mempertahankan** alias `jk_`-berprefiks itu bila menyalin/mengubah `jangkauanUnitsSql`; `aliasAman` (kini diekspor) menolak alias pemanggil berprefiks `jk_` atau bernama `ra`/`g`/`j`.
