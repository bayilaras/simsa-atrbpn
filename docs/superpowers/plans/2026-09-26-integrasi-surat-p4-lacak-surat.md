# Integrasi Surat — P4 Halaman Lacak Surat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menyediakan halaman **Lacak Surat** (`/surat/lacak`) dengan satu input besar, kartu rangkaian berpratinjau node, ekspansi di tempat, sinkronisasi URL (`?q=`, `?rangkaian=`), tab **Berkas Rangkaian**, aksi "Lihat rangkaian" di GlobalSearch tanpa request tambahan, dan penyempurnaan peringkat `/lacak` beserta bukti kinerja (EXPLAIN 50 ribu baris) serta uji probing penyamaran. Tambahan D7 (2026-09-27): tab **Perlu Dilengkapi** (daftar kerja enam kategori rantai belum lengkap dengan aksi langsung per baris), endpoint **Tandai Inisiatif**, dan badge hitungan pada entri sidebar "Lacak Surat".

**Architecture:** Backend `/api/rangkaian/lacak` (3 mode) sudah dibangun P3. P4 hanya (a) mengekstrak skor ke modul murni `lacak-skor.ts` (dipasang di `skorSql` pada `services/rangkaian/lacak.service.ts` P3) lalu menambah tingkat *prefix mentah berbatas*, urutan seed sebelum `LIMIT 200`, dan tie-break deterministik; (b) menambah endpoint daftar `GET /api/rangkaian` untuk tab Berkas Rangkaian, dengan predikat jangkauan §4.5 yang dijaga uji paritas terhadap `checkRead`; (c) membangun UI React: memperluas hook tunggal P3 `useLacakSearch` (debounce 300 ms, minimal 3 karakter, AbortController, penjaga urutan basi, cache LRU 20), halaman `LacakSurat.jsx` yang merender `AlurSuratPanel` (P2) di dalam kartu, tab Berkas Rangkaian, route, sidebar, breadcrumbs, dan hook GlobalSearch; (d) **D7**: layanan `perluDilengkapiService` (satu kueri `UNION ALL` enam cabang kategori untuk daftar maupun ringkasan, dirakit dari fragmen P2 `kecocokanUnitRekaman`/`jangkauanRekamanSql`/`visibleSql` dan lingkup daftar Task 5, dengan aksi baris dari `computeSuratAksi`/`computeRangkaianAksi` P3), `asalNaskahService.tandaiInisiatif`, router `rangkaian-perlu-dilengkapi.routes.ts`, tab `PerluDilengkapiTab`, dan hook badge `usePerluDilengkapiCount` di sidebar. Tidak ada migrasi baru, role baru, atau perubahan pada `check()`/`visibleSql`.

**Tech Stack:** Frontend React 19 (JSX), react-router-dom v7, shadcn/Radix + Tailwind v4, lucide-react, Vitest 4 + Testing Library (jsdom). Backend Express 5 + TypeScript, Drizzle ORM (`sql` template), Zod 4, Vitest 4, PGlite (rantai migrasi penuh), Postgres nyata via `vitest.postgres.config.ts`.

**Spec:** docs/superpowers/specs/2026-09-26-integrasi-surat-masuk-keluar-design.md

## Global Constraints

- **D5 berlaku penuh.** Tidak ada role baru. Pengawas = role FULL_ADMIN (`super_admin`, `admin_unit`, `admin_dirjen`, `admin_sesditjen`) **dan** unit efektif (`resolveEffectiveUnitKerjaId(role, user.unitKerjaId)`) bertanda `unit_kerja.is_unit_pengawas = true`. Role lama `staff`/`auditor` tidak mendapat jangkauan pengawas/peserta.
- P4 **tidak** mengubah `recordAccessService.check()`, `checkRead`, `checkMany`, `visibleSql`, `klasifikasiNormSql`, maupun aturan akses/penyamaran P2/P3. P4 hanya mengonsumsinya dan menambah uji yang membuktikannya.
- **Tidak ada migrasi baru** di P4. Index ekspresi `surat_masuk_nomor_norm_idx`/`surat_keluar_nomor_norm_idx` (0046) sudah cukup. pg_trgm tetap di luar cakupan; angka p95 dari Task 7 menjadi masukan pertanyaan terbuka §13 no. 3.
- Klien Lacak: debounce **300 ms**, minimal **3** karakter setelah trim, maksimal **100**, `AbortController` per kueri, penjaga urutan basi, cache **20** entri (LRU) per instans halaman. GlobalSearch (Ctrl+K) **tidak** menambah request apa pun.
- Label penyamaran selalu **"Dikecualikan"**; placeholder tersamar tidak memuat id surat, nomor, perihal, tanggal, dari/kepada, maupun berkas (§4.8). Kata "Kembalikan" tidak dipakai untuk penyerahan berkas.
- Teks UI dan pesan uji berbahasa Indonesia. Kode, nama file, dan identifier mengikuti nama di spec §5–§7 (`LacakSurat.jsx`, `/surat/lacak`, `ALL_PROVISIONED_ROLES`, `rangkaian.service.js`, `AlurSuratPanel`, `aksiDiizinkan`).
- Semua perintah dijalankan dari Git Bash di root repo `D:/Projects/New folder/simsa-atrbpn`. Uji frontend: `(cd frontend && npx vitest run <file>)`. Uji backend: `(cd backend && npx vitest run <file>)`. Uji Postgres: `(cd backend && TEST_POSTGRES_URL=... npm run test:postgres-locks -- <file>)`.
- Branch `feat/integrasi-surat-p4` (Task 1). Satu commit per task, tanpa push. Pesan commit diakhiri baris kosong lalu `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Jangan menjalankan drizzle-kit.
- Jangan mengubah `SuratMasukService.getStats`, `arsip.service`, `ArchiveDialog`, `KlasifikasiPicker`, `dosir.service`, dan payload producer SRIKANDI.
- **D7 (2026-09-27).** Kategori Perlu Dilengkapi persis `sm_belum_ditindaklanjuti`, `disposisi_terbuka`, `sk_tanpa_nd_penjelas`, `tindak_lanjut_tertahan`, `siap_diberkaskan`, `sk_tanpa_asal` (konstanta tunggal `backend/src/services/perlu-dilengkapi.constants.ts`, dicerminkan `frontend/src/lib/perlu-dilengkapi.js`). Tidak ada tabel baru.
  - Isi baris mengikuti `visibleSql(ctx, target, 'list')`. Aksi yang membaca/menindaklanjuti isi hanya bila `visibleSql(…, 'read')` lolos.
  - Nilai sensitif baris tersamar di-NULL-kan di SQL, bukan hanya di TypeScript.
  - Batas data lama: env `RANGKAIAN_DATA_LAMA_SEBELUM` (ISO-8601 berzona). Cadangannya `min(created_at)` rangkaian non-`data_lama`, atau "sekarang".
  - Badge sidebar hanya untuk FULL_ADMIN, paling sering satu request per 60 detik per tab (irama `useNotifications`), dan hanya saat tab terlihat.
  - Satu-satunya endpoint tulis P4 adalah Tandai Inisiatif. Endpoint ini memakai `canWriteMiddleware()`, `validateIdParam('suratKeluarId')`, dan `logActionOrThrow(..., tx)`, serta mengubah **hanya** `asal_naskah` (+ `updated_at`).

#### Amandemen pra-eksekusi global (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p4-lacak-surat/preflight-rulings.md`.


1. **Workspace root and base (BLOCKING) [P4-G-1] RECHECK-AFTER-P3.**
   - Work in the P4 worktree on branch `feat/integrasi-surat-p4`. The controller creates it on the final P3 tip, which must contain both `feat/integrasi-surat-p3` (backend) and `feat/integrasi-surat-p3-frontend`.
   - Every `cd "D:/Projects/New folder/simsa-atrbpn"` in this plan (for example P4:21, 178, 189, 215, 233, 242, 1263, 5943) means `cd <P4 worktree root>`. Never run P4 commands or commits in `D:/Projects/New folder/simsa-atrbpn`: that is the main checkout, on `fix/user-readiness`.
   - Task 1 Step 1: use `git switch -c feat/integrasi-surat-p4 origin/main` only after the P3 PR has merged. Until then the worktree is stacked on the P3 tip, as the plan's own cross-phase convention allows (P4:184).
   - **(delta P3) Corrected base.** The frontend track is already merged into the backend branch: `d890ff2 merge: gabungkan jalur frontend P3 (Tugas 18-25)`, and `feat/integrasi-surat-p3-frontend` @ 9cb75e3 is an ancestor of `feat/integrasi-surat-p3` @ b4d86fa (verified with `git merge-base --is-ancestor`). The P4 base is therefore the single branch `feat/integrasi-surat-p3`, at the tip **after** the P3 final-fix wave (`final-fix-brief.md`) has committed. Do not stack on b4d86fa: the fix wave rewrites `lacak.service.ts`, `rangkaian-read.service.ts`, `deps.ts`, `distribution.service.ts` and the P3 runbook, which P4 Tasks 4, 9, 16 and 22 anchor on.
2. **Anchoring (REQUIRED) [P4-G-2].**
   - Line numbers and the "persis" P3 snippets are hints. Edit by symbol, `describe` name or unique anchor text.
   - The Task 1 stop rule applies to a missing name or shape (function, export, prop, field). It does not apply to text drift inside a P3 function body.
3. **P3 contract (REQUIRED) [P4-G-3].** The amended P3 plan is the interface. Before Task 2, re-verify every `RECHECK-AFTER-P3` item in this file with the extended Task 1 greps.
4. **Imports (REQUIRED) [P4-G-4].** Imports in plan snippets are additions. Merge each into the existing import statement of the same module.
5. **Typecheck per backend task (REQUIRED) [P4-G-5].** Tasks 3, 4, 5, 6, 16, 17 and 18 run `cd backend && npx tsc --noEmit -p tsconfig.json` in their "Jalankan, pastikan lulus" step, before the commit.
6. **Lint per frontend task (REQUIRED) [P4-G-6].** Every task that edits a frontend source file runs `cd frontend && npx eslint <file…>` on each file it touched, including P2/P3 files such as `src/components/surat/AlurSuratPanel.jsx`.
7. **Release gate (REQUIRED) [P4-G-7].** The PR description gets a "Gerbang rilis P4 (keamanan / pemilik spec)" table. Each row is recorded as signed or refused before production:

   | Item | Source | Decision needed |
   |---|---|---|
   | Tandai Inisiatif authorized by list policy + owner unit, not `check()` | spec:906, P4:6084 | security sign-off |
   | O1: step-1 backfilled rangkaian (`asal='surat_masuk'`, `selesai`) appear in `siap_diberkaskan` and the badge | spec:660, 668-674 | spec owner: count them as data lama or not |
   | G-F3: cross-unit draft SKs readable; D7 `tindak_lanjut_tertahan` offers "Buka surat" on them | P3 G-F3, spec:659 | security sign-off (carried from P3) |
   | Lacak p95 result and pg_trgm input | spec:582, §13 no. 3 | owner acceptance if p95 ≥ 150 ms |
   | (delta P3) Lacak shows nomor/perihal of nodes readable via pengawas/peserta/grant without a `view_via_rangkaian` audit or `markGrantUsed` (list semantics), while P2 `GET /:id` audits the same read | P3 `final-review-access.md` carry-forward 5 | security sign-off |
   | (delta P3) `POST /:id/tautan` by `anggotaId` lets any participant unit link its SK as `balasan`/`tindak_lanjut` to an SM it cannot read; that relasi closes `sm_belum_ditindaklanjuti` in D7 and counts toward auto-selesai | P3 access carry-forward 7; spec:656 | spec owner |
   | (delta P3) Grant rows from `POST /rangkaian/anggota/:id/ajukan-akses` and `GET /record-access-grants/mine` expose the masked `entityId`/class (P3 M-1), unless the P3 fix wave or P4 Task 22 item 5 fixes it | P3 access M-1, carry-forward 9 | security sign-off, or "fixed" |
   | (delta P3) Masked kotak-disposisi rows show `RS-YYYY-…` while the D7 placeholder (spec:668) carries no rangkaian | P3 frontend release note; P3 T10 | spec owner (carried from P3) |
   | (delta P3) P3 C-12 gate signed (includes the A-I3 Lacak tier ruling, CTRL-1, `RANGKAIAN_AJUKAN_AKSES`) before P4 reaches production; P4 stacks on P3 | P3 `final-review-spec.md` release gate | prerequisite |
   | (delta P3) CI "Backend Tests (PostgreSQL 16/17/18)" green on the P4 head, including every P3 `integration/*.postgres.test.ts` (never run locally) plus `lacak-explain` | `ci.yml:809`; P3 ruling S-I3 | hard gate |
   | (delta P3) Frontend and backend ship in one deploy (`aksiDiizinkan` is authoritative in the UI) | P3 `final-review-frontend.md` release note | hard gate |
8. **Role middleware (ADVISORY) [P4-G-8].** In Tasks 6 and 18, use `canReadMiddleware()` from `../middlewares/role.middleware` instead of `roleMiddleware(['super_admin', 'admin_unit', 'admin_dirjen', 'admin_sesditjen', 'staff', 'auditor'])`. It is the same predicate P3 `/lacak` uses. The route tests stay as written: 401 without token, 400 validation, and 200 for staff.


**Kontroler:** P4 berbasis ujung P3 final 2a61bb7 (branch tunggal feat/integrasi-surat-p3, jalur frontend sudah di-merge). Aturan P3 tetap mengikat: urutan kunci surat_keluar -> surat_masuk -> rangkaian_surat ORDER BY id -> surat_distributions, denganRetryDeadlock, logActionOrThrow dalam tx sebelum respons, tanpa oracle keberadaan, aksiDiizinkan server otoritatif, CTRL-1 (Tutup tanpa jalan pintas super_admin).


## Review Focus

1. **Respons basi menimpa hasil terbaru / abort tidak sampai ke `fetch`.** Kueri lama yang lambat (atau layanan yang mengabaikan sinyal) datang setelah kueri baru lalu mengganti kartu. Diuji di **Task 10** (`penjaga urutan: respons basi yang tidak menghormati abort tidak menimpa hasil terbaru`, `membatalkan permintaan lama begitu kueri berubah`) dan **Task 13** (`membatalkan permintaan sebelumnya ketika kueri berubah dan mengabaikan hasil basi`).
2. **Node tersamar menjadi oracle pencarian.** Perihal/nomor/dari node Terbatas cocok lewat mode `cek`/`referensi`, lewat nomor ternormalisasi, lewat token yang digabung lintas anggota, atau bocor lewat `rangkaian.judul`. Diuji di **Task 4** (`lacak-probing.integration.test.ts`: tiga mode × empat probe, token lintas anggota, placeholder paling konservatif, serta kontrol super_admin dan grant).
3. **`LIMIT 200` pada seed memotong kecocokan persis, dan seri skor tidak deterministik.** Seed yang dibatasi sebelum diurutkan skor akan membuang nomor persis yang lebih tua, dan urutan kartu bisa berubah antar-permintaan. Diuji di **Task 3** (`LIMIT 200 seed diterapkan setelah urut skor…` dan `seri penuh … diurutkan kunci naik secara deterministik`).
4. **Loop sinkronisasi URL.** Gejalanya: setiap ketikan membuat entri history baru, Back/tautan GlobalSearch tidak memperbarui input, atau auto-open kartu tunggal menulis `?rangkaian=` sehingga penutupan kartu gagal. Diuji di **Task 13** (`menunda pencarian 300 ms, menyinkronkan ?q= dengan replace…`, `mengikuti navigasi luar…`, `membuka langsung bila hanya satu kelompok…`).
5. **Daftar Berkas Rangkaian menyimpang dari `checkRead`.** Contohnya: disposisi `rejected` masih memberi jangkauan, `staff` mendapat jangkauan peserta, pengawas tidak melihat `dir_*`, atau rangkaian `digabung`/`data_lama` ikut tampil. Diuji di **Task 5** (uji paritas pengguna × rangkaian terhadap `recordAccessService.checkRead`, ditambah kasus eksplisit).
6. **Daftar Perlu Dilengkapi (D7) membocorkan isi surat terkendali atau menawarkan aksi yang akan ditolak server.** Gejalanya:
   - nomor, perihal, id surat, atau kode rangkaian ikut terkirim pada baris tersamar
   - pengawas tidak melihat direktorat, atau direktorat yang disposisinya ditolak masih melihat surat
   - "Buka surat"/"Tindak Lanjut" tampil untuk surat yang `checkRead`-nya 404
   - data lama membanjiri badge

   Diuji di **Task 16**: `perlu-dilengkapi.integration.test.ts` › ringkasan per pengguna, "baris tersamar memakai placeholder standar…", "aksi buka_surat hanya ditawarkan bila checkRead mengizinkan…", dan "data lama tersembunyi secara default…". Dicek juga di **Task 20** (klien hanya merender `aksiDiizinkan`).

---

## File Structure

**Backend (baru):**
- `backend/src/services/lacak-skor.ts` berisi `SKOR_LACAK`, `bentukKueriLacak`, `skorNomorSql`, `skorTeksSql`, dan `skorLacakSql`. Ini sumber tunggal skor §6 plus tingkat *prefix mentah berbatas* (80).
- `backend/src/services/rangkaian-judul.ts` berisi `judulRangkaianTampil(kode, judul, indukTersamar)`.
- `backend/src/services/rangkaian-daftar.service.ts` berisi `rangkaianDaftarService.list(user, filter)` untuk `GET /api/rangkaian`.
- `backend/src/routes/rangkaian-daftar.routes.ts` berisi router `GET /` yang dipasang di `/api/rangkaian`.
- `backend/src/__tests__/helpers/lacak-pglite.ts` berisi fixture lacak/rangkaian; boot PGlite memakai `bootRangkaianDatabase` dari helper P2 `rangkaian-pglite.ts`.
- `backend/src/__tests__/lacak-skor.test.ts`, `lacak-ranking.integration.test.ts`, `lacak-probing.integration.test.ts`, `rangkaian-judul.test.ts`, `rangkaian-daftar.integration.test.ts`, `rangkaian-daftar.routes.test.ts`.
- `backend/integration/lacak-explain.postgres.test.ts`.
- D7:
  - `backend/src/services/perlu-dilengkapi.constants.ts` berisi `KATEGORI_PERLU_DILENGKAPI` dan tipe `KategoriPerluDilengkapi`. Tanpa impor, sehingga aman diimpor `validators/schemas.ts`.
  - `backend/src/services/perlu-dilengkapi.service.ts` berisi `perluDilengkapiService.{ list, ringkasan }`, `resolveBatasDataLama`, dan `ENV_BATAS_DATA_LAMA`.
  - `backend/src/services/asal-naskah.service.ts` berisi `asalNaskahService.tandaiInisiatif`.
  - `backend/src/routes/rangkaian-perlu-dilengkapi.routes.ts` berisi `GET /perlu-dilengkapi`, `GET /perlu-dilengkapi/ringkasan`, dan `POST /surat-keluar/:suratKeluarId/tandai-inisiatif`.
  - Tes: `backend/src/__tests__/perlu-dilengkapi.integration.test.ts`, `asal-naskah.integration.test.ts`, `rangkaian-perlu-dilengkapi.routes.test.ts`.

**Backend (diubah):**
- `backend/src/services/rangkaian/lacak.service.ts` (P3; `rangkaianService.lacak` di `rangkaian.service.ts` hanya mendelegasikan ke `lacakService.search`) mengubah `skorSql`: skor diganti `skorLacakSql` (predikat `cocok` P3 tetap), urutan seed sebelum `LIMIT 200` dan tie-break kelompok diverifikasi, dan `judul` di `ekspansi` disamarkan lewat `judulRangkaianTampil`.
- `backend/src/validators/schemas.ts` mendapat `daftarRangkaianQuerySchema`.
- `backend/src/app.ts` memasang `rangkaianDaftarRoutes` tepat sebelum `app.use('/api/rangkaian', rangkaianRoutes)` milik P2/P3.
- `backend/src/middlewares/demo-access.middleware.ts` mendapat allowlist `GET /rangkaian`.
- D7:
  - `backend/src/services/rangkaian-daftar.service.ts` (Task 5) mengekspor `lingkupRangkaianSql(ctx, alias)` agar lingkup rangkaian tetap dirakit di satu tempat (Task 16).
  - `backend/src/validators/schemas.ts` mendapat `perluDilengkapiQuerySchema`, `ringkasanPerluDilengkapiQuerySchema`, dan `tandaiInisiatifSchema` (Task 18).
  - `backend/src/app.ts` memasang `rangkaianPerluDilengkapiRoutes` tepat setelah `rangkaianDaftarRoutes` (Task 18).
  - `demo-access.middleware.ts` mendapat allowlist `GET /rangkaian/perlu-dilengkapi(/ringkasan)` dan `POST /rangkaian/surat-keluar/:uuid/tandai-inisiatif` (Task 18).

**Frontend (baru):**
- `frontend/src/lib/lacak-cache.js` berisi `LACAK_MIN_CHARS`, `LACAK_MAX_CHARS`, `LACAK_CACHE_SIZE`, `lacakCacheKey`, dan `createLacakCache`.
- `frontend/src/lib/lacak-link.js` berisi `lacakHref` dan `lacakQueryForResult`.
- `frontend/src/lib/lacak-labels.js` berisi `LABEL_RELASI`, `LABEL_STATUS_RANGKAIAN`, dan `LABEL_JENIS_SURAT`.
- `frontend/src/components/lacak/LacakKelompokCard.jsx` dan `frontend/src/components/lacak/BerkasRangkaianTab.jsx`.
- `frontend/src/pages/LacakSurat.jsx`.
- Tes: `lib/lacak-cache.test.js`, `lib/lacak-link.test.js`, `services/rangkaian.service.lacak.test.js`, `components/surat/__tests__/AlurSuratPanel.rangkaian-id.test.jsx`, `hooks/use-lacak-search.p4.test.jsx`, `components/lacak/LacakKelompokCard.test.jsx`, `components/lacak/BerkasRangkaianTab.test.jsx`, `pages/LacakSurat.test.jsx`, `App.lacak-route.test.jsx`, `components/GlobalSearch.lacak.test.jsx`.
- D7:
  - `frontend/src/lib/perlu-dilengkapi.js` berisi `KATEGORI_PERLU_DILENGKAPI`, `LABEL_KATEGORI_PERLU_DILENGKAPI`, `LABEL_STATUS_DISPOSISI`, `PERLU_DILENGKAPI_EVENT`, `PERLU_DILENGKAPI_REFRESH_MS`, `formatJumlahBadge`, dan `umumkanRingkasanPerluDilengkapi`.
  - `frontend/src/components/lacak/PerluDilengkapiTab.jsx`.
  - `frontend/src/hooks/use-perlu-dilengkapi-count.js`.
  - Tes: `lib/perlu-dilengkapi.test.js`, `services/rangkaian.service.perlu-dilengkapi.test.js`, `components/lacak/PerluDilengkapiTab.test.jsx`, `hooks/use-perlu-dilengkapi-count.test.jsx`.

**Frontend (diubah):**
- `frontend/src/hooks/use-lacak-search.js` (P3 Task 18) diperluas menjadi satu-satunya hook Lacak: `status`, batas 100, `retry`, `LACAK_DEBOUNCE_MS`, dan cache `lacak-cache.js` (Task 10).
- `frontend/src/services/rangkaian.service.js` (P2/P3) mendapat `list` dan `unitKerjaOpsi`; `lacak` milik P3 (sudah meneruskan `{ signal }`) dipakai apa adanya. (`tutupMassalDataLama`/`getRingkasanDataLama` dan UI Tutup massal dimiliki **P5** Task 9–10.)
- `frontend/src/components/surat/AlurSuratPanel.jsx` (P2) mendapat prop opsional `rangkaianId` yang memuat lewat `getById`.
- `frontend/src/App.jsx` mendapat lazy `LacakSurat` dan route `/surat/lacak`.
- `frontend/src/components/app-sidebar.jsx` mendapat sub-item "Lacak Surat" di grup Surat (`:84-85`).
- `frontend/src/components/app-sidebar.groups.test.jsx`, `frontend/src/components/breadcrumbs.jsx`, `frontend/src/components/breadcrumbs.test.jsx`.
- `frontend/src/components/GlobalSearch.jsx` mendapat aksi "Lihat rangkaian", Shift+Enter, dan item "Lacak rangkaian “q”".
- D7:
  - `frontend/src/services/rangkaian.service.js` mendapat `perluDilengkapi`, `ringkasanPerluDilengkapi`, dan `tandaiInisiatif` (Task 19).
  - `frontend/src/pages/LacakSurat.jsx` + `LacakSurat.test.jsx` mendapat tab `?tab=perlu-dilengkapi` (Task 20).
  - `frontend/src/components/app-sidebar.jsx` + `app-sidebar.groups.test.jsx` mendapat badge pada sub-item "Lacak Surat" (Task 21).

---

### Task 1: Gerbang kontrak P2/P3 dan branch kerja

Task ini gerbang, bukan TDD. Tugasnya memastikan nama dan bentuk yang dikonsumsi P4 benar-benar ada sebelum kode ditulis. Bila satu butir saja berbeda, **berhenti**, samakan nama dengan pemilik P2/P3, lalu perbarui rencana ini (fixture frontend dan impor backend) sebelum lanjut.

**Files:** tidak ada file yang diubah.

**Interfaces:**
- Consumes (P3, backend):
  - `backend/src/utils/nomor-surat.ts`:
    - `normalizeNomor(value: string | null | undefined): string` (P1 Task 7): buang `[^0-9A-Za-z]` **dulu**, baru lowercase — paritas dengan ekspresi index `lower(regexp_replace(coalesce(nomor_surat,''),'[^0-9A-Za-z]+','','g'))`
    - `nomorNormSql(column: AnyColumn | SQL): SQL<string>` (P1), yang menghasilkan ekspresi persis sama dengan index 0046
    - `escapeLike(value: string): string`, `LIKE_ESCAPE` (`ESCAPE '\'`), `classifyLacakQuery(raw): LacakQueryPlan` (`{ q, qLower, qNorm, jenis: 'nomor'|'perihal', tokens, substringNomor }`) — ditambahkan P3 Task 3 ke berkas yang sama
  - `backend/src/services/rangkaian.service.ts`: `rangkaianService.lacak(user: RecordUser, params: LacakParams): Promise<LacakResult>` yang **hanya mendelegasikan** (impor dinamis) ke `lacakService.search` di `backend/src/services/rangkaian/lacak.service.ts` (P3 Task 4). Implementasi — `skorSql(branch, plan, mode)`, `cabangSql`, CTE `seed`/`teratas`/`kelompok` (kolom `skor`, `tanggal_surat`, `surat_id`), dan `ekspansi` — ada di `lacak.service.ts`; tipe di `backend/src/services/rangkaian/lacak.types.ts` (`LacakParams = { q; mode; limit?; tahun?; jenis? }`)
  - Route `GET /api/rangkaian/lacak` dengan `lacakLimiter` di `backend/src/routes/rangkaian.routes.ts`, dipasang lewat `app.use('/api/rangkaian', rangkaianRoutes)` di `app.ts`
  - Migrasi `0046_rangkaian_surat.sql` dan `0047_unit_kerja_direktorat.sql` beserta journal, termasuk kolom `unit_kerja.is_unit_pengawas`
- Consumes (P2, sesuai `docs/superpowers/plans/2026-09-26-integrasi-surat-p2-akses-lintas-unit.md`):
  - `recordAccessService.checkRead(user, entityType, entityId, executor?)` → `ReadAccessResult` `{ allowed; via: 'owner'|'pengawas'|'peserta'|null; rangkaianId; masked; … }`
  - `recordAccessService.checkMany(user, refs: ReadRef[], executor?)` → `Promise<Map<string, ReadAccessResult>>`, dengan kunci `readRefKey(ref)` = `` `${type}:${id}` ``
  - `readRefKey` diekspor dari `record-access.service.ts`
  - Dari `backend/src/services/access/visibility-spec.ts`:
    - `resolveKonteksBaca(user, executor)` → `KonteksBaca { unitJangkauan, pengawas, disposisiLamaRead }`
    - `jangkauanSql(rangkaianId, unitKerjaId, disposisiLamaRead)`
    - `dalamCakupanPengawasSql(unitCol)`
    - `kecocokanUnitRekaman(user)` dan `cocokUnitRekamanSql(match, unitCol)`
    - `barisDari<T>(result)`
    - `visibleSql(ctx, target, mode?)` dipakai seed P3
  - `GET /api/rangkaian/:id` dan `/by-surat/:jenis/:suratId`
  - Helper uji `backend/src/__tests__/helpers/rangkaian-pglite.ts` → `bootRangkaianDatabase()`
  - `frontend/src/components/surat/AlurSuratPanel.jsx`: `AlurSuratPanel({ jenis, suratId, aksesMelalui = 'owner', fallback = null })` (named + default), yang memuat lewat `rangkaianService.getBySurat`. P4 menambah prop opsional `rangkaianId` (Task 9).
  - `frontend/src/services/rangkaian.service.js`: `export const rangkaianService = { getById, getBySurat }` + `export default rangkaianService`
- Consumes (P3, frontend): metode `rangkaianService.lacak` yang ditambahkan P3 ke file yang sama.
- Consumes untuk D7 (Task 16–21):
  - P2 `visibility-spec.ts`: `visibleSql(ctx, target, mode?: 'read' | 'list')`, `jangkauanRekamanSql(ctx, type, alias)`, `cocokUnitRekamanSql`, `kecocokanUnitRekaman`, `dalamCakupanPengawas`, `dalamCakupanPengawasSql`, `resolveKonteksBaca`, `barisDari`, tipe `KonteksBaca`, `TargetVisibilitas`, `PelaksanaSql`, `PenggunaVisibilitas`
  - P2 `record-access.service.ts`: `isAllowedForRecordUnit`
  - P3 `services/rangkaian/aksi.ts`: `computeSuratAksi(role, ctx: SuratAksiContext): SuratAksi[]` dan `computeRangkaianAksi(ctx: RangkaianAksiContext): RangkaianAksi[]`
  - P3 `services/rangkaian/roles.ts`: `isFullAdmin(user)`
  - P1 `services/rangkaian-status.ts`: tipe `RangkaianStatus`
  - repo: `utils/jakarta-date.ts` `jakartaDate()`, `audit-log.service.ts` `auditLogService.logActionOrThrow(data, executor)` + `CriticalAuditContext`, `utils/errors.ts` `NotFoundError`/`ConflictError`
  - P3 frontend:
    - `lib/tindak-lanjut.js` `buildTindakLanjutState(jenis, surat, aksi)`
    - `components/DistributeDialog.jsx` `DistributeDialog({ open, onOpenChange, suratData, sourceUnitId, onSuccess })`
    - `components/surat/BerkaskanDialog.jsx` `BerkaskanDialog({ open, onOpenChange, rangkaian, onBerhasil })`
    - `components/surat/AlurSuratActions.jsx` `TautkanDialog({ open, onOpenChange, jenis, surat, onBerhasil })`
  - Kolom `surat_keluar.asal_naskah` (0046). `updateSuratKeluarSchema` P3 **tidak** memuat `asalNaskah` (`.omit({ …, asalNaskah: true, … })`), sehingga belum ada jalur untuk menandai surat lama sebagai inisiatif. Karena itu Task 17 menambah endpoint itu.
- Kontrak respons `/lacak` (`data` di amplop `{ success: true, data }`), yaitu bentuk yang dibekukan untuk P4 dari §4.8, §5, dan §6. Typedef ini **identik** dengan `backend/src/services/rangkaian/lacak.types.ts` P3 Task 4 (sumber kebenaran); bila berbeda, P3 yang menang:

```js
/**
 * @typedef {Object} LacakResult
 * @property {string} q
 * @property {'lacak'|'referensi'|'cek'} mode
 * @property {'nomor'|'perihal'} jenisKueri
 * @property {LacakKelompok[]} kelompok            // ≤ 8, urut max(skor) DESC, max(tanggal_surat) DESC, kunci ASC
 *
 * @typedef {Object} LacakKelompok
 * @property {string} kunci                         // coalesce(rs.digabung_ke_id, rs.id)::text (uuid rangkaian, sesudah resolusi digabung), atau 'surat:'||surat_id
 * @property {number} skor                          // max(skor) anggota yang cocok dan terbaca
 * @property {string|null} tanggalTerbaru
 * @property {{id:string,kode:string,status:'aktif'|'selesai'|'diberkaskan'|'digabung',judul:string,tahun:number,asal:string}|null} rangkaian
 * @property {Array<{jenis:'surat_masuk'|'surat_keluar',id:string,nomorSurat:string|null,perihal:string|null,tahun:number,skor:number}>} cocok
 * @property {Array<LacakNode|LacakNodeTersamar>} pratinjau   // ≤ 8
 * @property {number} jumlahAnggota
 * @property {boolean} pratinjauTerpotong
 *
 * @typedef {{anggotaId:string|null,jenis:'surat_masuk'|'surat_keluar',id:string,nomorSurat:string|null,perihal:string|null,tanggalSurat:string|null,tahun:number,naskah:string|null,unitKerjaId:string,unitNama:string,relasi:('balasan'|'tindak_lanjut'|'menjelaskan'|'merujuk'|null),masked:false}} LacakNode
 * @typedef {{anggotaId:string,jenis:'surat_masuk'|'surat_keluar',unitNama:string,label:'Dikecualikan',masked:true,dapatAjukanAkses:boolean}} LacakNodeTersamar
 */
```

- Produces: branch `feat/integrasi-surat-p4` dan catatan baseline (jumlah tes lulus) untuk Task 22.

- [ ] **Step 1: Buat branch dari ujung P3**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
git status --short
git fetch origin
git switch -c feat/integrasi-surat-p4 origin/main
```

Expected: working tree bersih (hanya file tak terlacak lama di root), dan branch baru terbentuk dari `origin/main` yang sudah memuat PR P3. Konvensi lintas fase: satu branch per fase `feat/integrasi-surat-pN`, dibuat dari `origin/main` setelah PR fase sebelumnya dimerge; bila PR itu belum dimerge, branch ditumpuk di ujung `feat/integrasi-surat-p(N-1)` lalu di-rebase ke `origin/main` setelah merge. Satu PR per fase ke `main`.

- [ ] **Step 2: Verifikasi nama backend P2/P3**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
grep -n "export function normalizeNomor\|export function nomorNormSql\|export function escapeLike" backend/src/utils/nomor-surat.ts
grep -n "async lacak\|lacakService.search" backend/src/services/rangkaian.service.ts
grep -n "export function skorSql\|AS skor\|LIMIT \${SEED_LIMIT}\|digabung_ke_id\|'surat:'\|ORDER BY skor DESC" backend/src/services/rangkaian/lacak.service.ts
grep -n "export function classifyLacakQuery\|export const LIKE_ESCAPE" backend/src/utils/nomor-surat.ts
grep -n "checkRead\|checkMany\|export function readRefKey" backend/src/services/record-access.service.ts
grep -n "export async function resolveKonteksBaca\|export function jangkauanSql\|export function dalamCakupanPengawasSql\|export function cocokUnitRekamanSql\|export function kecocokanUnitRekaman\|export function barisDari" backend/src/services/access/visibility-spec.ts
grep -n "export async function bootRangkaianDatabase" backend/src/__tests__/helpers/rangkaian-pglite.ts
grep -n "'/lacak'\|lacakLimiter" backend/src/routes/rangkaian.routes.ts
grep -n "rangkaian" backend/src/app.ts backend/src/middlewares/demo-access.middleware.ts
grep -n "is_unit_pengawas" backend/src/db/migrations/0046_rangkaian_surat.sql
grep -n "0046_rangkaian_surat\|0047_unit_kerja_direktorat" backend/src/db/migrations/meta/_journal.json
# D7 (Task 16–18)
grep -n "export function jangkauanRekamanSql\|export function visibleSql\|export type PelaksanaSql\|export interface TargetVisibilitas\|export function dalamCakupanPengawas(" backend/src/services/access/visibility-spec.ts
grep -n "export function computeSuratAksi\|export function computeRangkaianAksi\|export interface SuratAksiContext" backend/src/services/rangkaian/aksi.ts
grep -n "export function isFullAdmin" backend/src/services/rangkaian/roles.ts
grep -n "asal_naskah" backend/src/db/migrations/0046_rangkaian_surat.sql
grep -n "asalNaskah: true" backend/src/validators/schemas.ts
grep -n "protect_archived_surat_source\|surat_keluar_archived_source_guard" backend/src/db/migrations/0021_archive_source_domain_integrity.sql
```

Expected: setiap perintah mengembalikan minimal satu baris. Dari grep `lacak.service.ts`, catat baris `export function skorSql` (titik ubah Task 3), CTE `teratas` (`ORDER BY skor DESC, tanggal_surat DESC NULLS LAST, surat_id LIMIT ${SEED_LIMIT}`), dan `ORDER BY` kelompok (`skor DESC, tanggal_terbaru DESC NULLS LAST, kunci ASC`). Untuk D7: grep `asalNaskah: true` menunjukkan skema update P3 mengecualikan `asalNaskah` (dasar Task 17). Grep 0021 menunjukkan trigger `surat_keluar_archived_source_guard` yang perilakunya diuji Task 17 (fungsi itu hanya membandingkan `id`, `is_archived`, `is_deleted`, unit, tahun, nomor, tanggal, perihal, dan kode klasifikasi; `asal_naskah` tidak dijaga).

- [ ] **Step 3: Verifikasi nama frontend P2/P3**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
grep -n "export const rangkaianService\|export default\|lacak\|getById\|getBySurat" frontend/src/services/rangkaian.service.js
grep -n "export function AlurSuratPanel\|export default AlurSuratPanel\|rangkaianService.getBySurat" frontend/src/components/surat/AlurSuratPanel.jsx
# D7 (Task 20–21)
grep -n "export function buildTindakLanjutState" frontend/src/lib/tindak-lanjut.js
grep -n "export function DistributeDialog" frontend/src/components/DistributeDialog.jsx
grep -n "export function BerkaskanDialog" frontend/src/components/surat/BerkaskanDialog.jsx
grep -n "export function TautkanDialog" frontend/src/components/surat/AlurSuratActions.jsx
grep -n "refreshInterval: 60000" frontend/src/components/app-header.jsx
```

Expected:
- `rangkaianService` diekspor named dan default, dengan `getById`, `getBySurat`, dan `lacak`.
- `AlurSuratPanel` diekspor named dan default, dengan signature `({ jenis, suratId, aksesMelalui = 'owner', fallback = null })`, dan efek pemuatannya memanggil `rangkaianService.getBySurat(jenis, suratId)`. Baris efek ini menjadi titik ubah Task 9.

- [ ] **Step 4: Cocokkan bentuk respons `/lacak` dengan kontrak di atas**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
grep -n "kelompok\|pratinjau\|pratinjauTerpotong\|jumlahAnggota\|jenisKueri\|dapatAjukanAkses\|unitKerjaId" backend/src/services/rangkaian/lacak.types.ts
```

Expected: semua nama properti muncul. Bila P3 memakai nama lain, samakan dengan pemilik P3 dan perbarui typedef di atas beserta fixture Task 10–13 sebelum lanjut.

- [ ] **Step 5: Catat baseline suite**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
(cd backend && npx vitest run) 2>&1 | tail -5
(cd frontend && npx vitest run) 2>&1 | tail -5
```

Expected: kedua suite hijau. Catat jumlah file/tes sebagai baseline Task 22. Tidak ada commit pada task ini.

---


#### Amandemen pra-eksekusi Task 1 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p4-lacak-surat/preflight-rulings.md`.


1. **Typedef (REQUIRED) [P4-T1-1] RECHECK-AFTER-P3.** In the frozen contract block, change the `LacakNodeTersamar` line to:
   ```js
    * @typedef {{anggotaId:string|null,jenis:'surat_masuk'|'surat_keluar',unitNama:string,label:'Dikecualikan',masked:true,dapatAjukanAkses:boolean}} LacakNodeTersamar
   ```
   A masked single-surat node (a group without a rangkaian) carries `anggotaId: null` (P3 T4-3).
   - **(delta P3) Backend type as well.** Real P3 still declares `LacakNodeTersamar.anggotaId: string` (`backend/src/services/rangkaian/lacak.types.ts:30`) and emits the tunggal placeholder as `anggotaId: null as never` (`lacak.service.ts:184` @ b4d86fa; after the fix wave, a `tersamarTunggal()` helper with the same cast). In Task 1, change `lacak.types.ts:30` to `anggotaId: string | null;` and drop the `as never` cast. `LacakNode.anggotaId` is already `string | null` (`lacak.types.ts:15`). Run backend tsc. This is P3 `final-review-access.md` carry-forward 2 and ledger Task 4 minor (`progress.md:66`).
2. **Consumes corrections (REQUIRED) [P4-T1-4].** Replace "P1 `services/rangkaian-status.ts`: tipe `RangkaianStatus`" (the Task 1 D7 list, and the Task 16 Interfaces line) with "P1 `services/rangkaian.service.ts`: tipe `RangkaianStatus` (re-export; `rangkaian-status.ts` tidak mengekspornya)". Add these D7 consumes:
   - P3 builders `anggotaMemblokirSql(rangkaianId: SQL|string): SQL` and `disposisiTerbukaSql(rangkaianId: SQL|string): SQL`. P3 T12-1 exports them from `services/rangkaian.service.ts`, and `services/rangkaian/deps.ts` re-exports them.
   - P2/P3 `rangkaian-read.service.ts`: `judulTersamar(kode)`, `LABEL_DIKECUALIKAN`, and `tingkatAksesRangkaian(user, rangkaianId, executor)` (P3 T14-1).
   - P2 `record-access.service.ts`: `readRefKey`, `recordAccessService.checkMany`, and the types `ReadAccessResult`, `ReadExecutor` and `ReadRef`.
3. **Step 2: append these greps (REQUIRED) [P4-T1-2] RECHECK-AFTER-P3.**
   ```bash
   grep -n "mutable\|pengawasDalamCakupan\|isFullAdmin" backend/src/services/rangkaian/aksi.ts
   grep -n "pengawas\b\|selesaiManual\|adaPenghalang\|adaDisposisiTerbuka" backend/src/services/rangkaian/aksi.ts
   grep -n "export function anggotaMemblokirSql\|export function disposisiTerbukaSql" backend/src/services/rangkaian.service.ts
   grep -n "anggotaMemblokirSql\|disposisiTerbukaSql\|dalamCakupanPengawasSql\|judulTersamar\|LABEL_DIKECUALIKAN\|pengawasUntukUnit\|tingkatAksesRangkaian\|LIKE_ESCAPE" backend/src/services/rangkaian/deps.ts
   grep -n "export async function tingkatAksesRangkaian\|export function judulTersamar\|export const LABEL_DIKECUALIKAN" backend/src/services/rangkaian-read.service.ts
   grep -n "judulTersamar(r.kode)\|lk_a\|LIKE_ESCAPE" backend/src/services/rangkaian/lacak.service.ts
   grep -n "export const LIKE_ESCAPE\|export function classifyLacakQuery\|export function escapeLike" backend/src/utils/nomor-surat.ts
   ```
   Expected output and what to record:
   - `SuratAksiContext` has `mutable` and `pengawasDalamCakupan`. Record whether it also declares `isFullAdmin` (P3 C-3).
   - `RangkaianAksiContext` has `pengawas`, `selesaiManual` and `adaPenghalang`. Record whether `adaDisposisiTerbuka` is still declared.
   - Both builders exist.
   - `tingkatAksesRangkaian` is exported.
   - `lacak.service.ts` uses `judulTersamar(r.kode)`.

   Task 16 builds its context objects with exactly the landed field set.

   **(delta P3) Expected output, verified on real P3 @ b4d86fa:**
   - `SuratAksiContext` (`aksi.ts:18-30`) = `jenis, via, mutable, isArchived, naskahDinas, rangkaian, distribusiUnitSaya, pengawasDalamCakupan`. There is **no** `isFullAdmin` field.
   - `RangkaianAksiContext` (`aksi.ts:61-74`) = `role, unitEfektif, pengawas, pengawasTutup, rangkaian, selesaiManual, adaPenghalang, adaDisposisiTerbukaDalamCakupan`. There is **no** `adaDisposisiTerbuka`. `pengawasTutup` and `adaDisposisiTerbukaDalamCakupan` are required.
   - Both builders are exported from `rangkaian.service.ts` (`anggotaMemblokirSql` :182, `disposisiTerbukaSql` :201) and re-exported by `deps.ts:42`.
   - `deps.ts` re-exports `dalamCakupanPengawasSql` (:53), `judulTersamar`/`LABEL_DIKECUALIKAN` (:56), `tingkatAksesRangkaian` (:58), `denganRetryDeadlock` (:60), `isPengawas` (:87), `pengawasUntukUnit` (:96) and `loadJangkauan` (:107). `LIKE_ESCAPE` is **not** in deps; it is exported by `utils/nomor-surat.ts:42`.
   - `export async function tingkatAksesRangkaian` is at `rangkaian-read.service.ts:316`. `judulTersamar` is at :188 and `LABEL_DIKECUALIKAN` at :32.
   - `lacak.service.ts` has `lk_a` (:85-87). The judul expression is `induk && indukTerlihat ? r.judul : judulTersamar(r.kode)` (:195), **not** `judulTersamar(r.kode)` inside a `bolehLihat` ternary. So the grep for `judulTersamar(r.kode)` matches, but `bolehLihat` does not exist.
   - In flux (fix wave A-I3): `deps.ts` will also export `tingkatRangkaianPenuh` and `BATAS_NODE_DETAIL`. The judul moves into one `const rangkaian = { ...r, judul: … }` that both branches use. Re-run the greps on the post-fix tip.
4. **Step 3: frontend greps and Expected (REQUIRED) [P4-T1-3] RECHECK-AFTER-P3.** Append:
   ```bash
   grep -n "onChanged\|muatKe\|muatUlang\|AlurSuratActions" frontend/src/components/surat/AlurSuratPanel.jsx
   grep -n "export const JENIS_RELASI_LABEL\|export function buildTindakLanjutState" frontend/src/lib/tindak-lanjut.js
   grep -n "onBerhasil\|onSuccess\|suratData\|sourceUnitId" frontend/src/components/surat/BerkaskanDialog.jsx frontend/src/components/surat/AlurSuratActions.jsx frontend/src/components/DistributeDialog.jsx
   grep -n "data: terakhir\|loading: true" frontend/src/hooks/use-lacak-search.js
   ```
   Replace the Expected bullet for `AlurSuratPanel` with this: the signature is `({ jenis, suratId, aksesMelalui = 'owner', fallback = null, onChanged })`. The loader is inside the inner async `muat()`, and the effect deps are `[jenis, suratId, muatKe]` (P3 T25-1). Also record whether the real P3 hook returns `data: terakhir` or `data: null` while loading; Task 10 depends on it.

   **(delta P3) Corrected Expected, real P3 @ b4d86fa:**
   - Panel signature `({ jenis, suratId, aksesMelalui = 'owner', fallback = null, onChanged, muatUlangKe = 0 })` at `AlurSuratPanel.jsx:56`. `muatUlangKe` is a parent-controlled reload signal added by P3 (comment :70-77).
   - Loader at :83, inside `muat()` (:80). Effect deps `[jenis, suratId, muatKe, muatUlangKe]` at :96.
   - `const d = state.data` at :127. `<AlurSuratActions detail={d} onChanged={muatUlang} />` at :170. `STATUS_RANGKAIAN_LABEL` is exported at :15.
   - Dialog props match the P4 plan exactly: `DistributeDialog({ open, onOpenChange, suratData, sourceUnitId, onSuccess })` (`DistributeDialog.jsx:17`), `BerkaskanDialog({ open, onOpenChange, rangkaian, onBerhasil })` (`BerkaskanDialog.jsx:19`), and named `TautkanDialog({ open, onOpenChange, jenis, surat, onBerhasil })` (`AlurSuratActions.jsx:303`).
   - Hook: `data: null` while loading (`use-lacak-search.js:63`), default import `rangkaianService` (:2), plain `retry` (:54-57). Critic C-1 applies.
   - `JENIS_RELASI_LABEL` at `lib/tindak-lanjut.js:6`; `buildTindakLanjutState` at :38.
5. **(delta P3) Record-only decisions carried from the P3 final reviews (REQUIRED to record, no code unless stated).**
   - **P3 go-live instant.** Record the exact instant the P3 code went live in production, taken from the deploy log, in the P4 PR. Task 22 item 3 writes it into `RANGKAIAN_DATA_LAMA_SEBELUM` (spec:669; P3 `final-review-spec.md` "P4 Task 1").
   - **Legacy `balasanUntuk` on PUT surat keluar.** `surat-keluar.routes.ts:336-357` still accepts it (same-unit only) and writes the legacy column without a relasi (ledger Task 8 minor, `progress.md:120`). The frontend edit form re-sends it (P3 frontend M15). D7 already treats it as "handled" (`sm_belum_ditindaklanjuti`) and as "not inisiatif" (T16-5), so P4 stays correct either way. Default: no P4 change, recorded in the PR. Dropping it from `updateSuratKeluarSchema` is a spec-owner/P3-follow-up decision.
   - **Per-row `aksiDiizinkan` on list endpoints** (P3 F3 open question, frontend carry-forward 4 / M13). Out of P4 scope; the D7 list already carries per-row `aksiDiizinkan`. Record as deferred.



### Task 2: Modul skor Lacak murni (`lacak-skor.ts`)

**Files:**
- Create: `backend/src/services/lacak-skor.ts`
- Test: `backend/src/__tests__/lacak-skor.test.ts`

**Interfaces:**
- Consumes (P1/P3): `nomorNormSql` (P1), `escapeLike`, `classifyLacakQuery` (P3 Task 3) dari `backend/src/utils/nomor-surat.ts`. `bentukKueriLacak` **tidak** membuat klasifikasi kedua: ia hanya memetakan `LacakQueryPlan` P3 (`modeNomor = plan.jenis === 'nomor'`).
- Produces:
  - `SKOR_LACAK` = `{ NOMOR_MENTAH_SAMA:100, NOMOR_NORM_SAMA:90, NOMOR_PREFIX_MENTAH_BERBATAS:80, NOMOR_PREFIX_NORM:70, NOMOR_SUBSTRING_NORM:50, PERIHAL_SEMUA_TOKEN:40, PERIHAL_FRASA_UTUH:5, DARI_KEPADA:20 }`
  - `MIN_PANJANG_SUBSTRING_NORM = 5`
  - `interface KueriLacak { q; qLower; qNorm; tokens; modeNomor }`
  - `interface KolomSkorLacak { nomor: SQL; perihal: SQL; dari: SQL; kepada: SQL }`
  - `bentukKueriLacak(raw: string): KueriLacak`
  - `skorNomorSql(nomor: SQL, k: KueriLacak): SQL`
  - `skorTeksSql(kolom: KolomSkorLacak, k: KueriLacak): SQL`
  - `skorLacakSql(kolom: KolomSkorLacak, k: KueriLacak): SQL`

- [ ] **Step 1: Tulis tes yang gagal**

```ts
// backend/src/__tests__/lacak-skor.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { bentukKueriLacak, SKOR_LACAK, skorLacakSql } from '../services/lacak-skor';

let database: PGlite;
let db: ReturnType<typeof drizzle>;
const kolom = {
    nomor: sql.raw('t.nomor_surat'),
    perihal: sql.raw('t.perihal'),
    dari: sql.raw('t.dari'),
    kepada: sql.raw('t.kepada'),
};

beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
        CREATE TABLE t (id int PRIMARY KEY, nomor_surat varchar(255), perihal text, dari text, kepada text);
        INSERT INTO t VALUES
          (1,  'B-12/PTPP.1/IX/2024',         'Undangan rapat', NULL, NULL),
          (2,  'b-12/ptpp.1/ix/2024',         'Undangan rapat', NULL, NULL),
          (3,  'B.12/PTPP-1/IX/2024',         'Undangan rapat', NULL, NULL),
          (4,  'B-12/PTPP.1/IX/2024/Lamp.II', 'Undangan rapat', NULL, NULL),
          (5,  'B-12/PTPP.1/IX/20245',        'Undangan rapat', NULL, NULL),
          (6,  'XB-12/PTPP.1/IX/2024',        'Undangan rapat', NULL, NULL),
          (7,  'B-123/PTPP.1/IX/2024',        'Undangan rapat', NULL, NULL),
          (8,  'ND-7/2024', 'Tindak lanjut B-12/PTPP.1/IX/2024 tentang rapat', NULL, NULL),
          (9,  NULL, 'Lain-lain', 'Kanwil PTPP 12 IX 2024', NULL),
          (11, '1/23',            'Undangan rapat', NULL, NULL),
          (12, '12/3',            'Undangan rapat', NULL, NULL),
          (13, '1/23/PTPP/2024',  'Undangan rapat', NULL, NULL),
          (14, '12/3/PTPP/2024',  'Undangan rapat', NULL, NULL),
          (15, 'ST-4/2024',       'Sertifikat tanah ulayat ñandú', NULL, NULL);
    `);
    db = drizzle(database);
}, 60_000);
afterAll(async () => { await database?.close(); });

async function skor(q: string): Promise<Record<number, number>> {
    const result = await db.execute(sql`SELECT t.id, ${skorLacakSql(kolom, bentukKueriLacak(q))} AS skor FROM t ORDER BY t.id`);
    return Object.fromEntries((result.rows as Array<{ id: number; skor: number }>).map(row => [row.id, Number(row.skor)]));
}

describe('bentukKueriLacak', () => {
    it('mendeteksi mode nomor dan menormalkan kueri', () => {
        expect(bentukKueriLacak('  B-12/PTPP.1/IX/2024  ')).toMatchObject({
            q: 'B-12/PTPP.1/IX/2024', qLower: 'b-12/ptpp.1/ix/2024', qNorm: 'b12ptpp1ix2024', modeNomor: true,
        });
        expect(bentukKueriLacak('Rapat koordinasi')).toMatchObject({ modeNomor: false, tokens: ['rapat', 'koordinasi'] });
        expect(bentukKueriLacak('rapat 2024').modeNomor).toBe(true);
    });
    it('mempertahankan token Unicode ≥ 2 karakter (perbaikan tokenizer ASCII global-search)', () => {
        expect(bentukKueriLacak('ulayat Ñandú').tokens).toEqual(['ulayat', 'ñandú']);
        expect(bentukKueriLacak('B-12/PTPP.1/IX/2024').tokens).toEqual(['12', 'ptpp', 'ix', '2024']);
    });
});

describe('skorLacakSql', () => {
    it('memberi skor varian B-12/PTPP.1/IX/2024 sesuai tabel §6 ditambah prefix mentah berbatas', async () => {
        const s = await skor('B-12/PTPP.1/IX/2024');
        expect(s).toMatchObject({ 1: 100, 2: 100, 3: 90, 4: 80, 5: 70, 6: 50, 7: 0, 8: 45, 9: 20 });
    });
    it('memisahkan 1/23 dan 12/3 yang bertabrakan setelah normalisasi', async () => {
        expect(await skor('1/23')).toMatchObject({ 11: 100, 12: 90, 13: 80, 14: 70 });
        expect(await skor('12/3')).toMatchObject({ 11: 90, 12: 100, 13: 70, 14: 80 });
    });
    it('substring nomor hanya bila panjang qNorm ≥ 5', async () => {
        expect((await skor('PTPP.1'))[7]).toBe(SKOR_LACAK.NOMOR_SUBSTRING_NORM);
        expect((await skor('IX/2'))[1]).toBe(0);
    });
    it('perihal: semua token 40, frasa utuh +5, termasuk token non-ASCII', async () => {
        expect((await skor('ulayat ñandú'))[15]).toBe(45);
        expect((await skor('tanah sertifikat'))[15]).toBe(40);
    });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `(cd backend && npx vitest run src/__tests__/lacak-skor.test.ts)`
Expected: FAIL, karena `Failed to resolve import "../services/lacak-skor"`.

- [ ] **Step 3: Implementasi minimal**

```ts
// backend/src/services/lacak-skor.ts
import { sql, type SQL } from 'drizzle-orm';
import { classifyLacakQuery, escapeLike, nomorNormSql } from '../utils/nomor-surat.js';

/** Tabel skor Lacak Surat (§6) ditambah tingkat prefix mentah berbatas (P4). */
export const SKOR_LACAK = Object.freeze({
    NOMOR_MENTAH_SAMA: 100,
    NOMOR_NORM_SAMA: 90,
    NOMOR_PREFIX_MENTAH_BERBATAS: 80,
    NOMOR_PREFIX_NORM: 70,
    NOMOR_SUBSTRING_NORM: 50,
    PERIHAL_SEMUA_TOKEN: 40,
    PERIHAL_FRASA_UTUH: 5,
    DARI_KEPADA: 20,
});
export const MIN_PANJANG_SUBSTRING_NORM = 5;

export interface KueriLacak {
    q: string;
    qLower: string;
    qNorm: string;
    tokens: string[];
    modeNomor: boolean;
}

export interface KolomSkorLacak {
    nomor: SQL;
    perihal: SQL;
    dari: SQL;
    kepada: SQL;
}

const angka = (value: number) => sql.raw(String(value));
const escapeRegexAre = (value: string) => value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

/** Satu sumber klasifikasi: classifyLacakQuery (P3 Task 3). Di sini hanya dipetakan ke bentuk skor. */
export function bentukKueriLacak(raw: string): KueriLacak {
    const plan = classifyLacakQuery(raw);
    return { q: plan.q, qLower: plan.qLower, qNorm: plan.qNorm, tokens: plan.tokens, modeNomor: plan.jenis === 'nomor' };
}

/**
 * Skor nomor. Prefix mentah berbatas (80) mensyaratkan karakter setelah kueri
 * adalah pemisah atau akhir string, sehingga "1/23" → "1/23/PTPP/2024" (80)
 * mengalahkan "12/3/PTPP/2024" (70) yang hanya sama setelah normalisasi.
 */
export function skorNomorSql(nomor: SQL, k: KueriLacak): SQL {
    if (!k.modeNomor || k.qNorm.length === 0) return sql`0`;
    const norm = nomorNormSql(nomor);
    const prefixNorm = `${escapeLike(k.qNorm)}%`;
    const berbatas = `^${escapeRegexAre(k.qLower)}([^0-9a-z]|$)`;
    const substring = k.qNorm.length >= MIN_PANJANG_SUBSTRING_NORM
        ? sql` WHEN ${norm} LIKE ${`%${escapeLike(k.qNorm)}%`} ESCAPE '\\' THEN ${angka(SKOR_LACAK.NOMOR_SUBSTRING_NORM)}`
        : sql``;
    return sql`(CASE
        WHEN lower(${nomor}) = ${k.qLower} THEN ${angka(SKOR_LACAK.NOMOR_MENTAH_SAMA)}
        WHEN ${norm} = ${k.qNorm} THEN ${angka(SKOR_LACAK.NOMOR_NORM_SAMA)}
        WHEN ${norm} LIKE ${prefixNorm} ESCAPE '\\' AND lower(${nomor}) ~ ${berbatas} THEN ${angka(SKOR_LACAK.NOMOR_PREFIX_MENTAH_BERBATAS)}
        WHEN ${norm} LIKE ${prefixNorm} ESCAPE '\\' THEN ${angka(SKOR_LACAK.NOMOR_PREFIX_NORM)}${substring}
        ELSE 0 END)`;
}

function semuaTokenSql(teks: SQL, tokens: string[]): SQL {
    return sql.join(tokens.map(token => sql`${teks} LIKE ${`%${escapeLike(token)}%`} ESCAPE '\\'`), sql` AND `);
}

/** Skor teks: semua token AND di perihal (40, +5 frasa utuh), atau di dari/kepada (20). */
export function skorTeksSql(kolom: KolomSkorLacak, k: KueriLacak): SQL {
    if (k.tokens.length === 0) return sql`0`;
    const perihal = sql`lower(coalesce(${kolom.perihal}, ''))`;
    const pihak = sql`lower(coalesce(${kolom.dari}, '') || ' ' || coalesce(${kolom.kepada}, ''))`;
    const frasa = `%${escapeLike(k.qLower)}%`;
    return sql`(CASE
        WHEN ${semuaTokenSql(perihal, k.tokens)} THEN ${angka(SKOR_LACAK.PERIHAL_SEMUA_TOKEN)}
            + (CASE WHEN ${perihal} LIKE ${frasa} ESCAPE '\\' THEN ${angka(SKOR_LACAK.PERIHAL_FRASA_UTUH)} ELSE 0 END)
        WHEN ${semuaTokenSql(pihak, k.tokens)} THEN ${angka(SKOR_LACAK.DARI_KEPADA)}
        ELSE 0 END)`;
}

export function skorLacakSql(kolom: KolomSkorLacak, k: KueriLacak): SQL {
    return sql`GREATEST(${skorNomorSql(kolom.nomor, k)}, ${skorTeksSql(kolom, k)})`;
}
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `(cd backend && npx vitest run src/__tests__/lacak-skor.test.ts)`
Expected: PASS (6 tes).

- [ ] **Step 5: Commit**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
git add backend/src/services/lacak-skor.ts backend/src/__tests__/lacak-skor.test.ts
git commit -F - <<'EOF'
feat(lacak): modul skor Lacak murni dengan prefix mentah berbatas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---


#### Amandemen pra-eksekusi Task 2 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p4-lacak-surat/preflight-rulings.md`.


1. **Escape constant (ADVISORY) [P4-T2-1] RECHECK-AFTER-P3.** In `lacak-skor.ts`, import `LIKE_ESCAPE` from `../utils/nomor-surat.js` and use `${sql.raw(LIKE_ESCAPE)}` or the P3 helper wherever the plan writes the literal `ESCAPE '\\'`. The expected test results are unchanged (6/6).
   - **(delta P3) Correction.** Real `LIKE_ESCAPE` is already an SQL chunk: `export const LIKE_ESCAPE = sql.raw("ESCAPE '\\'")` (`utils/nomor-surat.ts:42`). Interpolate it as `${LIKE_ESCAPE}`, exactly as P3 does (`lacak.service.ts:31, 47, 51, 62`). `sql.raw(LIKE_ESCAPE)` is a TS2345 type error, because `sql.raw` takes a string. `escapeLike` (`nomor-surat.ts:38`) is the paired value escaper.



### Task 3: Terapkan skor dan urutan kelompok di `rangkaianService.lacak` (fixture peringkat)

**Files:**
- Create: `backend/src/__tests__/helpers/lacak-pglite.ts`
- Create: `backend/src/__tests__/lacak-ranking.integration.test.ts`
- Modify: `backend/src/services/rangkaian/lacak.service.ts` (P3 Task 4: fungsi `skorSql`; titik ubah dicatat di Task 1 Step 2)

**Interfaces:**
- Consumes (P3): `rangkaianService.lacak(user, { q, tahun?, mode, limit?, jenis? })` (delegasi ke `lacakService.search`) beserta `skorSql`/CTE `teratas`/`kelompok` di `services/rangkaian/lacak.service.ts`; tabel `rangkaian_surat`, `rangkaian_anggota`, `rangkaian_relasi`, `surat_distributions.rangkaian_id`, dan `unit_kerja.is_unit_pengawas`
- Consumes (Task 2): `bentukKueriLacak`, `skorLacakSql`
- Produces:
  - Helper uji `createMigratedPglite()`, `resetRangkaianFixture(db)`, `seedUnits`, `insertUser`, `insertSuratMasuk`, `insertSuratKeluar`, `insertRangkaian`, `insertRelasi`, `insertDisposisi`, `uid(n)`, dan tipe `PenggunaUji`
  - Jaminan urutan (sudah ditulis P3, dikunci uji di task ini): seed `teratas` `ORDER BY skor DESC, tanggal_surat DESC NULLS LAST, surat_id LIMIT ${SEED_LIMIT}` (200); kelompok `ORDER BY skor DESC, tanggal_terbaru DESC NULLS LAST, kunci ASC LIMIT ${limit}` (≤ 8), dengan `skor = max(t.skor)` dan `tanggal_terbaru = max(t.tanggal_surat)`

- [ ] **Step 1: Tulis helper PGlite dengan rantai migrasi penuh**

```ts
// backend/src/__tests__/helpers/lacak-pglite.ts
import type { PGlite } from '@electric-sql/pglite';

// Boot rantai migrasi 0000–0047 memakai helper bersama P2 (satu sumber urutan migrasi uji).
export { bootRangkaianDatabase as createMigratedPglite } from './rangkaian-pglite.js';

export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export type PenggunaUji = { id: string; email: string; name: string; role: string; unitKerjaId: string | null };
export type AnggotaUji = { jenis: 'surat_masuk' | 'surat_keluar'; id: string; peran?: 'induk' | 'anggota'; unit: string };

export async function resetRangkaianFixture(database: PGlite): Promise<void> {
    await database.exec(`TRUNCATE rangkaian_relasi, rangkaian_anggota, rangkaian_peserta, rangkaian_koreksi_berkas,
        surat_distributions, rangkaian_surat, record_access_grants, surat_keluar, surat_masuk, users CASCADE`);
}

export async function seedUnits(database: PGlite, units: Array<{ id: string; name: string; pengawas?: boolean }>): Promise<void> {
    for (const unit of units) {
        await database.query(
            `INSERT INTO unit_kerja (id, name, is_unit_pengawas) VALUES ($1, $2, $3)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_unit_pengawas = EXCLUDED.is_unit_pengawas`,
            [unit.id, unit.name, unit.pengawas ?? false],
        );
    }
}

export async function insertUser(database: PGlite, user: PenggunaUji): Promise<PenggunaUji> {
    await database.query('INSERT INTO users (id, email, name, role, unit_kerja_id) VALUES ($1, $2, $3, $4, $5)',
        [user.id, user.email, user.name, user.role, user.unitKerjaId]);
    return user;
}

export async function insertSuratMasuk(database: PGlite, s: {
    n: number; unit?: string; nomor: string | null; tanggal: string; perihal?: string; dari?: string | null; sifat?: string;
}): Promise<string> {
    const id = uid(s.n);
    await database.query(
        `INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, tanggal_surat, perihal, dari, sifat_surat)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, s.unit ?? 'dir_bppt', s.n, Number(s.tanggal.slice(0, 4)), s.nomor, s.tanggal,
            s.perihal ?? 'Undangan rapat', s.dari ?? null, s.sifat ?? 'Biasa'],
    );
    return id;
}

export async function insertSuratKeluar(database: PGlite, s: {
    n: number; unit?: string; nomor: string | null; tanggal: string; perihal?: string; kepada?: string | null;
    naskah?: string; klasifikasi?: string;
}): Promise<string> {
    const id = uid(s.n);
    await database.query(
        `INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, naskah_dinas, nomor_surat, tanggal_surat, perihal,
             kepada, klasifikasi_keamanan, approval_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'approved')`,
        [id, s.unit ?? 'dir_bppt', s.n, Number(s.tanggal.slice(0, 4)), s.naskah ?? 'Nota Dinas', s.nomor, s.tanggal,
            s.perihal ?? 'Undangan rapat', s.kepada ?? null, s.klasifikasi ?? 'biasa'],
    );
    return id;
}

export async function insertRangkaian(database: PGlite, r: {
    n: number; kode: string; tahun: number; pencatat: string; judul: string; asal?: string; status?: string;
    pengolah?: string | null; digabungKe?: string | null; anggota: AnggotaUji[];
}): Promise<{ id: string; anggota: string[] }> {
    const id = uid(500_000 + r.n);
    const status = r.status ?? 'aktif';
    await database.query(
        `INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, unit_pengolah_id, judul, tahun, digabung_ke_id, selesai_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, r.kode, r.asal ?? 'surat_masuk', status, r.pencatat, r.pengolah ?? null, r.judul, r.tahun,
            r.digabungKe ?? null, status === 'selesai' ? new Date().toISOString() : null],
    );
    const anggota: string[] = [];
    for (const [index, item] of r.anggota.entries()) {
        const anggotaId = uid(600_000 + r.n * 100 + index);
        await database.query(
            `INSERT INTO rangkaian_anggota (id, rangkaian_id, surat_masuk_id, surat_keluar_id, unit_kerja_id, peran)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [anggotaId, id, item.jenis === 'surat_masuk' ? item.id : null, item.jenis === 'surat_keluar' ? item.id : null,
                item.unit, item.peran ?? 'anggota'],
        );
        anggota.push(anggotaId);
    }
    return { id, anggota };
}

export async function insertRelasi(database: PGlite, r: { rangkaianId: string; dari: string; ke: string; jenis: string }): Promise<void> {
    await database.query(
        'INSERT INTO rangkaian_relasi (rangkaian_id, dari_anggota_id, ke_anggota_id, jenis_relasi) VALUES ($1, $2, $3, $4)',
        [r.rangkaianId, r.dari, r.ke, r.jenis],
    );
}

export async function insertDisposisi(database: PGlite, d: {
    suratMasukId: string; sumber: string; target: string; status: 'sent' | 'received' | 'rejected'; rangkaianId: string;
}): Promise<void> {
    await database.query(
        `INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status, rangkaian_id, rejection_reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [d.suratMasukId, d.sumber, d.target, d.status, d.rangkaianId, d.status === 'rejected' ? 'Salah alamat disposisi' : null],
    );
}
```

- [ ] **Step 2: Tulis tes peringkat yang gagal**

```ts
// backend/src/__tests__/lacak-ranking.integration.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema';
import {
    createMigratedPglite, insertRangkaian, insertRelasi, insertSuratKeluar, insertSuratMasuk, insertUser,
    resetRangkaianFixture, seedUnits, uid, type PenggunaUji,
} from './helpers/lacak-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ db: holder.db }));

let database: PGlite;
let rangkaianService: typeof import('../services/rangkaian.service').rangkaianService;
const bppt: PenggunaUji = { id: uid(901), email: 'bppt@example.test', name: 'Admin BPPT', role: 'admin_unit', unitKerjaId: 'dir_bppt' };
const kunci = (hasil: { kelompok: Array<{ kunci: string }> }) => hasil.kelompok.map(kelompok => kelompok.kunci);

beforeAll(async () => {
    database = await createMigratedPglite();
    holder.db = drizzle(database, { schema });
    ({ rangkaianService } = await import('../services/rangkaian.service'));
}, 180_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => {
    await resetRangkaianFixture(database);
    await seedUnits(database, [
        { id: 'ditjen', name: 'Ditjen PTPP', pengawas: true },
        { id: 'sesditjen', name: 'Sesditjen', pengawas: true },
        { id: 'dir_bppt', name: 'Dit. BPPT' },
    ]);
    await insertUser(database, bppt);
});

describe('peringkat Lacak Surat (§6 + penyempurnaan P4)', () => {
    it('varian B-12/PTPP.1/IX/2024: mentah persis > norm sama > prefix berbatas > prefix norm > substring; seri skor → tanggal terbaru', async () => {
        const persisBaru = await insertSuratMasuk(database, { n: 1, nomor: 'B-12/PTPP.1/IX/2024', tanggal: '2024-09-20' });
        const persisLama = await insertSuratMasuk(database, { n: 2, nomor: 'b-12/ptpp.1/ix/2024', tanggal: '2024-09-02' });
        const norm = await insertSuratMasuk(database, { n: 3, nomor: 'B.12/PTPP-1/IX/2024', tanggal: '2024-09-25' });
        const berbatas = await insertSuratMasuk(database, { n: 4, nomor: 'B-12/PTPP.1/IX/2024/Lamp.II', tanggal: '2024-09-26' });
        const prefixNorm = await insertSuratMasuk(database, { n: 5, nomor: 'B-12/PTPP.1/IX/20245', tanggal: '2024-09-27' });
        const substring = await insertSuratMasuk(database, { n: 6, nomor: 'XB-12/PTPP.1/IX/2024', tanggal: '2024-09-28' });
        await insertSuratMasuk(database, { n: 7, nomor: 'B-123/PTPP.1/IX/2024', tanggal: '2024-09-29' });

        const hasil = await rangkaianService.lacak(bppt, { q: 'B-12/PTPP.1/IX/2024', mode: 'lacak' });

        expect(kunci(hasil)).toEqual([persisBaru, persisLama, norm, berbatas, prefixNorm, substring].map(id => `surat:${id}`));
        expect(hasil.kelompok.map(kelompok => kelompok.skor)).toEqual([100, 100, 90, 80, 70, 50]);
    });

    it('1/23 vs 12/3: nomor mentah persis mengalahkan tabrakan normalisasi walau lebih lama', async () => {
        const a = await insertSuratMasuk(database, { n: 11, nomor: '1/23', tanggal: '2024-01-10' });
        const b = await insertSuratMasuk(database, { n: 12, nomor: '12/3', tanggal: '2024-03-10' });
        const c = await insertSuratMasuk(database, { n: 13, nomor: '1/23/PTPP/2024', tanggal: '2024-05-10' });
        const d = await insertSuratMasuk(database, { n: 14, nomor: '12/3/PTPP/2024', tanggal: '2024-06-10' });

        expect(kunci(await rangkaianService.lacak(bppt, { q: '1/23', mode: 'lacak' }))).toEqual([a, b, c, d].map(id => `surat:${id}`));
        expect(kunci(await rangkaianService.lacak(bppt, { q: '12/3', mode: 'lacak' }))).toEqual([b, a, d, c].map(id => `surat:${id}`));
    });

    it('SK bernomor sama tiap tahun: kartu terpisah per tahun, terbaru dahulu, tahun tercantum, filter tahun', async () => {
        const sk23 = await insertSuratKeluar(database, { n: 21, nomor: 'SK-01/DJ-PTPP', tanggal: '2023-01-05', naskah: 'Keputusan', perihal: 'Penetapan tim arsip 2023' });
        const sk24 = await insertSuratKeluar(database, { n: 22, nomor: 'SK-01/DJ-PTPP', tanggal: '2024-01-05', naskah: 'Keputusan', perihal: 'Penetapan tim arsip 2024' });
        const sk25 = await insertSuratKeluar(database, { n: 23, nomor: 'SK-01/DJ-PTPP', tanggal: '2025-01-06', naskah: 'Keputusan', perihal: 'Penetapan tim arsip 2025' });
        const nd25 = await insertSuratKeluar(database, { n: 24, nomor: 'ND-3/DJ-PTPP/2025', tanggal: '2025-01-20', perihal: 'Penjelasan Keputusan Nomor SK-01/DJ-PTPP' });
        const r = await insertRangkaian(database, {
            n: 1, kode: 'RS-2025-000001', tahun: 2025, asal: 'inisiatif', pencatat: 'dir_bppt', judul: 'Penetapan tim arsip 2025',
            anggota: [{ jenis: 'surat_keluar', id: sk25, peran: 'induk', unit: 'dir_bppt' }, { jenis: 'surat_keluar', id: nd25, unit: 'dir_bppt' }],
        });
        await insertRelasi(database, { rangkaianId: r.id, dari: r.anggota[1], ke: r.anggota[0], jenis: 'menjelaskan' });

        const hasil = await rangkaianService.lacak(bppt, { q: 'SK-01/DJ-PTPP', mode: 'lacak' });
        expect(kunci(hasil)).toEqual([r.id, `surat:${sk24}`, `surat:${sk23}`]);
        expect(hasil.kelompok[0].rangkaian).toMatchObject({ id: r.id, kode: 'RS-2025-000001', tahun: 2025 });
        expect(hasil.kelompok[1].cocok[0]).toMatchObject({ id: sk24, tahun: 2024 });
        expect(hasil.kelompok[2].cocok[0]).toMatchObject({ id: sk23, tahun: 2023 });

        expect(kunci(await rangkaianService.lacak(bppt, { q: 'SK-01/DJ-PTPP', mode: 'lacak', tahun: 2024 }))).toEqual([`surat:${sk24}`]);
    });

    it('perihal ND penjelas dan nomor SK menghasilkan kartu RS yang sama, lengkap dengan label relasi', async () => {
        const sk = await insertSuratKeluar(database, { n: 31, nomor: 'SK-02/DJ-PTPP', tanggal: '2025-02-01', naskah: 'Keputusan', perihal: 'Penetapan pengelola arsip' });
        const nd = await insertSuratKeluar(database, { n: 32, nomor: 'ND-9/DJ-PTPP/2025', tanggal: '2025-02-10', perihal: 'Penjelasan Keputusan pengelola arsip' });
        const r = await insertRangkaian(database, {
            n: 2, kode: 'RS-2025-000002', tahun: 2025, asal: 'inisiatif', pencatat: 'dir_bppt', judul: 'Penetapan pengelola arsip',
            anggota: [{ jenis: 'surat_keluar', id: sk, peran: 'induk', unit: 'dir_bppt' }, { jenis: 'surat_keluar', id: nd, unit: 'dir_bppt' }],
        });
        await insertRelasi(database, { rangkaianId: r.id, dari: r.anggota[1], ke: r.anggota[0], jenis: 'menjelaskan' });

        const lewatPerihal = await rangkaianService.lacak(bppt, { q: 'Penjelasan Keputusan', mode: 'lacak' });
        const lewatNomor = await rangkaianService.lacak(bppt, { q: 'SK-02/DJ-PTPP', mode: 'lacak' });
        expect(kunci(lewatPerihal)).toEqual([r.id]);
        expect(kunci(lewatNomor)).toEqual([r.id]);
        const pratinjau = lewatPerihal.kelompok[0].pratinjau;
        expect(pratinjau.map(node => node.masked ? null : node.id).sort()).toEqual([nd, sk].sort());
        expect(pratinjau.find(node => !node.masked && node.id === nd)).toMatchObject({ relasi: 'menjelaskan', naskah: 'Nota Dinas' });
    });

    it('maksimal 8 kelompok', async () => {
        for (let i = 0; i < 10; i += 1) {
            await insertSuratMasuk(database, { n: 40 + i, nomor: `UND-${i}/2024`, tanggal: `2024-10-${String(10 + i).padStart(2, '0')}`, perihal: 'Undangan rapat koordinasi' });
        }
        expect((await rangkaianService.lacak(bppt, { q: 'rapat koordinasi', mode: 'lacak' })).kelompok).toHaveLength(8);
    });

    it('seri penuh (skor dan tanggal sama) diurutkan kunci naik secara deterministik', async () => {
        await insertSuratMasuk(database, { n: 62, nomor: 'ND-9/2024', tanggal: '2024-04-04' });
        await insertSuratMasuk(database, { n: 61, nomor: 'ND-9/2024', tanggal: '2024-04-04' });
        for (let run = 0; run < 3; run += 1) {
            expect(kunci(await rangkaianService.lacak(bppt, { q: 'ND-9/2024', mode: 'lacak' }))).toEqual([`surat:${uid(61)}`, `surat:${uid(62)}`]);
        }
    });

    it('LIMIT 200 seed diterapkan setelah urut skor: kecocokan persis lama tidak terpotong 205 kecocokan perihal baru', async () => {
        await database.exec(`
            INSERT INTO surat_masuk (unit_kerja_id, no_urut, tahun, nomor_surat, tanggal_surat, perihal, sifat_surat)
            SELECT 'dir_bppt', 1000 + g, 2026, format('UND-%s/2026', g), DATE '2026-01-01' + g, 'Rapat 77 tahun 2020 lanjutan', 'Biasa'
            FROM generate_series(1, 205) AS g`);
        const persis = await insertSuratMasuk(database, { n: 50, nomor: 'B-77/2020', tanggal: '2020-02-01' });
        const hasil = await rangkaianService.lacak(bppt, { q: 'B-77/2020', mode: 'lacak' });
        expect(hasil.kelompok[0]).toMatchObject({ kunci: `surat:${persis}`, skor: 100 });
    });
});
```

- [ ] **Step 3: Jalankan, pastikan gagal**

Run: `(cd backend && npx vitest run src/__tests__/lacak-ranking.integration.test.ts)`
Expected: FAIL. Minimal kasus `varian B-12…` gagal karena skor P3 tidak punya tingkat 80, sehingga `B-12/PTPP.1/IX/2024/Lamp.II` tercatat 70 dan urutannya kalah dari tanggal. Kasus `1/23 vs 12/3` juga gagal pada urutan `c`/`d`.

- [ ] **Step 4: Implementasi minimal di `skorSql` (`backend/src/services/rangkaian/lacak.service.ts`)**

Gunakan titik ubah yang dicatat di Task 1 Step 2 (`grep -n "export function skorSql" backend/src/services/rangkaian/lacak.service.ts`).

(a) Tambah impor di atas `lacak.service.ts` (berkas `lacak-skor.ts` berada satu tingkat di atas):

```ts
import { bentukKueriLacak, skorLacakSql } from '../lacak-skor.js';
```

(b) Di akhir `skorSql`, ganti blok `return` P3 ini (persis):

```ts
    if (skor.length === 0) return null;
    return {
        skor: skor.length === 1 ? skor[0] : sql`GREATEST(${sql.join(skor, sql`, `)})`,
        cocok: sql`(${sql.join(cocok, sql` OR `)})`,
    };
}
```

menjadi:

```ts
    if (skor.length === 0) return null;
    // P4: satu sumber skor (§6 + prefix mentah berbatas 80). Predikat `cocok` P3 tidak diubah,
    // sehingga visibleSql tetap berada di WHERE seed yang sama (tanpa oracle).
    const a = branch.alias;
    const kolom = {
        nomor: sql.raw(`${a}.nomor_surat`),
        perihal: sql.raw(`${a}.perihal`),
        dari: branch.jenis === 'surat_masuk' ? sql.raw(`${a}.dari`) : sql`NULL::text`,
        kepada: sql.raw(`${a}.kepada`),
    };
    return {
        skor: skorLacakSql(kolom, bentukKueriLacak(plan.q)),
        cocok: sql`(${sql.join(cocok, sql` OR `)})`,
    };
}
```

Cabang `if (mode === 'cek') { … }` di awal `skorSql` **tidak diubah** (mode cek tetap hanya 100/90). `classifyLacakQuery` tetap satu-satunya klasifikasi kueri (`bentukKueriLacak` memetakannya).

(c) Verifikasi — tanpa perubahan — bahwa CTE `teratas` P3 sudah berbentuk:

```sql
SELECT * FROM seed WHERE skor >= ${minimum}
 ORDER BY skor DESC, tanggal_surat DESC NULLS LAST, surat_id
 LIMIT ${SEED_LIMIT}
```

dan SELECT akhir kelompok sudah `ORDER BY skor DESC, tanggal_terbaru DESC NULLS LAST, kunci ASC LIMIT ${limit}`, dengan `kunci = CASE WHEN rs.id IS NULL THEN 'surat:' || t.surat_id::text ELSE coalesce(rs.digabung_ke_id, rs.id)::text END`. Bila berbeda, samakan persis dengan bentuk ini (bentuk P3 Task 4).

- [ ] **Step 5: Jalankan, pastikan lulus**

Run: `(cd backend && npx vitest run src/__tests__/lacak-ranking.integration.test.ts src/__tests__/lacak-skor.test.ts)`
Expected: PASS (7 + 6 tes).

- [ ] **Step 6: Pastikan uji `/lacak` P3 tetap hijau**

Run: `(cd backend && npx vitest run lacak rangkaian)`
Expected: PASS untuk semua file uji yang namanya memuat `lacak`/`rangkaian`.

- [ ] **Step 7: Commit**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
git add backend/src/__tests__/helpers/lacak-pglite.ts backend/src/__tests__/lacak-ranking.integration.test.ts backend/src/services/rangkaian/lacak.service.ts
git commit -F - <<'EOF'
feat(lacak): peringkat deterministik dan fixture B-12, 1/23 vs 12/3, SK tahunan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---


#### Amandemen pra-eksekusi Task 3 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p4-lacak-surat/preflight-rulings.md`.


1. **Anchor (REQUIRED) [P4-T3-1] RECHECK-AFTER-P3.** Edit (b): locate `export function skorSql` in `backend/src/services/rangkaian/lacak.service.ts` and replace only its final `return { skor: …, cocok: … }` statement, keeping the preceding `if (skor.length === 0) return null;` guard or its real equivalent. Leave the `if (mode === 'cek')` branch and the `cocok` array untouched. Edit (c) is verify-only: check that the `teratas` CTE and the final group `ORDER BY` match the stated shape. If they differ, align only the ORDER BY/LIMIT clauses.
   - **(delta P3) Confirmed verbatim** on real P3 @ b4d86fa. The "persis" block P4:726-731 is byte-identical to `lacak.service.ts:67-71`. `skorSql(branch, plan, mode)` is at :35 and the `cek` branch at :40-43. `teratas` (:217-221) and the group `ORDER BY skor DESC, tanggal_terbaru DESC NULLS LAST, kunci ASC` (:236) match edit (c). `Branch.jenis`/`alias`/`pihak` exist (:16-21), with `pihak` = `sm.dari` / `sk.kepada` (:19-20); this supports P4-T3-3. `skorSql` is untouched by the fix wave: the A-I3 diff edits only `ekspansi`/`search`.
2. **No second classification (ADVISORY) [P4-T3-2].** In the replacement `return`, use `skorLacakSql(kolom, bentukKueriLacak(plan.q))` only if `bentukKueriLacak` is a pure mapping of `classifyLacakQuery`. Otherwise add an overload `bentukKueriDariRencana(plan)` in `lacak-skor.ts` that maps `plan.jenis`, `plan.qLower`, `plan.qNorm` and `plan.tokens` directly, and use it. If the P3 `skor` array in `skorSql` is no longer read, delete it.
3. **Pihak column (ADVISORY) [P4-T3-3] RECHECK-AFTER-P3.** Use a single `pihak` column: `kolom.pihak = branch.jenis === 'surat_masuk' ? sql.raw(\`${a}.dari\`) : sql.raw(\`${a}.kepada\`)`. Change `skorTeksSql` in Task 2 to score `DARI_KEPADA` on that one column. Update the one Task 2 test that concatenates `dari`/`kepada` so that it uses a single column.
4. **Run P3 Postgres suite (REQUIRED) [P4-T3-4] RECHECK-AFTER-P3.** Step 6 adds:
   `cd backend && TEST_POSTGRES_URL="$TEST_POSTGRES_URL" npm run test:postgres-locks -- integration/lacak.postgres.test.ts`
   Expected: PASS. If `TEST_POSTGRES_URL` is unavailable locally, record that and rely on the CI Postgres job before merge.
5. **Typecheck (REQUIRED) [P4-G-5].** Add `cd backend && npx tsc --noEmit -p tsconfig.json` to Step 6.



### Task 4: Uji probing, node tersamar tidak pernah cocok, dan penyamaran judul

**Files:**
- Create: `backend/src/services/rangkaian-judul.ts`
- Create: `backend/src/__tests__/rangkaian-judul.test.ts`
- Create: `backend/src/__tests__/lacak-probing.integration.test.ts`
- Modify: `backend/src/services/rangkaian/lacak.service.ts` (P3 Task 4: pemetaan `rangkaian.judul` di fungsi `ekspansi`)

**Interfaces:**
- Consumes (P2): predikat `visibleSql(user)` di seed (§4.9), placeholder §4.8 `{anggotaId, jenis, unitNama, label:'Dikecualikan', masked:true, dapatAjukanAkses}`, dan `findActiveGrant` lewat jalur grant
- Consumes (Task 3): helper `lacak-pglite.ts`
- Produces: `judulRangkaianTampil(kode: string, judul: string | null | undefined, indukTersamar: boolean): string`, yang dipakai `lacak` (task ini) dan `rangkaianDaftarService.list` (Task 5)

- [ ] **Step 1: Tulis tes unit yang gagal untuk `judulRangkaianTampil`**

```ts
// backend/src/__tests__/rangkaian-judul.test.ts
import { describe, expect, it } from 'vitest';
import { judulRangkaianTampil } from '../services/rangkaian-judul';

describe('judulRangkaianTampil', () => {
    it('mengganti judul dengan placeholder bila induk tersamar, apa pun isi judul tersimpan', () => {
        expect(judulRangkaianTampil('RS-2026-000001', 'Perihal rahasia anggaran', true)).toBe('Rangkaian RS-2026-000001 (Dikecualikan)');
    });
    it('memakai judul tersimpan bila induk terbaca, dengan cadangan kode bila kosong', () => {
        expect(judulRangkaianTampil('RS-2026-000002', '  Undangan rapat  ', false)).toBe('Undangan rapat');
        expect(judulRangkaianTampil('RS-2026-000003', '', false)).toBe('Rangkaian RS-2026-000003');
        expect(judulRangkaianTampil('RS-2026-000004', null, false)).toBe('Rangkaian RS-2026-000004');
    });
});
```

- [ ] **Step 2: Tulis tes probing yang gagal**

```ts
// backend/src/__tests__/lacak-probing.integration.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema';
import {
    createMigratedPglite, insertDisposisi, insertRangkaian, insertRelasi, insertSuratKeluar, insertSuratMasuk, insertUser,
    resetRangkaianFixture, seedUnits, uid, type PenggunaUji,
} from './helpers/lacak-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ db: holder.db }));

let database: PGlite;
let rangkaianService: typeof import('../services/rangkaian.service').rangkaianService;
const bppt: PenggunaUji = { id: uid(901), email: 'bppt@example.test', name: 'Admin BPPT', role: 'admin_unit', unitKerjaId: 'dir_bppt' };
const superAdmin: PenggunaUji = { id: uid(906), email: 'super@example.test', name: 'Super Admin', role: 'super_admin', unitKerjaId: null };
const PROBE_PERIHAL = 'PROBE-RAHASIA-7781 anggaran';
const PROBE_NOMOR = 'R-77/PROBE/2026';
const PROBE_DARI = 'Inspektorat PROBE-DARI';
let smRahasia: string;
let skBiasa: string;
let rangkaianId: string;

beforeAll(async () => {
    database = await createMigratedPglite();
    holder.db = drizzle(database, { schema });
    ({ rangkaianService } = await import('../services/rangkaian.service'));
}, 180_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => {
    await resetRangkaianFixture(database);
    await seedUnits(database, [
        { id: 'ditjen', name: 'Ditjen PTPP', pengawas: true },
        { id: 'sesditjen', name: 'Sesditjen', pengawas: true },
        { id: 'dir_bppt', name: 'Dit. BPPT' },
    ]);
    await insertUser(database, bppt);
    await insertUser(database, superAdmin);
    smRahasia = await insertSuratMasuk(database, {
        n: 1, unit: 'sesditjen', nomor: PROBE_NOMOR, tanggal: '2026-09-01', perihal: PROBE_PERIHAL, dari: PROBE_DARI, sifat: 'Rahasia',
    });
    skBiasa = await insertSuratKeluar(database, { n: 2, unit: 'dir_bppt', nomor: 'ND-5/BPPT/2026', tanggal: '2026-09-05', perihal: 'Tindak lanjut anggaran' });
    // Judul sengaja berisi perihal mentah (skenario terburuk data lama); penyamaran harus terjadi saat dibaca.
    const r = await insertRangkaian(database, {
        n: 1, kode: 'RS-2026-000001', tahun: 2026, pencatat: 'sesditjen', judul: PROBE_PERIHAL,
        anggota: [{ jenis: 'surat_masuk', id: smRahasia, peran: 'induk', unit: 'sesditjen' }, { jenis: 'surat_keluar', id: skBiasa, unit: 'dir_bppt' }],
    });
    rangkaianId = r.id;
    await insertRelasi(database, { rangkaianId, dari: r.anggota[1], ke: r.anggota[0], jenis: 'tindak_lanjut' });
    await insertDisposisi(database, { suratMasukId: smRahasia, sumber: 'sesditjen', target: 'dir_bppt', status: 'sent', rangkaianId });
});

function bocoran(hasil: unknown): string[] {
    const json = JSON.stringify(hasil);
    return ['PROBE-RAHASIA-7781', PROBE_NOMOR, 'PROBE-DARI', smRahasia].filter(teks => json.includes(teks));
}

describe('Lacak tidak menjadi oracle bagi node tersamar (§4.9)', () => {
    it.each(['lacak', 'referensi', 'cek'] as const)('mode %s: perihal, nomor mentah, nomor ternormalisasi, dan pihak node tersamar tidak pernah cocok', async mode => {
        for (const q of ['PROBE-RAHASIA-7781', PROBE_NOMOR, 'r77probe2026', PROBE_DARI]) {
            const hasil = await rangkaianService.lacak(bppt, { q, mode });
            expect(hasil.kelompok, `${mode}:${q}`).toEqual([]);
        }
    });

    it('token tidak digabung lintas anggota: "7781 anggaran" tidak cocok walau "anggaran" ada di anggota yang terbaca', async () => {
        expect((await rangkaianService.lacak(bppt, { q: '7781 anggaran', mode: 'lacak' })).kelompok).toEqual([]);
    });

    it('kartu dari anggota terbaca menampilkan induk sebagai placeholder paling konservatif tanpa bocoran', async () => {
        const hasil = await rangkaianService.lacak(bppt, { q: 'Tindak lanjut anggaran', mode: 'lacak' });
        expect(hasil.kelompok).toHaveLength(1);
        const [kartu] = hasil.kelompok;
        expect(kartu.kunci).toBe(rangkaianId);
        expect(kartu.rangkaian.judul).toBe('Rangkaian RS-2026-000001 (Dikecualikan)');
        expect(kartu.cocok.map(item => item.id)).toEqual([skBiasa]);
        const tersamar = kartu.pratinjau.filter(node => node.masked);
        expect(tersamar).toHaveLength(1);
        expect(Object.keys(tersamar[0]).sort()).toEqual(['anggotaId', 'dapatAjukanAkses', 'jenis', 'label', 'masked', 'unitNama']);
        expect(tersamar[0]).toMatchObject({ jenis: 'surat_masuk', label: 'Dikecualikan', masked: true });
        expect(bocoran(hasil)).toEqual([]);
    });

    it('kontrol: super_admin dan peserta ber-grant menemukan surat yang sama (predikat tidak sekadar rusak)', async () => {
        expect((await rangkaianService.lacak(superAdmin, { q: 'PROBE-RAHASIA-7781', mode: 'lacak' })).kelompok.map(k => k.kunci)).toEqual([rangkaianId]);
        await database.query(
            `INSERT INTO record_access_grants (requester_id, target_user_id, entity_type, entity_id, unit_kerja_id, required_classification,
                 purpose, access_mode, status, decided_by, decided_at, decision_reason, expires_at)
             VALUES ($1, $1, 'surat_masuk', $2, 'sesditjen', 'rahasia', 'Tindak lanjut disposisi anggaran untuk pekerjaan resmi',
                 'view', 'approved', $3, now(), 'Kebutuhan tindak lanjut terverifikasi', now() + interval '1 day')`,
            [bppt.id, smRahasia, superAdmin.id],
        );
        const hasil = await rangkaianService.lacak(bppt, { q: 'PROBE-RAHASIA-7781', mode: 'lacak' });
        expect(hasil.kelompok.map(k => k.kunci)).toEqual([rangkaianId]);
        expect(hasil.kelompok[0].pratinjau.some(node => node.masked)).toBe(false);
    });
});
```

- [ ] **Step 3: Jalankan, pastikan gagal**

Run: `(cd backend && npx vitest run src/__tests__/rangkaian-judul.test.ts src/__tests__/lacak-probing.integration.test.ts)`
Expected: FAIL. `rangkaian-judul.test.ts` gagal resolve impor `../services/rangkaian-judul`. Di file probing, kasus-kasus boleh sudah lulus karena `ekspansi` P3 sudah menyamarkan judul (`Rangkaian ${r.kode} (Dikecualikan)`) dan seed P3 sudah menerapkan `visibleSql`; catat kasus mana saja yang gagal.

- [ ] **Step 4: Implementasi minimal**

```ts
// backend/src/services/rangkaian-judul.ts
/** Judul rangkaian untuk ditampilkan; SELALU disamarkan bila induk tidak boleh dibaca (§4.8). */
export function judulRangkaianTampil(kode: string, judul: string | null | undefined, indukTersamar: boolean): string {
    if (indukTersamar) return `Rangkaian ${kode} (Dikecualikan)`;
    const bersih = (judul ?? '').trim();
    return bersih || `Rangkaian ${kode}`;
}
```

Di `backend/src/services/rangkaian/lacak.service.ts`, tambah impor `import { judulRangkaianTampil } from '../rangkaian-judul.js';`. Di fungsi `ekspansi`, ganti baris P3 ini (persis):

```ts
            rangkaian: { ...r, judul: induk && bolehLihat(induk) ? r.judul : `Rangkaian ${r.kode} (Dikecualikan)` },
```

menjadi:

```ts
            rangkaian: { ...r, judul: judulRangkaianTampil(r.kode, r.judul, !(induk && bolehLihat(induk))) },
```

`induk`/`bolehLihat` adalah nilai yang sudah dihitung P3 dari hasil `checkMany`; jangan menghitung ulang akses.

Bila salah satu kasus probing lain juga gagal di Step 3, perbaikannya ada di seed P3, bukan dengan menyaring hasil setelahnya:
- **Kasus mode/nomor/pihak gagal:** pastikan `visibleSql(user)` berada di klausa `WHERE` **yang sama** dengan predikat pencocokan, sebelum `ORDER BY … LIMIT 200`. Bentuknya `WHERE <visibleSql> AND (<pencocokan nomor> OR <pencocokan token>)`, dan predikat nomor ternormalisasi memakai `nomorNormSql` pada baris yang sama.
- **Kasus token lintas anggota gagal:** semua token harus di-AND-kan **per baris seed** (satu surat), bukan per kelompok. Pencocokan token dan `GROUP BY` kelompok tidak boleh terjadi di tingkat yang sama.
- **Kasus placeholder gagal:** node tersamar dibentuk hanya dari `{anggotaId, jenis, unitNama, label:'Dikecualikan', masked:true, dapatAjukanAkses}` tanpa spread baris surat, dan baris tersamar tidak pernah masuk `cocok`.

- [ ] **Step 5: Jalankan, pastikan lulus**

Run: `(cd backend && npx vitest run src/__tests__/rangkaian-judul.test.ts src/__tests__/lacak-probing.integration.test.ts src/__tests__/lacak-ranking.integration.test.ts)`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
git add backend/src/services/rangkaian-judul.ts backend/src/__tests__/rangkaian-judul.test.ts backend/src/__tests__/lacak-probing.integration.test.ts backend/src/services/rangkaian/lacak.service.ts
git commit -F - <<'EOF'
test(lacak): probing node tersamar tidak pernah cocok dan judul rangkaian disamarkan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---


#### Amandemen pra-eksekusi Task 4 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p4-lacak-surat/preflight-rulings.md`.


1. **Helper body (REQUIRED) [P4-T4-2].** Replace the `rangkaian-judul.ts` block with:
   ```ts
   // backend/src/services/rangkaian-judul.ts
   import { judulTersamar } from './rangkaian-read.service.js';

   /** Judul rangkaian untuk ditampilkan; SELALU disamarkan bila induk tidak boleh dibaca (§4.8). Satu sumber placeholder: judulTersamar (P2). */
   export function judulRangkaianTampil(kode: string, judul: string | null | undefined, indukTersamar: boolean): string {
       if (indukTersamar) return judulTersamar(kode);
       const bersih = (judul ?? '').trim();
       return bersih || `Rangkaian ${kode}`;
   }
   ```
   `rangkaian-judul.test.ts` stays unchanged, because `judulTersamar('RS-…')` returns `Rangkaian RS-… (Dikecualikan)`.
2. **Anchor (BLOCKING) [P4-T4-1] RECHECK-AFTER-P3.** Replace the "ganti baris P3 ini (persis)" instruction with this: in `ekspansi` of `backend/src/services/rangkaian/lacak.service.ts`, locate the object property that starts with `rangkaian: { ...r, judul:`. After P3 T4-4 its value reads `induk && bolehLihat(induk) ? r.judul : judulTersamar(r.kode)`. Replace only that value, giving:
   ```ts
               rangkaian: { ...r, judul: judulRangkaianTampil(r.kode, r.judul, !(induk && bolehLihat(induk))) },
   ```
   Keep P3's `induk`, `bolehLihat` and `readRefKey` computations. If `judulTersamar` is no longer referenced in `lacak.service.ts`, remove it from that file's deps import.
   - **(delta P3) Corrected anchor, in flux.** Real P3 has no `bolehLihat`. At b4d86fa the property reads `rangkaian: { ...r, judul: induk && indukTerlihat ? r.judul : judulTersamar(r.kode) },` (`lacak.service.ts:195`), with `const indukTerlihat = induk ? akses.get(readRefKey(…))?.allowed === true : false` (:191).
   - The fix wave (A-I3, uncommitted at scan time) moves it into one declaration that both the "penuh" and the non-penuh branch use: `const rangkaian = { ...r, judul: induk && indukTerlihat ? r.judul : judulTersamar(r.kode) };`, with `indukTerlihat = induk ? terbaca(induk) : false`.
   - Anchor on whichever of the two exists on the P4 base (text `judul: induk && indukTerlihat ? r.judul : judulTersamar(r.kode)`), and replace only that value with `judulRangkaianTampil(r.kode, r.judul, !(induk && indukTerlihat))`.
   - If `judulTersamar` is then unused in `lacak.service.ts`, drop it from the `./deps.js` import. `tersamarTunggal` does not use it.
3. **RED step (ADVISORY) [P4-T4-3].** Step 3's Expected stays as written. The RED signal is the unresolved `../services/rangkaian-judul` import.
4. **Typecheck (REQUIRED) [P4-G-5].** Add `cd backend && npx tsc --noEmit -p tsconfig.json` to Step 5.
5. **(delta P3) Probing matrix after A-I3 (REQUIRED, carry-forward: P3 `final-review-access.md` item 1 and I-3).**
   - After the fix wave, Lacak follows the P2 rangkaian tier. Only "penuh" readers (super_admin, pengawas of `unit_pencatat_id`, peserta in jangkauan) see placeholders for unreadable members.
   - Every other reader gets only readable nodes. For them, `jumlahAnggota` and `pratinjauTerpotong` count readable nodes only. A group with no readable node becomes a tunggal-like group: `rangkaian: null`, `kunci: 'surat:<cocok[0].id>'`, and pratinjau from `cocok[0]`.
   - Append these cases to `lacak-probing.integration.test.ts`, reusing the file's fixture:
     1. **Staff reader (`staff`, `dir_bppt`).** A query that matches `skBiasa` gives a card with no `masked` node, `jumlahAnggota` = number of readable nodes, and `bocoran(hasil)` = `[]`.
     2. **Out-of-scope pengawas.** An `admin_unit` of a pengawas unit whose scope covers `dir_bppt` but not the pencatat (tier `anggota`), or `staff` if no such unit exists in the fixture. Same assertions as case 1.
     3. **No readable node.** A reader whose only match is list-visible but not readable (own-unit Terbatas without grant, staff) gets `kunci` starting with `surat:`, `rangkaian: null`, and no rangkaian kode/id anywhere in the JSON.
   - The existing test at P4:898-910 stays valid: `bppt` is a peserta (disposisi target and anggota unit), so it is penuh and still sees the induk placeholder.
   - Do not duplicate P3's own `src/__tests__/lacak-tingkat.integration.test.ts`, which the fix wave adds. Extend only the P4 probing matrix: staff/auditor and tier `anggota`.



### Task 5: Layanan daftar Berkas Rangkaian (`rangkaianDaftarService.list`) dengan paritas `checkRead`

**Files:**
- Create: `backend/src/services/rangkaian-daftar.service.ts`
- Create: `backend/src/__tests__/rangkaian-daftar.integration.test.ts`

**Interfaces:**
- Consumes (P2):
  - `recordAccessService.checkMany(user, refs)` → `Map<readRefKey, ReadAccessResult>` dan `readRefKey`
  - `recordAccessService.checkRead(user, type, id, executor?)`, khusus uji paritas
  - Dari `visibility-spec.ts`: `resolveKonteksBaca`, `jangkauanSql`, `dalamCakupanPengawasSql`, `kecocokanUnitRekaman`, `cocokUnitRekamanSql`, `barisDari`. Predikat jangkauan **tidak** ditulis ulang; cabang `rangkaian_peserta` (flag data lama) otomatis ikut lewat `ctx.disposisiLamaRead`.
- Consumes (Task 4): `judulRangkaianTampil`
- Produces:
  - `type DaftarRangkaianFilter = { unitPengolahId?: string; status?: 'aktif'|'selesai'|'diberkaskan'; asal?: 'surat_masuk'|'inisiatif'|'data_lama'; page: number; limit: number }`
  - `rangkaianDaftarService.list(user: PenggunaDaftar, filter)` → `{ data: RangkaianRingkas[], pagination: { page, limit, total, totalPages }, meta: { aksiDiizinkan: string[] } }`
  - `RangkaianRingkas = { id, kode, status, asal, tahun, judul, unitPencatat:{id,nama}, unitPengolah:{id,nama}|null, jumlahAnggota, selesaiAt, diberkaskanAt }`
  - `meta.aksiDiizinkan` selalu `[]` (kontrak dibekukan untuk aksi daftar di masa depan). Kemampuan Tutup massal **tidak** dibaca dari sini: P5 memakai `GET /api/rangkaian/data-lama/ringkasan` → `{ dapatMenutup, perTahun }`.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
// backend/src/__tests__/rangkaian-daftar.integration.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema';
import {
    createMigratedPglite, insertDisposisi, insertRangkaian, insertSuratKeluar, insertSuratMasuk, insertUser,
    resetRangkaianFixture, seedUnits, uid, type PenggunaUji,
} from './helpers/lacak-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ db: holder.db }));

let database: PGlite;
let daftar: typeof import('../services/rangkaian-daftar.service').rangkaianDaftarService;
let access: typeof import('../services/record-access.service').recordAccessService;

const pengguna = {
    bppt: { id: uid(901), email: 'bppt@example.test', name: 'Admin BPPT', role: 'admin_unit', unitKerjaId: 'dir_bppt' },
    ptep: { id: uid(902), email: 'ptep@example.test', name: 'Admin PTEP', role: 'admin_unit', unitKerjaId: 'dir_ptep' },
    tu: { id: uid(903), email: 'tu@example.test', name: 'Admin TU', role: 'admin_unit', unitKerjaId: 'sesditjen' },
    staffTu: { id: uid(904), email: 'staff@example.test', name: 'Staff TU', role: 'staff', unitKerjaId: 'sesditjen' },
    ktpp: { id: uid(905), email: 'ktpp@example.test', name: 'Admin KTPP', role: 'admin_unit', unitKerjaId: 'dir_ktpp' },
    superAdmin: { id: uid(906), email: 'super@example.test', name: 'Super Admin', role: 'super_admin', unitKerjaId: null },
    sesditjenLama: { id: uid(907), email: 'ses@example.test', name: 'Admin Sesditjen', role: 'admin_sesditjen', unitKerjaId: null },
} satisfies Record<string, PenggunaUji>;

const r: Record<string, { id: string; induk: { type: 'surat_masuk' | 'surat_keluar'; id: string } }> = {};

beforeAll(async () => {
    database = await createMigratedPglite();
    holder.db = drizzle(database, { schema });
    ({ rangkaianDaftarService: daftar } = await import('../services/rangkaian-daftar.service'));
    ({ recordAccessService: access } = await import('../services/record-access.service'));
}, 180_000);
afterAll(async () => { await database?.close(); });

beforeEach(async () => {
    await resetRangkaianFixture(database);
    await seedUnits(database, [
        { id: 'ditjen', name: 'Ditjen PTPP', pengawas: true },
        { id: 'sesditjen', name: 'Sesditjen', pengawas: true },
        { id: 'dir_bppt', name: 'Dit. BPPT' },
        { id: 'dir_ptep', name: 'Dit. PTEP' },
        { id: 'dir_ktpp', name: 'Dit. KTPP' },
    ]);
    for (const user of Object.values(pengguna)) await insertUser(database, user);

    const sm1 = await insertSuratMasuk(database, { n: 101, unit: 'sesditjen', nomor: 'SM-1/2026', tanggal: '2026-09-01' });
    const r1 = await insertRangkaian(database, { n: 1, kode: 'RS-2026-000001', tahun: 2026, pencatat: 'sesditjen', judul: 'Undangan rapat 1',
        anggota: [{ jenis: 'surat_masuk', id: sm1, peran: 'induk', unit: 'sesditjen' }] });
    await insertDisposisi(database, { suratMasukId: sm1, sumber: 'sesditjen', target: 'dir_bppt', status: 'sent', rangkaianId: r1.id });
    r.R1 = { id: r1.id, induk: { type: 'surat_masuk', id: sm1 } };

    const sm2 = await insertSuratMasuk(database, { n: 102, unit: 'sesditjen', nomor: 'SM-2/2026', tanggal: '2026-09-02' });
    const r2 = await insertRangkaian(database, { n: 2, kode: 'RS-2026-000002', tahun: 2026, pencatat: 'sesditjen', judul: 'Undangan rapat 2',
        anggota: [{ jenis: 'surat_masuk', id: sm2, peran: 'induk', unit: 'sesditjen' }] });
    await insertDisposisi(database, { suratMasukId: sm2, sumber: 'sesditjen', target: 'dir_ptep', status: 'rejected', rangkaianId: r2.id });
    r.R2 = { id: r2.id, induk: { type: 'surat_masuk', id: sm2 } };

    const sk3 = await insertSuratKeluar(database, { n: 103, unit: 'dir_ktpp', nomor: 'SK-3/KTPP/2026', tanggal: '2026-09-03', naskah: 'Keputusan' });
    const r3 = await insertRangkaian(database, { n: 3, kode: 'RS-2026-000003', tahun: 2026, pencatat: 'dir_ktpp', pengolah: 'dir_ktpp',
        asal: 'inisiatif', status: 'selesai', judul: 'Keputusan KTPP', anggota: [{ jenis: 'surat_keluar', id: sk3, peran: 'induk', unit: 'dir_ktpp' }] });
    r.R3 = { id: r3.id, induk: { type: 'surat_keluar', id: sk3 } };

    const sm4 = await insertSuratMasuk(database, { n: 104, unit: 'sesditjen', nomor: 'SM-4/2026', tanggal: '2026-09-04' });
    const sk4 = await insertSuratKeluar(database, { n: 105, unit: 'dir_ptep', nomor: 'ND-4/PTEP/2026', tanggal: '2026-09-05' });
    const r4 = await insertRangkaian(database, { n: 4, kode: 'RS-2026-000004', tahun: 2026, pencatat: 'sesditjen', judul: 'Undangan rapat 4',
        anggota: [{ jenis: 'surat_masuk', id: sm4, peran: 'induk', unit: 'sesditjen' }, { jenis: 'surat_keluar', id: sk4, unit: 'dir_ptep' }] });
    await insertDisposisi(database, { suratMasukId: sm4, sumber: 'sesditjen', target: 'dir_ptep', status: 'rejected', rangkaianId: r4.id });
    r.R4 = { id: r4.id, induk: { type: 'surat_masuk', id: sm4 } };

    const r5 = await insertRangkaian(database, { n: 5, kode: 'RS-2026-000005', tahun: 2026, pencatat: 'sesditjen', status: 'digabung',
        digabungKe: r1.id, judul: 'Rangkaian tergabung', anggota: [] });
    r.R5 = { id: r5.id, induk: { type: 'surat_masuk', id: sm1 } };

    const sm6 = await insertSuratMasuk(database, { n: 107, unit: 'sesditjen', nomor: 'SM-6/2019', tanggal: '2019-03-01' });
    const r6 = await insertRangkaian(database, { n: 6, kode: 'RS-2019-000006', tahun: 2019, pencatat: 'sesditjen', asal: 'data_lama',
        status: 'selesai', judul: 'Data lama 2019', anggota: [{ jenis: 'surat_masuk', id: sm6, peran: 'induk', unit: 'sesditjen' }] });
    r.R6 = { id: r6.id, induk: { type: 'surat_masuk', id: sm6 } };

    const sm7 = await insertSuratMasuk(database, { n: 108, unit: 'sesditjen', nomor: 'R-7/2026', tanggal: '2026-09-07',
        perihal: 'PERIHAL-RAHASIA-R7', sifat: 'Rahasia' });
    const r7 = await insertRangkaian(database, { n: 7, kode: 'RS-2026-000007', tahun: 2026, pencatat: 'sesditjen', judul: 'PERIHAL-RAHASIA-R7',
        anggota: [{ jenis: 'surat_masuk', id: sm7, peran: 'induk', unit: 'sesditjen' }] });
    await insertDisposisi(database, { suratMasukId: sm7, sumber: 'sesditjen', target: 'dir_bppt', status: 'sent', rangkaianId: r7.id });
    r.R7 = { id: r7.id, induk: { type: 'surat_masuk', id: sm7 } };
});

const idList = async (user: PenggunaUji, filter: Partial<{ status: 'aktif' | 'selesai' | 'diberkaskan'; asal: 'surat_masuk' | 'inisiatif' | 'data_lama'; unitPengolahId: string }> = {}) =>
    (await daftar.list(user, { page: 1, limit: 50, ...filter })).data.map(row => row.id).sort();
const ids = (...names: string[]) => names.map(name => r[name].id).sort();

describe('GET /api/rangkaian — jangkauan daftar Berkas Rangkaian', () => {
    it('cocok dengan jangkauan §4.5 untuk setiap pengguna (kasus eksplisit)', async () => {
        expect(await idList(pengguna.bppt)).toEqual(ids('R1', 'R7'));
        expect(await idList(pengguna.ptep)).toEqual(ids('R4'));
        expect(await idList(pengguna.tu)).toEqual(ids('R1', 'R2', 'R3', 'R4', 'R7'));
        expect(await idList(pengguna.sesditjenLama)).toEqual(ids('R1', 'R2', 'R3', 'R4', 'R7'));
        expect(await idList(pengguna.staffTu)).toEqual(ids('R1', 'R2', 'R4', 'R7'));
        expect(await idList(pengguna.ktpp)).toEqual(ids('R3'));
        expect(await idList(pengguna.superAdmin)).toEqual(ids('R1', 'R2', 'R3', 'R4', 'R7'));
    });

    it('paritas dengan recordAccessService.checkRead atas induk biasa (sumber tunggal predikat)', async () => {
        for (const [namaPengguna, user] of Object.entries(pengguna)) {
            const terdaftar = new Set(await idList(user));
            for (const nama of ['R1', 'R2', 'R3', 'R4']) {
                const akses = await access.checkRead(user, r[nama].induk.type, r[nama].induk.id, holder.db);
                expect(terdaftar.has(r[nama].id), `${namaPengguna} × ${nama}`).toBe(Boolean(akses.allowed));
            }
        }
    });

    it('data lama disembunyikan secara default, digabung tidak pernah tampil, dan filter status/unit pengolah berlaku', async () => {
        expect(await idList(pengguna.tu, { asal: 'data_lama' })).toEqual(ids('R6'));
        expect(await idList(pengguna.superAdmin)).not.toContain(r.R5.id);
        expect(await idList(pengguna.superAdmin, { status: 'selesai' })).toEqual(ids('R3'));
        expect(await idList(pengguna.superAdmin, { unitPengolahId: 'dir_ktpp' })).toEqual(ids('R3'));
    });

    it('judul disamarkan bila induk tidak boleh dibaca pengguna', async () => {
        const hasil = await daftar.list(pengguna.bppt, { page: 1, limit: 50 });
        expect(hasil.data.find(row => row.id === r.R7.id)?.judul).toBe('Rangkaian RS-2026-000007 (Dikecualikan)');
        expect(JSON.stringify(hasil)).not.toContain('PERIHAL-RAHASIA-R7');
        const superHasil = await daftar.list(pengguna.superAdmin, { page: 1, limit: 50 });
        expect(superHasil.data.find(row => row.id === r.R7.id)?.judul).toBe('PERIHAL-RAHASIA-R7');
    });

    it('paginasi dan meta aksi', async () => {
        const halaman2 = await daftar.list(pengguna.superAdmin, { page: 2, limit: 2 });
        expect(halaman2.data).toHaveLength(2);
        expect(halaman2.pagination).toEqual({ page: 2, limit: 2, total: 5, totalPages: 3 });
        expect(halaman2.meta).toEqual({ aksiDiizinkan: [] });
        expect(halaman2.data[0]).toEqual(expect.objectContaining({
            kode: expect.stringMatching(/^RS-\d{4}-\d{6}$/), unitPencatat: expect.objectContaining({ id: expect.any(String) }),
            jumlahAnggota: expect.any(Number),
        }));
    });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `(cd backend && npx vitest run src/__tests__/rangkaian-daftar.integration.test.ts)`
Expected: FAIL, karena `Failed to resolve import "../services/rangkaian-daftar.service"`.

- [ ] **Step 3: Implementasi minimal**

```ts
// backend/src/services/rangkaian-daftar.service.ts
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../config/database.js';
import {
    barisDari, cocokUnitRekamanSql, dalamCakupanPengawasSql, jangkauanSql, kecocokanUnitRekaman, resolveKonteksBaca,
} from './access/visibility-spec.js';
import { readRefKey, recordAccessService, type ReadRef } from './record-access.service.js';
import { judulRangkaianTampil } from './rangkaian-judul.js';

export type DaftarRangkaianFilter = {
    unitPengolahId?: string;
    status?: 'aktif' | 'selesai' | 'diberkaskan';
    asal?: 'surat_masuk' | 'inisiatif' | 'data_lama';
    page: number;
    limit: number;
};
export type PenggunaDaftar = { id: string; role: string; unitKerjaId: string | null; email?: string; name?: string | null };

type BarisRangkaian = {
    id: string; kode: string; status: string; asal: string; judul: string; tahun: number;
    unit_pencatat_id: string; unit_pencatat_nama: string | null;
    unit_pengolah_id: string | null; unit_pengolah_nama: string | null;
    selesai_at: string | null; diberkaskan_at: string | null;
    induk_surat_masuk_id: string | null; induk_surat_keluar_id: string | null;
    jumlah_anggota: number; total: number;
};

/**
 * Cakupan daftar dirakit dari predikat P2 (satu sumber, §4.3):
 * - pemilik: unit pencatat cocok dengan kecocokan unit rekaman pengguna (super_admin = semua,
 *   staff/auditor = unitnya sendiri, tanpa jangkauan lintas unit — D5);
 * - pengawas: FULL_ADMIN + unit efektif is_unit_pengawas, atas pencatat ditjen/sesditjen/dir_*;
 * - peserta: unit efektif ∈ jangkauan(R) (§4.5; termasuk rangkaian_peserta bila flag data lama menyala).
 */
async function lingkupSql(user: PenggunaDaftar): Promise<SQL> {
    const ctx = await resolveKonteksBaca(user, db);
    const bagian: SQL[] = [cocokUnitRekamanSql(kecocokanUnitRekaman(user), sql.raw('r.unit_pencatat_id'))];
    if (ctx.pengawas) bagian.push(dalamCakupanPengawasSql(sql.raw('r.unit_pencatat_id')));
    if (ctx.unitJangkauan) bagian.push(jangkauanSql(sql.raw('r.id'), ctx.unitJangkauan, ctx.disposisiLamaRead));
    return sql`(${sql.join(bagian, sql` OR `)})`;
}

export const rangkaianDaftarService = {
    async list(user: PenggunaDaftar, filter: DaftarRangkaianFilter) {
        const where: SQL[] = [sql`r.status <> 'digabung'`, await lingkupSql(user)];
        where.push(filter.asal ? sql`r.asal = ${filter.asal}` : sql`r.asal <> 'data_lama'`);
        if (filter.status) where.push(sql`r.status = ${filter.status}`);
        if (filter.unitPengolahId) where.push(sql`r.unit_pengolah_id = ${filter.unitPengolahId}`);
        const offset = (filter.page - 1) * filter.limit;

        const result = await db.execute(sql`
            SELECT r.id, r.kode, r.status, r.asal, r.judul, r.tahun,
                   r.unit_pencatat_id, up.name AS unit_pencatat_nama,
                   r.unit_pengolah_id, uo.name AS unit_pengolah_nama,
                   r.selesai_at, r.diberkaskan_at,
                   ai.surat_masuk_id AS induk_surat_masuk_id, ai.surat_keluar_id AS induk_surat_keluar_id,
                   (SELECT count(*)::int FROM rangkaian_anggota a WHERE a.rangkaian_id = r.id) AS jumlah_anggota,
                   count(*) OVER ()::int AS total
            FROM rangkaian_surat r
            LEFT JOIN unit_kerja up ON up.id = r.unit_pencatat_id
            LEFT JOIN unit_kerja uo ON uo.id = r.unit_pengolah_id
            LEFT JOIN rangkaian_anggota ai ON ai.rangkaian_id = r.id AND ai.peran = 'induk'
            WHERE ${sql.join(where, sql` AND `)}
            ORDER BY coalesce(r.diberkaskan_at, r.selesai_at, r.updated_at) DESC, r.id
            LIMIT ${filter.limit} OFFSET ${offset}`);
        const rows = barisDari<BarisRangkaian>(result);

        const indukRef = new Map<string, ReadRef>();
        for (const row of rows) {
            if (row.induk_surat_masuk_id) indukRef.set(row.id, { type: 'surat_masuk', id: row.induk_surat_masuk_id });
            else if (row.induk_surat_keluar_id) indukRef.set(row.id, { type: 'surat_keluar', id: row.induk_surat_keluar_id });
        }
        const akses = indukRef.size ? await recordAccessService.checkMany(user, [...indukRef.values()]) : new Map();
        const indukTerbaca = (rowId: string) => {
            const ref = indukRef.get(rowId);
            const hasil = ref ? akses.get(readRefKey(ref)) : undefined;
            return Boolean(hasil?.allowed) && !hasil?.masked;
        };

        const total = rows[0]?.total ?? 0;
        return {
            data: rows.map(row => ({
                id: row.id,
                kode: row.kode,
                status: row.status,
                asal: row.asal,
                tahun: row.tahun,
                judul: judulRangkaianTampil(row.kode, row.judul, !indukTerbaca(row.id)),
                unitPencatat: { id: row.unit_pencatat_id, nama: row.unit_pencatat_nama },
                unitPengolah: row.unit_pengolah_id ? { id: row.unit_pengolah_id, nama: row.unit_pengolah_nama } : null,
                jumlahAnggota: row.jumlah_anggota,
                selesaiAt: row.selesai_at,
                diberkaskanAt: row.diberkaskan_at,
            })),
            pagination: { page: filter.page, limit: filter.limit, total, totalPages: Math.max(1, Math.ceil(total / filter.limit)) },
            meta: { aksiDiizinkan: [] as string[] },
        };
    },
};
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `(cd backend && npx vitest run src/__tests__/rangkaian-daftar.integration.test.ts)`
Expected: PASS (5 tes). Bila uji paritas gagal pada satu pasangan, **jangan** melonggarkan tes. Bandingkan pasangan itu dengan §4.4/§4.5. Karena `lingkupSql` hanya merakit fragmen P2, penyimpangan hampir pasti berada di perakitan: kolom `r.unit_pencatat_id` untuk pengawas/pemilik, atau `r.id` untuk jangkauan. Bila yang menyimpang ternyata fragmen P2 sendiri, laporkan ke pemilik P2.

- [ ] **Step 5: Commit**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
git add backend/src/services/rangkaian-daftar.service.ts backend/src/__tests__/rangkaian-daftar.integration.test.ts
git commit -F - <<'EOF'
feat(rangkaian): layanan daftar Berkas Rangkaian dengan paritas checkRead

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---


#### Amandemen pra-eksekusi Task 5 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p4-lacak-surat/preflight-rulings.md`.


1. **Step 0: property generator (BLOCKING, carry-forward FR:36) [P4-T5-4]. New step before Step 1, with its own commit.**
   - Modify `backend/src/__tests__/visibility-parity.property.integration.test.ts`:
     - SM rows: `UNIT_REKAMAN[g % UNIT_REKAMAN.length]` and `SIFAT[Math.floor(g / UNIT_REKAMAN.length) % SIFAT.length]`. Raise the SM loop bound so that every unit × SIFAT pair occurs at least once (`UNIT_REKAMAN.length * SIFAT.length` rows).
     - SK rows: `UNIT_REKAMAN[g % UNIT_REKAMAN.length]` and `KELAS_SK[Math.floor(g / UNIT_REKAMAN.length) % KELAS_SK.length]`, with a bound of `UNIT_REKAMAN.length * KELAS_SK.length`. `KELAS_SK` must contain `null`.
     - Keep the fixed seeds (mulberry32 or the existing ones) and the existing "300 kombinasi" draw.
     - After the member inserts, soft-delete at least one SM member of rs1, one SK member of rs2, and the target row of one approved grant (`UPDATE … SET is_deleted = true WHERE id = …`).
   - Run: `cd backend && npx vitest run src/__tests__/visibility-parity.property.integration.test.ts`. Expected: PASS, including "checkRead dan visibleSql(read) identik untuk 300 kombinasi acak" and "mode list hanya melonggarkan…".
   - If a pair diverges, stop. That is a P2 finding: report it to the P2 owner, and do not weaken the test.
   - Commit: `test(akses): perkuat generator properti paritas visibleSql↔checkRead sebelum Lacak (P2 FR:36)`.
2. **Fixture helper, Task 3 file (BLOCKING) [P4-T5-1].** Replace `insertUser` in `backend/src/__tests__/helpers/lacak-pglite.ts` with:
   ```ts
   /** Baris DB memenuhi users_role_unit_mandate_check (0027); objek di memori tetap apa adanya (unit null menguji jalur mandat). */
   const UNIT_MANDAT: Record<string, string> = { admin_sesditjen: 'sesditjen', admin_dirjen: 'ditjen' };

   export async function insertUser(database: PGlite, user: PenggunaUji): Promise<PenggunaUji> {
       await database.query('INSERT INTO users (id, email, name, role, unit_kerja_id) VALUES ($1, $2, $3, $4, $5)',
           [user.id, user.email, user.name, user.role, UNIT_MANDAT[user.role] ?? user.unitKerjaId]);
       return user;
   }
   ```
   If Task 3 is already committed, make this edit in Task 5 and add the helper to Task 5's `git add`.
3. **R7 judul expectation (BLOCKING) [P4-T5-2].** In the test "judul disamarkan bila induk tidak boleh dibaca pengguna", replace
   ```ts
           expect(superHasil.data.find(row => row.id === r.R7.id)?.judul).toBe('PERIHAL-RAHASIA-R7');
   ```
   with
   ```ts
           // Rahasia tanpa grant: super_admin pun tidak membaca induk (evaluateOwnerAccess), jadi judul tetap tersamar.
           expect(superHasil.data.find(row => row.id === r.R7.id)?.judul).toBe('Rangkaian RS-2026-000007 (Dikecualikan)');
           expect(superHasil.data.find(row => row.id === r.R1.id)?.judul).toBe('Undangan rapat 1');
   ```
   Verified in scratch: with the item 2 helper, 5/5 pass.
4. **`dapatDibuka` (BLOCKING, carry-forward FR:35) [P4-T5-3] RECHECK-AFTER-P3.**
   - Service: add `import { tingkatAksesRangkaian } from './rangkaian-read.service.js';`. After `indukTerbaca`, compute
     ```ts
             // FR:35: tautan/aksi memakai mode baca — rangkaian yang tercantum (lingkup list) belum tentu dapat dibuka (GET /:id).
             const dapatDibuka = new Map<string, boolean>();
             for (const row of rows) dapatDibuka.set(row.id, (await tingkatAksesRangkaian(user, row.id, db)) !== null);
     ```
     Then add `dapatDibuka: dapatDibuka.get(row.id) === true,` to each mapped row after `diberkaskanAt`.
   - If `tingkatAksesRangkaian` does not exist in real P3 under that name or signature, use `(await rangkaianReadService.getDetail(user, row.id, db)) !== null`, which is the definitionally equal fallback. Do not re-implement the tier.
   - **(delta P3) Confirmed.** The signature is `tingkatAksesRangkaian(user, rangkaianId, executor = db): Promise<'owner'|'pengawas'|'peserta'|'anggota'|null>` (`rangkaian-read.service.ts:316-339`).
     - It follows the same `digabung` chain and hop/cycle guard as `getDetail` (:324 vs :377-384).
     - It returns `'anggota'` exactly when `getDetail`'s `!penuh && some allowed` branch would return a payload (:332-338 vs :399-401), over the same first 300 members.
     - Use it, not the fix wave's new `tingkatRangkaianPenuh`. That function omits the `'anggota'` fallback, so it would mark rows as not openable even though `GET /:id` returns 200.
   - Produces: add `dapatDibuka: boolean` to the `RangkaianRingkas` item shape in the Task 5 Interfaces and in the Task 12 fixture.
   - Tests: add to `rangkaian-daftar.integration.test.ts`:
     ```ts
         it('dapatDibuka mengikuti mode baca (paritas getDetail) untuk semua pengguna × R1–R7', async () => {
             const { rangkaianReadService } = await import('../services/rangkaian-read.service');
             for (const [namaPengguna, user] of Object.entries(pengguna)) {
                 const hasil = await daftar.list(user, { page: 1, limit: 50 });
                 for (const row of hasil.data) {
                     const detail = await rangkaianReadService.getDetail(user, row.id, holder.db);
                     expect(row.dapatDibuka, `${namaPengguna} × ${row.kode}`).toBe(detail !== null);
                 }
             }
             const staff = await daftar.list(pengguna.staffTu, { page: 1, limit: 50 });
             expect(staff.data.find(row => row.id === r.R7.id)).toMatchObject({ dapatDibuka: false });
         });
     ```
   - Step 4 Expected: PASS (6 tests).
5. **`jumlah_anggota` (ADVISORY) [P4-T5-5].** Replace the subquery with `(SELECT count(*)::int FROM rangkaian_anggota a LEFT JOIN surat_masuk xm ON xm.id = a.surat_masuk_id LEFT JOIN surat_keluar xk ON xk.id = a.surat_keluar_id WHERE a.rangkaian_id = r.id AND coalesce(xm.is_deleted, xk.is_deleted) IS NOT TRUE)`.
6. **Typecheck (REQUIRED) [P4-G-5].** Add `cd backend && npx tsc --noEmit -p tsconfig.json` to Step 4. Add `backend/src/__tests__/helpers/lacak-pglite.ts` to `git add` if item 2 was made in this task.


**C-5 (critic) — Task 5: `dapatDibuka` equivalence holds by contract but is untested; cost is per row — REQUIRED [P4-C-5]**


- Equivalence with `getDetail` comes from the P3 contract:
  - P3 T14-1 returns `'anggota'` when some member is readable, and C-8 returns `null` on a hop-limit or cycle (P3 `preflight-rulings.md:179, :331`);
  - this mirrors `getDetail` (`rangkaian-read.service.ts:329-362`).
- The new 6th test (the parity loop) was **not** executed in scratch. Only 5/5 is recorded, and `tc/parity.log` is the pre-amendment list-vs-getDetail probe. Run it in Task 5 Step 4, before Task 12 relies on the field.
- Cost: one `tingkatAksesRangkaian` per page row, with `limit ≤ 50` (P4:1381), which is about 3–4 queries per row.
  - Acceptable for v1. Record the page latency in the PR next to the Task 7 numbers.
  - The `getDetail` fallback loads up to 300 nodes plus a `checkMany` per row. If the fallback is ever needed, cap `limit` at 20 for that path.


**C-8 (critic) — Task 5 (Step 0): the property generator rewrite was not executed — ADVISORY [P4-C-8]**


- The FR:36 Step 0 rewrite was not run in scratch.
- The file derives grants and rangkaian membership from `no_urut` (`visibility-parity.property.integration.test.ts:57-67`), so the rewritten SM/SK loops change which rows carry grants and members. That is intended.
- Run the file alone first and record its duration. A divergence is a P2 finding; Task 5 item 1 already says to stop.


**C-9 (critic) — Tasks 5, 8: scan rows with no ruling — ADVISORY [P4-C-9]**


- **Task 5:** `count(*) OVER()` gives `total = 0` on an out-of-range page (scan-p4-backend, Task 5 "Minor" row). Compute `total` with a separate `count(*)`, or clamp `page` to the last page.
- **Task 8:** `lacak-link.js` treats a real nomor shaped like `/^S[MK]-\d+\/\d{4}$/` as a fallback title (scan-p4-frontend, Task 8 "edge case" row). Record this in the Self-Review as accepted.



### Task 6: Route `GET /api/rangkaian`, allowlist demo, dan pemasangan di `app.ts`

**Files:**
- Create: `backend/src/routes/rangkaian-daftar.routes.ts`
- Create: `backend/src/__tests__/rangkaian-daftar.routes.test.ts`
- Modify: `backend/src/validators/schemas.ts` (tambah di akhir file)
- Modify: `backend/src/app.ts` (sisipkan tepat sebelum baris `app.use('/api/rangkaian', rangkaianRoutes);` yang ditambahkan P2 Task 9 setelah `app.use('/api/distributions', distributionRoutes);`)
- Modify: `backend/src/middlewares/demo-access.middleware.ts:39-53` (array `ALLOWED_METADATA_ROUTES`)

**Interfaces:**
- Consumes (Task 5): `rangkaianDaftarService.list`
- Consumes (repo): `authMiddleware`, `roleMiddleware(allowedRoles: Role[])`, `validateQuery(schema)`, lalu `res.locals.validatedQuery`
- Produces:
  - `daftarRangkaianQuerySchema` (Zod, `.strict()`)
  - `GET /api/rangkaian?unitPengolahId&status&asal&page&limit` → `{ success: true, data, pagination, meta: { aksiDiizinkan } }`
  - Pengguna yang belum terprovisi (`user`) → 403; parameter tak dikenal atau di luar batas → 400

- [ ] **Step 1: Tulis tes yang gagal**

```ts
// backend/src/__tests__/rangkaian-daftar.routes.test.ts
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoAccessMiddleware } from '../middlewares/demo-access.middleware.js';

const mocks = vi.hoisted(() => ({
    user: { id: 'user-1', email: 'user@example.test', name: 'Pengguna', role: 'admin_unit', unitKerjaId: 'dir_bppt' as string | null },
    list: vi.fn(),
}));
vi.mock('../middlewares/auth.middleware.js', () => ({
    authMiddleware: (req: any, _res: any, next: any) => { req.user = { ...mocks.user }; next(); },
}));
vi.mock('../services/rangkaian-daftar.service.js', () => ({ rangkaianDaftarService: { list: mocks.list } }));

const { default: router } = await import('../routes/rangkaian-daftar.routes.js');
const app = express();
app.use(express.json());
app.use('/api/rangkaian', router);

describe('GET /api/rangkaian', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.assign(mocks.user, { role: 'admin_unit', unitKerjaId: 'dir_bppt' });
        mocks.list.mockResolvedValue({ data: [{ id: 'r-1' }], pagination: { page: 2, limit: 20, total: 21, totalPages: 2 }, meta: { aksiDiizinkan: [] } });
    });

    it('meneruskan filter tervalidasi dan mengembalikan amplop standar', async () => {
        const response = await request(app).get('/api/rangkaian?status=diberkaskan&unitPengolahId=dir_bppt&page=2').expect(200);
        expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }),
            { status: 'diberkaskan', unitPengolahId: 'dir_bppt', page: 2, limit: 20 });
        expect(response.body).toEqual({ success: true, data: [{ id: 'r-1' }], pagination: { page: 2, limit: 20, total: 21, totalPages: 2 }, meta: { aksiDiizinkan: [] } });
    });

    it.each([
        ['status=digabung'],
        ['asal=lainnya'],
        ['limit=51'],
        ['page=0'],
        ['unitKerjaId=ditjen'],
    ])('menolak kueri %s dengan 400', async query => {
        await request(app).get(`/api/rangkaian?${query}`).expect(400);
        expect(mocks.list).not.toHaveBeenCalled();
    });

    it('menolak pengguna yang belum terprovisi', async () => {
        Object.assign(mocks.user, { role: 'user', unitKerjaId: null });
        await request(app).get('/api/rangkaian').expect(403);
        expect(mocks.list).not.toHaveBeenCalled();
    });

    it('mengizinkan staff/auditor (read-only) — cakupan ditentukan layanan', async () => {
        Object.assign(mocks.user, { role: 'staff', unitKerjaId: 'sesditjen' });
        await request(app).get('/api/rangkaian').expect(200);
    });
});

describe('allowlist demo metadata-only', () => {
    it('meneruskan GET /api/rangkaian dan tetap menolak POST ke koleksi', async () => {
        const demo = express();
        let downstream = 0;
        demo.use('/api', createDemoAccessMiddleware(true));
        demo.use('/api', (_req, res) => { downstream += 1; res.json({ success: true }); });
        await request(demo).get('/api/rangkaian?status=diberkaskan').expect(200);
        expect(downstream).toBe(1);
        await request(demo).post('/api/rangkaian').send({}).expect(403);
        expect(downstream).toBe(1);
    });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `(cd backend && npx vitest run src/__tests__/rangkaian-daftar.routes.test.ts)`
Expected: FAIL, karena `Failed to resolve import "../routes/rangkaian-daftar.routes.js"`.

- [ ] **Step 3: Implementasi minimal**

Tambah di akhir `backend/src/validators/schemas.ts`:

```ts
// Daftar Berkas Rangkaian (P4). Kueri tak dikenal ditolak agar unitKerjaId tidak bisa menyelinap.
export const daftarRangkaianQuerySchema = z.object({
    unitPengolahId: z.string().trim().min(1).max(50).optional(),
    status: z.enum(['aktif', 'selesai', 'diberkaskan']).optional(),
    asal: z.enum(['surat_masuk', 'inisiatif', 'data_lama']).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export type DaftarRangkaianQuery = z.infer<typeof daftarRangkaianQuerySchema>;
```

```ts
// backend/src/routes/rangkaian-daftar.routes.ts
import { Router, type NextFunction, type Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middlewares/auth.middleware.js';
import { roleMiddleware } from '../middlewares/role.middleware.js';
import { validateQuery } from '../middlewares/validate.middleware.js';
import { daftarRangkaianQuerySchema, type DaftarRangkaianQuery } from '../validators/schemas.js';
import { rangkaianDaftarService } from '../services/rangkaian-daftar.service.js';

// Middleware dipasang per-route agar permintaan /api/rangkaian lain jatuh ke router P2/P3 tanpa autentikasi ganda.
const router = Router();

router.get(
    '/',
    authMiddleware,
    roleMiddleware(['super_admin', 'admin_unit', 'admin_dirjen', 'admin_sesditjen', 'staff', 'auditor']),
    validateQuery(daftarRangkaianQuerySchema),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const filter = res.locals.validatedQuery as DaftarRangkaianQuery;
            const result = await rangkaianDaftarService.list(req.user!, filter);
            res.json({ success: true, ...result });
        } catch (error) {
            next(error);
        }
    },
);

export default router;
```

Di `backend/src/app.ts`, tambah impor di blok impor route:

```ts
import rangkaianDaftarRoutes from './routes/rangkaian-daftar.routes.js';
```

Lalu sisipkan baris berikut **tepat sebelum** `app.use('/api/rangkaian', rangkaianRoutes);` milik P2/P3:

```ts
app.use('/api/rangkaian', rangkaianDaftarRoutes);
```

Urutan final setelah P5 (P4 Task 18 menyisipkan router D7 tepat setelah router daftar; P5 Task 8 menyisipkan router berkas tepat sebelum router utama):

```ts
app.use('/api/rangkaian', rangkaianDaftarRoutes);  // P4 Task 6: hanya GET / (auth per-route)
app.use('/api/rangkaian', rangkaianPerluDilengkapiRoutes); // P4 Task 18 (D7): /perlu-dilengkapi, /perlu-dilengkapi/ringkasan, /surat-keluar/:suratKeluarId/tandai-inisiatif (auth per-route)
app.use('/api/rangkaian', rangkaianBerkasRoutes);  // P5 Task 8: /data-lama/*, /:id/koreksi-berkas, /koreksi-berkas/:koreksiId/putuskan (auth per-route)
app.use('/api/rangkaian', rangkaianRoutes);        // P2 Task 9 (+P3): router.use(authMiddleware); /lacak, /tautan, ... sebelum /:id dan /by-surat
```

Di `backend/src/middlewares/demo-access.middleware.ts`, dalam `ALLOWED_METADATA_ROUTES`, tambahkan entri berikut setelah entri `/rangkaian` milik P2/P3 (atau setelah entri `/surat-keluar` bila P2/P3 belum menambah entri):

```ts
    { methods: GET, path: exact('/rangkaian') },
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `(cd backend && npx vitest run src/__tests__/rangkaian-daftar.routes.test.ts src/__tests__/demo-access.middleware.test.ts)`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
git add backend/src/routes/rangkaian-daftar.routes.ts backend/src/__tests__/rangkaian-daftar.routes.test.ts backend/src/validators/schemas.ts backend/src/app.ts backend/src/middlewares/demo-access.middleware.ts
git commit -F - <<'EOF'
feat(rangkaian): endpoint GET /api/rangkaian untuk tab Berkas Rangkaian

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---


#### Amandemen pra-eksekusi Task 6 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p4-lacak-surat/preflight-rulings.md`.


1. **Allowlist (REQUIRED) [P4-T6-1] RECHECK-AFTER-P3.** In `demo-access.middleware.ts`, add `{ methods: GET, path: exact('/rangkaian') },` directly after the P3 rangkaian GET entry, the one whose pattern contains `lacak|${UUID}|by-surat` (P3 T4-5). In `backend/src/__tests__/demo-access.middleware.test.ts`, add `['GET', '/api/rangkaian']` to the existing allowed-routes `it.each` table. Step 4 also runs that test file.
   - **(delta P3) Confirmed.** The entry is at `demo-access.middleware.ts:55`, and P3 added seven more rangkaian entries at :56-62. The `it.each` is at `demo-access.middleware.test.ts:51`, with its rangkaian rows at :61-69. `canReadMiddleware` is at `role.middleware.ts:49` and is used by P3 `/lacak` (`rangkaian.routes.ts:73`).
2. **Role middleware (ADVISORY) [P4-G-8].** Use `canReadMiddleware()`.
3. **Typecheck (REQUIRED) [P4-G-5].**



### Task 7: EXPLAIN pada 50 ribu baris sintetis dan p95 `/lacak` (Postgres nyata)

**Files:**
- Create: `backend/integration/lacak-explain.postgres.test.ts`

**Interfaces:**
- Consumes (P3): `nomorNormSql`, `rangkaianService.lacak`, index `surat_masuk_nomor_norm_idx`/`surat_keluar_nomor_norm_idx` (0046)
- Produces: bukti rencana kueri memakai index ekspresi `text_pattern_ops` untuk prefix nomor, dan angka p95 (target < 150 ms) yang dicetak `[lacak-explain] …` untuk deskripsi PR dan keputusan pg_trgm (§13 no. 3)

- [ ] **Step 1: Siapkan basis data uji sekali pakai (lokal)**

```bash
cd "D:/Projects/New folder/simsa-atrbpn/backend"
export TEST_POSTGRES_URL='postgresql://simsa_test:simsa_test@127.0.0.1:5432/simsa_test'
DATABASE_URL="$TEST_POSTGRES_URL" npm run db:migrate
```

Expected: migrasi selesai sampai `0047_unit_kerja_direktorat`. Gunakan hanya basis data bernama `simsa_test`.

- [ ] **Step 2: Tulis tes yang gagal**

```ts
// backend/integration/lacak-explain.postgres.test.ts
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { nomorNormSql } from '../src/utils/nomor-surat.js';

const databaseUrl = process.env.TEST_POSTGRES_URL;
if (!databaseUrl || new URL(databaseUrl).pathname.slice(1) !== 'simsa_test') {
    throw new Error('TEST_POSTGRES_URL harus menunjuk basis data sekali pakai simsa_test.');
}
process.env.DATABASE_URL ??= databaseUrl;

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../src/config/database.js', () => ({ db: holder.db }));

const UNIT = 'lacak_perf';
const JUMLAH = 50_000;
const PENGGUNA = { id: '00000000-0000-4000-8000-00000000f001', email: 'lacak-perf@example.test', name: 'Uji Kinerja', role: 'admin_unit', unitKerjaId: UNIT };
const pool = new Pool({ connectionString: databaseUrl, max: 4, statement_timeout: 120_000 });
const db = drizzle(pool);
holder.db = db;

beforeAll(async () => {
    const { rows } = await pool.query(`SELECT to_regclass('public.surat_masuk_nomor_norm_idx') AS sm, to_regclass('public.surat_keluar_nomor_norm_idx') AS sk`);
    if (!rows[0].sm || !rows[0].sk) throw new Error('Jalankan `npm run db:migrate` (sampai 0047) terhadap TEST_POSTGRES_URL terlebih dahulu.');
    await pool.query(`INSERT INTO unit_kerja (id, name) VALUES ($1, 'Unit Uji Kinerja Lacak') ON CONFLICT (id) DO NOTHING`, [UNIT]);
    await pool.query(`INSERT INTO users (id, email, name, role, unit_kerja_id) VALUES ($1, $2, $3, 'admin_unit', $4) ON CONFLICT (email) DO NOTHING`,
        [PENGGUNA.id, PENGGUNA.email, PENGGUNA.name, UNIT]);
    await pool.query('DELETE FROM surat_keluar WHERE unit_kerja_id = $1', [UNIT]);
    await pool.query('DELETE FROM surat_masuk WHERE unit_kerja_id = $1', [UNIT]);
    await pool.query(`
        INSERT INTO surat_masuk (unit_kerja_id, no_urut, tahun, nomor_surat, tanggal_surat, perihal, dari, sifat_surat)
        SELECT $1, g, 2015 + (g % 10),
               format('B-%s/PTPP.%s/%s/%s', g, g % 7, (ARRAY['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'])[1 + g % 12], 2015 + (g % 10)),
               make_date(2015 + (g % 10), 1 + (g % 12), 1 + (g % 28)),
               format('Perihal %s koordinasi %s', md5(g::text), (ARRAY['anggaran','pertanahan','tata ruang','pengukuran'])[1 + g % 4]),
               format('Kantor Wilayah %s', g % 34), 'Biasa'
        FROM generate_series(1, $2::int) AS g`, [UNIT, JUMLAH]);
    await pool.query(`
        INSERT INTO surat_keluar (unit_kerja_id, no_urut, tahun, naskah_dinas, nomor_surat, tanggal_surat, perihal, kepada,
            klasifikasi_keamanan, approval_status)
        SELECT $1, g, 2015 + (g % 10), 'Nota Dinas', format('ND-%s/DJ-PTPP/%s', g, 2015 + (g % 10)),
               make_date(2015 + (g % 10), 1 + (g % 12), 1 + (g % 28)),
               format('Tindak lanjut %s %s', md5((g * 7)::text), (ARRAY['anggaran','pertanahan','tata ruang','pengukuran'])[1 + g % 4]),
               format('Direktorat %s', g % 5), 'biasa', 'approved'
        FROM generate_series(1, $2::int) AS g`, [UNIT, JUMLAH]);
    await pool.query('ANALYZE surat_masuk');
    await pool.query('ANALYZE surat_keluar');
}, 300_000);

afterAll(async () => {
    await pool.query('DELETE FROM surat_keluar WHERE unit_kerja_id = $1', [UNIT]);
    await pool.query('DELETE FROM surat_masuk WHERE unit_kerja_id = $1', [UNIT]);
    await pool.query('DELETE FROM users WHERE id = $1', [PENGGUNA.id]);
    await pool.query('DELETE FROM unit_kerja WHERE id = $1', [UNIT]);
    await pool.end();
});

async function rencana(tabel: 'surat_masuk' | 'surat_keluar', pola: string): Promise<string> {
    const result = await db.execute(sql`EXPLAIN (FORMAT JSON)
        SELECT id FROM ${sql.raw(tabel)} WHERE ${nomorNormSql(sql.raw(`${tabel}.nomor_surat`))} LIKE ${pola} ESCAPE '\\'`);
    return JSON.stringify((result.rows[0] as Record<string, unknown>)['QUERY PLAN']);
}

describe('kinerja Lacak Surat pada 2 × 50 ribu baris sintetis (§6 Performa)', () => {
    it.each([
        ['surat_masuk', 'b12345ptpp%'],
        ['surat_keluar', 'nd12345djptpp%'],
    ] as const)('prefix nomor ternormalisasi pada %s memakai index ekspresi text_pattern_ops', async (tabel, pola) => {
        const plan = await rencana(tabel, pola);
        console.info(`[lacak-explain] ${tabel} ${plan}`);
        expect(plan).toContain(`"Index Name":"${tabel}_nomor_norm_idx"`);
    });

    it('p95 rangkaianService.lacak < 150 ms untuk kueri nomor dan perihal', async () => {
        const { rangkaianService } = await import('../src/services/rangkaian.service.js');
        for (const q of ['B-12345/PTPP', 'koordinasi pertanahan']) {
            await rangkaianService.lacak(PENGGUNA, { q, mode: 'lacak' });
            const durasi: number[] = [];
            for (let i = 0; i < 20; i += 1) {
                const mulai = performance.now();
                await rangkaianService.lacak(PENGGUNA, { q, mode: 'lacak' });
                durasi.push(performance.now() - mulai);
            }
            durasi.sort((a, b) => a - b);
            const p95 = durasi[Math.ceil(0.95 * durasi.length) - 1];
            console.info(`[lacak-explain] q="${q}" p50=${durasi[9].toFixed(1)}ms p95=${p95.toFixed(1)}ms`);
            expect(p95).toBeLessThan(150);
        }
    }, 120_000);
});
```

- [ ] **Step 3: Jalankan terhadap DB tanpa migrasi 0046 (bukti tes bisa gagal)**

```bash
cd "D:/Projects/New folder/simsa-atrbpn/backend"
psql "$TEST_POSTGRES_URL" -c 'DROP INDEX IF EXISTS surat_masuk_nomor_norm_idx'
TEST_POSTGRES_URL="$TEST_POSTGRES_URL" npm run test:postgres-locks -- integration/lacak-explain.postgres.test.ts
```

Expected: FAIL dengan `Jalankan \`npm run db:migrate\` (sampai 0047) terhadap TEST_POSTGRES_URL terlebih dahulu.`

- [ ] **Step 4: Pulihkan index dengan definisi persis 0046, lalu jalankan ulang**

```bash
cd "D:/Projects/New folder/simsa-atrbpn/backend"
psql "$TEST_POSTGRES_URL" -c "CREATE INDEX surat_masuk_nomor_norm_idx ON surat_masuk ((lower(regexp_replace(coalesce(nomor_surat,''),'[^0-9A-Za-z]+','','g'))) text_pattern_ops)"
TEST_POSTGRES_URL="$TEST_POSTGRES_URL" npm run test:postgres-locks -- integration/lacak-explain.postgres.test.ts
```

Expected: PASS (3 tes), dengan baris `[lacak-explain] … p95=…ms` tercetak. Salin kedua angka p95 ke deskripsi PR P4. Bila p95 perihal ≥ 150 ms, **jangan** menaikkan ambang. Catat angkanya sebagai masukan pg_trgm (§13 no. 3), lalu eskalasi sebelum merge.

- [ ] **Step 5: Commit**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
git add backend/integration/lacak-explain.postgres.test.ts
git commit -F - <<'EOF'
test(lacak): EXPLAIN index nomor dan p95 pada 50 ribu baris sintetis per tabel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---


#### Amandemen pra-eksekusi Task 7 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p4-lacak-surat/preflight-rulings.md`.


1. **Harness (BLOCKING) [P4-T7-1] RECHECK-AFTER-P3.** Delete Step 1 and the Step 3/4 `psql … DROP INDEX` / `CREATE INDEX` commands. Rewrite the test header:
   ```ts
   // backend/integration/lacak-explain.postgres.test.ts
   import { performance } from 'node:perf_hooks';
   import { sql } from 'drizzle-orm';
   import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
   vi.mock('../src/config/database', () => import('./helpers/db-proxy.js'));
   vi.mock('../src/config/database.js', () => import('./helpers/db-proxy.js'));
   import { dbState } from './helpers/db-proxy.js';
   import { createRangkaianTestDatabase } from './helpers/rangkaian-db.js';
   import { nomorNormSql } from '../src/utils/nomor-surat.js';

   const PERF = process.env.LACAK_PERF === '1';
   const TANPA_INDEX = process.env.LACAK_EXPLAIN_TANPA_INDEX === '1';
   let h: Awaited<ReturnType<typeof createRangkaianTestDatabase>>;
   ```
   - `beforeAll`: `h = await createRangkaianTestDatabase('lacakexplain'); dbState.db = h.db; await h.seedUnits();`. Create the three users with `h.seedUser('admin_unit', 'dir_bppt')`, `h.seedUser('admin_unit', 'sesditjen')` (pengawas via `seedUnits`) and `h.seedUser('super_admin', null)`.
   - Seed with `h.pool.query(... generate_series ...)` as in the plan, but with mixed data (item 2).
   - If `TANPA_INDEX`, drop the index inside the random DB on one client: `SET ROLE simsa_migrator; DROP INDEX surat_masuk_nomor_norm_idx; RESET ROLE`. This is the RED proof that replaces the old Step 3.
   - `afterAll`: `await h?.close()`.
   - The old `pathname === 'simsa_test'` guard and the private `Pool`/`vi.hoisted` holder go, because `assertIsolatedTestTarget` in the harness already guards the target.
   - New Step 3 (proof the test can fail): `cd backend && LACAK_EXPLAIN_TANPA_INDEX=1 TEST_POSTGRES_URL="$TEST_POSTGRES_URL" npm run test:postgres-locks -- integration/lacak-explain.postgres.test.ts`. Expected: FAIL on `"Index Name":"surat_masuk_nomor_norm_idx"`.
   - New Step 4: the same command without the flag and with `LACAK_PERF=1`. Expected: PASS.
2. **Mixed data and full-query evidence (REQUIRED, carry-forward FR:34 / P3 T4-6) [P4-T7-2] RECHECK-AFTER-P3.**
   - SM `sifat_surat`: `(ARRAY['Biasa','Biasa','Biasa','Terbatas','Rahasia',' ',NULL])[1 + g % 7]`. SK `klasifikasi_keamanan`: `(ARRAY['biasa','biasa','terbatas','rahasia',NULL])[1 + g % 5]`. Spread rows over units `dir_bppt`, `dir_ptep`, `sesditjen` and `ditjen` with `(ARRAY[...])[1 + g % 4]`.
   - After the seed, create one rangkaian per 10 SM with `h.pool.query`: `INSERT INTO rangkaian_surat … SELECT … FROM surat_masuk WHERE no_urut % 10 = 0`. Add induk `rangkaian_anggota` rows and, for half of them, a `surat_distributions` row to a different unit with `status='sent'` and `rangkaian_id` set.
   - Add `it('EXPLAIN seed Lacak nyata untuk tiga pengguna', …)`. For each of the three users, run `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` of the SQL that `rangkaianService.lacak` executes, and print it as `[lacak-explain] user=<peran> plan=…`. The implementer obtains the SQL by calling P3's exported `seedSql`/`cabangSql` builder if one is exported; otherwise wrap `db.execute` in a spy that captures the `SQL` object of the seed statement. There is no hard assertion on node types. The existing prefix-index `it.each` stays, as informational evidence.
   - **(delta P3) Correction.** Real P3 exports no seed builder: `cabangSql` (`lacak.service.ts:74`) is module-private, and only `skorSql` (:35) and `lacakService` (:203) are exported. `rangkaianService.lacak` (`rangkaian.service.ts:841`) delegates to `lacakService.search`, which runs **inside** `denganRetryDeadlock(() => db.transaction(async (tx) => …))` with `SET LOCAL statement_timeout = '2s'` (:208-209). A spy on `db.execute` therefore sees nothing.
   - Capture the seed instead:
     1. Wrap `dbState.db.transaction` so that the callback's `tx.execute` is spied.
     2. Take the first `SQL` argument whose rendered text contains `WITH seed AS`.
     3. After the call, render it to `{ sql, params }` with `new PgDialect().sqlToQuery(captured)` (`import { PgDialect } from 'drizzle-orm/pg-core'`).
     4. Run `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) <text>` with the params on the dedicated 300 s client (C-4).
   - The seed runs after `resolveKonteksBaca`, so the captured statement already contains the user's `visibleSql`. After the fix wave, `ekspansi` also calls `tingkatRangkaianPenuh` once per group (≤ 8). Include `ekspansi` in the p95 timing, not in the EXPLAIN.
   - Add `it('waktu ringkasan Perlu Dilengkapi (pengawas TU, super_admin)', …)` **after Task 16 exists**. Until then, put it in Task 16's Step 4 as a follow-up edit to this file. It runs 20 × `perluDilengkapiService.ringkasan(user, { tampilkanDataLama: false })` and prints p50/p95. The only hard assertion is no thrown error, meaning the statement_timeout of 2 s was not hit.
3. **p95 gate (REQUIRED) [P4-T7-3].** In the p95 test, keep the `console.info` line and replace `expect(p95).toBeLessThan(150);` with `if (PERF) expect(p95).toBeLessThan(150);`.
4. **Escalation (REQUIRED) [P4-T7-4].** Replace the last two sentences of the Step 4 Expected ("Bila p95 perihal ≥ 150 ms…") with the following. If p95 ≥ 150 ms, do not raise the threshold. Record both numbers in the PR under "Gerbang rilis P4" as the pg_trgm input (§13 no. 3). Escalate to the P2 owner a normalize-once change to `visibility-spec.ts`; P4 must not edit `visibleSql`. Merge only with the spec owner's written acceptance of the recorded numbers. P5 Task 14 gate (a) reads this record.
5. **Commit.** `git add backend/integration/lacak-explain.postgres.test.ts` only. No shared-DB state is changed.


**C-4 (critic) — Task 7: the real harness has a 15 s statement timeout — REQUIRED, RECHECK-AFTER-P3 [P4-C-4]**


- **(delta P3)** Re-confirmed @ b4d86fa: `createRangkaianTestDatabase(label)` :28, `statement_timeout: 15000` :38, return object :139, `SET ROLE simsa_migrator` inside the harness :52. The Task 7 `DROP INDEX` as `simsa_migrator` works for the same reason. `db-proxy.ts` is unchanged.
- Real `backend/integration/helpers/rangkaian-db.ts` (P3 @ 15b5852) matches the calls in Task 7 item 1:
  - `createRangkaianTestDatabase(label)` requires the label to match `/^[a-z]{3,20}$/`, so `'lacakexplain'` is valid;
  - it returns `{ pool, db, databaseName, query, seedUnits, seedUser, insertSuratMasuk, insertSuratKeluar, insertDistribusi, ensureKlasifikasi, close }` (:139);
  - `dbState` is in `helpers/db-proxy.ts`.
- The harness pool, however, sets `statement_timeout: 15000` (:38). The original P4 used 120 000 ms for the 2 × 50k `generate_series` seeds (P4:1505). The amended seed adds more work:
  - rangkaian, anggota and distribution rows, each firing `surat_distributions_closed_guard`/`rangkaian_anggota_closed_guard` (0046:398-408);
  - `EXPLAIN (ANALYZE)` of the full seed for super_admin.
- Binding:
  - Run the seed, `ANALYZE` and the EXPLAIN/timing statements on one dedicated client: `const c = await h.pool.connect(); await c.query("SET statement_timeout = '300s'")`, then `c.release()` in `finally`.
  - Never run them on the 15 s pool default.
  - The `ringkasan` timing keeps the service's own `SET LOCAL statement_timeout = '2s'` (P4:4293).
- ADVISORY (CI cost): `npm run test:postgres-locks` runs every `integration/*.test.ts` on each PG 16/17/18 leg.
  - With `LACAK_PERF` unset, only the prefix-index `it.each` needs the seed. Gate the three-user EXPLAIN and the `ringkasan` timing on `PERF` as well.
  - Record this file's CI duration in the PR.
- The amended Task 7 has never been executed (there was no PG ≥ 16 in scratch). Treat its Step 3/4 Expected lines as unverified.



### Task 8: Utilitas klien `lacak-cache.js`, `lacak-link.js`, dan `lacak-labels.js`

**Files:**
- Create: `frontend/src/lib/lacak-cache.js`, `frontend/src/lib/lacak-link.js`, `frontend/src/lib/lacak-labels.js`
- Test: `frontend/src/lib/lacak-cache.test.js`, `frontend/src/lib/lacak-link.test.js`

**Interfaces:**
- Produces:
  - `LACAK_MIN_CHARS = 3`, `LACAK_MAX_CHARS = 100`, `LACAK_CACHE_SIZE = 20`
  - `lacakCacheKey({ q, mode = 'lacak', tahun = '', jenis = '' }): string`
  - `createLacakCache(max = 20)` → `{ get(key) /* mempromosikan */, peek(key) /* tanpa promosi */, set(key, value), size, clear() }`
  - `lacakHref({ q?, rangkaianId? }): string` → `/surat/lacak?q=…&rangkaian=…`
  - `lacakQueryForResult(result): string` (nomor nyata; judul cadangan `SM-n/yyyy`/`SK-n/yyyy` diganti perihal; ≤ 100; '' bila < 3)
  - `LABEL_RELASI`, `LABEL_STATUS_RANGKAIAN`, `LABEL_JENIS_SURAT`

- [ ] **Step 1: Tulis tes yang gagal**

```js
// frontend/src/lib/lacak-cache.test.js
import { describe, expect, it } from 'vitest'
import { createLacakCache, LACAK_CACHE_SIZE, lacakCacheKey } from './lacak-cache'

describe('lacakCacheKey', () => {
    it('menyamakan spasi tepi dan kapitalisasi, memisahkan mode dan tahun', () => {
        expect(lacakCacheKey({ q: '  B-12/PTPP ' })).toBe(lacakCacheKey({ q: 'b-12/ptpp' }))
        expect(lacakCacheKey({ q: 'B-12', mode: 'referensi' })).not.toBe(lacakCacheKey({ q: 'B-12' }))
        expect(lacakCacheKey({ q: 'B-12', tahun: '2024' })).not.toBe(lacakCacheKey({ q: 'B-12' }))
        expect(lacakCacheKey({ q: 'B-12', tahun: 2024 })).toBe(lacakCacheKey({ q: 'B-12', tahun: '2024' }))
        expect(lacakCacheKey({ q: 'B-12', jenis: 'surat_keluar' })).not.toBe(lacakCacheKey({ q: 'B-12' }))
        expect(lacakCacheKey({ q: 'B-12', jenis: undefined })).toBe(lacakCacheKey({ q: 'B-12' }))
    })
})

describe('createLacakCache', () => {
    it('menyimpan paling banyak 20 entri dan menggusur yang paling lama tidak dipakai', () => {
        const cache = createLacakCache()
        for (let i = 0; i < LACAK_CACHE_SIZE; i += 1) cache.set(`k${i}`, i)
        expect(cache.get('k0')).toBe(0)
        cache.set('k20', 20)
        expect(cache.size).toBe(20)
        expect(cache.peek('k1')).toBeUndefined()
        expect(cache.peek('k0')).toBe(0)
    })
    it('peek tidak mengubah urutan pemakaian', () => {
        const cache = createLacakCache(2)
        cache.set('a', 1)
        cache.set('b', 2)
        expect(cache.peek('a')).toBe(1)
        cache.set('c', 3)
        expect(cache.peek('a')).toBeUndefined()
        expect(cache.peek('b')).toBe(2)
    })
})
```

```js
// frontend/src/lib/lacak-link.test.js
import { describe, expect, it } from 'vitest'
import { lacakHref, lacakQueryForResult } from './lacak-link'

describe('lacakQueryForResult', () => {
    it('memakai nomor surat nyata, bukan judul cadangan SM-/SK- dari pencarian global', () => {
        expect(lacakQueryForResult({ type: 'surat_masuk', title: 'B-12/PTPP.1/IX/2024', excerpt: 'Undangan' })).toBe('B-12/PTPP.1/IX/2024')
        expect(lacakQueryForResult({ type: 'surat_keluar', title: 'SK-7/2026', excerpt: '  Penjelasan Keputusan Nomor 5  ' })).toBe('Penjelasan Keputusan Nomor 5')
        expect(lacakQueryForResult({ type: 'surat_masuk', title: 'SM-1/2026', excerpt: 'ab' })).toBe('')
        expect(lacakQueryForResult({ type: 'surat_masuk', title: 'SM-1/2026', excerpt: 'x'.repeat(150) })).toHaveLength(100)
    })
})

describe('lacakHref', () => {
    it('membentuk URL /surat/lacak dengan ?q= dan ?rangkaian=', () => {
        expect(lacakHref({ q: 'B-12/PTPP' })).toBe('/surat/lacak?q=B-12%2FPTPP')
        expect(lacakHref({ rangkaianId: 'r-1' })).toBe('/surat/lacak?rangkaian=r-1')
        expect(lacakHref({ q: '  ' })).toBe('/surat/lacak')
        expect(lacakHref()).toBe('/surat/lacak')
    })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `(cd frontend && npx vitest run src/lib/lacak-cache.test.js src/lib/lacak-link.test.js)`
Expected: FAIL, karena `Failed to resolve import "./lacak-cache"` dan `"./lacak-link"`.

- [ ] **Step 3: Implementasi minimal**

```js
// frontend/src/lib/lacak-cache.js
export const LACAK_MIN_CHARS = 3
export const LACAK_MAX_CHARS = 100
export const LACAK_CACHE_SIZE = 20

/** Skor "nomor mentah sama" bersifat case-insensitive, jadi kunci boleh di-lowercase. */
export function lacakCacheKey({ q, mode = 'lacak', tahun = '', jenis = '' }) {
    return JSON.stringify([
        mode,
        tahun === null || tahun === undefined ? '' : String(tahun),
        jenis ?? '',
        String(q ?? '').trim().toLowerCase(),
    ])
}

/** Cache LRU kecil: get() mempromosikan, peek() tidak (aman dipanggil saat render). */
export function createLacakCache(max = LACAK_CACHE_SIZE) {
    const entries = new Map()
    return {
        get(key) {
            if (!entries.has(key)) return undefined
            const value = entries.get(key)
            entries.delete(key)
            entries.set(key, value)
            return value
        },
        peek(key) {
            return entries.get(key)
        },
        set(key, value) {
            entries.delete(key)
            entries.set(key, value)
            while (entries.size > max) entries.delete(entries.keys().next().value)
        },
        get size() {
            return entries.size
        },
        clear() {
            entries.clear()
        },
    }
}
```

```js
// frontend/src/lib/lacak-link.js
import { LACAK_MAX_CHARS, LACAK_MIN_CHARS } from './lacak-cache'

// global-search.service.ts memakai `SM-${noUrut}/${tahun}`/`SK-…` bila nomor kosong.
const JUDUL_CADANGAN = /^S[MK]-\d+\/\d{4}$/

export function lacakQueryForResult(result) {
    const title = String(result?.title ?? '').trim()
    const dasar = title && !JUDUL_CADANGAN.test(title) ? title : String(result?.excerpt ?? '').trim()
    const q = dasar.slice(0, LACAK_MAX_CHARS).trim()
    return q.length >= LACAK_MIN_CHARS ? q : ''
}

export function lacakHref({ q = '', rangkaianId = '' } = {}) {
    const params = new URLSearchParams()
    const trimmed = String(q).trim().slice(0, LACAK_MAX_CHARS)
    if (trimmed) params.set('q', trimmed)
    if (rangkaianId) params.set('rangkaian', rangkaianId)
    const search = params.toString()
    return search ? `/surat/lacak?${search}` : '/surat/lacak'
}
```

```js
// frontend/src/lib/lacak-labels.js
export const LABEL_RELASI = Object.freeze({
    balasan: 'Balasan',
    tindak_lanjut: 'Tindak lanjut',
    menjelaskan: 'Menjelaskan',
    merujuk: 'Merujuk',
})

export const LABEL_STATUS_RANGKAIAN = Object.freeze({
    aktif: 'Aktif',
    selesai: 'Selesai',
    diberkaskan: 'Diberkaskan',
})

export const LABEL_JENIS_SURAT = Object.freeze({
    surat_masuk: 'Surat masuk',
    surat_keluar: 'Surat keluar',
})
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `(cd frontend && npx vitest run src/lib/lacak-cache.test.js src/lib/lacak-link.test.js)`
Expected: PASS (5 tes).

- [ ] **Step 5: Commit**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
git add frontend/src/lib/lacak-cache.js frontend/src/lib/lacak-link.js frontend/src/lib/lacak-labels.js frontend/src/lib/lacak-cache.test.js frontend/src/lib/lacak-link.test.js
git commit -F - <<'EOF'
feat(lacak): cache LRU 20 entri, tautan lacak, dan label rangkaian di klien

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---


#### Amandemen pra-eksekusi Task 8 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p4-lacak-surat/preflight-rulings.md`.


1. **Labels (REQUIRED) [P4-T8-1] RECHECK-AFTER-P3.** Replace the `lib/lacak-labels.js` block with:
   ```js
   // frontend/src/lib/lacak-labels.js
   // Satu sumber label relasi: lib/tindak-lanjut (P3 T19-1). Jangan menyalin ulang.
   export { JENIS_RELASI_LABEL as LABEL_RELASI } from '@/lib/tindak-lanjut'

   export const LABEL_STATUS_RANGKAIAN = Object.freeze({
       aktif: 'Aktif',
       selesai: 'Selesai',
       diberkaskan: 'Diberkaskan',
       digabung: 'Digabung',
   })

   export const LABEL_JENIS_SURAT = Object.freeze({
       surat_masuk: 'Surat masuk',
       surat_keluar: 'Surat keluar',
   })
   ```
   If the Task 8 tests assert `LABEL_RELASI` values, they stay valid: P3 T19-1 keeps the four labels identical to `AlurSuratPanel.jsx:11`.
   - **(delta P3) Confirmed.** `export const JENIS_RELASI_LABEL = Object.freeze({ balasan, tindak_lanjut, menjelaskan, merujuk })` is at `lib/tindak-lanjut.js:6-11`. The panel re-exports it (`AlurSuratPanel.jsx:13`), and `STATUS_RANGKAIAN_LABEL` (:15) includes `digabung`.
2. **Cache key case (ADVISORY) [P4-T8-2] RECHECK-AFTER-P3.** Keep `.toLowerCase()` only if every predicate in the real `lacak.service.ts` is case-insensitive: `lower(...) =`, `ILIKE`, or normalized nomor. Otherwise remove it and update the one cache-key test.
   - **(delta P3) Condition holds, with one caveat.** Every predicate is case-insensitive:
     - `lower(coalesce(nomor,'')) = qLower` (:38);
     - `nomorNormSql` on both sides (:37-39, 47, 51);
     - `ILIKE` with lowercased tokens (:31, 51-52 of `nomor-surat.ts`);
     - phrase `ILIKE` (:62).

     `classifyLacakQuery` is case-independent for `jenis`, `qNorm` and `tokens`. The only case-carrying field is the echoed `LacakResult.q = plan.q` (:207). So keep `.toLowerCase()` in the key, and never read `data.q` for display; use the page's own `q` instead. The P3 hook key is case-sensitive (`use-lacak-search.js:24`), so this is a harmless behaviour change for the P3 pickers.
3. **Cache delete (ADVISORY, supports P4-T10-4).** If you implement `refresh()`, add `hapus(key) { entries.delete(key) },` to the object returned by `createLacakCache`, with a one-line test.


**C-9 (critic) — Tasks 5, 8: scan rows with no ruling — ADVISORY [P4-C-9]**


- **Task 5:** `count(*) OVER()` gives `total = 0` on an out-of-range page (scan-p4-backend, Task 5 "Minor" row). Compute `total` with a separate `count(*)`, or clamp `page` to the last page.
- **Task 8:** `lacak-link.js` treats a real nomor shaped like `/^S[MK]-\d+\/\d{4}$/` as a fallback title (scan-p4-frontend, Task 8 "edge case" row). Record this in the Self-Review as accepted.



### Task 9: Lengkapi `rangkaian.service.js` dan prop `rangkaianId` pada `AlurSuratPanel`

**Files:**
- Modify: `frontend/src/services/rangkaian.service.js` (dibuat P2 dengan `getById`/`getBySurat`, ditambah `lacak` oleh P3; tambah atau selaraskan metode di objek `rangkaianService`)
- Modify: `frontend/src/components/surat/AlurSuratPanel.jsx` (P2; signature dan efek pemuatan)
- Test: `frontend/src/services/rangkaian.service.lacak.test.js`, `frontend/src/components/surat/__tests__/AlurSuratPanel.rangkaian-id.test.jsx`

**Interfaces:**
- Consumes (repo): `api.get(endpoint, params, { signal })` dan `api.post(endpoint, body)` dari `services/api.js:382-395` (parameter kosong/undefined disaring)
- Consumes (P3): endpoint `/api/rangkaian/lacak`
- Consumes (Task 6): `GET /api/rangkaian`
- Produces:
  - (Tidak diubah, milik P3 Task 18) `rangkaianService.lacak({ q, mode = 'lacak', tahun, jenis, limit = 8 }, { signal } = {})` → `LacakResult` (`response.data`). P4 hanya menguji kontraknya; pemanggil P3 (picker `referensi`, cek duplikat `cek`, gabung) bergantung pada `jenis` dan `limit` default 8.
  - `rangkaianService.list({ unitPengolahId, status, asal, page = 1, limit = 20 } = {})` → respons utuh `{ success, data, pagination, meta }` untuk `usePaginatedResource`
  - `rangkaianService.unitKerjaOpsi()` → `[{ id, name }]` terurut nama (dari `GET /api/unit-kerja`)
  - `AlurSuratPanel({ jenis, suratId, rangkaianId = null, aksesMelalui = 'owner', fallback = null })`. Bila `rangkaianId` diisi, panel memuat lewat `rangkaianService.getById(rangkaianId)` (P2). Tanpa prop itu, perilaku P2 (`getBySurat`) tidak berubah.

- [ ] **Step 1: Tulis tes yang gagal**

```js
// frontend/src/services/rangkaian.service.lacak.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('./api', () => ({ default: { get: mocks.get, post: mocks.post }, api: { get: mocks.get, post: mocks.post } }))
import rangkaianService, { rangkaianService as named } from './rangkaian.service'

beforeEach(() => vi.clearAllMocks())

describe('rangkaianService (P4)', () => {
    it('mengekspor objek yang sama sebagai default dan named', () => {
        expect(named).toBe(rangkaianService)
    })
    it('lacak meneruskan AbortSignal dan mengembalikan data', async () => {
        const controller = new AbortController()
        mocks.get.mockResolvedValue({ success: true, data: { q: 'B-12', kelompok: [] } })
        await expect(rangkaianService.lacak({ q: 'B-12', tahun: '2024' }, { signal: controller.signal })).resolves.toEqual({ q: 'B-12', kelompok: [] })
        expect(mocks.get).toHaveBeenCalledWith('/api/rangkaian/lacak', { q: 'B-12', mode: 'lacak', tahun: '2024', jenis: undefined, limit: 8 }, { signal: controller.signal })
    })
    it('list mengembalikan respons utuh untuk paginasi', async () => {
        const response = { success: true, data: [], pagination: { total: 0 }, meta: { aksiDiizinkan: [] } }
        mocks.get.mockResolvedValue(response)
        await expect(rangkaianService.list({ status: 'diberkaskan', page: 2 })).resolves.toBe(response)
        expect(mocks.get).toHaveBeenCalledWith('/api/rangkaian', { unitPengolahId: undefined, status: 'diberkaskan', asal: undefined, page: 2, limit: 20 })
    })
    it('unitKerjaOpsi mengembalikan id dan nama terurut', async () => {
        mocks.get.mockResolvedValue({ success: true, data: [{ id: 'dir_ptep', name: 'Dit. PTEP', driveFolderId: 'x' }, { id: 'dir_bppt', name: 'Dit. BPPT' }] })
        await expect(rangkaianService.unitKerjaOpsi()).resolves.toEqual([{ id: 'dir_bppt', name: 'Dit. BPPT' }, { id: 'dir_ptep', name: 'Dit. PTEP' }])
        expect(mocks.get).toHaveBeenCalledWith('/api/unit-kerja')
    })
})
```

```jsx
// frontend/src/components/surat/__tests__/AlurSuratPanel.rangkaian-id.test.jsx
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ getById: vi.fn(), getBySurat: vi.fn() }))
vi.mock('@/services/rangkaian.service', () => ({ default: mocks, rangkaianService: mocks }))
import { AlurSuratPanel } from '../AlurSuratPanel'

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getById.mockReturnValue(new Promise(() => {}))
    mocks.getBySurat.mockReturnValue(new Promise(() => {}))
})
afterEach(cleanup)

describe('AlurSuratPanel dengan rangkaianId (Lacak Surat)', () => {
    it('memuat lewat getById bila rangkaianId diberikan', () => {
        render(<MemoryRouter><AlurSuratPanel rangkaianId="11111111-1111-4111-8111-111111111111" /></MemoryRouter>)
        expect(mocks.getById).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111')
        expect(mocks.getBySurat).not.toHaveBeenCalled()
        expect(screen.getByText('Memuat alur surat…')).toBeVisible()
    })
    it('tetap memakai getBySurat tanpa rangkaianId (perilaku P2)', () => {
        render(<MemoryRouter><AlurSuratPanel jenis="surat_masuk" suratId="s1" /></MemoryRouter>)
        expect(mocks.getBySurat).toHaveBeenCalledWith('surat_masuk', 's1')
        expect(mocks.getById).not.toHaveBeenCalled()
    })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `(cd frontend && npx vitest run src/services/rangkaian.service.lacak.test.js src/components/surat/__tests__/AlurSuratPanel.rangkaian-id.test.jsx)`
Expected: FAIL.
- Di tes layanan, `list` dan `unitKerjaOpsi` bernilai `undefined` (`is not a function`). Tes `lacak` seharusnya sudah lulus (metode P3); bila gagal, P3 Task 18 belum dimerge — berhenti.
- Di tes panel, `getById` tidak dipanggil karena P2 selalu memanggil `getBySurat(undefined, undefined)`.

- [ ] **Step 3: Implementasi minimal**

Di dalam objek `rangkaianService` pada `frontend/src/services/rangkaian.service.js`, **jangan** mengubah metode `lacak` milik P3; tambahkan dua metode berikut persis. Pastikan file tetap diakhiri `export default rangkaianService`.

```js
    /** GET /api/rangkaian (P4). Respons utuh untuk usePaginatedResource. */
    async list({ unitPengolahId, status, asal, page = 1, limit = 20 } = {}) {
        return api.get('/api/rangkaian', { unitPengolahId, status, asal, page, limit })
    },

    async unitKerjaOpsi() {
        const response = await api.get('/api/unit-kerja')
        return (response.data || [])
            .map(({ id, name }) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name, 'id'))
    },
```

`export const rangkaianService = { … }` dan `export default rangkaianService` dari P2 tetap dipertahankan.

Di `frontend/src/components/surat/AlurSuratPanel.jsx`, ubah signature komponen dan efek pemuatannya. Efek P2 berbentuk `rangkaianService.getBySurat(jenis, suratId).then(…)` dengan dependensi `[jenis, suratId]`:

```jsx
export function AlurSuratPanel({ jenis, suratId, rangkaianId = null, aksesMelalui = 'owner', fallback = null }) {
    const [state, setState] = useState({ loading: true, data: null, error: false })

    useEffect(() => {
        let aktif = true
        setState({ loading: true, data: null, error: false })
        const muat = rangkaianId ? rangkaianService.getById(rangkaianId) : rangkaianService.getBySurat(jenis, suratId)
        muat
            .then((data) => { if (aktif) setState({ loading: false, data, error: false }) })
            .catch(() => { if (aktif) setState({ loading: false, data: null, error: true }) })
        return () => { aktif = false }
    }, [jenis, suratId, rangkaianId])
```

Sisa komponen (render, aksi P3) tidak diubah.

- [ ] **Step 4: Jalankan, pastikan lulus (termasuk uji P2/P3 yang memakai layanan dan panel ini)**

Run: `(cd frontend && npx vitest run src/services/rangkaian.service.lacak.test.js src/components/surat/__tests__/AlurSuratPanel.rangkaian-id.test.jsx && npx vitest run rangkaian referensi AlurSuratPanel)`
Expected: PASS, termasuk `src/components/surat/__tests__/AlurSuratPanel.test.jsx` dan `src/services/rangkaian.service.test.js` milik P2.

- [ ] **Step 5: Commit**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
git add frontend/src/services/rangkaian.service.js frontend/src/services/rangkaian.service.lacak.test.js frontend/src/components/surat/AlurSuratPanel.jsx frontend/src/components/surat/__tests__/AlurSuratPanel.rangkaian-id.test.jsx
git commit -F - <<'EOF'
feat(lacak): layanan klien lacak, daftar, dan panel per rangkaianId

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---


#### Amandemen pra-eksekusi Task 9 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p4-lacak-surat/preflight-rulings.md`.


1. **Panel edit (BLOCKING) [P4-T9-1] RECHECK-AFTER-P3.** Replace the Step 3 text from "Di `frontend/src/components/surat/AlurSuratPanel.jsx`, ubah signature komponen dan efek pemuatannya…" through the end of the JSX block with this minimal edit of the P3 panel. Do not rewrite the effect.
   - Destructuring: add `rangkaianId = null` to the existing props, giving `({ jenis, suratId, rangkaianId = null, aksesMelalui = 'owner', fallback = null, onChanged })`. Keep every prop P3 added.
   - Inside the existing async `muat()` of the load effect, replace only the loader line:
     ```jsx
                     const data = rangkaianId
                         ? await rangkaianService.getById(rangkaianId)
                         : await rangkaianService.getBySurat(jenis, suratId)
     ```
   - Append `rangkaianId` to the existing dependency array, for example `[jenis, suratId, muatKe]` → `[jenis, suratId, muatKe, rangkaianId]`.
   - Keep the P2 `notFound` state and 404 branch, the P3 `muatUlang`/`onChanged` flow and the `AlurSuratActions` slot unchanged.

   This variant was verified against the P2 panel: ESLint clean, the P2 panel test 10/10, and the Task 9 tests 2/2.
   - **(delta P3) Corrected for real P3 @ b4d86fa.**
     - Signature: `({ jenis, suratId, rangkaianId = null, aksesMelalui = 'owner', fallback = null, onChanged, muatUlangKe = 0 })` (`AlurSuratPanel.jsx:56`). Keep the P3 `muatUlangKe` prop.
     - Loader: :83.
     - Deps: `[jenis, suratId, muatKe, muatUlangKe]` → `[jenis, suratId, muatKe, muatUlangKe, rangkaianId]` (:96).
   - Re-verified on the real P3 effect body with the P3 frontend ESLint config (`npx eslint --stdin --stdin-filename src/components/surat/AlurSuratPanel.jsx`, probe `delta/fe/panel-effect-probe.jsx`): 0 errors, including the `aksesEfektif` change in item 2.
   - The P3 panel test file renders the real `AlurSuratActions` (no mock), with `rangkaianService` mocked as `{ default: svc, rangkaianService: svc }` (`__tests__/AlurSuratPanel.test.jsx:8-13`). Its `muatUlangKe` case is at :181.
2. **Banner (ADVISORY) [P4-T9-3] RECHECK-AFTER-P3.** Where the panel reads the `aksesMelalui` prop for its banner, use `const aksesEfektif = rangkaianId ? (<detail var>.aksesMelalui ?? 'owner') : aksesMelalui` instead, combined with the P3 T25-2 banner rule. `<detail var>` is the panel's loaded detail object, `d` in P3 T25-1.
3. **Tests (REQUIRED) [P4-T9-2].** Add to `AlurSuratPanel.rangkaian-id.test.jsx`:
   ```jsx
       it('rangkaianId yang 404 menampilkan keadaan netral, bukan galat', async () => {
           mocks.getById.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }))
           render(<MemoryRouter><AlurSuratPanel rangkaianId="11111111-1111-4111-8111-111111111111" /></MemoryRouter>)
           expect(await screen.findByRole('status')).toHaveTextContent('Alur surat tidak tersedia untuk Anda.')
           expect(screen.queryByRole('alert')).toBeNull()
       })
   ```
   If the P3 panel renders `AlurSuratActions` once data loads, the file also needs `vi.mock('@/components/surat/AlurSuratActions', () => ({ default: () => null, AlurSuratActions: () => null, TautkanDialog: () => null }))`, matching the named exports that actually exist.
   - **(delta P3) Corrected mock.**
     - The real panel imports four named exports and no default: `import { AlurSuratActions, AjukanAksesButton, BatalRelasiButton, TutupDisposisiButton } from './AlurSuratActions'` (`AlurSuratPanel.jsx:10`). A factory that omits any of them makes Vitest throw `No "<name>" export is defined on the mock` as soon as that branch renders.
     - Preferred: do not mock `AlurSuratActions` at all, as the P3 panel test does.
     - Otherwise the factory is `() => ({ AlurSuratActions: () => null, AjukanAksesButton: () => null, BatalRelasiButton: () => null, TutupDisposisiButton: () => null, TautkanDialog: () => null })`.
   - The service mock must expose both shapes: `vi.mock('@/services/rangkaian.service', () => ({ default: svc, rangkaianService: svc }))`. The panel uses the default import (:7), and `AlurSuratActions` also uses the default import (`AlurSuratActions.jsx:10`).
4. **Step 4 run list (REQUIRED) [P4-T9-2, P4-G-6].** Use `cd frontend && npx vitest run src/services/rangkaian.service.lacak.test.js src/services/rangkaian.service.test.js src/components/surat/__tests__ && npx eslint src/components/surat/AlurSuratPanel.jsx src/services/rangkaian.service.js`. Expected: PASS (P2 panel 10 tests, P3 panel tests, Task 9: 3 tests) and ESLint with 0 errors.
5. **Unit options (ADVISORY) [P4-T9-4].** In `unitKerjaOpsi`, before `.map`, add `.filter(unit => unit.unitType !== 'bagian' && unit.canReceiveDistribution !== false)`. Adjust the test fixture to include one `bagian_umum` row with `unitType: 'bagian'`, and expect it to be excluded.
6. **(delta P3) Per-row `dapatDitutup` (ADVISORY, in flux; P3 frontend carry-forward 1 / fix-wave F-I3).**
   - The fix wave adds a server flag `dapatDitutup` on each `DisposisiRangkaian` row. It is computed with the `tutupOlehPengawas` predicate: CTRL-1, no super_admin shortcut, pengawas scope on the SM unit.
   - The panel then shows `TutupDisposisiButton` only on rows with `row.dapatDitutup === true`. At b4d86fa it still uses `bolehTutup && (sent|received)` (`AlurSuratPanel.jsx:131, 216-219`).
   - P4 does not touch that code. Any P4 test fixture (Task 9, Task 13) that includes `disposisi` rows adds `dapatDitutup: false`, so that the Tutup button never renders unexpectedly.
   - A Lacak panel opened through `rangkaianId` gets the same server flag, because `GET /api/rangkaian/:id` shares `getDetail`.


**C-3 (critic) — Task 9: anchors confirmed on the real P3 panel — REQUIRED (verification), RECHECK-AFTER-P3 (P3 T25) [P4-C-3]**


- Real P3-fe `components/surat/AlurSuratPanel.jsx` has everything the Task 9 minimal edit needs:
  - `export function AlurSuratPanel({ jenis, suratId, aksesMelalui = 'owner', fallback = null, onChanged })` (:52);
  - `const data = await rangkaianService.getBySurat(jenis, suratId)` inside `muat()` (:71);
  - deps `[jenis, suratId, muatKe]` (:84);
  - detail variable `const d = state.data` (:115);
  - `rangkaianService.getById` (`services/rangkaian.service.js:6-9`).
- **(delta P3) Superseded line numbers, merged P3 @ b4d86fa.**
  - Signature at :56, with the added `muatUlangKe = 0`.
  - Loader at :83.
  - Deps `[jenis, suratId, muatKe, muatUlangKe]` at :96.
  - `const d = state.data` at :127.
  - `AlurSuratActions` has landed, with the slot at :170.
  - `STATUS_RANGKAIAN_LABEL` is at :15.
  - The Task 9 edit was re-linted on this body: 0 errors. See Task 9 item 1.
- The minimal edit applies verbatim. The earlier ESLint and 10/10 verification ran on the P2 panel, so Step 4 must re-run `src/components/surat/__tests__` on the stacked P3 tip. P3 T25 (`AlurSuratActions`) has not landed yet.
- ADVISORY: the real panel still defines `STATUS_RANGKAIAN_LABEL` (:14, including `digabung`). Task 8's `LABEL_STATUS_RANGKAIAN` becomes a second copy, so add a parity test in the Task 8 labels test: `expect(LABEL_STATUS_RANGKAIAN).toEqual(STATUS_RANGKAIAN_LABEL)`.



### Task 10: Lengkapi hook `useLacakSearch` (P3) — status, batas 100, `retry`, dan cache `lacak-cache.js`

> Tinjauan konsistensi lintas fase: hanya ada **satu** hook Lacak, yaitu `useLacakSearch` di `frontend/src/hooks/use-lacak-search.js` (dibuat P3 Task 18, dipakai `ReferensiSection`, cek duplikat registrasi, dan dialog gabung). P4 tidak membuat `use-lacak-surat.js`; P4 **memperluas** hook P3 tanpa memutus pemanggil P3 (`{ loading, error, data }` dan opsi `jenis`/`enabled` tetap ada).

**Files:**
- Modify: `frontend/src/hooks/use-lacak-search.js` (P3 Task 18; implementasi diganti utuh, tanda tangan diperluas)
- Test: `frontend/src/hooks/use-lacak-search.p4.test.jsx` (baru; `use-lacak-search.test.jsx` milik P3 tidak diubah dan wajib tetap hijau)

**Interfaces:**
- Consumes (P3 Task 18): `rangkaianService.lacak({ q, mode = 'lacak', tahun, jenis, limit = 8 }, { signal } = {})` → `LacakResult` (tidak diubah P4)
- Consumes (Task 8): `createLacakCache`, `lacakCacheKey`, `LACAK_MIN_CHARS`, `LACAK_MAX_CHARS`
- Produces:
  - `LACAK_DEBOUNCE_MS = 300` (diekspor dari `use-lacak-search.js`)
  - `useLacakSearch(term, { mode = 'lacak', jenis, tahun, enabled = true, debounceMs = 300 } = {})` → `{ status: 'idle'|'invalid'|'loading'|'success'|'error', loading: boolean, data: LacakResult|null, error, q, retry }` — superset dari bentuk P3 `{ loading, error, data }`

- [ ] **Step 1: Tulis tes yang gagal**

```jsx
// frontend/src/hooks/use-lacak-search.p4.test.jsx
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ lacak: vi.fn() }))
vi.mock('@/services/rangkaian.service', () => ({ default: { lacak: mocks.lacak }, rangkaianService: { lacak: mocks.lacak } }))
import { useLacakSearch } from './use-lacak-search'

const hasil = q => ({ q, mode: 'lacak', jenisKueri: 'nomor', kelompok: [{ kunci: `surat:${q}` }] })
function deferred() {
    let resolve
    const promise = new Promise(res => { resolve = res })
    return { promise, resolve }
}
const maju = async ms => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

beforeEach(() => {
    vi.useFakeTimers()
    mocks.lacak.mockReset()
    mocks.lacak.mockImplementation(async ({ q }) => hasil(q))
})
afterEach(() => vi.useRealTimers())

describe('useLacakSearch (P4: halaman Lacak Surat)', () => {
    it('menunggu 300 ms setelah ketikan terakhir dan hanya mengirim satu permintaan', async () => {
        const { result, rerender } = renderHook(({ q }) => useLacakSearch(q), { initialProps: { q: 'B-1' } })
        rerender({ q: 'B-12' })
        await maju(200)
        rerender({ q: 'B-12/' })
        await maju(299)
        expect(mocks.lacak).not.toHaveBeenCalled()
        expect(result.current.status).toBe('loading')
        expect(result.current.loading).toBe(true)
        await maju(1)
        expect(mocks.lacak).toHaveBeenCalledTimes(1)
        expect(mocks.lacak).toHaveBeenCalledWith({ q: 'B-12/', mode: 'lacak', jenis: undefined, tahun: undefined }, { signal: expect.any(AbortSignal) })
        expect(result.current.status).toBe('success')
        expect(result.current.loading).toBe(false)
        expect(result.current.data.kelompok[0].kunci).toBe('surat:B-12/')
    })

    it('tidak mengirim untuk < 3 karakter setelah trim dan menandai > 100 karakter tidak valid', async () => {
        const { result, rerender } = renderHook(({ q }) => useLacakSearch(q), { initialProps: { q: '  ab  ' } })
        await maju(1000)
        expect(result.current.status).toBe('idle')
        rerender({ q: 'x'.repeat(101) })
        await maju(1000)
        expect(result.current.status).toBe('invalid')
        expect(mocks.lacak).not.toHaveBeenCalled()
    })

    it('membatalkan permintaan lama begitu kueri berubah', async () => {
        const pertama = deferred()
        mocks.lacak.mockImplementationOnce(() => pertama.promise)
        const { result, rerender } = renderHook(({ q }) => useLacakSearch(q), { initialProps: { q: 'PTPP.1' } })
        await maju(300)
        const sinyal = mocks.lacak.mock.calls[0][1].signal
        expect(sinyal.aborted).toBe(false)
        rerender({ q: 'PTPP.12' })
        expect(sinyal.aborted).toBe(true)
        await maju(300)
        expect(result.current.data.q).toBe('PTPP.12')
        await act(async () => { pertama.resolve(hasil('PTPP.1')) })
        expect(result.current.data.q).toBe('PTPP.12')
    })

    it('penjaga urutan: respons basi yang tidak menghormati abort tidak menimpa hasil terbaru', async () => {
        const d1 = deferred()
        const d2 = deferred()
        mocks.lacak.mockImplementationOnce(() => d1.promise).mockImplementationOnce(() => d2.promise)
        const { result, rerender } = renderHook(({ q }) => useLacakSearch(q), { initialProps: { q: 'rapat' } })
        await maju(300)
        rerender({ q: 'rapat koordinasi' })
        await maju(300)
        await act(async () => { d2.resolve(hasil('rapat koordinasi')) })
        expect(result.current.data.q).toBe('rapat koordinasi')
        await act(async () => { d1.resolve(hasil('rapat')) })
        expect(result.current.status).toBe('success')
        expect(result.current.data.q).toBe('rapat koordinasi')
    })

    it('memakai cache LRU 20 entri: kembali ke kueri lama tanpa permintaan baru; entri terlama tak terpakai digusur', async () => {
        const kueri = i => `kueri-${String(i).padStart(2, '0')}`
        const { result, rerender } = renderHook(({ q }) => useLacakSearch(q), { initialProps: { q: kueri(0) } })
        await maju(300)
        for (let i = 1; i < 20; i += 1) {
            rerender({ q: kueri(i) })
            await maju(300)
        }
        expect(mocks.lacak).toHaveBeenCalledTimes(20)
        rerender({ q: kueri(0) })
        expect(result.current.status).toBe('success')
        await maju(300)
        expect(mocks.lacak).toHaveBeenCalledTimes(20)
        rerender({ q: kueri(20) })
        await maju(300)
        expect(mocks.lacak).toHaveBeenCalledTimes(21)
        rerender({ q: kueri(0) })
        await maju(300)
        expect(mocks.lacak).toHaveBeenCalledTimes(21)
        rerender({ q: kueri(1) })
        expect(result.current.status).toBe('loading')
        await maju(300)
        expect(mocks.lacak).toHaveBeenCalledTimes(22)
    })

    it('mode, tahun, dan jenis ikut menentukan kunci cache', async () => {
        const { rerender } = renderHook(({ tahun, jenis }) => useLacakSearch('SK-01/DJ-PTPP', { tahun, jenis }), { initialProps: { tahun: '', jenis: undefined } })
        await maju(300)
        rerender({ tahun: '2024', jenis: undefined })
        await maju(300)
        expect(mocks.lacak).toHaveBeenLastCalledWith({ q: 'SK-01/DJ-PTPP', mode: 'lacak', jenis: undefined, tahun: '2024' }, expect.anything())
        rerender({ tahun: '2024', jenis: 'surat_keluar' })
        await maju(300)
        expect(mocks.lacak).toHaveBeenCalledTimes(3)
        rerender({ tahun: '', jenis: undefined })
        await maju(300)
        expect(mocks.lacak).toHaveBeenCalledTimes(3)
    })

    it('enabled=false (pemanggil P3) tidak pernah mengirim permintaan', async () => {
        const { result } = renderHook(() => useLacakSearch('rapat koordinasi', { enabled: false }))
        await maju(1000)
        expect(result.current).toMatchObject({ status: 'idle', loading: false, data: null })
        expect(mocks.lacak).not.toHaveBeenCalled()
    })

    it('galat ditampilkan lalu dapat diulang', async () => {
        mocks.lacak.mockRejectedValueOnce(new Error('Terlalu banyak permintaan. Coba lagi nanti.'))
        const { result } = renderHook(() => useLacakSearch('rapat'))
        await maju(300)
        expect(result.current.status).toBe('error')
        expect(result.current.error.message).toBe('Terlalu banyak permintaan. Coba lagi nanti.')
        act(() => result.current.retry())
        expect(result.current.status).toBe('loading')
        await maju(300)
        expect(result.current.status).toBe('success')
    })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `(cd frontend && npx vitest run src/hooks/use-lacak-search.p4.test.jsx)`
Expected: FAIL — hook P3 tidak mengembalikan `status`/`retry` (`expected undefined to be 'loading'`) dan tidak menandai > 100 karakter sebagai `invalid`.

- [ ] **Step 3: Implementasi minimal (ganti isi `frontend/src/hooks/use-lacak-search.js`)**

```js
// frontend/src/hooks/use-lacak-search.js
import { useCallback, useEffect, useRef, useState } from 'react'
import { rangkaianService } from '@/services/rangkaian.service'
import { createLacakCache, lacakCacheKey, LACAK_MAX_CHARS, LACAK_MIN_CHARS } from '@/lib/lacak-cache'

export const LACAK_DEBOUNCE_MS = 300

/**
 * Satu-satunya hook Lacak (§6): debounce 300 ms, minimal 3 / maksimal 100 karakter,
 * AbortController per kueri (dibatalkan saat kueri berubah/unmount), penjaga urutan
 * basi, dan cache LRU 20 entri per instans. Status diturunkan saat render dari kunci
 * kueri sekarang, jadi hasil lama tidak pernah tampil untuk kueri baru.
 * Bentuk P3 `{ loading, error, data }` dipertahankan untuk ReferensiSection, cek
 * duplikat registrasi, dan dialog gabung.
 */
export function useLacakSearch(term, { mode = 'lacak', jenis, tahun, enabled = true, debounceMs = LACAK_DEBOUNCE_MS } = {}) {
    const [cache] = useState(() => createLacakCache())
    const sequenceRef = useRef(0)
    const [snapshot, setSnapshot] = useState(null)
    const [attempt, setAttempt] = useState(0)
    const q = typeof term === 'string' ? term.trim() : ''
    const tahunKunci = tahun === undefined || tahun === null || tahun === '' ? '' : String(tahun)
    const valid = enabled && q.length >= LACAK_MIN_CHARS && q.length <= LACAK_MAX_CHARS
    const key = valid ? lacakCacheKey({ q, mode, tahun: tahunKunci, jenis }) : null

    useEffect(() => {
        const sequence = ++sequenceRef.current
        if (!key || cache.get(key) !== undefined) return undefined
        const controller = new AbortController()
        const timer = setTimeout(() => {
            rangkaianService.lacak({ q, mode, jenis, tahun: tahunKunci || undefined }, { signal: controller.signal })
                .then(data => {
                    cache.set(key, data)
                    if (sequence === sequenceRef.current) setSnapshot({ key, attempt, data, error: null })
                })
                .catch(error => {
                    if (controller.signal.aborted || error?.name === 'AbortError') return
                    if (sequence === sequenceRef.current) setSnapshot({ key, attempt, data: null, error })
                })
        }, debounceMs)
        return () => {
            clearTimeout(timer)
            controller.abort()
        }
    }, [cache, key, q, mode, jenis, tahunKunci, debounceMs, attempt])

    const retry = useCallback(() => setAttempt(value => value + 1), [])
    const bentuk = (status, data = null, error = null) => ({ status, loading: status === 'loading', data, error, q, retry })

    if (!key) return bentuk(enabled && q.length > LACAK_MAX_CHARS ? 'invalid' : 'idle')
    const cached = cache.peek(key)
    if (cached !== undefined) return bentuk('success', cached)
    if (snapshot?.key === key && snapshot.attempt === attempt && snapshot.error) return bentuk('error', null, snapshot.error)
    return bentuk('loading')
}
```

- [ ] **Step 4: Jalankan, pastikan lulus (termasuk tes P3 dan semua pemanggil P3)**

Run: `(cd frontend && npx vitest run src/hooks/use-lacak-search.p4.test.jsx src/hooks/use-lacak-search.test.jsx && npx vitest run ReferensiSection TambahSuratMasuk AlurSuratActions && npx eslint src/hooks/use-lacak-search.js)`
Expected: PASS (8 tes P4 + 3 tes P3 + tes pemanggil P3) dan ESLint tanpa galat.

- [ ] **Step 5: Commit**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
git add frontend/src/hooks/use-lacak-search.js frontend/src/hooks/use-lacak-search.p4.test.jsx
git commit -F - <<'EOF'
feat(lacak): lengkapi useLacakSearch dengan status, batas 100, retry, dan cache LRU bersama

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---


#### Amandemen pra-eksekusi Task 10 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p4-lacak-surat/preflight-rulings.md`.


1. **Hook implementation (BLOCKING) [P4-T10-1, P4-T10-2] RECHECK-AFTER-P3.** Replace the Step 3 block with:
   ```js
   // frontend/src/hooks/use-lacak-search.js
   import { useEffect, useRef, useState } from 'react'
   import { rangkaianService } from '@/services/rangkaian.service'
   import { createLacakCache, lacakCacheKey, LACAK_MAX_CHARS, LACAK_MIN_CHARS } from '@/lib/lacak-cache'

   export const LACAK_DEBOUNCE_MS = 300

   /**
    * Satu-satunya hook Lacak (§6): debounce 300 ms, minimal 3 / maksimal 100 karakter,
    * AbortController per kueri, penjaga urutan basi, cache LRU 20 entri per instans.
    * Kontrak P3 (T18-2) dipertahankan: selama `loading`, `data` = hasil sukses terakhir
    * (bukan null); `status` memberi tahu pemanggil bahwa data itu belum untuk kueri sekarang.
    */
   export function useLacakSearch(term, { mode = 'lacak', jenis, tahun, enabled = true, debounceMs = LACAK_DEBOUNCE_MS } = {}) {
       const [cache] = useState(() => createLacakCache())
       const sequenceRef = useRef(0)
       const [snapshot, setSnapshot] = useState(null)
       const [terakhir, setTerakhir] = useState(null)
       const [attempt, setAttempt] = useState(0)
       const q = typeof term === 'string' ? term.trim() : ''
       const tahunKunci = tahun === undefined || tahun === null || tahun === '' ? '' : String(tahun)
       const valid = enabled && q.length >= LACAK_MIN_CHARS && q.length <= LACAK_MAX_CHARS
       const key = valid ? lacakCacheKey({ q, mode, tahun: tahunKunci, jenis }) : null

       useEffect(() => {
           const sequence = ++sequenceRef.current
           if (!key || cache.get(key) !== undefined) return undefined
           const controller = new AbortController()
           const timer = setTimeout(() => {
               rangkaianService.lacak({ q, mode, jenis, tahun: tahunKunci || undefined }, { signal: controller.signal })
                   .then(data => {
                       cache.set(key, data)
                       if (sequence === sequenceRef.current) {
                           setSnapshot({ key, attempt, data, error: null })
                           setTerakhir(data)
                       }
                   })
                   .catch(error => {
                       if (controller.signal.aborted || error?.name === 'AbortError') return
                       if (sequence === sequenceRef.current) setSnapshot({ key, attempt, data: null, error })
                   })
           }, debounceMs)
           return () => {
               clearTimeout(timer)
               controller.abort()
           }
       }, [cache, key, q, mode, jenis, tahunKunci, debounceMs, attempt])

       const retry = () => setAttempt(value => value + 1)
       const bentuk = (status, data = null, error = null) => ({ status, loading: status === 'loading', data, error, q, retry })

       if (!key) return bentuk(enabled && q.length > LACAK_MAX_CHARS ? 'invalid' : 'idle')
       const cached = cache.peek(key)
       if (cached !== undefined) return bentuk('success', cached)
       if (snapshot?.key === key && snapshot.attempt === attempt && snapshot.error) return bentuk('error', null, snapshot.error)
       return bentuk('loading', terakhir)
   }
   ```
   - Verified in scratch: the 8 plan P4 tests, the new test below and the 3 P3 hook tests all pass (12/12), and ESLint reports 0 problems.
   - RECHECK-AFTER-P3: if Task 1 Step 3 records that the real P3 hook returns `data: null` while loading, change the last line to `return bentuk('loading')`, remove the `terakhir` state, and invert the new test (`expect(result.current.data).toBeNull()`). P4 must mirror P3; it must not pick a behaviour of its own.
2. **Step 1: add this test (REQUIRED) [P4-T10-2].** Append to `use-lacak-search.p4.test.jsx`:
   ```jsx
   describe('useLacakSearch (kontrak P3 T18-2 dipertahankan)', () => {
       it('selama loading kueri baru, data tetap hasil sukses terakhir dan status loading', async () => {
           const { result, rerender } = renderHook(({ q }) => useLacakSearch(q), { initialProps: { q: 'rapat' } })
           await maju(300)
           expect(result.current.data.q).toBe('rapat')
           rerender({ q: 'rapat koordinasi' })
           expect(result.current.status).toBe('loading')
           expect(result.current.loading).toBe(true)
           expect(result.current.data.q).toBe('rapat')
           await maju(300)
           expect(result.current.status).toBe('success')
           expect(result.current.data.q).toBe('rapat koordinasi')
       })
   })
   ```
3. **Step 2 Expected (REQUIRED).** Replace it with: FAIL, because `status`, `retry` and `invalid` are missing or differ from the real P3 hook. Record which tests fail; do not assume the pre-amendment P3 hook.
4. **Step 4 (REQUIRED) [P4-T10-3] RECHECK-AFTER-P3.** Run: `cd frontend && npx vitest run src/hooks/use-lacak-search.p4.test.jsx src/hooks/use-lacak-search.test.jsx && npx vitest run $(rg -l "use-lacak-search|useLacakSearch|ReferensiSection|GabungDialog" src --glob "*.test.jsx" | tr '\n' ' ') && npx eslint src/hooks/use-lacak-search.js`. Expected: PASS (9 P4 tests, the P3 hook tests, and every P3 caller test) and ESLint with 0 errors.
   - **(delta P3) Corrected consumer list.** On real P3 @ b4d86fa, the `rg` filter matches only `src/hooks/use-lacak-search.test.jsx` and `src/components/surat/__tests__/AlurSuratActions.test.jsx` (the GabungDialog there calls the hook; `AlurSuratActions.jsx:9`).
     - It misses two P3 consumer suites: `src/pages/TambahSuratMasuk.registrasi.test.jsx`, which mocks `rangkaianService.lacak` for cek duplikat (:16), and `src/pages/surat-reply-picker.test.jsx`, which drives `ReferensiSection` through `@/services/api`. The latter asserts the exact `/api/rangkaian/lacak` params `{ q, mode: 'referensi', tahun: undefined, jenis: undefined, limit: 8 }` (:43).
     - Replace the `rg` sub-command with the explicit list: `npx vitest run src/hooks/use-lacak-search.test.jsx src/components/surat/__tests__/AlurSuratActions.test.jsx src/pages/TambahSuratMasuk.registrasi.test.jsx src/pages/surat-reply-picker.test.jsx`.
     - Every P3 hook consumer is `ReferensiSection.jsx`, `AlurSuratActions.jsx`, or `TambahSuratMasuk.jsx`; none reads `retry`.
     - The P4 hook must keep calling `rangkaianService.lacak({ q, mode, jenis, tahun }, { signal })` with the raw, un-lowercased `q`, so that the reply-picker assertion holds.
5. **Refresh (ADVISORY) [P4-T10-4].** Optionally add `const refresh = () => { if (key) cache.hapus(key); setAttempt(value => value + 1) }`, return it from `bentuk`, and use it in Task 13 (see there). Keep it a plain function; `useCallback` triggers the same lint error as `retry`.
6. **(delta P3) P3 frontend review M10 / M17 (record, no change).**
   - M10 asks to wrap `retry` in `useCallback` "since it is part of the P4 contract". This is rejected. Re-verified on the P3 ESLint config (unchanged since P2): the plan hook body with `useCallback(() => setAttempt(v => v + 1), [])` fails `react-hooks/preserve-manual-memoization` at `use-lacak-search.js:47`. No P3 consumer uses `retry`, so identity stability has no consumer.
   - M10's "use `cache.has` instead of the `undefined` sentinel" is satisfied by the P4 `createLacakCache().peek`/`get` API (Task 8).
   - M17's hook test gaps (error, retry, enabled=false) are covered by the plan's P4 tests at P4:2097 and P4:2104.


**C-1 (critic) — Task 10: while loading, the hook returns `data: null` (supersedes the primary branch of Task 10 items 1–2) — BLOCKING, RECHECK-AFTER-P3 [P4-C-1]**


- **(delta P3)** Re-confirmed on merged P3 @ b4d86fa: same file and line, and 5 tests at `use-lacak-search.test.jsx:17, 30, 45, 58, 68`.
- Real P3 `frontend/src/hooks/use-lacak-search.js:63` returns `{ loading: true, error: null, data: null, retry }`. Commit 986e7b5 removed the `terakhir` state on purpose: stale results rendered as clickable items in consumers that do not check `loading` (ReferensiSection and others), "cabang loading kini selalu data: null (P4 Task 10 juga begini)".
- Its tests `use-lacak-search.test.jsx:58` ("tidak menampilkan hasil kueri lama saat kueri baru sedang memuat") and `:30` assert `data === null` while a new query loads. The amended Task 10 hook (`bentuk('loading', terakhir)`) and the item-2 test therefore fail the P3 hook suite that Task 10 Step 4 runs. The scratch 12/12 was measured against the amended P3 *plan* hook, not the real one.
- Binding now (the conditional branch of Task 10 item 1 applies):
  - The last line is `return bentuk('loading')`. Remove `const [terakhir, setTerakhir] = useState(null)` and `setTerakhir(data)`.
  - Replace the item-2 test with "selama loading kueri baru, data null (kontrak P3 986e7b5)": after `rerender({ q: 'rapat koordinasi' })` expect `status 'loading'`, `loading true`, `data` `toBeNull()`; after `await maju(300)` expect `status 'success'` and `data.q === 'rapat koordinasi'`.
  - This restores the original P4 text (P4:2133-2137, 2179). The 8 plan tests do not assert loading data (checked in `snips/t10-hook.test.jsx`).
- Step 4 counts: the real P3 hook file has **5** tests (`:17, :30, :45, :58, :68`), not 3. Expected: 9 P4 tests + 5 P3 hook tests + every P3 caller test.
- Carry-over facts from the real hook:
  - `rangkaianService` has both a named and a default export (`services/rangkaian.service.js:5, 70`), so the amended named import is valid.
  - The P3 cache key is case-sensitive, `JSON.stringify([q, mode, jenis ?? null, tahun ?? null])` (`use-lacak-search.js:24`). P4-T8-2 lower-casing is therefore a behaviour change for the P3 pickers; keep it only under P4-T8-2's condition.



### Task 11: Komponen `LacakKelompokCard` (kartu rangkaian dengan pratinjau inline)

**Files:**
- Create: `frontend/src/components/lacak/LacakKelompokCard.jsx`
- Test: `frontend/src/components/lacak/LacakKelompokCard.test.jsx`

**Interfaces:**
- Consumes: `LacakKelompok`, `LacakNode`, dan `LacakNodeTersamar` (kontrak Task 1); `LABEL_RELASI`, `LABEL_STATUS_RANGKAIAN`, dan `LABEL_JENIS_SURAT` (Task 8); `Card`/`CardContent`, `Badge`, `Button` (shadcn)
- Produces: `LacakKelompokCard({ kelompok, terbuka = false, onToggle, children })`. Anak (`AlurSuratPanel`) dirender di dalam kartu hanya bila `terbuka`.

- [ ] **Step 1: Tulis tes yang gagal**

```jsx
// frontend/src/components/lacak/LacakKelompokCard.test.jsx
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { LacakKelompokCard } from './LacakKelompokCard'

afterEach(cleanup)
const R = '11111111-1111-4111-8111-111111111111'
const kelompokRangkaian = {
    kunci: R, skor: 100, tanggalTerbaru: '2025-01-20',
    rangkaian: { id: R, kode: 'RS-2025-000001', status: 'aktif', judul: 'Penetapan tim arsip 2025', tahun: 2025, asal: 'inisiatif' },
    cocok: [{ jenis: 'surat_keluar', id: 'sk-25', nomorSurat: 'SK-01/DJ-PTPP', perihal: 'Penetapan tim arsip 2025', tahun: 2025, skor: 100 }],
    pratinjau: [
        { anggotaId: 'a-1', jenis: 'surat_keluar', id: 'nd-25', nomorSurat: 'ND-3/DJ-PTPP/2025', perihal: 'Penjelasan Keputusan', tanggalSurat: '2025-01-20', tahun: 2025, naskah: 'Nota Dinas', unitNama: 'Dit. BPPT', relasi: 'menjelaskan', masked: false },
        { anggotaId: 'a-2', jenis: 'surat_masuk', unitNama: 'Sesditjen', label: 'Dikecualikan', masked: true, dapatAjukanAkses: true },
    ],
    jumlahAnggota: 5, pratinjauTerpotong: true,
}
const mount = props => render(<MemoryRouter><LacakKelompokCard {...props} /></MemoryRouter>)

describe('LacakKelompokCard', () => {
    it('menampilkan kode RS, status, tahun, pratinjau dengan label relasi, dan node tersamar tanpa tautan', () => {
        const onToggle = vi.fn()
        mount({ kelompok: kelompokRangkaian, onToggle })
        expect(screen.getByText('RS-2025-000001')).toBeVisible()
        expect(screen.getByText('Aktif')).toBeVisible()
        expect(screen.getByText('Tahun 2025')).toBeVisible()
        expect(screen.getByRole('heading', { name: 'Penetapan tim arsip 2025' })).toBeVisible()
        expect(screen.getByRole('link', { name: 'ND-3/DJ-PTPP/2025' })).toHaveAttribute('href', '/surat/keluar/nd-25')
        expect(screen.getByText('Menjelaskan')).toBeVisible()
        const tersamar = screen.getByText(/Dikecualikan/).closest('li')
        expect(tersamar).toHaveAttribute('data-masked', 'true')
        expect(tersamar).toHaveTextContent('Surat masuk · Sesditjen · Dikecualikan')
        expect(within(tersamar).queryByRole('link')).toBeNull()
        expect(tersamar.textContent).not.toMatch(/undefined|null/)
        expect(screen.getByText('+3 surat lain dalam rangkaian ini')).toBeVisible()
        const tombol = screen.getByRole('button', { name: 'Buka rangkaian' })
        expect(tombol).toHaveAttribute('aria-expanded', 'false')
        fireEvent.click(tombol)
        expect(onToggle).toHaveBeenCalledTimes(1)
    })

    it('merender panel di tempat hanya ketika terbuka', () => {
        mount({ kelompok: kelompokRangkaian, terbuka: true, onToggle: vi.fn(), children: <section aria-label="Panel Alur Surat">panel</section> })
        expect(screen.getByRole('button', { name: 'Tutup rangkaian' })).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByRole('region', { name: 'Panel Alur Surat' })).toBeVisible()
    })

    it('surat tunggal: tanpa tombol ekspansi, dengan tahun dan tautan detail', () => {
        mount({ kelompok: { kunci: 'surat:sm-1', skor: 100, tanggalTerbaru: '2023-01-05', rangkaian: null,
            cocok: [{ jenis: 'surat_masuk', id: 'sm-1', nomorSurat: 'SK-01/DJ-PTPP', perihal: 'Penetapan 2023', tahun: 2023, skor: 100 }],
            pratinjau: [], jumlahAnggota: 1, pratinjauTerpotong: false } })
        expect(screen.getByText('Surat tunggal')).toBeVisible()
        expect(screen.getByText('Tahun 2023')).toBeVisible()
        expect(screen.getByRole('link', { name: 'Buka detail surat' })).toHaveAttribute('href', '/surat/masuk/sm-1')
        expect(screen.queryByRole('button', { name: 'Buka rangkaian' })).toBeNull()
    })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `(cd frontend && npx vitest run src/components/lacak/LacakKelompokCard.test.jsx)`
Expected: FAIL, karena `Failed to resolve import "./LacakKelompokCard"`.

- [ ] **Step 3: Implementasi minimal**

```jsx
// frontend/src/components/lacak/LacakKelompokCard.jsx
import { Link } from 'react-router-dom'
import { ChevronDown, EyeOff, Mail, Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { LABEL_JENIS_SURAT, LABEL_RELASI, LABEL_STATUS_RANGKAIAN } from '@/lib/lacak-labels'

const ruteSurat = node => (node.jenis === 'surat_masuk' ? `/surat/masuk/${node.id}` : `/surat/keluar/${node.id}`)

function NodePratinjau({ node }) {
    if (node.masked) {
        return (
            <li data-masked="true" className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                <EyeOff className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{LABEL_JENIS_SURAT[node.jenis] ?? 'Surat'} · {node.unitNama} · {node.label}</span>
                {node.dapatAjukanAkses && <span className="text-xs sm:ml-auto">Ajukan akses dari panel Alur Surat</span>}
            </li>
        )
    }
    const Icon = node.jenis === 'surat_masuk' ? Mail : Send
    return (
        <li className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {node.relasi && <Badge variant="outline">{LABEL_RELASI[node.relasi] ?? node.relasi}</Badge>}
            <Link to={ruteSurat(node)} className="font-mono text-xs underline-offset-2 hover:underline">{node.nomorSurat || 'Tanpa nomor'}</Link>
            <span className="min-w-0 flex-1 truncate">{node.perihal || 'Tanpa perihal'}</span>
            <span className="text-xs text-muted-foreground">{node.naskah ? `${node.naskah} · ` : ''}{node.unitNama} · {node.tahun}</span>
        </li>
    )
}

export function LacakKelompokCard({ kelompok, terbuka = false, onToggle, children }) {
    const { rangkaian, cocok = [], pratinjau = [], jumlahAnggota = 0, pratinjauTerpotong = false } = kelompok
    const utama = cocok[0]
    const judulId = `lacak-${String(kelompok.kunci).replace(/[^a-zA-Z0-9-]/g, '-')}`
    const sisa = Math.max(0, jumlahAnggota - pratinjau.length)

    return (
        <Card aria-labelledby={judulId}>
            <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                        {rangkaian ? (
                            <>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge>{rangkaian.kode}</Badge>
                                    <Badge variant="secondary">{LABEL_STATUS_RANGKAIAN[rangkaian.status] ?? rangkaian.status}</Badge>
                                    <span className="text-xs text-muted-foreground">Tahun {rangkaian.tahun}</span>
                                </div>
                                <h2 id={judulId} className="text-base font-semibold">{rangkaian.judul}</h2>
                            </>
                        ) : (
                            <>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant="outline">Surat tunggal</Badge>
                                    {utama && <span className="text-xs text-muted-foreground">Tahun {utama.tahun}</span>}
                                </div>
                                <h2 id={judulId} className="text-base font-semibold">{utama?.nomorSurat || 'Tanpa nomor'}</h2>
                                {utama?.perihal && <p className="text-sm text-muted-foreground">{utama.perihal}</p>}
                            </>
                        )}
                    </div>
                    {rangkaian ? (
                        <Button type="button" variant="outline" size="sm" aria-expanded={terbuka} onClick={onToggle}>
                            <ChevronDown className={`h-4 w-4 transition-transform ${terbuka ? 'rotate-180' : ''}`} aria-hidden="true" />
                            {terbuka ? 'Tutup rangkaian' : 'Buka rangkaian'}
                        </Button>
                    ) : utama ? (
                        <Button asChild variant="outline" size="sm">
                            <Link to={ruteSurat(utama)}>Buka detail surat</Link>
                        </Button>
                    ) : null}
                </div>
                {pratinjau.length > 0 && (
                    <ol className="space-y-1.5" aria-label={`Pratinjau ${rangkaian ? rangkaian.kode : 'surat'}`}>
                        {pratinjau.map((node, index) => (
                            <NodePratinjau key={node.anggotaId ?? `${node.jenis}-${node.id ?? index}`} node={node} />
                        ))}
                    </ol>
                )}
                {pratinjauTerpotong && sisa > 0 && (
                    <p className="text-xs text-muted-foreground">+{sisa} surat lain dalam rangkaian ini</p>
                )}
                {terbuka && children}
            </CardContent>
        </Card>
    )
}
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `(cd frontend && npx vitest run src/components/lacak/LacakKelompokCard.test.jsx && npx eslint src/components/lacak/LacakKelompokCard.jsx)`
Expected: PASS (3 tes) dan ESLint bersih.

- [ ] **Step 5: Commit**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
git add frontend/src/components/lacak/LacakKelompokCard.jsx frontend/src/components/lacak/LacakKelompokCard.test.jsx
git commit -F - <<'EOF'
feat(lacak): kartu kelompok rangkaian dengan pratinjau node dan penyamaran

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---


#### Amandemen pra-eksekusi Task 11 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p4-lacak-surat/preflight-rulings.md`.


1. **Component edits (BLOCKING, carry-forward FR:35) [P4-T11-1, P4-T11-2] RECHECK-AFTER-P3.** In the `LacakKelompokCard.jsx` block:
   - After `const utama = cocok[0]`, add:
     ```jsx
         // Surat tunggal: tautan detail hanya bila node P3 (mode baca, checkMany) tidak tersamar (FR:35, P3 T4-3).
         const nodeTunggal = rangkaian ? null : pratinjau[0]
         const detailTerbuka = Boolean(utama) && nodeTunggal?.masked === false
     ```
   - Change `<Card aria-labelledby={judulId}>` to `<Card role="group" aria-labelledby={judulId}>`.
   - Change the single-surat branch condition `) : utama ? (` to `) : detailTerbuka ? (`.
   - Replace `{pratinjau.length > 0 && (` with:
     ```jsx
                     {!rangkaian && nodeTunggal?.masked && (
                         <p data-masked="true" className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                             <EyeOff className="h-4 w-4 shrink-0" aria-hidden="true" />
                             <span>{LABEL_JENIS_SURAT[nodeTunggal.jenis] ?? 'Surat'} · {nodeTunggal.unitNama} · {nodeTunggal.label}</span>
                         </p>
                     )}
                     {rangkaian && pratinjau.length > 0 && (
     ```
2. **Tests (BLOCKING) [P4-T11-1].**
   - In the test "surat tunggal: tanpa tombol ekspansi, dengan tahun dan tautan detail", replace `pratinjau: [], jumlahAnggota: 1, pratinjauTerpotong: false } })` with the real P3 shape:
     ```jsx
                 pratinjau: [{ anggotaId: null, jenis: 'surat_masuk', id: 'sm-1', nomorSurat: 'SK-01/DJ-PTPP', perihal: 'Penetapan 2023', tanggalSurat: '2023-01-05', tahun: 2023, naskah: null, unitKerjaId: 'sesditjen', unitNama: 'Sesditjen', relasi: null, masked: false }],
                 jumlahAnggota: 1, pratinjauTerpotong: false } })
     ```
     Append `expect(screen.getAllByText('SK-01/DJ-PTPP')).toHaveLength(1)` to that test.
   - Add:
     ```jsx
         it('surat tunggal tersamar (mode baca): judul dari cocok tetap, tanpa tautan detail', () => {
             mount({ kelompok: { kunci: 'surat:sm-2', skor: 90, tanggalTerbaru: '2026-09-01', rangkaian: null,
                 cocok: [{ jenis: 'surat_masuk', id: 'sm-2', nomorSurat: 'T-2/2026', perihal: 'Terbatas tanpa grant', tahun: 2026, skor: 90 }],
                 pratinjau: [{ anggotaId: null, jenis: 'surat_masuk', unitNama: 'Sesditjen', label: 'Dikecualikan', masked: true, dapatAjukanAkses: false }],
                 jumlahAnggota: 1, pratinjauTerpotong: false } })
             expect(screen.getByRole('heading', { name: 'T-2/2026' })).toBeVisible()
             expect(screen.queryByRole('link', { name: 'Buka detail surat' })).toBeNull()
             expect(screen.getByText('Surat masuk · Sesditjen · Dikecualikan')).toBeVisible()
         })
     ```
   - Step 4 Expected: PASS (4 tests) and ESLint clean. Both were verified in scratch.
   - **(delta P3) Confirmed shapes** from real `lacak.service.ts` @ b4d86fa:
     - Readable tunggal node: `muatTunggal` :106-110 = `{ anggotaId: null, jenis, id, nomorSurat, perihal, tanggalSurat, tahun, naskah, unitKerjaId, unitNama, relasi: null, masked: false }`. This is exactly the amended fixture.
     - Masked tunggal node: :184 = `{ anggotaId: null, jenis, unitNama, label: 'Dikecualikan', masked: true, dapatAjukanAkses: false }`.
   - **(delta P3) In flux (A-I3).** A rangkaian group for which a non-penuh reader can read no member is emitted in the tunggal form: `rangkaian: null`, `kunci: 'surat:<cocok[0].id>'`, pratinjau from `cocok[0]`. The amended card already handles it through `rangkaian === null`; no extra code is needed.



### Task 12: Tab Berkas Rangkaian (`BerkasRangkaianTab`)

**Files:**
- Create: `frontend/src/components/lacak/BerkasRangkaianTab.jsx`
- Test: `frontend/src/components/lacak/BerkasRangkaianTab.test.jsx`

**Interfaces:**
- Consumes (Task 9): `rangkaianService.list`, `rangkaianService.unitKerjaOpsi`
- Consumes (repo): `usePaginatedResource(fetchPage, { queryKey, pageSize })` dari `hooks/use-paginated-resource.js:4` (termasuk `resource.reload`), `ResourcePagination`
- Produces: `BerkasRangkaianTab()` (named export) di `frontend/src/components/lacak/BerkasRangkaianTab.jsx`. Filter terdiri dari unit pengolah, status, dan asal. Data lama tersembunyi secara default.
- Batas kepemilikan: aksi **Tutup massal data lama** (pratinjau → konfirmasi + `expectedCount`) **tidak** dibangun di P4. P5 Task 10 menyisipkan komponen `TutupMassalDataLama` ke berkas ini (saat filter asal `data_lama`) dengan kontrak endpoint P5.

- [ ] **Step 1: Tulis tes yang gagal**

```jsx
// frontend/src/components/lacak/BerkasRangkaianTab.test.jsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ list: vi.fn(), unitKerjaOpsi: vi.fn() }))
vi.mock('@/services/rangkaian.service', () => ({ default: mocks, rangkaianService: mocks }))
import { BerkasRangkaianTab } from './BerkasRangkaianTab'

const R1 = '11111111-1111-4111-8111-111111111111'
const baris = { id: R1, kode: 'RS-2026-000001', status: 'diberkaskan', asal: 'surat_masuk', tahun: 2026, judul: 'Undangan rapat anggaran',
    unitPencatat: { id: 'sesditjen', nama: 'Sesditjen' }, unitPengolah: { id: 'dir_bppt', nama: 'Dit. BPPT' }, jumlahAnggota: 3,
    selesaiAt: '2026-09-01T00:00:00Z', diberkaskanAt: '2026-09-02T00:00:00Z' }
const respons = (rows, aksi = []) => ({ success: true, data: rows, pagination: { page: 1, limit: 20, total: rows.length, totalPages: 1 }, meta: { aksiDiizinkan: aksi } })
const mount = () => render(<MemoryRouter><BerkasRangkaianTab /></MemoryRouter>)

beforeEach(() => {
    vi.clearAllMocks()
    mocks.list.mockResolvedValue(respons([baris]))
    mocks.unitKerjaOpsi.mockResolvedValue([{ id: 'dir_bppt', name: 'Dit. BPPT' }])
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Tab Berkas Rangkaian', () => {
    it('memuat daftar tanpa data lama secara default dan menautkan kode ke Lacak', async () => {
        mount()
        expect(await screen.findByRole('link', { name: 'RS-2026-000001' })).toHaveAttribute('href', `/surat/lacak?rangkaian=${R1}`)
        expect(mocks.list).toHaveBeenCalledWith({ unitPengolahId: undefined, status: undefined, asal: undefined, page: 1, limit: 20 })
        expect(screen.getByLabelText('Asal')).toHaveValue('')
        expect(screen.getByRole('option', { name: 'Semua (tanpa data lama)' })).toBeInTheDocument()
        expect(screen.getByText('Dit. BPPT', { selector: 'td' })).toBeVisible()
        expect(screen.queryByRole('button', { name: 'Tutup massal data lama' })).toBeNull()
    })

    it('meneruskan filter status dan unit pengolah ke server', async () => {
        mount()
        await screen.findByRole('link', { name: 'RS-2026-000001' })
        await screen.findByRole('option', { name: 'Dit. BPPT' })
        fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'diberkaskan' } })
        await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'diberkaskan', page: 1 })))
        fireEvent.change(screen.getByLabelText('Unit pengolah'), { target: { value: 'dir_bppt' } })
        await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'diberkaskan', unitPengolahId: 'dir_bppt' })))
    })

    it('filter asal data lama meminta server secara eksplisit tanpa aksi mutasi (Tutup massal milik P5)', async () => {
        mount()
        await screen.findByRole('link', { name: 'RS-2026-000001' })
        fireEvent.change(screen.getByLabelText('Asal'), { target: { value: 'data_lama' } })
        await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ asal: 'data_lama' })))
        await screen.findByRole('link', { name: 'RS-2026-000001' })
        expect(screen.queryByRole('button', { name: /Tutup massal/ })).toBeNull()
    })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `(cd frontend && npx vitest run src/components/lacak/BerkasRangkaianTab.test.jsx)`
Expected: FAIL, karena `Failed to resolve import "./BerkasRangkaianTab"`.

- [ ] **Step 3: Implementasi minimal**

```jsx
// frontend/src/components/lacak/BerkasRangkaianTab.jsx
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { ResourcePagination } from '@/components/ResourcePagination'
import { usePaginatedResource } from '@/hooks/use-paginated-resource'
import rangkaianService from '@/services/rangkaian.service'
import { LABEL_STATUS_RANGKAIAN } from '@/lib/lacak-labels'
import { lacakHref } from '@/lib/lacak-link'

const OPSI_ASAL = [['', 'Semua (tanpa data lama)'], ['surat_masuk', 'Surat masuk'], ['inisiatif', 'Inisiatif'], ['data_lama', 'Data lama']]
const OPSI_STATUS = [['', 'Semua status'], ['aktif', 'Aktif'], ['selesai', 'Selesai'], ['diberkaskan', 'Diberkaskan']]
const KELAS_SELECT = 'h-10 rounded-md border bg-background px-3 text-sm'

const tanggal = value => (value ? new Date(value).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')

export function BerkasRangkaianTab() {
    const [filter, setFilter] = useState({ unitPengolahId: '', status: '', asal: '' })
    const [unitOpsi, setUnitOpsi] = useState([])

    useEffect(() => {
        let aktif = true
        rangkaianService.unitKerjaOpsi()
            .then(rows => { if (aktif) setUnitOpsi(rows) })
            .catch(() => { if (aktif) setUnitOpsi([]) })
        return () => { aktif = false }
    }, [])

    const fetchPage = useCallback(({ page, limit }) => rangkaianService.list({
        unitPengolahId: filter.unitPengolahId || undefined,
        status: filter.status || undefined,
        asal: filter.asal || undefined,
        page,
        limit,
    }), [filter])
    const resource = usePaginatedResource(fetchPage, { queryKey: JSON.stringify(filter), pageSize: 20 })
    const ubah = kunci => event => setFilter(previous => ({ ...previous, [kunci]: event.target.value }))

    return (
        <section aria-label="Berkas Rangkaian" className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                    <label htmlFor="berkas-unit" className="text-sm font-medium">Unit pengolah</label>
                    <select id="berkas-unit" className={KELAS_SELECT} value={filter.unitPengolahId} onChange={ubah('unitPengolahId')}>
                        <option value="">Semua unit</option>
                        {unitOpsi.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                    </select>
                </div>
                <div className="flex flex-col gap-1">
                    <label htmlFor="berkas-status" className="text-sm font-medium">Status</label>
                    <select id="berkas-status" className={KELAS_SELECT} value={filter.status} onChange={ubah('status')}>
                        {OPSI_STATUS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                </div>
                <div className="flex flex-col gap-1">
                    <label htmlFor="berkas-asal" className="text-sm font-medium">Asal</label>
                    <select id="berkas-asal" className={KELAS_SELECT} value={filter.asal} onChange={ubah('asal')}>
                        {OPSI_ASAL.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                </div>
            </div>

            <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[720px] text-sm">
                    <thead className="bg-muted/50 text-left">
                        <tr>
                            <th scope="col" className="px-3 py-2">Kode</th>
                            <th scope="col" className="px-3 py-2">Judul</th>
                            <th scope="col" className="px-3 py-2">Status</th>
                            <th scope="col" className="px-3 py-2">Unit pengolah</th>
                            <th scope="col" className="px-3 py-2">Tahun</th>
                            <th scope="col" className="px-3 py-2">Anggota</th>
                            <th scope="col" className="px-3 py-2">Diberkaskan</th>
                        </tr>
                    </thead>
                    <tbody>
                        {resource.rows.map(row => (
                            <tr key={row.id} className="border-t">
                                <td className="px-3 py-2 font-mono text-xs">
                                    <Link to={lacakHref({ rangkaianId: row.id })} className="underline-offset-2 hover:underline">{row.kode}</Link>
                                </td>
                                <td className="px-3 py-2">{row.judul}</td>
                                <td className="px-3 py-2"><Badge variant="secondary">{LABEL_STATUS_RANGKAIAN[row.status] ?? row.status}</Badge></td>
                                <td className="px-3 py-2">{row.unitPengolah?.nama ?? '—'}</td>
                                <td className="px-3 py-2">{row.tahun}</td>
                                <td className="px-3 py-2">{row.jumlahAnggota}</td>
                                <td className="px-3 py-2">{tanggal(row.diberkaskanAt)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {!resource.loading && !resource.error && resource.rows.length === 0 && (
                    <p role="status" className="p-4 text-sm text-muted-foreground">Belum ada rangkaian untuk filter ini.</p>
                )}
            </div>
            <ResourcePagination resource={resource} label="berkas rangkaian" />
        </section>
    )
}
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `(cd frontend && npx vitest run src/components/lacak/BerkasRangkaianTab.test.jsx && npx eslint src/components/lacak/BerkasRangkaianTab.jsx)`
Expected: PASS (3 tes) dan ESLint bersih.

- [ ] **Step 5: Commit**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
git add frontend/src/components/lacak/BerkasRangkaianTab.jsx frontend/src/components/lacak/BerkasRangkaianTab.test.jsx
git commit -F - <<'EOF'
feat(lacak): tab Berkas Rangkaian dengan filter unit pengolah, status, dan asal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---


#### Amandemen pra-eksekusi Task 12 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p4-lacak-surat/preflight-rulings.md`.


1. **Link gating (BLOCKING, carry-forward FR:35) [P4-T12-1].**
   - In `BerkasRangkaianTab.jsx`, replace the kode cell's `<Link …>{row.kode}</Link>` with:
     ```jsx
                                         {row.dapatDibuka
                                             ? <Link to={lacakHref({ rangkaianId: row.id })} className="underline-offset-2 hover:underline">{row.kode}</Link>
                                             : <span title="Rangkaian ini tidak dapat Anda buka">{row.kode}</span>}
     ```
   - Tests: add `dapatDibuka: true` to the fixture `baris`, then add:
     ```jsx
         it('kode rangkaian yang tidak dapat dibuka (dapatDibuka:false) tampil tanpa tautan', async () => {
             mocks.list.mockResolvedValue(respons([{ ...baris, dapatDibuka: false, judul: 'Rangkaian RS-2026-000001 (Dikecualikan)' }]))
             mount()
             expect(await screen.findByText('RS-2026-000001')).toBeVisible()
             expect(screen.queryByRole('link', { name: 'RS-2026-000001' })).toBeNull()
         })
     ```
   - Step 4 Expected: PASS (4 tests) and ESLint clean (verified). This edit does not move the P5 Task 10 anchor `<div className="overflow-x-auto rounded-md border">`.
2. **Error/loading (ADVISORY, no change) [P4-T12-2].** Do not add an extra alert or loading line: `ResourcePagination` already renders both.



### Task 13: Halaman `LacakSurat.jsx` (input besar, kartu, ekspansi di tempat, dan sinkronisasi URL)

**Files:**
- Create: `frontend/src/pages/LacakSurat.jsx`
- Test: `frontend/src/pages/LacakSurat.test.jsx`

**Interfaces:**
- Consumes (Task 10): `useLacakSearch` (hook tunggal P3 yang diperluas; `@/hooks/use-lacak-search`)
- Consumes (Task 11): `LacakKelompokCard`
- Consumes (Task 12): `BerkasRangkaianTab`
- Consumes (P2 + Task 9): `AlurSuratPanel` dengan prop `rangkaianId` (ditambahkan Task 9), yang memuat `GET /api/rangkaian/:id` sendiri
- Consumes (repo): `PageHeader`, `Tabs/TabsList/TabsTrigger/TabsContent`, `Input`, `Button`, `useSearchParams`
- Produces: default export `LacakSurat`. Parameter URL:
  - `?q=`: diganti dengan `replace` setiap ketikan, dan input mengikuti perubahan luar
  - `?rangkaian=`: kartu yang terbuka; auto-open untuk satu kelompok **tidak** menulis URL
  - `?tab=berkas`: tab Berkas Rangkaian

- [ ] **Step 1: Tulis tes yang gagal**

```jsx
// frontend/src/pages/LacakSurat.test.jsx
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ lacak: vi.fn() }))
vi.mock('@/services/rangkaian.service', () => ({ default: mocks, rangkaianService: mocks }))
vi.mock('@/components/surat/AlurSuratPanel', () => {
    const Panel = ({ rangkaianId }) => <section aria-label="Panel Alur Surat">{rangkaianId}</section>
    return { default: Panel, AlurSuratPanel: Panel }
})
vi.mock('@/components/lacak/BerkasRangkaianTab', () => ({ BerkasRangkaianTab: () => <p>Isi tab berkas</p> }))
import LacakSurat from './LacakSurat'

const R1 = '11111111-1111-4111-8111-111111111111'
const R2 = '22222222-2222-4222-8222-222222222222'
const kartu = (id, kode) => ({
    kunci: id, skor: 100, tanggalTerbaru: '2025-01-20',
    rangkaian: { id, kode, status: 'aktif', judul: `Judul ${kode}`, tahun: 2025, asal: 'inisiatif' },
    cocok: [], pratinjau: [], jumlahAnggota: 1, pratinjauTerpotong: false,
})
const hasil = (q, kelompok) => ({ q, mode: 'lacak', jenisKueri: 'nomor', kelompok })
function deferred() { let resolve; const promise = new Promise(res => { resolve = res }); return { promise, resolve } }

let router
function mount(url = '/surat/lacak') {
    router = createMemoryRouter([
        { path: '/surat/lacak', element: <LacakSurat /> },
        { path: '/surat/:jenis/:id', element: <p>Detail</p> },
    ], { initialEntries: [url] })
    render(<RouterProvider router={router} />)
}
const input = () => screen.getByRole('searchbox', { name: 'Nomor surat atau perihal' })
const ketik = value => fireEvent.change(input(), { target: { value } })
const maju = async ms => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const panel = () => screen.queryByRole('region', { name: 'Panel Alur Surat' })

beforeEach(() => {
    vi.useFakeTimers()
    mocks.lacak.mockReset()
    mocks.lacak.mockImplementation(async ({ q }) => hasil(q, [kartu(R1, 'RS-2025-000001'), kartu(R2, 'RS-2024-000002')]))
})
afterEach(() => { cleanup(); router?.dispose(); vi.useRealTimers() })

describe('Halaman Lacak Surat', () => {
    it('menunda pencarian 300 ms, menyinkronkan ?q= dengan replace, dan mengirim satu permintaan', async () => {
        mount()
        ketik('B-1')
        ketik('B-12')
        ketik('B-12/PTPP')
        expect(router.state.location.search).toBe('?q=B-12%2FPTPP')
        expect(router.state.historyAction).toBe('REPLACE')
        await maju(299)
        expect(mocks.lacak).not.toHaveBeenCalled()
        await maju(1)
        expect(mocks.lacak).toHaveBeenCalledTimes(1)
        expect(mocks.lacak.mock.calls[0][0]).toEqual({ q: 'B-12/PTPP', mode: 'lacak', tahun: undefined })
        expect(screen.getByRole('heading', { name: 'Judul RS-2025-000001' })).toBeVisible()
        expect(panel()).toBeNull()
    })

    it('membatalkan permintaan sebelumnya ketika kueri berubah dan mengabaikan hasil basi', async () => {
        const lama = deferred()
        mocks.lacak.mockImplementationOnce(() => lama.promise)
            .mockImplementation(async ({ q }) => hasil(q, [kartu(R2, 'RS-2024-000002')]))
        mount()
        ketik('rapat')
        await maju(300)
        const sinyalLama = mocks.lacak.mock.calls[0][1].signal
        ketik('rapat koordinasi')
        expect(sinyalLama.aborted).toBe(true)
        await maju(300)
        await act(async () => { lama.resolve(hasil('rapat', [kartu(R1, 'RS-2025-000001')])) })
        expect(screen.queryByText('RS-2025-000001')).toBeNull()
        expect(screen.getByText('RS-2024-000002')).toBeVisible()
    })

    it('membuka langsung bila hanya satu kelompok tanpa menulis URL; menutupnya tidak membuka ulang', async () => {
        mocks.lacak.mockResolvedValue(hasil('SK-01', [kartu(R1, 'RS-2025-000001')]))
        mount('/surat/lacak?q=SK-01')
        expect(input()).toHaveValue('SK-01')
        await maju(300)
        expect(panel()).toHaveTextContent(R1)
        expect(router.state.location.search).toBe('?q=SK-01')
        fireEvent.click(screen.getByRole('button', { name: 'Tutup rangkaian' }))
        expect(panel()).toBeNull()
        expect(screen.getByRole('button', { name: 'Buka rangkaian' })).toHaveAttribute('aria-expanded', 'false')
    })

    it('tautan ?rangkaian= membuka kartu itu; tombol Buka/Tutup memperbarui URL', async () => {
        mount(`/surat/lacak?q=rapat&rangkaian=${R2}`)
        await maju(300)
        expect(panel()).toHaveTextContent(R2)
        fireEvent.click(screen.getByRole('button', { name: 'Buka rangkaian' }))
        expect(new URLSearchParams(router.state.location.search).get('rangkaian')).toBe(R1)
        expect(panel()).toHaveTextContent(R1)
        fireEvent.click(screen.getByRole('button', { name: 'Tutup rangkaian' }))
        expect(new URLSearchParams(router.state.location.search).get('rangkaian')).toBeNull()
        expect(panel()).toBeNull()
    })

    it('tautan ?rangkaian= tanpa kueri tetap menampilkan panelnya', async () => {
        mount(`/surat/lacak?rangkaian=${R1}`)
        expect(panel()).toHaveTextContent(R1)
        await maju(1000)
        expect(mocks.lacak).not.toHaveBeenCalled()
    })

    it('mengikuti navigasi luar (Back/GlobalSearch) yang mengganti ?q=', async () => {
        mocks.lacak.mockImplementation(async ({ q }) => hasil(q, []))
        mount('/surat/lacak?q=rapat')
        await maju(300)
        await act(async () => { await router.navigate('/surat/lacak?q=PTPP.1') })
        expect(input()).toHaveValue('PTPP.1')
        await maju(300)
        expect(mocks.lacak).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'PTPP.1' }), expect.anything())
        expect(screen.getByText('Tidak ada surat yang cocok dengan “PTPP.1” dalam jangkauan Anda.')).toBeVisible()
    })

    it('menampilkan petunjuk minimal 3 karakter, galat, dan Coba lagi', async () => {
        mocks.lacak.mockRejectedValueOnce(new Error('Terlalu banyak permintaan. Coba lagi nanti.'))
        mount()
        ketik('ab')
        expect(screen.getByText(/Ketik minimal 3 karakter/)).toBeVisible()
        ketik('rapat')
        await maju(300)
        expect(screen.getByRole('alert')).toHaveTextContent('Terlalu banyak permintaan. Coba lagi nanti.')
        fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
        await maju(300)
        expect(screen.getByRole('heading', { name: 'Judul RS-2025-000001' })).toBeVisible()
    })

    it('tab Berkas Rangkaian lewat ?tab=berkas', () => {
        mount('/surat/lacak?tab=berkas')
        expect(screen.getByText('Isi tab berkas')).toBeVisible()
        expect(screen.getByRole('tab', { name: 'Berkas Rangkaian' })).toHaveAttribute('aria-selected', 'true')
    })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `(cd frontend && npx vitest run src/pages/LacakSurat.test.jsx)`
Expected: FAIL, karena `Failed to resolve import "./LacakSurat"`.

- [ ] **Step 3: Implementasi minimal**

```jsx
// frontend/src/pages/LacakSurat.jsx
import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { GitBranch, Loader2, Search } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import AlurSuratPanel from '@/components/surat/AlurSuratPanel'
import { LacakKelompokCard } from '@/components/lacak/LacakKelompokCard'
import { BerkasRangkaianTab } from '@/components/lacak/BerkasRangkaianTab'
import { useLacakSearch } from '@/hooks/use-lacak-search'
import { LACAK_MAX_CHARS, LACAK_MIN_CHARS } from '@/lib/lacak-cache'

const TAHUN_SEKARANG = new Date().getFullYear()
const PILIHAN_TAHUN = Array.from({ length: 10 }, (_, index) => String(TAHUN_SEKARANG - index))

export default function LacakSurat() {
    const [searchParams, setSearchParams] = useSearchParams()
    const urlQ = searchParams.get('q') ?? ''
    const rangkaianParam = searchParams.get('rangkaian') ?? ''
    const tab = searchParams.get('tab') === 'berkas' ? 'berkas' : 'lacak'
    const [input, setInput] = useState(urlQ)
    const [urlQTerakhir, setUrlQTerakhir] = useState(urlQ)
    const [tahun, setTahun] = useState('')
    const [ditutupUntuk, setDitutupUntuk] = useState(null)

    // Navigasi luar (Back, tautan GlobalSearch) mengganti ?q=; input mengikutinya tanpa efek.
    if (urlQ !== urlQTerakhir) {
        setUrlQTerakhir(urlQ)
        setInput(urlQ)
    }

    const lacak = useLacakSearch(input, { tahun })
    const kelompok = lacak.status === 'success' ? lacak.data?.kelompok ?? [] : []
    const satuRangkaian = kelompok.length === 1 && kelompok[0].rangkaian ? kelompok[0].rangkaian.id : ''
    const otomatis = satuRangkaian && ditutupUntuk !== lacak.q ? satuRangkaian : ''
    const rangkaianTerbuka = rangkaianParam || otomatis
    const terbukaDiHasil = kelompok.some(item => item.rangkaian?.id === rangkaianTerbuka)

    const ubahParam = useCallback(ubah => {
        setSearchParams(previous => {
            const next = new URLSearchParams(previous)
            ubah(next)
            return next
        }, { replace: true })
    }, [setSearchParams])

    const onInput = value => {
        const qUrl = value.trim() ? value : ''
        setInput(value)
        setUrlQTerakhir(qUrl)
        ubahParam(next => {
            if (qUrl) next.set('q', qUrl)
            else next.delete('q')
            next.delete('rangkaian')
        })
    }

    const toggle = id => {
        if (rangkaianTerbuka === id) {
            if (rangkaianParam === id) ubahParam(next => next.delete('rangkaian'))
            setDitutupUntuk(lacak.q)
        } else {
            ubahParam(next => next.set('rangkaian', id))
        }
    }

    const ubahTab = value => ubahParam(next => {
        if (value === 'berkas') next.set('tab', 'berkas')
        else next.delete('tab')
    })

    return (
        <div className="space-y-5">
            <PageHeader
                icon={GitBranch}
                title="Lacak Surat"
                description="Telusuri surat masuk dan keluar beserta rangkaian tindak lanjutnya dalam satu pencarian."
            />
            <Tabs value={tab} onValueChange={ubahTab}>
                <TabsList>
                    <TabsTrigger value="lacak">Lacak</TabsTrigger>
                    <TabsTrigger value="berkas">Berkas Rangkaian</TabsTrigger>
                </TabsList>

                <TabsContent value="lacak" className="space-y-4">
                    <form role="search" aria-label="Lacak surat" onSubmit={event => event.preventDefault()} className="flex flex-col gap-2 sm:flex-row">
                        <div className="relative flex-1">
                            <label htmlFor="lacak-q" className="sr-only">Nomor surat atau perihal</label>
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                            <Input
                                id="lacak-q"
                                type="search"
                                value={input}
                                onChange={event => onInput(event.target.value)}
                                placeholder="Nomor surat (mis. B-12/PTPP.1/IX/2024) atau kata dalam perihal"
                                aria-describedby="lacak-bantuan"
                                aria-busy={lacak.status === 'loading'}
                                className="h-12 pl-10 text-base"
                            />
                        </div>
                        <label htmlFor="lacak-tahun" className="sr-only">Tahun</label>
                        <select id="lacak-tahun" value={tahun} onChange={event => setTahun(event.target.value)} className="h-12 rounded-md border bg-background px-3 text-sm">
                            <option value="">Semua tahun</option>
                            {PILIHAN_TAHUN.map(value => <option key={value} value={value}>{value}</option>)}
                        </select>
                    </form>
                    <p id="lacak-bantuan" className="text-sm text-muted-foreground">
                        Ketik minimal {LACAK_MIN_CHARS} karakter. Hasil dikelompokkan per rangkaian; surat yang tidak boleh Anda baca tampil sebagai “Dikecualikan”.
                    </p>

                    {rangkaianParam && !terbukaDiHasil && (
                        <section aria-label="Rangkaian terpilih" className="space-y-2">
                            <AlurSuratPanel rangkaianId={rangkaianParam} />
                        </section>
                    )}

                    {lacak.status === 'invalid' && (
                        <p role="alert" className="text-sm text-destructive">Kata kunci maksimal {LACAK_MAX_CHARS} karakter.</p>
                    )}
                    {lacak.status === 'loading' && (
                        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Mencari…
                        </p>
                    )}
                    {lacak.status === 'error' && (
                        <div role="alert" className="space-y-2 rounded-md border border-destructive/40 p-4 text-sm">
                            <p className="text-destructive">{lacak.error?.message || 'Pencarian gagal. Periksa koneksi lalu coba lagi.'}</p>
                            <Button type="button" variant="outline" size="sm" onClick={lacak.retry}>Coba lagi</Button>
                        </div>
                    )}
                    {lacak.status === 'success' && kelompok.length === 0 && (
                        <p role="status" className="text-sm text-muted-foreground">
                            Tidak ada surat yang cocok dengan “{lacak.q}” dalam jangkauan Anda.
                        </p>
                    )}
                    {kelompok.length > 0 && (
                        <>
                            <p role="status" className="sr-only">{kelompok.length} hasil ditemukan.</p>
                            <ol aria-label="Hasil lacak surat" className="space-y-3">
                                {kelompok.map(item => {
                                    const terbuka = Boolean(item.rangkaian) && item.rangkaian.id === rangkaianTerbuka
                                    return (
                                        <li key={item.kunci}>
                                            <LacakKelompokCard kelompok={item} terbuka={terbuka} onToggle={() => toggle(item.rangkaian.id)}>
                                                {terbuka && <AlurSuratPanel rangkaianId={item.rangkaian.id} />}
                                            </LacakKelompokCard>
                                        </li>
                                    )
                                })}
                            </ol>
                        </>
                    )}
                </TabsContent>

                <TabsContent value="berkas">
                    <BerkasRangkaianTab />
                </TabsContent>
            </Tabs>
        </div>
    )
}
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `(cd frontend && npx vitest run src/pages/LacakSurat.test.jsx && npx eslint src/pages/LacakSurat.jsx)`
Expected: PASS (8 tes) dan ESLint bersih.

- [ ] **Step 5: Commit**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
git add frontend/src/pages/LacakSurat.jsx frontend/src/pages/LacakSurat.test.jsx
git commit -F - <<'EOF'
feat(lacak): halaman Lacak Surat dengan ekspansi di tempat dan sinkronisasi URL

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---


#### Amandemen pra-eksekusi Task 13 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p4-lacak-surat/preflight-rulings.md`.


1. **Panel refresh (ADVISORY) [P4-T10-4].** If `refresh` exists in Task 10, pass `onChanged={lacak.refresh}` to both `<AlurSuratPanel …/>` usages, and add a test in which the panel mock calls `onChanged` and a second `lacak` request follows.
2. **Stable panel during reload (ADVISORY) [P4-T13-1].** To avoid remounting an open panel on each debounced query, keep the last settled list while loading. The pattern below sets state during render, which is lint-clean and is the pattern the page already uses for `urlQTerakhir`:
   ```jsx
       const [hasilTerakhir, setHasilTerakhir] = useState(null)
       if (lacak.status === 'success' && lacak.data !== hasilTerakhir) setHasilTerakhir(lacak.data)
       const sumber = lacak.status === 'success' ? lacak.data : lacak.status === 'loading' ? hasilTerakhir : null
       const kelompok = sumber?.kelompok ?? []
   ```
   With this, `aria-busy` on the list reflects loading. If adopted, add a test in which two queries resolving to the same single group mount the panel mock once. Implement it only if Task 10 keeps P3's semantics consistent (see P4-T10-2).
3. **Under-3 test (ADVISORY) [P4-T13-2].** In "menampilkan petunjuk minimal 3 karakter, galat, dan Coba lagi", after `ketik('ab')` add `await maju(1000); expect(mocks.lacak).not.toHaveBeenCalled()`.


**C-2 (critic) — Task 13: do not render stale result cards during loading (changes Task 13 item 2) — ADVISORY [P4-C-2]**


- With C-1, `lacak.data` is null while loading, by P3 decision 986e7b5. Re-introducing the previous list at page level (`hasilTerakhir`, Task 13 item 2) renders clickable stale cards, which is the defect P3 just fixed.
- Binding: never render stale cards while `lacak.status === 'loading'`. To avoid panel remounts and duplicate `view_via_rangkaian` audits, keep only an already open panel mounted:
  - render the "Rangkaian terpilih" section from `?rangkaian=` (URL state) outside the result list, keyed by rangkaian id;
  - do not render a second panel for the same rangkaian inside its card while it is open.
- Test: with `?rangkaian=R` open, typing two debounced queries mounts the panel mock once.
- Task 13 item 1 (`refresh`) is unaffected.



### Task 14: Route `/surat/lacak`, entri sidebar, dan breadcrumbs

**Files:**
- Modify: `frontend/src/App.jsx:23-63` (lazy import) dan `:243-250` (route)
- Modify: `frontend/src/components/app-sidebar.jsx:3-29` (impor ikon) dan `:83-86` (sub-item grup Surat)
- Modify: `frontend/src/components/breadcrumbs.jsx:4-28` (`routeNameMap`)
- Test: `frontend/src/App.lacak-route.test.jsx` (baru), `frontend/src/components/app-sidebar.groups.test.jsx`, `frontend/src/components/breadcrumbs.test.jsx`

**Interfaces:**
- Consumes (repo): `RoleGuard`, `ALL_PROVISIONED_ROLES` (`App.jsx:100-108,149`), `PROVISIONED_ROLES` (`lib/provisioning-access.js`)
- Consumes (Task 13): default export `LacakSurat`
- Produces: route `/surat/lacak` untuk semua role terprovisi, sub-item sidebar **Lacak Surat** (`/surat/lacak`) di grup Surat, dan label breadcrumb **Lacak Surat**

- [ ] **Step 1: Tulis tes yang gagal**

```jsx
// frontend/src/App.lacak-route.test.jsx
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ router: null, user: { role: 'staff', unitKerjaId: 'dir_bppt' } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ loading: false, isAuthenticated: true, user: state.user }) }))
vi.mock('react-router-dom', async importOriginal => {
    const actual = await importOriginal()
    return { ...actual, createBrowserRouter: routes => {
        state.router = actual.createMemoryRouter(routes, { initialEntries: ['/surat/lacak?q=B-12'] })
        return state.router
    } }
})
vi.mock('@/components/ui/sidebar', () => ({ SidebarProvider: ({ children }) => <div>{children}</div>, SidebarInset: ({ children }) => <div>{children}</div> }))
vi.mock('@/components/app-sidebar', () => ({ AppSidebar: () => null }))
vi.mock('@/components/app-header', () => ({ AppHeader: () => null }))
vi.mock('@/components/AppServiceNotice', () => ({ AppServiceNotice: () => null }))
vi.mock('@/components/ui/toaster', () => ({ Toaster: () => null }))
vi.mock('@/components/OfflineIndicator', () => ({ OfflineIndicator: () => null }))
vi.mock('@/components/IdleWarningBanner', () => ({ IdleWarningBanner: () => null }))
vi.mock('@/pages/Login', () => ({ default: () => <h1>Login</h1> }))
vi.mock('@/pages/NotFound', () => ({ default: () => <h1>Halaman tidak ditemukan</h1> }))
vi.mock('@/pages/LacakSurat', () => ({ default: () => <h1>Lacak Surat</h1> }))
import App from './App'

beforeEach(async () => { await act(async () => { await state.router.navigate('/surat/lacak?q=B-12') }) })
afterEach(cleanup)

describe('route /surat/lacak', () => {
    it.each(['staff', 'auditor', 'admin_unit', 'admin_sesditjen', 'super_admin'])('terbuka untuk role terprovisi %s', async role => {
        state.user = { role, unitKerjaId: role === 'super_admin' || role === 'admin_sesditjen' ? null : 'dir_bppt' }
        render(<App />)
        expect(await screen.findByRole('heading', { name: 'Lacak Surat' })).toBeVisible()
        expect(state.router.state.location.search).toBe('?q=B-12')
        expect(screen.queryByText('Halaman tidak ditemukan')).toBeNull()
    })
})
```

Tambahkan di akhir blok `describe('sidebar task groups', …)` pada `frontend/src/components/app-sidebar.groups.test.jsx`:

```jsx
    it('menawarkan Lacak Surat di grup Surat untuk setiap role terprovisi', () => {
        for (const role of ['staff', 'auditor', 'admin_unit', 'super_admin']) {
            state.role = role
            const { unmount } = show({ route: '/surat/lacak' })
            const link = screen.getByRole('link', { name: 'Lacak Surat' })
            expect(link).toHaveAttribute('href', '/surat/lacak')
            expect(link).toHaveAttribute('aria-current', 'page')
            expect(screen.getByRole('link', { name: 'Surat Masuk', exact: true })).not.toHaveAttribute('aria-current')
            unmount()
        }
    })
```

Tambahkan di akhir `describe('breadcrumb destinations', …)` pada `frontend/src/components/breadcrumbs.test.jsx`:

```jsx
    it('menamai halaman Lacak Surat tanpa tautan perantara yang rusak', () => {
        mount('/surat/lacak')
        expect(screen.getByText('Lacak Surat')).toBeVisible()
        expect(screen.queryByRole('link', { name: 'Surat', exact: true })).not.toBeInTheDocument()
    })
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `(cd frontend && npx vitest run src/App.lacak-route.test.jsx src/components/app-sidebar.groups.test.jsx src/components/breadcrumbs.test.jsx)`
Expected: FAIL. Route merender "Halaman tidak ditemukan", link "Lacak Surat" tidak ada, dan breadcrumb menampilkan "lacak" (bukan "Lacak Surat").

- [ ] **Step 3: Implementasi minimal**

Di `frontend/src/App.jsx`, tambahkan setelah baris `const SuratKeluar = lazy(() => import('@/pages/SuratKeluar'))`:

```jsx
const LacakSurat = lazy(() => import('@/pages/LacakSurat'))
```

Lalu tambahkan route setelah baris `{ path: "/surat/keluar/edit/:id", … }`:

```jsx
      { path: "/surat/lacak", element: <RoleGuard allowedRoles={ALL_PROVISIONED_ROLES}><LacakSurat /></RoleGuard> },
```

Di `frontend/src/components/app-sidebar.jsx`, tambahkan `Search,` ke daftar impor `lucide-react` (setelah `Settings2,`). Ubah `subItems` item "Surat" menjadi:

```jsx
                subItems: [
                    { title: 'Surat Masuk', url: '/surat/masuk', icon: MailOpen },
                    { title: 'Surat Keluar', url: '/surat/keluar', icon: Send },
                    { title: 'Lacak Surat', url: '/surat/lacak', icon: Search },
                ],
```

Di `frontend/src/components/breadcrumbs.jsx`, tambahkan entri berikut setelah `'keluar': 'Keluar',` pada `routeNameMap`:

```js
    'lacak': 'Lacak Surat',
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `(cd frontend && npx vitest run src/App.lacak-route.test.jsx src/components/app-sidebar.groups.test.jsx src/components/breadcrumbs.test.jsx src/App.storage-qr-route.test.jsx src/App.pending-access.test.jsx)`
Expected: PASS, termasuk tes lama sidebar/breadcrumbs/App.

- [ ] **Step 5: Commit**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
git add frontend/src/App.jsx frontend/src/App.lacak-route.test.jsx frontend/src/components/app-sidebar.jsx frontend/src/components/app-sidebar.groups.test.jsx frontend/src/components/breadcrumbs.jsx frontend/src/components/breadcrumbs.test.jsx
git commit -F - <<'EOF'
feat(lacak): route /surat/lacak, entri sidebar Lacak Surat, dan breadcrumb

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---


#### Amandemen pra-eksekusi Task 14 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p4-lacak-surat/preflight-rulings.md`.


1. **Anchors (ADVISORY) [P4-T14-1] RECHECK-AFTER-P3.** The files are CRLF, so anchor on text, not bytes. After P3 adds the `/surat/keluar/inisiatif` route next to the edit route (P3:9067), insert the Lacak route after the `surat/keluar/:id/edit` route object, whatever follows it. No other change.
   - **(delta P3) Corrected path.** The edit route is `{ path: "/surat/keluar/edit/:id", … }` (`App.jsx:251`), exactly as the plan text at P4:3038 says; `surat/keluar/:id/edit` does not exist. P3 placed `/surat/keluar/inisiatif` at :249, before `/surat/keluar/:id` (:250), so the P4 anchor is unaffected. `const SuratKeluar = lazy(…)` is at :25. The sidebar "Surat" `subItems` are at `app-sidebar.jsx:83-86` and unchanged by P3.



### Task 15: GlobalSearch, aksi "Lihat rangkaian" tanpa request tambahan

**Files:**
- Modify: `frontend/src/components/GlobalSearch.jsx` (keseluruhan file, 249 baris)
- Test: `frontend/src/components/GlobalSearch.lacak.test.jsx`

**Interfaces:**
- Consumes (Task 8): `lacakHref`, `lacakQueryForResult`, `LACAK_MIN_CHARS`
- Consumes (repo): `searchService.search(q, { limit: 10 })` dengan hasil `{ type, id, title, subtitle, excerpt }` (`global-search.service.ts:261-265,334-338`)
- Produces:
  - Tombol **Lihat rangkaian** (`aria-label="Lihat rangkaian untuk <title>"`) di setiap hasil `surat_masuk`/`surat_keluar`
  - Shift+Enter pada opsi terpilih melakukan hal yang sama
  - Tombol **Lacak rangkaian “q”** saat `query.trim().length ≥ 3`
  - Semua aksi hanya menavigasi ke `/surat/lacak?q=…` dan menutup dialog, tanpa memanggil API

- [ ] **Step 1: Tulis tes yang gagal**

```jsx
// frontend/src/components/GlobalSearch.lacak.test.jsx
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ search: vi.fn(), apiGet: vi.fn(), lacak: vi.fn(), onOpenChange: vi.fn() }))
vi.mock('@/services/search.service', () => ({ default: { search: mocks.search } }))
vi.mock('@/services/api', () => ({ default: { get: mocks.apiGet }, api: { get: mocks.apiGet } }))
vi.mock('@/services/rangkaian.service', () => ({ default: { lacak: mocks.lacak }, rangkaianService: { lacak: mocks.lacak } }))
import { GlobalSearch } from './GlobalSearch'

const hasilPencarian = {
    counts: { surat_masuk: 1, surat_keluar: 1, arsip: 1, dosir: 0, total: 3 },
    results: [
        { type: 'surat_masuk', id: 'sm-1', title: 'B-12/PTPP.1/IX/2024', subtitle: 'Kanwil Jawa Barat', excerpt: 'Undangan rapat koordinasi' },
        { type: 'surat_keluar', id: 'sk-1', title: 'SK-7/2026', subtitle: 'Kepala Kantor', excerpt: 'Penjelasan Keputusan Nomor 5' },
        { type: 'arsip', id: 'ar-1', title: 'ARS-1', subtitle: '000.1', excerpt: 'Arsip' },
    ],
}
let router

beforeEach(() => {
    vi.clearAllMocks()
    mocks.search.mockResolvedValue(hasilPencarian)
    Element.prototype.scrollIntoView = vi.fn()
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { cleanup(); router?.dispose(); vi.unstubAllGlobals(); vi.useRealTimers() })

async function bukaDanCari(q) {
    router = createMemoryRouter([
        { path: '/', element: <GlobalSearch open onOpenChange={mocks.onOpenChange} /> },
        { path: '/surat/lacak', element: <h1>Halaman Lacak</h1> },
        { path: '/surat/masuk/:id', element: <h1>Detail surat masuk</h1> },
    ])
    render(<RouterProvider router={router} />)
    vi.useFakeTimers()
    fireEvent.change(screen.getByRole('combobox', { name: 'Cari surat, arsip, dan dosir' }), { target: { value: q } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    vi.useRealTimers()
    await screen.findByRole('option', { name: /B-12\/PTPP\.1\/IX\/2024/ })
}
const qDiUrl = () => new URLSearchParams(router.state.location.search).get('q')
const tanpaRequestTambahan = () => {
    expect(mocks.search).toHaveBeenCalledTimes(1)
    expect(mocks.apiGet).not.toHaveBeenCalled()
    expect(mocks.lacak).not.toHaveBeenCalled()
}

describe('GlobalSearch → Lacak Surat', () => {
    it('Lihat rangkaian pada hasil surat membuka /surat/lacak?q=<nomor> tanpa permintaan tambahan', async () => {
        await bukaDanCari('B-12')
        fireEvent.click(screen.getByRole('button', { name: 'Lihat rangkaian untuk B-12/PTPP.1/IX/2024' }))
        expect(mocks.onOpenChange).toHaveBeenCalledWith(false)
        expect(router.state.location.pathname).toBe('/surat/lacak')
        expect(qDiUrl()).toBe('B-12/PTPP.1/IX/2024')
        tanpaRequestTambahan()
    })

    it('judul cadangan SK-n/yyyy memakai perihal sebagai kueri', async () => {
        await bukaDanCari('B-12')
        fireEvent.click(screen.getByRole('button', { name: 'Lihat rangkaian untuk SK-7/2026' }))
        expect(qDiUrl()).toBe('Penjelasan Keputusan Nomor 5')
        tanpaRequestTambahan()
    })

    it('hasil arsip tidak mendapat aksi Lihat rangkaian', async () => {
        await bukaDanCari('B-12')
        expect(screen.queryByRole('button', { name: 'Lihat rangkaian untuk ARS-1' })).toBeNull()
    })

    it('Shift+Enter melacak opsi terpilih, Enter tetap membuka detail', async () => {
        await bukaDanCari('B-12')
        const combobox = screen.getByRole('combobox', { name: 'Cari surat, arsip, dan dosir' })
        fireEvent.keyDown(combobox, { key: 'Enter', shiftKey: true })
        expect(router.state.location.pathname).toBe('/surat/lacak')
        expect(qDiUrl()).toBe('B-12/PTPP.1/IX/2024')
        tanpaRequestTambahan()
    })

    it('Enter tanpa Shift tetap ke detail surat', async () => {
        await bukaDanCari('B-12')
        fireEvent.keyDown(screen.getByRole('combobox', { name: 'Cari surat, arsip, dan dosir' }), { key: 'Enter' })
        expect(router.state.location.pathname).toBe('/surat/masuk/sm-1')
    })

    it('item Lacak rangkaian “q” meneruskan kueri yang diketik', async () => {
        await bukaDanCari('B-12')
        fireEvent.click(screen.getByRole('button', { name: 'Lacak rangkaian “B-12”' }))
        expect(router.state.location.pathname).toBe('/surat/lacak')
        expect(qDiUrl()).toBe('B-12')
        tanpaRequestTambahan()
    })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `(cd frontend && npx vitest run src/components/GlobalSearch.lacak.test.jsx)`
Expected: FAIL, karena tombol `Lihat rangkaian untuk B-12/PTPP.1/IX/2024` tidak ditemukan.

- [ ] **Step 3: Implementasi minimal**

Ganti seluruh isi `frontend/src/components/GlobalSearch.jsx` dengan:

```jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, FileText, Mail, Send, Archive, Folder, Loader2, GitBranch } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import searchService from '@/services/search.service';
import { lacakHref, lacakQueryForResult } from '@/lib/lacak-link';
import { LACAK_MIN_CHARS } from '@/lib/lacak-cache';

// Type icons mapping
const TYPE_ICONS = {
    surat_masuk: Mail,
    surat_keluar: Send,
    arsip: Archive,
    dosir: Folder
};

const TYPE_LABELS = {
    surat_masuk: 'Surat Masuk',
    surat_keluar: 'Surat Keluar',
    arsip: 'Arsip',
    dosir: 'Dosir'
};

const TYPE_COLORS = {
    surat_masuk: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    surat_keluar: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    arsip: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
    dosir: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300'
};

// Hanya surat yang dapat menjadi anggota Rangkaian Surat.
const LACAK_TYPES = new Set(['surat_masuk', 'surat_keluar']);

export function GlobalSearch({ open, onOpenChange }) {
    const navigate = useNavigate();
    const inputRef = useRef(null);
    const searchSequenceRef = useRef(0);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);
    const [searchError, setSearchError] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Focus input when dialog opens
    useEffect(() => {
        if (open) {
            searchSequenceRef.current += 1;
            setTimeout(() => inputRef.current?.focus(), 100);
            setQuery('');
            setResults(null);
            setLoading(false);
            setSearchError('');
            setSelectedIndex(0);
        }
    }, [open]);

    // Debounced search
    const doSearch = useCallback(async (searchQuery) => {
        const normalizedQuery = searchQuery.trim();
        if (normalizedQuery.length < 2) {
            searchSequenceRef.current += 1;
            setResults(null);
            setLoading(false);
            setSearchError('');
            return;
        }

        const requestSequence = ++searchSequenceRef.current;
        setResults(null);
        setSelectedIndex(0);
        setSearchError('');
        setLoading(true);
        try {
            const data = await searchService.search(normalizedQuery, { limit: 10 });
            if (requestSequence === searchSequenceRef.current) {
                setResults(data);
            }
        } catch (error) {
            if (requestSequence === searchSequenceRef.current) {
                console.error('Search error:', error);
                setSearchError('Pencarian gagal. Periksa koneksi lalu coba lagi.');
            }
        } finally {
            if (requestSequence === searchSequenceRef.current) {
                setLoading(false);
            }
        }
    }, []);

    // Debounce input
    useEffect(() => {
        const timer = setTimeout(() => {
            doSearch(query);
        }, 300);
        return () => clearTimeout(timer);
    }, [query, doSearch]);

    // Navigate to result
    const handleSelect = (result) => {
        onOpenChange(false);

        const routes = {
            surat_masuk: `/surat/masuk/${result.id}`,
            surat_keluar: `/surat/keluar/${result.id}`,
            arsip: `/arsip/detail/${result.id}`,
            dosir: `/dosir/${result.id}`
        };

        navigate(routes[result.type] || '/');
    };

    // Lacak hanya bernavigasi; halaman Lacak yang melakukan pencarian (§6: Ctrl+K tidak menambah request).
    const openLacak = (q) => {
        if (!q) return;
        onOpenChange(false);
        navigate(lacakHref({ q }));
    };
    const lacakQueryFor = (result) => (LACAK_TYPES.has(result?.type) ? lacakQueryForResult(result) : '');
    const trimmedQuery = query.trim();

    // Keyboard navigation
    const handleKeyDown = (e) => {
        if (loading || !results?.results?.length) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(i => Math.min(i + 1, results.results.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const result = results.results[selectedIndex];
            if (e.shiftKey) {
                openLacak(lacakQueryFor(result));
                return;
            }
            handleSelect(result);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px] p-0 gap-0 overflow-hidden">
                <DialogTitle className="sr-only">Pencarian Global</DialogTitle>

                {/* Search Input */}
                <div className="flex items-center border-b px-3">
                    <Search className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                    <Input
                        id="global-search-input"
                        ref={inputRef}
                        type="search"
                        role="combobox"
                        aria-label="Cari surat, arsip, dan dosir"
                        aria-autocomplete="list"
                        aria-expanded={Boolean(results?.results?.length)}
                        aria-controls="global-search-results"
                        aria-activedescendant={results?.results?.length ? `global-search-option-${selectedIndex}` : undefined}
                        aria-busy={loading}
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setSearchError('');
                        }}
                        onKeyDown={handleKeyDown}
                        placeholder="Cari surat, arsip, dosir..."
                        className="border-0 focus-visible:ring-0 h-12"
                    />
                    {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
                    {query && !loading && (
                        <Button type="button" variant="ghost" size="icon" onClick={() => setQuery('')} aria-label="Hapus pencarian">
                            <X className="h-4 w-4" />
                        </Button>
                    )}
                </div>

                {/* Results */}
                <ScrollArea className="max-h-[400px]">
                    {results && (
                        <div className="p-2">
                            {/* Counts */}
                            <div className="flex flex-wrap gap-2 px-2 py-1 mb-2" role="status" aria-live="polite">
                                <span className="sr-only">{results.counts.total || results.results.length} hasil ditemukan.</span>
                                {Object.entries(results.counts).filter(([k, v]) => k !== 'total' && v > 0).map(([type, count]) => (
                                    <Badge key={type} variant="secondary" className={TYPE_COLORS[type]}>
                                        {TYPE_LABELS[type]}: {count}
                                    </Badge>
                                ))}
                            </div>

                            {/* Result List */}
                            {results.results.length > 0 ? (
                                <div id="global-search-results" className="space-y-1" role="listbox" aria-label="Hasil pencarian">
                                    {results.results.map((result, index) => {
                                        const Icon = TYPE_ICONS[result.type] || FileText;
                                        const lacakQuery = lacakQueryFor(result);
                                        return (
                                            <div key={`${result.type}-${result.id}`} role="presentation" className="flex items-stretch gap-1">
                                                <button
                                                    id={`global-search-option-${index}`}
                                                    type="button"
                                                    role="option"
                                                    aria-selected={index === selectedIndex}
                                                    onClick={() => handleSelect(result)}
                                                    onMouseEnter={() => setSelectedIndex(index)}
                                                    className={`min-w-0 flex-1 text-left px-3 py-2 rounded-lg flex items-start gap-3 transition-colors ${index === selectedIndex
                                                            ? 'bg-accent text-accent-foreground'
                                                            : 'hover:bg-muted'
                                                        }`}
                                                >
                                                    <div className={`p-2 rounded-md ${TYPE_COLORS[result.type]}`}>
                                                        <Icon className="h-4 w-4" />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="font-medium truncate">{result.title}</div>
                                                        <div className="text-sm text-muted-foreground truncate">
                                                            {result.excerpt}
                                                        </div>
                                                        <div className="text-xs text-muted-foreground mt-1">
                                                            {TYPE_LABELS[result.type]} • {result.subtitle}
                                                        </div>
                                                    </div>
                                                </button>
                                                {lacakQuery && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        tabIndex={-1}
                                                        className="h-auto shrink-0 self-stretch"
                                                        aria-label={`Lihat rangkaian untuk ${result.title}`}
                                                        title="Lihat rangkaian (Shift+Enter)"
                                                        onClick={() => openLacak(lacakQuery)}
                                                    >
                                                        <GitBranch className="h-4 w-4" aria-hidden="true" />
                                                        <span className="hidden sm:inline">Lihat rangkaian</span>
                                                    </Button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : query.length >= 2 ? (
                                <div className="text-center py-8 text-muted-foreground" role="status">
                                    Tidak ada hasil untuk "{query}"
                                </div>
                            ) : null}
                        </div>
                    )}

                    {searchError && !loading && (
                        <div role="alert" className="flex flex-col items-center gap-3 px-6 py-8 text-center">
                            <p className="text-sm text-destructive">{searchError}</p>
                            <Button type="button" variant="outline" size="sm" onClick={() => doSearch(query)}>
                                Coba lagi
                            </Button>
                        </div>
                    )}

                    {/* Empty State */}
                    {!results && !searchError && query.length < 2 && (
                        <div className="text-center py-8 text-muted-foreground">
                            <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p>Ketik minimal 2 karakter untuk mencari</p>
                            <p className="text-xs mt-1">Telusuri surat masuk, surat keluar, arsip, dan dosir</p>
                        </div>
                    )}
                </ScrollArea>

                {trimmedQuery.length >= LACAK_MIN_CHARS && (
                    <div className="border-t p-1">
                        <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => openLacak(trimmedQuery)}>
                            <GitBranch className="h-4 w-4" aria-hidden="true" />
                            Lacak rangkaian “{trimmedQuery}”
                        </Button>
                    </div>
                )}

                {/* Footer hints */}
                <div className="border-t px-3 py-2 text-xs text-muted-foreground flex items-center justify-between">
                    <span>↑↓ Navigasi • Enter Pilih • Shift+Enter Lihat rangkaian • Esc Tutup</span>
                    <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">Ctrl K</kbd>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export default GlobalSearch;
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `(cd frontend && npx vitest run src/components/GlobalSearch.lacak.test.jsx && npx eslint src/components/GlobalSearch.jsx)`
Expected: PASS (6 tes) dan ESLint bersih.

- [ ] **Step 5: Commit**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
git add frontend/src/components/GlobalSearch.jsx frontend/src/components/GlobalSearch.lacak.test.jsx
git commit -F - <<'EOF'
feat(lacak): aksi Lihat rangkaian di GlobalSearch tanpa request tambahan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---


#### Amandemen pra-eksekusi Task 15 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p4-lacak-surat/preflight-rulings.md`.


1. **Listbox a11y (ADVISORY) [P4-T15-1].** Keep Shift+Enter. Move the per-result "Lihat rangkaian" `<Button>` out of the `role="listbox"` element into one action row below the listbox, bound to the active option; alternatively keep it inside the option and describe it with `aria-describedby`. Update every `GlobalSearch.lacak.test.jsx` query that finds the button inside the listbox.



### Task 16: Layanan Perlu Dilengkapi (`perluDilengkapiService`) — enam kategori, penyamaran, dan data lama (D7)

Task 16–21 menambahkan keputusan **D7** (2026-09-27, spec §7 "Perlu Dilengkapi"). Task ini menyiapkan satu kueri `UNION ALL` dengan enam cabang kategori. Kueri yang sama dipakai untuk daftar maupun ringkasan, sehingga angka badge tidak mungkin menyimpang dari isi tab.

**Files:**
- Create: `backend/src/services/perlu-dilengkapi.constants.ts`
- Create: `backend/src/services/perlu-dilengkapi.service.ts`
- Create: `backend/src/__tests__/perlu-dilengkapi.integration.test.ts`
- Modify: `backend/src/services/rangkaian-daftar.service.ts` (Task 5: fungsi privat `lingkupSql` dan blok impor `visibility-spec`)

**Interfaces:**
- Consumes (P2, `visibility-spec.ts`):
  - `visibleSql(ctx, target, mode: 'read' | 'list')`
  - `jangkauanRekamanSql(ctx, type, alias)`
  - `kecocokanUnitRekaman(user)` dan `cocokUnitRekamanSql(match, unitCol)`
  - `dalamCakupanPengawas(unit)` dan `dalamCakupanPengawasSql(unitCol)`
  - `resolveKonteksBaca(user, executor)`, `barisDari`
  - tipe `KonteksBaca`, `TargetVisibilitas`, `PelaksanaSql`
- Consumes (P2, `record-access.service.ts`): `recordAccessService.checkRead`, khusus uji paritas
- Consumes (P3): `computeSuratAksi(role, ctx: SuratAksiContext)` dan `computeRangkaianAksi(ctx: RangkaianAksiContext)` dari `services/rangkaian/aksi.ts`; `isFullAdmin(user)` dari `services/rangkaian/roles.ts`
- Consumes (P1): tipe `RangkaianStatus` dari `services/rangkaian-status.ts`
- Consumes (repo): `jakartaDate()` (`utils/jakarta-date.ts`)
- Consumes (Task 3–5): helper `lacak-pglite.ts`, `judulRangkaianTampil`, dan lingkup rangkaian Task 5 (diekspor di task ini)
- Produces:
  - `KATEGORI_PERLU_DILENGKAPI = ['sm_belum_ditindaklanjuti', 'disposisi_terbuka', 'sk_tanpa_nd_penjelas', 'tindak_lanjut_tertahan', 'siap_diberkaskan', 'sk_tanpa_asal'] as const` dan `type KategoriPerluDilengkapi` (`perlu-dilengkapi.constants.ts`, tanpa impor; di-re-export oleh layanan)
  - `type PerluDilengkapiAksi = 'tindak_lanjut' | 'disposisi' | 'buka_kotak_disposisi' | 'buat_nd_penjelas' | 'buka_surat' | 'berkaskan' | 'tandai_inisiatif' | 'tautkan'`
  - `type PerluDilengkapiFilter = { kategori?: KategoriPerluDilengkapi; tampilkanDataLama: boolean; page: number; limit: number }`
  - `type PenggunaPerluDilengkapi = { id: string; role: string; unitKerjaId: string | null; email?: string; name?: string | null }`
  - `interface PerluDilengkapiItem`. Baris tersamar hanya punya kunci `aksiDiizinkan, dataLama, disposisi, jenis, kategori, kunci, label, masked, rangkaian, surat, unitNama`, dengan `surat` dan `rangkaian` bernilai `null`:
    ```ts
    {
      kunci: string;
      kategori: KategoriPerluDilengkapi;
      masked: boolean;
      label?: 'Dikecualikan';
      jenis: 'surat_masuk' | 'surat_keluar' | 'rangkaian';
      unitNama: string;
      surat: { jenis; id; nomorSurat; perihal; tanggalSurat; naskahDinas; dari; kepada; sifatSurat; unitKerjaId; approvalStatus } | null;
      rangkaian: { id; kode; status; judul; unitPencatatId; unitPengolahId; unitPengolahNama } | null;
      disposisi: { id; status; targetUnitNama; batasWaktu; lewatBatas } | null;
      dataLama: boolean;
      aksiDiizinkan: PerluDilengkapiAksi[];
    }
    ```
  - `perluDilengkapiService.list(user: PenggunaPerluDilengkapi, filter: PerluDilengkapiFilter): Promise<{ data: PerluDilengkapiItem[]; pagination: { page; limit; total; totalPages }; meta: { batasDataLama: string; tampilkanDataLama: boolean } }>`
  - `perluDilengkapiService.ringkasan(user: PenggunaPerluDilengkapi, filter: { tampilkanDataLama: boolean }): Promise<{ perKategori: Record<KategoriPerluDilengkapi, number>; total: number; lewatBatas: number; batasDataLama: string }>`
  - `ENV_BATAS_DATA_LAMA = 'RANGKAIAN_DATA_LAMA_SEBELUM'` dan `resolveBatasDataLama(executor?: PelaksanaSql, env?: NodeJS.ProcessEnv): Promise<string>` (ISO UTC)
  - `lingkupRangkaianSql(ctx: KonteksBaca, alias = 'r'): SQL` diekspor dari `rangkaian-daftar.service.ts`. Perilaku `rangkaianDaftarService.list` tidak berubah.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
// backend/src/__tests__/perlu-dilengkapi.integration.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema';
import type { KategoriPerluDilengkapi } from '../services/perlu-dilengkapi.constants';
import {
    createMigratedPglite, insertDisposisi, insertRangkaian, insertRelasi, insertSuratKeluar, insertSuratMasuk, insertUser,
    resetRangkaianFixture, seedUnits, uid, type PenggunaUji,
} from './helpers/lacak-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ db: holder.db }));

let database: PGlite;
let svc: typeof import('../services/perlu-dilengkapi.service');
let access: typeof import('../services/record-access.service').recordAccessService;

const pengguna = {
    bppt: { id: uid(901), email: 'bppt@example.test', name: 'Admin BPPT', role: 'admin_unit', unitKerjaId: 'dir_bppt' },
    ptep: { id: uid(902), email: 'ptep@example.test', name: 'Admin PTEP', role: 'admin_unit', unitKerjaId: 'dir_ptep' },
    tu: { id: uid(903), email: 'tu@example.test', name: 'Admin TU', role: 'admin_unit', unitKerjaId: 'sesditjen' },
    staffTu: { id: uid(904), email: 'staff@example.test', name: 'Staff TU', role: 'staff', unitKerjaId: 'sesditjen' },
    superAdmin: { id: uid(906), email: 'super@example.test', name: 'Super Admin', role: 'super_admin', unitKerjaId: null },
} satisfies Record<string, PenggunaUji>;
type NamaPengguna = keyof typeof pengguna;

const BATAS = '2026-01-01T00:00:00+07:00';
const BATAS_UTC = '2025-12-31T17:00:00.000Z';
const LAMA = '2025-06-01 00:00:00';
const KOSONG: Record<KategoriPerluDilengkapi, number> = {
    sm_belum_ditindaklanjuti: 0, disposisi_terbuka: 0, sk_tanpa_nd_penjelas: 0,
    tindak_lanjut_tertahan: 0, siap_diberkaskan: 0, sk_tanpa_asal: 0,
};
const id: Record<string, string> = {};

beforeAll(async () => {
    database = await createMigratedPglite();
    holder.db = drizzle(database, { schema });
    svc = await import('../services/perlu-dilengkapi.service');
    ({ recordAccessService: access } = await import('../services/record-access.service'));
}, 180_000);
afterAll(async () => { await database?.close(); });
afterEach(() => { vi.unstubAllEnvs(); });

beforeEach(async () => {
    vi.stubEnv('RANGKAIAN_DATA_LAMA_SEBELUM', BATAS);
    await resetRangkaianFixture(database);
    await seedUnits(database, [
        { id: 'ditjen', name: 'Ditjen PTPP', pengawas: true },
        { id: 'sesditjen', name: 'Sesditjen', pengawas: true },
        { id: 'dir_bppt', name: 'Dit. BPPT' },
        { id: 'dir_ptep', name: 'Dit. PTEP' },
    ]);
    for (const user of Object.values(pengguna)) await insertUser(database, user);

    // SM1: surat masuk TU tanpa disposisi dan tanpa balasan → sm_belum_ditindaklanjuti.
    id.SM1 = await insertSuratMasuk(database, { n: 1, unit: 'sesditjen', nomor: 'SM-1/2026', tanggal: '2026-09-01', perihal: 'Undangan rapat satu' });

    // SM2: disposisi `sent` ke BPPT (batas lewat) + ND9 draft BPPT → disposisi_terbuka + tindak_lanjut_tertahan.
    id.SM2 = await insertSuratMasuk(database, { n: 2, unit: 'sesditjen', nomor: 'SM-2/2026', tanggal: '2026-09-02', perihal: 'Permohonan data dua' });
    id.ND9 = await insertSuratKeluar(database, { n: 9, unit: 'dir_bppt', nomor: 'ND-9/2026', tanggal: '2026-09-09', perihal: 'Tindak lanjut permohonan data' });
    const r2 = await insertRangkaian(database, {
        n: 2, kode: 'RS-2026-000002', tahun: 2026, pencatat: 'sesditjen', pengolah: 'dir_bppt', judul: 'Permohonan data dua',
        anggota: [{ jenis: 'surat_masuk', id: id.SM2, peran: 'induk', unit: 'sesditjen' }, { jenis: 'surat_keluar', id: id.ND9, unit: 'dir_bppt' }],
    });
    id.R2 = r2.id;
    await insertRelasi(database, { rangkaianId: r2.id, dari: r2.anggota[1], ke: r2.anggota[0], jenis: 'tindak_lanjut' });
    await insertDisposisi(database, { suratMasukId: id.SM2, sumber: 'sesditjen', target: 'dir_bppt', status: 'sent', rangkaianId: r2.id });

    // SM3: surat Rahasia yang didisposisikan ke BPPT → disposisi_terbuka tersamar.
    id.SM3 = await insertSuratMasuk(database, { n: 3, unit: 'sesditjen', nomor: 'R-3/2026', tanggal: '2026-09-03', perihal: 'PERIHAL-RAHASIA-SM3', sifat: 'Rahasia' });
    const r3 = await insertRangkaian(database, {
        n: 3, kode: 'RS-2026-000003', tahun: 2026, pencatat: 'sesditjen', judul: 'PERIHAL-RAHASIA-SM3',
        anggota: [{ jenis: 'surat_masuk', id: id.SM3, peran: 'induk', unit: 'sesditjen' }],
    });
    id.R3 = r3.id;
    await insertDisposisi(database, { suratMasukId: id.SM3, sumber: 'sesditjen', target: 'dir_bppt', status: 'received', rangkaianId: r3.id });

    // SM4: surat lama tanpa rangkaian, dibuat sebelum batas → data lama.
    id.SM4 = await insertSuratMasuk(database, { n: 4, unit: 'sesditjen', nomor: 'SM-4/2025', tanggal: '2025-05-20', perihal: 'Surat lama empat' });

    // SM5: satu-satunya disposisinya ditolak PTEP → belum ditindaklanjuti; PTEP kehilangan jangkauan.
    id.SM5 = await insertSuratMasuk(database, { n: 5, unit: 'sesditjen', nomor: 'SM-5/2026', tanggal: '2026-09-05', perihal: 'Permohonan lima' });
    const r5 = await insertRangkaian(database, {
        n: 5, kode: 'RS-2026-000005', tahun: 2026, pencatat: 'sesditjen', judul: 'Permohonan lima',
        anggota: [{ jenis: 'surat_masuk', id: id.SM5, peran: 'induk', unit: 'sesditjen' }],
    });
    await insertDisposisi(database, { suratMasukId: id.SM5, sumber: 'sesditjen', target: 'dir_ptep', status: 'rejected', rangkaianId: r5.id });

    // SM6 + SK6: dibalas, disposisi processed, rangkaian selesai → siap_diberkaskan saja.
    id.SM6 = await insertSuratMasuk(database, { n: 6, unit: 'sesditjen', nomor: 'SM-6/2026', tanggal: '2026-09-06', perihal: 'Permohonan data enam' });
    id.SK6 = await insertSuratKeluar(database, { n: 61, unit: 'dir_bppt', nomor: 'ND-6/2026', tanggal: '2026-09-16', perihal: 'Jawaban permohonan enam' });
    const r6 = await insertRangkaian(database, {
        n: 6, kode: 'RS-2026-000006', tahun: 2026, pencatat: 'sesditjen', pengolah: 'dir_bppt', status: 'selesai', judul: 'Permohonan data enam',
        anggota: [{ jenis: 'surat_masuk', id: id.SM6, peran: 'induk', unit: 'sesditjen' }, { jenis: 'surat_keluar', id: id.SK6, unit: 'dir_bppt' }],
    });
    id.R6 = r6.id;
    await insertRelasi(database, { rangkaianId: r6.id, dari: r6.anggota[1], ke: r6.anggota[0], jenis: 'balasan' });
    await insertDisposisi(database, { suratMasukId: id.SM6, sumber: 'sesditjen', target: 'dir_bppt', status: 'received', rangkaianId: r6.id });

    // SK7: Keputusan approved tanpa ND penjelas → sk_tanpa_nd_penjelas. SK8 sudah dijelaskan ND8.
    id.SK7 = await insertSuratKeluar(database, { n: 7, unit: 'dir_bppt', nomor: 'KEP-7/2026', tanggal: '2026-09-07', naskah: 'Keputusan', perihal: 'Penetapan tim tujuh' });
    id.SK8 = await insertSuratKeluar(database, { n: 8, unit: 'dir_bppt', nomor: 'KEP-8/2026', tanggal: '2026-09-08', naskah: 'Keputusan', perihal: 'Penetapan tim delapan' });
    id.ND8 = await insertSuratKeluar(database, { n: 81, unit: 'dir_bppt', nomor: 'ND-8/2026', tanggal: '2026-09-18', perihal: 'Penjelasan Keputusan delapan' });
    const r8 = await insertRangkaian(database, {
        n: 8, kode: 'RS-2026-000008', tahun: 2026, asal: 'inisiatif', pencatat: 'dir_bppt', judul: 'Penetapan tim delapan',
        anggota: [{ jenis: 'surat_keluar', id: id.SK8, peran: 'induk', unit: 'dir_bppt' }, { jenis: 'surat_keluar', id: id.ND8, unit: 'dir_bppt' }],
    });
    await insertRelasi(database, { rangkaianId: r8.id, dari: r8.anggota[1], ke: r8.anggota[0], jenis: 'menjelaskan' });

    // SK10: surat keluar baru tanpa asal dan tanpa rangkaian → sk_tanpa_asal.
    id.SK10 = await insertSuratKeluar(database, { n: 10, unit: 'dir_bppt', nomor: 'ND-10/2026', tanggal: '2026-09-10', perihal: 'Undangan koordinasi sepuluh' });
    // SK11: surat keluar lama (klasifikasi NULL = Terbatas) tanpa asal → data lama.
    id.SK11 = await insertSuratKeluar(database, { n: 11, unit: 'dir_bppt', nomor: 'ND-11/2025', tanggal: '2025-05-11', perihal: 'Nota lama sebelas' });
    // SM12/R12: rangkaian data_lama berstatus selesai → siap_diberkaskan, tetapi data lama.
    id.SM12 = await insertSuratMasuk(database, { n: 12, unit: 'sesditjen', nomor: 'SM-12/2019', tanggal: '2019-03-01', perihal: 'Surat lama dua belas' });
    const r12 = await insertRangkaian(database, {
        n: 12, kode: 'RS-2019-000012', tahun: 2019, asal: 'data_lama', status: 'selesai', pencatat: 'sesditjen', judul: 'Surat lama dua belas',
        anggota: [{ jenis: 'surat_masuk', id: id.SM12, peran: 'induk', unit: 'sesditjen' }],
    });
    id.R12 = r12.id;
    // SK13: draf Keputusan → tidak masuk sk_tanpa_nd_penjelas.
    id.SK13 = await insertSuratKeluar(database, { n: 13, unit: 'dir_bppt', nomor: 'KEP-13/2026', tanggal: '2026-09-13', naskah: 'Keputusan', perihal: 'Draf penetapan' });

    await database.exec(`
        UPDATE surat_distributions SET batas_waktu = '2026-01-10' WHERE surat_masuk_id = '${id.SM2}';
        UPDATE surat_distributions SET status = 'processed', processed_at = now() WHERE surat_masuk_id = '${id.SM6}';
        UPDATE surat_keluar SET approval_status = 'draft' WHERE id IN ('${id.ND9}', '${id.SK13}');
        UPDATE surat_keluar SET asal_naskah = 'tindak_lanjut' WHERE id IN ('${id.ND9}', '${id.SK6}', '${id.ND8}');
        UPDATE surat_keluar SET asal_naskah = 'inisiatif' WHERE id IN ('${id.SK7}', '${id.SK8}', '${id.SK13}');
        UPDATE surat_keluar SET klasifikasi_keamanan = NULL, created_at = '${LAMA}' WHERE id = '${id.SK11}';
        UPDATE surat_masuk SET created_at = '${LAMA}' WHERE id IN ('${id.SM4}', '${id.SM12}');
    `);
});

const daftar = (nama: NamaPengguna, filter: Partial<{ kategori: KategoriPerluDilengkapi; tampilkanDataLama: boolean; page: number; limit: number }> = {}) =>
    svc.perluDilengkapiService.list(pengguna[nama], { tampilkanDataLama: false, page: 1, limit: 50, ...filter });

describe('Perlu Dilengkapi (D7) — cakupan §4', () => {
    it.each([
        ['bppt', { disposisi_terbuka: 2, sk_tanpa_nd_penjelas: 1, tindak_lanjut_tertahan: 1, siap_diberkaskan: 1, sk_tanpa_asal: 1 }, 6],
        ['tu', { sm_belum_ditindaklanjuti: 2, disposisi_terbuka: 2, sk_tanpa_nd_penjelas: 1, tindak_lanjut_tertahan: 1, siap_diberkaskan: 1, sk_tanpa_asal: 1 }, 8],
        ['ptep', {}, 0],
        ['staffTu', { sm_belum_ditindaklanjuti: 2, disposisi_terbuka: 2, siap_diberkaskan: 1 }, 5],
        ['superAdmin', { sm_belum_ditindaklanjuti: 2, disposisi_terbuka: 2, sk_tanpa_nd_penjelas: 1, tindak_lanjut_tertahan: 1, siap_diberkaskan: 1, sk_tanpa_asal: 1 }, 8],
    ] as const)('ringkasan %s: pengawas melihat semua direktorat, direktorat hanya milik/peserta, disposisi ditolak mencabut jangkauan', async (nama, per, total) => {
        const hasil = await svc.perluDilengkapiService.ringkasan(pengguna[nama], { tampilkanDataLama: false });
        expect(hasil.perKategori).toEqual({ ...KOSONG, ...per });
        expect(hasil.total).toBe(total);
        expect(hasil.lewatBatas).toBe(total === 0 ? 0 : 1);
        expect(hasil.batasDataLama).toBe(BATAS_UTC);
    });

    it('baris tersamar memakai placeholder standar: tanpa id, nomor, perihal, maupun rangkaian', async () => {
        const hasil = await daftar('bppt', { kategori: 'disposisi_terbuka' });
        const tersamar = hasil.data.filter(item => item.masked);
        expect(tersamar).toHaveLength(1);
        expect(Object.keys(tersamar[0]).sort()).toEqual(['aksiDiizinkan', 'dataLama', 'disposisi', 'jenis', 'kategori', 'kunci', 'label', 'masked', 'rangkaian', 'surat', 'unitNama']);
        expect(tersamar[0]).toMatchObject({
            kategori: 'disposisi_terbuka', label: 'Dikecualikan', jenis: 'surat_masuk', unitNama: 'Sesditjen', surat: null, rangkaian: null,
            disposisi: { status: 'received', targetUnitNama: 'Dit. BPPT', batasWaktu: null, lewatBatas: false },
            dataLama: false, aksiDiizinkan: ['buka_kotak_disposisi'],
        });
        const json = JSON.stringify(hasil);
        for (const bocoran of ['PERIHAL-RAHASIA-SM3', 'R-3/2026', id.SM3, id.R3, 'RS-2026-000003']) expect(json).not.toContain(bocoran);
    });

    it('data lama tersembunyi secara default, tampil dengan tampilkanDataLama, dan tetap tersamar bila kelas terkendali', async () => {
        expect((await daftar('tu')).data.some(item => item.dataLama)).toBe(false);
        const semua = await daftar('tu', { tampilkanDataLama: true });
        expect(semua.pagination.total).toBe(11);
        expect(semua.data.filter(item => item.dataLama).map(item => item.kategori).sort()).toEqual(['siap_diberkaskan', 'sk_tanpa_asal', 'sm_belum_ditindaklanjuti']);
        const skLama = semua.data.find(item => item.kategori === 'sk_tanpa_asal' && item.dataLama)!;
        expect(skLama).toMatchObject({ masked: true, label: 'Dikecualikan', surat: null, rangkaian: null, aksiDiizinkan: [] });
        expect(skLama.kunci).toMatch(/^sk_tanpa_asal:tersamar-\d+$/);
        const json = JSON.stringify(semua);
        expect(json).not.toContain('ND-11/2025');
        expect(json).not.toContain(id.SK11);
        expect(semua.data.find(item => item.kunci === `siap_diberkaskan:${id.R12}`)).toMatchObject({ dataLama: true, rangkaian: { kode: 'RS-2019-000012' } });
        expect((await svc.perluDilengkapiService.ringkasan(pengguna.tu, { tampilkanDataLama: true })).total).toBe(11);
    });

    it('aksiDiizinkan dihitung server dengan aturan P3 (computeSuratAksi/computeRangkaianAksi)', async () => {
        const aksi = async (nama: NamaPengguna, kunci: string, tampilkanDataLama = false) =>
            (await daftar(nama, { tampilkanDataLama })).data.find(item => item.kunci === kunci)?.aksiDiizinkan;
        expect(await aksi('tu', `sm_belum_ditindaklanjuti:${id.SM1}`)).toEqual(['buka_surat', 'disposisi', 'tindak_lanjut']);
        expect(await aksi('staffTu', `sm_belum_ditindaklanjuti:${id.SM1}`)).toEqual(['buka_surat']);
        expect(await aksi('bppt', `sk_tanpa_nd_penjelas:${id.SK7}`)).toEqual(['buat_nd_penjelas', 'buka_surat']);
        expect(await aksi('bppt', `sk_tanpa_asal:${id.SK10}`)).toEqual(['buka_surat', 'tandai_inisiatif', 'tautkan']);
        expect(await aksi('tu', `sk_tanpa_asal:${id.SK10}`)).toEqual(['buka_surat']);
        expect(await aksi('bppt', `sk_tanpa_asal:${id.SK11}`, true)).toEqual(['tandai_inisiatif']);
        expect(await aksi('bppt', `siap_diberkaskan:${id.R6}`)).toEqual(['berkaskan']);
        expect(await aksi('staffTu', `siap_diberkaskan:${id.R6}`)).toEqual([]);
        expect(await aksi('bppt', `tindak_lanjut_tertahan:${id.ND9}`)).toEqual(['buka_surat']);
        const disposisiSm2 = (await daftar('bppt', { kategori: 'disposisi_terbuka' })).data.find(item => item.surat?.id === id.SM2)!;
        expect(disposisiSm2.aksiDiizinkan).toEqual(['buka_kotak_disposisi', 'buka_surat']);
        expect(disposisiSm2.disposisi).toMatchObject({ lewatBatas: true, batasWaktu: '2026-01-10', targetUnitNama: 'Dit. BPPT' });
        expect(disposisiSm2.rangkaian).toMatchObject({ id: id.R2, kode: 'RS-2026-000002' });
    });

    it('aksi buka_surat hanya ditawarkan bila checkRead mengizinkan (paritas visibleSql read ↔ checkRead)', async () => {
        for (const [nama, user] of Object.entries(pengguna)) {
            const hasil = await svc.perluDilengkapiService.list(user, { tampilkanDataLama: true, page: 1, limit: 100 });
            for (const item of hasil.data) {
                if (!item.surat) continue;
                const akses = await access.checkRead(user, item.surat.jenis, item.surat.id, holder.db);
                expect(item.aksiDiizinkan.includes('buka_surat'), `${nama} × ${item.kunci}`).toBe(Boolean(akses.allowed) && !akses.masked);
            }
        }
    });

    it('urutan: lewat batas dahulu dan deterministik; filter kategori dan paginasi', async () => {
        const pertama = await daftar('bppt');
        expect(pertama.data[0]).toMatchObject({ kategori: 'disposisi_terbuka', disposisi: { lewatBatas: true } });
        expect((await daftar('bppt')).data.map(item => item.kunci)).toEqual(pertama.data.map(item => item.kunci));
        const halaman = await daftar('tu', { kategori: 'sm_belum_ditindaklanjuti', page: 2, limit: 1 });
        expect(halaman.pagination).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });
        expect(halaman.data).toHaveLength(1);
        expect(halaman.meta).toEqual({ batasDataLama: BATAS_UTC, tampilkanDataLama: false });
    });

    it('batas data lama: env diutamakan, tanpa env diturunkan dari rangkaian non-data-lama tertua, konfigurasi rusak ditolak', async () => {
        await database.exec(`
            UPDATE rangkaian_surat SET created_at = '2026-03-04T05:06:07Z' WHERE id = '${id.R2}';
            UPDATE rangkaian_surat SET created_at = '2020-01-01T00:00:00Z' WHERE asal = 'data_lama';
        `);
        expect(await svc.resolveBatasDataLama(holder.db)).toBe(BATAS_UTC);
        vi.stubEnv('RANGKAIAN_DATA_LAMA_SEBELUM', '');
        expect(await svc.resolveBatasDataLama(holder.db)).toBe('2026-03-04T05:06:07.000Z');
        vi.stubEnv('RANGKAIAN_DATA_LAMA_SEBELUM', '2026-01-01');
        await expect(svc.resolveBatasDataLama(holder.db)).rejects.toThrow(/zona waktu/);
        vi.stubEnv('RANGKAIAN_DATA_LAMA_SEBELUM', '');
        await resetRangkaianFixture(database);
        const sebelum = Date.now();
        expect(Date.parse(await svc.resolveBatasDataLama(holder.db))).toBeGreaterThanOrEqual(sebelum - 1_000);
    });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `(cd backend && npx vitest run src/__tests__/perlu-dilengkapi.integration.test.ts)`
Expected: FAIL. Impor dinamis `../services/perlu-dilengkapi.service` di `beforeAll` gagal karena modul belum ada, sehingga seluruh tes di berkas ini gagal. Impor tipe `perlu-dilengkapi.constants` dihapus saat transpilasi, jadi tidak menjadi penyebab.

- [ ] **Step 3: Implementasi minimal**

(a) Konstanta tanpa impor:

```ts
// backend/src/services/perlu-dilengkapi.constants.ts
/** D7: kode kategori Perlu Dilengkapi. API, validator, dan UI memakai daftar yang sama. Sengaja tanpa impor. */
export const KATEGORI_PERLU_DILENGKAPI = [
    'sm_belum_ditindaklanjuti',
    'disposisi_terbuka',
    'sk_tanpa_nd_penjelas',
    'tindak_lanjut_tertahan',
    'siap_diberkaskan',
    'sk_tanpa_asal',
] as const;
export type KategoriPerluDilengkapi = typeof KATEGORI_PERLU_DILENGKAPI[number];
```

(b) Di `backend/src/services/rangkaian-daftar.service.ts` (Task 5), ganti blok impor ini (persis):

```ts
import {
    barisDari, cocokUnitRekamanSql, dalamCakupanPengawasSql, jangkauanSql, kecocokanUnitRekaman, resolveKonteksBaca,
} from './access/visibility-spec.js';
```

menjadi:

```ts
import {
    aliasAman, barisDari, cocokUnitRekamanSql, dalamCakupanPengawasSql, jangkauanSql, kecocokanUnitRekaman, resolveKonteksBaca,
    type KonteksBaca,
} from './access/visibility-spec.js';
```

Lalu ganti fungsi ini (persis):

```ts
async function lingkupSql(user: PenggunaDaftar): Promise<SQL> {
    const ctx = await resolveKonteksBaca(user, db);
    const bagian: SQL[] = [cocokUnitRekamanSql(kecocokanUnitRekaman(user), sql.raw('r.unit_pencatat_id'))];
    if (ctx.pengawas) bagian.push(dalamCakupanPengawasSql(sql.raw('r.unit_pencatat_id')));
    if (ctx.unitJangkauan) bagian.push(jangkauanSql(sql.raw('r.id'), ctx.unitJangkauan, ctx.disposisiLamaRead));
    return sql`(${sql.join(bagian, sql` OR `)})`;
}
```

menjadi:

```ts
/**
 * Lingkup rangkaian (pencatat ∨ pengawas ∨ jangkauan §4.5) untuk alias tabel
 * rangkaian_surat; dipakai juga D7 (Task 16).
 *
 * Alias divalidasi dengan `aliasAman` yang diekspor dari `visibility-spec.ts`
 * (bukan regex sendiri) supaya alias ini tunduk pada aturan yang sama dengan
 * `visibleSql`/`jangkauanRekamanSql`/`klasifikasiRekamanSql`: menolak
 * identifier bukan alias sederhana DAN menolak alias berprefiks `jk_` atau
 * bernama `ra`/`g`/`j` (dicadangkan untuk subkueri internal
 * jangkauanUnitsSql/jangkauanSql/grantAktifSql/jangkauanRekamanSql). `alias`
 * di sini SELALU dikualifikasi (`${alias}.unit_pencatat_id`, `${alias}.id`)
 * sebelum disisipkan sebagai SQLWrapper mentah ke `jangkauanSql` — jangan
 * mengubahnya menjadi kolom telanjang, karena `jangkauanSql`/
 * `jangkauanUnitsSql` tidak memvalidasi argumen `rangkaianId` itu sendiri
 * (lihat JSDoc-nya di `visibility-spec.ts`); kolom telanjang berisiko diam-diam
 * terikat ke tabel internal fungsi-fungsi itu.
 */
export function lingkupRangkaianSql(ctx: KonteksBaca, alias = 'r'): SQL {
    const a = aliasAman(alias);
    const bagian: SQL[] = [cocokUnitRekamanSql(kecocokanUnitRekaman(ctx.user), sql.raw(`${a}.unit_pencatat_id`))];
    if (ctx.pengawas) bagian.push(dalamCakupanPengawasSql(sql.raw(`${a}.unit_pencatat_id`)));
    if (ctx.unitJangkauan) bagian.push(jangkauanSql(sql.raw(`${a}.id`), ctx.unitJangkauan, ctx.disposisiLamaRead));
    return sql`(${sql.join(bagian, sql` OR `)})`;
}

async function lingkupSql(user: PenggunaDaftar): Promise<SQL> {
    return lingkupRangkaianSql(await resolveKonteksBaca(user, db));
}
```

(c) Layanan:

```ts
// backend/src/services/perlu-dilengkapi.service.ts
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../config/database.js';
import {
    barisDari, cocokUnitRekamanSql, dalamCakupanPengawas, dalamCakupanPengawasSql, jangkauanRekamanSql, kecocokanUnitRekaman,
    resolveKonteksBaca, visibleSql, type KonteksBaca, type PelaksanaSql, type TargetVisibilitas,
} from './access/visibility-spec.js';
import { computeRangkaianAksi, computeSuratAksi } from './rangkaian/aksi.js';
import { isFullAdmin } from './rangkaian/roles.js';
import type { RangkaianStatus } from './rangkaian-status.js';
import { lingkupRangkaianSql } from './rangkaian-daftar.service.js';
import { judulRangkaianTampil } from './rangkaian-judul.js';
import { jakartaDate } from '../utils/jakarta-date.js';
import { KATEGORI_PERLU_DILENGKAPI, type KategoriPerluDilengkapi } from './perlu-dilengkapi.constants.js';

export { KATEGORI_PERLU_DILENGKAPI, type KategoriPerluDilengkapi };

export const ENV_BATAS_DATA_LAMA = 'RANGKAIAN_DATA_LAMA_SEBELUM';
const ISO_BERZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export type PerluDilengkapiAksi = 'tindak_lanjut' | 'disposisi' | 'buka_kotak_disposisi' | 'buat_nd_penjelas'
    | 'buka_surat' | 'berkaskan' | 'tandai_inisiatif' | 'tautkan';
export type PerluDilengkapiFilter = { kategori?: KategoriPerluDilengkapi; tampilkanDataLama: boolean; page: number; limit: number };
export type PenggunaPerluDilengkapi = { id: string; role: string; unitKerjaId: string | null; email?: string; name?: string | null };
type JenisSurat = 'surat_masuk' | 'surat_keluar';

export interface PerluDilengkapiItem {
    kunci: string;
    kategori: KategoriPerluDilengkapi;
    masked: boolean;
    label?: 'Dikecualikan';
    jenis: JenisSurat | 'rangkaian';
    unitNama: string;
    surat: {
        jenis: JenisSurat; id: string; nomorSurat: string | null; perihal: string | null; tanggalSurat: string | null;
        naskahDinas: string | null; dari: string | null; kepada: string | null; sifatSurat: string | null;
        unitKerjaId: string; approvalStatus: string | null;
    } | null;
    rangkaian: {
        id: string; kode: string; status: RangkaianStatus; judul: string | null;
        unitPencatatId: string | null; unitPengolahId: string | null; unitPengolahNama: string | null;
    } | null;
    disposisi: { id: string; status: string; targetUnitNama: string | null; batasWaktu: string | null; lewatBatas: boolean } | null;
    dataLama: boolean;
    aksiDiizinkan: PerluDilengkapiAksi[];
}

/**
 * Batas data lama (§7 D7): env ISO-8601 berzona (runbook P4: waktu kode P3 aktif di produksi).
 * Tanpa env: rangkaian non-data-lama tertua (backfill langkah 1 berjalan tepat sebelum kode P3 aktif),
 * atau "sekarang" bila belum ada rangkaian, sehingga surat lama tersembunyi, bukan membanjiri daftar.
 */
export async function resolveBatasDataLama(executor: PelaksanaSql = db, env: NodeJS.ProcessEnv = process.env): Promise<string> {
    const mentah = env[ENV_BATAS_DATA_LAMA]?.trim();
    if (mentah) {
        if (!ISO_BERZONA.test(mentah) || Number.isNaN(Date.parse(mentah))) {
            throw new Error(`${ENV_BATAS_DATA_LAMA} harus ISO-8601 dengan zona waktu, mis. 2026-10-05T00:00:00+07:00`);
        }
        return new Date(mentah).toISOString();
    }
    const [row] = barisDari<{ batas: Date | string | null }>(await executor.execute(
        sql`SELECT min(created_at) AS batas FROM rangkaian_surat WHERE asal <> 'data_lama'`,
    ));
    return (row?.batas ? new Date(row.batas) : new Date()).toISOString();
}

// ─── Satu bentuk baris untuk keenam cabang UNION ALL ────────────────────────
const KOLOM = [
    'kategori', 'urut_id', 'kunci_id', 'masked', 'terbaca', 'jenis', 'surat_id', 'nomor_surat', 'perihal', 'tanggal_surat',
    'naskah', 'pihak', 'sifat', 'status_persetujuan', 'unit_kerja_id', 'unit_nama', 'unit_sendiri', 'is_archived',
    'rangkaian_id', 'rangkaian_kode', 'rangkaian_status', 'rangkaian_judul', 'rangkaian_pencatat', 'rangkaian_pengolah',
    'rangkaian_pengolah_nama', 'induk_terbaca', 'distribusi_id', 'distribusi_status', 'target_unit_nama', 'target_saya',
    'batas_waktu', 'lewat_batas', 'tanggal_urut', 'data_lama',
] as const;
type NamaKolom = typeof KOLOM[number];
const BAWAAN: Record<NamaKolom, SQL> = {
    kategori: sql`NULL::text`, urut_id: sql`NULL::text`, kunci_id: sql`NULL::text`, masked: sql`false`, terbaca: sql`false`,
    jenis: sql`NULL::text`, surat_id: sql`NULL::uuid`, nomor_surat: sql`NULL::text`, perihal: sql`NULL::text`,
    tanggal_surat: sql`NULL::text`, naskah: sql`NULL::text`, pihak: sql`NULL::text`, sifat: sql`NULL::text`,
    status_persetujuan: sql`NULL::text`, unit_kerja_id: sql`NULL::text`, unit_nama: sql`NULL::text`, unit_sendiri: sql`false`,
    is_archived: sql`false`, rangkaian_id: sql`NULL::uuid`, rangkaian_kode: sql`NULL::text`, rangkaian_status: sql`NULL::text`,
    rangkaian_judul: sql`NULL::text`, rangkaian_pencatat: sql`NULL::text`, rangkaian_pengolah: sql`NULL::text`,
    rangkaian_pengolah_nama: sql`NULL::text`, induk_terbaca: sql`false`, distribusi_id: sql`NULL::uuid`,
    distribusi_status: sql`NULL::text`, target_unit_nama: sql`NULL::text`, target_saya: sql`false`, batas_waktu: sql`NULL::text`,
    lewat_batas: sql`false`, tanggal_urut: sql`NULL::timestamptz`, data_lama: sql`false`,
};
/** urut_id (id asli) hanya dipakai ORDER BY di dalam kueri; tidak pernah dikirim ke klien. */
const KOLOM_KELUAR = sql.raw(KOLOM.filter(nama => nama !== 'urut_id').map(nama => `s.${nama}`).join(', '));

type BarisPerluDilengkapi = {
    kategori: KategoriPerluDilengkapi; kunci_id: string | null; masked: boolean; terbaca: boolean; jenis: JenisSurat | 'rangkaian';
    surat_id: string | null; nomor_surat: string | null; perihal: string | null; tanggal_surat: string | null; naskah: string | null;
    pihak: string | null; sifat: string | null; status_persetujuan: string | null; unit_kerja_id: string; unit_nama: string | null;
    unit_sendiri: boolean; is_archived: boolean; rangkaian_id: string | null; rangkaian_kode: string | null;
    rangkaian_status: RangkaianStatus | null; rangkaian_judul: string | null; rangkaian_pencatat: string | null;
    rangkaian_pengolah: string | null; rangkaian_pengolah_nama: string | null; induk_terbaca: boolean;
    distribusi_id: string | null; distribusi_status: string | null; target_unit_nama: string | null; target_saya: boolean;
    batas_waktu: string | null; lewat_batas: boolean; tanggal_urut: Date | string | null; data_lama: boolean; total: number;
};

interface KonteksPd { user: PenggunaPerluDilengkapi; ctx: KonteksBaca; batas: string; tampilkanDataLama: boolean; hariIni: string }

function pilih(nilai: Partial<Record<NamaKolom, SQL>>): SQL {
    return sql.join(KOLOM.map(nama => sql`${nilai[nama] ?? BAWAAN[nama]} AS ${sql.raw(nama)}`), sql`, `);
}

/** Nilai isi surat hanya keluar bila baris lolos visibleSql 'list'; selain itu NULL di SQL (§4.8). */
const tampil = (kolom: SQL) => sql`CASE WHEN v.terlihat THEN ${kolom} END`;
const milikSendiri = (k: KonteksPd, unitCol: SQL) => cocokUnitRekamanSql(kecocokanUnitRekaman(k.ctx.user), unitCol);
const saringDataLama = (k: KonteksPd, dataLama: SQL) => (k.tampilkanDataLama ? sql`true` : sql`NOT ${dataLama}`);

function lateralTerlihat(k: KonteksPd, t: TargetVisibilitas): SQL {
    return sql`CROSS JOIN LATERAL (
        SELECT coalesce(${visibleSql(k.ctx, t, 'list')}, false) AS terlihat,
               coalesce(${visibleSql(k.ctx, t, 'read')}, false) AS terbaca) v`;
}

/** Cakupan surat = unit sendiri ∨ jangkauan lintas unit (pengawas/peserta), dari fragmen P2 yang sama dengan visibleSql. */
function cakupanSurat(k: KonteksPd, t: TargetVisibilitas): SQL {
    return sql`(${sql.raw(`${t.alias}.is_deleted IS NOT TRUE`)}
        AND (${milikSendiri(k, sql.raw(`${t.alias}.unit_kerja_id`))} OR ${jangkauanRekamanSql(k.ctx, t.type, t.alias)}))`;
}

/** Data lama = anggota rangkaian data_lama, atau bukan anggota rangkaian mana pun dan dibuat sebelum batas. */
function dataLamaSurat(k: KonteksPd, t: TargetVisibilitas): SQL {
    const fk = sql.raw(t.type === 'surat_masuk' ? 'surat_masuk_id' : 'surat_keluar_id');
    const suratId = sql.raw(`${t.alias}.id`);
    return sql`(EXISTS (SELECT 1 FROM rangkaian_anggota dla JOIN rangkaian_surat dlr ON dlr.id = dla.rangkaian_id
                         WHERE dla.${fk} = ${suratId} AND dlr.asal = 'data_lama')
             OR (NOT EXISTS (SELECT 1 FROM rangkaian_anggota dlb WHERE dlb.${fk} = ${suratId})
                 AND ${sql.raw(`${t.alias}.created_at`)} < ${k.batas}::timestamptz))`;
}

function kolomSuratMasuk(k: KonteksPd): Partial<Record<NamaKolom, SQL>> {
    return {
        jenis: sql`'surat_masuk'::text`, masked: sql`NOT v.terlihat`, terbaca: sql`v.terbaca`,
        surat_id: tampil(sql`sm.id`), nomor_surat: tampil(sql`sm.nomor_surat`), perihal: tampil(sql`sm.perihal`),
        tanggal_surat: tampil(sql`sm.tanggal_surat::text`), pihak: tampil(sql`sm.dari`), sifat: tampil(sql`sm.sifat_surat`),
        unit_kerja_id: sql`sm.unit_kerja_id`, unit_nama: sql`u.name`, unit_sendiri: milikSendiri(k, sql`sm.unit_kerja_id`),
        is_archived: sql`coalesce(sm.is_archived, false)`,
    };
}

function kolomSuratKeluar(k: KonteksPd): Partial<Record<NamaKolom, SQL>> {
    return {
        jenis: sql`'surat_keluar'::text`, masked: sql`NOT v.terlihat`, terbaca: sql`v.terbaca`,
        surat_id: tampil(sql`sk.id`), nomor_surat: tampil(sql`sk.nomor_surat`), perihal: tampil(sql`sk.perihal`),
        tanggal_surat: tampil(sql`sk.tanggal_surat::text`), naskah: tampil(sql`sk.naskah_dinas`), pihak: tampil(sql`sk.kepada`),
        sifat: tampil(sql`sk.klasifikasi_keamanan`), status_persetujuan: tampil(sql`sk.approval_status`),
        unit_kerja_id: sql`sk.unit_kerja_id`, unit_nama: sql`u.name`, unit_sendiri: milikSendiri(k, sql`sk.unit_kerja_id`),
        is_archived: sql`coalesce(sk.is_archived, false)`,
    };
}

/** Rangkaian tempat surat berada (alias rs), disamarkan bersama suratnya. */
const KOLOM_RANGKAIAN_SURAT: Partial<Record<NamaKolom, SQL>> = {
    rangkaian_id: tampil(sql`rs.id`), rangkaian_kode: tampil(sql`rs.kode`), rangkaian_status: tampil(sql`rs.status`),
    rangkaian_pencatat: tampil(sql`rs.unit_pencatat_id`), rangkaian_pengolah: tampil(sql`rs.unit_pengolah_id`),
};

function cabangSmBelumDitindaklanjuti(k: KonteksPd): SQL {
    const t: TargetVisibilitas = { type: 'surat_masuk', alias: 'sm' };
    const dataLama = dataLamaSurat(k, t);
    return sql`SELECT ${pilih({
        ...kolomSuratMasuk(k), ...KOLOM_RANGKAIAN_SURAT,
        kategori: sql`'sm_belum_ditindaklanjuti'::text`, urut_id: sql`sm.id::text`, kunci_id: tampil(sql`sm.id::text`),
        tanggal_urut: sql`sm.created_at::timestamptz`, data_lama: dataLama,
    })}
    FROM surat_masuk sm
    JOIN unit_kerja u ON u.id = sm.unit_kerja_id
    LEFT JOIN rangkaian_anggota ag ON ag.surat_masuk_id = sm.id
    LEFT JOIN rangkaian_surat rs ON rs.id = ag.rangkaian_id
    ${lateralTerlihat(k, t)}
    WHERE ${cakupanSurat(k, t)}
      AND ${saringDataLama(k, dataLama)}
      AND coalesce(rs.status, 'aktif') NOT IN ('selesai', 'diberkaskan')
      AND NOT EXISTS (SELECT 1 FROM surat_distributions d WHERE d.surat_masuk_id = sm.id AND d.status <> 'rejected')
      AND NOT EXISTS (SELECT 1 FROM surat_keluar bk WHERE bk.balasan_untuk = sm.id AND bk.is_deleted IS NOT TRUE)
      AND NOT EXISTS (
          SELECT 1 FROM rangkaian_relasi rr
            JOIN rangkaian_anggota da ON da.id = rr.dari_anggota_id
            JOIN surat_keluar dk ON dk.id = da.surat_keluar_id
           WHERE rr.ke_anggota_id = ag.id AND rr.cancelled_at IS NULL
             AND rr.jenis_relasi IN ('balasan', 'tindak_lanjut') AND dk.is_deleted IS NOT TRUE)`;
}

function cabangDisposisiTerbuka(k: KonteksPd): SQL {
    const t: TargetVisibilitas = { type: 'surat_masuk', alias: 'sm' };
    const dataLama = sql`coalesce(rs.asal = 'data_lama', false)`;
    const cakupan: SQL[] = [milikSendiri(k, sql`d.target_unit_id`), milikSendiri(k, sql`d.source_unit_id`)];
    if (k.ctx.pengawas) cakupan.push(dalamCakupanPengawasSql(sql`d.target_unit_id`));
    return sql`SELECT ${pilih({
        ...kolomSuratMasuk(k), ...KOLOM_RANGKAIAN_SURAT,
        kategori: sql`'disposisi_terbuka'::text`, urut_id: sql`d.id::text`, kunci_id: sql`d.id::text`,
        distribusi_id: sql`d.id`, distribusi_status: sql`d.status`, target_unit_nama: sql`ut.name`,
        target_saya: milikSendiri(k, sql`d.target_unit_id`), batas_waktu: sql`d.batas_waktu::text`,
        lewat_batas: sql`coalesce(d.batas_waktu < ${k.hariIni}::date, false)`,
        tanggal_urut: sql`d.sent_at::timestamptz`, data_lama: dataLama,
    })}
    FROM surat_distributions d
    JOIN surat_masuk sm ON sm.id = d.surat_masuk_id
    JOIN unit_kerja u ON u.id = sm.unit_kerja_id
    JOIN unit_kerja ut ON ut.id = d.target_unit_id
    LEFT JOIN rangkaian_surat rs ON rs.id = d.rangkaian_id
    ${lateralTerlihat(k, t)}
    WHERE d.status IN ('sent', 'received')
      AND sm.is_deleted IS NOT TRUE
      AND (${sql.join(cakupan, sql` OR `)})
      AND ${saringDataLama(k, dataLama)}`;
}

function cabangSkTanpaNdPenjelas(k: KonteksPd): SQL {
    const t: TargetVisibilitas = { type: 'surat_keluar', alias: 'sk' };
    const dataLama = dataLamaSurat(k, t);
    return sql`SELECT ${pilih({
        ...kolomSuratKeluar(k), ...KOLOM_RANGKAIAN_SURAT,
        kategori: sql`'sk_tanpa_nd_penjelas'::text`, urut_id: sql`sk.id::text`, kunci_id: tampil(sql`sk.id::text`),
        tanggal_urut: sql`sk.created_at::timestamptz`, data_lama: dataLama,
    })}
    FROM surat_keluar sk
    JOIN unit_kerja u ON u.id = sk.unit_kerja_id
    LEFT JOIN rangkaian_anggota ag ON ag.surat_keluar_id = sk.id
    LEFT JOIN rangkaian_surat rs ON rs.id = ag.rangkaian_id
    ${lateralTerlihat(k, t)}
    WHERE ${cakupanSurat(k, t)}
      AND ${saringDataLama(k, dataLama)}
      AND sk.naskah_dinas ~* 'keputusan'
      AND sk.approval_status = 'approved'
      AND coalesce(rs.status, 'aktif') <> 'diberkaskan'
      AND NOT EXISTS (
          SELECT 1 FROM rangkaian_relasi rr
            JOIN rangkaian_anggota da ON da.id = rr.dari_anggota_id
            JOIN surat_keluar nd ON nd.id = da.surat_keluar_id
           WHERE rr.ke_anggota_id = ag.id AND rr.cancelled_at IS NULL
             AND rr.jenis_relasi = 'menjelaskan' AND nd.is_deleted IS NOT TRUE)`;
}

function cabangTindakLanjutTertahan(k: KonteksPd): SQL {
    const t: TargetVisibilitas = { type: 'surat_keluar', alias: 'sk' };
    const dataLama = sql`(rs.asal = 'data_lama')`;
    return sql`SELECT ${pilih({
        ...kolomSuratKeluar(k), ...KOLOM_RANGKAIAN_SURAT,
        kategori: sql`'tindak_lanjut_tertahan'::text`, urut_id: sql`sk.id::text`, kunci_id: tampil(sql`sk.id::text`),
        tanggal_urut: sql`sk.updated_at::timestamptz`, data_lama: dataLama,
    })}
    FROM rangkaian_anggota ag
    JOIN surat_keluar sk ON sk.id = ag.surat_keluar_id
    JOIN rangkaian_surat rs ON rs.id = ag.rangkaian_id
    JOIN unit_kerja u ON u.id = sk.unit_kerja_id
    ${lateralTerlihat(k, t)}
    WHERE ${cakupanSurat(k, t)}
      AND ${saringDataLama(k, dataLama)}
      AND sk.approval_status IN ('draft', 'pending', 'rejected')
      AND rs.status IN ('aktif', 'selesai')`;
}

function cabangSiapDiberkaskan(k: KonteksPd): SQL {
    const dataLama = sql`(rs.asal = 'data_lama')`;
    // Judul mengikuti keterbacaan induk mode 'read' (sama dengan Task 5): judul SELALU disamarkan bila induk terkendali.
    const indukTerbaca = sql`coalesce(
        (im.id IS NOT NULL AND ${visibleSql(k.ctx, { type: 'surat_masuk', alias: 'im' }, 'read')})
        OR (ik.id IS NOT NULL AND ${visibleSql(k.ctx, { type: 'surat_keluar', alias: 'ik' }, 'read')}), false)`;
    return sql`SELECT ${pilih({
        kategori: sql`'siap_diberkaskan'::text`, urut_id: sql`rs.id::text`, kunci_id: sql`rs.id::text`,
        masked: sql`false`, terbaca: sql`vi.induk_terbaca`, jenis: sql`'rangkaian'::text`,
        unit_kerja_id: sql`rs.unit_pencatat_id`, unit_nama: sql`u.name`, unit_sendiri: milikSendiri(k, sql`rs.unit_pencatat_id`),
        rangkaian_id: sql`rs.id`, rangkaian_kode: sql`rs.kode`, rangkaian_status: sql`rs.status`,
        rangkaian_judul: sql`CASE WHEN vi.induk_terbaca THEN rs.judul END`,
        rangkaian_pencatat: sql`rs.unit_pencatat_id`, rangkaian_pengolah: sql`rs.unit_pengolah_id`,
        rangkaian_pengolah_nama: sql`uo.name`, induk_terbaca: sql`vi.induk_terbaca`,
        tanggal_urut: sql`rs.selesai_at`, data_lama: dataLama,
    })}
    FROM rangkaian_surat rs
    JOIN unit_kerja u ON u.id = rs.unit_pencatat_id
    LEFT JOIN unit_kerja uo ON uo.id = rs.unit_pengolah_id
    LEFT JOIN rangkaian_anggota ai ON ai.rangkaian_id = rs.id AND ai.peran = 'induk'
    LEFT JOIN surat_masuk im ON im.id = ai.surat_masuk_id
    LEFT JOIN surat_keluar ik ON ik.id = ai.surat_keluar_id
    CROSS JOIN LATERAL (SELECT ${indukTerbaca} AS induk_terbaca) vi
    WHERE rs.status = 'selesai'
      AND ${lingkupRangkaianSql(k.ctx, 'rs')}
      AND ${saringDataLama(k, dataLama)}`;
}

function cabangSkTanpaAsal(k: KonteksPd): SQL {
    const t: TargetVisibilitas = { type: 'surat_keluar', alias: 'sk' };
    const dataLama = dataLamaSurat(k, t);
    return sql`SELECT ${pilih({
        ...kolomSuratKeluar(k),
        kategori: sql`'sk_tanpa_asal'::text`, urut_id: sql`sk.id::text`, kunci_id: tampil(sql`sk.id::text`),
        tanggal_urut: sql`sk.created_at::timestamptz`, data_lama: dataLama,
    })}
    FROM surat_keluar sk
    JOIN unit_kerja u ON u.id = sk.unit_kerja_id
    ${lateralTerlihat(k, t)}
    WHERE ${cakupanSurat(k, t)}
      AND ${saringDataLama(k, dataLama)}
      AND sk.asal_naskah IS NULL
      AND NOT EXISTS (SELECT 1 FROM rangkaian_anggota ax WHERE ax.surat_keluar_id = sk.id)`;
}

const CABANG: Record<KategoriPerluDilengkapi, (k: KonteksPd) => SQL> = {
    sm_belum_ditindaklanjuti: cabangSmBelumDitindaklanjuti,
    disposisi_terbuka: cabangDisposisiTerbuka,
    sk_tanpa_nd_penjelas: cabangSkTanpaNdPenjelas,
    tindak_lanjut_tertahan: cabangTindakLanjutTertahan,
    siap_diberkaskan: cabangSiapDiberkaskan,
    sk_tanpa_asal: cabangSkTanpaAsal,
};

function semuaSql(k: KonteksPd, kategori?: KategoriPerluDilengkapi): SQL {
    const daftar = kategori ? [kategori] : [...KATEGORI_PERLU_DILENGKAPI];
    return sql.join(daftar.map(nama => CABANG[nama](k)), sql` UNION ALL `);
}

function viaBaris(row: BarisPerluDilengkapi, k: KonteksPd): 'owner' | 'pengawas' | 'peserta' {
    if (row.unit_sendiri) return 'owner';
    return k.ctx.pengawas && dalamCakupanPengawas(row.unit_kerja_id) ? 'pengawas' : 'peserta';
}

/** Aksi baris memakai aturan P3 (aksi.ts). Aksi yang membaca/menindaklanjuti isi hanya bila visibleSql 'read' lolos. */
function aksiUntuk(row: BarisPerluDilengkapi, k: KonteksPd): PerluDilengkapiAksi[] {
    const role = k.user.role ?? '';
    if (row.kategori === 'siap_diberkaskan') {
        const bolehBerkaskan = computeRangkaianAksi({
            role, unitEfektif: k.ctx.unitJangkauan, isPengawas: k.ctx.pengawas,
            rangkaian: { status: 'selesai', unitPencatatId: row.rangkaian_pencatat ?? '', unitPengolahId: row.rangkaian_pengolah },
            adaDisposisiTerbuka: false,
        }).includes('berkaskan');
        return bolehBerkaskan ? ['berkaskan'] : [];
    }
    const aksi = new Set<PerluDilengkapiAksi>();
    if (row.kategori === 'disposisi_terbuka' && row.target_saya && isFullAdmin(k.user)) aksi.add('buka_kotak_disposisi');
    if (row.masked) return [...aksi];
    if (row.kategori === 'sk_tanpa_asal' && row.unit_sendiri && isFullAdmin(k.user)) aksi.add('tandai_inisiatif');
    if (row.terbaca && row.jenis !== 'rangkaian') {
        const suratAksi = computeSuratAksi(role, {
            jenis: row.jenis, via: viaBaris(row, k), isArchived: Boolean(row.is_archived), naskahDinas: row.naskah,
            rangkaian: row.rangkaian_id && row.rangkaian_kode && row.rangkaian_status
                ? { id: row.rangkaian_id, kode: row.rangkaian_kode, status: row.rangkaian_status,
                    unitPencatatId: row.rangkaian_pencatat ?? '', unitPengolahId: row.rangkaian_pengolah }
                : null,
            distribusiUnitSaya: null, isPengawas: k.ctx.pengawas,
        });
        if (row.kategori === 'sm_belum_ditindaklanjuti') {
            if (suratAksi.includes('saya_balas') || suratAksi.includes('buat_nota_dinas')) aksi.add('tindak_lanjut');
            if (suratAksi.includes('disposisi')) aksi.add('disposisi');
        }
        if (row.kategori === 'sk_tanpa_nd_penjelas' && suratAksi.includes('buat_nd_penjelas')) aksi.add('buat_nd_penjelas');
        if (row.kategori === 'sk_tanpa_asal' && suratAksi.includes('tautkan')) aksi.add('tautkan');
        aksi.add('buka_surat');
    }
    return [...aksi].sort();
}

function keItem(row: BarisPerluDilengkapi, urutan: number, k: KonteksPd): PerluDilengkapiItem {
    const aksiDiizinkan = aksiUntuk(row, k);
    const unitNama = row.unit_nama ?? row.unit_kerja_id;
    const disposisi = row.distribusi_id
        ? { id: row.distribusi_id, status: row.distribusi_status ?? '', targetUnitNama: row.target_unit_nama,
            batasWaktu: row.batas_waktu, lewatBatas: Boolean(row.lewat_batas) }
        : null;
    if (row.masked) {
        // Placeholder §4.8: kategori, jenis, unit pemilik, dan metadata routing disposisi saja.
        return {
            kunci: `${row.kategori}:${row.kunci_id ?? `tersamar-${urutan + 1}`}`,
            kategori: row.kategori, masked: true, label: 'Dikecualikan', jenis: row.jenis, unitNama,
            surat: null, rangkaian: null, disposisi, dataLama: Boolean(row.data_lama), aksiDiizinkan,
        };
    }
    const jenisSurat = row.jenis === 'rangkaian' ? null : row.jenis;
    return {
        kunci: `${row.kategori}:${row.kunci_id}`,
        kategori: row.kategori, masked: false, jenis: row.jenis, unitNama,
        surat: jenisSurat && row.surat_id ? {
            jenis: jenisSurat, id: row.surat_id, nomorSurat: row.nomor_surat, perihal: row.perihal, tanggalSurat: row.tanggal_surat,
            naskahDinas: row.naskah, dari: jenisSurat === 'surat_masuk' ? row.pihak : null,
            kepada: jenisSurat === 'surat_keluar' ? row.pihak : null, sifatSurat: row.sifat,
            unitKerjaId: row.unit_kerja_id, approvalStatus: row.status_persetujuan,
        } : null,
        rangkaian: row.rangkaian_id && row.rangkaian_kode && row.rangkaian_status ? {
            id: row.rangkaian_id, kode: row.rangkaian_kode, status: row.rangkaian_status,
            judul: row.jenis === 'rangkaian' ? judulRangkaianTampil(row.rangkaian_kode, row.rangkaian_judul, !row.induk_terbaca) : null,
            unitPencatatId: row.rangkaian_pencatat, unitPengolahId: row.rangkaian_pengolah, unitPengolahNama: row.rangkaian_pengolah_nama,
        } : null,
        disposisi, dataLama: Boolean(row.data_lama), aksiDiizinkan,
    };
}

async function dalamTransaksiBaca<T>(
    user: PenggunaPerluDilengkapi,
    tampilkanDataLama: boolean,
    kerja: (tx: PelaksanaSql, k: KonteksPd) => Promise<T>,
): Promise<T> {
    return db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '2s'`);
        const k: KonteksPd = {
            user, ctx: await resolveKonteksBaca(user, tx), batas: await resolveBatasDataLama(tx),
            tampilkanDataLama, hariIni: jakartaDate(),
        };
        return kerja(tx, k);
    });
}

export const perluDilengkapiService = {
    async list(user: PenggunaPerluDilengkapi, filter: PerluDilengkapiFilter) {
        return dalamTransaksiBaca(user, filter.tampilkanDataLama, async (tx, k) => {
            const offset = (filter.page - 1) * filter.limit;
            const rows = barisDari<BarisPerluDilengkapi>(await tx.execute(sql`
                WITH semua AS (${semuaSql(k, filter.kategori)})
                SELECT ${KOLOM_KELUAR}, count(*) OVER ()::int AS total
                  FROM semua s
                 ORDER BY s.lewat_batas DESC, s.tanggal_urut DESC NULLS LAST, s.kategori, s.urut_id
                 LIMIT ${filter.limit} OFFSET ${offset}`));
            const total = Number(rows[0]?.total ?? 0);
            return {
                data: rows.map((row, index) => keItem(row, offset + index, k)),
                pagination: { page: filter.page, limit: filter.limit, total, totalPages: Math.max(1, Math.ceil(total / filter.limit)) },
                meta: { batasDataLama: k.batas, tampilkanDataLama: filter.tampilkanDataLama },
            };
        });
    },

    async ringkasan(user: PenggunaPerluDilengkapi, filter: { tampilkanDataLama: boolean }) {
        return dalamTransaksiBaca(user, filter.tampilkanDataLama, async (tx, k) => {
            const rows = barisDari<{ kategori: KategoriPerluDilengkapi; jumlah: number; lewat: number }>(await tx.execute(sql`
                WITH semua AS (${semuaSql(k)})
                SELECT s.kategori, count(*)::int AS jumlah, (count(*) FILTER (WHERE s.lewat_batas))::int AS lewat
                  FROM semua s
                 GROUP BY s.kategori`));
            const perKategori = Object.fromEntries(KATEGORI_PERLU_DILENGKAPI.map(nama => [nama, 0])) as Record<KategoriPerluDilengkapi, number>;
            let lewatBatas = 0;
            for (const row of rows) {
                perKategori[row.kategori] = Number(row.jumlah);
                lewatBatas += Number(row.lewat);
            }
            const total = Object.values(perKategori).reduce((jumlah, nilai) => jumlah + nilai, 0);
            return { perKategori, total, lewatBatas, batasDataLama: k.batas };
        });
    },
};
```

- [ ] **Step 4: Jalankan, pastikan lulus (termasuk tes daftar Task 5 setelah refaktor lingkup)**

Run: `(cd backend && npx vitest run src/__tests__/perlu-dilengkapi.integration.test.ts src/__tests__/rangkaian-daftar.integration.test.ts)`
Expected: PASS (11 + 5 tes). Bila uji paritas `buka_surat` gagal pada satu pasangan, **jangan** melonggarkan tes. Periksa bahwa aksi baca hanya ditambahkan saat `row.terbaca` (mode `'read'`), bukan `masked`/`'list'`. Bila `visibleSql 'read'` sendiri menyimpang dari `checkRead`, itu temuan P2 (property test P2 seharusnya sudah menangkapnya); laporkan ke pemilik P2.

- [ ] **Step 5: Commit**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
git add backend/src/services/perlu-dilengkapi.constants.ts backend/src/services/perlu-dilengkapi.service.ts backend/src/services/rangkaian-daftar.service.ts backend/src/__tests__/perlu-dilengkapi.integration.test.ts
git commit -m "feat(perlu-dilengkapi): layanan daftar kerja enam kategori dengan penyamaran dan batas data lama" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


#### Amandemen pra-eksekusi Task 16 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p4-lacak-surat/preflight-rulings.md`.


1. **Imports (BLOCKING) [P4-T16-1, P4-T16-2, P4-T16-4] RECHECK-AFTER-P3.** Replace the import block of `perlu-dilengkapi.service.ts` with the following, merging per P4-G-4:
   ```ts
   import { sql, type SQL } from 'drizzle-orm';
   import { db } from '../config/database.js';
   import {
       barisDari, cocokUnitRekamanSql, dalamCakupanPengawas, dalamCakupanPengawasSql, jangkauanRekamanSql, kecocokanUnitRekaman,
       resolveKonteksBaca, visibleSql, type KonteksBaca, type PelaksanaSql, type TargetVisibilitas,
   } from './access/visibility-spec.js';
   import { computeRangkaianAksi, computeSuratAksi } from './rangkaian/aksi.js';
   import { isFullAdmin } from './rangkaian/roles.js';
   import { anggotaMemblokirSql, disposisiTerbukaSql, type RangkaianStatus } from './rangkaian.service.js';
   import { BLOCKING_APPROVAL_STATUSES } from './rangkaian-status.js';
   import { readRefKey, recordAccessService, type ReadAccessResult, type ReadExecutor, type ReadRef } from './record-access.service.js';
   import { lingkupRangkaianSql } from './rangkaian-daftar.service.js';
   import { judulRangkaianTampil } from './rangkaian-judul.js';
   import { jakartaDate } from '../utils/jakarta-date.js';
   import { KATEGORI_PERLU_DILENGKAPI, type KategoriPerluDilengkapi } from './perlu-dilengkapi.constants.js';
   ```
   If real P3 exports the builders only through `./rangkaian/deps.js`, import them from there instead.
   - **(delta P3) Confirmed on real P3 @ b4d86fa** (scratch tsc against extracted `backend/src`, `delta/tc3`):
     - `computeRangkaianAksi`/`computeSuratAksi` are exported by `rangkaian/aksi.ts:36, 76`, and `isFullAdmin` by `rangkaian/roles.ts:5`.
     - The builders and `type RangkaianStatus` are exported by `rangkaian.service.ts:182, 201, 28`.
     - `BLOCKING_APPROVAL_STATUSES` is exported by `rangkaian-status.ts:4`, which still does not export `RangkaianStatus` (T16-1 holds).
     - `dalamCakupanPengawasSql` is exported by P2 `visibility-spec.ts` and also re-exported by `deps.ts:53`.
2. **Row shape (BLOCKING).**
   - `KOLOM`: append `'selesai_manual', 'ada_penghalang', 'balasan_lama'` after `'data_lama'`.
   - `BAWAAN`: add `selesai_manual: sql\`false\`, ada_penghalang: sql\`false\`, balasan_lama: sql\`false\`,`.
   - `BarisPerluDilengkapi`: add `selesai_manual: boolean; ada_penghalang: boolean; balasan_lama: boolean;` before `total: number;`.
3. **`disposisi_terbuka` target (REQUIRED) [P4-T16-6].** Replace `target_saya: milikSendiri(k, sql\`d.target_unit_id\`),` with `target_saya: k.user.role === 'super_admin' ? sql\`false\` : milikSendiri(k, sql\`d.target_unit_id\`),`.
4. **`tindak_lanjut_tertahan` blocker set (BLOCKING) [P4-T16-3] RECHECK-AFTER-P3.** Replace `AND sk.approval_status IN ('draft', 'pending', 'rejected')` with:
   ```ts
         AND sk.approval_status IN (${sql.join(BLOCKING_APPROVAL_STATUSES.map(s => sql`${s}`), sql`, `)})
         AND NOT (
             EXISTS (SELECT 1 FROM rangkaian_relasi tr WHERE tr.dari_anggota_id = ag.id)
             AND NOT EXISTS (SELECT 1 FROM rangkaian_relasi tr WHERE tr.dari_anggota_id = ag.id AND tr.cancelled_at IS NULL))
   ```
   This is the same per-member clause as P3 `anggotaMemblokirSql` (P3 T12-1). Keep `sk.is_deleted` filtering through `cakupanSurat`.
5. **`siap_diberkaskan` blockers (BLOCKING) [P4-T16-4] RECHECK-AFTER-P3.** In `cabangSiapDiberkaskan`, after `tanggal_urut: sql\`rs.selesai_at\`, data_lama: dataLama,` add:
   ```ts
           selesai_manual: sql`coalesce(rs.selesai_manual, false)`,
           // Builder P3 T12-1/C-6. Wajib alias luar `rs` (builder memakai a/k/r/d/sm/ma di dalam subkueri).
           ada_penghalang: sql`(${anggotaMemblokirSql(sql.raw('rs.id'))} + ${disposisiTerbukaSql(sql.raw('rs.id'))}) > 0`,
   ```
   - **(delta P3) Confirmed, in flux.**
     - At b4d86fa the inner aliases are `a`/`k`/`r` (`anggotaMemblokirSql`, `rangkaian.service.ts:184-192`) and `d`/`sm`/`ma` (`disposisiTerbukaSql`, :202-207). The per-member clause in item 4 is character-equivalent to :189-192.
     - The fix wave (concurrency C-M1) rewrites `disposisiTerbukaSql` into a sum of two counts, so that `surat_distributions_rangkaian_idx` is used. The semantics stay identical and the signature stays `(rangkaianId: SQL | string): SQL`, but its inner aliases may change.
     - The rule "pass only the outer `sql.raw('rs.id')`; never use an alias the builder uses internally" therefore still stands. Run the T16-3 parity test on the post-fix tip.
     - `rangkaianStatusService.hitungPenghalang` (`rangkaian/rangkaian-status.service.ts:12-16`) is the P3 caller with the same sum. D7 reproduces it in SQL rather than calling it per row.
6. **`sk_tanpa_asal` (REQUIRED) [P4-T16-5].** In `cabangSkTanpaAsal`, after `tanggal_urut: sql\`sk.created_at::timestamptz\`, data_lama: dataLama,` add `balasan_lama: sql\`sk.balasan_untuk IS NOT NULL\`,`.
7. **Action computation (BLOCKING) [P4-T16-2, P4-T16-4] RECHECK-AFTER-P3.** Replace the whole block from `function viaBaris(` up to, but not including, `function keItem(` with:
   ```ts
   type AksesBaris = Map<string, ReadAccessResult>;

   /** Satu checkMany per halaman, hanya id DB dari baris yang terbaca (FR:32). */
   async function aksesHalaman(rows: BarisPerluDilengkapi[], k: KonteksPd, tx: ReadExecutor): Promise<AksesBaris> {
       const refs: ReadRef[] = rows
           .filter(row => row.terbaca && !row.masked && row.surat_id !== null && row.jenis !== 'rangkaian')
           .map(row => ({ type: row.jenis as JenisSurat, id: row.surat_id as string }));
       return refs.length ? recordAccessService.checkMany(k.user, refs, tx) : new Map();
   }

   /** Setara pengawasUntukUnit (P3 T1-5) dan tier pengawas P2 (rangkaian-read.service.ts:291-292), tanpa kueri tambahan. */
   const pengawasUntuk = (k: KonteksPd, unit: string | null) =>
       k.user.role === 'super_admin' || (k.ctx.pengawas && dalamCakupanPengawas(unit));

   /** Aksi baris memakai aturan P3 (aksi.ts, konteks teramandemen). Aksi isi hanya bila visibleSql 'read' DAN checkMany mengizinkan. */
   function aksiUntuk(row: BarisPerluDilengkapi, k: KonteksPd, akses: AksesBaris): PerluDilengkapiAksi[] {
       const role = k.user.role ?? '';
       if (row.kategori === 'siap_diberkaskan') {
           const bolehBerkaskan = computeRangkaianAksi({
               role, unitEfektif: k.ctx.unitJangkauan, pengawas: pengawasUntuk(k, row.rangkaian_pencatat),
               rangkaian: { status: 'selesai', unitPencatatId: row.rangkaian_pencatat ?? '', unitPengolahId: row.rangkaian_pengolah },
               adaDisposisiTerbuka: false, selesaiManual: Boolean(row.selesai_manual), adaPenghalang: Boolean(row.ada_penghalang),
           }).includes('berkaskan');
           return bolehBerkaskan ? ['berkaskan'] : [];
       }
       const aksi = new Set<PerluDilengkapiAksi>();
       if (row.kategori === 'disposisi_terbuka' && row.target_saya && isFullAdmin(k.user)) aksi.add('buka_kotak_disposisi');
       if (row.masked) return [...aksi];
       if (row.kategori === 'sk_tanpa_asal' && row.unit_sendiri && isFullAdmin(k.user) && !row.balasan_lama) aksi.add('tandai_inisiatif');
       const a = row.surat_id !== null && row.jenis !== 'rangkaian'
           ? akses.get(readRefKey({ type: row.jenis, id: row.surat_id }))
           : undefined;
       if (row.terbaca && a?.allowed === true && row.jenis !== 'rangkaian') {
           const suratAksi = computeSuratAksi(role, {
               jenis: row.jenis, via: a.via, mutable: a.mutable === true, isArchived: Boolean(row.is_archived), naskahDinas: row.naskah,
               rangkaian: row.rangkaian_id && row.rangkaian_kode && row.rangkaian_status
                   ? { id: row.rangkaian_id, kode: row.rangkaian_kode, status: row.rangkaian_status,
                       unitPencatatId: row.rangkaian_pencatat ?? '', unitPengolahId: row.rangkaian_pengolah }
                   : null,
               distribusiUnitSaya: null,
               pengawasDalamCakupan: a.via === 'pengawas' || pengawasUntuk(k, row.unit_kerja_id),
               isFullAdmin: isFullAdmin(k.user),
           });
           if (row.kategori === 'sm_belum_ditindaklanjuti') {
               if (suratAksi.includes('saya_balas') || suratAksi.includes('buat_nota_dinas')) aksi.add('tindak_lanjut');
               if (suratAksi.includes('disposisi')) aksi.add('disposisi');
           }
           if (row.kategori === 'sk_tanpa_nd_penjelas' && suratAksi.includes('buat_nd_penjelas')) aksi.add('buat_nd_penjelas');
           if (row.kategori === 'sk_tanpa_asal' && suratAksi.includes('tautkan')) aksi.add('tautkan');
           aksi.add('buka_surat');
       }
       return [...aksi].sort();
   }
   ```
   Pass exactly the fields that the landed `SuratAksiContext` and `RangkaianAksiContext` declare (Task 1 Step 2 record):
   - drop `isFullAdmin` if `SuratAksiContext` does not declare it;
   - drop `adaDisposisiTerbuka` if `RangkaianAksiContext` no longer declares it.

   **(delta P3) Binding corrected calls. Real P3 declares neither field.** As written above, the block fails tsc against real P3: `TS2353 'adaDisposisiTerbuka' does not exist in type 'RangkaianAksiContext'` and `TS2353 'isFullAdmin' does not exist in type 'SuratAksiContext'`. This was verified in scratch (`delta/tc3/perlu-dilengkapi.service.asis.ts.txt`). Use:
   ```ts
           const bolehBerkaskan = computeRangkaianAksi({
               role, unitEfektif: k.ctx.unitJangkauan, pengawas: pengawasUntuk(k, row.rangkaian_pencatat),
               rangkaian: { status: 'selesai', unitPencatatId: row.rangkaian_pencatat ?? '', unitPengolahId: row.rangkaian_pengolah },
               // D7 hanya menawarkan berkaskan; tutup_disposisi (CTRL-1) tidak pernah ditawarkan dari sini.
               pengawasTutup: false, adaDisposisiTerbukaDalamCakupan: false,
               selesaiManual: Boolean(row.selesai_manual), adaPenghalang: Boolean(row.ada_penghalang),
           }).includes('berkaskan');
   ```
   and remove the line `isFullAdmin: isFullAdmin(k.user),` from the `computeSuratAksi` context. `computeSuratAksi` already returns `[]` for non-FULL_ADMIN roles (`aksi.ts:37`). `isFullAdmin` stays imported, because `aksiUntuk` still uses it for `buka_kotak_disposisi` and `tandai_inisiatif`.

   The corrected file typechecks clean against real P3 (`delta/tc3/perlu-dilengkapi.service.delta.ts`; the only residual errors are module-resolution noise inside the extracted P3 infra files `config/*`, not in P4 code).

   Semantics check, by reading:
   - In `computeRangkaianAksi`, `berkaskan` = `!adaPenghalang && (pengolah || pencatat || sa || pengawas)` (`aksi.ts:83-87`).
   - The server's `assertPeran` admits `pengawas` only when `tingkatAksesRangkaian === 'pengawas'` (`berkas.service.ts:28-39`). That tier is `ctx.pengawas && dalamCakupanPengawas(unit_pencatat_id)` (`rangkaian-read.service.ts:300`), with super_admin as `'owner'` (:299). So `pengawasUntuk(k, pencatat)` is definitionally equal to the server check.
8. **Plumbing (BLOCKING).**
   - `keItem(row, urutan, k)` becomes `keItem(row: BarisPerluDilengkapi, urutan: number, k: KonteksPd, akses: AksesBaris)`, and its first line becomes `const aksiDiizinkan = aksiUntuk(row, k, akses);`.
   - In `dalamTransaksiBaca`, the callback type becomes `kerja: (tx: ReadExecutor, k: KonteksPd) => Promise<T>`.
   - In `list`, after `const total = …`, add `const akses = await aksesHalaman(rows, k, tx);` and map with `keItem(row, offset + index, k, akses)`.
   - `ringkasan` is unchanged: it computes no actions.
9. **Tests (REQUIRED) [P4-T16-3..6].** Append to `perlu-dilengkapi.integration.test.ts`. The 11 existing tests keep their expectations unchanged. Verified in scratch: 15/15 on PGlite with the full P2 chain and the amended P3 aksi logic, and tsc clean.
   ```ts
   describe('amandemen pra-eksekusi P4 T16', () => {
       it('tindak_lanjut_tertahan mengikuti himpunan penghalang P1/P3: relasi keluar yang semuanya dibatalkan tidak memblokir', async () => {
           const kunci = `tindak_lanjut_tertahan:${id.ND9}`;
           expect((await daftar('tu')).data.some(item => item.kunci === kunci)).toBe(true);
           await database.exec(`UPDATE rangkaian_relasi SET cancelled_at = now(), cancelled_by = '${pengguna.tu.id}', cancellation_reason = 'Relasi salah pilih saat uji' WHERE rangkaian_id = '${id.R2}'`);
           expect((await daftar('tu')).data.some(item => item.kunci === kunci)).toBe(false);
           const { anggotaMemblokirSql } = await import('../services/rangkaian.service');
           const { sql } = await import('drizzle-orm');
           const rows = (await holder.db.execute(sql`SELECT ${anggotaMemblokirSql(sql`${id.R2}::uuid`)} AS n`)).rows as Array<{ n: number }>;
           expect(rows[0].n).toBe(0);
       });

       it('siap_diberkaskan tetap tampil tetapi tanpa berkaskan bila ada penghalang', async () => {
           const sk = await insertSuratKeluar(database, { n: 62, unit: 'dir_bppt', nomor: 'ND-62/2026', tanggal: '2026-09-17', perihal: 'Draf lanjutan' });
           await database.exec(`UPDATE surat_keluar SET approval_status = 'draft', asal_naskah = 'tindak_lanjut' WHERE id = '${sk}';
               INSERT INTO rangkaian_anggota (rangkaian_id, surat_keluar_id, unit_kerja_id, peran) VALUES ('${id.R6}', '${sk}', 'dir_bppt', 'anggota');`);
           const item = (await daftar('bppt')).data.find(row => row.kunci === `siap_diberkaskan:${id.R6}`);
           expect(item).toBeDefined();
           expect(item!.aksiDiizinkan).toEqual([]);
       });

       it('pengawas di luar cakupan pencatat tidak ditawari berkaskan', async () => {
           await seedUnits(database, [{ id: 'bagian_umum', name: 'Bagian Umum' }]);
           const smB = await insertSuratMasuk(database, { n: 70, unit: 'bagian_umum', nomor: 'SM-70/2026', tanggal: '2026-09-20', perihal: 'Surat bagian' });
           const rB = await insertRangkaian(database, { n: 70, kode: 'RS-2026-000070', tahun: 2026, pencatat: 'bagian_umum', status: 'selesai', judul: 'Surat bagian',
               anggota: [{ jenis: 'surat_masuk', id: smB, peran: 'induk', unit: 'bagian_umum' }] });
           await insertDisposisi(database, { suratMasukId: smB, sumber: 'bagian_umum', target: 'sesditjen', status: 'received', rangkaianId: rB.id });
           await database.exec(`UPDATE surat_distributions SET status = 'processed', processed_at = now() WHERE surat_masuk_id = '${smB}'`);
           const item = (await daftar('tu')).data.find(row => row.kunci === `siap_diberkaskan:${rB.id}`);
           expect(item).toBeDefined();
           expect(item!.aksiDiizinkan).toEqual([]);
           expect((await daftar('superAdmin')).data.find(row => row.kunci === `siap_diberkaskan:${rB.id}`)!.aksiDiizinkan).toEqual(['berkaskan']);
       });

       it('tandai_inisiatif tidak ditawarkan untuk surat keluar ber-balasan_untuk; super_admin tidak mendapat buka_kotak_disposisi', async () => {
           await database.exec(`UPDATE surat_keluar SET balasan_untuk = '${id.SM1}' WHERE id = '${id.SK10}'`);
           expect((await daftar('bppt')).data.find(item => item.kunci === `sk_tanpa_asal:${id.SK10}`)!.aksiDiizinkan).toEqual(['buka_surat', 'tautkan']);
           const disposisi = (await daftar('superAdmin', { kategori: 'disposisi_terbuka' })).data;
           expect(disposisi.every(item => !item.aksiDiizinkan.includes('buka_kotak_disposisi'))).toBe(true);
       });
   });
   ```
   `daftar(nama, filter)` is the helper the plan's test file already defines, and `insertDisposisi` needs to be imported from `./helpers/lacak-pglite`. Step 4 Expected: PASS (15 + 6 Task 5 tests). If the P3 aksi table gives a different set for an existing expectation, stop and compare with `GET /api/surat-*/:id` `aksiDiizinkan` for the same fixture user. Do not edit the expectation to match.
10. **Data-lama flag for NULL rows (ADVISORY) [P4-T16-7] RECHECK-AFTER-P3.** In `cabangDisposisiTerbuka`, use `const dataLama = sql\`(CASE WHEN d.rangkaian_id IS NULL THEN ${dataLamaSurat(k, t)} ELSE coalesce(rs.asal = 'data_lama', false) END)\`;`.
    - **(delta P3) Qualified.** The P3 exit criterion (`RUNBOOK_INTEGRASI_SURAT_P3.md` §3, :62-76) requires `sisaTanpaRangkaian: 0`. However, backfill rows skipped as `dilewati` keep `rangkaian_id` NULL (script :70-76), and no runtime path can fill them: 0046 `rangkaian_guard_closed` (:257-312) has no GUC bypass. So NULL rows can persist in production until P5 decides (P5-C-3). They are `processed`/`rejected` by construction and never `sent`/`received`, so `disposisi_terbuka` stays unaffected in practice. Keep the clause as defence in depth.
11. **Self-consistency (ADVISORY) [P4-T16-8].** In File Structure (P4:71), change "(Task 5) mengekspor `lingkupRangkaianSql`" to "(Task 16) mengekspor `lingkupRangkaianSql`".
12. **Typecheck and follow-up (REQUIRED).** Step 4 adds `cd backend && npx tsc --noEmit -p tsconfig.json`. If Task 7 already exists, add the ringkasan timing case to `integration/lacak-explain.postgres.test.ts` (P4-T7-2) in this task's commit.
13. **(delta P3) One definition of "sudah ditindaklanjuti" (REQUIRED; carry-forwards: P3 concurrency #5, spec review "P4 Task 1", ledger `progress.md:227`).**
    - spec:656 counts a legacy `balasan_untuk` from a live SK as handled, and the D7 branch `cabangSmBelumDitindaklanjuti` does so (P4:4075).
    - Real P3 `statusAlur` does not. `adaTindakLanjutSql` (`rangkaian/aksi.ts:115-120`) looks only at relasi, so an SM answered only through `balasan_untuk` shows `didisposisikan`/`terdaftar` on its detail page while being absent from the D7 queue.
    - Binding: extend `adaTindakLanjutSql` to `(<existing EXISTS> OR EXISTS (SELECT 1 FROM surat_keluar bk WHERE bk.balasan_untuk = <sm id> AND bk.is_deleted IS NOT TRUE))`.
      - This applies to the surat-masuk query only. Pass the SM id as a parameter (`sm.id` in the `surat_masuk` branch of `suratAksiPayload`, :138-145).
      - For surat keluar (:146-153), keep the existing relasi check.
    - Keep "no approval filter", as in both P3 and D7 (spec:656 says "hidup").
    - Add one PGlite case in which an SM answered only by a legacy `balasan_untuk` gets `statusAlur` `ditindaklanjuti` and is absent from `sm_belum_ditindaklanjuti`.
    - Record in the PR that P1's auto-selesai fact counts only approved replies (a different fact, intentionally).
14. **(delta P3) Single pengawas predicate (ADVISORY; P3 access carry-forward 4).**
    - P3 asks for one `pengawasMurniUntukUnit` in deps (no super_admin shortcut, CTRL-1), shared by Tutup, `aksi.ts` and `isGrantEligible`. That predicate is for Tutup and grant eligibility. D7 `berkaskan` needs the super_admin-inclusive tier (`pengawasUntukUnit`, `deps.ts:96-104`).
    - Do not create a fourth copy. Either:
      - (preferred) add to `deps.ts` a pure `pengawasUntukKonteks(user, ctx: KonteksBaca, unit)` = `user.role === 'super_admin' || (isFullAdmin(user) && ctx.pengawas && dalamCakupanPengawas(unit))`, make `pengawasUntukUnit` delegate to it, and use it for `pengawasUntuk` in D7; or
      - keep the in-process `pengawasUntuk` with its comment, and add a unit test asserting equality with `pengawasUntukUnit` for super_admin, an in-scope pengawas, an out-of-scope pengawas and staff.
15. **(delta P3) Spec-owner note for `sm_belum_ditindaklanjuti` (release gate, Global item 7).** A `tautan` by `anggotaId` from any participant unit closes this category for an SM that unit cannot read (P3 access carry-forward 7). D7 implements spec:656 as written. The gate row records whether the owner accepts this.



### Task 17: Tandai Inisiatif (`asalNaskahService.tandaiInisiatif`) — pemilik saja, diaudit, berlaku pada surat terarsip (D7)

Skema update P3 tidak memuat `asalNaskah` (Task 1 Step 2), sehingga belum ada jalur untuk menandai surat keluar lama sebagai inisiatif. Task ini menambah jalur tunggal tersebut. Pemeriksaan pada `0021_archive_source_domain_integrity.sql`: fungsi `protect_archived_surat_source()` (trigger `surat_keluar_archived_source_guard`, `BEFORE UPDATE OR DELETE`) hanya menolak perubahan `id`, `is_archived`, `is_deleted`, serta `unit_kerja_id`/`tahun`/`nomor_surat`/`tanggal_surat`/`perihal`/kode klasifikasi yang menyimpang dari arsip. Karena `asal_naskah` dan `updated_at` tidak dijaga, pembaruan boleh dilakukan pada surat `approved` maupun terarsip. Tidak ada trigger lain pada `surat_keluar`.

**Files:**
- Create: `backend/src/services/asal-naskah.service.ts`
- Create: `backend/src/__tests__/asal-naskah.integration.test.ts`

**Interfaces:**
- Consumes (P2): `resolveKonteksBaca`, `visibleSql(ctx, target, 'list')`, `barisDari` (`visibility-spec.ts`); `isAllowedForRecordUnit` (`record-access.service.ts`)
- Consumes (P3): `isFullAdmin` (`services/rangkaian/roles.ts`)
- Consumes (repo): `auditLogService.logActionOrThrow(data, executor)`, `CriticalAuditContext`, `NotFoundError`, `ConflictError`
- Consumes (Task 3): helper `lacak-pglite.ts`
- Produces:
  - `asalNaskahService.tandaiInisiatif(user: { id: string; role: string; unitKerjaId: string | null }, suratKeluarId: string, audit: CriticalAuditContext): Promise<{ id: string; asalNaskah: 'inisiatif' }>`
  - `PESAN_ASAL_SUDAH_ADA = 'Asal naskah surat ini sudah ditetapkan.'`
  - `PESAN_BUKAN_INISIATIF = 'Surat ini menindaklanjuti surat lain; tautkan relasinya alih-alih menandai inisiatif.'`
  - Galat: `NotFoundError('Surat keluar')` (404 seragam, tanpa oracle) untuk surat tidak ada/terhapus, bukan FULL_ADMIN, bukan unit pemilik, atau tidak lolos kebijakan list; `ConflictError` (409) untuk asal terisi atau surat yang menindaklanjuti surat lain
  - Audit `{ action: 'update', entityType: 'surat_keluar', changes: { before: { asalNaskah: null }, after: { asalNaskah: 'inisiatif' }, fields: ['asalNaskah'], sumber: 'perlu_dilengkapi', approvalStatus, isArchived } }` di transaksi yang sama

- [ ] **Step 1: Tulis tes yang gagal**

```ts
// backend/src/__tests__/asal-naskah.integration.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema';
import {
    createMigratedPglite, insertRangkaian, insertRelasi, insertSuratKeluar, insertSuratMasuk, insertUser,
    resetRangkaianFixture, seedUnits, uid, type PenggunaUji,
} from './helpers/lacak-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ db: holder.db }));

let database: PGlite;
let asalNaskahService: typeof import('../services/asal-naskah.service').asalNaskahService;
let auditLogService: typeof import('../services/audit-log.service').auditLogService;

const pengguna = {
    bppt: { id: uid(901), email: 'bppt@example.test', name: 'Admin BPPT', role: 'admin_unit', unitKerjaId: 'dir_bppt' },
    ptep: { id: uid(902), email: 'ptep@example.test', name: 'Admin PTEP', role: 'admin_unit', unitKerjaId: 'dir_ptep' },
    tu: { id: uid(903), email: 'tu@example.test', name: 'Admin TU', role: 'admin_unit', unitKerjaId: 'sesditjen' },
    staffBppt: { id: uid(904), email: 'staff@example.test', name: 'Staff BPPT', role: 'staff', unitKerjaId: 'dir_bppt' },
    superAdmin: { id: uid(906), email: 'super@example.test', name: 'Super Admin', role: 'super_admin', unitKerjaId: null },
} satisfies Record<string, PenggunaUji>;
const audit = (user: PenggunaUji) => ({ userId: user.id, userEmail: user.email });
const sk: Record<'lama' | 'arsip' | 'rahasia' | 'sudahAsal' | 'balasan' | 'relasi' | 'terhapus', string> = {} as never;
const asalDari = async (id: string) =>
    (await database.query<{ asal_naskah: string | null }>('SELECT asal_naskah FROM surat_keluar WHERE id = $1', [id])).rows[0].asal_naskah;

beforeAll(async () => {
    database = await createMigratedPglite();
    holder.db = drizzle(database, { schema });
    ({ asalNaskahService } = await import('../services/asal-naskah.service'));
    ({ auditLogService } = await import('../services/audit-log.service'));
}, 180_000);
afterAll(async () => { await database?.close(); });

beforeEach(async () => {
    vi.restoreAllMocks();
    // arsip.source_surat_id polimorfik tanpa FK: kosongkan lebih dulu agar id surat deterministik tidak bertabrakan.
    await database.exec('TRUNCATE arsip CASCADE');
    await resetRangkaianFixture(database);
    await seedUnits(database, [
        { id: 'sesditjen', name: 'Sesditjen', pengawas: true },
        { id: 'dir_bppt', name: 'Dit. BPPT' },
        { id: 'dir_ptep', name: 'Dit. PTEP' },
    ]);
    for (const user of Object.values(pengguna)) await insertUser(database, user);
    sk.lama = await insertSuratKeluar(database, { n: 1, unit: 'dir_bppt', nomor: 'ND-1/2025', tanggal: '2025-03-01' });
    sk.arsip = await insertSuratKeluar(database, { n: 2, unit: 'dir_bppt', nomor: 'ND-2/2025', tanggal: '2025-03-02' });
    sk.rahasia = await insertSuratKeluar(database, { n: 3, unit: 'dir_bppt', nomor: 'ND-3/2025', tanggal: '2025-03-03', klasifikasi: 'rahasia' });
    sk.sudahAsal = await insertSuratKeluar(database, { n: 4, unit: 'dir_bppt', nomor: 'ND-4/2026', tanggal: '2026-03-04' });
    sk.balasan = await insertSuratKeluar(database, { n: 5, unit: 'dir_bppt', nomor: 'ND-5/2025', tanggal: '2025-03-05' });
    sk.relasi = await insertSuratKeluar(database, { n: 6, unit: 'dir_bppt', nomor: 'ND-6/2025', tanggal: '2025-03-06' });
    sk.terhapus = await insertSuratKeluar(database, { n: 7, unit: 'dir_bppt', nomor: 'ND-7/2025', tanggal: '2025-03-07' });
    const smBppt = await insertSuratMasuk(database, { n: 50, unit: 'dir_bppt', nomor: 'SM-50/2025', tanggal: '2025-02-01' });
    const smTu = await insertSuratMasuk(database, { n: 51, unit: 'sesditjen', nomor: 'SM-51/2025', tanggal: '2025-02-02' });
    const r = await insertRangkaian(database, {
        n: 1, kode: 'RS-2025-000001', tahun: 2025, pencatat: 'sesditjen', judul: 'Permintaan data',
        anggota: [{ jenis: 'surat_masuk', id: smTu, peran: 'induk', unit: 'sesditjen' }, { jenis: 'surat_keluar', id: sk.relasi, unit: 'dir_bppt' }],
    });
    await insertRelasi(database, { rangkaianId: r.id, dari: r.anggota[1], ke: r.anggota[0], jenis: 'tindak_lanjut' });
    await database.exec(`
        UPDATE surat_keluar SET klasifikasi_keamanan = NULL WHERE id = '${sk.lama}';
        UPDATE surat_keluar SET asal_naskah = 'tindak_lanjut' WHERE id = '${sk.sudahAsal}';
        UPDATE surat_keluar SET balasan_untuk = '${smBppt}' WHERE id = '${sk.balasan}';
        UPDATE surat_keluar SET is_deleted = true WHERE id = '${sk.terhapus}';
        INSERT INTO arsip (unit_kerja_id, jenis_arsip, source_surat_id, tahun, nomor_surat_original, tanggal_surat_original, perihal_original)
        VALUES ('dir_bppt', 'keluar', '${sk.arsip}', 2025, 'ND-2/2025', '2025-03-02', 'Undangan rapat');
    `);
});

describe('asalNaskahService.tandaiInisiatif (D7)', () => {
    it('pemilik menandai surat keluar lama (klasifikasi NULL = Terbatas) dan menulis audit di transaksi yang sama', async () => {
        await expect(asalNaskahService.tandaiInisiatif(pengguna.bppt, sk.lama, audit(pengguna.bppt)))
            .resolves.toEqual({ id: sk.lama, asalNaskah: 'inisiatif' });
        expect(await asalDari(sk.lama)).toBe('inisiatif');
        const log = await database.query<{ action: string; entity_type: string; user_id: string; changes: any }>(
            'SELECT action, entity_type, user_id, changes FROM audit_log WHERE entity_id = $1', [sk.lama]);
        expect(log.rows).toHaveLength(1);
        expect(log.rows[0]).toMatchObject({
            action: 'update', entity_type: 'surat_keluar', user_id: pengguna.bppt.id,
            changes: { before: { asalNaskah: null }, after: { asalNaskah: 'inisiatif' }, fields: ['asalNaskah'], sumber: 'perlu_dilengkapi', approvalStatus: 'approved', isArchived: false },
        });
    });

    it('berlaku pada surat terarsip: trigger 0021 tidak menjaga asal_naskah, tetapi tetap menjaga perihal', async () => {
        const arsip = await database.query<{ is_archived: boolean }>('SELECT is_archived FROM surat_keluar WHERE id = $1', [sk.arsip]);
        expect(arsip.rows[0].is_archived).toBe(true);
        await expect(asalNaskahService.tandaiInisiatif(pengguna.bppt, sk.arsip, audit(pengguna.bppt)))
            .resolves.toEqual({ id: sk.arsip, asalNaskah: 'inisiatif' });
        expect(await asalDari(sk.arsip)).toBe('inisiatif');
        await expect(database.query(`UPDATE surat_keluar SET perihal = 'Perihal diubah' WHERE id = $1`, [sk.arsip]))
            .rejects.toThrow(/cannot diverge/i);
    });

    it('super_admin boleh menandai surat unit mana pun', async () => {
        await expect(asalNaskahService.tandaiInisiatif(pengguna.superAdmin, sk.lama, audit(pengguna.superAdmin)))
            .resolves.toMatchObject({ asalNaskah: 'inisiatif' });
    });

    it.each([
        ['unit lain', 'ptep', 'lama'],
        ['pengawas yang bukan pemilik', 'tu', 'lama'],
        ['role read-only di unit pemilik', 'staffBppt', 'lama'],
        ['kelas di luar kebijakan list pemilik', 'bppt', 'rahasia'],
        ['surat terhapus', 'bppt', 'terhapus'],
    ] as const)('404 seragam untuk %s, tanpa perubahan', async (_label, nama, surat) => {
        await expect(asalNaskahService.tandaiInisiatif(pengguna[nama], sk[surat], audit(pengguna[nama])))
            .rejects.toMatchObject({ statusCode: 404, message: 'Surat keluar tidak ditemukan.' });
        expect(await asalDari(sk[surat])).toBeNull();
    });

    it('404 untuk id yang tidak ada', async () => {
        await expect(asalNaskahService.tandaiInisiatif(pengguna.bppt, uid(999), audit(pengguna.bppt)))
            .rejects.toMatchObject({ statusCode: 404 });
    });

    it.each([
        ['asal sudah terisi', 'sudahAsal', 'Asal naskah surat ini sudah ditetapkan.'],
        ['balasan_untuk terisi', 'balasan', 'Surat ini menindaklanjuti surat lain; tautkan relasinya alih-alih menandai inisiatif.'],
        ['sisi dari relasi aktif', 'relasi', 'Surat ini menindaklanjuti surat lain; tautkan relasinya alih-alih menandai inisiatif.'],
    ] as const)('409 bila %s', async (_label, surat, pesan) => {
        await expect(asalNaskahService.tandaiInisiatif(pengguna.bppt, sk[surat], audit(pengguna.bppt)))
            .rejects.toMatchObject({ statusCode: 409, message: pesan });
    });

    it('UPDATE dibatalkan bila audit gagal (transaksi yang sama)', async () => {
        vi.spyOn(auditLogService, 'logActionOrThrow').mockRejectedValueOnce(new Error('audit mati'));
        await expect(asalNaskahService.tandaiInisiatif(pengguna.bppt, sk.lama, audit(pengguna.bppt))).rejects.toThrow('audit mati');
        expect(await asalDari(sk.lama)).toBeNull();
    });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `(cd backend && npx vitest run src/__tests__/asal-naskah.integration.test.ts)`
Expected: FAIL. Impor dinamis `../services/asal-naskah.service` di `beforeAll` gagal karena modul belum ada, sehingga seluruh tes di berkas ini gagal.

- [ ] **Step 3: Implementasi minimal**

```ts
// backend/src/services/asal-naskah.service.ts
import { sql } from 'drizzle-orm';
import { db } from '../config/database.js';
import { auditLogService, type CriticalAuditContext } from './audit-log.service.js';
import { barisDari, resolveKonteksBaca, visibleSql } from './access/visibility-spec.js';
import { isAllowedForRecordUnit } from './record-access.service.js';
import { isFullAdmin } from './rangkaian/roles.js';
import { ConflictError, NotFoundError } from '../utils/errors.js';

export const PESAN_ASAL_SUDAH_ADA = 'Asal naskah surat ini sudah ditetapkan.';
export const PESAN_BUKAN_INISIATIF = 'Surat ini menindaklanjuti surat lain; tautkan relasinya alih-alih menandai inisiatif.';

type PenggunaAsalNaskah = { id: string; role: string; unitKerjaId: string | null };
type BarisSuratKeluar = {
    id: string; unit_kerja_id: string; asal_naskah: string | null; balasan_untuk: string | null;
    approval_status: string; is_archived: boolean | null; terlihat: boolean; tindak_lanjut: boolean;
};

export const asalNaskahService = {
    /**
     * D7: tetapkan asal_naskah='inisiatif' pada surat keluar yang belum punya asal.
     * Hanya pemilik (FULL_ADMIN + unit pemilik + lolos kebijakan list). Sengaja tidak memakai check():
     * check() mensyaratkan grant untuk Terbatas, termasuk surat lama berklasifikasi NULL, padahal yang diubah
     * hanya metadata alur kerja dan respons tidak memuat isi surat. Berlaku juga untuk surat approved/terarsip:
     * trigger 0021 tidak menjaga asal_naskah.
     */
    async tandaiInisiatif(user: PenggunaAsalNaskah, suratKeluarId: string, audit: CriticalAuditContext) {
        return db.transaction(async (tx) => {
            const ctx = await resolveKonteksBaca(user, tx);
            const [row] = barisDari<BarisSuratKeluar>(await tx.execute(sql`
                SELECT sk.id, sk.unit_kerja_id, sk.asal_naskah, sk.balasan_untuk, sk.approval_status, sk.is_archived,
                       coalesce(${visibleSql(ctx, { type: 'surat_keluar', alias: 'sk' }, 'list')}, false) AS terlihat,
                       EXISTS (SELECT 1 FROM rangkaian_anggota ax
                                 JOIN rangkaian_relasi rx ON rx.dari_anggota_id = ax.id AND rx.cancelled_at IS NULL
                                WHERE ax.surat_keluar_id = sk.id) AS tindak_lanjut
                  FROM surat_keluar sk
                 WHERE sk.id = ${suratKeluarId} AND sk.is_deleted IS NOT TRUE
                 FOR UPDATE OF sk`));
            // 404 seragam: tidak membedakan "tidak ada" dari "bukan milik Anda" (tanpa oracle).
            if (!row || !isFullAdmin(user) || !isAllowedForRecordUnit(user, row.unit_kerja_id) || !row.terlihat) {
                throw new NotFoundError('Surat keluar');
            }
            if (row.asal_naskah !== null) throw new ConflictError(PESAN_ASAL_SUDAH_ADA);
            if (row.balasan_untuk !== null || row.tindak_lanjut) throw new ConflictError(PESAN_BUKAN_INISIATIF);

            await tx.execute(sql`
                UPDATE surat_keluar SET asal_naskah = 'inisiatif', updated_at = now()
                 WHERE id = ${suratKeluarId} AND asal_naskah IS NULL`);
            await auditLogService.logActionOrThrow({
                ...audit,
                action: 'update',
                entityType: 'surat_keluar',
                entityId: suratKeluarId,
                changes: {
                    before: { asalNaskah: null }, after: { asalNaskah: 'inisiatif' }, fields: ['asalNaskah'],
                    sumber: 'perlu_dilengkapi', approvalStatus: row.approval_status, isArchived: Boolean(row.is_archived),
                },
            }, tx);
            return { id: suratKeluarId, asalNaskah: 'inisiatif' as const };
        });
    },
};
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `(cd backend && npx vitest run src/__tests__/asal-naskah.integration.test.ts)`
Expected: PASS (13 tes). Bila kasus terarsip gagal dengan `Archived source … cannot be detached`, periksa bahwa UPDATE tidak menyentuh `is_archived`/`is_deleted`. Jangan menambah pengecualian pada trigger 0021.

- [ ] **Step 5: Commit**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
git add backend/src/services/asal-naskah.service.ts backend/src/__tests__/asal-naskah.integration.test.ts
git commit -m "feat(perlu-dilengkapi): tandai surat keluar lama sebagai inisiatif, pemilik saja dan diaudit" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


#### Amandemen pra-eksekusi Task 17 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p4-lacak-surat/preflight-rulings.md`.


1. **Membership rejection (REQUIRED) [P4-T17-1] RECHECK-AFTER-P3.**
   - Add `export const PESAN_SUDAH_ANGGOTA = 'Surat ini sudah menjadi anggota rangkaian; asal naskahnya mengikuti rangkaian itu.';`.
   - In the SELECT, add `EXISTS (SELECT 1 FROM rangkaian_anggota ay WHERE ay.surat_keluar_id = sk.id) AS anggota,` and add `anggota: boolean` to `BarisSuratKeluar`.
   - After the `asal_naskah !== null` check, insert `if (row.anggota) throw new ConflictError(PESAN_SUDAH_ANGGOTA);`.
   - Add a test: an SK with `asal_naskah` NULL that is a rangkaian member with no active relasi (insert the `rangkaian_anggota` row directly) gets 409 `PESAN_SUDAH_ANGGOTA` and no audit row. Expected count: 14 tests.
2. **Audit registry (REQUIRED) [P4-T17-2].** Files: modify `backend/src/__tests__/mutation-audit-policy.test.ts` by adding `'services/asal-naskah.service.ts',` to `transactionalServices`. Step 4 also runs `cd backend && npx vitest run src/__tests__/mutation-audit-policy.test.ts`. Add the file to `git add`.
   - **(delta P3) Confirmed.** The registry is `transactionalServices` at `mutation-audit-policy.test.ts:38-57`. It resolves `src` from `process.cwd()` (:5), so it must run from `backend/`.
   - **ADVISORY addition:** P3 registered none of its own mutation services. In the same edit, also add `'services/rangkaian/berkas.service.ts'`, `'services/rangkaian/rangkaian-link.service.ts'`, `'services/rangkaian/tindak-lanjut.service.ts'` and `'services/rangkaian/disposisi-grant.service.ts'`. Each contains `db.transaction` and `logActionOrThrow`, so the test passes today and guards them from now on. This relates to P3 access M-6 (conditional audit parameters).
   - **Confirmed (T17-1).** P3 `tautan`/`tautanKeSurat` never write `asal_naskah` (`rangkaian-link.service.ts`, no occurrence), so a legacy SK linked by P3 stays `asal_naskah IS NULL` while being a member. The membership rejection is needed.
3. **Release gate (REQUIRED) [P4-T17-3].** See Global item 7.
4. **Typecheck (REQUIRED) [P4-G-5].**



### Task 18: Route Perlu Dilengkapi (`GET /perlu-dilengkapi`, `/ringkasan`, `POST …/tandai-inisiatif`), allowlist demo, dan pemasangan di `app.ts` (D7)

**Files:**
- Create: `backend/src/routes/rangkaian-perlu-dilengkapi.routes.ts`
- Create: `backend/src/__tests__/rangkaian-perlu-dilengkapi.routes.test.ts`
- Modify: `backend/src/validators/schemas.ts` (tambah di akhir file, setelah `daftarRangkaianQuerySchema` Task 6)
- Modify: `backend/src/app.ts` (impor + satu baris tepat setelah `app.use('/api/rangkaian', rangkaianDaftarRoutes);` Task 6)
- Modify: `backend/src/middlewares/demo-access.middleware.ts` (`ALLOWED_METADATA_ROUTES`, setelah entri `exact('/rangkaian')` Task 6)

**Interfaces:**
- Consumes (Task 16): `perluDilengkapiService.list`, `perluDilengkapiService.ringkasan`, `KATEGORI_PERLU_DILENGKAPI` (dari `perlu-dilengkapi.constants.ts`)
- Consumes (Task 17): `asalNaskahService.tandaiInisiatif`
- Consumes (repo): `authMiddleware`, `roleMiddleware(allowedRoles)`, `canWriteMiddleware()`, `validateQuery`, `validateBody`, `validateIdParam(paramName)`, `res.locals.validatedQuery`
- Produces:
  - `perluDilengkapiQuerySchema` (`.strict()`) → `{ kategori?: KategoriPerluDilengkapi; tampilkanDataLama: boolean; page: number; limit: number }` dengan `tampilkanDataLama` dari string `'true'|'false'` (bawaan `false`), `page` 1–10000 (bawaan 1), `limit` 1–50 (bawaan 20); tipe `PerluDilengkapiQuery`
  - `ringkasanPerluDilengkapiQuerySchema` (`.strict()`) → `{ tampilkanDataLama: boolean }`; tipe `RingkasanPerluDilengkapiQuery`
  - `tandaiInisiatifSchema`: body kosong (`undefined` → `{}`), field apa pun → 400
  - `GET /api/rangkaian/perlu-dilengkapi` → `{ success: true, data, pagination, meta }`
  - `GET /api/rangkaian/perlu-dilengkapi/ringkasan` → `{ success: true, data: { perKategori, total, lewatBatas, batasDataLama } }`
  - `POST /api/rangkaian/surat-keluar/:suratKeluarId/tandai-inisiatif` → `{ success: true, data: { id, asalNaskah: 'inisiatif' } }`
  - Pengguna belum terprovisi (`user`) → 403 pada GET; role read-only → 403 pada POST; id bukan UUID → 400
  - Urutan mount: `rangkaianDaftarRoutes` → `rangkaianPerluDilengkapiRoutes` → (`rangkaianBerkasRoutes` P5) → `rangkaianRoutes`

- [ ] **Step 1: Tulis tes yang gagal**

```ts
// backend/src/__tests__/rangkaian-perlu-dilengkapi.routes.test.ts
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoAccessMiddleware } from '../middlewares/demo-access.middleware.js';
import { validateIdParam } from '../middlewares/validate.middleware.js';

const ID = '550e8400-e29b-41d4-a716-446655440000';
const BATAS = '2025-12-31T17:00:00.000Z';
const mocks = vi.hoisted(() => ({
    user: { id: 'user-1', email: 'user@example.test', name: 'Pengguna', role: 'admin_unit', unitKerjaId: 'dir_bppt' as string | null },
    list: vi.fn(),
    ringkasan: vi.fn(),
    tandaiInisiatif: vi.fn(),
}));
vi.mock('../middlewares/auth.middleware.js', () => ({
    authMiddleware: (req: any, _res: any, next: any) => { req.user = { ...mocks.user }; next(); },
}));
vi.mock('../services/perlu-dilengkapi.service.js', () => ({ perluDilengkapiService: { list: mocks.list, ringkasan: mocks.ringkasan } }));
vi.mock('../services/asal-naskah.service.js', () => ({ asalNaskahService: { tandaiInisiatif: mocks.tandaiInisiatif } }));

const { default: router } = await import('../routes/rangkaian-perlu-dilengkapi.routes.js');
const app = express();
app.use(express.json());
app.use('/api/rangkaian', router);
// Router P2/P3 dengan GET /:id dipasang SETELAH router D7 (urutan app.ts); permintaan D7 tidak boleh sampai ke sini.
const routerUtama = express.Router();
routerUtama.get('/:id', validateIdParam(), (_req, res) => { res.json({ tertangkap: true }); });
app.use('/api/rangkaian', routerUtama);

beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mocks.user, { role: 'admin_unit', unitKerjaId: 'dir_bppt' });
    mocks.list.mockResolvedValue({
        data: [{ kunci: 'sk_tanpa_asal:x' }], pagination: { page: 2, limit: 20, total: 21, totalPages: 2 },
        meta: { batasDataLama: BATAS, tampilkanDataLama: true },
    });
    mocks.ringkasan.mockResolvedValue({ perKategori: { sk_tanpa_asal: 3 }, total: 3, lewatBatas: 1, batasDataLama: BATAS });
    mocks.tandaiInisiatif.mockResolvedValue({ id: ID, asalNaskah: 'inisiatif' });
});

describe('GET /api/rangkaian/perlu-dilengkapi', () => {
    it('meneruskan filter tervalidasi dan tidak tertangkap route /:id', async () => {
        const response = await request(app).get('/api/rangkaian/perlu-dilengkapi?kategori=sk_tanpa_asal&tampilkanDataLama=true&page=2').expect(200);
        expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }),
            { kategori: 'sk_tanpa_asal', tampilkanDataLama: true, page: 2, limit: 20 });
        expect(response.body).toEqual({
            success: true, data: [{ kunci: 'sk_tanpa_asal:x' }], pagination: { page: 2, limit: 20, total: 21, totalPages: 2 },
            meta: { batasDataLama: BATAS, tampilkanDataLama: true },
        });
    });

    it('bawaan: tanpa kategori dan tanpa data lama', async () => {
        await request(app).get('/api/rangkaian/perlu-dilengkapi').expect(200);
        expect(mocks.list).toHaveBeenCalledWith(expect.anything(), { tampilkanDataLama: false, page: 1, limit: 20 });
    });

    it.each(['kategori=lainnya', 'tampilkanDataLama=ya', 'limit=51', 'page=0', 'unitKerjaId=ditjen'])('menolak kueri %s dengan 400', async (query) => {
        await request(app).get(`/api/rangkaian/perlu-dilengkapi?${query}`).expect(400);
        expect(mocks.list).not.toHaveBeenCalled();
    });

    it('ringkasan hanya menerima tampilkanDataLama', async () => {
        const response = await request(app).get('/api/rangkaian/perlu-dilengkapi/ringkasan').expect(200);
        expect(mocks.ringkasan).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), { tampilkanDataLama: false });
        expect(response.body).toEqual({ success: true, data: { perKategori: { sk_tanpa_asal: 3 }, total: 3, lewatBatas: 1, batasDataLama: BATAS } });
        await request(app).get('/api/rangkaian/perlu-dilengkapi/ringkasan?kategori=sk_tanpa_asal').expect(400);
        expect(mocks.ringkasan).toHaveBeenCalledTimes(1);
    });

    it('menolak pengguna yang belum terprovisi; staff/auditor boleh membaca (cakupan ditentukan layanan)', async () => {
        Object.assign(mocks.user, { role: 'user', unitKerjaId: null });
        await request(app).get('/api/rangkaian/perlu-dilengkapi').expect(403);
        await request(app).get('/api/rangkaian/perlu-dilengkapi/ringkasan').expect(403);
        Object.assign(mocks.user, { role: 'staff', unitKerjaId: 'sesditjen' });
        await request(app).get('/api/rangkaian/perlu-dilengkapi/ringkasan').expect(200);
        expect(mocks.list).not.toHaveBeenCalled();
    });
});

describe('POST /api/rangkaian/surat-keluar/:suratKeluarId/tandai-inisiatif', () => {
    it('memanggil layanan dengan konteks audit', async () => {
        const response = await request(app).post(`/api/rangkaian/surat-keluar/${ID}/tandai-inisiatif`).send({}).expect(200);
        expect(response.body).toEqual({ success: true, data: { id: ID, asalNaskah: 'inisiatif' } });
        expect(mocks.tandaiInisiatif).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), ID,
            expect.objectContaining({ userId: 'user-1', userEmail: 'user@example.test' }));
    });

    it('tanpa body diterima; body berisi field apa pun ditolak 400', async () => {
        await request(app).post(`/api/rangkaian/surat-keluar/${ID}/tandai-inisiatif`).expect(200);
        await request(app).post(`/api/rangkaian/surat-keluar/${ID}/tandai-inisiatif`).send({ asalNaskah: 'tindak_lanjut' }).expect(400);
        expect(mocks.tandaiInisiatif).toHaveBeenCalledTimes(1);
    });

    it('id bukan UUID → 400; role read-only → 403', async () => {
        await request(app).post('/api/rangkaian/surat-keluar/bukan-uuid/tandai-inisiatif').send({}).expect(400);
        Object.assign(mocks.user, { role: 'staff', unitKerjaId: 'dir_bppt' });
        await request(app).post(`/api/rangkaian/surat-keluar/${ID}/tandai-inisiatif`).send({}).expect(403);
        expect(mocks.tandaiInisiatif).not.toHaveBeenCalled();
    });
});

describe('pemasangan dan allowlist demo', () => {
    it('router D7 dipasang setelah router daftar dan sebelum router rangkaian utama di app.ts', () => {
        const source = fs.readFileSync(path.resolve(process.cwd(), 'src/app.ts'), 'utf8');
        const daftar = source.indexOf("app.use('/api/rangkaian', rangkaianDaftarRoutes)");
        const d7 = source.indexOf("app.use('/api/rangkaian', rangkaianPerluDilengkapiRoutes)");
        const utama = source.indexOf("app.use('/api/rangkaian', rangkaianRoutes)");
        expect(daftar).toBeGreaterThan(-1);
        expect(d7).toBeGreaterThan(daftar);
        expect(utama).toBeGreaterThan(d7);
    });

    it('meneruskan GET daftar/ringkasan dan POST tandai-inisiatif, menolak id bukan UUID', async () => {
        const demo = express();
        let downstream = 0;
        demo.use('/api', createDemoAccessMiddleware(true));
        demo.use('/api', (_req, res) => { downstream += 1; res.json({ success: true }); });
        await request(demo).get('/api/rangkaian/perlu-dilengkapi?tampilkanDataLama=true').expect(200);
        await request(demo).get('/api/rangkaian/perlu-dilengkapi/ringkasan').expect(200);
        await request(demo).post(`/api/rangkaian/surat-keluar/${ID}/tandai-inisiatif`).send({}).expect(200);
        expect(downstream).toBe(3);
        await request(demo).post('/api/rangkaian/surat-keluar/bukan-uuid/tandai-inisiatif').send({}).expect(403);
        expect(downstream).toBe(3);
    });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `(cd backend && npx vitest run src/__tests__/rangkaian-perlu-dilengkapi.routes.test.ts)`
Expected: FAIL, karena `Failed to resolve import "../routes/rangkaian-perlu-dilengkapi.routes.js"`.

- [ ] **Step 3: Implementasi minimal**

Tambah di akhir `backend/src/validators/schemas.ts`, setelah `daftarRangkaianQuerySchema`, beserta impor konstanta di blok impor atas berkas:

```ts
import { KATEGORI_PERLU_DILENGKAPI } from '../services/perlu-dilengkapi.constants.js';
```

```ts
// Perlu Dilengkapi (P4, D7). Kueri tak dikenal ditolak agar unitKerjaId tidak bisa menyelinap.
const benderaQuerySchema = z.enum(['true', 'false']).default('false').transform((value) => value === 'true');
export const perluDilengkapiQuerySchema = z.object({
    kategori: z.enum(KATEGORI_PERLU_DILENGKAPI).optional(),
    tampilkanDataLama: benderaQuerySchema,
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export type PerluDilengkapiQuery = z.infer<typeof perluDilengkapiQuerySchema>;
export const ringkasanPerluDilengkapiQuerySchema = z.object({ tampilkanDataLama: benderaQuerySchema }).strict();
export type RingkasanPerluDilengkapiQuery = z.infer<typeof ringkasanPerluDilengkapiQuerySchema>;
// Body Tandai Inisiatif selalu kosong; express 5 membiarkan req.body undefined bila tidak ada body.
export const tandaiInisiatifSchema = z.preprocess((value) => value ?? {}, z.object({}).strict());
```

```ts
// backend/src/routes/rangkaian-perlu-dilengkapi.routes.ts
import { Router, type NextFunction, type Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middlewares/auth.middleware.js';
import { canWriteMiddleware, roleMiddleware } from '../middlewares/role.middleware.js';
import { validateBody, validateIdParam, validateQuery } from '../middlewares/validate.middleware.js';
import {
    perluDilengkapiQuerySchema, ringkasanPerluDilengkapiQuerySchema, tandaiInisiatifSchema,
    type PerluDilengkapiQuery, type RingkasanPerluDilengkapiQuery,
} from '../validators/schemas.js';
import { perluDilengkapiService } from '../services/perlu-dilengkapi.service.js';
import { asalNaskahService } from '../services/asal-naskah.service.js';

// Middleware per-route (pola Task 6) agar permintaan /api/rangkaian lain jatuh ke router berikutnya tanpa autentikasi ganda.
const router = Router();

router.get(
    '/perlu-dilengkapi/ringkasan',
    authMiddleware,
    roleMiddleware(['super_admin', 'admin_unit', 'admin_dirjen', 'admin_sesditjen', 'staff', 'auditor']),
    validateQuery(ringkasanPerluDilengkapiQuerySchema),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const filter = res.locals.validatedQuery as RingkasanPerluDilengkapiQuery;
            res.json({ success: true, data: await perluDilengkapiService.ringkasan(req.user!, filter) });
        } catch (error) {
            next(error);
        }
    },
);

router.get(
    '/perlu-dilengkapi',
    authMiddleware,
    roleMiddleware(['super_admin', 'admin_unit', 'admin_dirjen', 'admin_sesditjen', 'staff', 'auditor']),
    validateQuery(perluDilengkapiQuerySchema),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const filter = res.locals.validatedQuery as PerluDilengkapiQuery;
            res.json({ success: true, ...(await perluDilengkapiService.list(req.user!, filter)) });
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/surat-keluar/:suratKeluarId/tandai-inisiatif',
    authMiddleware,
    validateIdParam('suratKeluarId'),
    canWriteMiddleware(),
    validateBody(tandaiInisiatifSchema),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const data = await asalNaskahService.tandaiInisiatif(req.user!, req.params.suratKeluarId as string,
                { userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip });
            res.json({ success: true, data });
        } catch (error) {
            next(error);
        }
    },
);

export default router;
```

Di `backend/src/app.ts`, tambah impor di blok impor route (di bawah impor `rangkaianDaftarRoutes` Task 6):

```ts
import rangkaianPerluDilengkapiRoutes from './routes/rangkaian-perlu-dilengkapi.routes.js';
```

Lalu sisipkan tepat **setelah** baris `app.use('/api/rangkaian', rangkaianDaftarRoutes);`:

```ts
app.use('/api/rangkaian', rangkaianPerluDilengkapiRoutes); // P4 Task 18 (D7), auth per-route; sebelum router berkas P5 dan router utama
```

Di `backend/src/middlewares/demo-access.middleware.ts`, dalam `ALLOWED_METADATA_ROUTES`, tambahkan setelah entri `{ methods: GET, path: exact('/rangkaian') }` Task 6:

```ts
    { methods: GET, path: exact('/rangkaian/perlu-dilengkapi(?:/ringkasan)?') },
    { methods: POST, path: exact(`/rangkaian/surat-keluar/${UUID}/tandai-inisiatif`) },
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `(cd backend && npx vitest run src/__tests__/rangkaian-perlu-dilengkapi.routes.test.ts src/__tests__/rangkaian-daftar.routes.test.ts src/__tests__/demo-access.middleware.test.ts)`
Expected: PASS (14 tes di berkas baru), dan tes Task 6 serta demo lama tetap hijau.

- [ ] **Step 5: Commit**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
git add backend/src/routes/rangkaian-perlu-dilengkapi.routes.ts backend/src/__tests__/rangkaian-perlu-dilengkapi.routes.test.ts backend/src/validators/schemas.ts backend/src/app.ts backend/src/middlewares/demo-access.middleware.ts
git commit -m "feat(perlu-dilengkapi): endpoint daftar, ringkasan, dan tandai inisiatif di /api/rangkaian" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


#### Amandemen pra-eksekusi Task 18 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p4-lacak-surat/preflight-rulings.md`.


1. **Anchors and middleware (ADVISORY) [P4-T18-1, P4-G-8] RECHECK-AFTER-P3.** Insert the mount directly after the `app.use('/api/rangkaian', rangkaianDaftarRoutes);` line, and the allowlist entries directly after the Task 6 `exact('/rangkaian')` entry, located by text. Use `canReadMiddleware()` for the two GETs. The route tests are unchanged. Add `cd backend && npx tsc --noEmit -p tsconfig.json` to Step 4.
   - **(delta P3) Confirmed.** P3 has a single rangkaian mount, `app.use('/api/rangkaian', rangkaianRoutes);` (`app.ts:372`), after `distributionRoutes` (:371). P3 adds no second rangkaian router, so the P4 order daftar → D7 → utama holds.



### Task 19: Klien Perlu Dilengkapi — `lib/perlu-dilengkapi.js` dan metode `rangkaianService` (D7)

**Files:**
- Create: `frontend/src/lib/perlu-dilengkapi.js`
- Create: `frontend/src/lib/perlu-dilengkapi.test.js`
- Create: `frontend/src/services/rangkaian.service.perlu-dilengkapi.test.js`
- Modify: `frontend/src/services/rangkaian.service.js` (objek `rangkaianService`, setelah metode `unitKerjaOpsi` Task 9)

**Interfaces:**
- Consumes (repo): `api.get(endpoint, params, { signal })` dan `api.post(endpoint, body)` (`services/api.js`, parameter `undefined` disaring)
- Consumes (Task 18): `GET /api/rangkaian/perlu-dilengkapi`, `GET /api/rangkaian/perlu-dilengkapi/ringkasan`, `POST /api/rangkaian/surat-keluar/:suratKeluarId/tandai-inisiatif`
- Produces (`lib/perlu-dilengkapi.js`):
  - `KATEGORI_PERLU_DILENGKAPI` (urutan sama dengan backend)
  - `LABEL_KATEGORI_PERLU_DILENGKAPI` dan `LABEL_STATUS_DISPOSISI`
  - `PERLU_DILENGKAPI_REFRESH_MS = 60_000`
  - `PERLU_DILENGKAPI_EVENT = 'simsa:perlu-dilengkapi-ringkasan'`
  - `formatJumlahBadge(jumlah): string` (≥100 → `'99+'`)
  - `umumkanRingkasanPerluDilengkapi(ringkasan)`, yang mengirim `CustomEvent` dengan `detail: { total }`
- Produces (`rangkaianService`):
  - `perluDilengkapi({ kategori, tampilkanDataLama = false, page = 1, limit = 20 } = {})` → respons utuh `{ success, data, pagination, meta }` untuk `usePaginatedResource`; `tampilkanDataLama` hanya dikirim sebagai `'true'`
  - `ringkasanPerluDilengkapi({ tampilkanDataLama = false } = {}, { signal } = {})` → `data` (`{ perKategori, total, lewatBatas, batasDataLama }`)
  - `tandaiInisiatif(suratKeluarId)` → `data` (`{ id, asalNaskah: 'inisiatif' }`)

- [ ] **Step 1: Tulis tes yang gagal**

```js
// frontend/src/lib/perlu-dilengkapi.test.js
import { describe, expect, it, vi } from 'vitest'
import {
    formatJumlahBadge, KATEGORI_PERLU_DILENGKAPI, LABEL_KATEGORI_PERLU_DILENGKAPI, LABEL_STATUS_DISPOSISI,
    PERLU_DILENGKAPI_EVENT, PERLU_DILENGKAPI_REFRESH_MS, umumkanRingkasanPerluDilengkapi,
} from './perlu-dilengkapi'

describe('lib Perlu Dilengkapi (D7)', () => {
    it('kategori sama dengan kontrak backend dan setiap kategori berlabel', () => {
        expect(KATEGORI_PERLU_DILENGKAPI).toEqual([
            'sm_belum_ditindaklanjuti', 'disposisi_terbuka', 'sk_tanpa_nd_penjelas',
            'tindak_lanjut_tertahan', 'siap_diberkaskan', 'sk_tanpa_asal',
        ])
        for (const kategori of KATEGORI_PERLU_DILENGKAPI) expect(LABEL_KATEGORI_PERLU_DILENGKAPI[kategori]).toMatch(/\S/)
        expect(LABEL_STATUS_DISPOSISI).toMatchObject({ sent: 'Terkirim', received: 'Diterima' })
    })
    it('irama badge sama dengan notifikasi (60 detik)', () => {
        expect(PERLU_DILENGKAPI_REFRESH_MS).toBe(60_000)
    })
    it('format jumlah badge', () => {
        expect(formatJumlahBadge(7)).toBe('7')
        expect(formatJumlahBadge(99)).toBe('99')
        expect(formatJumlahBadge(100)).toBe('99+')
    })
    it('mengumumkan total ringkasan lewat event window dan mengabaikan ringkasan rusak', () => {
        const pendengar = vi.fn()
        window.addEventListener(PERLU_DILENGKAPI_EVENT, pendengar)
        umumkanRingkasanPerluDilengkapi({ total: 4, perKategori: {} })
        umumkanRingkasanPerluDilengkapi(null)
        window.removeEventListener(PERLU_DILENGKAPI_EVENT, pendengar)
        expect(pendengar).toHaveBeenCalledTimes(1)
        expect(pendengar.mock.calls[0][0].detail).toEqual({ total: 4 })
    })
})
```

```js
// frontend/src/services/rangkaian.service.perlu-dilengkapi.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('./api', () => ({ default: { get: mocks.get, post: mocks.post }, api: { get: mocks.get, post: mocks.post } }))
import rangkaianService from './rangkaian.service'

beforeEach(() => vi.clearAllMocks())

describe('rangkaianService — Perlu Dilengkapi (D7)', () => {
    it('perluDilengkapi mengembalikan respons utuh; data lama hanya dikirim bila diminta', async () => {
        const response = { success: true, data: [], pagination: { total: 0 }, meta: {} }
        mocks.get.mockResolvedValue(response)
        await expect(rangkaianService.perluDilengkapi({ kategori: 'sk_tanpa_asal', page: 2 })).resolves.toBe(response)
        expect(mocks.get).toHaveBeenLastCalledWith('/api/rangkaian/perlu-dilengkapi',
            { kategori: 'sk_tanpa_asal', tampilkanDataLama: undefined, page: 2, limit: 20 })
        await rangkaianService.perluDilengkapi({ tampilkanDataLama: true })
        expect(mocks.get).toHaveBeenLastCalledWith('/api/rangkaian/perlu-dilengkapi',
            { kategori: undefined, tampilkanDataLama: 'true', page: 1, limit: 20 })
    })
    it('ringkasanPerluDilengkapi meneruskan AbortSignal dan mengembalikan data', async () => {
        const controller = new AbortController()
        mocks.get.mockResolvedValue({ success: true, data: { total: 5 } })
        await expect(rangkaianService.ringkasanPerluDilengkapi({}, { signal: controller.signal })).resolves.toEqual({ total: 5 })
        expect(mocks.get).toHaveBeenCalledWith('/api/rangkaian/perlu-dilengkapi/ringkasan', { tampilkanDataLama: undefined }, { signal: controller.signal })
    })
    it('tandaiInisiatif mengirim POST dengan body kosong', async () => {
        mocks.post.mockResolvedValue({ success: true, data: { id: 'sk-1', asalNaskah: 'inisiatif' } })
        await expect(rangkaianService.tandaiInisiatif('sk-1')).resolves.toEqual({ id: 'sk-1', asalNaskah: 'inisiatif' })
        expect(mocks.post).toHaveBeenCalledWith('/api/rangkaian/surat-keluar/sk-1/tandai-inisiatif', {})
    })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `(cd frontend && npx vitest run src/lib/perlu-dilengkapi.test.js src/services/rangkaian.service.perlu-dilengkapi.test.js)`
Expected: FAIL. `Failed to resolve import "./perlu-dilengkapi"`, dan `rangkaianService.perluDilengkapi is not a function`.

- [ ] **Step 3: Implementasi minimal**

```js
// frontend/src/lib/perlu-dilengkapi.js
/** Kode kategori D7. Cermin backend/src/services/perlu-dilengkapi.constants.ts dengan urutan sama. */
export const KATEGORI_PERLU_DILENGKAPI = [
    'sm_belum_ditindaklanjuti',
    'disposisi_terbuka',
    'sk_tanpa_nd_penjelas',
    'tindak_lanjut_tertahan',
    'siap_diberkaskan',
    'sk_tanpa_asal',
]

export const LABEL_KATEGORI_PERLU_DILENGKAPI = Object.freeze({
    sm_belum_ditindaklanjuti: 'Surat masuk belum ditindaklanjuti',
    disposisi_terbuka: 'Disposisi belum selesai',
    sk_tanpa_nd_penjelas: 'Keputusan tanpa ND penjelas',
    tindak_lanjut_tertahan: 'Tindak lanjut tertahan',
    siap_diberkaskan: 'Siap diberkaskan',
    sk_tanpa_asal: 'Surat keluar tanpa asal',
})

export const LABEL_STATUS_DISPOSISI = Object.freeze({
    sent: 'Terkirim',
    received: 'Diterima',
    processed: 'Selesai',
    rejected: 'Ditolak',
})

/** Irama badge = irama notifikasi (useNotifications / app-header: refreshInterval 60000). */
export const PERLU_DILENGKAPI_REFRESH_MS = 60_000
export const PERLU_DILENGKAPI_EVENT = 'simsa:perlu-dilengkapi-ringkasan'

export function formatJumlahBadge(jumlah) {
    return jumlah > 99 ? '99+' : String(jumlah)
}

/** Tab Perlu Dilengkapi membagikan ringkasan terbarunya ke badge sidebar tanpa request tambahan. */
export function umumkanRingkasanPerluDilengkapi(ringkasan) {
    const total = Number(ringkasan?.total)
    if (!Number.isFinite(total)) return
    window.dispatchEvent(new CustomEvent(PERLU_DILENGKAPI_EVENT, { detail: { total } }))
}
```

Di dalam objek `rangkaianService` pada `frontend/src/services/rangkaian.service.js`, setelah metode `unitKerjaOpsi` (Task 9), tambahkan:

```js
    /** GET /api/rangkaian/perlu-dilengkapi (D7). Respons utuh untuk usePaginatedResource. */
    async perluDilengkapi({ kategori, tampilkanDataLama = false, page = 1, limit = 20 } = {}) {
        return api.get('/api/rangkaian/perlu-dilengkapi', {
            kategori, tampilkanDataLama: tampilkanDataLama ? 'true' : undefined, page, limit,
        })
    },

    /** GET /api/rangkaian/perlu-dilengkapi/ringkasan (D7) → { perKategori, total, lewatBatas, batasDataLama }. */
    async ringkasanPerluDilengkapi({ tampilkanDataLama = false } = {}, { signal } = {}) {
        const response = await api.get('/api/rangkaian/perlu-dilengkapi/ringkasan',
            { tampilkanDataLama: tampilkanDataLama ? 'true' : undefined }, { signal })
        return response.data
    },

    /** POST /api/rangkaian/surat-keluar/:id/tandai-inisiatif (D7). Body selalu kosong. */
    async tandaiInisiatif(suratKeluarId) {
        return (await api.post(`/api/rangkaian/surat-keluar/${suratKeluarId}/tandai-inisiatif`, {})).data
    },
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `(cd frontend && npx vitest run src/lib/perlu-dilengkapi.test.js src/services/rangkaian.service.perlu-dilengkapi.test.js src/services/rangkaian.service.lacak.test.js)`
Expected: PASS (4 + 3 tes, dan tes layanan Task 9 tetap hijau).

- [ ] **Step 5: Commit**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
git add frontend/src/lib/perlu-dilengkapi.js frontend/src/lib/perlu-dilengkapi.test.js frontend/src/services/rangkaian.service.js frontend/src/services/rangkaian.service.perlu-dilengkapi.test.js
git commit -m "feat(perlu-dilengkapi): layanan klien dan konstanta tab Perlu Dilengkapi" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


#### Amandemen pra-eksekusi Task 19 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p4-lacak-surat/preflight-rulings.md`.


1. **Path encoding (REQUIRED) [P4-T19-1].** Use `return (await api.post(\`/api/rangkaian/surat-keluar/${encodeURIComponent(suratKeluarId)}/tandai-inisiatif\`, {})).data`. The test expectation for `'sk-1'` is unchanged.



### Task 20: Tab `PerluDilengkapiTab` dengan aksi baris, lalu dipasang di `LacakSurat` (`?tab=perlu-dilengkapi`) (D7)

**Files:**
- Create: `frontend/src/components/lacak/PerluDilengkapiTab.jsx`
- Create: `frontend/src/components/lacak/PerluDilengkapiTab.test.jsx`
- Modify: `frontend/src/pages/LacakSurat.jsx` (Task 13: impor, konstanta tab, `tab`, `ubahTab`, `TabsList`, `TabsContent`)
- Modify: `frontend/src/pages/LacakSurat.test.jsx` (Task 13: satu `vi.mock` dan dua tes)

**Interfaces:**
- Consumes (Task 19): `rangkaianService.perluDilengkapi`, `rangkaianService.ringkasanPerluDilengkapi`, `rangkaianService.tandaiInisiatif`, `KATEGORI_PERLU_DILENGKAPI`, `LABEL_KATEGORI_PERLU_DILENGKAPI`, `LABEL_STATUS_DISPOSISI`, `umumkanRingkasanPerluDilengkapi`
- Consumes (P3):
  - `buildTindakLanjutState(jenis, surat, aksi)` (`lib/tindak-lanjut.js`)
  - `DistributeDialog({ open, onOpenChange, suratData, sourceUnitId, onSuccess })`
  - `BerkaskanDialog({ open, onOpenChange, rangkaian, onBerhasil })`
  - `TautkanDialog({ open, onOpenChange, jenis, surat, onBerhasil })` (`components/surat/AlurSuratActions.jsx`)
- Consumes (repo/Task 8): `usePaginatedResource` (termasuk `reload`), `ResourcePagination`, `useToast`, `Dialog*`, `Button` (`asChild`), `Badge`, `lacakHref({ rangkaianId })`
- Produces:
  - `PerluDilengkapiTab()` (named export). Tombol baris hanya dirender dari `aksiDiizinkan`:
    - `tindak_lanjut` → form `/surat/keluar/tambah` dengan state `buildTindakLanjutState('surat_masuk', …, 'saya_balas')`
    - `buat_nd_penjelas` → `buildTindakLanjutState('surat_keluar', …, 'buat_nd_penjelas')`
    - `disposisi` → `DistributeDialog`
    - `berkaskan` → `BerkaskanDialog`
    - `tautkan` → `TautkanDialog`
    - `tandai_inisiatif` → dialog konfirmasi
    - `buka_kotak_disposisi` → tautan `/distribusi`
    - `buka_surat` → tautan detail
  - Setelah aksi berhasil, daftar dan ringkasan dimuat ulang. Ringkasan tanpa data lama diumumkan ke badge sidebar.
  - `LacakSurat` menerima `?tab=perlu-dilengkapi`. Nilai `tab` lain selain `berkas`/`perlu-dilengkapi` jatuh ke tab Lacak.

- [ ] **Step 1: Tulis tes yang gagal**

```jsx
// frontend/src/components/lacak/PerluDilengkapiTab.test.jsx
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
    perluDilengkapi: vi.fn(), ringkasanPerluDilengkapi: vi.fn(), tandaiInisiatif: vi.fn(),
    toast: vi.fn(), distribute: vi.fn(), berkaskan: vi.fn(), tautkan: vi.fn(),
}))
vi.mock('@/services/rangkaian.service', () => {
    const service = {
        perluDilengkapi: mocks.perluDilengkapi, ringkasanPerluDilengkapi: mocks.ringkasanPerluDilengkapi, tandaiInisiatif: mocks.tandaiInisiatif,
    }
    return { default: service, rangkaianService: service }
})
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/components/DistributeDialog', () => ({
    DistributeDialog: (props) => { mocks.distribute(props); return <div role="dialog" aria-label="Disposisi">{props.suratData.nomorSurat}</div> },
}))
vi.mock('@/components/surat/BerkaskanDialog', () => ({
    BerkaskanDialog: (props) => { mocks.berkaskan(props); return <div role="dialog" aria-label="Berkaskan">{props.rangkaian.kode}</div> },
}))
vi.mock('@/components/surat/AlurSuratActions', () => ({
    TautkanDialog: (props) => { mocks.tautkan(props); return <div role="dialog" aria-label="Tautkan">{props.surat.nomorSurat}</div> },
}))
import { PerluDilengkapiTab } from './PerluDilengkapiTab'
import { PERLU_DILENGKAPI_EVENT } from '@/lib/perlu-dilengkapi'

const SM1 = '11111111-1111-4111-8111-111111111111'
const SK10 = '22222222-2222-4222-8222-222222222222'
const R6 = '33333333-3333-4333-8333-333333333333'
const D2 = '44444444-4444-4444-8444-444444444444'
const itemTersamar = {
    kunci: `disposisi_terbuka:${D2}`, kategori: 'disposisi_terbuka', masked: true, label: 'Dikecualikan', jenis: 'surat_masuk',
    unitNama: 'Sesditjen', surat: null, rangkaian: null,
    disposisi: { id: D2, status: 'sent', targetUnitNama: 'Dit. BPPT', batasWaktu: '2026-01-10', lewatBatas: true },
    dataLama: false, aksiDiizinkan: ['buka_kotak_disposisi'],
}
const itemSm = {
    kunci: `sm_belum_ditindaklanjuti:${SM1}`, kategori: 'sm_belum_ditindaklanjuti', masked: false, jenis: 'surat_masuk', unitNama: 'Sesditjen',
    surat: {
        jenis: 'surat_masuk', id: SM1, nomorSurat: 'SM-1/2026', perihal: 'Undangan rapat satu', tanggalSurat: '2026-09-01',
        naskahDinas: null, dari: 'Kanwil Jawa Barat', kepada: null, sifatSurat: 'Biasa', unitKerjaId: 'sesditjen', approvalStatus: null,
    },
    rangkaian: null, disposisi: null, dataLama: false, aksiDiizinkan: ['buka_surat', 'disposisi', 'tindak_lanjut'],
}
const itemSkTanpaAsal = {
    kunci: `sk_tanpa_asal:${SK10}`, kategori: 'sk_tanpa_asal', masked: false, jenis: 'surat_keluar', unitNama: 'Dit. BPPT',
    surat: {
        jenis: 'surat_keluar', id: SK10, nomorSurat: 'ND-10/2026', perihal: 'Undangan koordinasi sepuluh', tanggalSurat: '2026-09-10',
        naskahDinas: 'Nota Dinas', dari: null, kepada: 'Para Direktur', sifatSurat: 'biasa', unitKerjaId: 'dir_bppt', approvalStatus: 'approved',
    },
    rangkaian: null, disposisi: null, dataLama: false, aksiDiizinkan: ['buka_surat', 'tandai_inisiatif', 'tautkan'],
}
const itemSiap = {
    kunci: `siap_diberkaskan:${R6}`, kategori: 'siap_diberkaskan', masked: false, jenis: 'rangkaian', unitNama: 'Sesditjen', surat: null,
    rangkaian: {
        id: R6, kode: 'RS-2026-000006', status: 'selesai', judul: 'Permohonan data enam',
        unitPencatatId: 'sesditjen', unitPengolahId: 'dir_bppt', unitPengolahNama: 'Dit. BPPT',
    },
    disposisi: null, dataLama: false, aksiDiizinkan: ['berkaskan'],
}
const RINGKASAN = {
    perKategori: { sm_belum_ditindaklanjuti: 1, disposisi_terbuka: 1, sk_tanpa_nd_penjelas: 0, tindak_lanjut_tertahan: 0, siap_diberkaskan: 1, sk_tanpa_asal: 1 },
    total: 4, lewatBatas: 1, batasDataLama: '2025-12-31T17:00:00.000Z',
}
const respons = (rows) => ({
    success: true, data: rows, pagination: { page: 1, limit: 20, total: rows.length, totalPages: 1 },
    meta: { batasDataLama: RINGKASAN.batasDataLama, tampilkanDataLama: false },
})

function Lokasi() {
    const { state } = useLocation()
    return <p>{`${state?.tindakLanjut?.suratId}|${state?.tindakLanjut?.jenisRelasi}`}</p>
}
let router
function mount() {
    router = createMemoryRouter([
        { path: '/surat/lacak', element: <PerluDilengkapiTab /> },
        { path: '/surat/keluar/tambah', element: <Lokasi /> },
    ], { initialEntries: ['/surat/lacak?tab=perlu-dilengkapi'] })
    render(<RouterProvider router={router} />)
}
const baris = async () => within(await screen.findByRole('list', { name: 'Daftar perlu dilengkapi' })).findAllByRole('listitem')

beforeEach(() => {
    vi.clearAllMocks()
    mocks.perluDilengkapi.mockResolvedValue(respons([itemTersamar, itemSm, itemSkTanpaAsal, itemSiap]))
    mocks.ringkasanPerluDilengkapi.mockResolvedValue(RINGKASAN)
    mocks.tandaiInisiatif.mockResolvedValue({ id: SK10, asalNaskah: 'inisiatif' })
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { cleanup(); router?.dispose(); vi.unstubAllGlobals() })

describe('Tab Perlu Dilengkapi (D7)', () => {
    it('memuat ringkasan dan daftar tanpa data lama, lalu mengumumkan total untuk badge sidebar', async () => {
        const diumumkan = vi.fn()
        window.addEventListener(PERLU_DILENGKAPI_EVENT, diumumkan)
        mount()
        await baris()
        expect(mocks.perluDilengkapi).toHaveBeenCalledWith({ kategori: undefined, tampilkanDataLama: false, page: 1, limit: 20 })
        expect(mocks.ringkasanPerluDilengkapi).toHaveBeenCalledWith({ tampilkanDataLama: false })
        expect(await screen.findByRole('button', { name: 'Semua (4)' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: 'Surat masuk belum ditindaklanjuti (1)' })).toHaveAttribute('aria-pressed', 'false')
        await waitFor(() => expect(diumumkan).toHaveBeenCalledTimes(1))
        expect(diumumkan.mock.calls[0][0].detail).toEqual({ total: 4 })
        window.removeEventListener(PERLU_DILENGKAPI_EVENT, diumumkan)
    })

    it('aksi hanya dari aksiDiizinkan; baris tersamar tanpa nomor, perihal, atau tautan surat', async () => {
        mount()
        const [tersamar, sm, skTanpaAsal, siap] = await baris()
        expect(within(tersamar).getByText('Dikecualikan')).toBeVisible()
        expect(within(tersamar).getByText('Lewat batas waktu')).toBeVisible()
        expect(within(tersamar).getByRole('link', { name: 'Buka Kotak Disposisi' })).toHaveAttribute('href', '/distribusi')
        expect(within(tersamar).queryByRole('link', { name: 'Buka surat' })).toBeNull()
        expect(within(tersamar).queryAllByRole('button')).toHaveLength(0)

        expect(within(sm).getByText('SM-1/2026 — Undangan rapat satu')).toBeVisible()
        expect(within(sm).getByRole('button', { name: 'Tindak Lanjut' })).toBeVisible()
        expect(within(sm).getByRole('button', { name: 'Disposisi' })).toBeVisible()
        expect(within(sm).getByRole('link', { name: 'Buka surat' })).toHaveAttribute('href', `/surat/masuk/${SM1}`)
        expect(within(sm).queryByRole('button', { name: 'Tandai Inisiatif' })).toBeNull()

        expect(within(skTanpaAsal).getByRole('button', { name: 'Tandai Inisiatif' })).toBeVisible()
        expect(within(skTanpaAsal).getByRole('button', { name: 'Tautkan' })).toBeVisible()
        expect(within(skTanpaAsal).getByRole('link', { name: 'Buka surat' })).toHaveAttribute('href', `/surat/keluar/${SK10}`)

        expect(within(siap).getByText('Permohonan data enam')).toBeVisible()
        expect(within(siap).getByRole('link', { name: 'RS-2026-000006' })).toHaveAttribute('href', `/surat/lacak?rangkaian=${R6}`)
        expect(within(siap).getByRole('button', { name: 'Berkaskan ke Direktorat' })).toBeVisible()
        expect(within(siap).queryByRole('link', { name: 'Buka surat' })).toBeNull()
    })

    it('Tindak Lanjut membuka form surat keluar dengan Nomor Referensi terkunci', async () => {
        mount()
        const [, sm] = await baris()
        fireEvent.click(within(sm).getByRole('button', { name: 'Tindak Lanjut' }))
        expect(await screen.findByText(`${SM1}|balasan`)).toBeVisible()
    })

    it('Berkaskan, Tautkan, dan Disposisi membuka dialog P3 dengan data baris, lalu memuat ulang setelah berhasil', async () => {
        mount()
        const [, sm, skTanpaAsal, siap] = await baris()
        await waitFor(() => expect(mocks.ringkasanPerluDilengkapi).toHaveBeenCalledTimes(1))

        fireEvent.click(within(siap).getByRole('button', { name: 'Berkaskan ke Direktorat' }))
        expect(screen.getByRole('dialog', { name: 'Berkaskan' })).toHaveTextContent('RS-2026-000006')
        expect(mocks.berkaskan).toHaveBeenLastCalledWith(expect.objectContaining({ open: true, rangkaian: { id: R6, kode: 'RS-2026-000006' } }))
        act(() => { mocks.berkaskan.mock.lastCall[0].onOpenChange(false) })
        expect(screen.queryByRole('dialog', { name: 'Berkaskan' })).toBeNull()

        fireEvent.click(within(skTanpaAsal).getByRole('button', { name: 'Tautkan' }))
        expect(mocks.tautkan).toHaveBeenLastCalledWith(expect.objectContaining({
            open: true, jenis: 'surat_keluar', surat: { id: SK10, nomorSurat: 'ND-10/2026', perihal: 'Undangan koordinasi sepuluh' },
        }))
        act(() => { mocks.tautkan.mock.lastCall[0].onOpenChange(false) })
        expect(screen.queryByRole('dialog', { name: 'Tautkan' })).toBeNull()

        fireEvent.click(within(sm).getByRole('button', { name: 'Disposisi' }))
        expect(screen.getByRole('dialog', { name: 'Disposisi' })).toHaveTextContent('SM-1/2026')
        expect(mocks.distribute).toHaveBeenLastCalledWith(expect.objectContaining({
            open: true, sourceUnitId: 'sesditjen',
            suratData: { id: SM1, nomorSurat: 'SM-1/2026', perihal: 'Undangan rapat satu', sifatSurat: 'Biasa' },
        }))
        await act(async () => { mocks.distribute.mock.lastCall[0].onSuccess() })
        expect(screen.queryByRole('dialog', { name: 'Disposisi' })).toBeNull()
        expect(mocks.toast).toHaveBeenCalledWith({ title: 'Surat didisposisikan' })
        await waitFor(() => expect(mocks.perluDilengkapi).toHaveBeenCalledTimes(2))
        await waitFor(() => expect(mocks.ringkasanPerluDilengkapi).toHaveBeenCalledTimes(2))
    })

    it('Tandai Inisiatif meminta konfirmasi, menampilkan galat server, lalu memuat ulang setelah berhasil', async () => {
        mocks.tandaiInisiatif.mockRejectedValueOnce(new Error('Asal naskah surat ini sudah ditetapkan.'))
        mount()
        const [, , skTanpaAsal] = await baris()
        fireEvent.click(within(skTanpaAsal).getByRole('button', { name: 'Tandai Inisiatif' }))
        const dialog = await screen.findByRole('dialog', { name: 'Tandai sebagai Surat Inisiatif?' })
        expect(dialog).toHaveTextContent('ND-10/2026')
        fireEvent.click(within(dialog).getByRole('button', { name: 'Ya, tandai inisiatif' }))
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('Asal naskah surat ini sudah ditetapkan.')
        expect(mocks.perluDilengkapi).toHaveBeenCalledTimes(1)

        fireEvent.click(within(dialog).getByRole('button', { name: 'Ya, tandai inisiatif' }))
        await waitFor(() => expect(mocks.tandaiInisiatif).toHaveBeenCalledTimes(2))
        expect(mocks.tandaiInisiatif).toHaveBeenLastCalledWith(SK10)
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tandai sebagai Surat Inisiatif?' })).toBeNull())
        expect(mocks.toast).toHaveBeenCalledWith({ title: 'Surat ditandai sebagai Surat Inisiatif' })
        await waitFor(() => expect(mocks.perluDilengkapi).toHaveBeenCalledTimes(2))
    })

    it('Tampilkan data lama meminta server secara eksplisit tanpa mengubah badge sidebar', async () => {
        const diumumkan = vi.fn()
        window.addEventListener(PERLU_DILENGKAPI_EVENT, diumumkan)
        mount()
        await baris()
        await waitFor(() => expect(diumumkan).toHaveBeenCalledTimes(1))
        fireEvent.click(screen.getByLabelText('Tampilkan data lama'))
        await waitFor(() => expect(mocks.perluDilengkapi).toHaveBeenLastCalledWith({ kategori: undefined, tampilkanDataLama: true, page: 1, limit: 20 }))
        await waitFor(() => expect(mocks.ringkasanPerluDilengkapi).toHaveBeenLastCalledWith({ tampilkanDataLama: true }))
        await act(async () => { await Promise.resolve() })
        expect(diumumkan).toHaveBeenCalledTimes(1)
        window.removeEventListener(PERLU_DILENGKAPI_EVENT, diumumkan)
    })

    it('filter kategori dikirim ke server', async () => {
        mount()
        await baris()
        fireEvent.click(await screen.findByRole('button', { name: 'Siap diberkaskan (1)' }))
        await waitFor(() => expect(mocks.perluDilengkapi).toHaveBeenLastCalledWith({ kategori: 'siap_diberkaskan', tampilkanDataLama: false, page: 1, limit: 20 }))
        expect(screen.getByRole('button', { name: 'Siap diberkaskan (1)' })).toHaveAttribute('aria-pressed', 'true')
    })
})
```

Di `frontend/src/pages/LacakSurat.test.jsx` (Task 13), tambahkan tepat setelah baris `vi.mock('@/components/lacak/BerkasRangkaianTab', …)`:

```jsx
vi.mock('@/components/lacak/PerluDilengkapiTab', () => ({ PerluDilengkapiTab: () => <p>Isi tab perlu dilengkapi</p> }))
```

Lalu tambahkan di akhir `describe('Halaman Lacak Surat', …)`:

```jsx
    it('tab Perlu Dilengkapi lewat ?tab=perlu-dilengkapi tanpa memicu pencarian', async () => {
        mount('/surat/lacak?tab=perlu-dilengkapi')
        expect(screen.getByText('Isi tab perlu dilengkapi')).toBeVisible()
        expect(screen.getByRole('tab', { name: 'Perlu Dilengkapi' })).toHaveAttribute('aria-selected', 'true')
        await maju(1000)
        expect(mocks.lacak).not.toHaveBeenCalled()
    })

    it('nilai tab yang tidak dikenal jatuh ke tab Lacak', () => {
        mount('/surat/lacak?tab=lainnya')
        expect(screen.getByRole('tab', { name: 'Lacak' })).toHaveAttribute('aria-selected', 'true')
        expect(screen.queryByText('Isi tab perlu dilengkapi')).toBeNull()
    })
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `(cd frontend && npx vitest run src/components/lacak/PerluDilengkapiTab.test.jsx src/pages/LacakSurat.test.jsx)`
Expected: FAIL. `Failed to resolve import "./PerluDilengkapiTab"`, dan di `LacakSurat.test.jsx` tab "Perlu Dilengkapi" tidak ditemukan.

- [ ] **Step 3: Implementasi minimal**

```jsx
// frontend/src/components/lacak/PerluDilengkapiTab.jsx
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ResourcePagination } from '@/components/ResourcePagination'
import { DistributeDialog } from '@/components/DistributeDialog'
import { BerkaskanDialog } from '@/components/surat/BerkaskanDialog'
import { TautkanDialog } from '@/components/surat/AlurSuratActions'
import { usePaginatedResource } from '@/hooks/use-paginated-resource'
import { useToast } from '@/hooks/use-toast'
import { buildTindakLanjutState } from '@/lib/tindak-lanjut'
import { lacakHref } from '@/lib/lacak-link'
import {
    KATEGORI_PERLU_DILENGKAPI, LABEL_KATEGORI_PERLU_DILENGKAPI, LABEL_STATUS_DISPOSISI, umumkanRingkasanPerluDilengkapi,
} from '@/lib/perlu-dilengkapi'
import rangkaianService from '@/services/rangkaian.service'

const hrefSurat = surat => `/surat/${surat.jenis === 'surat_masuk' ? 'masuk' : 'keluar'}/${surat.id}`

function judulBaris(item) {
    if (item.masked) return item.label || 'Dikecualikan'
    if (item.jenis === 'rangkaian') return item.rangkaian?.judul || item.rangkaian?.kode || ''
    return [item.surat?.nomorSurat, item.surat?.perihal].filter(Boolean).join(' — ') || '(tanpa nomor dan perihal)'
}

function InfoBaris({ item }) {
    return (
        <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{LABEL_KATEGORI_PERLU_DILENGKAPI[item.kategori] ?? item.kategori}</Badge>
                {item.dataLama && <Badge variant="secondary">Data lama</Badge>}
                {item.disposisi?.lewatBatas && (
                    <Badge variant="destructive"><AlertTriangle aria-hidden="true" />Lewat batas waktu</Badge>
                )}
            </div>
            <p className={item.masked ? 'text-sm italic text-muted-foreground' : 'truncate text-sm font-medium'}>{judulBaris(item)}</p>
            <p className="text-xs text-muted-foreground">
                {item.unitNama}
                {item.rangkaian?.kode && (
                    <> · <Link to={lacakHref({ rangkaianId: item.rangkaian.id })} className="underline-offset-2 hover:underline">{item.rangkaian.kode}</Link></>
                )}
                {item.disposisi && (
                    <> · Disposisi ke {item.disposisi.targetUnitNama} · {LABEL_STATUS_DISPOSISI[item.disposisi.status] ?? item.disposisi.status}
                        {item.disposisi.batasWaktu ? ` · batas ${item.disposisi.batasWaktu}` : ''}</>
                )}
                {item.kategori === 'tindak_lanjut_tertahan' && item.surat?.approvalStatus && <> · Status persetujuan: {item.surat.approvalStatus}</>}
            </p>
        </div>
    )
}

/** Tombol hanya dari aksiDiizinkan server (§7); klien tidak menebak hak dari unit. */
function AksiBaris({ item, onAksi }) {
    const aksi = new Set(item.aksiDiizinkan || [])
    return (
        <div className="flex shrink-0 flex-wrap gap-2">
            {aksi.has('tindak_lanjut') && <Button type="button" size="sm" onClick={() => onAksi('tindak_lanjut', item)}>Tindak Lanjut</Button>}
            {aksi.has('disposisi') && <Button type="button" size="sm" variant="outline" onClick={() => onAksi('disposisi', item)}>Disposisi</Button>}
            {aksi.has('buka_kotak_disposisi') && <Button size="sm" variant="outline" asChild><Link to="/distribusi">Buka Kotak Disposisi</Link></Button>}
            {aksi.has('buat_nd_penjelas') && <Button type="button" size="sm" onClick={() => onAksi('buat_nd_penjelas', item)}>Buat ND Penjelas</Button>}
            {aksi.has('berkaskan') && <Button type="button" size="sm" onClick={() => onAksi('berkaskan', item)}>Berkaskan ke Direktorat</Button>}
            {aksi.has('tandai_inisiatif') && <Button type="button" size="sm" variant="outline" onClick={() => onAksi('inisiatif', item)}>Tandai Inisiatif</Button>}
            {aksi.has('tautkan') && <Button type="button" size="sm" variant="outline" onClick={() => onAksi('tautkan', item)}>Tautkan</Button>}
            {aksi.has('buka_surat') && item.surat && <Button size="sm" variant="ghost" asChild><Link to={hrefSurat(item.surat)}>Buka surat</Link></Button>}
        </div>
    )
}

export function PerluDilengkapiTab() {
    const navigate = useNavigate()
    const { toast } = useToast()
    const [kategori, setKategori] = useState('')
    const [tampilkanDataLama, setTampilkanDataLama] = useState(false)
    const [revisiRingkasan, setRevisiRingkasan] = useState(0)
    const [ringkasan, setRingkasan] = useState(null)
    const [dialog, setDialog] = useState(null)
    const [menyimpan, setMenyimpan] = useState(false)
    const [galat, setGalat] = useState(null)

    useEffect(() => {
        let aktif = true
        rangkaianService.ringkasanPerluDilengkapi({ tampilkanDataLama })
            .then((data) => {
                if (!aktif) return
                setRingkasan(data)
                // Badge sidebar hanya menghitung data tanpa data lama; bagikan tanpa request tambahan.
                if (!tampilkanDataLama) umumkanRingkasanPerluDilengkapi(data)
            })
            .catch(() => { if (aktif) setRingkasan(null) })
        return () => { aktif = false }
    }, [tampilkanDataLama, revisiRingkasan])

    const fetchPage = useCallback(({ page, limit }) => rangkaianService.perluDilengkapi({
        kategori: kategori || undefined, tampilkanDataLama, page, limit,
    }), [kategori, tampilkanDataLama])
    const resource = usePaginatedResource(fetchPage, { queryKey: JSON.stringify({ kategori, tampilkanDataLama }), pageSize: 20 })
    const { reload } = resource

    const tutup = useCallback(() => { setDialog(null); setGalat(null) }, [])
    const berhasil = useCallback((pesan) => {
        tutup()
        toast({ title: pesan })
        reload()
        setRevisiRingkasan(nilai => nilai + 1)
    }, [reload, toast, tutup])
    const tutupBila = (buka) => { if (!buka && !menyimpan) tutup() }

    const onAksi = (jenis, item) => {
        const surat = item.surat ? { ...item.surat, rangkaian: item.rangkaian } : null
        if (jenis === 'tindak_lanjut') {
            navigate('/surat/keluar/tambah', { state: buildTindakLanjutState('surat_masuk', surat, 'saya_balas') })
        } else if (jenis === 'buat_nd_penjelas') {
            navigate('/surat/keluar/tambah', { state: buildTindakLanjutState('surat_keluar', surat, 'buat_nd_penjelas') })
        } else {
            setGalat(null)
            setDialog({ jenis, item })
        }
    }

    const tandaiInisiatif = async () => {
        setMenyimpan(true)
        setGalat(null)
        try {
            await rangkaianService.tandaiInisiatif(dialog.item.surat.id)
            berhasil('Surat ditandai sebagai Surat Inisiatif')
        } catch (error) {
            setGalat(error?.message || 'Gagal menandai surat')
        } finally {
            setMenyimpan(false)
        }
    }

    const item = dialog?.item
    return (
        <section aria-label="Perlu Dilengkapi" className="space-y-4">
            <p className="text-sm text-muted-foreground">
                Surat dan rangkaian dalam jangkauan Anda yang rantainya belum lengkap. Surat yang tidak boleh Anda baca tampil sebagai “Dikecualikan”.
            </p>
            <div role="group" aria-label="Kategori" className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant={kategori === '' ? 'default' : 'outline'} aria-pressed={kategori === ''} onClick={() => setKategori('')}>
                    {ringkasan ? `Semua (${ringkasan.total})` : 'Semua'}
                </Button>
                {KATEGORI_PERLU_DILENGKAPI.map(kode => (
                    <Button key={kode} type="button" size="sm" variant={kategori === kode ? 'default' : 'outline'} aria-pressed={kategori === kode} onClick={() => setKategori(kode)}>
                        {ringkasan ? `${LABEL_KATEGORI_PERLU_DILENGKAPI[kode]} (${ringkasan.perKategori?.[kode] ?? 0})` : LABEL_KATEGORI_PERLU_DILENGKAPI[kode]}
                    </Button>
                ))}
            </div>
            <label className="flex w-fit items-center gap-2 text-sm">
                <input type="checkbox" checked={tampilkanDataLama} onChange={event => setTampilkanDataLama(event.target.checked)} />
                Tampilkan data lama
            </label>

            {resource.error && <p role="alert" className="text-sm text-destructive">{resource.error.message || 'Gagal memuat daftar.'}</p>}
            <ul aria-label="Daftar perlu dilengkapi" className="divide-y rounded-md border">
                {resource.rows.map(baris => (
                    <li key={baris.kunci} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <InfoBaris item={baris} />
                        <AksiBaris item={baris} onAksi={onAksi} />
                    </li>
                ))}
            </ul>
            {!resource.loading && !resource.error && resource.rows.length === 0 && (
                <p role="status" className="text-sm text-muted-foreground">Tidak ada yang perlu dilengkapi untuk filter ini.</p>
            )}
            <ResourcePagination resource={resource} label="perlu dilengkapi" />

            {dialog?.jenis === 'disposisi' && (
                <DistributeDialog
                    open
                    onOpenChange={tutupBila}
                    suratData={{ id: item.surat.id, nomorSurat: item.surat.nomorSurat, perihal: item.surat.perihal, sifatSurat: item.surat.sifatSurat }}
                    sourceUnitId={item.surat.unitKerjaId}
                    onSuccess={() => berhasil('Surat didisposisikan')}
                />
            )}
            {dialog?.jenis === 'berkaskan' && (
                <BerkaskanDialog
                    open
                    onOpenChange={tutupBila}
                    rangkaian={{ id: item.rangkaian.id, kode: item.rangkaian.kode }}
                    onBerhasil={() => berhasil(`Rangkaian ${item.rangkaian.kode} diberkaskan`)}
                />
            )}
            {dialog?.jenis === 'tautkan' && (
                <TautkanDialog
                    open
                    onOpenChange={tutupBila}
                    jenis="surat_keluar"
                    surat={{ id: item.surat.id, nomorSurat: item.surat.nomorSurat, perihal: item.surat.perihal }}
                    onBerhasil={() => berhasil('Surat ditautkan ke rangkaian')}
                />
            )}
            <Dialog open={dialog?.jenis === 'inisiatif'} onOpenChange={tutupBila}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Tandai sebagai Surat Inisiatif?</DialogTitle>
                        <DialogDescription>
                            Surat {item?.surat?.nomorSurat || 'ini'} dicatat sebagai surat atas prakarsa sendiri (tidak menindaklanjuti surat lain).
                            Perubahan ini diaudit dan tidak mengubah isi surat.
                        </DialogDescription>
                    </DialogHeader>
                    {galat && <p role="alert" className="text-sm text-destructive">{galat}</p>}
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={tutup} disabled={menyimpan}>Batal</Button>
                        <Button type="button" onClick={tandaiInisiatif} disabled={menyimpan}>Ya, tandai inisiatif</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </section>
    )
}
```

Di `frontend/src/pages/LacakSurat.jsx` (Task 13):

1. Tambah impor setelah `import { BerkasRangkaianTab } from '@/components/lacak/BerkasRangkaianTab'`:

```jsx
import { PerluDilengkapiTab } from '@/components/lacak/PerluDilengkapiTab'
```

2. Tambah konstanta setelah `const PILIHAN_TAHUN = …`:

```jsx
const TAB_LAIN = ['berkas', 'perlu-dilengkapi']
```

3. Ganti baris (persis):

```jsx
    const tab = searchParams.get('tab') === 'berkas' ? 'berkas' : 'lacak'
```

menjadi:

```jsx
    const tabParam = searchParams.get('tab')
    const tab = TAB_LAIN.includes(tabParam) ? tabParam : 'lacak'
```

4. Ganti fungsi (persis):

```jsx
    const ubahTab = value => ubahParam(next => {
        if (value === 'berkas') next.set('tab', 'berkas')
        else next.delete('tab')
    })
```

menjadi:

```jsx
    const ubahTab = value => ubahParam(next => {
        if (TAB_LAIN.includes(value)) next.set('tab', value)
        else next.delete('tab')
    })
```

5. Tambah pemicu tab setelah `<TabsTrigger value="berkas">Berkas Rangkaian</TabsTrigger>`:

```jsx
                    <TabsTrigger value="perlu-dilengkapi">Perlu Dilengkapi</TabsTrigger>
```

6. Tambah isi tab setelah blok `<TabsContent value="berkas">…</TabsContent>`:

```jsx
                <TabsContent value="perlu-dilengkapi">
                    <PerluDilengkapiTab />
                </TabsContent>
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `(cd frontend && npx vitest run src/components/lacak/PerluDilengkapiTab.test.jsx src/pages/LacakSurat.test.jsx && npx eslint src/components/lacak/PerluDilengkapiTab.jsx src/pages/LacakSurat.jsx)`
Expected: PASS (7 tes tab + 10 tes halaman) dan ESLint bersih.

- [ ] **Step 5: Commit**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
git add frontend/src/components/lacak/PerluDilengkapiTab.jsx frontend/src/components/lacak/PerluDilengkapiTab.test.jsx frontend/src/pages/LacakSurat.jsx frontend/src/pages/LacakSurat.test.jsx
git commit -m "feat(perlu-dilengkapi): tab Perlu Dilengkapi di Lacak Surat dengan aksi baris dari aksiDiizinkan" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


#### Amandemen pra-eksekusi Task 20 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p4-lacak-surat/preflight-rulings.md`.


1. **Single toast (ADVISORY) [P4-T20-1].** In the `berhasil` callback (P4:5453-5458), change `toast({ title: pesan })` to `if (pesan) toast({ title: pesan })`. The deps are unchanged. Change the `DistributeDialog` prop to `onSuccess={() => berhasil()}`, because P3's `DistributeDialog` already toasts "Surat didisposisikan ke N unit". Keep the messages for Berkaskan, Tautkan and Tandai Inisiatif, whose P3 dialogs do not toast.
   - **(delta P3) Confirmed.** `DistributeDialog.jsx:61` toasts `Surat didisposisikan ke ${targets.length} unit` before calling `onSuccess?.()` (:64). `BerkaskanDialog` (:71) and `TautkanIsi` (`AlurSuratActions.jsx:328`) call only `onBerhasil?.()`, with no toast.
2. **Dialog contract (ADVISORY) [P4-T20-2] RECHECK-AFTER-P3.** Before Step 1, re-run the Task 1 Step 3 dialog greps. If a prop name differs in real P3, follow P3.
   - **(delta P3) Confirmed.** The props equal the plan's Interfaces (P4:144-146 and P4:5084-5086); see Task 1 item 4 for file:line.
   - The `BerkaskanDialog` fetches `opsiBerkas(rangkaian.id)` on open, which returns 403 for tier `anggota` (`berkas.service.ts:104-106`). D7 offers `berkaskan` only to pengolah, pencatat, in-scope pengawas and super_admin (Task 16 item 7), so every offered row passes that check.



### Task 21: Badge "Perlu Dilengkapi" pada entri sidebar Lacak Surat (`usePerluDilengkapiCount`) (D7)

Irama badge sama dengan notifikasi yang sudah ada: `useNotifications({ refreshInterval: 60000 })` di `app-header.jsx`, yang memakai `setInterval` 60 detik. Badge dimuat saat aplikasi dibuka, lalu paling sering sekali per 60 detik dan hanya saat tab browser terlihat. Ringkasan yang diumumkan tab Perlu Dilengkapi dipakai langsung. Hanya FULL_ADMIN (`ADMIN_ROLES` sidebar) yang memicu request. Semua request melewati `generalLimiter` (≤15 per 15 menit per tab).

**Files:**
- Create: `frontend/src/hooks/use-perlu-dilengkapi-count.js`
- Create: `frontend/src/hooks/use-perlu-dilengkapi-count.test.jsx`
- Modify: `frontend/src/components/app-sidebar.jsx` (impor, sub-item "Lacak Surat" dari Task 14, `AppSidebar`, render sub-item)
- Modify: `frontend/src/components/app-sidebar.groups.test.jsx` (impor `within`, mock hook, reset di `beforeEach`, satu tes)

**Interfaces:**
- Consumes (Task 19): `rangkaianService.ringkasanPerluDilengkapi({}, { signal })`, `PERLU_DILENGKAPI_EVENT`, `PERLU_DILENGKAPI_REFRESH_MS`, `formatJumlahBadge`
- Consumes (Task 14): sub-item `{ title: 'Lacak Surat', url: '/surat/lacak', icon: Search }` di grup Surat
- Produces:
  - `usePerluDilengkapiCount({ enabled = true, refreshMs = PERLU_DILENGKAPI_REFRESH_MS } = {})` → `{ total: number }`. Nilainya 0 dan tanpa request bila `enabled` false; request lama dibatalkan saat unmount; nilai terakhir dipertahankan saat gagal.
  - Sub-item sidebar dengan `badge: 'perluDilengkapi'`:
    - saat `total > 0`, `Badge` `aria-hidden` berisi `formatJumlahBadge(total)` dan nama aksesibel tautan `"Lacak Surat (N perlu dilengkapi)"`
    - saat `total = 0`, nama tetap `"Lacak Surat"` (tes Task 14 tetap berlaku)

- [ ] **Step 1: Tulis tes yang gagal**

```jsx
// frontend/src/hooks/use-perlu-dilengkapi-count.test.jsx
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ ringkasan: vi.fn() }))
vi.mock('@/services/rangkaian.service', () => {
    const service = { ringkasanPerluDilengkapi: mocks.ringkasan }
    return { default: service, rangkaianService: service }
})
import { usePerluDilengkapiCount } from './use-perlu-dilengkapi-count'
import { PERLU_DILENGKAPI_EVENT, PERLU_DILENGKAPI_REFRESH_MS } from '@/lib/perlu-dilengkapi'

let visibilitas = 'visible'
const tunggu = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

beforeEach(() => {
    vi.useFakeTimers()
    visibilitas = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibilitas })
    mocks.ringkasan.mockReset()
    mocks.ringkasan.mockResolvedValue({ total: 12 })
})
afterEach(() => {
    vi.useRealTimers()
    delete document.visibilityState
})

describe('usePerluDilengkapiCount', () => {
    it('tidak meminta apa pun bila dinonaktifkan (role read-only)', async () => {
        const { result } = renderHook(() => usePerluDilengkapiCount({ enabled: false }))
        await tunggu(PERLU_DILENGKAPI_REFRESH_MS * 3)
        expect(mocks.ringkasan).not.toHaveBeenCalled()
        expect(result.current.total).toBe(0)
    })

    it('memuat saat mount, lalu paling sering sekali per 60 detik dan hanya saat tab terlihat', async () => {
        const { result } = renderHook(() => usePerluDilengkapiCount())
        await tunggu(0)
        expect(result.current.total).toBe(12)
        expect(mocks.ringkasan).toHaveBeenCalledTimes(1)
        expect(mocks.ringkasan).toHaveBeenCalledWith({}, { signal: expect.any(AbortSignal) })
        await tunggu(PERLU_DILENGKAPI_REFRESH_MS - 1)
        expect(mocks.ringkasan).toHaveBeenCalledTimes(1)
        await tunggu(1)
        expect(mocks.ringkasan).toHaveBeenCalledTimes(2)

        visibilitas = 'hidden'
        await tunggu(PERLU_DILENGKAPI_REFRESH_MS * 2)
        expect(mocks.ringkasan).toHaveBeenCalledTimes(2)

        visibilitas = 'visible'
        act(() => { document.dispatchEvent(new Event('visibilitychange')) })
        expect(mocks.ringkasan).toHaveBeenCalledTimes(3)
        act(() => { document.dispatchEvent(new Event('visibilitychange')) })
        expect(mocks.ringkasan).toHaveBeenCalledTimes(3)
    })

    it('memakai ringkasan yang diumumkan tab Perlu Dilengkapi tanpa request tambahan', async () => {
        const { result } = renderHook(() => usePerluDilengkapiCount())
        await tunggu(0)
        act(() => { window.dispatchEvent(new CustomEvent(PERLU_DILENGKAPI_EVENT, { detail: { total: 3 } })) })
        expect(result.current.total).toBe(3)
        expect(mocks.ringkasan).toHaveBeenCalledTimes(1)
    })

    it('mempertahankan nilai terakhir saat gagal dan membatalkan permintaan saat unmount', async () => {
        const { result, unmount } = renderHook(() => usePerluDilengkapiCount())
        await tunggu(0)
        mocks.ringkasan.mockRejectedValueOnce(new Error('Terlalu banyak permintaan'))
        await tunggu(PERLU_DILENGKAPI_REFRESH_MS)
        expect(result.current.total).toBe(12)
        mocks.ringkasan.mockReturnValueOnce(new Promise(() => {}))
        await tunggu(PERLU_DILENGKAPI_REFRESH_MS)
        const sinyal = mocks.ringkasan.mock.calls.at(-1)[1].signal
        unmount()
        expect(sinyal.aborted).toBe(true)
    })
})
```

Di `frontend/src/components/app-sidebar.groups.test.jsx`:

1. Ganti baris impor pertama (persis) `import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'` menjadi:

```jsx
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
```

2. Tambahkan tepat setelah baris `vi.mock('@/context/app-config-context', …)`:

```jsx
const perlu = vi.hoisted(() => ({ total: 0, opsi: [] }))
vi.mock('@/hooks/use-perlu-dilengkapi-count', () => ({
    usePerluDilengkapiCount: (opsi) => { perlu.opsi.push(opsi); return { total: perlu.total } },
}))
```

3. Di `beforeEach` yang sudah ada, tambahkan baris berikut tepat setelah `state.role = 'super_admin'`:

```jsx
    perlu.total = 0
    perlu.opsi.length = 0
```

4. Tambahkan di akhir `describe('sidebar task groups', …)`:

```jsx
    it('menampilkan badge Perlu Dilengkapi pada Lacak Surat hanya untuk admin, tanpa mengubah tujuan tautan', () => {
        state.role = 'admin_unit'
        perlu.total = 12
        const pertama = show({ route: '/surat/lacak' })
        const link = screen.getByRole('link', { name: 'Lacak Surat (12 perlu dilengkapi)' })
        expect(link).toHaveAttribute('href', '/surat/lacak')
        expect(link).toHaveAttribute('aria-current', 'page')
        expect(within(link).getByText('12')).toHaveAttribute('aria-hidden', 'true')
        expect(perlu.opsi.at(-1)).toEqual({ enabled: true })
        pertama.unmount()

        perlu.total = 150
        const kedua = show({ route: '/surat/lacak' })
        expect(within(screen.getByRole('link', { name: 'Lacak Surat (150 perlu dilengkapi)' })).getByText('99+')).toBeInTheDocument()
        kedua.unmount()

        state.role = 'staff'
        perlu.total = 0
        show({ route: '/surat/lacak' })
        expect(perlu.opsi.at(-1)).toEqual({ enabled: false })
        expect(screen.getByRole('link', { name: 'Lacak Surat' })).toHaveAttribute('href', '/surat/lacak')
    })
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `(cd frontend && npx vitest run src/hooks/use-perlu-dilengkapi-count.test.jsx src/components/app-sidebar.groups.test.jsx)`
Expected: FAIL. `Failed to resolve import "./use-perlu-dilengkapi-count"`, dan di tes sidebar tautan `Lacak Surat (12 perlu dilengkapi)` tidak ditemukan (hook belum dipakai `AppSidebar`).

- [ ] **Step 3: Implementasi minimal**

```js
// frontend/src/hooks/use-perlu-dilengkapi-count.js
import { useEffect, useState } from 'react'
import rangkaianService from '@/services/rangkaian.service'
import { PERLU_DILENGKAPI_EVENT, PERLU_DILENGKAPI_REFRESH_MS } from '@/lib/perlu-dilengkapi'

/**
 * Jumlah "Perlu Dilengkapi" untuk badge sidebar (D7). Irama sama dengan notifikasi (60 detik):
 * paling sering satu permintaan per refreshMs, hanya saat tab terlihat. Ringkasan yang diumumkan
 * tab Perlu Dilengkapi (PERLU_DILENGKAPI_EVENT) dipakai tanpa request tambahan.
 */
export function usePerluDilengkapiCount({ enabled = true, refreshMs = PERLU_DILENGKAPI_REFRESH_MS } = {}) {
    const [total, setTotal] = useState(0)

    useEffect(() => {
        if (!enabled) return undefined
        let aktif = true
        let controller = null
        let terakhir = -Infinity
        const muat = () => {
            if (document.visibilityState === 'hidden') return
            if (Date.now() - terakhir < refreshMs) return
            terakhir = Date.now()
            controller?.abort()
            controller = new AbortController()
            rangkaianService.ringkasanPerluDilengkapi({}, { signal: controller.signal })
                .then((ringkasan) => { if (aktif) setTotal(Number(ringkasan?.total) || 0) })
                .catch(() => { /* Badge bukan jalur kritis: nilai terakhir dipertahankan, dicoba lagi pada siklus berikutnya. */ })
        }
        const terimaRingkasan = (event) => {
            const nilai = Number(event.detail?.total)
            if (!aktif || !Number.isFinite(nilai)) return
            terakhir = Date.now()
            setTotal(nilai)
        }
        muat()
        const timer = window.setInterval(muat, refreshMs)
        document.addEventListener('visibilitychange', muat)
        window.addEventListener(PERLU_DILENGKAPI_EVENT, terimaRingkasan)
        return () => {
            aktif = false
            controller?.abort()
            window.clearInterval(timer)
            document.removeEventListener('visibilitychange', muat)
            window.removeEventListener(PERLU_DILENGKAPI_EVENT, terimaRingkasan)
        }
    }, [enabled, refreshMs])

    return { total: enabled ? total : 0 }
}
```

Di `frontend/src/components/app-sidebar.jsx`:

1. Tambah impor setelah `import { useAppConfig } from '@/context/app-config-context'`:

```jsx
import { usePerluDilengkapiCount } from '@/hooks/use-perlu-dilengkapi-count'
import { formatJumlahBadge } from '@/lib/perlu-dilengkapi'
```

2. Ubah sub-item Task 14 `{ title: 'Lacak Surat', url: '/surat/lacak', icon: Search },` menjadi:

```jsx
                    { title: 'Lacak Surat', url: '/surat/lacak', icon: Search, badge: 'perluDilengkapi' },
```

3. Di `AppSidebar`, tepat setelah `const userRole = user?.role || 'user'`, tambahkan:

```jsx
    // D7: hanya FULL_ADMIN yang memicu request ringkasan (role read-only tidak punya aksi di daftar kerja).
    const perluDilengkapi = usePerluDilengkapiCount({ enabled: ADMIN_ROLES.includes(userRole) })
```

4. Ganti blok render sub-item (persis):

```jsx
                                                                {item.subItems.map((subItem) => (
                                                                    <SidebarMenuSubItem key={subItem.title}>
                                                                        <SidebarMenuSubButton asChild isActive={isActive(subItem.url)}>
                                                                            <Link to={subItem.url} aria-current={isActive(subItem.url) ? 'page' : undefined}>{subItem.title}</Link>
                                                                        </SidebarMenuSubButton>
                                                                    </SidebarMenuSubItem>
                                                                ))}
```

menjadi:

```jsx
                                                                {item.subItems.map((subItem) => {
                                                                    const jumlah = subItem.badge === 'perluDilengkapi' ? perluDilengkapi.total : 0
                                                                    return (
                                                                        <SidebarMenuSubItem key={subItem.title}>
                                                                            <SidebarMenuSubButton asChild isActive={isActive(subItem.url)}>
                                                                                <Link
                                                                                    to={subItem.url}
                                                                                    aria-current={isActive(subItem.url) ? 'page' : undefined}
                                                                                    aria-label={jumlah > 0 ? `${subItem.title} (${jumlah} perlu dilengkapi)` : undefined}
                                                                                >
                                                                                    {subItem.title}
                                                                                    {jumlah > 0 && (
                                                                                        <Badge variant="secondary" aria-hidden="true" className="ml-auto h-5 min-w-5 px-1.5 text-[11px]">
                                                                                            {formatJumlahBadge(jumlah)}
                                                                                        </Badge>
                                                                                    )}
                                                                                </Link>
                                                                            </SidebarMenuSubButton>
                                                                        </SidebarMenuSubItem>
                                                                    )
                                                                })}
```

- [ ] **Step 4: Jalankan, pastikan lulus (termasuk tes sidebar/route Task 14)**

Run: `(cd frontend && npx vitest run src/hooks/use-perlu-dilengkapi-count.test.jsx src/components/app-sidebar.groups.test.jsx src/App.lacak-route.test.jsx && npx eslint src/hooks/use-perlu-dilengkapi-count.js src/components/app-sidebar.jsx)`
Expected: PASS (4 tes hook; semua tes sidebar, termasuk tes Task 14 "menawarkan Lacak Surat…" dengan badge 0) dan ESLint bersih.

- [ ] **Step 5: Commit**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
git add frontend/src/hooks/use-perlu-dilengkapi-count.js frontend/src/hooks/use-perlu-dilengkapi-count.test.jsx frontend/src/components/app-sidebar.jsx frontend/src/components/app-sidebar.groups.test.jsx
git commit -m "feat(perlu-dilengkapi): badge hitungan pada entri sidebar Lacak Surat dengan irama notifikasi" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


#### Amandemen pra-eksekusi Task 21 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p4-lacak-surat/preflight-rulings.md`.


1. **Test hygiene (REQUIRED) [P4-T21-1].**
   - Files: add Modify `frontend/src/lib/optional-modules.test.jsx`.
   - Add at the top, next to the existing mocks: `vi.mock('@/hooks/use-perlu-dilengkapi-count', () => ({ usePerluDilengkapiCount: () => ({ total: 0 }) }))`.
   - Step 4 adds `src/lib/optional-modules.test.jsx` to the vitest run. Expected: PASS with no `[API] Network error … perlu-dilengkapi/ringkasan` lines in the output.


**C-7 (critic) — Tasks 21, 22: per-IP `generalLimiter` budget in the release gate (Global item 7) — ADVISORY (production readiness) [P4-C-7]**


- In production, `generalLimiter` allows 500 requests per 15 minutes per IP (`rate-limiter.middleware.ts:17-22`, mounted at `app.ts:345`).
  - spec:588 moves the NAT problem to a separate task, and P5-T15-1 skips that task.
  - P4 adds the badge poll (≤15 per 15 minutes per FULL_ADMIN tab, P4:5644) and debounced Lacak typing to the same bucket.
- Add a row to "Gerbang rilis P4": "Anggaran `generalLimiter` per IP: (jumlah tab FULL_ADMIN di balik NAT kantor × 15 + polling notifikasi yang ada) < 500 per 15 menit — pemilik menerima, atau menjadwalkan re-key per pengguna (P5 Task 15) dengan sign-off."



### Task 22: Verifikasi akhir P4

**Files:** tidak ada perubahan kode. Commit hanya dibuat bila ada perbaikan dari langkah ini.

**Interfaces:**
- Consumes: seluruh keluaran Task 2–21 dan baseline Task 1 Step 5
- Produces: bukti kriteria selesai §10-P4, yaitu fixture ranking, probing, EXPLAIN 50 ribu baris, RTL debounce/abort, serta kriteria D7 (matriks cakupan Perlu Dilengkapi, placeholder tanpa bocoran, paritas Buka surat ↔ `checkRead`, Tandai Inisiatif pada surat terarsip, dan irama badge)

- [ ] **Step 1: Suite backend penuh**

Run: `(cd backend && npx vitest run)`
Expected: PASS. Jumlah file uji = baseline + 9 (`lacak-skor`, `lacak-ranking.integration`, `lacak-probing.integration`, `rangkaian-judul`, `rangkaian-daftar.integration`, `rangkaian-daftar.routes`, ditambah D7: `perlu-dilengkapi.integration`, `asal-naskah.integration`, `rangkaian-perlu-dilengkapi.routes`).

- [ ] **Step 2: Typecheck backend**

Run: `(cd backend && npx tsc --noEmit -p tsconfig.json)`
Expected: tidak ada galat baru di file P4. Bandingkan dengan keluaran pada commit baseline Task 1 bila baseline sudah punya galat.

- [ ] **Step 3: Suite frontend penuh, lint, dan build**

```bash
cd "D:/Projects/New folder/simsa-atrbpn/frontend"
npx vitest run
npx eslint src/pages/LacakSurat.jsx src/components/lacak src/hooks/use-lacak-search.js src/hooks/use-perlu-dilengkapi-count.js src/lib/lacak-cache.js src/lib/lacak-link.js src/lib/lacak-labels.js src/lib/perlu-dilengkapi.js src/components/GlobalSearch.jsx src/components/app-sidebar.jsx src/components/breadcrumbs.jsx src/App.jsx src/services/rangkaian.service.js
npm run build
```

Expected: vitest PASS (baseline + 9 file uji baru Task 8–15, ditambah 4 file uji D7: `lib/perlu-dilengkapi.test.js`, `services/rangkaian.service.perlu-dilengkapi.test.js`, `components/lacak/PerluDilengkapiTab.test.jsx`, `hooks/use-perlu-dilengkapi-count.test.jsx`), ESLint tanpa galat, dan build Vite sukses dengan chunk terpisah untuk `LacakSurat`.

- [ ] **Step 4: Postgres EXPLAIN (CI/lokal dengan `TEST_POSTGRES_URL`)**

Run: `(cd backend && TEST_POSTGRES_URL="$TEST_POSTGRES_URL" npm run test:postgres-locks -- integration/lacak-explain.postgres.test.ts)`
Expected: PASS. Salin baris `[lacak-explain] … p95=…ms` ke deskripsi PR.

- [ ] **Step 5: Uji asap manual di dev server**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
(cd backend && npm run dev) &
(cd frontend && npm run dev)
```

Login sebagai `admin_unit` unit uji, lalu periksa:
1. Buka `/surat/lacak` lewat sidebar **Surat ▸ Lacak Surat**.
2. Ketik nomor surat yang ada. URL berubah ke `?q=…` tanpa menambah entri history (Back langsung keluar halaman).
3. Buka satu kartu. `?rangkaian=` muncul dan panel Alur Surat tampil di dalam kartu.
4. Tab **Berkas Rangkaian** memuat daftar tanpa data lama.
5. Ctrl+K lalu cari nomor. Klik **Lihat rangkaian** (tab Network hanya menampilkan `/api/search`, lalu `/api/rangkaian/lacak` setelah halaman Lacak terbuka).
6. (D7) Sidebar **Lacak Surat** menampilkan badge jumlah. Di tab Network, `/api/rangkaian/perlu-dilengkapi/ringkasan` muncul saat aplikasi dibuka, lalu paling sering sekali per 60 detik, dan berhenti saat tab browser disembunyikan.
7. (D7) Buka tab **Perlu Dilengkapi** (`?tab=perlu-dilengkapi`). Hitungan kategori sama dengan badge, dan data lama tersembunyi sampai **Tampilkan data lama** dicentang.
8. (D7) Pada baris **Surat keluar tanpa asal**, klik **Tandai Inisiatif** lalu konfirmasi. Baris hilang, badge berkurang, dan Audit Log (super_admin) memuat entri `surat_keluar`/`update` dengan `asalNaskah` null → `inisiatif`.
9. (D7) Login sebagai `staff` unit uji. Badge tidak tampil dan tidak ada request ringkasan dari sidebar.

Catat untuk runbook deploy P4 (deskripsi PR): isi env `RANGKAIAN_DATA_LAMA_SEBELUM` di Vercel dengan waktu kode P3 aktif di produksi (ISO-8601 berzona, mis. `2026-10-05T00:00:00+07:00`) **sebelum** kode P4 aktif. Bila dibiarkan kosong, batas diturunkan dari `min(created_at)` rangkaian non-`data_lama` (§7 D7).

- [ ] **Step 6: Commit perbaikan (bila ada)**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
git status --short
git add backend/src frontend/src
git commit -F - <<'EOF'
chore(lacak): perbaikan hasil verifikasi akhir P4

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Lewati commit bila `git status` bersih.

---


#### Amandemen pra-eksekusi Task 22 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi + delta terhadap kode P3 yang nyata. Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p4-lacak-surat/preflight-rulings.md`.


1. **Frontend step (REQUIRED) [P4-T22-1, P4-G-6].** In Step 3, replace the `npx eslint src/pages/LacakSurat.jsx …` line with `npx eslint .`. Replace "(baseline + 9 file uji baru Task 8–15, ditambah 4 file uji D7 …)" with "(baseline + 10 file uji baru Task 8–15, ditambah 4 file uji D7 …; total baseline + 14)".
2. **Postgres step (REQUIRED) [P4-T22-2] RECHECK-AFTER-P3.** Step 4 runs:
   - `cd backend && LACAK_PERF=1 TEST_POSTGRES_URL="$TEST_POSTGRES_URL" npm run test:postgres-locks -- integration/lacak-explain.postgres.test.ts integration/lacak.postgres.test.ts`
   - Expected: PASS. Copy the p95 lines, the three EXPLAIN plans (summary: node types and index names) and the ringkasan p50/p95 into the PR.
3. **Env and runbook (REQUIRED) [P4-T22-3].** New Step 5b:
   - Add to `backend/.env.example`:
     ```
     # Batas data lama Perlu Dilengkapi (D7, ISO-8601 berzona). Isi dengan waktu kode P3 aktif di produksi.
     # RANGKAIAN_DATA_LAMA_SEBELUM=2026-10-05T00:00:00+07:00
     ```
   - Add a section "Deploy P4 (Lacak Surat + Perlu Dilengkapi)" to `docs/RUNBOOK_INTEGRASI_SURAT_P3.md`:
     1. Before activating P4 code, set Vercel env `RANGKAIAN_DATA_LAMA_SEBELUM` (backend) to the P3 go-live time, zoned.
     2. Confirm `SHOW TimeZone` = `UTC` for the runtime role (Neon default), because `created_at` is `timestamp` without zone.
     3. There is no migration.
     4. Rollback: redeploy P3.
   - `git add backend/.env.example docs/RUNBOOK_INTEGRASI_SURAT_P3.md` in Step 6.
   - **(delta P3) Runbook is in flux.** At b4d86fa the P3 runbook has sections §1 Pre-flight, §2 Urutan, §3 Kriteria keluar, §4 Peran (shell block with `export DATABASE_URL="$NEON_RUNTIME_DATABASE_URL"`, :99), §5 Flag, and §6 Rollback, which reads "Redeploy P2" (:129-133).
     - The fix wave rewrites §2 (S-I1: real Neon commands `scripts/neon-database.mjs migrate --apply` + `verify-runtime`, CI Postgres gate, `/ready`, backfill before and after deploy) and §6 (S-I2: rollback floor = last deployed production release with 0047 kept). It also adds a "Gerbang rilis" section.
     - Append "Deploy P4" as a new **last** section of the post-fix file, and edit no existing line. Step 2 ("Confirm `SHOW TimeZone`") uses the §4 shell pattern (`psql "$NEON_RUNTIME_DATABASE_URL"`). The rollback step reads "Redeploy the last P3 release" (C-6 item 4).
4. **Commit step root (BLOCKING) [P4-G-1].** Steps 5 and 6 run from the P4 worktree root.
5. **(delta P3) Carry-in hygiene from the P3 final reviews (ADVISORY; optional Step 5c, or an explicit PR deferral).** P3 labels these "(P4)" or "any phase". Each is small and local. For each one, either fix it here with a test, or list it in the PR under "Ditunda" with the owner named:
   - (a) `audit-log.service.ts` `getActionLabel`/`getEntityTypeLabel` lack `view_via_rangkaian`, `rangkaian_surat`, `rangkaian_relasi`, `merge` and `link` (P3 carry-in, `progress.md:6`; access carry-forward 3).
   - (b) `file-access.routes.ts:116-122` sets the PDF headers before `logActionOrThrow` (same sources).
   - (c) `GET /api/distributions/:id`, readable branch, lacks `masked: false` (`distribution.routes.ts:199`; access carry-forward 2).
   - (d) `validateIdParam` on every `/distributions/:id*` route, plus a `superRefine` guard on the jamak distribution form (spec review, "any phase").
   - (e) Dedupe the two surat detail handlers (P2 T16-9 deferred; spec review "P4 (from P2)").
   - (f) Grant rows exposing a masked `entityId`/class (access M-1, carry-forward 9), unless the P3 fix wave already fixed it. If it is not fixed, it stays a release-gate row (Global item 7).


**C-6 (critic) — Task 22: "Deploy P4" runbook additions — REQUIRED (production readiness) [P4-C-6]**


Append to the runbook section of Task 22 item 3:
1. **Smoke test.** An invalid `RANGKAIAN_DATA_LAMA_SEBELUM` turns every D7 call into a 500 (P4:3950-3955; intended by spec:672). After the deploy, call `GET /api/rangkaian/perlu-dilengkapi/ringkasan` as a FULL_ADMIN and expect 200 with `batasDataLama` equal to the configured instant.
2. **Env timing.** Vercel applies an env change only to new deployments. Set the variable before triggering the P4 production deployment, or redeploy after setting it.
3. **Record the value.** Record the exact value in the runbook result. P5's backfill must reuse it verbatim (P5 critic C-1 and C-6).
4. **Rollback.** Redeploy P3. `asal_naskah='inisiatif'` values written by Tandai Inisiatif stay, and P3 accepts them (the column and CHECK exist since `0046_rangkaian_surat.sql:229-231`).


**C-7 (critic) — Tasks 21, 22: per-IP `generalLimiter` budget in the release gate (Global item 7) — ADVISORY (production readiness) [P4-C-7]**


- In production, `generalLimiter` allows 500 requests per 15 minutes per IP (`rate-limiter.middleware.ts:17-22`, mounted at `app.ts:345`).
  - spec:588 moves the NAT problem to a separate task, and P5-T15-1 skips that task.
  - P4 adds the badge poll (≤15 per 15 minutes per FULL_ADMIN tab, P4:5644) and debounced Lacak typing to the same bucket.
- Add a row to "Gerbang rilis P4": "Anggaran `generalLimiter` per IP: (jumlah tab FULL_ADMIN di balik NAT kantor × 15 + polling notifikasi yang ada) < 500 per 15 menit — pemilik menerima, atau menjadwalkan re-key per pengguna (P5 Task 15) dengan sign-off."


**Carry-in P3 (kontroler, WAJIB di item 5):** perbaiki residual review ulang P3: N-1 urutan pemotongan 300 node Lacak (lacak.service.ts:143-157) samakan dengan getDetail; N-2 edit multipart surat masuk yang hanya beda tag/spasi tidak boleh melewati kewajiban alasan (tindak-lanjut.hook.ts:70-120, sanitasi multipart sebelum guard); N-3 jangan 500 setelah reject ter-commit bila checkRead pasca-commit gagal (distribution.routes.ts:344-345) — kembalikan bentuk tersamar; N-4 kuatkan test distribution.service.test.ts:143-148 agar mendeteksi transaksi top-level liar. Lihat simsa-integrasi-surat-p3/.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/final-rereview.md.


## Self-Review

**Cakupan spec:**
- §6 Normalisasi, klasifikasi kueri, dan skor 100/90/70/50/40(+5)/20 → Task 2 (ditambah tingkat 80 *prefix mentah berbatas*).
- §6 Pengelompokan dan batas 8 kelompok → Task 3.
- §6 Pratinjau ≤ 8 node → dikonsumsi di Task 11 dan diuji di Task 3 (label relasi).
- §6 `SET LOCAL statement_timeout` dan batas 300 node → tetap milik P3/P2 (tidak diubah).
- §6 Performa (index `text_pattern_ops`, p95 < 150 ms) → Task 7.
- §6 Klien (debounce 300 ms, minimal 3 karakter, AbortController, penjaga urutan basi, cache 20) → Task 8 dan 10, diuji ulang di halaman pada Task 13.
- §6 "Bila hanya satu kelompok cocok, klien langsung membukanya" → Task 13.
- §6 "Ctrl+K tidak menambah request; ada item Lacak rangkaian 'q'" → Task 15.
- §7 `pages/LacakSurat.jsx` di `/surat/lacak` dengan RoleGuard `ALL_PROVISIONED_ROLES` → Task 13–14.
- §7 Sidebar grup Surat `app-sidebar.jsx:84-85` → Task 14.
- §7 Satu input besar, kartu, pratinjau inline, ekspansi di tempat, serta `?q=`/`?rangkaian=` → Task 11 dan 13.
- §7 Tab Berkas Rangkaian (filter unit pengolah dan status, data lama tersembunyi) → Task 5, 6, dan 12; "Tutup massal data lama" untuk pengawas → P5 Task 7–10 (disisipkan ke `BerkasRangkaianTab`).
- §7 GlobalSearch "Lihat rangkaian" tanpa request tambahan → Task 15.
- §10-P4 kriteria:
  - Fixture ranking (varian B-12/PTPP.1/IX/2024, SK berulang tiap tahun, 1/23 vs 12/3) → Task 2 dan 3.
  - Probing perihal tersamar → Task 4.
  - EXPLAIN 50 ribu baris → Task 7.
  - RTL debounce/abort → Task 10 dan 13.
- §11 "debounce/abort dan sinkronisasi URL di LacakSurat" → Task 13.
- §10 "Setiap PR memperbarui `app-sidebar.groups.test.jsx`" → Task 14.
- D5 → `lingkupSql` (Task 5) memakai FULL_ADMIN dan `is_unit_pengawas` pada unit efektif, dengan kasus `admin_sesditjen` unit NULL dan `staff@sesditjen`.
- **D7 (2026-09-27), §7 "Perlu Dilengkapi":**
  - enam kategori beserta kriterianya → Task 16 (satu cabang SQL per kategori, satu kueri untuk daftar dan ringkasan)
  - visibilitas §4 (cakupan unit sendiri/pengawas/peserta, isi `visibleSql 'list'`, placeholder §4.8, aksi baca bila `visibleSql 'read'`) → Task 16, diuji matriks lima pengguna, pindai JSON, dan paritas `checkRead`
  - data lama tersembunyi dan filter "Tampilkan data lama" → Task 16 (batas `RANGKAIAN_DATA_LAMA_SEBELUM` beserta cadangannya) dan Task 20 (kotak centang)
  - `aksiDiizinkan` baris konsisten dengan P3 → Task 16 (`computeSuratAksi`/`computeRangkaianAksi`) dan Task 20 (render hanya dari `aksiDiizinkan`)
  - endpoint Tandai Inisiatif pemilik-saja, diaudit di transaksi yang sama, berlaku pada surat `approved`/terarsip (trigger 0021 diverifikasi) → Task 17
  - route, validator `.strict()`, allowlist demo, urutan mount → Task 18
  - tab `?tab=perlu-dilengkapi` → Task 20
  - badge sidebar "Lacak Surat (N)", irama notifikasi 60 detik → Task 21
- §5 baris API D7 → Task 18. §10-P4 kriteria D7 → Task 16–21 dan Task 22 Step 5 butir 6–9. §11 tes D7 → Task 16–21.

**Pemindaian placeholder:** setiap langkah kode memuat kode lengkap. Dua titik ubah bergantung pada kode P3 yang belum tertulis saat rencana ini disusun: ekspresi skor/ORDER BY di Task 3 Step 4 dan pemetaan `judul` di Task 4 Step 4. Keduanya diberi fragmen kode persis beserta perintah `grep` penemu lokasinya (Task 1 Step 2). Task 1 menghentikan eksekusi bila nama P2/P3 berbeda. Titik ubah D7 memakai teks persis:
- Task 16 Step 3(b): impor dan `lingkupSql` dari Task 5
- Task 20 Step 3: baris `tab`/`ubahTab`/`TabsTrigger` dari Task 13
- Task 21 Step 3: blok render sub-item `app-sidebar.jsx` sesuai kode di `5f57b39`, serta sub-item "Lacak Surat" dari Task 14

**Konsistensi tipe dan nama:**
- `LacakResult`/`LacakKelompok`/`LacakNode`/`LacakNodeTersamar` (Task 1) dipakai sama di fixture backend (Task 3–4) dan frontend (Task 10–13).
- `kunci` rangkaian = uuid mentah dan surat tunggal = `surat:<uuid>`, persis ekspresi P3 `CASE WHEN rs.id IS NULL THEN 'surat:' || t.surat_id::text ELSE coalesce(rs.digabung_ke_id, rs.id)::text END`.
- `rangkaianService.lacak(params, { signal })` (Task 9) cocok dengan pemanggil di Task 10 dan mock di Task 13/15.
- `list` mengembalikan respons utuh sesuai kebutuhan `usePaginatedResource` (`response.data`, `response.pagination.total`, `response.meta`).
- `meta.aksiDiizinkan` selalu `[]` di Task 5 dan 6; Task 12 tidak membacanya (Tutup massal milik P5 via `GET /api/rangkaian/data-lama/ringkasan`).
- `judulRangkaianTampil` konsisten di Task 4 dan 5.
- `LACAK_MIN_CHARS`/`LACAK_MAX_CHARS` konsisten di Task 8, 10, 13, dan 15.
- D7:
  - `KATEGORI_PERLU_DILENGKAPI` sama di `perlu-dilengkapi.constants.ts` (Task 16, dipakai validator Task 18) dan `lib/perlu-dilengkapi.js` (Task 19, diuji urutannya).
  - `PerluDilengkapiAksi` (`tindak_lanjut`, `disposisi`, `buka_kotak_disposisi`, `buat_nd_penjelas`, `buka_surat`, `berkaskan`, `tandai_inisiatif`, `tautkan`) sama di Task 16 dan tombol Task 20.
  - Bentuk `PerluDilengkapiItem` (Task 16) sama dengan fixture Task 20.
  - `ringkasan` → `{ perKategori, total, lewatBatas, batasDataLama }` sama di Task 16, 18, 19, 20, dan 21.
  - `PERLU_DILENGKAPI_EVENT` detail `{ total }` sama di Task 19, 20, dan 21.
  - `tandaiInisiatif(suratKeluarId)` ↔ `POST /api/rangkaian/surat-keluar/:suratKeluarId/tandai-inisiatif` ↔ `asalNaskahService.tandaiInisiatif(user, id, audit)` konsisten.
  - `lingkupRangkaianSql(ctx, alias)` dipakai `rangkaianDaftarService.list` (lewat `lingkupSql`) dan cabang `siap_diberkaskan`.

**Ambiguitas spec yang diselesaikan di rencana ini:**
1. **Bentuk respons `/lacak`** tidak dirinci spec, sehingga dibekukan di Task 1 dari §4.8, §5, dan §6 lalu diverifikasi terhadap kode P3.
2. **`GET /api/rangkaian` tidak ditugaskan** ke fase mana pun di §10, padahal dibutuhkan tab Berkas Rangkaian. P4 membangunnya dengan merakit fragmen P2 (`resolveKonteksBaca`, `jangkauanSql`, `dalamCakupanPengawasSql`, `cocokUnitRekamanSql`), jadi tidak ada predikat kedua. Hasilnya dijaga uji paritas terhadap `checkRead`. Cabang `rangkaian_peserta` ikut otomatis lewat `ctx.disposisiLamaRead`.
9. **`AlurSuratPanel` P2 hanya memuat per surat** (`jenis`/`suratId` → `getBySurat`), padahal Lacak membuka kartu per rangkaian (`?rangkaian=`). P4 menambah prop opsional `rangkaianId` → `getById` tanpa mengubah perilaku P2 (Task 9). Label di `lacak-labels.js` sengaja tidak mengimpor konstanta dari modul panel, agar kartu tetap berfungsi ketika panel di-mock dalam uji halaman.
3. **"Tutup massal data lama" (UI di §7, endpoint di §10 P5).** Diputuskan pada tinjauan konsistensi lintas fase: endpoint **dan** UI dimiliki P5 (Task 7–10) dengan kontrak tunggal `POST /api/rangkaian/data-lama/tutup-massal` body `{ tahun?, unitPencatatId?, klasifikasiItemId?, dryRun, konfirmasi?, expectedCount? }` → `{ jumlah, tanpaKlasifikasi, contoh, contohTanpaKlasifikasi, terpotong, diterapkan }`, plus `GET /api/rangkaian/data-lama/ringkasan` → `{ dapatMenutup, perTahun }`. P4 hanya menyediakan tab `BerkasRangkaianTab` yang disisipi komponen P5.
4. **"Lihat rangkaian" tanpa request tambahan** dipenuhi dengan navigasi ke `/surat/lacak?q=<nomor>`. Bila judul hasil adalah cadangan `SM-n/yyyy`/`SK-n/yyyy`, kueri memakai perihal. Tidak ada parameter URL baru selain `?q=`/`?rangkaian=`, ditambah `?tab=berkas` untuk tab.
5. **Auto-open kartu tunggal** tidak menulis `?rangkaian=`. Status "ditutup" disimpan per kueri agar kartu tidak terbuka ulang. Sinkronisasi `?q=` memakai `replace`.
6. **Refinement ranking.** Ditambahkan:
   - tingkat *prefix mentah berbatas* (80), untuk tabrakan `1/23/…` vs `12/3/…` yang tidak tertangani skor persis
   - urutan seed sebelum `LIMIT 200`
   - tie-break `kunci ASC` agar deterministik

   Tabel skor §6 lainnya tidak berubah.
7. **Pengawas di daftar** mengikuti §4.4 (unit rekaman ∈ ditjen/sesditjen/`dir_*`) dan diterapkan pada unit pencatat rangkaian. Role lama hanya melihat rangkaian yang dicatat unitnya sendiri.
8. **Cache 20 entri** berlaku per instans halaman (bukan global), agar data tidak basi antar-sesi atau antar-pengguna.
10. **Batas data lama D7.**
    - Definisi: rangkaian `asal='data_lama'`, **atau** surat tanpa keanggotaan rangkaian dengan `created_at` < batas.
    - Batas diambil dari env `RANGKAIAN_DATA_LAMA_SEBELUM` (ISO-8601 berzona; runbook: waktu kode P3 aktif). Tanpa env, batas = `min(created_at)` rangkaian non-`data_lama` (backfill langkah 1 berjalan tepat sebelum kode P3). Tanpa rangkaian sama sekali, batas = sekarang (fail-safe: menyembunyikan, bukan membanjiri). Nilai rusak → 500 eksplisit.
    - Disposisi pra-deploy tetap tampil karena backfill langkah 1 memasukkannya ke rangkaian `asal='surat_masuk'`.
    - Tidak ada tabel konfigurasi baru.
11. **Irama badge.** Mengikuti `useNotifications` (`refreshInterval: 60000` di `app-header.jsx`):
    - satu request saat aplikasi dibuka, lalu paling sering sekali per 60 detik dan hanya saat tab terlihat
    - ringkasan dari tab dibagikan lewat event tanpa request
    - hanya FULL_ADMIN

    Pilihan "hanya saat navigasi" ditolak karena setiap perpindahan halaman akan memicu request dan justru melampaui irama notifikasi.
12. **Otorisasi Tandai Inisiatif.** FULL_ADMIN + unit pemilik + kebijakan list (`visibleSql 'list'`), bukan `check()`. Alasannya, `check()` mensyaratkan grant untuk kelas Terbatas, termasuk surat keluar lama yang klasifikasinya NULL, sehingga kasus utama tidak pernah bisa ditandai. Hanya `asal_naskah` yang diubah dan respons tidak memuat isi surat. Keputusan ini dicatat di spec §13 untuk sign-off keamanan.
13. **Detail kategori.**
    - `sk_tanpa_nd_penjelas` hanya untuk Keputusan `approved`; draf masih bisa berubah.
    - `sm_belum_ditindaklanjuti` mengecualikan rangkaian `selesai`/`diberkaskan`, sehingga Tandai Selesai manual menutupnya, dan juga balasan lama via `balasan_untuk`.
    - `disposisi_terbuka` juga tampil bagi unit sumber (TU pemilik).
    - Badge = `total` ringkasan tanpa data lama, termasuk baris tersamar. Baris tersamar tetap pekerjaan yang harus diselesaikan, mis. oleh super_admin atau lewat Ajukan Akses.

## Catatan Konsistensi Lintas Fase (2026-09-26)

Perubahan dari tinjauan konsistensi P0–P5 terhadap berkas ini:

- Task 1/3/4 diarahkan ulang ke kode P3 yang sebenarnya: `backend/src/services/rangkaian/lacak.service.ts` (`skorSql`, `ekspansi`), bukan `rangkaian.service.ts` (yang hanya mendelegasikan). Anchor Task 3 kini blok `return` persis dari `skorSql` P3; urutan seed/kelompok diverifikasi (sudah ditulis P3). Anchor Task 4 kini baris `judul` persis dari `ekspansi` P3.
- Typedef `LacakResult` disamakan dengan `lacak.types.ts` P3 (`LacakNode.unitKerjaId`, status `digabung`, `kunci` = `coalesce(rs.digabung_ke_id, rs.id)` / `'surat:'||surat_id`); deskripsi `normalizeNomor` dikoreksi (buang dulu, baru lowercase).
- Task 2: `bentukKueriLacak` tidak lagi mengklasifikasi sendiri — memetakan `classifyLacakQuery` P3 (satu klasifikasi kueri).
- Task 8/9/10/13: hook `useLacakSurat`/`use-lacak-surat.js` dihapus; Task 10 kini memperluas hook P3 `useLacakSearch` (`use-lacak-search.js`) dengan test baru `use-lacak-search.p4.test.jsx`; `lacakCacheKey` ikut memuat `jenis`; Task 9 tidak lagi mengganti `rangkaianService.lacak` P3 (mempertahankan `jenis` dan `limit = 8`).
- Task 9/12 dan Self-Review: "Tutup massal data lama" (service klien, tombol, dialog `{ unitPengolahId, alasan }` → `{ jumlah }`) dihapus dari P4; endpoint **dan** UI dimiliki P5 dengan kontrak tunggal pratinjau + `expectedCount`. `meta.aksiDiizinkan` tetap `[]`.
- Task 6: urutan mount final `/api/rangkaian` dicantumkan; Branch diganti `feat/integrasi-surat-p4` dari `origin/main` (sebelumnya `feat/integrasi-surat-p4-lacak`).

## Catatan Konsistensi Lintas Fase — tambahan D7 (2026-09-27)

Tambahan keputusan pengguna **D7** (tab Perlu Dilengkapi + badge sidebar) ke rencana ini:

- **Task baru 16–21** disisipkan sebelum verifikasi akhir. Verifikasi akhir kini **Task 22** (sebelumnya Task 16), dan rujukan baseline di Task 1 ikut diperbarui.
  - Task 16: `perluDilengkapiService` + `resolveBatasDataLama`, ekspor `lingkupRangkaianSql` dari Task 5
  - Task 17: `asalNaskahService.tandaiInisiatif`
  - Task 18: router `rangkaian-perlu-dilengkapi.routes.ts`, validator, demo, `app.ts`
  - Task 19: klien
  - Task 20: `PerluDilengkapiTab` + `LacakSurat`
  - Task 21: badge sidebar
- **Urutan mount final** `/api/rangkaian` (Task 6 diperbarui): `rangkaianDaftarRoutes` (P4 Task 6) → `rangkaianPerluDilengkapiRoutes` (P4 Task 18) → `rangkaianBerkasRoutes` (P5 Task 8, disisipkan tepat sebelum router utama sesuai rencana P5) → `rangkaianRoutes` (P2/P3). Jalur ketiga router tambahan tidak beririsan. Uji sumber `app.ts` di P5 Task 8 (berkas sebelum utama) tetap berlaku, begitu pula uji Task 18 (daftar < D7 < utama).
- **Nama P2/P3 yang dikonsumsi D7** (diverifikasi grep Task 1 Step 2–3):
  - `visibleSql`, `jangkauanRekamanSql`, `cocokUnitRekamanSql`, `kecocokanUnitRekaman`, `dalamCakupanPengawas(Sql)`, `resolveKonteksBaca`, `barisDari`, `PelaksanaSql`, `TargetVisibilitas` (P2 Task 2)
  - `isAllowedForRecordUnit` (P2)
  - `computeSuratAksi`/`computeRangkaianAksi` (P3 Task 16) dan `isFullAdmin` (P3 Task 1)
  - `buildTindakLanjutState` (P3 Task 19), `DistributeDialog` (P3 Task 22), `BerkaskanDialog` dan `TautkanDialog` (P3 Task 25)
  - D7 tidak mengubah satu pun modul P2/P3. Satu-satunya perubahan pada berkas P4 lain adalah ekspor `lingkupRangkaianSql` di `rangkaian-daftar.service.ts` (perilaku Task 5 tetap, dan tes Task 5 dijalankan ulang di Task 16).
- **P3 tidak punya jalur untuk mengisi `asal_naskah` surat yang sudah ada** (`updateSuratKeluarSchema` meng-`omit` `asalNaskah`). Karena itu D7 menambah endpoint Tandai Inisiatif di P4. Trigger 0021 (`protect_archived_surat_source`) diverifikasi tidak menjaga `asal_naskah`/`updated_at`, sehingga endpoint berlaku pada surat terarsip tanpa mengubah migrasi.
- **Konfigurasi baru:** env `RANGKAIAN_DATA_LAMA_SEBELUM`, dicatat di runbook deploy P4 (Task 22 Step 5). Tidak ada tabel, migrasi, role, flag, atau limiter baru; badge memakai `generalLimiter` yang ada.
- **P5:** notifikasi batas waktu (P5) dan daftar kerja D7 memakai tanggal Jakarta yang sama (`jakartaDate()`). Tutup massal data lama (P5) mengurangi baris `siap_diberkaskan` berasal `data_lama` yang hanya tampil saat "Tampilkan data lama" dicentang. Tidak ada kontrak P5 yang berubah.
- **(2026-09-27, terpisah dari D7)** Task 3 fase P2 (review fix round 2) mengganti validasi alias `lingkupRangkaianSql` (Task 16, blok kode di atas) dari regex `/^[a-z_][a-z0-9_]*$/` yang ditulis sendiri menjadi `aliasAman` yang diekspor dari `visibility-spec.ts`, sehingga alias di sini tunduk pada aturan yang sama: menolak alias berprefiks `jk_` dan nama bekas `ra`/`g`/`j` yang dicadangkan untuk subkueri internal `jangkauanUnitsSql`/`jangkauanSql`/`grantAktifSql`/`jangkauanRekamanSql` (lihat berkas P5 untuk latar belakang kebocoran lintas rangkaian yang mendorong prefiks `jk_`). `alias` yang disisipkan ke `jangkauanSql` di `lingkupRangkaianSql` tetap harus dikualifikasi (`${alias}.id`, bukan `id` telanjang) — `aliasAman` memvalidasi alias itu sendiri, bukan bagaimana ia dipakai di dalam SQL mentah.
