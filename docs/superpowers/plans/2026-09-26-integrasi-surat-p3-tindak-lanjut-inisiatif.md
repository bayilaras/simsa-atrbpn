# Integrasi Surat — P3 Alur Tindak Lanjut, Disposisi & Surat Inisiatif Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menghidupkan alur kerja Rangkaian Surat end-to-end: backfill disposisi lama, backend Lacak (3 mode), registrasi surat masuk dengan disposisi multi-direktorat dan Nomor Referensi, tindak lanjut/Surat Inisiatif, kotak disposisi bertopeng dengan terima/penyelesaian/tutup, status turunan monoton, serta selesai/berkaskan/tautan/gabung/batal dan Ajukan Akses, lengkap dengan antarmukanya.

**Architecture:** Semua perilaku P3 hidup di modul baru `backend/src/services/rangkaian/*` dan hanya menyentuh antarmuka P1/P2 lewat satu adapter (`services/rangkaian/deps.ts`) yang kontraknya dikunci oleh satu test. Hook create surat masuk/keluar dimuat dari modul terpisah (`tindak-lanjut.hook.ts`) agar test berbasis Proxy mock cukup me-`vi.mock` satu modul. Aturan status (§8) dipisah menjadi fungsi murni (`rangkaian-status.ts`) dan pemuat SQL (`rangkaian-status.service.ts`); frontend memakai `aksiDiizinkan[]` dari server, bukan `canWrite(unit)`.

**Tech Stack:** Express + TypeScript + Drizzle ORM (node-postgres) + PostgreSQL, Zod 4, express-rate-limit, Vitest (Proxy mock, supertest, PGlite, Postgres terisolasi via `vitest.postgres.config.ts`); React 19 JSX + shadcn/ui + react-router 6 + Vitest/RTL.

**Spec:** docs/superpowers/specs/2026-09-26-integrasi-surat-masuk-keluar-design.md

## Global Constraints

- **Git:** kerjakan di branch `feat/integrasi-surat-p3`: `git fetch origin && git switch -c feat/integrasi-surat-p3 origin/main` setelah PR P2 dimerge. Konvensi lintas fase: satu branch per fase `feat/integrasi-surat-pN`, dibuat dari `origin/main` setelah PR fase sebelumnya dimerge; bila PR itu belum dimerge, branch ditumpuk di ujung `feat/integrasi-surat-p(N-1)` lalu di-rebase ke `origin/main` setelah merge. Satu PR per fase ke `main`.
- D5: tidak ada role baru; role yang diberikan hanya `super_admin` dan `admin_unit`. Pengawas = role FULL_ADMIN (`super_admin`, `admin_unit`, `admin_dirjen`, `admin_sesditjen`) **dan** unit efektif (`resolveEffectiveUnitKerjaId(role, user.unitKerjaId)`) ber-`unit_kerja.is_unit_pengawas = true`.
- D6: `bagian_*` (Kabag) hanya chip label; server menolak target disposisi ber-`unit_type = 'bagian'` atau `can_receive_distribution = false` (400).
- `check()` di `record-access.service.ts` tidak diubah sedikit pun; semua mutasi rekaman tetap owner-only.
- Semua endpoint tulis: `canWriteMiddleware()`, `logActionOrThrow(..., tx)` di transaksi yang sama. entityType audit: disposisi `surat_distribution` (tunggal), rangkaian `rangkaian_surat`, relasi `rangkaian_relasi`, status surat masuk `surat_masuk`.
- Semua handler GET bebas efek samping selain audit view; membuka detail **tidak** mengubah status disposisi. `received` hanya lewat PUT `/receive` atau implisit di transaksi tindak lanjut/penyelesaian.
- Semua `:id` baru memakai `validateIdParam(...)`; semua path baru ditambahkan ke allowlist `backend/src/middlewares/demo-access.middleware.ts`.
- `lacakLimiter`: 90 req/menit, `keyGenerator: req.user.id`, dipasang setelah auth. `generalLimiter` **tidak** diberi skip.
- `/api/rangkaian/lacak`: `q` di-trim, panjang 3–100; `limit` 1–8 (default 8); maksimum 8 kelompok, 8 node pratinjau per kartu; `SET LOCAL statement_timeout = '2s'`; `visibleSql` diterapkan di seed **sebelum** `LIMIT 200`.
- Skor Lacak (persis): nomor mentah sama (case-insensitive) 100; `nomor_norm` sama 90; prefix `nomor_norm` 70; substring `nomor_norm` 50 (hanya bila `len(qNorm) ≥ 5`); semua token di perihal 40 (+5 bila frasa utuh); dari/kepada 20.
- Normalisasi nomor SQL persis ekspresi index: `lower(regexp_replace(coalesce(nomor_surat,''),'[^0-9A-Za-z]+','','g'))`.
- Kode rangkaian `RS-YYYY-NNNNNN` dari `nextval('rangkaian_surat_kode_seq')` (YYYY = `tahun` surat induk).
- Alasan/catatan wajib `trim().length ≥ 10`; `purpose` grant `≥ 20`.
- Flag `RANGKAIAN_AJUKAN_AKSES` default mati (hanya string `true` yang menyalakan). Selama mati, disposisi surat masuk kelas Terbatas ke atas ditolak 409 dengan pesan persis: `Surat terkendali belum dapat didisposisikan; tangani di unit pencatat atau aktifkan jalur akses disposisi`.
- Semua query recompute/prasyarat menyaring `is_deleted IS NOT TRUE`.
- Urutan kunci: mutex `surat_templates` → baris surat → baris `rangkaian_surat` (id menaik) → `surat_distributions`.
- Kode aplikasi tidak pernah `DELETE` pada `rangkaian_surat`, `rangkaian_anggota`, `rangkaian_relasi`, `rangkaian_peserta`, `rangkaian_koreksi_berkas`.
- Tidak disentuh: `SuratMasukService.getStats`, `arsip.service`, `ArchiveDialog`, `KlasifikasiPicker` (hanya diimpor), `dosir.service`, pemanggilan/payload producer SRIKANDI. Jangan jalankan drizzle-kit.
- Kata "Kembalikan" tidak dipakai untuk pemberkasan (dipakai "Tolak & Kembalikan" di kotak disposisi).
- Runbook deploy P3: migrate → `db:grants:converge` → `npm run db:backfill:rangkaian-disposisi` (harus melapor `sisaTanpaRangkaian: 0`) → deploy kode P3.
- Pembagian P1/P3: P1 menyediakan primitif (tabel, `rangkaianService.ensureForSurat(tx, {jenis,id}, aktor)`, `ensureForSuratMasuk(tx, id, aktor, opsi?)`, `attach`, `gabung`, `recomputeStatus`, `recomputeSuratMasukStatus`, `jangkauanUnitIds`, tipe `DbTransaction`, `distribute(data, auditContext?, tx?)`); P2 menyediakan `resolveKonteksBaca`, `visibleSql`, `dalamCakupanPengawas`, `isAjukanAksesEnabled`, `barisDari`. P3 memiliki semua aturan perilaku (wewenang, §8, berkaskan, gabung, tautan) dan penguncian `lockRangkaian` di `deps.ts`. Semua impor P1/P2 dari kode P3 **wajib** lewat `backend/src/services/rangkaian/deps.ts`.
- Aksi audit memakai union yang sudah ada (`'create'`, `'update'`, `'cancel'`, `'status_change'`, `'process_distribution'`, dst. + `'link'`/`'merge'` dari P1); P3 **tidak** menambah nilai baru ke union aksi audit.
- Perintah test: backend unit `cd backend && npx vitest run <file>`; Postgres `cd backend && TEST_POSTGRES_URL=postgresql://simsa_test:simsa_test@127.0.0.1:5432/simsa_test npx vitest run --config vitest.postgres.config.ts <file>`; frontend `cd frontend && npx vitest run <file>`; typecheck `cd backend && npx tsc --noEmit -p tsconfig.json`.
- Saat menambah impor ke berkas yang sudah mengimpor modul yang sama (mis. `rangkaian.routes.ts` milik P2), gabungkan ke pernyataan impor yang ada.
- Setiap pesan commit diakhiri baris kosong lalu `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

#### Amandemen pra-eksekusi global (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


1. **GC#30 (lock order): replace with** "Urutan kunci global P3: baris `surat_keluar` (FOR UPDATE ORDER BY id) → baris `surat_masuk` (`lockSuratMasukRows`, ORDER BY id) → baris `rangkaian_surat` (SATU pernyataan `lockRangkaian`, ORDER BY id) → `surat_distributions`. Berlaku untuk SETIAP penulisan `surat_distributions` (insert, receive, process, reject, tutup, penyelesaian) dan SETIAP pemanggilan `recomputeSuratMasuk`, termasuk sesudah `recomputeRangkaian`. Id yang akan dikunci dibaca dulu tanpa kunci. Setelah kunci diambil, keanggotaan/`rangkaian_id` dibaca ulang; bila berubah karena gabung bersamaan, ulangi sekali lalu 409. Trigger 0046 mengambil FOR SHARE pada rangkaian SETELAH baris distribusi terkunci (RB P1:88-90), jadi jalur yang meng-UPDATE distribusi wajib sudah memegang kunci rangkaian." [G-LOCK]
2. **New GC (retry):** "Setiap transaksi yang dibuka sendiri oleh layanan P3 dibungkus `denganRetryDeadlock` (deps): maks. 3 percobaan, setiap percobaan memakai `db.transaction` baru, hanya untuk 40P01/40001, dan kehabisan percobaan → 409 `Terjadi konflik penyimpanan bersamaan; silakan coba lagi.`. Tidak pernah di dalam `tx` milik pemanggil." [G-RETRY]
3. **GC#16: append** "Pengecualian yang disengaja: `super_admin` diperlakukan sebagai superset pengawas di P3 (spec:473). Pengawas non-super_admin hanya berwenang atas rekaman/rangkaian yang unit rekamannya (atau `unit_pencatat_id`-nya) lolos `dalamCakupanPengawas` — predikat tunggal `pengawasUntukUnit` di deps, identik dengan tier baca P2." [G-SA, G-PENGAWAS]
4. **GC#35: append** "Utilitas/tipe P0 (`utils/nomor-surat`, `normalizeSecurityClassification`, `requiresExplicitAccessGrant`, `type RecordUser`, tipe `validators/schemas`) boleh diimpor langsung; simbol layanan runtime P1/P2 dan simbol baru P1/P2 hanya lewat `deps.ts`." [G-GC35]
5. **GC#38: append** "Potongan impor di rencana adalah TAMBAHAN; `rangkaian.routes.ts:3` sudah mengimpor `validateIdParam`." [G-IMPORT]
6. **GC#27: append** "Hanya untuk endpoint baru P3; `rejectDistributionSchema.reason` tetap `min(1)`." [T5-4]
7. **New GC (anchoring):** "Nomor baris di rencana ini adalah petunjuk. Sunting berdasarkan simbol, nama `describe`, atau teks jangkar; P1/P2 menggeser berkas target 1–45 baris." [G-ANCHOR]
8. **Tech stack line (plan:9):** change `react-router 6` to `react-router 7 (react-router-dom ^7.18.2)`. New component tests go under `frontend/src/components/surat/__tests__/`. [G-STACK]
9. **Review Focus #2 (plan:44):** change `nomor-surat.test.ts › escapeLike` to `nomor-surat-lacak.test.ts › escapeLike`. [G-SELFREVIEW]
10. **Self-Review items 3/4 (plan:9408, 9410):** `lockRangkaian` is used by Tasks 10, 11, 14 and 15, not 7 and 8. The lock order is the one stated in GC#30 above, not "rangkaian→distribusi". [G-SELFREVIEW]
11. **File Structure (plan:67) and contract (plan:154):** `rangkaianStatusService` contains only `hitungPenghalang`; `recomputeForSuratKeluar` lives in `deps.ts`. [T12-6]
12. **Out of scope / PR notes: add**
    - Cross-unit konsep (SK draft/pending/rejected) stays readable per class for pengawas/peserta, as spec §4.4 and D7 require. Open question for the spec owner. [G-F3]
    - Relasi creators who are not pengawas can cancel via the API but get no UI button. [T16-6]
    - `bukaKembali` is refused for auto-selesai (deviation from spec:715). [T14-3]
    - super_admin ⊇ pengawas. [G-SA]

---


**Ruling kontroler [CTRL-1] (menimpa G-SA untuk Tutup Disposisi):** Tutup Disposisi hanya untuk admin pengawas sesuai spec:478 (spec mengikat). `super_admin` TIDAK otomatis boleh Tutup Disposisi; ia hanya boleh bila juga memenuhi aturan pengawas biasa (role FULL_ADMIN + unit efektif `is_unit_pengawas` + `dalamCakupanPengawas`). Untuk aksi lain, G-SA (super_admin ⊇ pengawas) tetap berlaku. Konsekuensi: `tutupOlehPengawas` dan `computeRangkaianAksi`/`tutup_disposisi` memakai predikat pengawas tanpa jalan pintas super_admin; butir G-SA di C-12 (gerbang rilis) tidak lagi diperlukan untuk Tutup.


**C-12 (critic) — Release gate: spec deviations and open security questions [C-12]**


The spec is binding (precedence rule, amend:6), but some amendments deviate from it or leave a security question open. They currently appear only as "PR notes / Open question" (amend:29-33).

Move these into the P3 release gate that spec:778 already requires ("gerbang rilis: sign-off keamanan …"), and record each item as signed or refused before the production deploy:

| Item | Source | Deviation or open question |
|---|---|---|
| T14-3 | spec:710 | Buka Kembali is refused for an auto-selesai rangkaian, although the spec says "`selesai → aktif` lewat buka kembali dengan alasan". |
| G-F3 | FR:27 | Draft, pending and rejected SK content stays readable cross-unit. FR:27 demands "a ruling/security sign-off". |
| G-SA | spec:478 | Super_admin may use Tutup Disposisi although spec:478 names "admin pengawas". It is consistent with spec:381/701 but needs explicit confirmation. |
| C-10 | this file | The decision on in-flight controlled disposisi. |



## Review Focus

1. **Urutan route `/lacak` vs `/:id` P2.** Bila `GET /lacak` didaftarkan setelah `GET /:id` (dengan `validateIdParam`), setiap pencarian menjadi 400 "Invalid ID format". Orang mengharapkan pencarian berjalan. Test: `lacak.routes.test.ts` › "GET /lacak tidak tertangkap route /:id" (Task 4).
2. **Karakter wildcard LIKE di kata kunci.** Kueri seperti `100% Tanah` atau `B_12` harus dicocokkan literal, bukan sebagai wildcard, sehingga skor frasa (+5) hanya jatuh pada perihal yang benar-benar memuat frasa itu. Test: `lacak.postgres.test.ts` › "wildcard LIKE di kueri diperlakukan literal" (Task 4) dan `nomor-surat.test.ts` › `escapeLike` (Task 3).
3. **Target disposisi ganda, unit sendiri, atau `bagian_*` dalam satu permintaan multi-target.** Harus ditolak 400 **tanpa** baris parsial yang tersimpan (satu transaksi). Test: `rangkaian.schemas.test.ts` › "menolak target ganda dan dua penanggung jawab" (Task 5) dan `disposisi.postgres.test.ts` › "multi-target gagal seluruhnya bila satu target tidak sah" (Task 7).
4. **"Lewat batas waktu" memakai tanggal Jakarta.** Pukul 00.30 WIB (17.30 UTC hari sebelumnya), disposisi dengan batas kemarin (WIB) harus sudah terhitung lewat; batas waktu sebelum hari ini (WIB) ditolak saat dibuat. Test: `rangkaian.schemas.test.ts` › "menolak batas waktu sebelum hari ini (WIB)" (Task 5) dan `kotak-disposisi.postgres.test.ts` › "filter lewat batas memakai tanggal Jakarta" (Task 10).
5. **Tindak lanjut oleh unit yang disposisinya sudah ditolak.** Unit yang menolak disposisi tetapi masih dapat membaca induk (karena pernah menulis anggota) tidak boleh lagi membuat tindak lanjut lewat jalur disposisi (403), dan baris `rejected` tidak boleh ikut "diterima implisit" atau berubah. Test: `tindak-lanjut.postgres.test.ts` › "unit dengan disposisi rejected ditolak dan baris rejected tidak berubah" (Task 8).

---
## File Structure

**Backend — baru**

| Berkas | Tanggung jawab |
|---|---|
| `backend/src/services/rangkaian/deps.ts` | Adapter tunggal atas nama P1/P2: re-export + pembungkus P3 (`aktor`, `isPengawas`, `isPengawasRecordUnit`, `loadJangkauan`, `lockRangkaian`, `recomputeRangkaian`, `recomputeSuratMasuk`, `recomputeForSuratKeluar`). |
| `backend/src/services/rangkaian/sql-rows.ts` | `rowsOf` (= `barisDari` P2), `uuidArraySql()`, `textArraySql()`. |
| `backend/src/services/rangkaian/roles.ts` | `FULL_ADMIN_ROLES` (dari `PERAN_FULL_ADMIN` P2), `isFullAdmin()`, `unitEfektif` (= `unitJangkauan` P2). |
| `backend/src/config/instruksi-disposisi.ts` | Daftar statis chip instruksi disposisi. |
| `backend/scripts/backfill-rangkaian-disposisi.mjs` | Backfill langkah 1 (tanpa gerbang), batch 500, idempoten, diaudit. |
| `backend/src/services/rangkaian/lacak.types.ts` | Kontrak request/response `/api/rangkaian/lacak` (dibekukan untuk P4). |
| `backend/src/services/rangkaian/lacak.service.ts` | Seed CTE + pengelompokan + ekspansi pratinjau bertopeng (`rangkaianService.lacak` mendelegasikan ke sini). |
| `backend/src/services/rangkaian/grant-eligibility.ts` | Predikat tunggal pengajuan/persetujuan grant: pemilik ∨ pengawas ∨ jangkauan hidup. |
| `backend/src/services/rangkaian/disposisi-grant.service.ts` | Grant bertujuan disposisi (flag menyala) dan pencabutannya. |
| `backend/src/services/rangkaian/tindak-lanjut.service.ts` | `attachSuratKeluar` (wewenang + checkRead + terima implisit) dan `referensiSuratMasuk` (skenario d). |
| `backend/src/services/rangkaian/tindak-lanjut.hook.ts` | Modul hook yang di-`vi.mock`: `afterSuratKeluarInsert`, `afterSuratMasukInsert`, `afterSuratKeluarChanged`, `guardSuratMasukMutation`, `afterSuratMasukMutation`. |
| `backend/src/services/rangkaian/rangkaian-status.service.ts` | `hitungPenghalang`, `recomputeForSuratKeluar` (aturan murni tetap di `services/rangkaian-status.ts` P1). |
| `backend/src/services/rangkaian/berkas.service.ts` | Tandai selesai, buka kembali, berkaskan, ubah unit pengolah, opsi berkas. |
| `backend/src/services/rangkaian/rangkaian-link.service.ts` | Otorisasi tautan/gabung di atas primitif P1 `attach`/`gabung`, batal relasi, pratinjau akses baru. |
| `backend/src/services/rangkaian/aksi.ts` | `computeSuratAksi`, `computeRangkaianAksi`, `suratAksiPayload`, `rangkaianAksiUntuk`. |
| `backend/integration/helpers/rangkaian-db.ts` | Harness Postgres terisolasi (buat DB acak, migrasi, seed unit/pengguna/surat). |

**Backend — diubah**

`backend/src/utils/nomor-surat.ts` (P1: tambah `escapeLike`, `classifyLacakQuery`), `backend/src/services/rangkaian-status.ts` dan `backend/src/services/rangkaian.service.ts` (P1: fakta "surat masuk belum ditangani", `deriveStatusAlur`, `lacak`), `backend/src/validators/schemas.ts`, `backend/src/middlewares/sanitize.middleware.ts` (`MULTILINE_FIELDS`), `backend/src/middlewares/rate-limiter.middleware.ts` (`lacakLimiter`), `backend/src/middlewares/demo-access.middleware.ts` (allowlist), `backend/src/services/distribution.service.ts`, `backend/src/routes/distribution.routes.ts`, `backend/src/services/surat-masuk.service.ts`, `backend/src/routes/surat-masuk.routes.ts`, `backend/src/services/surat-keluar.service.ts`, `backend/src/routes/surat-keluar.routes.ts`, `backend/src/services/approval.service.ts`, `backend/src/services/record-access-grant.service.ts`, `backend/src/routes/rangkaian.routes.ts` (P2), `backend/package.json` (script backfill), `backend/src/services/settings.service.ts` + `backend/src/routes/settings.routes.ts` (Task 26: `isUnitPengawas`).

**Frontend — baru**

`frontend/src/lib/tindak-lanjut.js`, `frontend/src/hooks/use-lacak-search.js`, `frontend/src/components/surat/TindakLanjutMenu.jsx`, `frontend/src/components/surat-keluar/ReferensiSection.jsx`, `frontend/src/components/surat-masuk/DisposisiRegistrasiSection.jsx`, `frontend/src/components/distribusi/PenyelesaianDialog.jsx`, `frontend/src/components/surat/AlasanDialog.jsx`, `frontend/src/components/surat/BerkaskanDialog.jsx`, `frontend/src/components/surat/AlurSuratActions.jsx`.

**Frontend — diubah**

`frontend/src/services/rangkaian.service.js` (P2), `frontend/src/services/distribution.service.js`, `frontend/src/components/surat-masuk/DetailHeader.jsx`, `frontend/src/components/surat-masuk/StatusSidebar.jsx`, `frontend/src/pages/SuratMasukDetail.jsx`, `frontend/src/pages/SuratKeluarDetail.jsx`, `frontend/src/pages/SuratMasuk.jsx`, `frontend/src/pages/SuratKeluar.jsx`, `frontend/src/pages/TambahSuratKeluar.jsx`, `frontend/src/pages/TambahSuratMasuk.jsx`, `frontend/src/pages/DistributionInbox.jsx`, `frontend/src/pages/Dashboard.jsx`, `frontend/src/App.jsx`, `frontend/src/components/DistributeDialog.jsx`, `frontend/src/components/surat/AlurSuratPanel.jsx` (P2), `frontend/src/pages/Settings.jsx` (Task 26: toggle **Unit Pengawas (pencatat terpusat)**).

### Kontrak antarfase

Nama di bawah diambil dari `docs/superpowers/plans/2026-09-26-integrasi-surat-p1-skema.md` dan `...-p2-akses-lintas-unit.md`. Semua impor P1/P2 dari kode P3 lewat `deps.ts`, yang dikunci `rangkaian-deps.contract.test.ts` (Task 1).

**Dikonsumsi dari P1:**

```ts
// backend/src/db/transaction.ts
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
// backend/src/services/rangkaian.service.ts
export type JenisSurat = 'surat_masuk' | 'surat_keluar';
export interface SuratRef { jenis: JenisSurat; id: string }
export type RangkaianActor = CriticalAuditContext & { userId: string };
export interface EnsureRangkaianResult { rangkaianId: string; kode: string; anggotaId: string; status: RangkaianStatus; created: boolean }
rangkaianService.ensureForSurat(tx, ref: SuratRef, actor: RangkaianActor, options?: { unitPengolahId?: string | null }): Promise<EnsureRangkaianResult>
rangkaianService.ensureForSuratMasuk(tx, suratMasukId: string, actor, options?): Promise<EnsureRangkaianResult>   // 409 bila diberkaskan/digabung
rangkaianService.attach(tx, { rangkaianId; surat: SuratRef; keAnggotaId; jenisRelasi; keterangan?; sumber?: 'aplikasi' | 'tautan' }, actor): Promise<{ rangkaianId; anggotaId; relasiId; anggotaBaru; digabungDari: string | null; reopened: boolean }>
rangkaianService.gabung(tx, { targetId; sumberId; alasan }, actor): Promise<{ targetId; sumberId; anggotaDipindah; distribusiDipindah; unitAksesBaru: string[]; targetStatus }>
rangkaianService.recomputeStatus(tx, rangkaianIds: string[], actor): Promise<StatusChange<RangkaianStatus>[]>
rangkaianService.recomputeSuratMasukStatus(tx, suratMasukIds: string[], actor): Promise<StatusChange<string>[]>
rangkaianService.jangkauanUnitIds(executor, rangkaianId, options?: { disposisiLama?: boolean }): Promise<string[]>
// backend/src/services/rangkaian-status.ts
deriveRangkaianStatus(facts: RangkaianStatusFacts): RangkaianStatus; deriveSuratMasukStatus(facts): string; isRangkaianTerbuka(status)
// backend/src/utils/nomor-surat.ts
normalizeNomor(value: string | null | undefined): string; nomorNormSql(column: AnyColumn | SQL): SQL<string>
// DistributionService.distribute(data: DistributeInput, auditContext?, tx?) — P3 mengganti isinya (Task 7), tanda tangan dipertahankan
// Drizzle: rangkaianSurat, rangkaianAnggota, rangkaianRelasi; suratDistributions.{rangkaianId,batasWaktu,penanggungJawab,processedBy,penyelesaianSuratKeluarId,catatanPenyelesaian,ditutupPengawas}; suratKeluar.asalNaskah; unitKerja.isUnitPengawas
// LogActionData: action ∪ 'merge' | 'link'; entityType ∪ 'rangkaian_surat' | 'rangkaian_relasi'
```

**Dikonsumsi dari P2:**

```ts
// backend/src/services/record-access.service.ts
recordAccessService.checkRead(user, entityType, entityId, executor?): Promise<ReadAccessResult>   // { ...RecordAccessResult, via: 'owner'|'pengawas'|'peserta'|null, rangkaianId, masked }
recordAccessService.checkMany(user, refs: ReadRef[], executor?): Promise<Map<string /* `${type}:${id}` */, ReadAccessResult>>
findActiveGrant(executor, user, entityType, entityId, unitKerjaId, classification): Promise<ActiveGrant | null>   // ekspor bernama modul, BUKAN metode recordAccessService
// backend/src/services/access/visibility-spec.ts
resolveKonteksBaca(user, executor, env?): Promise<KonteksBaca>   // { user, unitJangkauan, pengawas, disposisiLamaRead }
visibleSql(ctx: KonteksBaca, target: { type: 'surat_masuk' | 'surat_keluar'; alias: string }, mode?: 'read' | 'list'): SQL
dalamCakupanPengawas(unitKerjaId): boolean; unitJangkauan(user): string | null; PERAN_FULL_ADMIN
isAjukanAksesEnabled(env?): boolean; isDisposisiLamaReadEnabled(env?): boolean; barisDari<T>(result): T[]
// backend/src/utils/record-unit-scope.ts
scopeForAuthorizedRead(req, access): RecordUnitScope
// backend/src/routes/rangkaian.routes.ts (default export router; GET /:id, GET /by-surat/:jenis/:suratId) → RangkaianDetail { rangkaian, anggota, relasi, disposisi, aksiDiizinkan: [], truncated, ... }
// GET /api/surat-masuk/:id & /api/surat-keluar/:id → data: SuratRecord & { aksesMelalui, aksiDiizinkan: [] }
// frontend: rangkaianService.{ getById, getBySurat } (frontend/src/services/rangkaian.service.js), <AlurSuratPanel jenis suratId aksesMelalui fallback />
```

**Diproduksi untuk P4/P5** (nama pasti; bentuk Lacak mengikuti yang dibekukan di rencana P4 Task 1):

```ts
// GET /api/rangkaian/lacak?q&tahun&mode=lacak|referensi|cek&limit≤8&jenis=surat_masuk|surat_keluar
// 200 { success: true, data: LacakResult }   400 validasi   403 role tak terprovisi   429 lacakLimiter
export interface LacakResult { q: string; mode: 'lacak' | 'referensi' | 'cek'; jenisKueri: 'nomor' | 'perihal'; kelompok: LacakKelompok[] }
export interface LacakKelompok {
    kunci: string;                   // uuid rangkaian (hasil resolve digabung) atau 'surat:<uuid>'
    skor: number; tanggalTerbaru: string | null;
    rangkaian: { id: string; kode: string; status: 'aktif' | 'selesai' | 'diberkaskan' | 'digabung'; judul: string; tahun: number; asal: string } | null;
    cocok: Array<{ jenis: 'surat_masuk' | 'surat_keluar'; id: string; nomorSurat: string | null; perihal: string | null; tahun: number; skor: number }>;
    pratinjau: Array<LacakNode | LacakNodeTersamar>;   // ≤ 8
    jumlahAnggota: number; pratinjauTerpotong: boolean;
}
export interface LacakNode { anggotaId: string | null; jenis: 'surat_masuk' | 'surat_keluar'; id: string; nomorSurat: string | null; perihal: string | null; tanggalSurat: string | null; tahun: number; naskah: string | null; unitKerjaId: string; unitNama: string; relasi: 'balasan' | 'tindak_lanjut' | 'menjelaskan' | 'merujuk' | null; masked: false }
export interface LacakNodeTersamar { anggotaId: string; jenis: 'surat_masuk' | 'surat_keluar'; unitNama: string; label: 'Dikecualikan'; masked: true; dapatAjukanAkses: boolean }
rangkaianService.lacak(user, params: { q; mode; limit?; tahun?; jenis? }): Promise<LacakResult>   // delegasi ke lacakService.search (services/rangkaian/lacak.service.ts)
escapeLike(v: string): string; LIKE_ESCAPE; classifyLacakQuery(q: string): LacakQueryPlan   // tambahan di utils/nomor-surat.ts
lacakLimiter; LACAK_RATE_LIMIT_MAX = 90
deriveStatusAlur({ rangkaianStatus, adaDisposisi, adaTindakLanjut }): 'terdaftar' | 'didisposisikan' | 'ditindaklanjuti' | 'selesai' | 'diberkaskan'
rangkaianStatusService.{ hitungPenghalang, recomputeForSuratKeluar }
berkasService.{ tandaiSelesai, bukaKembali, berkaskan, ubahUnitPengolah, opsiBerkas, unitDalamJangkauanBerkas }
rangkaianLinkService.{ tautan, tautanKeSurat, gabung, pratinjauGabung, batalRelasi }
recordAccessGrantService.requestViaRangkaian(user, anggotaId, input, auditContext?, tx?)
isGrantEligible(executor, user, ref): Promise<boolean>
computeSuratAksi(role, ctx): SuratAksi[]; computeRangkaianAksi(ctx): RangkaianAksi[]; suratAksiPayload(...); rangkaianAksiUntuk(...)
// Frontend: rangkaianService.{ lacak, tandaiSelesai, bukaKembali, opsiBerkas, berkaskan, ubahUnitPengolah, tautkanKeSurat, pratinjauGabung, gabung, batalRelasi, tutupDisposisi, ajukanAkses }, useLacakSearch(term, opts) (satu-satunya hook Lacak; P4 Task 10 memperluasnya dengan status/retry/batas 100 tanpa memutus { loading, error, data }), TindakLanjutMenu, ReferensiSection
// P4 memiliki GET /api/rangkaian (daftar Berkas Rangkaian) — tidak dibuat di P3.
```

---

## A. Prasyarat & Backfill

### Task 1: Adapter dependensi P1/P2, helper SQL, dan peran

**Files:**
- Create: `backend/src/services/rangkaian/deps.ts`
- Create: `backend/src/services/rangkaian/sql-rows.ts`
- Create: `backend/src/services/rangkaian/roles.ts`
- Test: `backend/src/__tests__/rangkaian-deps.contract.test.ts`

**Interfaces:**
- Consumes: seluruh blok "Dikonsumsi dari P1/P2" di atas.
- Produces: `Tx` (= `DbTransaction`), `Executor`, `SuratJenis`, `RecordReadAccess`, `aktor(user, audit?): RangkaianActor`, `isPengawas(user, executor?)`, `isPengawasRecordUnit(unit)`, `loadJangkauan(executor, rangkaianId)`, `lockRangkaian(tx, ids): Promise<RangkaianTerkunciP3[]>` (dengan `unitPencatatId`), `recomputeRangkaian(tx, rangkaianId, audit?)`, `recomputeSuratMasuk(tx, ids, audit?)`, `recomputeForSuratKeluar(tx, suratKeluarId, audit?)`; `rowsOf`, `uuidArraySql(ids)`, `textArraySql(values)`; `FULL_ADMIN_ROLES`, `isFullAdmin(user)`, `unitEfektif(user)`; re-export `isAjukanAksesEnabled`.

- [ ] **Step 1: Tulis test kontrak yang gagal**

```ts
// backend/src/__tests__/rangkaian-deps.contract.test.ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/database', () => ({ db: {} }));

const deps = await import('../services/rangkaian/deps.js');
const schema = await import('../db/schema/index.js');
const { rowsOf, uuidArraySql, textArraySql } = await import('../services/rangkaian/sql-rows.js');
const { isFullAdmin, unitEfektif } = await import('../services/rangkaian/roles.js');

describe('kontrak P1 yang dikonsumsi P3', () => {
    it.each([
        'ensureForSurat', 'ensureForSuratMasuk', 'attach', 'gabung',
        'recomputeStatus', 'recomputeSuratMasukStatus', 'jangkauanUnitIds',
    ])('rangkaianService.%s tersedia', (name) => {
        expect(typeof (deps.rangkaianService as Record<string, unknown>)[name]).toBe('function');
    });

    it('skema Drizzle memuat tabel dan kolom baru 0046', () => {
        expect(schema.rangkaianSurat).toBeDefined();
        expect(schema.rangkaianAnggota).toBeDefined();
        expect(schema.rangkaianRelasi).toBeDefined();
        for (const column of ['rangkaianId', 'batasWaktu', 'penanggungJawab', 'processedBy',
            'penyelesaianSuratKeluarId', 'catatanPenyelesaian', 'ditutupPengawas']) {
            expect((schema.suratDistributions as Record<string, unknown>)[column]).toBeDefined();
        }
        expect((schema.suratKeluar as Record<string, unknown>).asalNaskah).toBeDefined();
        expect((schema.unitKerja as Record<string, unknown>).isUnitPengawas).toBeDefined();
    });
});

describe('kontrak P2 yang dikonsumsi P3', () => {
    it.each(['check', 'inspect', 'checkRead', 'checkMany'])(
        'recordAccessService.%s tersedia', (name) => {
            expect(typeof (deps.recordAccessService as Record<string, unknown>)[name]).toBe('function');
        },
    );

    it('findActiveGrant P2 tersedia sebagai ekspor bernama', () => {
        expect(typeof deps.findActiveGrant).toBe('function');
    });

    it('visibility-spec dan helper scope tersedia', () => {
        expect(typeof deps.resolveKonteksBaca).toBe('function');
        expect(typeof deps.visibleSql).toBe('function');
        expect(typeof deps.scopeForAuthorizedRead).toBe('function');
        expect(deps.isPengawasRecordUnit('dir_bppt')).toBe(true);
        expect(deps.isPengawasRecordUnit('bagian_umum')).toBe(false);
    });

    it('flag Ajukan Akses mati secara default dan hanya menyala dengan "true"', () => {
        expect(deps.isAjukanAksesEnabled({})).toBe(false);
        expect(deps.isAjukanAksesEnabled({ RANGKAIAN_AJUKAN_AKSES: '1' })).toBe(false);
        expect(deps.isAjukanAksesEnabled({ RANGKAIAN_AJUKAN_AKSES: 'true' })).toBe(true);
    });
});

describe('pembungkus P3', () => {
    it('aktor mengambil userId dari konteks audit atau pengguna', () => {
        expect(deps.aktor({ id: 'u-1' }, { userEmail: 'a@b' })).toEqual({ userEmail: 'a@b', userId: 'u-1' });
        expect(deps.aktor(null, { userId: 'u-2', ipAddress: '::1' })).toEqual({ userId: 'u-2', ipAddress: '::1' });
    });

    it('rowsOf menerima array (Proxy mock) maupun QueryResult node-postgres', () => {
        expect(rowsOf([{ a: 1 }])).toEqual([{ a: 1 }]);
        expect(rowsOf({ rows: [{ a: 2 }] })).toEqual([{ a: 2 }]);
    });

    it('array SQL dikirim sebagai satu parameter teks', () => {
        expect(uuidArraySql(['a', 'b']).queryChunks.length).toBeGreaterThan(0);
        expect(textArraySql([]).queryChunks.length).toBeGreaterThan(0);
    });

    it('peran FULL_ADMIN dan unit efektif mengikuti mandat role', () => {
        expect(isFullAdmin({ role: 'admin_unit' })).toBe(true);
        expect(isFullAdmin({ role: 'staff' })).toBe(false);
        expect(unitEfektif({ role: 'admin_sesditjen', unitKerjaId: null })).toBe('sesditjen');
        expect(unitEfektif({ role: 'admin_unit', unitKerjaId: 'dir_bppt' })).toBe('dir_bppt');
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/rangkaian-deps.contract.test.ts`
Expected: FAIL — `Failed to load url ../services/rangkaian/deps.js`.

- [ ] **Step 3: Implementasi minimal**

```ts
// backend/src/services/rangkaian/deps.ts
/**
 * Satu-satunya titik impor kode P3 atas antarmuka P1 (rangkaian.service,
 * rangkaian-status) dan P2 (record-access, visibility-spec). Bila nama di P1/P2
 * berubah, ubah HANYA berkas ini; kontraknya dikunci oleh
 * src/__tests__/rangkaian-deps.contract.test.ts.
 */
import { sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import type { DbTransaction } from '../../db/transaction.js';
import type { CriticalAuditContext } from '../audit-log.service.js';
import { rangkaianService, type RangkaianActor } from '../rangkaian.service.js';
import { recordAccessService } from '../record-access.service.js';
import {
    barisDari, dalamCakupanPengawas, isDisposisiLamaReadEnabled, resolveKonteksBaca,
} from '../access/visibility-spec.js';

export type Tx = DbTransaction;
export type Executor = DbTransaction | typeof db;
export type SuratJenis = 'surat_masuk' | 'surat_keluar';
export type RecordReadAccess = Awaited<ReturnType<typeof recordAccessService.checkRead>>;
export type { JenisRelasi, RangkaianActor, RangkaianStatus } from '../rangkaian.service.js';

export { rangkaianService, recordAccessService };
export {
    findActiveGrant,
    isAllowedForRecordUnit,
    normalizeSecurityClassification,
    requiresExplicitAccessGrant,
} from '../record-access.service.js';
export type { RecordEntityType, RecordUser } from '../record-access.service.js';
export { isAjukanAksesEnabled, resolveKonteksBaca, visibleSql } from '../access/visibility-spec.js';
export type { KonteksBaca } from '../access/visibility-spec.js';
export { scopeForAuthorizedRead } from '../../utils/record-unit-scope.js';

/** RangkaianActor P1 dari konteks audit; userId diambil dari audit lalu pengguna. */
export function aktor(user: { id?: string | null } | null | undefined, audit?: CriticalAuditContext): RangkaianActor {
    return { ...(audit ?? {}), userId: audit?.userId ?? user?.id ?? '' };
}

/** Unit rekaman dalam cakupan pengawas: ditjen, sesditjen, dir_* (§4.4). */
export const isPengawasRecordUnit = dalamCakupanPengawas;

/** Pengawas = FULL_ADMIN + unit efektif is_unit_pengawas (D5), dihitung P2. */
export async function isPengawas(user: { id?: string | null; role?: string | null; unitKerjaId?: string | null } | null | undefined, executor: Executor = db) {
    return (await resolveKonteksBaca(user ?? undefined, executor as never)).pengawas;
}

/** Jangkauan §4.5 (dihitung langsung; peserta data lama hanya bila flag P5 menyala). */
export function loadJangkauan(executor: Executor, rangkaianId: string): Promise<string[]> {
    return rangkaianService.jangkauanUnitIds(executor as never, rangkaianId, { disposisiLama: isDisposisiLamaReadEnabled() });
}

export interface RangkaianTerkunciP3 {
    id: string;
    kode: string;
    status: 'aktif' | 'selesai' | 'diberkaskan' | 'digabung';
    asal: string;
    unitPencatatId: string;
    unitPengolahId: string | null;
    judul: string;
    tahun: number;
    selesaiManual: boolean;
}

/** Kunci baris rangkaian FOR UPDATE dengan id menaik (urutan kunci §11). */
export async function lockRangkaian(tx: Tx, ids: string[]): Promise<RangkaianTerkunciP3[]> {
    const unik = [...new Set(ids)];
    if (unik.length === 0) return [];
    return barisDari<RangkaianTerkunciP3>(await tx.execute(sql`
        SELECT id, kode, status, asal, unit_pencatat_id AS "unitPencatatId", unit_pengolah_id AS "unitPengolahId",
               judul, tahun, selesai_manual AS "selesaiManual"
          FROM rangkaian_surat
         WHERE id = ANY(string_to_array(${unik.join(',')}, ',')::uuid[])
         ORDER BY id
         FOR UPDATE`));
}

export function recomputeRangkaian(tx: Tx, rangkaianId: string, audit?: CriticalAuditContext) {
    return rangkaianService.recomputeStatus(tx, [rangkaianId], aktor(null, audit));
}

export function recomputeSuratMasuk(tx: Tx, suratMasukIds: string[], audit?: CriticalAuditContext) {
    return suratMasukIds.length === 0
        ? Promise.resolve([])
        : rangkaianService.recomputeSuratMasukStatus(tx, [...new Set(suratMasukIds)], aktor(null, audit));
}

/** Dipanggil setelah surat keluar berubah (create/update/delete/approve/reject). Task 12 mengisi penuh. */
export async function recomputeForSuratKeluar(_tx: Tx, _suratKeluarId: string, _audit?: CriticalAuditContext): Promise<void> {
    return undefined;
}
```

```ts
// backend/src/services/rangkaian/sql-rows.ts
import { sql, type SQL } from 'drizzle-orm';

/** Hasil `tx.execute` node-postgres adalah { rows }, Proxy mock mengembalikan array (= barisDari P2). */
export { barisDari as rowsOf } from '../access/visibility-spec.js';

/**
 * Array dikirim sebagai SATU parameter teks, lalu dipecah di SQL. Ini menghindari
 * ekspansi array Drizzle menjadi daftar parameter dan aman untuk array kosong.
 * Hanya untuk nilai tanpa koma (uuid, "jenis:uuid").
 */
export function uuidArraySql(ids: string[]): SQL {
    return sql`string_to_array(${ids.join(',')}, ',')::uuid[]`;
}

export function textArraySql(values: string[]): SQL {
    return sql`string_to_array(${values.join(',')}, ',')::text[]`;
}
```

```ts
// backend/src/services/rangkaian/roles.ts
import { PERAN_FULL_ADMIN, unitJangkauan } from '../access/visibility-spec.js';

export const FULL_ADMIN_ROLES: ReadonlySet<string> = new Set<string>(PERAN_FULL_ADMIN);

export function isFullAdmin(user: { role?: string | null } | null | undefined): boolean {
    return FULL_ADMIN_ROLES.has(user?.role ?? '');
}

/** Unit efektif (mandat role admin_dirjen/sesditjen; super_admin tanpa unit → null), dihitung P2. */
export const unitEfektif = unitJangkauan;
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/rangkaian-deps.contract.test.ts`
Expected: PASS. Bila sebuah nama P1/P2 berbeda dari rencana P1/P2 yang sudah dieksekusi, sesuaikan **hanya** re-export/pembungkus di `deps.ts`; jangan ubah test.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/rangkaian/deps.ts backend/src/services/rangkaian/sql-rows.ts backend/src/services/rangkaian/roles.ts backend/src/__tests__/rangkaian-deps.contract.test.ts
git commit -m "feat(rangkaian): adapter dependensi P1/P2, helper SQL, dan peran untuk P3

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


#### Amandemen pra-eksekusi Task 1 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


**Files: add**
- Modify: `backend/src/services/rangkaian/deps.ts`: the additions below.

**Interfaces / Produces: add** `lockSuratMasukRows`, `lockSuratKeluarRows`, `kunciSurat`, `aktorPenulis`, `pengawasUntukUnit`, `denganRetryDeadlock`, `readRefKey`, `LABEL_DIKECUALIKAN`, `judulTersamar`. `RangkaianTerkunciP3` gains `selesaiAt`, `selesaiBy` and `catatanSelesai`.

**Step 3, `deps.ts`: add the following** (merge the imports):

```ts
import { asc, inArray } from 'drizzle-orm';
import { suratKeluar } from '../../db/schema/index.js';
import { ConflictError, ValidationError } from '../../utils/errors.js';
import { hasPostgresErrorCode } from '../../utils/postgres-errors.js';
import { isFullAdmin } from './roles.js';

export { lockSuratMasukRows } from '../rangkaian.service.js';            // P1, "Diekspor untuk P3" (rangkaian.service.ts:84-102)
export { readRefKey } from '../record-access.service.js';                // P2: key `${type}:${id.toLowerCase()}`
export { LABEL_DIKECUALIKAN, judulTersamar } from '../rangkaian-read.service.js';

/** Kunci baris surat_keluar FOR UPDATE ORDER BY id (pasangan lockSuratMasukRows P1). */
export async function lockSuratKeluarRows(tx: Tx, ids: string[]) {
    const unik = [...new Set(ids)];
    if (unik.length === 0) return [];
    return tx.select({ id: suratKeluar.id, isDeleted: suratKeluar.isDeleted })
        .from(suratKeluar).where(inArray(suratKeluar.id, unik)).orderBy(asc(suratKeluar.id)).for('update');
}

/** GC#30: surat_keluar → surat_masuk; panggil SEBELUM lockRangkaian. */
export async function kunciSurat(tx: Tx, ids: { suratKeluarIds?: string[]; suratMasukIds?: string[] }) {
    await lockSuratKeluarRows(tx, ids.suratKeluarIds ?? []);
    await lockSuratMasukRowsLokal(tx, ids.suratMasukIds ?? []);
}
```

Name note: import `lockSuratMasukRows` as a value, `import { lockSuratMasukRows as lockSuratMasukRowsLokal } from '../rangkaian.service.js'`, in addition to the re-export.

```ts
/** Aktor untuk pemanggilan P1 yang MENULIS kolom uuid FK (ensure/attach/gabung). */
export function aktorPenulis(user: { id?: string | null } | null | undefined, audit?: CriticalAuditContext): RangkaianActor {
    const a = aktor(user, audit);
    if (!a.userId) throw new ValidationError('Pengguna pelaku tidak diketahui');
    return a;
}

/** G-PENGAWAS: super_admin, atau FULL_ADMIN pengawas yang unit rekamannya dalam cakupan (= tier baca P2). */
export async function pengawasUntukUnit(user: RecordUser | null | undefined, unitKerjaId: string | null | undefined, executor: Executor = db) {
    if (user?.role === 'super_admin') return true;
    if (!isFullAdmin(user) || !dalamCakupanPengawas(unitKerjaId)) return false;
    return isPengawas(user, executor);
}

/** G-RETRY: `run` HARUS membuka db.transaction sendiri; jangan dipakai di dalam tx pemanggil. */
export async function denganRetryDeadlock<T>(run: () => Promise<T>, percobaan = 3): Promise<T> {
    for (let ke = 1; ; ke += 1) {
        try {
            return await run();
        } catch (error) {
            if (!hasPostgresErrorCode(error, '40P01') && !hasPostgresErrorCode(error, '40001')) throw error;
            if (ke >= percobaan) throw new ConflictError('Terjadi konflik penyimpanan bersamaan; silakan coba lagi.');
        }
    }
}
```

**Also change these:**
- **`RangkaianTerkunciP3`:** add `selesaiAt: Date | null; selesaiBy: string | null; catatanSelesai: string | null`.
- **`lockRangkaian` SELECT:** add `selesai_at AS "selesaiAt", selesai_by AS "selesaiBy", catatan_selesai AS "catatanSelesai"`, and the comment `// Urutan identik dengan lockRangkaian privat P1 (rangkaian.service.ts:143-161).`
- **`aktor`:** keep it as is. Recompute-only callers legitimately pass no actor, and the P1 audit maps `''` to null. Every P3 call into `rangkaianService.ensureForSurat`, `ensureForSuratMasuk`, `attach` or `gabung` must use `aktorPenulis`. [T1-3]

**Step 1 test additions** (in `rangkaian-deps.contract.test.ts`):
- Add `it.each(['lockSuratMasukRows','lockSuratKeluarRows','kunciSurat','aktorPenulis','pengawasUntukUnit','denganRetryDeadlock','readRefKey'])`, asserting each is a function.
- `aktorPenulis(null, {})` throws with `statusCode` 400.
- `denganRetryDeadlock`:
  - retries once after `{cause:{code:'40P01'}}` and resolves;
  - does not retry `{cause:{code:'23505'}}`;
  - throws `statusCode` 409 after 3 deadlocks.
- Replace the `uuidArraySql` assertion (plan:252-253) with this [T1-6]:

```ts
import { PgDialect } from 'drizzle-orm/pg-core';
const q = new PgDialect().sqlToQuery(sql`SELECT ${uuidArraySql(['a', 'b'])}`);
expect(q.params).toEqual(['a,b']);
expect(q.sql).toContain("string_to_array($1, ',')::uuid[]");
```

---



### Task 2: Harness Postgres dan backfill langkah 1 (disposisi eksplisit)

**Files:**
- Create: `backend/integration/helpers/rangkaian-db.ts`
- Create: `backend/scripts/backfill-rangkaian-disposisi.mjs`
- Modify: `backend/package.json:40-46` (tambah script `db:backfill:rangkaian-disposisi`)
- Test: `backend/integration/backfill-rangkaian-disposisi.postgres.test.ts`

**Interfaces:**
- Consumes: migrasi 0046/0047 (P1), `loadMigrations`/`migrateDatabase` (`backend/scripts/migrate-database.mjs`), `recordAccessService.checkRead` (P2) untuk kriteria "disposisi lama dapat dibuka penerima".
- Produces: `createRangkaianTestDatabase(label): Promise<RangkaianTestDatabase>` dengan `{ pool, db, databaseName, query, seedUnits, seedUser, insertSuratMasuk, insertSuratKeluar, insertDistribusi, ensureKlasifikasi, close }`; `backfillRangkaianDisposisi(client, { batchSize?, log? }): Promise<{ rangkaianDibuat: number; distribusiDiisi: number; sisaTanpaRangkaian: number }>`. Kode dan judul rangkaian mengikuti P1 (`RS-<tahun>-<nextval 6 digit>`, `judulRangkaian` = `COALESCE(NULLIF(trim(perihal),''), nomor_surat, '(tanpa perihal)')`; penyamaran judul dilakukan saat tampil oleh P2/P4).

- [ ] **Step 1: Tulis harness Postgres (dipakai semua test integrasi P3)**

```ts
// backend/integration/helpers/rangkaian-db.ts
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { loadMigrations, migrateDatabase } from '../../scripts/migrate-database.mjs';

export interface TestUser { id: string; email: string; name: string; role: string; unitKerjaId: string | null }

export function assertIsolatedTestTarget(raw = process.env.TEST_POSTGRES_URL): URL {
    const url = new URL(raw || 'http://invalid');
    const port = Number(url.port || '5432');
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)
        || url.pathname.slice(1) !== 'simsa_test'
        || !(port === 5432 || (port >= 40000 && port < 60000 && port !== 55432))) {
        throw new Error('Tes rangkaian memerlukan TEST_POSTGRES_URL loopback ke database simsa_test yang terisolasi.');
    }
    return url;
}

export async function createRangkaianTestDatabase(label: string) {
    if (!/^[a-z]{3,20}$/.test(label)) throw new Error('label harus 3-20 huruf kecil');
    const url = assertIsolatedTestTarget();
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const databaseName = `simsa_rs_${label}_${suffix}`;
    const target = new URL(url);
    target.pathname = `/${databaseName}`;
    const administrator = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
    await administrator.connect();
    await administrator.query(`CREATE DATABASE ${databaseName} TEMPLATE template0`);
    const pool = new Pool({ connectionString: target.toString(), max: 6, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
    const connection = await pool.connect();
    try {
        await connection.query(`DO $$ DECLARE role_name text; BEGIN
            FOREACH role_name IN ARRAY ARRAY['simsa_api_runtime','simsa_event_runtime','simsa_worker_runtime',
              'simsa_final_cleanup','simsa_maintenance','simsa_migrator','simsa_backup_reader'] LOOP
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
                    EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT', role_name);
                END IF;
            END LOOP;
        END $$;
        CREATE EXTENSION pgcrypto;
        ALTER SCHEMA public OWNER TO simsa_migrator;
        CREATE SCHEMA drizzle AUTHORIZATION simsa_migrator;
        SET ROLE simsa_migrator;`);
        await migrateDatabase(connection, loadMigrations());
        await connection.query('RESET ROLE');
    } finally {
        connection.release();
    }
    const db = drizzle(pool);

    async function query<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
        return (await pool.query(text, params)).rows as T[];
    }

    async function seedUnits() {
        await query(`INSERT INTO unit_kerja (id, name, unit_type, can_receive_distribution, is_unit_pengawas) VALUES
            ('ditjen', 'Direktorat Jenderal PTPP', 'ditjen', true, true),
            ('sesditjen', 'Sekretariat Direktorat Jenderal', 'sesditjen', true, true)
            ON CONFLICT (id) DO UPDATE SET is_unit_pengawas = true`);
        await query(`INSERT INTO unit_kerja (id, name, parent_id, unit_type, can_receive_distribution) VALUES
            ('dir_bppt', 'Dit. BPPT', 'ditjen', 'direktorat', true),
            ('dir_ptep', 'Dit. PTEP', 'ditjen', 'direktorat', true),
            ('dir_ktpp', 'Dit. KTPP', 'ditjen', 'direktorat', true),
            ('dir_plp', 'Dit. PLP', 'ditjen', 'direktorat', true),
            ('bagian_umum', 'Bagian Umum', 'sesditjen', 'bagian', true)
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, unit_type = EXCLUDED.unit_type,
                can_receive_distribution = EXCLUDED.can_receive_distribution`);
    }

    async function seedUser(role: string, unitKerjaId: string | null): Promise<TestUser> {
        const id = randomUUID();
        const user = { id, email: `${role}-${id.slice(0, 8)}@example.test`, name: `Uji ${role}`, role, unitKerjaId };
        await query('INSERT INTO users (id, email, name, role, unit_kerja_id, is_active) VALUES ($1,$2,$3,$4,$5,true)',
            [user.id, user.email, user.name, role, unitKerjaId]);
        return user;
    }

    async function insertSuratMasuk(input: { unitKerjaId: string; nomorSurat: string; perihal?: string | null; sifatSurat?: string; tahun?: number; dari?: string; createdBy?: string | null }) {
        const tahun = input.tahun ?? 2026;
        const [row] = await query<{ id: string }>(`INSERT INTO surat_masuk (unit_kerja_id, no_urut, tahun, nomor_surat, perihal, dari, sifat_surat, tanggal_surat, created_by)
            VALUES ($1, (SELECT coalesce(max(no_urut), 0) + 1 FROM surat_masuk WHERE unit_kerja_id = $1 AND tahun = $2), $2, $3, $4, $5, $6, make_date($2, 9, 12), $7)
            RETURNING id`, [input.unitKerjaId, tahun, input.nomorSurat, input.perihal === undefined ? 'Perihal uji' : input.perihal,
            input.dari ?? 'Kantah Sintetis', input.sifatSurat ?? 'biasa', input.createdBy ?? null]);
        return row.id;
    }

    async function insertSuratKeluar(input: { unitKerjaId: string; nomorSurat: string; perihal?: string; naskahDinas?: string; approvalStatus?: string; klasifikasiKeamanan?: string; tahun?: number; asalNaskah?: string | null; kepada?: string }) {
        const tahun = input.tahun ?? 2026;
        const [row] = await query<{ id: string }>(`INSERT INTO surat_keluar (unit_kerja_id, no_urut, tahun, nomor_surat, perihal, kepada, naskah_dinas, approval_status, klasifikasi_keamanan, tanggal_surat, asal_naskah)
            VALUES ($1, (SELECT coalesce(max(no_urut), 0) + 1 FROM surat_keluar WHERE unit_kerja_id = $1 AND tahun = $2), $2, $3, $4, $5, $6, $7, $8, make_date($2, 9, 12), $9)
            RETURNING id`, [input.unitKerjaId, tahun, input.nomorSurat, input.perihal ?? 'Perihal keluar uji', input.kepada ?? 'Pihak Sintetis',
            input.naskahDinas ?? 'Nota Dinas', input.approvalStatus ?? 'draft', input.klasifikasiKeamanan ?? 'biasa', input.asalNaskah ?? null]);
        return row.id;
    }

    async function insertDistribusi(input: { suratMasukId: string; sourceUnitId: string; targetUnitId: string; status?: string; rangkaianId?: string | null; batasWaktu?: string | null }) {
        const [row] = await query<{ id: string }>(`INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status, rangkaian_id, batas_waktu)
            VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [input.suratMasukId, input.sourceUnitId, input.targetUnitId,
            input.status ?? 'sent', input.rangkaianId ?? null, input.batasWaktu ?? null]);
        return row.id;
    }

    async function ensureKlasifikasi(): Promise<number> {
        const [existing] = await query<{ id: number }>('SELECT id FROM klasifikasi_arsip WHERE is_active ORDER BY id LIMIT 1');
        if (existing) return existing.id;
        const [created] = await query<{ id: number }>(`INSERT INTO klasifikasi_arsip (kode, source_record_key, jenis, tipe)
            VALUES ('PT.01', 'uji-rangkaian-pt01', 'Uji pemberkasan rangkaian', 'substantif') RETURNING id`);
        return created.id;
    }

    async function close() {
        await pool.end();
        if (/^simsa_rs_[a-z]{3,20}_[a-f0-9]{12}$/.test(databaseName)) {
            await administrator.query(`DROP DATABASE ${databaseName}`);
        }
        await administrator.end();
    }

    return { pool, db, databaseName, query, seedUnits, seedUser, insertSuratMasuk, insertSuratKeluar, insertDistribusi, ensureKlasifikasi, close };
}

export type RangkaianTestDatabase = Awaited<ReturnType<typeof createRangkaianTestDatabase>>;
```

Setiap test integrasi P3 me-mock `db` aplikasi ke database harness dengan pola yang sama persis:

```ts
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock('../src/config/database', () => ({ db: new Proxy({}, { get: (_t, key) => {
    const value = state.db?.[key];
    return typeof value === 'function' ? value.bind(state.db) : value;
} }) }));
vi.mock('../src/config/database.js', () => ({ db: new Proxy({}, { get: (_t, key) => {
    const value = state.db?.[key];
    return typeof value === 'function' ? value.bind(state.db) : value;
} }) }));
vi.mock('../src/services/srikandi-producer.service.js', () => ({ srikandiBusinessProducer: {
    suratMasukCreated: async () => {}, suratKeluarCreated: async () => {},
} }));
```

- [ ] **Step 2: Tulis test backfill yang gagal**

```ts
// backend/integration/backfill-rangkaian-disposisi.postgres.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import { createRangkaianTestDatabase, type RangkaianTestDatabase } from './helpers/rangkaian-db.js';

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock('../src/config/database', () => ({ db: new Proxy({}, { get: (_t, key) => {
    const value = state.db?.[key];
    return typeof value === 'function' ? value.bind(state.db) : value;
} }) }));
vi.mock('../src/config/database.js', () => ({ db: new Proxy({}, { get: (_t, key) => {
    const value = state.db?.[key];
    return typeof value === 'function' ? value.bind(state.db) : value;
} }) }));

const { backfillRangkaianDisposisi } = await import('../scripts/backfill-rangkaian-disposisi.mjs');
const { recordAccessService } = await import('../src/services/record-access.service.js');

let h: RangkaianTestDatabase;
let client: Client;
const surat: Record<string, string> = {};

beforeAll(async () => {
    h = await createRangkaianTestDatabase('backfill');
    state.db = h.db;
    await h.seedUnits();
    surat.aktif = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-1/2025', perihal: 'Permohonan data lama' });
    await h.insertDistribusi({ suratMasukId: surat.aktif, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', status: 'sent' });
    await h.insertDistribusi({ suratMasukId: surat.aktif, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ptep', status: 'rejected' });
    surat.selesai = await h.insertSuratMasuk({ unitKerjaId: 'ditjen', nomorSurat: 'SM-2/2025', perihal: null });
    await h.insertDistribusi({ suratMasukId: surat.selesai, sourceUnitId: 'ditjen', targetUnitId: 'dir_ktpp', status: 'processed' });
    await h.insertDistribusi({ suratMasukId: surat.selesai, sourceUnitId: 'ditjen', targetUnitId: 'dir_plp', status: 'processed' });
    surat.rahasia = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-3/2025', perihal: 'Tukar guling rahasia', sifatSurat: 'Rahasia' });
    await h.insertDistribusi({ suratMasukId: surat.rahasia, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', status: 'received' });
    surat.tanpaDisposisi = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-4/2025' });
    client = new Client({ connectionString: (h.pool as any).options.connectionString });
    await client.connect();
}, 120_000);

afterAll(async () => {
    await client?.end();
    await h?.close();
});

describe('backfill langkah 1: disposisi eksplisit', () => {
    it('mengisi rangkaian_id semua baris (termasuk rejected) dengan batch kecil', async () => {
        const hasil = await backfillRangkaianDisposisi(client, { batchSize: 1 });
        expect(hasil).toMatchObject({ rangkaianDibuat: 3, distribusiDiisi: 5, sisaTanpaRangkaian: 0 });
        const [{ sisa }] = await h.query<{ sisa: number }>('SELECT count(*)::int AS sisa FROM surat_distributions WHERE rangkaian_id IS NULL');
        expect(sisa).toBe(0);
    });

    it('status, pengolah tunggal, induk, dan judul mengikuti aturan §3', async () => {
        const rows = await h.query(`SELECT a.surat_masuk_id, rs.status, rs.asal, rs.unit_pencatat_id, rs.unit_pengolah_id, rs.judul, rs.kode, a.peran
            FROM rangkaian_anggota a JOIN rangkaian_surat rs ON rs.id = a.rangkaian_id`);
        const by = Object.fromEntries(rows.map((r: any) => [r.surat_masuk_id, r]));
        expect(by[surat.aktif]).toMatchObject({ status: 'aktif', asal: 'surat_masuk', unit_pencatat_id: 'sesditjen', unit_pengolah_id: 'dir_bppt', judul: 'Permohonan data lama', peran: 'induk' });
        expect(by[surat.selesai]).toMatchObject({ status: 'selesai', unit_pengolah_id: null, judul: 'SM-2/2025' });
        expect(by[surat.rahasia].judul).toBe('Tukar guling rahasia');
        expect(by[surat.aktif].kode).toMatch(/^RS-2026-\d{6}$/);
        expect(by[surat.tanpaDisposisi]).toBeUndefined();
    });

    it('idempoten: dijalankan ulang tidak membuat rangkaian atau audit baru', async () => {
        const [{ n: sebelum }] = await h.query<{ n: number }>('SELECT count(*)::int AS n FROM rangkaian_surat');
        const [{ n: auditSebelum }] = await h.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'rangkaian_surat'");
        expect(await backfillRangkaianDisposisi(client)).toMatchObject({ rangkaianDibuat: 0, distribusiDiisi: 0, sisaTanpaRangkaian: 0 });
        const [{ n: sesudah }] = await h.query<{ n: number }>('SELECT count(*)::int AS n FROM rangkaian_surat');
        const [{ n: auditSesudah }] = await h.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'rangkaian_surat'");
        expect(sesudah).toBe(sebelum);
        expect(auditSesudah).toBe(auditSebelum);
        expect(auditSebelum).toBe(3);
    });

    it('disposisi pra-deploy dapat dibuka penerimanya lewat checkRead (via peserta)', async () => {
        const bppt = await h.seedUser('admin_unit', 'dir_bppt');
        const akses = await recordAccessService.checkRead(bppt, 'surat_masuk', surat.aktif);
        expect(akses).toMatchObject({ exists: true, allowed: true, mutable: false, via: 'peserta' });
        const ptep = await h.seedUser('admin_unit', 'dir_ptep');
        expect((await recordAccessService.checkRead(ptep, 'surat_masuk', surat.aktif)).allowed).toBe(false);
    });
});
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `cd backend && TEST_POSTGRES_URL=postgresql://simsa_test:simsa_test@127.0.0.1:5432/simsa_test npx vitest run --config vitest.postgres.config.ts integration/backfill-rangkaian-disposisi.postgres.test.ts`
Expected: FAIL — `Failed to load url ../scripts/backfill-rangkaian-disposisi.mjs`.

- [ ] **Step 4: Implementasi skrip backfill**

```js
// backend/scripts/backfill-rangkaian-disposisi.mjs
#!/usr/bin/env node
// Backfill langkah 1 (P3, tanpa gerbang sign-off): setiap surat masuk yang punya
// baris surat_distributions tanpa rangkaian_id mendapat rangkaian asal
// 'surat_masuk' + anggota induk, lalu SEMUA baris distribusinya (termasuk
// rejected) diisi rangkaian_id. Batch per transaksi, idempoten, diaudit.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

/** Sama dengan judulRangkaian P1: COALESCE(NULLIF(trim(perihal),''), nomor_surat, '(tanpa perihal)'). */
function judulDari(surat) {
  const perihal = typeof surat.perihal === 'string' ? surat.perihal.trim() : '';
  const nomor = typeof surat.nomor_surat === 'string' ? surat.nomor_surat.trim() : '';
  return perihal || nomor || '(tanpa perihal)';
}

export async function backfillRangkaianDisposisi(client, { batchSize = 500, log = () => {} } = {}) {
  let rangkaianDibuat = 0;
  let distribusiDiisi = 0;
  let cursor = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    await client.query('BEGIN');
    try {
      const { rows: batch } = await client.query(
        `SELECT sm.id, sm.unit_kerja_id, sm.tahun, sm.nomor_surat, sm.perihal, sm.sifat_surat
           FROM surat_masuk sm
          WHERE sm.id > $2
            AND EXISTS (SELECT 1 FROM surat_distributions d WHERE d.surat_masuk_id = sm.id AND d.rangkaian_id IS NULL)
          ORDER BY sm.id
          LIMIT $1
          FOR UPDATE OF sm`,
        [batchSize, cursor],
      );
      if (batch.length === 0) {
        await client.query('COMMIT');
        break;
      }
      for (const surat of batch) {
        const { rows: [anggota] } = await client.query(
          'SELECT rangkaian_id FROM rangkaian_anggota WHERE surat_masuk_id = $1', [surat.id]);
        let rangkaianId = anggota?.rangkaian_id ?? null;
        if (!rangkaianId) {
          const { rows: [agg] } = await client.query(
            `SELECT bool_or(status IN ('sent','received')) AS terbuka,
                    count(DISTINCT target_unit_id) FILTER (WHERE status <> 'rejected') AS jumlah_target,
                    min(target_unit_id) FILTER (WHERE status <> 'rejected') AS target_tunggal
               FROM surat_distributions WHERE surat_masuk_id = $1`, [surat.id]);
          const { rows: [{ kode }] } = await client.query(
            `SELECT 'RS-' || $1::int::text || '-' || lpad(nextval('rangkaian_surat_kode_seq')::text, 6, '0') AS kode`,
            [surat.tahun]);
          const status = agg.terbuka ? 'aktif' : 'selesai';
          const pengolah = Number(agg.jumlah_target) === 1 ? agg.target_tunggal : null;
          const { rows: [created] } = await client.query(
            `INSERT INTO rangkaian_surat (kode, asal, status, unit_pencatat_id, unit_pengolah_id, judul, tahun, selesai_at)
             VALUES ($1, 'surat_masuk', $2, $3, $4, $5, $6, CASE WHEN $2 = 'selesai' THEN now() END)
             RETURNING id`,
            [kode, status, surat.unit_kerja_id, pengolah, judulDari(surat), surat.tahun]);
          rangkaianId = created.id;
          await client.query(
            `INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber)
             VALUES ($1, $2, $3, 'induk', 'aplikasi')`, [rangkaianId, surat.id, surat.unit_kerja_id]);
          await client.query(
            `INSERT INTO audit_log (action, entity_type, entity_id, changes)
             VALUES ('create', 'rangkaian_surat', $1, $2::jsonb)`,
            [rangkaianId, JSON.stringify({ langkah: 'backfill-1', kode, suratMasukId: surat.id, status, unitPengolahId: pengolah })]);
          rangkaianDibuat += 1;
        }
        const updated = await client.query(
          'UPDATE surat_distributions SET rangkaian_id = $1, updated_at = now() WHERE surat_masuk_id = $2 AND rangkaian_id IS NULL',
          [rangkaianId, surat.id]);
        distribusiDiisi += updated.rowCount ?? 0;
        cursor = surat.id;
      }
      await client.query('COMMIT');
      log({ batch: batch.length, rangkaianDibuat, distribusiDiisi });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  const { rows: [{ sisa }] } = await client.query(
    'SELECT count(*)::int AS sisa FROM surat_distributions WHERE rangkaian_id IS NULL');
  return { rangkaianDibuat, distribusiDiisi, sisaTanpaRangkaian: sisa };
}

async function main() {
  dotenv.config({ quiet: true });
  if (!process.env.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is required for db:backfill:rangkaian-disposisi');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    const hasil = await backfillRangkaianDisposisi(client, { log: (p) => console.log(JSON.stringify(p)) });
    console.log(JSON.stringify(hasil));
    if (hasil.sisaTanpaRangkaian !== 0) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
```

Tambahkan di `backend/package.json` (blok `scripts`, setelah `"db:migrate"`):

```json
    "db:backfill:rangkaian-disposisi": "node scripts/backfill-rangkaian-disposisi.mjs",
```

Catatan: `SELECT ... FOR UPDATE OF sm` memakai kursor `sm.id > $2` sehingga surat masuk yang *dikunci* oleh transaksi aplikasi tidak dilewati diam-diam; skrip dijalankan sebelum kode P3 aktif, jadi tidak ada penulis lain.

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `cd backend && TEST_POSTGRES_URL=postgresql://simsa_test:simsa_test@127.0.0.1:5432/simsa_test npx vitest run --config vitest.postgres.config.ts integration/backfill-rangkaian-disposisi.postgres.test.ts`
Expected: PASS (4 test).

- [ ] **Step 6: Commit**

```bash
git add backend/integration/helpers/rangkaian-db.ts backend/scripts/backfill-rangkaian-disposisi.mjs backend/integration/backfill-rangkaian-disposisi.postgres.test.ts backend/package.json
git commit -m "feat(rangkaian): backfill langkah 1 disposisi eksplisit dan harness Postgres

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


#### Amandemen pra-eksekusi Task 2 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


**Files: add**
- Create: `docs/RUNBOOK_INTEGRASI_SURAT_P3.md`
- Create: `backend/integration/helpers/db-proxy.ts`

**Step 4: delete** the sentence at plan:780, "skrip dijalankan sebelum kode P3 aktif, jadi tidak ada penulis lain". It is false: live P2 `POST /api/distributions` inserts rows with `rangkaian_id` NULL until P3 is deployed (`backend/src/routes/distribution.routes.ts:206-213`). Replace it with: "Penulis P2 masih aktif sampai kode P3 dideploy; karena itu runbook menjalankan ulang skrip (idempoten) segera SETELAH deploy." [T2-2]

**`package.json` insertion:** put the script after `"db:migrate"` at `backend/package.json:34`. The plan's 40-46 is stale. [T2-6]

**New step 6b, runbook.** Create `docs/RUNBOOK_INTEGRASI_SURAT_P3.md` with these sections [T2-2, T2-3]:

1. **Pre-flight.**
   - Backup.
   - If P2 has not done so, run `SELECT count(*) FROM arsip WHERE trim(klasifikasi_keamanan) = '' AND klasifikasi_keamanan <> ''` (FRa).
   - Confirm that `RANGKAIAN_AJUKAN_AKSES` is unset.
2. **Order.** `npm run db:migrate` → `npm run db:grants:converge` (no new migration in P3) → `npm run db:backfill:rangkaian-disposisi` → deploy P3 code → **run `npm run db:backfill:rangkaian-disposisi` again immediately**.
3. **Exit criterion (verified AFTER the deploy):** the script reports `sisaTanpaRangkaian: 0`, and `SELECT count(*) FROM surat_distributions WHERE rangkaian_id IS NULL` = 0.
4. **Role.** Run the backfill as runtime role `simsa_api` via `NEON_RUNTIME_DATABASE_URL`, using the hidden-prompt pattern of `docs/RUNBOOK_INTEGRASI_SURAT_P1.md:7-27`. That role already holds the needed grants (`backend/src/db/grants/0002_converge_application_grants.sql`). Do NOT use a separate maintenance role, because that changes the grants/0002 hash and the Neon pin.
5. **Flag.** `RANGKAIAN_AJUKAN_AKSES` stays off until security sign-off.
6. **Rollback.** Redeploy P2; P3 rangkaian data stays read-compatible.

**Backfill test: add a fixture.** Add a surat masuk whose only distribution is `rejected`. Expect:
- its rangkaian `status = 'selesai'`, per spec §3 (spec:336);
- `rangkaian_id` filled on the rejected row.

Add this comment to the test: "recompute berikutnya dapat membukanya kembali menjadi `aktif` (diaudit) karena P1 mensyaratkan bukti processed." Do NOT change the backfill status rule. [T2-1]

**`seedUnits` comment:** "Label 'Dit. …' sengaja menimpa nama 0047 (`0047_unit_kerja_direktorat.sql:12-18`) lewat ON CONFLICT DO UPDATE; asersi label di Task 7/9 bergantung padanya." [T2-6]

**Harness header comment:** "Harness Postgres nyata (bukan `src/__tests__/helpers/rangkaian-pglite.ts`) karena suite P3 butuh FOR UPDATE lintas koneksi, `statement_timeout`, dan PG ≥16." [T2-4]

**Database mock, shared by every P3 Postgres test.** Replace the instruction at plan:556-571 ("sama persis di setiap berkas") with a shared helper [T2-5]:

```ts
// backend/integration/helpers/db-proxy.ts
export const dbState: { db: any } = { db: null };
const proxy = new Proxy({}, { get: (_t, key) => { const v = dbState.db?.[key]; return typeof v === 'function' ? v.bind(dbState.db) : v; } });
export const db = proxy;
export default { db: proxy };
```

Each Postgres test then does:
- `vi.mock('../src/config/database', () => import('./helpers/db-proxy.js'))`
- the same for `'../src/config/database.js'`
- `import { dbState } from './helpers/db-proxy.js'`, then `dbState.db = h.db` in `beforeAll`.

---


**C-6 (critic) — Tasks 12 and 2: open disposisi with a NULL `rangkaian_id` on member SMs, and the backfill lock order [C-6]**


The trigger and the fact queries disagree about NULL-`rangkaian_id` distributions:
- Trigger 0046 treats such a distribution as belonging to every rangkaian its SM is a member of (`0046_rangkaian_surat.sql:255-256`, `:274-281`).
- The P1 facts and the T12-1 builders count only `d.rangkaian_id = R` (`rangkaian.service.ts:394-395`; amend:606-610).

T2-2 accepts a deploy window in which P3 is live before the backfill re-run (amend:141). In that window:
1. A P2-era NULL `sent` row on a member SM does not block Berkaskan.
2. After Berkaskan, receive/process/reject/tutup on that row raise 23514.
3. The backfill re-run's UPDATE (plan:737-739) also raises 23514 inside the batch transaction. The batch rolls back and throws (plan:745-747).
4. The script exits before every later SM, so `sisaTanpaRangkaian: 0` becomes unreachable.

Separately, the backfill's existing-rangkaian path UPDATEs `surat_distributions` without first locking `rangkaian_surat`. That breaks RB:90 and RB:103 ("atau baris rangkaian"), and the path now runs concurrently with live P3 code.

**(a) `disposisiTerbukaSql`** (replaces amend:606-610). Once NULL rows reach 0 this is a no-op; inside the window it fails closed.

```ts
export function disposisiTerbukaSql(rangkaianId: SQL | string): SQL {
    return sql`(SELECT count(*)::int FROM surat_distributions d
        JOIN surat_masuk sm ON sm.id = d.surat_masuk_id AND sm.is_deleted IS NOT TRUE
        WHERE d.status IN ('sent', 'received')
          AND (d.rangkaian_id = ${rangkaianId}
               OR (d.rangkaian_id IS NULL AND EXISTS (SELECT 1 FROM rangkaian_anggota ma
                    WHERE ma.rangkaian_id = ${rangkaianId} AND ma.surat_masuk_id = d.surat_masuk_id))))`;
}
```

**(b) Backfill.** Insert after `let rangkaianId = anggota?.rangkaian_id ?? null;` (plan:710):

```js
if (rangkaianId) {
  const { rows: [rs] } = await client.query('SELECT status FROM rangkaian_surat WHERE id = $1 FOR UPDATE', [rangkaianId]); // RB:90 surat → rangkaian → distribusi
  if (rs.status !== 'aktif' && rs.status !== 'selesai') { dilewati.push({ suratMasukId: surat.id, rangkaianId, status: rs.status }); cursor = surat.id; continue; }
}
```

Supporting changes:
- Return `dilewati` in the result.
- `main` sets `process.exitCode = 1` when `dilewati.length > 0`, and prints the list.
- The runbook exit criterion (amend:142) adds "`dilewati` kosong".
- Test: take an SM that is a member of a `diberkaskan` rangkaian and has a NULL `sent` row. The rest of the batch is filled, `dilewati.length === 1` and `sisaTanpaRangkaian === 1`.


**C-10 (critic) — Task 2 runbook: in-flight disposisi on controlled letters (**BLOCKING for production**) [C-10]**


Today targets receive and process Terbatas disposisi by role class (`distribution.routes.ts:41-46` via `canAccessDistributionInUnit`, `:229-303`). After P3:
- receive and process require `checkRead` (plan:4124-4125, 4257-4260);
- cross-unit reads of controlled classes need a grant (`visibility-spec.ts:301`);
- while `RANGKAIAN_AJUKAN_AKSES` is off, `ajukan-akses` returns 404 (plan:2049-2052);
- disposisi grants are minted only for new distributions (T6/T7).

Consequences at deploy:
- Every open disposisi on a Terbatas/Rahasia SM becomes unprocessable. Only Tolak or pengawas Tutup remain.
- New disposisi on such letters are refused with 409 (`SURAT_TERKENDALI_DISPOSISI_MESSAGE`, T7).

Add this query to runbook section 1 (Pre-flight, amend:137-140), run with the read-only role:

```sql
SELECT lower(regexp_replace(btrim(sm.sifat_surat), '[[:space:]-]+', '_', 'g')) AS kelas, d.status, count(*)
  FROM surat_distributions d JOIN surat_masuk sm ON sm.id = d.surat_masuk_id
 WHERE d.status IN ('sent', 'received') AND sm.is_deleted IS NOT TRUE
 GROUP BY 1, 2 ORDER BY 1, 2;
```

If any row has `kelas IN ('terbatas','rahasia','sangat_rahasia')`, hold the deploy until a written decision is recorded in the runbook result. The decision is one of:
- (i) get security sign-off, then switch on `RANGKAIAN_AJUKAN_AKSES` right after the deploy;
- (ii) TU/pengawas closes (Tutup) or reissues those disposisi after the deploy;
- (iii) accept that targets will reject (Tolak) them.

Also add a release note for TU: "selama flag Ajukan Akses mati, surat Terbatas/Rahasia tidak dapat didisposisikan (409)."



## B. Backend Lacak

### Task 3: `escapeLike` dan klasifikasi kueri Lacak (melengkapi `nomor-surat.ts` P1)

**Files:**
- Modify: `backend/src/utils/nomor-surat.ts` (dibuat P1 dengan `normalizeNomor` dan `nomorNormSql`; tambahkan di akhir berkas)
- Test: `backend/src/__tests__/nomor-surat-lacak.test.ts` (`nomor-surat.test.ts` milik P1 tidak diubah)

**Interfaces:**
- Consumes: `normalizeNomor(value)`, `nomorNormSql(column)` (P1; urutan buang-lalu-lowercase sama dengan ekspresi index).
- Produces: `LACAK_Q_MIN = 3`, `LACAK_Q_MAX = 100`, `LACAK_MAX_TOKENS = 8`, `escapeLike(value: string): string`, `LIKE_ESCAPE: SQL` (`ESCAPE '\'`), `classifyLacakQuery(raw: string): LacakQueryPlan` dengan `LacakQueryPlan = { q; qLower; qNorm; jenis: 'nomor' | 'perihal'; tokens: string[]; substringNomor: boolean }`.

- [ ] **Step 1: Tulis test yang gagal**

```ts
// backend/src/__tests__/nomor-surat-lacak.test.ts
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { classifyLacakQuery, escapeLike, LIKE_ESCAPE } from '../utils/nomor-surat';

describe('escapeLike', () => {
    it('meng-escape %, _, dan backslash', () => {
        expect(escapeLike('100%_a\\b')).toBe('100\\%\\_a\\\\b');
    });

    it('membuat wildcard literal di PostgreSQL dengan ESCAPE', async () => {
        const pg = new PGlite();
        const db = drizzle(pg);
        const cocok = async (teks: string, pola: string) => ((await db.execute(
            sql`SELECT ${teks}::text ILIKE ${`%${escapeLike(pola)}%`} ${LIKE_ESCAPE} AS m`,
        )).rows[0] as { m: boolean }).m;
        try {
            expect(await cocok('Diskon 100% Tanah', '100% Tanah')).toBe(true);
            expect(await cocok('Diskon 100 x Tanah', '100% Tanah')).toBe(false);
            expect(await cocok('B_12', 'b_1')).toBe(true);
            expect(await cocok('BX12', 'b_1')).toBe(false);
            expect(await cocok('C:\\arsip', 'c:\\a')).toBe(true);
        } finally {
            await pg.close();
        }
    });
});

describe('classifyLacakQuery', () => {
    it.each([
        ['B-12/PTPP.1/IX/2024', 'nomor'],
        ['005', 'nomor'],
        ['SK 12', 'nomor'],
        ['rapat koordinasi', 'perihal'],
    ])('%s → mode %s', (q, jenis) => {
        expect(classifyLacakQuery(q).jenis).toBe(jenis);
    });

    it('q di-trim dan qNorm memakai normalizeNomor P1', () => {
        expect(classifyLacakQuery('  B-12/PTPP.1  ')).toMatchObject({ q: 'B-12/PTPP.1', qLower: 'b-12/ptpp.1', qNorm: 'b12ptpp1' });
    });

    it('token perihal kata Unicode ≥2 karakter, unik, maksimal 8', () => {
        expect(classifyLacakQuery('Pengadaan Tanah – Jalan Tol Cisumdawu tanah').tokens)
            .toEqual(['pengadaan', 'tanah', 'jalan', 'tol', 'cisumdawu']);
        expect(classifyLacakQuery('Ümlaut Übersicht ab c').tokens).toEqual(['ümlaut', 'übersicht', 'ab']);
        expect(classifyLacakQuery('a b c d e f g h').tokens).toEqual([]);
        expect(classifyLacakQuery('aa bb cc dd ee ff gg hh ii jj').tokens).toHaveLength(8);
    });

    it('substring nomor hanya bila qNorm ≥ 5', () => {
        expect(classifyLacakQuery('12/34').substringNomor).toBe(false);
        expect(classifyLacakQuery('12/345').substringNomor).toBe(true);
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/nomor-surat-lacak.test.ts`
Expected: FAIL — `escapeLike`/`classifyLacakQuery` tidak diekspor.

- [ ] **Step 3: Implementasi (tambahkan di akhir `backend/src/utils/nomor-surat.ts`)**

```ts
// ---- P3: Lacak Surat (§6) ----
export const LACAK_Q_MIN = 3;
export const LACAK_Q_MAX = 100;
export const LACAK_MAX_TOKENS = 8;

export type LacakJenisKueri = 'nomor' | 'perihal';

export interface LacakQueryPlan {
    q: string;
    qLower: string;
    qNorm: string;
    jenis: LacakJenisKueri;
    tokens: string[];
    substringNomor: boolean;
}

/** Escape wildcard LIKE; selalu dipakai bersama LIKE_ESCAPE. */
export function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export const LIKE_ESCAPE = sql.raw("ESCAPE '\\'");

/** Mode nomor bila q memuat digit dan salah satu / . -, atau qNorm ≥3 dengan digit; token = kata Unicode ≥2. */
export function classifyLacakQuery(raw: string): LacakQueryPlan {
    const q = raw.trim();
    const qNorm = normalizeNomor(q);
    const hasDigit = /\d/.test(q);
    const jenis: LacakJenisKueri = hasDigit && (/[/.\-]/.test(q) || qNorm.length >= 3) ? 'nomor' : 'perihal';
    const tokens = Array.from(new Set(
        (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((token) => token.length >= 2),
    )).slice(0, LACAK_MAX_TOKENS);
    return { q, qLower: q.toLowerCase(), qNorm, jenis, tokens, substringNomor: qNorm.length >= 5 };
}
```

(Pastikan impor `sql` dari `drizzle-orm` di kepala berkas mencakup nilai `sql`, bukan hanya tipe; P1 sudah mengimpornya untuk `nomorNormSql`.)

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/nomor-surat-lacak.test.ts src/__tests__/nomor-surat.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/nomor-surat.ts backend/src/__tests__/nomor-surat-lacak.test.ts
git commit -m "feat(lacak): escapeLike dan klasifikasi kueri Lacak

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Backend `/api/rangkaian/lacak` (3 mode), `lacakLimiter`, allowlist demo

**Files:**
- Create: `backend/src/services/rangkaian/lacak.types.ts`
- Create: `backend/src/services/rangkaian/lacak.service.ts`
- Modify: `backend/src/services/rangkaian.service.ts` (P1: tambah metode `lacak` yang mendelegasikan lewat impor dinamis)
- Modify: `backend/src/validators/schemas.ts` (tambah `lacakQuerySchema` setelah blok distribusi, ±baris 572)
- Modify: `backend/src/middlewares/rate-limiter.middleware.ts:112` (sisipkan `lacakLimiter` setelah `ocrLimiter`)
- Modify: `backend/src/routes/rangkaian.routes.ts` (P2; sisipkan route `/lacak` **sebelum** `router.get('/:id', ...)`)
- Modify: `backend/src/middlewares/demo-access.middleware.ts:107-110` (allowlist)
- Test: `backend/src/__tests__/lacak.routes.test.ts`, `backend/integration/lacak.postgres.test.ts`, `backend/src/__tests__/demo-access.middleware.test.ts`

**Interfaces:**
- Consumes: `classifyLacakQuery`, `escapeLike`, `LIKE_ESCAPE` (Task 3); `nomorNormSql` (P1); `resolveKonteksBaca`, `visibleSql(ctx, { type, alias }, 'list')`, `recordAccessService.checkMany`, `isAjukanAksesEnabled` (P2 via deps); `rowsOf`, `uuidArraySql`, `textArraySql`, `isFullAdmin` (Task 1); `rangkaianService.ensureForSurat/attach` (P1, fixture test).
- Produces: kontrak Lacak di "Diproduksi untuk P4/P5"; `lacakService.search(user, params)`; `rangkaianService.lacak(user, params)`; `lacakQuerySchema`; `lacakLimiter`, `LACAK_RATE_LIMIT_MAX = 90`. Seed CTE (kolom `skor`, `tanggal_surat`) ada di `services/rangkaian/lacak.service.ts` — titik ubah P4 Task 3.

- [ ] **Step 1: Tulis test route yang gagal (urutan route, validasi, role, limiter)**

```ts
// backend/src/__tests__/lacak.routes.test.ts
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    search: vi.fn(),
    user: { id: 'user-1', email: 'u@example.test', name: 'U', role: 'admin_unit', unitKerjaId: 'dir_bppt' as string | null },
}));

vi.mock('../config/database', () => ({ db: {} }));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { ...mocks.user, id: req.header('x-user') || mocks.user.id };
        next();
    },
}));
vi.mock('../services/rangkaian/lacak.service.js', () => ({ lacakService: { search: mocks.search } }));

const { default: rangkaianRouter } = await import('../routes/rangkaian.routes');
const { LACAK_RATE_LIMIT_MAX } = await import('../middlewares/rate-limiter.middleware');

const app = express();
app.use(express.json());
app.use('/api/rangkaian', rangkaianRouter);
app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ error: error.message }));

const kosong = { q: 'B-12', mode: 'lacak', jenisKueri: 'nomor', kelompok: [] };

describe('GET /api/rangkaian/lacak', () => {
    beforeEach(() => {
        mocks.search.mockReset().mockResolvedValue(kosong);
        mocks.user.role = 'admin_unit';
    });

    it('GET /lacak tidak tertangkap route /:id', async () => {
        const res = await request(app).get('/api/rangkaian/lacak').query({ q: 'B-12' }).set('x-user', 'route-order');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, data: kosong });
        expect(mocks.search).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'route-order' }),
            { q: 'B-12', mode: 'lacak', limit: 8 },
        );
    });

    it.each([
        [{ q: 'ab' }],
        [{ q: 'x'.repeat(101) }],
        [{ q: 'B-12', limit: '9' }],
        [{ q: 'B-12', mode: 'semua' }],
    ])('400 untuk kueri tidak sah %j', async (query) => {
        const res = await request(app).get('/api/rangkaian/lacak').query(query).set('x-user', 'validasi');
        expect(res.status).toBe(400);
        expect(mocks.search).not.toHaveBeenCalled();
    });

    it('meneruskan mode, tahun, jenis, dan limit yang sudah dikoersi', async () => {
        await request(app).get('/api/rangkaian/lacak')
            .query({ q: '  Nota  ', mode: 'referensi', tahun: '2026', jenis: 'surat_keluar', limit: '3' })
            .set('x-user', 'koersi').expect(200);
        expect(mocks.search).toHaveBeenCalledWith(expect.anything(),
            { q: 'Nota', mode: 'referensi', tahun: 2026, jenis: 'surat_keluar', limit: 3 });
    });

    it('403 untuk pengguna tanpa role terprovisi', async () => {
        mocks.user.role = 'user';
        await request(app).get('/api/rangkaian/lacak').query({ q: 'B-12' }).set('x-user', 'tanpa-role').expect(403);
    });

    it('lacakLimiter membatasi 90 permintaan/menit per pengguna', async () => {
        const pengguna = `limit-${Date.now()}`;
        for (let i = 0; i < LACAK_RATE_LIMIT_MAX; i += 1) {
            await request(app).get('/api/rangkaian/lacak').query({ q: 'B-12' }).set('x-user', pengguna).expect(200);
        }
        await request(app).get('/api/rangkaian/lacak').query({ q: 'B-12' }).set('x-user', pengguna).expect(429);
        await request(app).get('/api/rangkaian/lacak').query({ q: 'B-12' }).set('x-user', `${pengguna}-lain`).expect(200);
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/lacak.routes.test.ts`
Expected: FAIL — `lacakService` tak dipanggil (404/400 dari route `/:id`) dan `LACAK_RATE_LIMIT_MAX` undefined.

- [ ] **Step 3: Implementasi skema, limiter, tipe, dan route**

Tambah di `backend/src/validators/schemas.ts` (setelah `export type QueryDistribution ...`):

```ts
// ==================== Rangkaian: Lacak ====================
export const lacakQuerySchema = z.object({
    q: z.string().trim().min(3, 'Kata kunci minimal 3 karakter').max(100, 'Kata kunci maksimal 100 karakter'),
    tahun: z.coerce.number().int().min(2000).max(2100).optional(),
    mode: z.enum(['lacak', 'referensi', 'cek']).default('lacak'),
    limit: z.coerce.number().int().min(1).max(8).default(8),
    jenis: z.enum(['surat_masuk', 'surat_keluar']).optional(),
});
export type LacakQuery = z.infer<typeof lacakQuerySchema>;
```

Sisipkan di `backend/src/middlewares/rate-limiter.middleware.ts` tepat setelah blok `ocrLimiter` (baris 112):

```ts
export const LACAK_RATE_LIMIT_MAX = 90;

// Lacak Surat dipanggil saat mengetik (debounce 300 ms di klien). Kuota per
// pengguna terautentikasi, tidak per IP, agar satu kantor di balik NAT tidak
// saling menghabiskan. generalLimiter tetap berlaku (tidak di-skip).
export const lacakLimiter = rateLimit({
    store: createRateLimiterStore('lacak'),
    passOnStoreError: false,
    windowMs: 60 * 1000,
    max: LACAK_RATE_LIMIT_MAX,
    keyGenerator: (req: AuthRequest) => req.user?.id || 'unauthenticated',
    message: {
        error: 'Too Many Requests',
        message: 'Terlalu banyak pencarian. Coba lagi setelah 1 menit.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});
```

```ts
// backend/src/services/rangkaian/lacak.types.ts
// Bentuk ini dibekukan untuk P4 (rencana P4 Task 1). Jangan ubah nama bidang.
export type LacakMode = 'lacak' | 'referensi' | 'cek';
export type LacakSuratJenis = 'surat_masuk' | 'surat_keluar';
export type LacakJenisRelasi = 'balasan' | 'tindak_lanjut' | 'menjelaskan' | 'merujuk';

export interface LacakParams {
    q: string;
    mode: LacakMode;
    limit?: number;
    tahun?: number;
    jenis?: LacakSuratJenis;
}

export interface LacakNode {
    anggotaId: string | null;
    jenis: LacakSuratJenis;
    id: string;
    nomorSurat: string | null;
    perihal: string | null;
    tanggalSurat: string | null;
    tahun: number;
    naskah: string | null;
    unitKerjaId: string;
    unitNama: string;
    relasi: LacakJenisRelasi | null;
    masked: false;
}

export interface LacakNodeTersamar {
    anggotaId: string;
    jenis: LacakSuratJenis;
    unitNama: string;
    label: 'Dikecualikan';
    masked: true;
    dapatAjukanAkses: boolean;
}

export interface LacakCocok {
    jenis: LacakSuratJenis;
    id: string;
    nomorSurat: string | null;
    perihal: string | null;
    tahun: number;
    skor: number;
}

export interface LacakKelompok {
    kunci: string;
    skor: number;
    tanggalTerbaru: string | null;
    rangkaian: { id: string; kode: string; status: 'aktif' | 'selesai' | 'diberkaskan' | 'digabung'; judul: string; tahun: number; asal: string } | null;
    cocok: LacakCocok[];
    pratinjau: Array<LacakNode | LacakNodeTersamar>;
    jumlahAnggota: number;
    pratinjauTerpotong: boolean;
}

export interface LacakResult {
    q: string;
    mode: LacakMode;
    jenisKueri: 'nomor' | 'perihal';
    kelompok: LacakKelompok[];
}
```

```ts
// backend/src/services/rangkaian/lacak.service.ts
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { classifyLacakQuery, escapeLike, LIKE_ESCAPE, nomorNormSql, type LacakQueryPlan } from '../../utils/nomor-surat.js';
import {
    isAjukanAksesEnabled, recordAccessService, resolveKonteksBaca, visibleSql,
    type KonteksBaca, type RecordUser, type SuratJenis, type Tx,
} from './deps.js';
import { isFullAdmin } from './roles.js';
import { rowsOf, textArraySql, uuidArraySql } from './sql-rows.js';
import type { LacakCocok, LacakKelompok, LacakNode, LacakNodeTersamar, LacakParams, LacakResult } from './lacak.types.js';

const SEED_LIMIT = 200;
const NODE_PRATINJAU = 8;
const KELOMPOK_MAKS = 8;

interface Branch { jenis: SuratJenis; table: string; alias: 'sm' | 'sk'; pihak: string; anggotaCol: string; naskah: string }

const BRANCHES: Record<SuratJenis, Branch> = {
    surat_masuk: { jenis: 'surat_masuk', table: 'surat_masuk', alias: 'sm', pihak: 'sm.dari', anggotaCol: 'surat_masuk_id', naskah: 'NULL::text' },
    surat_keluar: { jenis: 'surat_keluar', table: 'surat_keluar', alias: 'sk', pihak: 'sk.kepada', anggotaCol: 'surat_keluar_id', naskah: 'sk.naskah_dinas' },
};

interface GrupRow { kunci: string; rangkaian_id: string | null; skor: number; tanggal_terbaru: string | null; cocok: LacakCocok[] }
interface NodeRow {
    anggota_id: string; rangkaian_id: string; peran: 'induk' | 'anggota'; unit_kerja_id: string; unit_nama: string;
    jenis: SuratJenis; surat_id: string; nomor_surat: string | null; perihal: string | null; tanggal_surat: string | null;
    tahun: number; naskah: string | null; relasi: LacakNode['relasi']; urut: number; jumlah: number;
}

function semuaToken(column: SQL, tokens: string[]): SQL {
    return sql.join(tokens.map((token) => sql`${column} ILIKE ${`%${escapeLike(token)}%`} ${LIKE_ESCAPE}`), sql` AND `);
}

/** Skor & predikat cocok per cabang (tabel skor §6). null = kueri tidak dapat dicocokkan. */
export function skorSql(branch: Branch, plan: LacakQueryPlan, mode: LacakParams['mode']): { skor: SQL; cocok: SQL } | null {
    const nomor = sql.raw(`${branch.alias}.nomor_surat`);
    const norm = nomorNormSql(nomor);
    const mentah = sql`lower(coalesce(${nomor}, '')) = ${plan.qLower}`;
    const samaNorm = sql`${norm} = ${plan.qNorm}`;
    if (mode === 'cek') {
        if (!plan.qNorm) return null;
        return { skor: sql`CASE WHEN ${mentah} THEN 100 WHEN ${samaNorm} THEN 90 ELSE 0 END`, cocok: sql`(${mentah} OR ${samaNorm})` };
    }
    const skor: SQL[] = [];
    const cocok: SQL[] = [];
    if (plan.jenis === 'nomor' && plan.qNorm) {
        const prefix = sql`${norm} LIKE ${`${escapeLike(plan.qNorm)}%`} ${LIKE_ESCAPE}`;
        const kasus = [sql`WHEN ${mentah} THEN 100`, sql`WHEN ${samaNorm} THEN 90`, sql`WHEN ${prefix} THEN 70`];
        cocok.push(mentah, samaNorm, prefix);
        if (plan.substringNomor) {
            const substring = sql`${norm} LIKE ${`%${escapeLike(plan.qNorm)}%`} ${LIKE_ESCAPE}`;
            kasus.push(sql`WHEN ${substring} THEN 50`);
            cocok.push(substring);
        }
        skor.push(sql`CASE ${sql.join(kasus, sql` `)} ELSE 0 END`);
    }
    if (plan.tokens.length > 0) {
        const perihal = sql.raw(`${branch.alias}.perihal`);
        const pihak = sql.raw(branch.pihak);
        const diPerihal = semuaToken(perihal, plan.tokens);
        const diPihak = semuaToken(pihak, plan.tokens);
        const frasa = sql`${perihal} ILIKE ${`%${escapeLike(plan.q)}%`} ${LIKE_ESCAPE}`;
        skor.push(sql`CASE WHEN ${diPerihal} THEN 40 + CASE WHEN ${frasa} THEN 5 ELSE 0 END ELSE 0 END`);
        skor.push(sql`CASE WHEN ${diPihak} THEN 20 ELSE 0 END`);
        cocok.push(sql`(${diPerihal})`, sql`(${diPihak})`);
    }
    if (skor.length === 0) return null;
    return {
        skor: skor.length === 1 ? skor[0] : sql`GREATEST(${sql.join(skor, sql`, `)})`,
        cocok: sql`(${sql.join(cocok, sql` OR `)})`,
    };
}

function cabangSql(branch: Branch, plan: LacakQueryPlan, params: LacakParams, ctx: KonteksBaca): SQL | null {
    const s = skorSql(branch, plan, params.mode);
    if (!s) return null;
    const a = sql.raw(branch.alias);
    const tahun = params.tahun ? sql`AND ${a}.tahun = ${params.tahun}` : sql``;
    // Predikat visibilitas P2 diterapkan DI SEED sebelum LIMIT (§4.9, tanpa oracle).
    const visible = visibleSql(ctx, { type: branch.jenis, alias: branch.alias }, 'list');
    return sql`SELECT ${branch.jenis}::text AS jenis, ${a}.id AS surat_id, ${a}.tanggal_surat, ${a}.nomor_surat, ${a}.perihal,
            ${a}.tahun, ra.rangkaian_id, (${s.skor}) AS skor
        FROM ${sql.raw(branch.table)} ${a}
        LEFT JOIN rangkaian_anggota ra ON ra.${sql.raw(branch.anggotaCol)} = ${a}.id
        WHERE ${a}.is_deleted IS NOT TRUE ${tahun} AND ${s.cocok} AND (${visible})`;
}

async function muatTunggal(tx: Tx, refs: LacakCocok[]): Promise<Map<string, LacakNode>> {
    const masuk = refs.filter((r) => r.jenis === 'surat_masuk').map((r) => r.id);
    const keluar = refs.filter((r) => r.jenis === 'surat_keluar').map((r) => r.id);
    const rows = [
        ...(masuk.length === 0 ? [] : rowsOf<any>(await tx.execute(sql`
            SELECT 'surat_masuk' AS jenis, sm.id, sm.nomor_surat, sm.perihal, sm.tanggal_surat::text AS tanggal_surat,
                   sm.tahun, sm.unit_kerja_id, uk.name AS unit_nama, NULL::text AS naskah
              FROM surat_masuk sm JOIN unit_kerja uk ON uk.id = sm.unit_kerja_id
             WHERE sm.id = ANY(${uuidArraySql(masuk)})`))),
        ...(keluar.length === 0 ? [] : rowsOf<any>(await tx.execute(sql`
            SELECT 'surat_keluar' AS jenis, sk.id, sk.nomor_surat, sk.perihal, sk.tanggal_surat::text AS tanggal_surat,
                   sk.tahun, sk.unit_kerja_id, uk.name AS unit_nama, sk.naskah_dinas AS naskah
              FROM surat_keluar sk JOIN unit_kerja uk ON uk.id = sk.unit_kerja_id
             WHERE sk.id = ANY(${uuidArraySql(keluar)})`))),
    ];
    return new Map(rows.map((row) => [`${row.jenis}:${row.id}`, {
        anggotaId: null, jenis: row.jenis, id: row.id, nomorSurat: row.nomor_surat, perihal: row.perihal,
        tanggalSurat: row.tanggal_surat, tahun: row.tahun, naskah: row.naskah, unitKerjaId: row.unit_kerja_id,
        unitNama: row.unit_nama, relasi: null, masked: false as const,
    }]));
}

async function ekspansi(tx: Tx, user: RecordUser, grup: GrupRow[]): Promise<LacakKelompok[]> {
    const rangkaianIds = grup.filter((g) => g.rangkaian_id).map((g) => g.rangkaian_id as string);
    const semuaCocok = grup.flatMap((g) => g.cocok.map((c) => `${c.jenis}:${c.id}`));
    const nodeRows = rangkaianIds.length === 0 ? [] : rowsOf<NodeRow>(await tx.execute(sql`
        SELECT * FROM (
            SELECT a.id AS anggota_id, a.rangkaian_id, a.peran, a.unit_kerja_id, uk.name AS unit_nama,
                   CASE WHEN a.surat_masuk_id IS NOT NULL THEN 'surat_masuk' ELSE 'surat_keluar' END AS jenis,
                   coalesce(a.surat_masuk_id, a.surat_keluar_id) AS surat_id,
                   coalesce(sm.nomor_surat, sk.nomor_surat) AS nomor_surat,
                   coalesce(sm.perihal, sk.perihal) AS perihal,
                   coalesce(sm.tanggal_surat, sk.tanggal_surat)::text AS tanggal_surat,
                   coalesce(sm.tahun, sk.tahun) AS tahun,
                   sk.naskah_dinas AS naskah,
                   (SELECT r.jenis_relasi FROM rangkaian_relasi r
                     WHERE r.dari_anggota_id = a.id AND r.cancelled_at IS NULL
                     ORDER BY r.created_at LIMIT 1) AS relasi,
                   row_number() OVER (PARTITION BY a.rangkaian_id ORDER BY (a.peran = 'induk') DESC,
                       ((CASE WHEN a.surat_masuk_id IS NOT NULL THEN 'surat_masuk:' ELSE 'surat_keluar:' END)
                           || coalesce(a.surat_masuk_id, a.surat_keluar_id)::text = ANY(${textArraySql(semuaCocok)})) DESC,
                       coalesce(sm.tanggal_surat, sk.tanggal_surat) ASC NULLS LAST, a.id)::int AS urut,
                   count(*) OVER (PARTITION BY a.rangkaian_id)::int AS jumlah
              FROM rangkaian_anggota a
              JOIN unit_kerja uk ON uk.id = a.unit_kerja_id
              LEFT JOIN surat_masuk sm ON sm.id = a.surat_masuk_id
              LEFT JOIN surat_keluar sk ON sk.id = a.surat_keluar_id
             WHERE a.rangkaian_id = ANY(${uuidArraySql(rangkaianIds)})
               AND coalesce(sm.is_deleted, sk.is_deleted) IS NOT TRUE
        ) x WHERE urut <= ${NODE_PRATINJAU}`));
    const rangkaianRows = rangkaianIds.length === 0 ? [] : rowsOf<NonNullable<LacakKelompok['rangkaian']>>(await tx.execute(sql`
        SELECT id, kode, status, judul, tahun, asal FROM rangkaian_surat WHERE id = ANY(${uuidArraySql(rangkaianIds)})`));
    const tunggal = await muatTunggal(tx, grup.filter((g) => !g.rangkaian_id).flatMap((g) => g.cocok));
    const akses = await recordAccessService.checkMany(user, nodeRows.map((n) => ({ type: n.jenis, id: n.surat_id })), tx);
    const bolehLihat = (n: NodeRow) => akses.get(`${n.jenis}:${n.surat_id}`)?.allowed === true;
    const dapatAjukanAkses = isAjukanAksesEnabled() && isFullAdmin(user);

    const keNode = (n: NodeRow): LacakNode | LacakNodeTersamar => bolehLihat(n)
        ? {
            anggotaId: n.anggota_id, jenis: n.jenis, id: n.surat_id, nomorSurat: n.nomor_surat, perihal: n.perihal,
            tanggalSurat: n.tanggal_surat, tahun: n.tahun, naskah: n.naskah, unitKerjaId: n.unit_kerja_id,
            unitNama: n.unit_nama, relasi: n.relasi, masked: false,
        }
        : { anggotaId: n.anggota_id, jenis: n.jenis, unitNama: n.unit_nama, label: 'Dikecualikan', masked: true, dapatAjukanAkses };

    return grup.map((g): LacakKelompok => {
        const dasar = { kunci: g.kunci, skor: g.skor, tanggalTerbaru: g.tanggal_terbaru, cocok: g.cocok };
        if (!g.rangkaian_id) {
            const node = g.cocok[0] ? tunggal.get(`${g.cocok[0].jenis}:${g.cocok[0].id}`) : undefined;
            return { ...dasar, rangkaian: null, pratinjau: node ? [node] : [], jumlahAnggota: node ? 1 : 0, pratinjauTerpotong: false };
        }
        const milik = nodeRows.filter((n) => n.rangkaian_id === g.rangkaian_id).sort((a, b) => a.urut - b.urut);
        const r = rangkaianRows.find((row) => row.id === g.rangkaian_id)!;
        const induk = milik.find((n) => n.peran === 'induk');
        const jumlah = milik[0]?.jumlah ?? 0;
        return {
            ...dasar,
            rangkaian: { ...r, judul: induk && bolehLihat(induk) ? r.judul : `Rangkaian ${r.kode} (Dikecualikan)` },
            pratinjau: milik.map(keNode),
            jumlahAnggota: jumlah,
            pratinjauTerpotong: jumlah > milik.length,
        };
    });
}

export const lacakService = {
    async search(user: RecordUser, params: LacakParams): Promise<LacakResult> {
        const plan = classifyLacakQuery(params.q);
        const limit = Math.min(params.limit ?? KELOMPOK_MAKS, KELOMPOK_MAKS);
        const kosong: LacakResult = { q: plan.q, mode: params.mode, jenisKueri: plan.jenis, kelompok: [] };
        return db.transaction(async (tx) => {
            await tx.execute(sql`SET LOCAL statement_timeout = '2s'`);
            const ctx = await resolveKonteksBaca(user, tx as never);
            const jenisList: SuratJenis[] = params.jenis ? [params.jenis] : ['surat_masuk', 'surat_keluar'];
            const cabang = jenisList.map((jenis) => cabangSql(BRANCHES[jenis], plan, params, ctx)).filter((c): c is SQL => c !== null);
            if (cabang.length === 0) return kosong;
            const minimum = params.mode === 'cek' ? 90 : 1;
            const grup = rowsOf<GrupRow>(await tx.execute(sql`
                WITH seed AS (${sql.join(cabang.map((c) => sql`(${c})`), sql` UNION ALL `)}),
                teratas AS (
                    SELECT * FROM seed WHERE skor >= ${minimum}
                     ORDER BY skor DESC, tanggal_surat DESC NULLS LAST, surat_id
                     LIMIT ${SEED_LIMIT}
                ),
                kelompok AS (
                    SELECT CASE WHEN rs.id IS NULL THEN 'surat:' || t.surat_id::text
                                ELSE coalesce(rs.digabung_ke_id, rs.id)::text END AS kunci,
                           coalesce(rs.digabung_ke_id, rs.id) AS rangkaian_id,
                           max(t.skor)::int AS skor,
                           max(t.tanggal_surat)::text AS tanggal_terbaru,
                           json_agg(json_build_object('jenis', t.jenis, 'id', t.surat_id, 'nomorSurat', t.nomor_surat,
                               'perihal', t.perihal, 'tahun', t.tahun, 'skor', t.skor)
                               ORDER BY t.skor DESC, t.tanggal_surat DESC NULLS LAST) AS cocok
                      FROM teratas t LEFT JOIN rangkaian_surat rs ON rs.id = t.rangkaian_id
                     GROUP BY 1, 2
                )
                SELECT kunci, rangkaian_id, skor, tanggal_terbaru, cocok
                  FROM kelompok
                 ORDER BY skor DESC, tanggal_terbaru DESC NULLS LAST, kunci ASC
                 LIMIT ${limit}`));
            if (grup.length === 0) return kosong;
            return { ...kosong, kelompok: await ekspansi(tx, user, grup) };
        });
    },
};
```

Di `backend/src/services/rangkaian.service.ts` (P1) tambahkan metode pada objek `rangkaianService` (impor dinamis mencegah siklus `rangkaian.service → lacak.service → deps → rangkaian.service`):

```ts
    /** GET /api/rangkaian/lacak (§6). Implementasi di services/rangkaian/lacak.service.ts. */
    async lacak(user: RecordUser, params: import('./rangkaian/lacak.types.js').LacakParams) {
        const { lacakService } = await import('./rangkaian/lacak.service.js');
        return lacakService.search(user, params);
    },
```

(dengan `import type { RecordUser } from './record-access.service.js';` bila belum ada).

Di `backend/src/routes/rangkaian.routes.ts` (P2), tambahkan impor dan route **tepat setelah** `router.use(authMiddleware)` dan **sebelum** `router.get('/:id', ...)`:

```ts
import { canReadMiddleware } from '../middlewares/role.middleware';
import { validateQuery } from '../middlewares/validate.middleware';
import { lacakLimiter } from '../middlewares/rate-limiter.middleware';
import { lacakQuerySchema } from '../validators/schemas';
import { lacakService } from '../services/rangkaian/lacak.service.js';
import type { LacakParams } from '../services/rangkaian/lacak.types.js';

// Harus terdaftar sebelum '/:id' (validateIdParam akan menolak 'lacak' sebagai UUID).
router.get('/lacak', canReadMiddleware(), lacakLimiter, validateQuery(lacakQuerySchema), async (req: AuthRequest, res, next) => {
    try {
        const params = res.locals.validatedQuery as LacakParams;
        res.json({ success: true, data: await lacakService.search(req.user!, params) });
    } catch (error) {
        next(error);
    }
});
```

Di `backend/src/middlewares/demo-access.middleware.ts`, setelah baris `{ methods: PUT, path: exact(\`/distributions/${UUID}/(?:receive|process|reject)\`) },` tambahkan:

```ts
    { methods: GET, path: exact('/rangkaian/lacak') },
```

Tambahkan ke `it.each` "allows reviewed metadata route" di `backend/src/__tests__/demo-access.middleware.test.ts`:

```ts
        ['GET', '/api/rangkaian/lacak'],
```

- [ ] **Step 4: Jalankan test route, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/lacak.routes.test.ts src/__tests__/demo-access.middleware.test.ts`
Expected: PASS.

- [ ] **Step 5: Tulis test integrasi Postgres Lacak yang gagal**

```ts
// backend/integration/lacak.postgres.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

const state = vi.hoisted(() => ({ db: null as any }));
const proxy = () => ({ db: new Proxy({}, { get: (_t, key) => {
    const value = state.db?.[key];
    return typeof value === 'function' ? value.bind(state.db) : value;
} }) });
vi.mock('../src/config/database', proxy);
vi.mock('../src/config/database.js', proxy);

const { lacakService } = await import('../src/services/rangkaian/lacak.service.js');
const { rangkaianService, aktor } = await import('../src/services/rangkaian/deps.js');

let h: RangkaianTestDatabase;
let pengawas: TestUser; let bppt: TestUser; let superAdmin: TestUser;
const id: Record<string, string> = {};
const cari = (user: TestUser, q: string, extra: Record<string, unknown> = {}) =>
    lacakService.search(user, { q, mode: 'lacak', limit: 8, ...extra } as any);
const idPertama = (k: any) => k.cocok[0]?.id;

beforeAll(async () => {
    h = await createRangkaianTestDatabase('lacak');
    state.db = h.db;
    await h.seedUnits();
    pengawas = await h.seedUser('admin_unit', 'sesditjen');
    bppt = await h.seedUser('admin_unit', 'dir_bppt');
    superAdmin = await h.seedUser('super_admin', null);
    id.smPtpp = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'B-12/PTPP.1/IX/2024', perihal: 'Permohonan penetapan lokasi' });
    id.sk123 = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: '1/23', perihal: 'Undangan rapat A', approvalStatus: 'approved' });
    id.sk321 = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: '12/3', perihal: 'Undangan rapat B', approvalStatus: 'approved' });
    id.skKep = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'KEP-7/2026', perihal: 'Keputusan penetapan tim', naskahDinas: 'Keputusan', approvalStatus: 'approved', asalNaskah: 'inisiatif' });
    id.nd = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'ND-9/2026', perihal: 'Penjelasan tim terpadu', approvalStatus: 'approved' });
    id.rahasia = await h.insertSuratKeluar({ unitKerjaId: 'dir_ptep', nomorSurat: 'R-1/2026', perihal: 'Tukar guling kawasan', klasifikasiKeamanan: 'rahasia', approvalStatus: 'approved' });
    id.diskon = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'D-1/2026', perihal: 'Diskon 100% Tanah', approvalStatus: 'approved' });
    id.diskonX = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'D-2/2026', perihal: 'Diskon 100 x Tanah', approvalStatus: 'approved' });
    await h.db.transaction(async (tx: any) => {
        const actor = aktor(bppt);
        const r = await rangkaianService.ensureForSurat(tx, { jenis: 'surat_keluar', id: id.skKep }, actor);
        await rangkaianService.attach(tx, { rangkaianId: r.rangkaianId, surat: { jenis: 'surat_keluar', id: id.nd }, keAnggotaId: r.anggotaId, jenisRelasi: 'menjelaskan' }, actor);
        id.rangkaianKep = r.rangkaianId;
    });
}, 120_000);

afterAll(async () => { await h?.close(); });

describe('Lacak Surat di PostgreSQL', () => {
    it('nomor ternormalisasi menemukan surat masuk TU untuk pengawas (skor 90)', async () => {
        const hasil = await cari(pengawas, 'b12ptpp1ix2024');
        expect(hasil.jenisKueri).toBe('nomor');
        expect(hasil.kelompok[0]).toMatchObject({ kunci: `surat:${id.smPtpp}`, skor: 90, rangkaian: null, jumlahAnggota: 1, pratinjauTerpotong: false });
        expect(hasil.kelompok[0].pratinjau[0]).toMatchObject({ masked: false, id: id.smPtpp, nomorSurat: 'B-12/PTPP.1/IX/2024' });
        expect(hasil.kelompok[0].cocok[0]).toMatchObject({ jenis: 'surat_masuk', id: id.smPtpp, skor: 90, tahun: 2026 });
    });

    it('nomor mentah 1/23 (100) mengungguli tabrakan normalisasi 12/3 (90)', async () => {
        const hasil = await cari(bppt, '1/23');
        expect(hasil.kelompok.map((k) => [idPertama(k), k.skor])).toEqual([[id.sk123, 100], [id.sk321, 90]]);
    });

    it('nomor SK dan perihal ND penjelas menampilkan satu kartu RS berisi keduanya', async () => {
        for (const q of ['KEP-7/2026', 'tim terpadu']) {
            const hasil = await cari(bppt, q);
            expect(hasil.kelompok).toHaveLength(1);
            expect(hasil.kelompok[0].kunci).toBe(id.rangkaianKep);
            expect(hasil.kelompok[0].rangkaian).toMatchObject({ kode: expect.stringMatching(/^RS-2026-\d{6}$/), tahun: 2026, asal: 'inisiatif' });
            expect(hasil.kelompok[0].pratinjau.map((n: any) => n.id).sort()).toEqual([id.skKep, id.nd].sort());
            expect(hasil.kelompok[0].pratinjau.find((n: any) => n.id === id.nd)).toMatchObject({ relasi: 'menjelaskan', naskah: 'Nota Dinas' });
            expect(hasil.kelompok[0].jumlahAnggota).toBe(2);
        }
    });

    it('tanpa oracle: perihal surat rahasia tidak dapat dicocokkan tanpa grant', async () => {
        expect((await cari(bppt, 'Tukar guling')).kelompok).toEqual([]);
        expect((await cari(pengawas, 'Tukar guling')).kelompok).toEqual([]);
        expect((await cari(superAdmin, 'Tukar guling')).kelompok).toHaveLength(1);
    });

    it('mode cek hanya mengembalikan kecocokan nomor persis/normal', async () => {
        expect((await cari(bppt, '1/2', { mode: 'cek' })).kelompok).toEqual([]);
        const hasil = await cari(bppt, '12-3', { mode: 'cek' });
        expect(hasil.kelompok.map((k) => k.skor)).toEqual([90, 90]);
    });

    it('wildcard LIKE di kueri diperlakukan literal', async () => {
        const hasil = await cari(bppt, '100% Tanah');
        const skor = Object.fromEntries(hasil.kelompok.map((k) => [idPertama(k), k.skor]));
        expect(skor[id.diskon]).toBe(45);
        expect(skor[id.diskonX]).toBe(40);
    });

    it('filter tahun, jenis, dan limit', async () => {
        expect((await cari(bppt, '1/23', { tahun: 2025 })).kelompok).toEqual([]);
        expect((await cari(bppt, '1/23', { jenis: 'surat_masuk' })).kelompok).toEqual([]);
        expect((await cari(bppt, 'Undangan rapat', { limit: 1 })).kelompok).toHaveLength(1);
    });
});
```

- [ ] **Step 6: Jalankan test integrasi, pastikan lulus**

Run: `cd backend && TEST_POSTGRES_URL=postgresql://simsa_test:simsa_test@127.0.0.1:5432/simsa_test npx vitest run --config vitest.postgres.config.ts integration/lacak.postgres.test.ts`
Expected: PASS (7 test). Bila "tanpa oracle" gagal untuk `pengawas`, periksa `visibleSql` P2 mode `list` (kelas terkendali wajib grant untuk pengawas) — jangan melonggarkan test.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/rangkaian/lacak.types.ts backend/src/services/rangkaian/lacak.service.ts backend/src/services/rangkaian.service.ts backend/src/validators/schemas.ts backend/src/middlewares/rate-limiter.middleware.ts backend/src/routes/rangkaian.routes.ts backend/src/middlewares/demo-access.middleware.ts backend/src/__tests__/lacak.routes.test.ts backend/src/__tests__/demo-access.middleware.test.ts backend/integration/lacak.postgres.test.ts
git commit -m "feat(lacak): backend /api/rangkaian/lacak tiga mode dengan lacakLimiter per pengguna

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


#### Amandemen pra-eksekusi Task 4 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


**Files: change**
- `backend/src/middlewares/demo-access.middleware.ts:107-110` → `:55`. Extend the existing P2 rangkaian GET entry instead of adding a new one.
- Add `backend/src/routes/__tests__/rangkaian.routes.test.ts` to the Step 4 run list.

**Lacak seed alias.** Rename `LEFT JOIN rangkaian_anggota ra ON ra.… ` and every `ra.rangkaian_id` in `cabangSql` (plan:1225) to `lk_a`. The reason: P2 reserves `ra`, `g` and `j` (`backend/src/services/access/visibility-spec.ts:195-211`). [T4-1]

**`ekspansi` (plan:1279-1311): changes**
- Import `readRefKey`, `LABEL_DIKECUALIKAN` and `judulTersamar` from `./deps.js`. Use `akses.get(readRefKey({ type: n.jenis, id: n.surat_id }))` everywhere instead of the template-string key.
- Delete `const dapatAjukanAkses = isAjukanAksesEnabled() && isFullAdmin(user);`. In `keNode`, use `dapatAjukanAkses: isAjukanAksesEnabled() && akses.get(readRefKey({ type: n.jenis, id: n.surat_id }))?.masked === true`. P2 sets `masked` only on pengawas/peserta paths (`record-access.service.ts:410-428`), which is exactly when `requestViaRangkaian` is eligible. [T4-2]
- Masked label: use `label: LABEL_DIKECUALIKAN`. For the judul, use `judulTersamar(r.kode)` instead of `` `Rangkaian ${r.kode} (Dikecualikan)` ``. [T4-4]
- **Single-surat groups.** Include the `muatTunggal` refs in the same `checkMany` call:

  ```ts
  const tunggalRefs = grup.filter(g => !g.rangkaian_id).flatMap(g => g.cocok.slice(0, 1));
  const akses = await recordAccessService.checkMany(user, [...nodeRows.map(n => ({ type: n.jenis, id: n.surat_id })), ...tunggalRefs.map(c => ({ type: c.jenis, id: c.id }))], tx);
  ```

  When the single node is not `allowed`, return `{ anggotaId: null as never, jenis, unitNama, label: LABEL_DIKECUALIKAN, masked: true, dapatAjukanAkses: false }` in place of the `LacakNode`. Load `unitNama` in `muatTunggal` for that case. Leave `cocok[]` unchanged: spec:558 applies list policy to own-unit matches, and its shape is frozen for P4. [T4-3]
- **Test.** Add a case to `lacak.postgres.test.ts`: an own-unit Terbatas SM with no grant and no rangkaian appears in `cocok`, but its `pratinjau[0].masked === true`.

**Routes (Step 4).**
- Insert `router.get('/lacak', …)` **before** `router.get('/by-surat/:jenis/:suratId', …)` (`backend/src/routes/rangkaian.routes.ts:35`).
- Merge the imports into the existing statements: line 3 `import { validateIdParam } from '../middlewares/validate.middleware'` becomes `import { validateIdParam, validateQuery } from …`. Add a single `role.middleware` import. [T4-5]

**Allowlist.** Change `demo-access.middleware.ts:55` to

```ts
{ methods: GET, path: exact(`/rangkaian/(?:lacak|${UUID}|by-surat/(?:surat_masuk|surat_keluar)/${UUID})`) },
```

Keep the planned `it.each` row.

**PR note:** add an `EXPLAIN (ANALYZE)` smoke on production-size data for the Lacak seed (FR:34). [T4-6]

---


**C-2 (critic) — Tasks 6 and 4: the parity assertion is wrong as written, and `dapatAjukanAkses` must require a controlled class (**BLOCKING for T6**) [C-2]**


The T6-3 assertion (amend:275-281) turns red on the plan's own matrix, which includes `superA` (plan:2394):
- `isGrantEligible` returns `true` whenever `isAllowedForRecordUnit` holds (plan:2099). That includes super_admin (`cocokUnitRekaman` → `semua`, `visibility-spec.ts:247-248`).
- `checkMany` sets `via: 'owner'` only when `owner.allowed` (`record-access.service.ts:403-406`).
- An owner-unit user or super_admin **without** the grant therefore falls through to `jalurJangkauan`. That returns `null` for super_admin and staff, because `unitJangkauan` is `null` (`visibility-spec.ts:270-275`, `record-access.service.ts:408-411`).
- Result: `via` is `null` while eligibility is `true`.

Replace the amend:277-279 assertion with:

```ts
for (const user of matriks) for (const ref of refs) {
    const eligible = await isGrantEligible(h.db, user, ref);
    if (isAllowedForRecordUnit(user, ref.unitKerjaId)) { expect(eligible).toBe(true); continue; }   // owner path = request()
    const { via } = await recordAccessService.checkRead(user, ref.type, ref.id, h.db);
    expect(eligible).toBe(via === 'pengawas' || via === 'peserta');                                 // FR:26 jalurJangkauan parity
}
```

A second problem is that `masked === true` is also set for an **unrecognized** class:
- `kelasBolehDibacaLintasUnit` returns false for it (`visibility-spec.ts:295-303`), so the node is masked and offered.
- `requestViaRangkaian` then answers 409 "tidak memerlukan persetujuan" (plan:2172-2174).

Change the offer in both places where it is computed:
- **T4 `keNode` (amend:184):** use `dapatAjukanAkses: isAjukanAksesEnabled() && a?.masked === true && requiresExplicitAccessGrant(a.classification)`.
- **P2 `getDetail` (`backend/src/services/rangkaian-read.service.ts:398`):** use `samarkanAnggota(row, dapatAjukan && a?.masked === true && requiresExplicitAccessGrant(a?.classification))`. Add this file to T6's Files. It is the source of the panel's `dapatAjukanAkses` that T25 renders.



## C. Create & Tindak Lanjut (backend)

### Task 5: Skema validator P3, `MULTILINE_FIELDS`, dan instruksi disposisi statis

**Files:**
- Modify: `backend/src/validators/schemas.ts:1-10` (impor `jakartaDate`), `:101-137` (blok surat masuk), `:160-206` (blok surat keluar), `:553-572` (blok distribusi)
- Modify: `backend/src/middlewares/sanitize.middleware.ts:11-65`
- Create: `backend/src/config/instruksi-disposisi.ts`
- Modify: `backend/src/__tests__/update-contracts.schemas.test.ts:37-41`
- Test: `backend/src/__tests__/rangkaian.schemas.test.ts`, `backend/src/__tests__/sanitize.middleware.test.ts`

**Interfaces:**
- Consumes: `jakartaDate()` (`backend/src/utils/jakarta-date.ts`).
- Produces: `alasanSchema`, `disposisiTargetSchema`, `disposisiTargetsSchema`, `disposisiRoutingSchema` + `DisposisiRoutingInput`, `tindakLanjutInputSchema` + `TindakLanjutInput`, `processDistributionSchema` + `ProcessDistributionInput`, `selesaiRangkaianSchema`, `berkaskanSchema`, `unitPengolahSchema`, `tautanSchema`, `gabungSchema`, `ajukanAksesSchema`; `createSuratMasukSchema` (`disposisi` = routing | label lama, `referensi`), `updateSuratMasukSchema` (tanpa `status`, dengan `alasan`), `createSuratKeluarSchema` (output selalu punya `tindakLanjut?` dan `asalNaskah?`, **tanpa** `balasanUntuk`), `createDistributionSchema` (output `{ suratMasukId, sourceUnitId, instruksi, ccUnits, bentuk: 'tunggal' | 'jamak', targets }`); `MULTILINE_FIELDS`; `INSTRUKSI_DISPOSISI`.

- [ ] **Step 1: Tulis test yang gagal**

```ts
// backend/src/__tests__/rangkaian.schemas.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createDistributionSchema, createSuratKeluarSchema, createSuratMasukSchema, disposisiRoutingSchema,
    processDistributionSchema, updateSuratMasukSchema, berkaskanSchema, gabungSchema, ajukanAksesSchema,
} from '../validators/schemas';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const UUID2 = '550e8400-e29b-41d4-a716-446655440001';
const suratMasukDasar = { unitKerjaId: 'sesditjen', tanggalSurat: '2026-09-12', perihal: 'Permohonan', dari: 'Kantah' };
const suratKeluarDasar = { unitKerjaId: 'dir_bppt', tanggalSurat: '2026-09-12', perihal: 'Balasan', kepada: 'Kantah' };

afterEach(() => vi.useRealTimers());

describe('skema registrasi surat masuk', () => {
    it('menerima routing disposisi dan referensi, juga sebagai JSON string multipart', () => {
        const routing = { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }, { unitKerjaId: 'dir_ptep' }], instruksi: 'Mohon ditindaklanjuti', labelTambahan: ['Kabag Program dan Hukum'] };
        const parsed = createSuratMasukSchema.parse({ ...suratMasukDasar, disposisi: JSON.stringify(routing), referensi: JSON.stringify({ jenis: 'surat_keluar', id: UUID }) });
        expect(parsed.disposisi).toEqual({ ...routing, targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }, { unitKerjaId: 'dir_ptep', penanggungJawab: false }] });
        expect(parsed.referensi).toEqual({ jenis: 'surat_keluar', id: UUID });
    });

    it('tetap menerima label disposisi lama (string atau array)', () => {
        expect(createSuratMasukSchema.parse({ ...suratMasukDasar, disposisi: 'Ditjen' }).disposisi).toEqual(['Ditjen']);
        expect(createSuratMasukSchema.parse({ ...suratMasukDasar, disposisi: ['Dit. BPPT'] }).disposisi).toEqual(['Dit. BPPT']);
    });

    it('menolak target ganda dan dua penanggung jawab', () => {
        expect(disposisiRoutingSchema.safeParse({ targets: [{ unitKerjaId: 'dir_bppt' }, { unitKerjaId: 'dir_bppt' }] }).success).toBe(false);
        expect(disposisiRoutingSchema.safeParse({ targets: [
            { unitKerjaId: 'dir_bppt', penanggungJawab: true }, { unitKerjaId: 'dir_ptep', penanggungJawab: true },
        ] }).success).toBe(false);
        expect(disposisiRoutingSchema.safeParse({ targets: [] }).success).toBe(false);
    });

    it('menolak batas waktu sebelum hari ini (WIB)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-26T17:30:00Z')); // 27 Sep 2026 00.30 WIB
        expect(disposisiRoutingSchema.safeParse({ targets: [{ unitKerjaId: 'dir_bppt', batasWaktu: '2026-09-26' }] }).success).toBe(false);
        expect(disposisiRoutingSchema.safeParse({ targets: [{ unitKerjaId: 'dir_bppt', batasWaktu: '2026-09-27' }] }).success).toBe(true);
    });

    it('update tidak lagi menerima status dan membawa alasan koreksi', () => {
        expect(updateSuratMasukSchema.parse({ status: 'sudah_dibalas' })).toEqual({});
        expect(updateSuratMasukSchema.parse({ perihal: 'Koreksi', alasan: '  Salah ketik perihal  ' })).toEqual({ perihal: 'Koreksi', alasan: 'Salah ketik perihal' });
        expect(updateSuratMasukSchema.safeParse({ alasan: 'pendek' }).success).toBe(false);
    });
});

describe('skema surat keluar', () => {
    it('inisiatif bersama induk ditolak', () => {
        expect(createSuratKeluarSchema.safeParse({ ...suratKeluarDasar, asalNaskah: 'inisiatif', balasanUntuk: UUID }).success).toBe(false);
        expect(createSuratKeluarSchema.safeParse({ ...suratKeluarDasar, asalNaskah: 'inisiatif',
            tindakLanjut: { jenis: 'surat_masuk', suratId: UUID, jenisRelasi: 'balasan' } }).success).toBe(false);
    });

    it('balasanUntuk lama dipetakan ke tindakLanjut balasan', () => {
        const parsed = createSuratKeluarSchema.parse({ ...suratKeluarDasar, balasanUntuk: UUID });
        expect(parsed.tindakLanjut).toEqual({ jenis: 'surat_masuk', suratId: UUID, jenisRelasi: 'balasan' });
        expect(parsed.asalNaskah).toBe('tindak_lanjut');
        expect(parsed).not.toHaveProperty('balasanUntuk');
    });

    it('ND penjelas memakai relasi menjelaskan ke surat keluar', () => {
        const parsed = createSuratKeluarSchema.parse({ ...suratKeluarDasar, tindakLanjut: { jenis: 'surat_keluar', suratId: UUID, jenisRelasi: 'menjelaskan' } });
        expect(parsed.asalNaskah).toBe('tindak_lanjut');
    });

    it('surat inisiatif murni diterima apa adanya', () => {
        expect(createSuratKeluarSchema.parse({ ...suratKeluarDasar, asalNaskah: 'inisiatif' })).toMatchObject({ asalNaskah: 'inisiatif', tindakLanjut: undefined });
    });
});

describe('skema distribusi', () => {
    it('bentuk tunggal lama dinormalkan menjadi satu target', () => {
        expect(createDistributionSchema.parse({ suratMasukId: UUID, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', instruction: 'Segera' }))
            .toEqual({ suratMasukId: UUID, sourceUnitId: 'sesditjen', instruksi: 'Segera', ccUnits: undefined, bentuk: 'tunggal',
                targets: [{ unitKerjaId: 'dir_bppt', batasWaktu: null, penanggungJawab: false }] });
    });

    it('bentuk jamak memakai targets dan menolak isian ganda', () => {
        expect(createDistributionSchema.parse({ suratMasukId: UUID, sourceUnitId: 'sesditjen', targets: [{ unitKerjaId: 'dir_bppt' }] }).bentuk).toBe('jamak');
        expect(createDistributionSchema.safeParse({ suratMasukId: UUID, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', targets: [{ unitKerjaId: 'dir_ptep' }] }).success).toBe(false);
    });

    it('penyelesaian: surat keluar ATAU catatan ≥10 karakter', () => {
        expect(processDistributionSchema.safeParse({ penyelesaianSuratKeluarId: UUID }).success).toBe(true);
        expect(processDistributionSchema.safeParse({ catatanPenyelesaian: 'Sudah dikoordinasikan' }).success).toBe(true);
        expect(processDistributionSchema.safeParse({ catatanPenyelesaian: 'ok' }).success).toBe(false);
        expect(processDistributionSchema.safeParse({}).success).toBe(false);
    });
});

describe('skema aksi rangkaian', () => {
    it('berkaskan wajib konfirmasi dua langkah', () => {
        expect(berkaskanSchema.safeParse({ unitPengolahId: 'dir_bppt', klasifikasiItemId: 5, konfirmasi: true }).success).toBe(true);
        expect(berkaskanSchema.safeParse({ unitPengolahId: 'dir_bppt', klasifikasiItemId: 5, konfirmasi: false }).success).toBe(false);
    });

    it('gabung wajib alasan ≥10 dan ajukan akses wajib tujuan ≥20', () => {
        expect(gabungSchema.safeParse({ sumberId: UUID2, alasan: 'pendek' }).success).toBe(false);
        expect(ajukanAksesSchema.parse({ purpose: 'Menindaklanjuti disposisi dari TU' })).toEqual({ purpose: 'Menindaklanjuti disposisi dari TU', accessMode: 'view' });
    });
});
```

```ts
// backend/src/__tests__/sanitize.middleware.test.ts
import { describe, expect, it } from 'vitest';
import { MULTILINE_FIELDS, sanitizeInput } from '../middlewares/sanitize.middleware';

function jalankan(body: unknown) {
    const req: any = { body };
    sanitizeInput(req, {} as any, () => undefined);
    return req.body;
}

describe('sanitizeInput', () => {
    it('mempertahankan baris baru pada instruksi tetapi tetap membuang tag', () => {
        expect(jalankan({ instruksi: '1. Siapkan data\r\n2.  Koordinasikan <b>dengan</b> PTEP\n\n\n\n3. Laporkan' }).instruksi)
            .toBe('1. Siapkan data\n2. Koordinasikan dengan PTEP\n\n3. Laporkan');
    });

    it('mencakup persis bidang multi-baris §5', () => {
        expect([...MULTILINE_FIELDS].sort()).toEqual(['alasan', 'catatan', 'catatanPenyelesaian', 'instruction', 'instruksi', 'keterangan']);
    });

    it('bidang lain tetap diratakan menjadi satu baris', () => {
        expect(jalankan({ perihal: 'Undangan\n  rapat' }).perihal).toBe('Undangan rapat');
    });

    it('bidang bersarang (disposisi.instruksi) ikut dipertahankan', () => {
        expect(jalankan({ disposisi: { instruksi: 'a\nb', targets: [{ unitKerjaId: ' dir_bppt ' }] } }))
            .toEqual({ disposisi: { instruksi: 'a\nb', targets: [{ unitKerjaId: 'dir_bppt' }] } });
    });
});
```

Ubah `backend/src/__tests__/update-contracts.schemas.test.ts:37-41` menjadi:

```ts
    it('ignores surat masuk status because it is derived server-side (P3)', () => {
        expect(updateSuratMasukSchema.parse({ status: 'sudah_dibalas' })).toEqual({});
        expect(updateArsipVitalSchema.parse({ statusProteksi: 'terlindungi' })).toEqual({ statusProteksi: 'terlindungi' });
        expect(updateArsipTerjagaSchema.safeParse({ statusPelaporan: 'dilaporkan' }).success).toBe(false);
    });
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/rangkaian.schemas.test.ts src/__tests__/sanitize.middleware.test.ts src/__tests__/update-contracts.schemas.test.ts`
Expected: FAIL — `disposisiRoutingSchema` tidak diekspor, `MULTILINE_FIELDS` undefined, status masih diterima.

- [ ] **Step 3: Implementasi skema**

Tambah impor di kepala `backend/src/validators/schemas.ts`:

```ts
import { jakartaDate } from '../utils/jakarta-date.js';
```

Sisipkan **sebelum** `// Surat Masuk schemas` (±baris 101):

```ts
// ==================== Rangkaian surat (P3) ====================

/** Multipart mengirim objek bersarang sebagai JSON string; bentuk JSON diterima, selain itu apa adanya. */
function parseJsonObjectString(value: unknown) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) return value;
    try {
        return JSON.parse(trimmed);
    } catch {
        return value;
    }
}

const alasanText = z.string().trim().min(10, 'Alasan minimal 10 karakter').max(2000);
export const alasanSchema = z.object({ alasan: alasanText }).strict();

const batasWaktuSchema = dateSchema.refine((value) => value >= jakartaDate(), 'Batas waktu tidak boleh sebelum hari ini');

export const disposisiTargetSchema = z.object({
    unitKerjaId: z.string().trim().min(1).max(50),
    batasWaktu: batasWaktuSchema.nullish(),
    penanggungJawab: z.boolean().optional().default(false),
}).strict();

export const disposisiTargetsSchema = z.array(disposisiTargetSchema)
    .min(1, 'Pilih minimal satu unit tujuan')
    .max(10)
    .superRefine((targets, ctx) => {
        const ids = targets.map((target) => target.unitKerjaId);
        if (new Set(ids).size !== ids.length) {
            ctx.addIssue({ code: 'custom', message: 'Unit tujuan disposisi tidak boleh ganda' });
        }
        if (targets.filter((target) => target.penanggungJawab).length > 1) {
            ctx.addIssue({ code: 'custom', message: 'Penanggung jawab (Unit Pengolah) hanya boleh satu' });
        }
    });

export const disposisiRoutingSchema = z.object({
    targets: disposisiTargetsSchema,
    instruksi: z.string().trim().max(2000).nullish(),
    labelTambahan: z.array(z.string().trim().min(1).max(100)).max(10).optional(),
}).strict();
export type DisposisiRoutingInput = z.infer<typeof disposisiRoutingSchema>;

const legacyDisposisiLabels = z.union([z.string(), z.array(z.string())])
    .transform((value) => {
        if (Array.isArray(value)) return value;
        if (!value) return undefined;
        return [value];
    });

export const tindakLanjutInputSchema = z.object({
    jenis: z.enum(['surat_masuk', 'surat_keluar']),
    suratId: uuidSchema,
    jenisRelasi: z.enum(['balasan', 'tindak_lanjut', 'menjelaskan', 'merujuk']),
    distribusiId: uuidSchema.optional(),
}).strict();
export type TindakLanjutInput = z.infer<typeof tindakLanjutInputSchema>;
```

Di `createSuratMasukSchema`, ganti blok `disposisi: z.union(...)...optional(),` (baris 115-121) dengan:

```ts
    disposisi: z.preprocess(parseJsonObjectString, z.union([disposisiRoutingSchema, legacyDisposisiLabels])).optional(),
    referensi: z.preprocess(parseJsonObjectString, z.object({
        jenis: z.literal('surat_keluar'),
        id: uuidSchema,
    }).strict()).optional(),
```

Ganti `updateSuratMasukSchema` (baris 135-137) dengan:

```ts
// Zod 4 applies inner defaults even through partial(). Status surat masuk kini
// diturunkan server (§8), sehingga tidak lagi dapat diubah lewat PUT.
export const updateSuratMasukSchema = createSuratMasukSchema.partial()
    .omit({ unitKerjaId: true, status: true, disposisi: true, referensi: true })
    .extend({
        disposisi: legacyDisposisiLabels.optional(),
        alasan: alasanText.optional(),
    });
```

Di `suratKeluarBaseSchema` (setelah `balasanUntuk: ...`, baris 167) tambah:

```ts
    asalNaskah: z.enum(['inisiatif', 'tindak_lanjut']).optional(),
    tindakLanjut: z.preprocess(parseJsonObjectString, tindakLanjutInputSchema).optional(),
```

Ganti `createSuratKeluarSchema` dan `updateSuratKeluarSchema` (baris 179-206) dengan:

```ts
export const createSuratKeluarSchema = suratKeluarBaseSchema
    .extend({
        klasifikasiKeamanan: z.enum(['biasa', 'terbatas', 'rahasia', 'sangat_rahasia']).default('biasa'),
    })
    .superRefine((value, ctx) => {
        const effectiveNumberingMode = value.numberingMode
            ?? (value.nomorSurat ? 'manual' : 'auto');
        if (effectiveNumberingMode === 'auto' && value.nomorSurat) {
            ctx.addIssue({ code: 'custom', path: ['nomorSurat'], message: 'Nomor preview tidak boleh dikirim pada mode penomoran otomatis' });
        }
        if (effectiveNumberingMode === 'manual' && !value.nomorSurat) {
            ctx.addIssue({ code: 'custom', path: ['nomorSurat'], message: 'Nomor surat wajib diisi pada mode manual' });
        }
        const punyaInduk = Boolean(value.tindakLanjut || value.balasanUntuk);
        if (value.asalNaskah === 'inisiatif' && punyaInduk) {
            ctx.addIssue({ code: 'custom', path: ['asalNaskah'], message: 'Surat inisiatif tidak boleh memiliki surat induk' });
        }
        if (value.asalNaskah === 'tindak_lanjut' && !punyaInduk) {
            ctx.addIssue({ code: 'custom', path: ['tindakLanjut'], message: 'Tindak lanjut memerlukan surat induk' });
        }
        if (value.tindakLanjut && value.balasanUntuk && value.tindakLanjut.suratId !== value.balasanUntuk) {
            ctx.addIssue({ code: 'custom', path: ['balasanUntuk'], message: 'balasanUntuk harus sama dengan surat induk tindak lanjut' });
        }
    })
    .transform(({ balasanUntuk, ...value }) => {
        const tindakLanjut = value.tindakLanjut
            ?? (balasanUntuk ? { jenis: 'surat_masuk' as const, suratId: balasanUntuk, jenisRelasi: 'balasan' as const } : undefined);
        return { ...value, tindakLanjut, asalNaskah: tindakLanjut ? 'tindak_lanjut' as const : value.asalNaskah };
    });

export const updateSuratKeluarSchema = suratKeluarBaseSchema
    .omit({ unitKerjaId: true, numberingMode: true, asalNaskah: true, tindakLanjut: true })
    .partial();
```

Ganti blok distribusi (baris 553-572) dengan:

```ts
export const createDistributionSchema = z.object({
    suratMasukId: uuidSchema,
    sourceUnitId: z.string().min(1, 'Source unit is required').max(50),
    targetUnitId: z.string().min(1, 'Target unit is required').max(50).optional(),
    instruction: z.string().max(2000).nullish(),
    ccUnits: z.array(z.string().max(50)).optional(),
    batasWaktu: batasWaktuSchema.nullish(),
    penanggungJawab: z.boolean().optional(),
    targets: disposisiTargetsSchema.optional(),
}).superRefine((value, ctx) => {
    if (Boolean(value.targetUnitId) === Boolean(value.targets)) {
        ctx.addIssue({ code: 'custom', path: ['targets'], message: 'Isi salah satu: targetUnitId atau targets' });
    }
}).transform((value) => ({
    suratMasukId: value.suratMasukId,
    sourceUnitId: value.sourceUnitId,
    instruksi: value.instruction ?? null,
    ccUnits: value.ccUnits,
    bentuk: value.targets ? 'jamak' as const : 'tunggal' as const,
    targets: value.targets ?? [{
        unitKerjaId: value.targetUnitId as string,
        batasWaktu: value.batasWaktu ?? null,
        penanggungJawab: value.penanggungJawab ?? false,
    }],
}));

export const rejectDistributionSchema = z.object({
    reason: z.string().min(1, 'Alasan penolakan harus diisi').max(2000),
});

export const processDistributionSchema = z.union([
    z.object({ penyelesaianSuratKeluarId: uuidSchema }).strict(),
    z.object({ catatanPenyelesaian: z.string().trim().min(10, 'Catatan penyelesaian minimal 10 karakter').max(2000) }).strict(),
]);
export type ProcessDistributionInput = z.infer<typeof processDistributionSchema>;

export const queryDistributionSchema = paginationSchema.extend({
    unitKerjaId: z.string().max(50).optional(),
    status: z.enum(['sent', 'received', 'processed', 'rejected']).optional(),
});

export type CreateDistribution = z.infer<typeof createDistributionSchema>;
export type RejectDistribution = z.infer<typeof rejectDistributionSchema>;
export type QueryDistribution = z.infer<typeof queryDistributionSchema>;

export const selesaiRangkaianSchema = z.object({ catatan: alasanText }).strict();
export const berkaskanSchema = z.object({
    unitPengolahId: z.string().trim().min(1).max(50),
    klasifikasiItemId: z.coerce.number().int().positive(),
    konfirmasi: z.literal(true, { message: 'Konfirmasi dua langkah wajib' }),
    catatan: z.string().trim().max(2000).optional(),
}).strict();
export const unitPengolahSchema = z.object({ unitPengolahId: z.string().trim().min(1).max(50) }).strict();
export const tautanSchema = z.object({
    jenis: z.enum(['surat_masuk', 'surat_keluar']),
    suratId: uuidSchema,
    keAnggotaId: uuidSchema,
    jenisRelasi: z.enum(['balasan', 'tindak_lanjut', 'menjelaskan', 'merujuk']),
    keterangan: z.string().trim().max(2000).nullish(),
}).strict();
export const gabungSchema = z.object({ sumberId: uuidSchema, alasan: alasanText }).strict();
export const ajukanAksesSchema = z.object({
    purpose: z.string().trim().min(20, 'Tujuan akses minimal 20 karakter').max(2000),
    accessMode: z.enum(['view', 'download']).default('view'),
}).strict();
```

(`lacakQuerySchema` dari Task 4 tetap di bawahnya.)

- [ ] **Step 4: Implementasi `MULTILINE_FIELDS` dan instruksi statis**

Di `backend/src/middlewares/sanitize.middleware.ts`, ganti baris `const SKIP_FIELDS ...` sampai akhir fungsi `sanitizeValue` dengan:

```ts
const SKIP_FIELDS = new Set(['extractedText', 'password', 'currentPassword', 'newPassword']);

/** Bidang catatan/instruksi: tag tetap dibuang, baris baru dipertahankan (§5). */
export const MULTILINE_FIELDS: ReadonlySet<string> = new Set([
    'instruction', 'instruksi', 'catatan', 'catatanPenyelesaian', 'alasan', 'keterangan',
]);

function encodeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

function stripTags(str: string): string {
    return str.replace(/<[^>]*>/g, '');
}

function normalizeMultiline(value: string): string {
    return value
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function sanitizeValue(value: any, key?: string): any {
    if (key && SKIP_FIELDS.has(key)) {
        return value;
    }

    if (typeof value === 'string') {
        const stripped = stripTags(value);
        return key && MULTILINE_FIELDS.has(key)
            ? normalizeMultiline(stripped)
            : stripped.replace(/\s+/g, ' ').trim();
    }

    if (Array.isArray(value)) {
        return value.map((item) => sanitizeValue(item));
    }

    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
        const sanitized: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) {
            sanitized[k] = sanitizeValue(v, k);
        }
        return sanitized;
    }

    return value;
}
```

(`encodeHtml` dipertahankan apa adanya meski tidak dipakai, seperti sebelumnya.)

```ts
// backend/src/config/instruksi-disposisi.ts
/** Chip instruksi cepat disposisi (statis, §7). Teks bebas tetap boleh ditambahkan. */
export const INSTRUKSI_DISPOSISI: readonly string[] = Object.freeze([
    'Mohon ditindaklanjuti sesuai ketentuan',
    'Untuk diketahui',
    'Mohon dikoordinasikan',
    'Mohon disiapkan konsep jawaban',
    'Mohon dihadiri atau diwakili',
    'Mohon kajian dan saran',
    'Untuk diproses lebih lanjut',
    'Untuk diarsipkan',
]);
```

- [ ] **Step 5: Jalankan test, pastikan lulus (termasuk skema lama)**

Run: `cd backend && npx vitest run src/__tests__/rangkaian.schemas.test.ts src/__tests__/sanitize.middleware.test.ts src/__tests__/update-contracts.schemas.test.ts src/__tests__/schemas.test.ts`
Expected: PASS. Bila `schemas.test.ts` punya ekspektasi `balasanUntuk` pada output `createSuratKeluarSchema`, ubah ekspektasinya ke `tindakLanjut: { jenis: 'surat_masuk', suratId, jenisRelasi: 'balasan' }` (perilaku baru yang disengaja).

- [ ] **Step 6: Commit**

```bash
git add backend/src/validators/schemas.ts backend/src/middlewares/sanitize.middleware.ts backend/src/config/instruksi-disposisi.ts backend/src/__tests__/rangkaian.schemas.test.ts backend/src/__tests__/sanitize.middleware.test.ts backend/src/__tests__/update-contracts.schemas.test.ts backend/src/__tests__/schemas.test.ts
git commit -m "feat(rangkaian): skema disposisi multi-target, tindak lanjut, penyelesaian dan MULTILINE_FIELDS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


#### Amandemen pra-eksekusi Task 5 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


**Files: change**
- `schemas.ts:160-206` (surat keluar block) → **not modified in T5**; moved to Task 8.
- `schemas.ts:553-572` → only add `processDistributionSchema` and the P3 standalone schemas. The `createDistributionSchema` replacement moves to Task 7.
- Add to Step 5's run list: `backend/src/__tests__/distribution-create-validation.routes.test.ts` (must stay green, unchanged).

**Skip these plan edits in T5** [T5-1]:
- **plan:1788-1794:** the `asalNaskah`/`tindakLanjut` additions to `suratKeluarBaseSchema`. These move to Task 8.
- **plan:1796-1831:** the replacement of `createSuratKeluarSchema`/`updateSuratKeluarSchema`. Moves to Task 8.
- **plan:1834-1861, the `createDistributionSchema` part only.** Keep the current `createDistributionSchema` (it still outputs `targetUnitId`/`instruction`). Still add `processDistributionSchema` (plan:1867-1871) and keep `rejectDistributionSchema`. Leave `export type CreateDistribution` as is; it changes in Task 7.
- **Test file `rangkaian.schemas.test.ts`:**
  - Delete `describe('skema surat keluar', …)` (plan:1590-1612); it moves to Task 8, Step 1.
  - From `describe('skema distribusi', …)` (plan:1614-1632), keep only `it('penyelesaian: surat keluar ATAU catatan ≥10 karakter', …)`. The two `createDistributionSchema` cases move to Task 7, Step 1.
  - Remove `createSuratKeluarSchema, createDistributionSchema` from the import list.
- **`schemas.test.ts`:** do not touch it in T5.

**Keep in T5:**
- `batasWaktuSchema`, `alasanText`/`alasanSchema`, `disposisiTargetSchema`/`disposisiTargetsSchema`, `disposisiRoutingSchema`, `tindakLanjutInputSchema` + `TindakLanjutInput`.
- The surat masuk block changes (`createSuratMasukSchema.disposisi|referensi`, `updateSuratMasukSchema` without `status` but with `alasan`).
- `processDistributionSchema` + `ProcessDistributionInput`, `selesaiRangkaianSchema`, `berkaskanSchema`, `unitPengolahSchema`, `tautanSchema`, `gabungSchema`, `ajukanAksesSchema`, `MULTILINE_FIELDS`, `INSTRUKSI_DISPOSISI`.

**Normalize `instruksi` in `disposisiRoutingSchema`.** Multipart registration bodies are parsed by multer after the global sanitizer (`backend/src/routes/surat-masuk.routes.ts:224-233`), so `MULTILINE_FIELDS` never sees them [T5-3]:

```ts
instruksi: z.string().max(2000).transform((v) => v.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()).nullish(),
```

Add a test: `disposisiRoutingSchema.parse({ targets: [{ unitKerjaId: 'dir_bppt' }], instruksi: 'A\r\n\r\n\r\nB ' }).instruksi === 'A\n\nB'`.

**Replace the Step 5 command with:**

```
cd backend && npx tsc --noEmit -p tsconfig.json && npx vitest run
```

Expected: PASS. At this commit POST `/api/distributions` and surat keluar create still use the old shapes. [T5-2]

---



### Task 6: Jalur grant via rangkaian (Ajukan Akses) dan grant disposisi terkendali

**Files:**
- Create: `backend/src/services/rangkaian/grant-eligibility.ts`
- Create: `backend/src/services/rangkaian/disposisi-grant.service.ts`
- Modify: `backend/src/services/record-access-grant.service.ts:1-20` (impor), `:270-281` (re-check persetujuan), tambah metode `requestViaRangkaian` setelah `request` (±baris 165)
- Modify: `backend/src/routes/rangkaian.routes.ts` (route `POST /anggota/:anggotaId/ajukan-akses`)
- Modify: `backend/src/middlewares/demo-access.middleware.ts` (allowlist)
- Modify: `backend/src/__tests__/record-access-grant.service.test.ts` (mock `grant-eligibility`)
- Test: `backend/src/__tests__/ajukan-akses.routes.test.ts`, `backend/integration/ajukan-akses.postgres.test.ts`

**Interfaces:**
- Consumes: `isAllowedForRecordUnit`, `normalizeSecurityClassification`, `requiresExplicitAccessGrant`, `isPengawas`, `isPengawasRecordUnit`, `loadJangkauan`, `isAjukanAksesEnabled`, `aktor` (deps); `rowsOf`, `isFullAdmin`, `unitEfektif` (Task 1); `ajukanAksesSchema` (Task 5); `rangkaianService.ensureForSuratMasuk/attach` (P1, fixture).
- Produces: `isGrantEligible(executor, user, ref: { type: RecordEntityType; id: string; unitKerjaId: string }): Promise<boolean>`; `recordAccessGrantService.requestViaRangkaian(user, anggotaId, { purpose, accessMode }, auditContext?, tx?)`; `disposisiGrantService.ajukan(tx, input, audit?) : Promise<string[]>` dengan `input = { distribusiId; suratMasukId; suratUnitKerjaId; classification; targetUnitId; requesterId; rangkaianKode }`; `disposisiGrantService.cabut(tx, { distribusiId; actorId; alasan }, audit?): Promise<number>`; `disposisiGrantPrefix(distribusiId)`.

- [ ] **Step 1: Tulis test route yang gagal**

```ts
// backend/src/__tests__/ajukan-akses.routes.test.ts
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requestViaRangkaian: vi.fn() }));
vi.mock('../config/database', () => ({ db: {} }));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { id: 'user-bppt', email: 'b@example.test', name: 'B', role: 'admin_unit', unitKerjaId: 'dir_bppt' };
        next();
    },
}));
vi.mock('../services/record-access-grant.service.js', () => ({
    recordAccessGrantService: { requestViaRangkaian: mocks.requestViaRangkaian },
    default: { requestViaRangkaian: mocks.requestViaRangkaian },
}));

const { default: rangkaianRouter } = await import('../routes/rangkaian.routes');
const app = express();
app.use(express.json());
app.use('/api/rangkaian', rangkaianRouter);
app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ error: error.message }));

const ANGGOTA = '550e8400-e29b-41d4-a716-446655440000';
const body = { purpose: 'Menindaklanjuti disposisi TU atas surat ini' };

describe('POST /api/rangkaian/anggota/:anggotaId/ajukan-akses', () => {
    beforeEach(() => mocks.requestViaRangkaian.mockReset().mockResolvedValue({ id: 'grant-1', status: 'pending' }));
    afterEach(() => { delete process.env.RANGKAIAN_AJUKAN_AKSES; });

    it('404 selama flag RANGKAIAN_AJUKAN_AKSES mati', async () => {
        await request(app).post(`/api/rangkaian/anggota/${ANGGOTA}/ajukan-akses`).send(body).expect(404);
        expect(mocks.requestViaRangkaian).not.toHaveBeenCalled();
    });

    it('201 dan meneruskan anggota + tujuan ketika flag menyala', async () => {
        process.env.RANGKAIAN_AJUKAN_AKSES = 'true';
        const res = await request(app).post(`/api/rangkaian/anggota/${ANGGOTA}/ajukan-akses`).send(body).expect(201);
        expect(res.body.data).toEqual({ id: 'grant-1', status: 'pending' });
        expect(mocks.requestViaRangkaian).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'user-bppt' }), ANGGOTA,
            { purpose: body.purpose, accessMode: 'view' }, expect.objectContaining({ userId: 'user-bppt' }),
        );
    });

    it('400 untuk tujuan < 20 karakter atau id bukan UUID', async () => {
        process.env.RANGKAIAN_AJUKAN_AKSES = 'true';
        await request(app).post(`/api/rangkaian/anggota/${ANGGOTA}/ajukan-akses`).send({ purpose: 'singkat' }).expect(400);
        await request(app).post('/api/rangkaian/anggota/bukan-uuid/ajukan-akses').send(body).expect(400);
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/ajukan-akses.routes.test.ts`
Expected: FAIL — route belum ada (404 untuk semua kasus kecuali kasus pertama, `toHaveBeenCalledWith` gagal).

- [ ] **Step 3: Implementasi predikat eligibility dan `requestViaRangkaian`**

```ts
// backend/src/services/rangkaian/grant-eligibility.ts
import { sql } from 'drizzle-orm';
import {
    isAllowedForRecordUnit, isPengawas, isPengawasRecordUnit, loadJangkauan,
    type Executor, type RecordEntityType, type RecordUser,
} from './deps.js';
import { isFullAdmin, unitEfektif } from './roles.js';
import { rowsOf } from './sql-rows.js';

/**
 * Predikat tunggal untuk PENGAJUAN dan RE-CHECK PERSETUJUAN grant (§4.11):
 * unit pemilik ∨ pengawas (unit rekaman ∈ ditjen/sesditjen/dir_*) ∨ unit efektif
 * dalam jangkauan rangkaian yang MASIH HIDUP (dihitung ulang, tidak di-cache).
 */
export async function isGrantEligible(
    executor: Executor,
    user: RecordUser,
    ref: { type: RecordEntityType; id: string; unitKerjaId: string },
): Promise<boolean> {
    if (isAllowedForRecordUnit(user, ref.unitKerjaId)) return true;
    if (ref.type === 'arsip' || !isFullAdmin(user)) return false;
    if (isPengawasRecordUnit(ref.unitKerjaId) && await isPengawas(user, executor)) return true;
    const unit = unitEfektif(user);
    if (!unit) return false;
    const kolom = ref.type === 'surat_masuk' ? sql.raw('surat_masuk_id') : sql.raw('surat_keluar_id');
    const [anggota] = rowsOf<{ rangkaian_id: string }>(await (executor as any).execute(
        sql`SELECT rangkaian_id FROM rangkaian_anggota WHERE ${kolom} = ${ref.id} LIMIT 1`,
    ));
    if (!anggota) return false;
    return (await loadJangkauan(executor, anggota.rangkaian_id)).includes(unit);
}
```

Di `backend/src/services/record-access-grant.service.ts`:

1. Tambah impor setelah baris 19:

```ts
import { isGrantEligible } from './rangkaian/grant-eligibility.js';
import { rowsOf } from './rangkaian/sql-rows.js';
```

2. Ganti kondisi re-check persetujuan (baris 277-282) dengan:

```ts
            if (
                !targetUser?.isActive ||
                !(await isGrantEligible(tx, targetUser, {
                    type: request.entityType as RecordEntityType,
                    id: request.entityId,
                    unitKerjaId: request.unitKerjaId,
                }))
            ) {
                throw new ConflictError('Mandat unit atau status pengguna telah berubah.');
            }
```

3. Tambah metode setelah `request(...)` (sebelum `listMine`):

```ts
    /**
     * Ajukan grant untuk node tersamar dalam rangkaian (§4.11). `inspect()` tidak
     * dipakai karena mensyaratkan unit pemilik; gerbangnya `isGrantEligible`, sama
     * persis dengan re-check persetujuan.
     */
    async requestViaRangkaian(
        user: RecordUser,
        anggotaId: string,
        input: { purpose: string; accessMode: 'view' | 'download' },
        auditContext?: CriticalAuditContext,
        outerTx?: any,
    ) {
        if (!user.id) throw new ForbiddenError();
        const run = async (tx: any) => {
            await expireStaleGrants(tx, auditContext);
            const [ref] = rowsOf<{ type: 'surat_masuk' | 'surat_keluar'; id: string; unit_kerja_id: string; classification: string | null }>(
                await tx.execute(sql`
                    SELECT CASE WHEN a.surat_masuk_id IS NOT NULL THEN 'surat_masuk' ELSE 'surat_keluar' END AS type,
                           coalesce(a.surat_masuk_id, a.surat_keluar_id) AS id,
                           coalesce(sm.unit_kerja_id, sk.unit_kerja_id) AS unit_kerja_id,
                           CASE WHEN a.surat_masuk_id IS NOT NULL THEN sm.sifat_surat
                                ELSE coalesce(sk.klasifikasi_keamanan, 'terbatas') END AS classification
                      FROM rangkaian_anggota a
                      LEFT JOIN surat_masuk sm ON sm.id = a.surat_masuk_id
                      LEFT JOIN surat_keluar sk ON sk.id = a.surat_keluar_id
                     WHERE a.id = ${anggotaId}
                       AND coalesce(sm.is_deleted, sk.is_deleted) IS NOT TRUE`),
            );
            if (!ref || !(await isGrantEligible(tx, user, { type: ref.type, id: ref.id, unitKerjaId: ref.unit_kerja_id }))) {
                throw new NotFoundError('Rekod');
            }
            const classification = normalizeSecurityClassification(ref.classification);
            if (!requiresExplicitAccessGrant(classification)) {
                throw new ConflictError('Rekod ini tidak memerlukan persetujuan akses khusus.');
            }
            const [existing] = await tx
                .select({ id: recordAccessGrants.id, status: recordAccessGrants.status })
                .from(recordAccessGrants)
                .where(and(
                    eq(recordAccessGrants.targetUserId, user.id!),
                    eq(recordAccessGrants.entityType, ref.type),
                    eq(recordAccessGrants.entityId, ref.id),
                    inArray(recordAccessGrants.status, ['pending', 'approved']),
                ))
                .limit(1);
            if (existing) {
                throw new ConflictError(existing.status === 'approved'
                    ? 'Akses aktif untuk rekod ini masih berlaku.'
                    : 'Permohonan akses untuk rekod ini masih menunggu keputusan.');
            }
            const [created] = await tx
                .insert(recordAccessGrants)
                .values({
                    requesterId: user.id!,
                    targetUserId: user.id!,
                    entityType: ref.type,
                    entityId: ref.id,
                    unitKerjaId: ref.unit_kerja_id,
                    requiredClassification: classification,
                    purpose: input.purpose.trim(),
                    accessMode: input.accessMode,
                    status: 'pending',
                })
                .returning();
            if (!created) throw new ConflictError('Permohonan akses gagal dibuat.');
            if (auditContext) {
                await auditLogService.logActionOrThrow({
                    ...auditContext,
                    action: 'request_access',
                    entityType: 'record_access_grant',
                    entityId: created.id,
                    changes: {
                        entityType: created.entityType, entityId: created.entityId, unitKerjaId: created.unitKerjaId,
                        requiredClassification: created.requiredClassification, purpose: created.purpose,
                        accessMode: created.accessMode, via: 'rangkaian', anggotaId,
                    },
                }, tx);
            }
            return created;
        };
        return outerTx
            ? run(outerTx)
            : withUniqueConflict(() => db.transaction(run), 'Permohonan aktif untuk rekod ini sudah ada. Muat ulang data.');
    },
```

Di `backend/src/__tests__/record-access-grant.service.test.ts`, tambahkan setelah `vi.mock('../config/database', ...)` yang sudah ada (agar Proxy mock tidak perlu `execute`):

```ts
vi.mock('../services/rangkaian/grant-eligibility.js', async () => {
    const actual = await vi.importActual<typeof import('../services/record-access.service')>('../services/record-access.service');
    return { isGrantEligible: vi.fn(async (_tx: unknown, user: any, ref: any) => actual.isAllowedForRecordUnit(user, ref.unitKerjaId)) };
});
```

- [ ] **Step 4: Implementasi grant disposisi**

```ts
// backend/src/services/rangkaian/disposisi-grant.service.ts
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { recordAccessGrants } from '../../db/schema/index.js';
import auditLogService, { type CriticalAuditContext } from '../audit-log.service.js';
import type { Tx } from './deps.js';
import { rowsOf } from './sql-rows.js';

export const disposisiGrantPrefix = (distribusiId: string) => `[disposisi:${distribusiId}]`;

export const disposisiGrantService = {
    /**
     * §4.12(a): disposisi surat terkendali mengajukan grant 'view' bertujuan
     * disposisi untuk setiap admin aktif unit target, terikat unit rekaman.
     * Persetujuan tetap oleh super_admin lewat alur grant yang ada.
     */
    async ajukan(tx: Tx, input: {
        distribusiId: string; suratMasukId: string; suratUnitKerjaId: string; classification: string;
        targetUnitId: string; requesterId: string; rangkaianKode: string;
    }, audit?: CriticalAuditContext): Promise<string[]> {
        const penerima = rowsOf<{ id: string }>(await tx.execute(sql`
            SELECT id FROM users
             WHERE is_active = true
               AND ((role = 'admin_unit' AND unit_kerja_id = ${input.targetUnitId})
                 OR (role = 'admin_dirjen' AND ${input.targetUnitId} = 'ditjen')
                 OR (role = 'admin_sesditjen' AND ${input.targetUnitId} = 'sesditjen'))
             ORDER BY id`));
        const purpose = `${disposisiGrantPrefix(input.distribusiId)} Tindak lanjut disposisi surat masuk dalam rangkaian ${input.rangkaianKode}`;
        const dibuat: string[] = [];
        for (const { id: targetUserId } of penerima) {
            const [aktif] = await tx.select({ id: recordAccessGrants.id }).from(recordAccessGrants).where(and(
                eq(recordAccessGrants.targetUserId, targetUserId),
                eq(recordAccessGrants.entityType, 'surat_masuk'),
                eq(recordAccessGrants.entityId, input.suratMasukId),
                inArray(recordAccessGrants.status, ['pending', 'approved']),
            )).limit(1);
            if (aktif) continue;
            const [grant] = await tx.insert(recordAccessGrants).values({
                requesterId: input.requesterId,
                targetUserId,
                entityType: 'surat_masuk',
                entityId: input.suratMasukId,
                unitKerjaId: input.suratUnitKerjaId,
                requiredClassification: input.classification,
                purpose,
                accessMode: 'view',
                status: 'pending',
            }).returning({ id: recordAccessGrants.id });
            dibuat.push(grant.id);
            if (audit) {
                await auditLogService.logActionOrThrow({
                    ...audit, action: 'request_access', entityType: 'record_access_grant', entityId: grant.id,
                    changes: { via: 'disposisi', distribusiId: input.distribusiId, targetUserId, entityId: input.suratMasukId },
                }, tx);
            }
        }
        return dibuat;
    },

    /** Dicabut di transaksi process()/reject()/tutup: approved → revoked, pending → denied. */
    async cabut(tx: Tx, input: { distribusiId: string; actorId: string; alasan: string }, audit?: CriticalAuditContext): Promise<number> {
        const now = new Date();
        const pola = `${disposisiGrantPrefix(input.distribusiId)}%`;
        const alasan = input.alasan.trim();
        const revoked = await tx.update(recordAccessGrants)
            .set({ status: 'revoked', revokedBy: input.actorId, revokedAt: now, revocationReason: alasan, updatedAt: now })
            .where(and(eq(recordAccessGrants.status, 'approved'), like(recordAccessGrants.purpose, pola)))
            .returning({ id: recordAccessGrants.id });
        const denied = await tx.update(recordAccessGrants)
            .set({ status: 'denied', decidedBy: input.actorId, decidedAt: now, decisionReason: alasan, updatedAt: now })
            .where(and(eq(recordAccessGrants.status, 'pending'), like(recordAccessGrants.purpose, pola)))
            .returning({ id: recordAccessGrants.id });
        if (audit) {
            for (const { id } of revoked) {
                await auditLogService.logActionOrThrow({ ...audit, action: 'revoke_access', entityType: 'record_access_grant', entityId: id,
                    changes: { via: 'disposisi', distribusiId: input.distribusiId, reason: alasan } }, tx);
            }
            for (const { id } of denied) {
                await auditLogService.logActionOrThrow({ ...audit, action: 'deny_access', entityType: 'record_access_grant', entityId: id,
                    changes: { via: 'disposisi', distribusiId: input.distribusiId, reason: alasan } }, tx);
            }
        }
        return revoked.length + denied.length;
    },
};
```

- [ ] **Step 5: Route dan allowlist**

Di `backend/src/routes/rangkaian.routes.ts` tambahkan (impor di kepala berkas, route setelah `/lacak`):

```ts
import { canWriteMiddleware } from '../middlewares/role.middleware';
import { validateBody, validateIdParam } from '../middlewares/validate.middleware';
import { ajukanAksesSchema } from '../validators/schemas';
import { isAjukanAksesEnabled } from '../services/rangkaian/deps.js';
import { recordAccessGrantService } from '../services/record-access-grant.service.js';

const auditOf = (req: AuthRequest) => ({ userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip });

router.post('/anggota/:anggotaId/ajukan-akses', validateIdParam('anggotaId'), canWriteMiddleware(), validateBody(ajukanAksesSchema),
    async (req: AuthRequest, res, next) => {
        try {
            if (!isAjukanAksesEnabled()) return res.status(404).json({ error: 'Fitur Ajukan Akses belum diaktifkan' });
            const grant = await recordAccessGrantService.requestViaRangkaian(
                req.user!, req.params.anggotaId as string, req.body, auditOf(req));
            res.status(201).json({ success: true, data: grant });
        } catch (error) {
            next(error);
        }
    });
```

Di `demo-access.middleware.ts` (setelah entri `/rangkaian/lacak`):

```ts
    { methods: POST, path: exact(`/rangkaian/anggota/${UUID}/ajukan-akses`) },
```

dan tambahkan `['POST', \`/api/rangkaian/anggota/${id}/ajukan-akses\`],` ke `it.each` allowlist di `demo-access.middleware.test.ts`.

- [ ] **Step 6: Jalankan test unit, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/ajukan-akses.routes.test.ts src/__tests__/record-access-grant.service.test.ts src/__tests__/record-access-grant.routes.test.ts src/__tests__/demo-access.middleware.test.ts`
Expected: PASS.

- [ ] **Step 7: Tulis matriks Ajukan Akses di Postgres**

```ts
// backend/integration/ajukan-akses.postgres.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

const state = vi.hoisted(() => ({ db: null as any }));
const proxy = () => ({ db: new Proxy({}, { get: (_t, key) => {
    const value = state.db?.[key];
    return typeof value === 'function' ? value.bind(state.db) : value;
} }) });
vi.mock('../src/config/database', proxy);
vi.mock('../src/config/database.js', proxy);

const { recordAccessGrantService } = await import('../src/services/record-access-grant.service.js');
const { recordAccessService, rangkaianService, aktor } = await import('../src/services/rangkaian/deps.js');

let h: RangkaianTestDatabase;
let bppt1: TestUser; let bppt2: TestUser; let ptep: TestUser; let superA: TestUser;
let smRahasia: string; let anggotaRahasia: string; let anggotaBiasa: string; let distribusi: string;
const audit = (u: TestUser) => ({ userId: u.id, userEmail: u.email });
const purpose = { purpose: 'Menindaklanjuti disposisi TU atas surat ini', accessMode: 'view' as const };

beforeAll(async () => {
    h = await createRangkaianTestDatabase('ajukanakses');
    state.db = h.db;
    await h.seedUnits();
    bppt1 = await h.seedUser('admin_unit', 'dir_bppt');
    bppt2 = await h.seedUser('admin_unit', 'dir_bppt');
    ptep = await h.seedUser('admin_unit', 'dir_ptep');
    superA = await h.seedUser('super_admin', null);
    smRahasia = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'R-01/2026', sifatSurat: 'Rahasia' });
    const skBiasa = await h.insertSuratKeluar({ unitKerjaId: 'sesditjen', nomorSurat: 'ND-01/2026', approvalStatus: 'approved' });
    let rangkaianId = '';
    await h.db.transaction(async (tx: any) => {
        const r = await rangkaianService.ensureForSuratMasuk(tx, smRahasia, aktor(superA));
        rangkaianId = r.rangkaianId;
        anggotaRahasia = r.anggotaId;
        anggotaBiasa = (await rangkaianService.attach(tx, { rangkaianId, surat: { jenis: 'surat_keluar', id: skBiasa }, keAnggotaId: r.anggotaId, jenisRelasi: 'tindak_lanjut' }, aktor(superA))).anggotaId;
    });
    distribusi = await h.insertDistribusi({ suratMasukId: smRahasia, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', status: 'sent', rangkaianId });
}, 120_000);

afterAll(async () => { await h?.close(); });

describe('matriks Ajukan Akses via rangkaian', () => {
    it('peserta di luar unit pemilik dapat mengajukan; non-peserta mendapat 404', async () => {
        const grant = await recordAccessGrantService.requestViaRangkaian(bppt1, anggotaRahasia, purpose, audit(bppt1));
        expect(grant).toMatchObject({ status: 'pending', unitKerjaId: 'sesditjen', requiredClassification: 'rahasia', entityId: smRahasia });
        await expect(recordAccessGrantService.requestViaRangkaian(ptep, anggotaRahasia, purpose, audit(ptep)))
            .rejects.toMatchObject({ statusCode: 404 });
    });

    it('persetujuan super_admin lalu pembacaan via grant', async () => {
        const [pending] = await h.query<{ id: string }>("SELECT id FROM record_access_grants WHERE target_user_id = $1 AND status = 'pending'", [bppt1.id]);
        await recordAccessGrantService.approve(pending.id, superA.id, 'Disetujui untuk tindak lanjut', new Date(Date.now() + 2 * 3600_000), audit(superA));
        const akses = await recordAccessService.checkRead(bppt1, 'surat_masuk', smRahasia);
        expect(akses).toMatchObject({ allowed: true, mutable: false });
    });

    it('persetujuan ditolak setelah jangkauan dicabut (disposisi ditolak)', async () => {
        const grant = await recordAccessGrantService.requestViaRangkaian(bppt2, anggotaRahasia, purpose, audit(bppt2));
        await h.query("UPDATE surat_distributions SET status = 'rejected', rejection_reason = 'Bukan tugas unit ini' WHERE id = $1", [distribusi]);
        await expect(recordAccessGrantService.approve(grant.id, superA.id, 'Disetujui untuk tindak lanjut', new Date(Date.now() + 3600_000), audit(superA)))
            .rejects.toMatchObject({ statusCode: 409 });
        await h.query("UPDATE record_access_grants SET status = 'denied', decided_by = $2, decided_at = now(), decision_reason = 'Jangkauan sudah dicabut' WHERE id = $1", [grant.id, superA.id]);
        await expect(recordAccessGrantService.requestViaRangkaian(bppt2, anggotaRahasia, purpose, audit(bppt2)))
            .rejects.toMatchObject({ statusCode: 404 });
    });

    it('node biasa tidak memerlukan grant (409)', async () => {
        await h.query("UPDATE surat_distributions SET status = 'sent', rejection_reason = NULL WHERE id = $1", [distribusi]);
        await expect(recordAccessGrantService.requestViaRangkaian(bppt2, anggotaBiasa, purpose, audit(bppt2)))
            .rejects.toMatchObject({ statusCode: 409 });
    });
});
```

- [ ] **Step 8: Jalankan test Postgres, pastikan lulus**

Run: `cd backend && TEST_POSTGRES_URL=postgresql://simsa_test:simsa_test@127.0.0.1:5432/simsa_test npx vitest run --config vitest.postgres.config.ts integration/ajukan-akses.postgres.test.ts`
Expected: PASS (4 test).

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/rangkaian/grant-eligibility.ts backend/src/services/rangkaian/disposisi-grant.service.ts backend/src/services/record-access-grant.service.ts backend/src/routes/rangkaian.routes.ts backend/src/middlewares/demo-access.middleware.ts backend/src/__tests__/ajukan-akses.routes.test.ts backend/src/__tests__/record-access-grant.service.test.ts backend/src/__tests__/demo-access.middleware.test.ts backend/integration/ajukan-akses.postgres.test.ts
git commit -m "feat(rangkaian): Ajukan Akses via rangkaian dan grant disposisi terkendali di balik flag

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


#### Amandemen pra-eksekusi Task 6 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


**Files: change**
- `record-access-grant.service.ts:270-281` → the re-check is at **`:289-294`**. Replace the `isAllowedForRecordUnit(targetUser, request.unitKerjaId)` condition at `:291`. [T6-1]
- Add `backend/src/routes/__tests__/rangkaian.routes.test.ts` to the Step 6 run list.

**Step 5, routes.** Do not paste `import { validateBody, validateIdParam } …`. Merge into `backend/src/routes/rangkaian.routes.ts:3` so it reads `import { validateBody, validateIdParam, validateQuery } from '../middlewares/validate.middleware';`, and merge `canReadMiddleware, canWriteMiddleware` into one `role.middleware` import. [G-IMPORT]

**`disposisiGrantService.cabut`** [T6-2]:
- Signature: `cabut(tx, { distribusiId, suratMasukId, actorId, alasan }, audit?)`.
- Both UPDATEs add `eq(recordAccessGrants.entityType, 'surat_masuk')` and `eq(recordAccessGrants.entityId, input.suratMasukId)` to the purpose `LIKE`.
- At the top:

  ```ts
  if (!input.actorId) throw new ValidationError('Pelaku pencabutan tidak diketahui');
  if (input.alasan.trim().length < 10) throw new ValidationError('Alasan pencabutan minimal 10 karakter');
  ```

- Callers in Tasks 10 and 11 pass `suratMasukId: distribution.suratMasukId`.
- Test: a user-created grant for another SM whose purpose starts with `[disposisi:<id>]` is NOT revoked.

**`requestViaRangkaian`.** Extract the existing-grant check, insert and audit shared with `request()` (`record-access-grant.service.ts:113-167`) into a private `insertPendingGrant(tx, user, ref, input, auditContext, extraChanges)`, and call it from both. Existing `record-access-grant.service.test.ts` expectations stay unchanged. [T6-4]

**Parity test** (add to `integration/ajukan-akses.postgres.test.ts`) [T6-3]. For each fixture ref and user in the matrix, assert:

```ts
(await isGrantEligible(h.db, user, ref)) === ['owner','pengawas','peserta'].includes((await recordAccessService.checkRead(user, ref.type, ref.id, h.db)).via ?? '')
```

Restrict to non-deleted rows.

---


**C-2 (critic) — Tasks 6 and 4: the parity assertion is wrong as written, and `dapatAjukanAkses` must require a controlled class (**BLOCKING for T6**) [C-2]**


The T6-3 assertion (amend:275-281) turns red on the plan's own matrix, which includes `superA` (plan:2394):
- `isGrantEligible` returns `true` whenever `isAllowedForRecordUnit` holds (plan:2099). That includes super_admin (`cocokUnitRekaman` → `semua`, `visibility-spec.ts:247-248`).
- `checkMany` sets `via: 'owner'` only when `owner.allowed` (`record-access.service.ts:403-406`).
- An owner-unit user or super_admin **without** the grant therefore falls through to `jalurJangkauan`. That returns `null` for super_admin and staff, because `unitJangkauan` is `null` (`visibility-spec.ts:270-275`, `record-access.service.ts:408-411`).
- Result: `via` is `null` while eligibility is `true`.

Replace the amend:277-279 assertion with:

```ts
for (const user of matriks) for (const ref of refs) {
    const eligible = await isGrantEligible(h.db, user, ref);
    if (isAllowedForRecordUnit(user, ref.unitKerjaId)) { expect(eligible).toBe(true); continue; }   // owner path = request()
    const { via } = await recordAccessService.checkRead(user, ref.type, ref.id, h.db);
    expect(eligible).toBe(via === 'pengawas' || via === 'peserta');                                 // FR:26 jalurJangkauan parity
}
```

A second problem is that `masked === true` is also set for an **unrecognized** class:
- `kelasBolehDibacaLintasUnit` returns false for it (`visibility-spec.ts:295-303`), so the node is masked and offered.
- `requestViaRangkaian` then answers 409 "tidak memerlukan persetujuan" (plan:2172-2174).

Change the offer in both places where it is computed:
- **T4 `keNode` (amend:184):** use `dapatAjukanAkses: isAjukanAksesEnabled() && a?.masked === true && requiresExplicitAccessGrant(a.classification)`.
- **P2 `getDetail` (`backend/src/services/rangkaian-read.service.ts:398`):** use `samarkanAnggota(row, dapatAjukan && a?.masked === true && requiresExplicitAccessGrant(a?.classification))`. Add this file to T6's Files. It is the source of the panel's `dapatAjukanAkses` that T25 renders.



### Task 7: `distribute()` lewat `ensureForSuratMasuk`, multi-target, aturan terkendali, label kompatibilitas

**Files:**
- Modify: `backend/src/services/distribution.service.ts:1-6` (impor), `:27-102` (ganti `distribute`)
- Modify: `backend/src/routes/distribution.routes.ts:8` (impor), `:57-65` (sisipkan `GET /opsi` sebelum `/inbox`), `:186-223` (POST)
- Modify: `backend/src/middlewares/demo-access.middleware.ts:107` (regex GET distributions)
- Modify: `backend/src/__tests__/distribution.service.test.ts:1-107`, `backend/src/__tests__/distribution-layanan.routes.test.ts:15-26,176-186`
- Test: `backend/integration/disposisi.postgres.test.ts`

**Interfaces:**
- Consumes: `rangkaianService.ensureForSuratMasuk(tx, suratMasukId, actor, { unitPengolahId? })` (P1: mengunci rangkaian, 409 bila `diberkaskan|digabung`), `aktor`, `recomputeRangkaian`, `isAjukanAksesEnabled` (deps); `requiresExplicitAccessGrant`, `normalizeSecurityClassification`; `hasPostgresErrorCode` (`utils/postgres-errors.ts`); `disposisiGrantService.ajukan` (Task 6); `createDistributionSchema` (Task 5); `INSTRUKSI_DISPOSISI`.
- Catatan P1: tanda tangan `distribute(data, auditContext?, tx?)` dan pemetaan 23505 → 400 dari P1 Task 13 dipertahankan; isi fungsi diganti alur P3 di bawah (ensure di semua jalur). Test P1 di `distribution.service.test.ts` yang menguji 23505 dipertahankan dengan antrean disesuaikan urutan query baru.
- Produces: `distributionService.distribute(data: DistributeInput, auditContext?, tx?: Tx): Promise<SuratDistribution>`; `distributionService.distributeMany(data: DistributeManyInput, auditContext?, tx?: Tx): Promise<SuratDistribution[]>`; `SURAT_TERKENDALI_DISPOSISI_MESSAGE`; `GET /api/distributions/opsi → { success, data: { instruksi: string[]; jalurAksesTerkendali: boolean } }`; `POST /api/distributions` menerima `targetUnitId` (lama, respons objek tunggal) atau `targets[]` (respons array).

- [ ] **Step 1: Perbarui test unit distribusi (gagal)**

Di `backend/src/__tests__/distribution.service.test.ts`, ganti blok mock di kepala berkas (baris 1-41) dengan:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Chainable DB Mock ───
const resultQueue: any[] = [];
let transactionCommits = 0;
let transactionRollbacks = 0;
function enqueue(...results: any[]) { resultQueue.push(...results); }

const auditMocks = vi.hoisted(() => ({ logActionOrThrow: vi.fn() }));
const rangkaianMocks = vi.hoisted(() => ({
    ensureForSuratMasuk: vi.fn(),
    lockRangkaian: vi.fn(),
    recomputeRangkaian: vi.fn(),
    recomputeSuratMasuk: vi.fn(),
    checkRead: vi.fn(),
    checkMany: vi.fn(),
    ajukan: vi.fn(),
    cabut: vi.fn(),
}));

const mockChain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') {
            const val = resultQueue.shift() ?? [];
            return (resolve: any, reject: any) => (val instanceof Error ? reject(val) : resolve(val));
        }
        return (..._args: any[]) => mockChain;
    },
});

const mockDb: any = {
    select: (..._a: any[]) => mockChain,
    insert: (..._a: any[]) => mockChain,
    update: (..._a: any[]) => mockChain,
    delete: (..._a: any[]) => mockChain,
    execute: async (..._a: any[]) => resultQueue.shift() ?? [],
    transaction: async (fn: any) => {
        try {
            const result = await fn(mockDb);
            transactionCommits += 1;
            return result;
        } catch (error) {
            transactionRollbacks += 1;
            throw error;
        }
    },
};

vi.mock('../config/database', () => ({ db: mockDb }));
vi.mock('../services/audit-log.service.js', () => ({ default: auditMocks }));
vi.mock('../services/rangkaian/deps.js', () => ({
    rangkaianService: { ensureForSuratMasuk: rangkaianMocks.ensureForSuratMasuk },
    recordAccessService: { checkRead: rangkaianMocks.checkRead, checkMany: rangkaianMocks.checkMany },
    lockRangkaian: rangkaianMocks.lockRangkaian,
    isPengawas: vi.fn(async () => false),
    isAjukanAksesEnabled: () => process.env.RANGKAIAN_AJUKAN_AKSES === 'true',
    aktor: (user: any, audit?: any) => ({ ...(audit ?? {}), userId: audit?.userId ?? user?.id ?? '' }),
    recomputeRangkaian: rangkaianMocks.recomputeRangkaian,
    recomputeSuratMasuk: rangkaianMocks.recomputeSuratMasuk,
}));
vi.mock('../services/rangkaian/disposisi-grant.service.js', () => ({
    disposisiGrantService: { ajukan: rangkaianMocks.ajukan, cabut: rangkaianMocks.cabut },
}));

const { DistributionService, SURAT_TERKENDALI_DISPOSISI_MESSAGE } = await import('../services/distribution.service');
const { ConflictError } = await import('../utils/errors.js');

const SUMBER = { id: 'sm-1', sifatSurat: 'biasa', unitKerjaId: 'ditjen' };
const TARGET = { id: 'unit-1', name: 'Unit 1', unitType: 'direktorat', canReceiveDistribution: true };
```

Ganti `beforeEach` dan blok `describe('distribute', ...)` (baris 43-107) dengan:

```ts
describe('DistributionService', () => {
    let svc: InstanceType<typeof DistributionService>;

    beforeEach(() => {
        svc = new DistributionService();
        resultQueue.length = 0;
        transactionCommits = 0;
        transactionRollbacks = 0;
        auditMocks.logActionOrThrow.mockReset().mockResolvedValue(undefined);
        rangkaianMocks.ensureForSuratMasuk.mockReset().mockResolvedValue({ rangkaianId: 'rs-1', kode: 'RS-2026-000001', anggotaId: 'ra-1', status: 'aktif', created: true });
        rangkaianMocks.lockRangkaian.mockReset().mockResolvedValue([{ id: 'rs-1', kode: 'RS-2026-000001', status: 'aktif' }]);
        rangkaianMocks.recomputeRangkaian.mockReset().mockResolvedValue(undefined);
        rangkaianMocks.recomputeSuratMasuk.mockReset().mockResolvedValue(undefined);
        rangkaianMocks.ajukan.mockReset().mockResolvedValue([]);
        rangkaianMocks.cabut.mockReset().mockResolvedValue(0);
    });
    afterEach(() => { delete process.env.RANGKAIAN_AJUKAN_AKSES; });

    describe('distribute', () => {
        it('membuat disposisi di rangkaian surat masuk dan menambahkan label', async () => {
            enqueue([SUMBER], [TARGET], [], [{ id: 'dist-1', status: 'sent', rangkaianId: 'rs-1' }], []);
            const res = await svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'unit-1' });
            expect(res).toMatchObject({ id: 'dist-1', status: 'sent', rangkaianId: 'rs-1' });
            expect(rangkaianMocks.ensureForSuratMasuk).toHaveBeenCalledWith(mockDb, 'sm-1', { userId: '' }, undefined);
            expect(rangkaianMocks.recomputeRangkaian).toHaveBeenCalledWith(mockDb, 'rs-1', undefined);
            expect(resultQueue).toHaveLength(0);
        });

        it('memakai transaksi luar bila tx diberikan', async () => {
            enqueue([SUMBER], [TARGET], [], [{ id: 'dist-1', status: 'sent' }], []);
            await svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'unit-1' }, undefined, mockDb);
            expect(transactionCommits).toBe(0);
        });

        it('rolls back distribution creation when its critical audit insert fails', async () => {
            enqueue([SUMBER], [TARGET], [], [{ id: 'dist-1', status: 'sent' }], []);
            auditMocks.logActionOrThrow.mockRejectedValueOnce(new Error('audit unavailable'));
            await expect(svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'unit-1' }, { userId: 'user-1' }))
                .rejects.toThrow('audit unavailable');
            expect(transactionCommits).toBe(0);
            expect(transactionRollbacks).toBe(1);
            expect(auditMocks.logActionOrThrow).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'distribute', entityType: 'surat_distribution' }), mockDb);
        });

        it('should throw when already actively distributed to same unit', async () => {
            enqueue([SUMBER], [TARGET], [{ id: 'existing' }]);
            await expect(svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'unit-1' }))
                .rejects.toThrow('sudah didistribusikan');
        });

        it('should fail closed when the source unit does not own the letter', async () => {
            enqueue([]);
            await expect(svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'unit-a', targetUnitId: 'unit-1' }))
                .rejects.toMatchObject({ statusCode: 404 });
        });

        it('menolak unit tujuan yang sama dengan unit sumber', async () => {
            enqueue([SUMBER]);
            await expect(svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'ditjen' }))
                .rejects.toMatchObject({ statusCode: 400 });
        });

        it.each([
            [{ ...TARGET, unitType: 'bagian' }],
            [{ ...TARGET, canReceiveDistribution: false }],
            [undefined],
        ])('menolak unit tujuan yang tidak dapat menerima disposisi %#', async (target) => {
            enqueue([SUMBER], target ? [target] : []);
            await expect(svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'unit-1' }))
                .rejects.toMatchObject({ statusCode: 400 });
            expect(rangkaianMocks.ensureForSuratMasuk).not.toHaveBeenCalled();
        });

        it('409 untuk surat terkendali selama flag Ajukan Akses mati', async () => {
            enqueue([{ ...SUMBER, sifatSurat: 'Rahasia' }], [TARGET]);
            await expect(svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'unit-1' }))
                .rejects.toMatchObject({ statusCode: 409, message: SURAT_TERKENDALI_DISPOSISI_MESSAGE });
            expect(rangkaianMocks.ensureForSuratMasuk).not.toHaveBeenCalled();
        });

        it('flag menyala: grant disposisi diajukan dalam transaksi yang sama', async () => {
            process.env.RANGKAIAN_AJUKAN_AKSES = 'true';
            enqueue([{ ...SUMBER, sifatSurat: 'Rahasia' }], [TARGET], [], [{ id: 'dist-1', status: 'sent' }], []);
            await svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'unit-1', sentBy: 'user-1' });
            expect(rangkaianMocks.ajukan).toHaveBeenCalledWith(mockDb, {
                distribusiId: 'dist-1', suratMasukId: 'sm-1', suratUnitKerjaId: 'ditjen', classification: 'rahasia',
                targetUnitId: 'unit-1', requesterId: 'user-1', rangkaianKode: 'RS-2026-000001',
            }, undefined);
        });

        it('409 bila rangkaian surat sudah diberkaskan (dilempar ensureForSuratMasuk P1)', async () => {
            rangkaianMocks.ensureForSuratMasuk.mockRejectedValueOnce(new ConflictError('Rangkaian sudah diberkaskan'));
            enqueue([SUMBER], [TARGET]);
            await expect(svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'unit-1' }))
                .rejects.toMatchObject({ statusCode: 409 });
        });

        it('penanggung jawab menetapkan unit pengolah rangkaian', async () => {
            enqueue([SUMBER], [TARGET], [], [], [{ id: 'dist-1', status: 'sent', penanggungJawab: true }], [], []);
            await svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'unit-1', penanggungJawab: true, sentBy: 'u-tu' });
            expect(rangkaianMocks.ensureForSuratMasuk).toHaveBeenCalledWith(mockDb, 'sm-1', { userId: 'u-tu' }, { unitPengolahId: 'unit-1' });
            expect(resultQueue).toHaveLength(0);
        });

        it('pelanggaran index aktif (race) dipetakan menjadi 400', async () => {
            const race = Object.assign(new Error('insert gagal'), { cause: { code: '23505', constraint: 'surat_distributions_active_target_uidx' } });
            enqueue([SUMBER], [TARGET], [], race);
            await expect(svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'unit-1' }))
                .rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe('distributeMany', () => {
        it('memakai satu transaksi untuk semua target', async () => {
            enqueue([SUMBER], [TARGET], [], [{ id: 'dist-1' }], []);
            enqueue([SUMBER], [{ ...TARGET, id: 'unit-2', name: 'Unit 2' }], [], [{ id: 'dist-2' }], []);
            const rows = await svc.distributeMany({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen',
                targets: [{ unitKerjaId: 'unit-1' }, { unitKerjaId: 'unit-2' }], instruksi: 'Mohon ditindaklanjuti' });
            expect(rows.map((row: any) => row.id)).toEqual(['dist-1', 'dist-2']);
            expect(transactionCommits).toBe(1);
        });

        it('gagal seluruhnya bila satu target tidak sah', async () => {
            enqueue([SUMBER], [TARGET], [], [{ id: 'dist-1' }], []);
            enqueue([SUMBER], []);
            await expect(svc.distributeMany({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen',
                targets: [{ unitKerjaId: 'unit-1' }, { unitKerjaId: 'bagian_umum' }] })).rejects.toMatchObject({ statusCode: 400 });
            expect(transactionCommits).toBe(0);
            expect(transactionRollbacks).toBe(1);
        });
    });
```

(Sisa berkas — `findInbox`, `receive`, `process`, `reject`, dst. — tidak diubah di task ini.)

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/distribution.service.test.ts`
Expected: FAIL — `SURAT_TERKENDALI_DISPOSISI_MESSAGE` undefined, `distributeMany is not a function`, `ensureForSuratMasuk` tidak dipanggil.

- [ ] **Step 3: Implementasi `distribute`/`distributeMany`**

Ganti impor `backend/src/services/distribution.service.ts:1-6` dengan:

```ts
import { db } from '../config/database';
import { suratDistributions, NewSuratDistribution, SuratDistribution, suratMasuk, unitKerja, users } from '../db/schema';
import { eq, and, desc, sql, or, notInArray, inArray, ne, isNull } from 'drizzle-orm';
import { NO_RECORD_UNIT_ACCESS, type RecordUnitScope } from '../utils/record-unit-scope';
import auditLogService, { type CriticalAuditContext } from './audit-log.service.js';
import { AppError, ConflictError, ValidationError } from '../utils/errors.js';
import { normalizeSecurityClassification, requiresExplicitAccessGrant } from './record-access.service.js';
import { hasPostgresErrorCode } from '../utils/postgres-errors.js';
import { aktor, isAjukanAksesEnabled, rangkaianService, recomputeRangkaian, type Tx } from './rangkaian/deps.js';
import { disposisiGrantService } from './rangkaian/disposisi-grant.service.js';

export const SURAT_TERKENDALI_DISPOSISI_MESSAGE =
    'Surat terkendali belum dapat didisposisikan; tangani di unit pencatat atau aktifkan jalur akses disposisi';

export interface DistributeInput {
    suratMasukId: string;
    sourceUnitId: string;
    targetUnitId: string;
    instruction?: string | null;
    ccUnits?: string[];
    sentBy?: string;
    batasWaktu?: string | null;
    penanggungJawab?: boolean;
}

export interface DistributeManyInput {
    suratMasukId: string;
    sourceUnitId: string;
    targets: Array<{ unitKerjaId: string; batasWaktu?: string | null; penanggungJawab?: boolean }>;
    instruksi?: string | null;
    ccUnits?: string[];
    sentBy?: string;
}
```

Ganti metode `distribute` (baris 28-102) dengan:

```ts
    /**
     * Buat satu disposisi. Tanpa `tx` membuka transaksinya sendiri; dengan `tx`
     * memakai transaksi luar (registrasi surat masuk). Setiap baris WAJIB punya
     * rangkaian_id lewat ensureForSuratMasuk di transaksi yang sama (§3).
     */
    async distribute(data: DistributeInput, auditContext?: CriticalAuditContext, tx?: Tx) {
        return tx
            ? this.distributeInTx(tx, data, auditContext)
            : db.transaction((inner) => this.distributeInTx(inner, data, auditContext));
    }

    /** Disposisi multi-direktorat: semua target berhasil atau semuanya batal. */
    async distributeMany(data: DistributeManyInput, auditContext?: CriticalAuditContext, tx?: Tx) {
        const run = async (inner: Tx) => {
            const rows: SuratDistribution[] = [];
            for (const target of data.targets) {
                rows.push(await this.distributeInTx(inner, {
                    suratMasukId: data.suratMasukId,
                    sourceUnitId: data.sourceUnitId,
                    targetUnitId: target.unitKerjaId,
                    instruction: data.instruksi ?? null,
                    ccUnits: data.ccUnits,
                    sentBy: data.sentBy,
                    batasWaktu: target.batasWaktu ?? null,
                    penanggungJawab: target.penanggungJawab ?? false,
                }, auditContext));
            }
            return rows;
        };
        return tx ? run(tx) : db.transaction(run);
    }

    private async distributeInTx(tx: Tx, data: DistributeInput, auditContext?: CriticalAuditContext) {
        // Urutan kunci §11: baris surat → rangkaian → distribusi.
        const [sourceSurat] = await tx
            .select({ id: suratMasuk.id, sifatSurat: suratMasuk.sifatSurat, unitKerjaId: suratMasuk.unitKerjaId })
            .from(suratMasuk)
            .where(and(
                eq(suratMasuk.id, data.suratMasukId),
                eq(suratMasuk.unitKerjaId, data.sourceUnitId),
                or(eq(suratMasuk.isDeleted, false), isNull(suratMasuk.isDeleted)),
            ))
            .limit(1)
            .for('update');
        if (!sourceSurat) {
            throw new AppError('Data not found', 404);
        }
        if (data.targetUnitId === data.sourceUnitId) {
            throw new ValidationError('Unit tujuan disposisi tidak boleh sama dengan unit pencatat');
        }
        const [target] = await tx
            .select({
                id: unitKerja.id,
                name: unitKerja.name,
                unitType: unitKerja.unitType,
                canReceiveDistribution: unitKerja.canReceiveDistribution,
            })
            .from(unitKerja)
            .where(eq(unitKerja.id, data.targetUnitId))
            .limit(1);
        if (!target || target.canReceiveDistribution === false || target.unitType === 'bagian') {
            throw new ValidationError('Unit tujuan tidak dapat menerima disposisi');
        }
        const classification = normalizeSecurityClassification(sourceSurat.sifatSurat);
        const terkendali = requiresExplicitAccessGrant(classification);
        if (terkendali && !isAjukanAksesEnabled()) {
            throw new ConflictError(SURAT_TERKENDALI_DISPOSISI_MESSAGE);
        }

        // P1: mengunci baris surat → rangkaian; 409 bila rangkaian diberkaskan/digabung.
        const ensured = await rangkaianService.ensureForSuratMasuk(
            tx,
            data.suratMasukId,
            aktor({ id: data.sentBy ?? null }, auditContext),
            data.penanggungJawab ? { unitPengolahId: target.id } : undefined,
        );

        // Baris rejected diabaikan sehingga TU dapat mendisposisikan ulang (§2c).
        const [existing] = await tx
            .select({ id: suratDistributions.id })
            .from(suratDistributions)
            .where(and(
                eq(suratDistributions.suratMasukId, data.suratMasukId),
                eq(suratDistributions.targetUnitId, data.targetUnitId),
                ne(suratDistributions.status, 'rejected'),
            ))
            .limit(1);
        if (existing) {
            throw new ValidationError('Surat sudah didistribusikan ke unit ini');
        }
        if (data.penanggungJawab) {
            const [pj] = await tx
                .select({ id: suratDistributions.id })
                .from(suratDistributions)
                .where(and(
                    eq(suratDistributions.rangkaianId, ensured.rangkaianId),
                    eq(suratDistributions.penanggungJawab, true),
                    ne(suratDistributions.status, 'rejected'),
                ))
                .limit(1);
            if (pj) throw new ValidationError('Penanggung jawab (Unit Pengolah) sudah ditetapkan untuk rangkaian ini');
        }

        let result: SuratDistribution;
        try {
            [result] = await tx
            .insert(suratDistributions)
            .values({
                suratMasukId: data.suratMasukId,
                sourceUnitId: data.sourceUnitId,
                targetUnitId: data.targetUnitId,
                instruction: data.instruction ?? null,
                ccUnits: data.ccUnits ? JSON.stringify(data.ccUnits) : null,
                sentBy: data.sentBy,
                status: 'sent',
                sentAt: new Date(),
                rangkaianId: ensured.rangkaianId,
                batasWaktu: data.batasWaktu ?? null,
                penanggungJawab: data.penanggungJawab ?? false,
            })
            .returning();
        } catch (error) {
            if (hasPostgresErrorCode(error, '23505', 'surat_distributions_active_target_uidx')) {
                throw new ValidationError('Surat sudah didistribusikan ke unit ini');
            }
            throw error;
        }

        if (data.penanggungJawab) {
            await tx.execute(sql`UPDATE rangkaian_surat SET unit_pengolah_id = ${target.id}, updated_at = now() WHERE id = ${ensured.rangkaianId}`);
        }
        // Label text[] lama tetap diisi server untuk tampilan/ekspor (§3 Kolom lama).
        await tx.execute(sql`UPDATE surat_masuk
            SET disposisi = array_append(coalesce(disposisi, '{}'::text[]), ${target.name}::text), updated_at = now()
            WHERE id = ${data.suratMasukId} AND NOT (coalesce(disposisi, '{}'::text[]) @> ARRAY[${target.name}::text])`);

        if (auditContext) {
            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: 'distribute',
                entityType: 'surat_distribution',
                entityId: result.id,
                changes: {
                    after: {
                        suratMasukId: data.suratMasukId,
                        sourceUnitId: data.sourceUnitId,
                        targetUnitId: data.targetUnitId,
                        instruction: data.instruction ?? null,
                        status: 'sent',
                        rangkaianId: ensured.rangkaianId,
                        batasWaktu: data.batasWaktu ?? null,
                        penanggungJawab: data.penanggungJawab ?? false,
                    },
                },
            }, tx);
        }

        if (terkendali) {
            await disposisiGrantService.ajukan(tx, {
                distribusiId: result.id,
                suratMasukId: data.suratMasukId,
                suratUnitKerjaId: sourceSurat.unitKerjaId,
                classification,
                targetUnitId: data.targetUnitId,
                requesterId: data.sentBy ?? '',
                rangkaianKode: ensured.kode,
            }, auditContext);
        }

        await recomputeRangkaian(tx, ensured.rangkaianId, auditContext);
        return result;
    }
```

Catatan: `requesterId` kosong ditolak FK `users` — pemanggil terkendali selalu mengirim `sentBy` (route dan hook registrasi).

- [ ] **Step 4: Route POST, `GET /opsi`, allowlist**

Di `backend/src/routes/distribution.routes.ts` tambah impor:

```ts
import { INSTRUKSI_DISPOSISI } from '../config/instruksi-disposisi.js';
import { isAjukanAksesEnabled } from '../services/rangkaian/deps.js';
import type { CreateDistribution } from '../validators/schemas';
```

Sisipkan sebelum `router.get('/inbox', ...)`:

```ts
/**
 * @route GET /api/distributions/opsi
 * @desc Chip instruksi statis dan status jalur akses disposisi surat terkendali
 */
router.get('/opsi', (_req: AuthRequest, res) => {
    res.json({ success: true, data: { instruksi: INSTRUKSI_DISPOSISI, jalurAksesTerkendali: isAjukanAksesEnabled() } });
});
```

Ganti handler POST (baris 186-223) dengan:

```ts
router.post('/', canWriteMiddleware(), validateBody(createDistributionSchema), async (req: AuthRequest, res, next) => {
    try {
        const { suratMasukId, sourceUnitId, targets, instruksi, ccUnits, bentuk } = req.body as CreateDistribution;
        if (!suratMasukId || !sourceUnitId) {
            return res.status(400).json({ error: 'suratMasukId dan sourceUnitId wajib diisi' });
        }
        const callerRole = (req.user?.role || 'user') as Role;
        if (!canAccessUnit(callerRole, req.user?.unitKerjaId || null, sourceUnitId)) {
            return res.status(403).json({ error: 'Anda tidak berwenang mendistribusikan surat atas nama unit tersebut' });
        }
        const sourceAccess = await recordAccessService.check(req.user, 'surat_masuk', suratMasukId);
        if (!sourceAccess.exists || !sourceAccess.mutable || sourceAccess.unitKerjaId !== sourceUnitId) {
            return res.status(404).json({ error: 'Data not found' });
        }
        const rows = await distributionService.distributeMany({
            suratMasukId,
            sourceUnitId,
            targets: targets ?? [],
            instruksi,
            ccUnits,
            sentBy: req.user?.id,
        }, { userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip });
        res.status(201).json({ success: true, data: bentuk === 'jamak' ? rows : rows[0] });
    } catch (error) {
        next(error);
    }
});
```

Di `demo-access.middleware.ts` ganti entri GET distributions menjadi:

```ts
    { methods: GET, path: exact(`/distributions(?:/(?:units|opsi|inbox|outbox|stats|surat/${UUID}|${UUID}(?:/kandidat-penyelesaian)?))?`) },
```

Di `backend/src/__tests__/distribution-layanan.routes.test.ts`: tambah `distributeMany: vi.fn(),` pada `mocks.distribution` (baris 22), `mocks.distribution.distributeMany.mockResolvedValue([{ id: 'dist-1' }]);` di `beforeEach`, dan ganti `it.each(['distribute', ...])` (baris 176) menjadi `it.each(['distributeMany', 'receive', 'process', 'reject'] as const)` dengan cabang `action === 'distributeMany' ? await request(app).post('/distributions')...`.

- [ ] **Step 5: Jalankan test unit, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/distribution.service.test.ts src/__tests__/distribution-layanan.routes.test.ts src/__tests__/demo-access.middleware.test.ts`
Expected: PASS.

- [ ] **Step 6: Tulis test Postgres disposisi (gagal lalu lulus)**

```ts
// backend/integration/disposisi.postgres.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

const state = vi.hoisted(() => ({ db: null as any }));
const proxy = () => ({ db: new Proxy({}, { get: (_t, key) => {
    const value = state.db?.[key];
    return typeof value === 'function' ? value.bind(state.db) : value;
} }) });
vi.mock('../src/config/database', proxy);
vi.mock('../src/config/database.js', proxy);

const { distributionService } = await import('../src/services/distribution.service.js');

let h: RangkaianTestDatabase;
let tu: TestUser; let bpptAdmin: TestUser;
const audit = () => ({ userId: tu.id, userEmail: tu.email });

beforeAll(async () => {
    h = await createRangkaianTestDatabase('disposisi');
    state.db = h.db;
    await h.seedUnits();
    tu = await h.seedUser('admin_unit', 'sesditjen');
    bpptAdmin = await h.seedUser('admin_unit', 'dir_bppt');
}, 120_000);
afterEach(() => { delete process.env.RANGKAIAN_AJUKAN_AKSES; });
afterAll(async () => { await h?.close(); });

describe('disposisi multi-direktorat di PostgreSQL', () => {
    it('multi-target membentuk satu rangkaian, pengolah dari penanggung jawab, dan label kompatibilitas', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-10/2026' });
        const rows = await distributionService.distributeMany({ suratMasukId: sm, sourceUnitId: 'sesditjen', sentBy: tu.id,
            targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }, { unitKerjaId: 'dir_ptep' }], instruksi: 'Mohon ditindaklanjuti' }, audit());
        expect(new Set(rows.map((r) => r.rangkaianId)).size).toBe(1);
        const [rs] = await h.query('SELECT unit_pengolah_id, unit_pencatat_id, status FROM rangkaian_surat WHERE id = $1', [rows[0].rangkaianId]);
        expect(rs).toEqual({ unit_pengolah_id: 'dir_bppt', unit_pencatat_id: 'sesditjen', status: 'aktif' });
        const [surat] = await h.query('SELECT disposisi FROM surat_masuk WHERE id = $1', [sm]);
        expect(surat.disposisi).toEqual(['Dit. BPPT', 'Dit. PTEP']);
        const [{ n }] = await h.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'surat_distribution' AND action = 'distribute' AND entity_id = ANY($1::uuid[])", [rows.map((r) => r.id)]);
        expect(n).toBe(2);
    });

    it('multi-target gagal seluruhnya bila satu target tidak sah', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-11/2026' });
        for (const invalid of ['bagian_umum', 'sesditjen']) {
            await expect(distributionService.distributeMany({ suratMasukId: sm, sourceUnitId: 'sesditjen', sentBy: tu.id,
                targets: [{ unitKerjaId: 'dir_ktpp' }, { unitKerjaId: invalid }] }, audit())).rejects.toMatchObject({ statusCode: 400 });
        }
        expect(await h.query('SELECT id FROM surat_distributions WHERE surat_masuk_id = $1', [sm])).toEqual([]);
        expect(await h.query('SELECT id FROM rangkaian_anggota WHERE surat_masuk_id = $1', [sm])).toEqual([]);
    });

    it('disposisi ulang setelah ditolak diizinkan; duplikat aktif ditolak', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-12/2026' });
        const [pertama] = await distributionService.distributeMany({ suratMasukId: sm, sourceUnitId: 'sesditjen', sentBy: tu.id, targets: [{ unitKerjaId: 'dir_ptep' }] }, audit());
        await expect(distributionService.distribute({ suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ptep', sentBy: tu.id }, audit()))
            .rejects.toMatchObject({ statusCode: 400 });
        await h.query("UPDATE surat_distributions SET status = 'rejected', rejection_reason = 'Salah alamat' WHERE id = $1", [pertama.id]);
        const ulang = await distributionService.distribute({ suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ptep', sentBy: tu.id }, audit());
        expect(ulang.rangkaianId).toBe(pertama.rangkaianId);
    });

    it('surat terkendali: 409 saat flag mati, grant pending saat flag menyala', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-13/2026', sifatSurat: 'Rahasia' });
        await expect(distributionService.distribute({ suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', sentBy: tu.id }, audit()))
            .rejects.toMatchObject({ statusCode: 409 });
        process.env.RANGKAIAN_AJUKAN_AKSES = 'true';
        const row = await distributionService.distribute({ suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', sentBy: tu.id }, audit());
        const grants = await h.query("SELECT target_user_id, status, unit_kerja_id, required_classification, purpose FROM record_access_grants WHERE entity_id = $1", [sm]);
        expect(grants).toEqual([expect.objectContaining({ target_user_id: bpptAdmin.id, status: 'pending', unit_kerja_id: 'sesditjen', required_classification: 'rahasia' })]);
        expect(grants[0].purpose.startsWith(`[disposisi:${row.id}]`)).toBe(true);
    });

    it('rangkaian diberkaskan menolak disposisi baru (409)', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-14/2026' });
        const [row] = await distributionService.distributeMany({ suratMasukId: sm, sourceUnitId: 'sesditjen', sentBy: tu.id, targets: [{ unitKerjaId: 'dir_bppt' }] }, audit());
        await h.query("UPDATE surat_distributions SET status = 'processed', processed_at = now(), catatan_penyelesaian = 'Sudah ditangani penuh' WHERE id = $1", [row.id]);
        const klasifikasi = await h.ensureKlasifikasi();
        await h.query(`UPDATE rangkaian_surat SET status = 'diberkaskan', unit_pengolah_id = 'dir_bppt', klasifikasi_item_id = $2,
            diberkaskan_at = now(), diberkaskan_by = $3 WHERE id = $1`, [row.rangkaianId, klasifikasi, tu.id]);
        await expect(distributionService.distribute({ suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ktpp', sentBy: tu.id }, audit()))
            .rejects.toMatchObject({ statusCode: 409 });
    });
});
```

Run: `cd backend && TEST_POSTGRES_URL=postgresql://simsa_test:simsa_test@127.0.0.1:5432/simsa_test npx vitest run --config vitest.postgres.config.ts integration/disposisi.postgres.test.ts`
Expected: PASS (5 test).

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/distribution.service.ts backend/src/routes/distribution.routes.ts backend/src/middlewares/demo-access.middleware.ts backend/src/__tests__/distribution.service.test.ts backend/src/__tests__/distribution-layanan.routes.test.ts backend/integration/disposisi.postgres.test.ts
git commit -m "feat(disposisi): distribute lewat ensureForSuratMasuk, multi-target, penanggung jawab, dan aturan surat terkendali

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


#### Amandemen pra-eksekusi Task 7 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


**Files: change**
- `distribution.service.ts:1-6` / `:27-102` → edit by symbol (details below).
- `demo-access.middleware.ts:107` → `:111`.
- `distribution.service.test.ts:1-107` → `:1-148`.
- **Add:** `backend/src/__tests__/distribution-create-validation.routes.test.ts`, `backend/src/__tests__/schemas.test.ts` and `backend/src/__tests__/rangkaian.schemas.test.ts` (it gets the moved `skema distribusi` cases).

**Interfaces: add**
- Consumes `lockSuratMasukRows` (not needed here; the SM is locked by the first SELECT), `aktorPenulis` and `denganRetryDeadlock` from deps.
- Takes over the `createDistributionSchema` replacement from Task 5 (plan:1837-1861) and `export type CreateDistribution = z.infer<typeof createDistributionSchema>`.

**Step 1 (tests) changes:**
- Replace `beforeEach` plus the whole `describe('distribute', …)` in `backend/src/__tests__/distribution.service.test.ts`. They currently span **`:43-148`**; stop right before `describe('findInbox'`. The P1 cases at `:107` ("reuses the caller transaction"), `:124` ("closed rangkaian 409") and `:135` ("Drizzle-wrapped 23505") are superseded by the plan's "memakai transaksi luar", "409 bila rangkaian surat sudah diberkaskan" and "pelanggaran index aktif (race)". [T7-2]
- The deps mock (plan:2525-2534) must also define:

  ```ts
  lockSuratMasukRows: vi.fn(async () => []),
  kunciSurat: vi.fn(),
  aktorPenulis: (u, a) => ({ ...(a ?? {}), userId: a?.userId ?? u?.id ?? 'u' }),
  denganRetryDeadlock: (run) => run(),
  pengawasUntukUnit: vi.fn(async () => false),
  readRefKey: (r) => `${r.type}:${r.id.toLowerCase()}`,
  LABEL_DIKECUALIKAN: 'Dikecualikan',
  recomputeSuratMasuk: vi.fn(async () => []),
  ```

- Move the two `createDistributionSchema` cases from Task 5 (plan:1615-1624) into `rangkaian.schemas.test.ts` under `describe('skema distribusi')`.
- In `backend/src/__tests__/schemas.test.ts:183-191`, change `expect(result.data.instruction).toBeNull()` to `expect(result.data.instruksi).toBeNull()`.
- In `backend/src/__tests__/distribution-create-validation.routes.test.ts` [T7-3]:
  - `mocks.distribution = { distributeMany: vi.fn() }`
  - `beforeEach` → `mocks.distribution.distributeMany.mockResolvedValue([{ id: 'dist-1', status: 'sent' }])`
  - Each 201 case asserts:

    ```ts
    expect(mocks.distribution.distributeMany).toHaveBeenCalledWith(
        expect.objectContaining({ suratMasukId: BASE.suratMasukId, sourceUnitId: 'ditjen',
            targets: [{ unitKerjaId: 'dir_bppt', batasWaktu: null, penanggungJawab: false }], instruksi: null /* or 'Mohon ditindaklanjuti' */ }),
        expect.objectContaining({ userId: 'user-1' }))
    ```

    and `expect(res.body.data).toEqual({ id: 'dist-1', status: 'sent' })` (single-target form returns one object).
  - The "tanpa field instruction" case asserts `instruksi: null`.

**Step 3, imports: do not replace lines 1-6.** Merge into the existing block at `backend/src/services/distribution.service.ts:1-9` [T7-1]:
- **Line 2 (schema):** keep `rangkaianSurat` only if it is still used after this task. Task 10 re-adds it for `findInbox`, so keeping it is fine.
- **Line 3:** becomes `import { eq, and, desc, sql, or, notInArray, inArray, ne, isNull } from 'drizzle-orm';`.
- **Line 4 `import { klasifikasiInSql } from './access/visibility-spec';`: KEEP.** `incomingSecurityCondition` (`:18-22`) still serves `findOutbox` (`:227`).
- **Lines 7-8** (`AppError, ConflictError, ValidationError`, `hasPostgresErrorCode`): keep as is and do not re-add.
- **Line 9** `import type { DbTransaction } …`: delete, and use `Tx` from deps.
- **Add:**

  ```ts
  import { normalizeSecurityClassification, requiresExplicitAccessGrant } from './record-access.service.js';
  import { aktorPenulis, denganRetryDeadlock, isAjukanAksesEnabled, rangkaianService, recomputeRangkaian, recomputeSuratMasuk, type Tx } from './rangkaian/deps.js';
  import { disposisiGrantService } from './rangkaian/disposisi-grant.service.js';
  ```

- **`DistributeInput` (`:24-36`):** edit in place. Delete only the `rangkaianId?` member and its comment; `batasWaktu`/`penanggungJawab` already exist. Add `DistributeManyInput` and `SURAT_TERKENDALI_DISPOSISI_MESSAGE` after it.
- **Replace** the public `distribute` (`:38-51`) **and delete** the private `distributeInTransaction` (`:53-147`, including the P1 `rangkaianId` branch at `:72-83`) with the plan's `distribute`/`distributeMany`/`distributeInTx`.
- **Without a caller tx,** open the transaction through `denganRetryDeadlock(() => db.transaction(run))`. [T7-8]

**Changes inside `distributeInTx`:**
- **Actor** [T7-6]: call ensure with `aktorPenulis({ id: data.sentBy ?? null }, auditContext)`.
- **Terkendali without `sentBy`:** before `disposisiGrantService.ajukan`, add `if (!data.sentBy) throw new ValidationError('Pengirim disposisi terkendali wajib diketahui');`, then pass `requesterId: data.sentBy`. Delete the "Catatan: requesterId kosong…" line.
- **Delete the raw pengolah UPDATE** (plan:2861-2863). Replace it with [T7-4]:

  ```ts
  if (data.penanggungJawab) {
      // P1 ensureForSuratMasuk sudah mengisi (dan mengaudit) pengolah bila NULL (rangkaian.service.ts:342-355).
      const [rs] = rowsOf<{ unit_pengolah_id: string | null }>(await tx.execute(
          sql`SELECT unit_pengolah_id FROM rangkaian_surat WHERE id = ${ensured.rangkaianId}`)); // baris sudah terkunci oleh ensure
      if (rs?.unit_pengolah_id && rs.unit_pengolah_id !== target.id) {
          await tx.execute(sql`UPDATE rangkaian_surat SET unit_pengolah_id = ${target.id}, updated_at = now() WHERE id = ${ensured.rangkaianId}`);
          if (auditContext) {
              await auditLogService.logActionOrThrow({ ...auditContext, action: 'update', entityType: 'rangkaian_surat', entityId: ensured.rangkaianId,
                  changes: { before: { unitPengolahId: rs.unit_pengolah_id }, after: { unitPengolahId: target.id }, alasan: 'Penanggung jawab disposisi', distribusiId: result.id } }, tx);
          }
      }
  }
  ```

  Import `rowsOf` from `./rangkaian/sql-rows.js`. In the unit test queue (plan:2648), the `[]` for the dropped raw UPDATE becomes `[{ unit_pengolah_id: null }]` for the new SELECT.
- **SM status** [T7-5]: after `await recomputeRangkaian(tx, ensured.rangkaianId, auditContext);` add `await recomputeSuratMasuk(tx, [data.suratMasukId], auditContext);`. The SM row is already locked by the first SELECT (RB:99).

**Allowlist** [T7-7]:
- At `demo-access.middleware.ts:111`, the GET entry becomes `` exact(`/distributions(?:/(?:units|opsi|inbox|outbox|stats|surat/${UUID}|${UUID}))?`) ``. `kandidat-penyelesaian` is added in Task 10.
- Add `['GET', '/api/distributions/opsi']` to the allowlist `it.each` in `backend/src/__tests__/demo-access.middleware.test.ts`, and add that file to `git add`.

**Step 5 run list: add** `src/__tests__/distribution-create-validation.routes.test.ts src/__tests__/schemas.test.ts src/__tests__/rangkaian.schemas.test.ts` and `npx tsc --noEmit -p tsconfig.json`.

**Postgres test: add a case** [T7-4, T7-5]:
1. Set `unit_pengolah_id` via `berkasService.ubahUnitPengolah`, or directly in SQL for this task: set it to `dir_ptep`, then add a PJ disposisi to `dir_bppt`.
2. Expect `unit_pengolah_id = 'dir_bppt'` and exactly one `audit_log` row with `entity_type='rangkaian_surat' AND action='update'` whose `changes->'before'->>'unitPengolahId' = 'dir_ptep'`.
3. Separately: `tandaiSelesai` manually, then distribute. Expect SM `status = 'belum_dibalas'`.

**Step 7 `git add`: add** `backend/src/validators/schemas.ts backend/src/__tests__/schemas.test.ts backend/src/__tests__/rangkaian.schemas.test.ts backend/src/__tests__/distribution-create-validation.routes.test.ts backend/src/__tests__/demo-access.middleware.test.ts`.

---



### Task 8: Tindak lanjut surat keluar (`attachSuratKeluar`), hook create, ND Penjelas

**Files:**
- Create: `backend/src/services/rangkaian/tindak-lanjut.service.ts`
- Create: `backend/src/services/rangkaian/tindak-lanjut.hook.ts`
- Modify: `backend/src/services/surat-keluar.service.ts:1-46` (impor/tipe), `:148-334` (create), `:414-437` (update), `:470-483` (delete)
- Modify: `backend/src/routes/surat-keluar.routes.ts:206-218` (hapus pra-cek `balasanUntuk`), `:258-275` (kirim `actor`)
- Modify: `backend/src/__tests__/surat-keluar.service.test.ts:1-60,191-215`
- Test: `backend/src/__tests__/surat-keluar-tindak-lanjut.routes.test.ts`, `backend/integration/tindak-lanjut.postgres.test.ts`

**Interfaces:**
- Consumes: `recordAccessService.checkRead`, `isPengawas`, `aktor`, `rangkaianService.ensureForSurat(tx, ref, actor)`, `rangkaianService.attach(tx, input, actor)` (P1: anggota + relasi + buka kembali, audit `link`), `recomputeRangkaian`, `recomputeSuratMasuk`, `recomputeForSuratKeluar` (deps); `TindakLanjutInput` (Task 5).
- Produces: `tindakLanjutService.attachSuratKeluar(tx, { user, suratKeluar: { id, unitKerjaId }, tindakLanjut, audit? }): Promise<{ rangkaianId; anggotaId; relasiId; balasanUntuk: string | null; distribusiDiterima: string | null }>`; hook `afterSuratKeluarInsert(tx, { user?, inserted, tindakLanjut?, audit? })`, `afterSuratKeluarChanged(tx, suratKeluarId, audit?)`; `suratKeluarService.create(data & { tindakLanjut?, actor? }, ...)`.

- [ ] **Step 1: Perbarui test unit surat keluar (gagal)**

Di `backend/src/__tests__/surat-keluar.service.test.ts`, tambahkan setelah `vi.mock('../config/database', ...)` (baris 54):

```ts
const hookMocks = vi.hoisted(() => ({
    afterSuratKeluarInsert: vi.fn(async () => null as any),
    afterSuratKeluarChanged: vi.fn(async () => undefined),
}));
vi.mock('../services/rangkaian/tindak-lanjut.hook.js', () => hookMocks);
```

Tambahkan di `beforeEach`: `hookMocks.afterSuratKeluarInsert.mockReset().mockResolvedValue(null); hookMocks.afterSuratKeluarChanged.mockReset().mockResolvedValue(undefined);`

Ganti dua test `should update surat masuk status when balasanUntuk is provided` dan `rejects a reply target outside the outgoing letter unit` (baris 191-215) dengan:

```ts
        it('mendelegasikan balasanUntuk lama ke hook tindak lanjut setelah insert', async () => {
            enqueue([], [templateRow], [{ noUrut: 1 }], [{ id: 'reply-1', noUrut: 2, unitKerjaId: 'u1', balasanUntuk: null }]);
            hookMocks.afterSuratKeluarInsert.mockResolvedValueOnce({ balasanUntuk: 'sm-1' });
            const actor = { id: 'user-1', role: 'admin_unit', unitKerjaId: 'u1' };
            const res = await svc.create({ unitKerjaId: 'u1', tahun: 2026, balasanUntuk: 'sm-1', actor } as any);
            expect(hookMocks.afterSuratKeluarInsert).toHaveBeenCalledWith(expect.anything(), {
                user: actor,
                inserted: { id: 'reply-1', unitKerjaId: 'u1' },
                tindakLanjut: { jenis: 'surat_masuk', suratId: 'sm-1', jenisRelasi: 'balasan' },
                audit: undefined,
            });
            expect(capturedValues.at(-1)).toMatchObject({ balasanUntuk: null, asalNaskah: 'tindak_lanjut' });
            expect(res.balasanUntuk).toBe('sm-1');
        });

        it('tidak lagi menandai surat masuk sudah_dibalas saat draft dibuat (tanpa query tambahan)', async () => {
            enqueue([], [templateRow], [{ noUrut: 1 }], [{ id: 'sk-1', noUrut: 2, unitKerjaId: 'u1' }]);
            await svc.create({ unitKerjaId: 'u1', tahun: 2026, asalNaskah: 'inisiatif' } as any);
            expect(resultQueue).toHaveLength(0);
            expect(capturedValues.at(-1)).toMatchObject({ asalNaskah: 'inisiatif', balasanUntuk: null });
            expect(hookMocks.afterSuratKeluarInsert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tindakLanjut: undefined }));
        });
```

Tambahkan di `describe('update')` dan `describe('delete')`:

```ts
        it('memicu recompute rangkaian setelah update', async () => {
            enqueue([{ id: '1', perihal: 'Baru' }]);
            await svc.update('1', { perihal: 'Baru' } as any, 'u1');
            expect(hookMocks.afterSuratKeluarChanged).toHaveBeenCalledWith(expect.anything(), '1', undefined);
        });
```

```ts
        it('memicu recompute rangkaian setelah soft delete', async () => {
            enqueue([{ id: '1', perihal: 'To Delete' }]);
            await svc.delete('1', undefined, 'u1');
            expect(hookMocks.afterSuratKeluarChanged).toHaveBeenCalledWith(expect.anything(), '1', undefined);
        });
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/surat-keluar.service.test.ts`
Expected: FAIL — hook tidak dipanggil; service masih membuat query `replyTarget` dan update `sudah_dibalas`.

- [ ] **Step 3: Implementasi layanan tindak lanjut dan hook**

```ts
// backend/src/services/rangkaian/tindak-lanjut.service.ts
import { eq, sql } from 'drizzle-orm';
import { suratKeluar } from '../../db/schema/index.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import auditLogService, { type CriticalAuditContext } from '../audit-log.service.js';
import {
    aktor, isPengawas, rangkaianService, recomputeRangkaian, recomputeSuratMasuk, recordAccessService,
    type JenisRelasi, type RecordUser, type SuratJenis, type Tx,
} from './deps.js';
import { rowsOf } from './sql-rows.js';

export interface TindakLanjutInput { jenis: SuratJenis; suratId: string; jenisRelasi: JenisRelasi; distribusiId?: string }

export interface AttachResult {
    rangkaianId: string;
    anggotaId: string;
    relasiId: string;
    balasanUntuk: string | null;
    distribusiDiterima: string | null;
}

export const tindakLanjutService = {
    /**
     * §5 surat-keluar create: pembuat = pemilik induk, target disposisi hidup,
     * atau pengawas; DAN checkRead atas induk lolos; rangkaian bukan diberkaskan.
     * Disposisi `sent` unit pembuat diterima implisit di transaksi yang sama.
     */
    async attachSuratKeluar(tx: Tx, params: {
        user: RecordUser;
        suratKeluar: { id: string; unitKerjaId: string };
        tindakLanjut: TindakLanjutInput;
        audit?: CriticalAuditContext;
    }): Promise<AttachResult> {
        const { user, suratKeluar: sk, tindakLanjut: t, audit } = params;
        const akses = await recordAccessService.checkRead(user, t.jenis, t.suratId, tx);
        if (!akses.exists || !akses.allowed || !akses.unitKerjaId) throw new NotFoundError('Surat induk');

        const actor = aktor(user, audit);
        const induk = await rangkaianService.ensureForSurat(tx, { jenis: t.jenis, id: t.suratId }, actor);
        if (induk.status === 'diberkaskan') {
            throw new ConflictError('Rangkaian surat induk sudah diberkaskan; buat surat baru sebagai rangkaian lanjutan.');
        }
        const [disposisi] = rowsOf<{ id: string; status: 'sent' | 'received' }>(await tx.execute(sql`
            SELECT id, status FROM surat_distributions
             WHERE rangkaian_id = ${induk.rangkaianId} AND target_unit_id = ${sk.unitKerjaId}
               AND status IN ('sent', 'received')
             ORDER BY sent_at, id
             LIMIT 1
             FOR UPDATE`));
        const pemilikInduk = akses.unitKerjaId === sk.unitKerjaId;
        const pengawas = !pemilikInduk && !disposisi
            && (user.role === 'super_admin' || await isPengawas(user, tx));
        if (!pemilikInduk && !disposisi && !pengawas) {
            throw new ForbiddenError('Unit Anda tidak berwenang menindaklanjuti surat ini.');
        }
        if (t.distribusiId && t.distribusiId !== disposisi?.id) {
            throw new ValidationError('Disposisi yang dirujuk tidak aktif untuk unit Anda pada surat ini.');
        }

        // P1 attach: anggota + relasi (audit `link`), membuka kembali rangkaian selesai.
        const tautan = await rangkaianService.attach(tx, {
            rangkaianId: induk.rangkaianId,
            surat: { jenis: 'surat_keluar', id: sk.id },
            keAnggotaId: induk.anggotaId,
            jenisRelasi: t.jenisRelasi,
            keterangan: null,
            sumber: 'aplikasi',
        }, actor);

        let distribusiDiterima: string | null = null;
        if (disposisi?.status === 'sent') {
            await tx.execute(sql`UPDATE surat_distributions
                SET status = 'received', received_at = now(), received_by = ${user.id}, updated_at = now()
                WHERE id = ${disposisi.id} AND status = 'sent'`);
            distribusiDiterima = disposisi.id;
            if (audit) {
                await auditLogService.logActionOrThrow({
                    ...audit, action: 'receive_distribution', entityType: 'surat_distribution', entityId: disposisi.id,
                    changes: { before: { status: 'sent' }, after: { status: 'received' }, implisit: true, via: 'tindak_lanjut', suratKeluarId: sk.id },
                }, tx);
            }
        }

        // balasan_untuk lama hanya untuk balasan same-unit ke surat masuk (§3 Kolom lama).
        const balasanUntuk = t.jenis === 'surat_masuk' && t.jenisRelasi === 'balasan' && pemilikInduk ? t.suratId : null;
        if (balasanUntuk) {
            await tx.update(suratKeluar).set({ balasanUntuk }).where(eq(suratKeluar.id, sk.id));
        }
        await recomputeRangkaian(tx, induk.rangkaianId, audit);
        if (t.jenis === 'surat_masuk') await recomputeSuratMasuk(tx, [t.suratId], audit);
        return { rangkaianId: induk.rangkaianId, anggotaId: tautan.anggotaId, relasiId: tautan.relasiId, balasanUntuk, distribusiDiterima };
    },
};
```

```ts
// backend/src/services/rangkaian/tindak-lanjut.hook.ts
/**
 * Hook create/update/delete surat. Dipisah ke modul ini agar test berbasis
 * Proxy mock cukup `vi.mock('.../tindak-lanjut.hook.js')` (§11, churn test create).
 */
import { ValidationError } from '../../utils/errors.js';
import type { CriticalAuditContext } from '../audit-log.service.js';
import { recomputeForSuratKeluar, type RecordUser, type Tx } from './deps.js';
import { tindakLanjutService, type TindakLanjutInput } from './tindak-lanjut.service.js';

export async function afterSuratKeluarInsert(tx: Tx, ctx: {
    user?: RecordUser | null;
    inserted: { id: string; unitKerjaId: string };
    tindakLanjut?: TindakLanjutInput;
    audit?: CriticalAuditContext;
}) {
    if (!ctx.tindakLanjut) return null;
    if (!ctx.user?.id) throw new ValidationError('Tindak lanjut memerlukan pengguna yang terautentikasi.');
    return tindakLanjutService.attachSuratKeluar(tx, {
        user: ctx.user, suratKeluar: ctx.inserted, tindakLanjut: ctx.tindakLanjut, audit: ctx.audit,
    });
}

export async function afterSuratKeluarChanged(tx: Tx, suratKeluarId: string, audit?: CriticalAuditContext) {
    return recomputeForSuratKeluar(tx, suratKeluarId, audit);
}
```

- [ ] **Step 4: Ubah `surat-keluar.service.ts`**

Tambah impor setelah baris 26:

```ts
import { afterSuratKeluarChanged, afterSuratKeluarInsert } from './rangkaian/tindak-lanjut.hook.js';
import type { TindakLanjutInput } from './rangkaian/tindak-lanjut.service.js';
import type { RecordUser } from './record-access.service.js';
```

Ganti tipe `CreateSuratKeluarInput` (baris 43-46):

```ts
type CreateSuratKeluarInput = Omit<NewSuratKeluar, 'noUrut' | 'tahun'> & {
    tahun?: number;
    numberingMode?: 'auto' | 'manual';
    tindakLanjut?: TindakLanjutInput;
    actor?: RecordUser | null;
};
```

Di `create`, ganti baris 155 dengan:

```ts
        const { numberingMode: requestedNumberingMode, tindakLanjut: tindakLanjutInput, actor, ...recordData } = data;
        // Pemanggil layanan langsung yang masih memakai balasanUntuk dipetakan ke relasi 'balasan'.
        const tindakLanjut: TindakLanjutInput | undefined = tindakLanjutInput
            ?? (recordData.balasanUntuk
                ? { jenis: 'surat_masuk', suratId: recordData.balasanUntuk, jenisRelasi: 'balasan' }
                : undefined);
```

Hapus blok "A reply can only target a live incoming letter in the same unit" (baris 233-248). Pada `.values({...})` insert (baris 254-263) tambahkan dua kunci setelah `...ruleSelection,`:

```ts
                        balasanUntuk: null,
                        asalNaskah: tindakLanjut ? 'tindak_lanjut' : (recordData.asalNaskah ?? null),
```

Ganti blok "If this is a reply to surat masuk, update its status" (baris 283-293) dengan:

```ts
                // Rangkaian: anggota + relasi + terima implisit. Status surat masuk
                // TIDAK lagi di-flip saat draft; diturunkan saat approve (§8).
                const tindakLanjutHasil = await afterSuratKeluarInsert(tx, {
                    user: actor ?? null,
                    inserted: { id: inserted.id, unitKerjaId: inserted.unitKerjaId },
                    tindakLanjut,
                    audit: auditContext,
                });
                const tersimpan = { ...inserted, balasanUntuk: tindakLanjutHasil?.balasanUntuk ?? null };
```

Pada audit create (baris 301-309) ganti `balasanUntuk: inserted.balasanUntuk,` dengan `balasanUntuk: tersimpan.balasanUntuk, asalNaskah: tersimpan.asalNaskah, tindakLanjut: tindakLanjut ?? null,`, dan baris 324 menjadi `return (await hydrateSuratRuleSelections(tx, [tersimpan], 'keluar'))[0];`.

Di `update` setelah blok audit (baris 435) tambahkan:

```ts
            if (result) await afterSuratKeluarChanged(tx, id, auditContext);
```

Di `delete` setelah blok audit (baris 481) tambahkan baris yang sama.

- [ ] **Step 5: Ubah route POST surat keluar**

Di `backend/src/routes/surat-keluar.routes.ts` hapus blok `if (bodyValidation.data.balasanUntuk) { ... }` (baris 206-218) — wewenang dan `checkRead` kini di hook. Pada panggilan `suratKeluarService.create({...` (baris 258) tambahkan kunci `actor: req.user,` setelah `createdBy: req.user?.id,`.

```ts
// backend/src/__tests__/surat-keluar-tindak-lanjut.routes.test.ts
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), check: vi.fn() }));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { id: 'user-bppt', email: 'b@example.test', name: 'B', role: 'admin_unit', unitKerjaId: 'dir_bppt' };
        next();
    },
}));
vi.mock('../middlewares/role.middleware', () => ({ canWriteMiddleware: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/surat-keluar.service', () => ({ suratKeluarService: { create: mocks.create } }));
vi.mock('../services/record-access.service.js', () => ({
    allowedSecurityClassifications: () => ['biasa', 'terbatas'],
    isAllowedForClassification: () => true,
    recordAccessService: { check: mocks.check },
}));

const { default: router } = await import('../routes/surat-keluar.routes');
const app = express();
app.use(express.json());
app.use('/api/surat-keluar', router);
app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ error: error.message }));

const INDUK = '550e8400-e29b-41d4-a716-446655440000';
const dasar = { unitKerjaId: 'dir_bppt', tanggalSurat: '2026-09-20', perihal: 'Tindak lanjut', kepada: 'Dirjen', naskahDinas: 'Nota Dinas' };

describe('POST /api/surat-keluar tindak lanjut', () => {
    beforeEach(() => {
        mocks.create.mockReset().mockResolvedValue({ id: 'sk-1', unitKerjaId: 'dir_bppt' });
        mocks.check.mockReset();
    });

    it('400 untuk inisiatif bersama induk', async () => {
        await request(app).post('/api/surat-keluar').send({ ...dasar, asalNaskah: 'inisiatif', balasanUntuk: INDUK }).expect(400);
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it('meneruskan tindakLanjut dan aktor tanpa pra-cek pemilik (wewenang di hook)', async () => {
        await request(app).post('/api/surat-keluar')
            .send({ ...dasar, tindakLanjut: { jenis: 'surat_masuk', suratId: INDUK, jenisRelasi: 'tindak_lanjut' } }).expect(201);
        expect(mocks.check).not.toHaveBeenCalled();
        expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
            tindakLanjut: { jenis: 'surat_masuk', suratId: INDUK, jenisRelasi: 'tindak_lanjut' },
            asalNaskah: 'tindak_lanjut',
            actor: expect.objectContaining({ id: 'user-bppt' }),
        }), expect.anything(), undefined, undefined);
    });
});
```

- [ ] **Step 6: Jalankan test unit, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/surat-keluar.service.test.ts src/__tests__/surat-keluar-tindak-lanjut.routes.test.ts src/__tests__/surat-file-security.routes.test.ts`
Expected: PASS.

- [ ] **Step 7: Tulis test Postgres tindak lanjut (termasuk Review Focus #5)**

```ts
// backend/integration/tindak-lanjut.postgres.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

const state = vi.hoisted(() => ({ db: null as any }));
const proxy = () => ({ db: new Proxy({}, { get: (_t, key) => {
    const value = state.db?.[key];
    return typeof value === 'function' ? value.bind(state.db) : value;
} }) });
vi.mock('../src/config/database', proxy);
vi.mock('../src/config/database.js', proxy);
vi.mock('../src/services/srikandi-producer.service.js', () => ({ srikandiBusinessProducer: {
    suratMasukCreated: async () => {}, suratKeluarCreated: async () => {},
} }));

const { distributionService } = await import('../src/services/distribution.service.js');
const { suratKeluarService } = await import('../src/services/surat-keluar.service.js');

let h: RangkaianTestDatabase;
let tu: TestUser; let bppt: TestUser; let ptep: TestUser; let ktpp: TestUser;
let sm: string; let rangkaianId: string; let ptepDist: string;
const audit = (u: TestUser) => ({ userId: u.id, userEmail: u.email });
const buatSk = (u: TestUser, extra: Record<string, unknown>) => suratKeluarService.create({
    unitKerjaId: u.unitKerjaId!, naskahDinas: 'Nota Dinas', tanggalSurat: '2026-09-20', perihal: 'Tindak lanjut disposisi',
    kepada: 'Direktur Jenderal', createdBy: u.id, actor: u, ...extra,
} as any, audit(u));

beforeAll(async () => {
    h = await createRangkaianTestDatabase('tindaklanjut');
    state.db = h.db;
    await h.seedUnits();
    tu = await h.seedUser('admin_unit', 'sesditjen');
    bppt = await h.seedUser('admin_unit', 'dir_bppt');
    ptep = await h.seedUser('admin_unit', 'dir_ptep');
    ktpp = await h.seedUser('admin_unit', 'dir_ktpp');
    sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-20/2026', perihal: 'Permohonan penetapan lokasi' });
    const rows = await distributionService.distributeMany({ suratMasukId: sm, sourceUnitId: 'sesditjen', sentBy: tu.id,
        targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }, { unitKerjaId: 'dir_ptep' }] }, audit(tu));
    rangkaianId = rows[0].rangkaianId!;
    ptepDist = rows.find((r) => r.targetUnitId === 'dir_ptep')!.id;
}, 120_000);
afterAll(async () => { await h?.close(); });

describe('tindak lanjut surat keluar', () => {
    it('BPPT membuat ND tindak lanjut: anggota, relasi, terima implisit, tanpa balasan_untuk', async () => {
        const nd = await buatSk(bppt, { tindakLanjut: { jenis: 'surat_masuk', suratId: sm, jenisRelasi: 'tindak_lanjut' } });
        const [row] = await h.query('SELECT asal_naskah, balasan_untuk FROM surat_keluar WHERE id = $1', [nd.id]);
        expect(row).toEqual({ asal_naskah: 'tindak_lanjut', balasan_untuk: null });
        const [anggota] = await h.query('SELECT rangkaian_id, unit_kerja_id FROM rangkaian_anggota WHERE surat_keluar_id = $1', [nd.id]);
        expect(anggota).toEqual({ rangkaian_id: rangkaianId, unit_kerja_id: 'dir_bppt' });
        const [dist] = await h.query("SELECT status, received_by FROM surat_distributions WHERE rangkaian_id = $1 AND target_unit_id = 'dir_bppt'", [rangkaianId]);
        expect(dist).toEqual({ status: 'received', received_by: bppt.id });
    });

    it('unit dengan disposisi rejected ditolak dan baris rejected tidak berubah', async () => {
        // PTEP sempat menulis anggota (tetap dalam jangkauan baca), lalu menolak disposisinya.
        await buatSk(ptep, { tindakLanjut: { jenis: 'surat_masuk', suratId: sm, jenisRelasi: 'tindak_lanjut' } });
        await distributionService.reject(ptepDist, 'Bukan tugas PTEP', 'dir_ptep', audit(ptep));
        const sebelum = await h.query('SELECT status, received_at, received_by, updated_at FROM surat_distributions WHERE id = $1', [ptepDist]);
        await expect(buatSk(ptep, { tindakLanjut: { jenis: 'surat_masuk', suratId: sm, jenisRelasi: 'tindak_lanjut' } }))
            .rejects.toMatchObject({ statusCode: 403 });
        expect(await h.query('SELECT status, received_at, received_by, updated_at FROM surat_distributions WHERE id = $1', [ptepDist])).toEqual(sebelum);
        expect(sebelum[0].status).toBe('rejected');
        const [{ n }] = await h.query<{ n: number }>("SELECT count(*)::int AS n FROM surat_keluar WHERE unit_kerja_id = 'dir_ptep'");
        expect(n).toBe(1);
    });

    it('unit tanpa disposisi dan bukan pemilik mendapat 404 (tidak dapat membaca induk)', async () => {
        await expect(buatSk(ktpp, { tindakLanjut: { jenis: 'surat_masuk', suratId: sm, jenisRelasi: 'tindak_lanjut' } }))
            .rejects.toMatchObject({ statusCode: 404 });
    });

    it('balasan same-unit oleh TU mengisi balasan_untuk', async () => {
        const balasan = await buatSk(tu, { tindakLanjut: { jenis: 'surat_masuk', suratId: sm, jenisRelasi: 'balasan' } });
        const [row] = await h.query('SELECT balasan_untuk FROM surat_keluar WHERE id = $1', [balasan.id]);
        expect(row.balasan_untuk).toBe(sm);
    });

    it('ND penjelas SK inisiatif membentuk rangkaian asal inisiatif dengan relasi menjelaskan', async () => {
        const sk = await buatSk(bppt, { naskahDinas: 'Keputusan', perihal: 'Keputusan tim terpadu', asalNaskah: 'inisiatif' });
        expect(await h.query('SELECT id FROM rangkaian_anggota WHERE surat_keluar_id = $1', [sk.id])).toEqual([]);
        const nd = await buatSk(bppt, { perihal: `Penjelasan Keputusan Nomor ${sk.nomorSurat}`, tindakLanjut: { jenis: 'surat_keluar', suratId: sk.id, jenisRelasi: 'menjelaskan' } });
        const [rel] = await h.query(`SELECT r.jenis_relasi, rs.asal FROM rangkaian_relasi r
            JOIN rangkaian_anggota d ON d.id = r.dari_anggota_id JOIN rangkaian_surat rs ON rs.id = r.rangkaian_id
            WHERE d.surat_keluar_id = $1`, [nd.id]);
        expect(rel).toEqual({ jenis_relasi: 'menjelaskan', asal: 'inisiatif' });
    });

    it('induk dalam rangkaian diberkaskan menolak tindak lanjut (409)', async () => {
        await h.query("UPDATE surat_distributions SET status = 'processed', processed_at = now(), catatan_penyelesaian = 'Selesai ditangani' WHERE rangkaian_id = $1 AND status <> 'rejected'", [rangkaianId]);
        await h.query("UPDATE surat_keluar SET approval_status = 'approved' WHERE id IN (SELECT surat_keluar_id FROM rangkaian_anggota WHERE rangkaian_id = $1 AND surat_keluar_id IS NOT NULL)", [rangkaianId]);
        const klasifikasi = await h.ensureKlasifikasi();
        await h.query(`UPDATE rangkaian_surat SET status = 'diberkaskan', unit_pengolah_id = 'dir_bppt', klasifikasi_item_id = $2, diberkaskan_at = now(), diberkaskan_by = $3 WHERE id = $1`, [rangkaianId, klasifikasi, tu.id]);
        await expect(buatSk(tu, { tindakLanjut: { jenis: 'surat_masuk', suratId: sm, jenisRelasi: 'balasan' } }))
            .rejects.toMatchObject({ statusCode: 409 });
    });
});
```

Run: `cd backend && TEST_POSTGRES_URL=postgresql://simsa_test:simsa_test@127.0.0.1:5432/simsa_test npx vitest run --config vitest.postgres.config.ts integration/tindak-lanjut.postgres.test.ts`
Expected: PASS (6 test).

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/rangkaian/tindak-lanjut.service.ts backend/src/services/rangkaian/tindak-lanjut.hook.ts backend/src/services/surat-keluar.service.ts backend/src/routes/surat-keluar.routes.ts backend/src/__tests__/surat-keluar.service.test.ts backend/src/__tests__/surat-keluar-tindak-lanjut.routes.test.ts backend/integration/tindak-lanjut.postgres.test.ts
git commit -m "feat(tindak-lanjut): surat keluar tindak lanjut dengan wewenang, checkRead, dan terima implisit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


#### Amandemen pra-eksekusi Task 8 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


**Files: add**
- Modify: `backend/src/validators/schemas.ts` (the surat keluar block moved from Task 5).
- Modify: `backend/src/__tests__/rangkaian.schemas.test.ts` (gets `describe('skema surat keluar')`).
- Anchor the route edits on the `if (bodyValidation.data.balasanUntuk) {` block (`backend/src/routes/surat-keluar.routes.ts:211-222`), not on `:206-218`. The service test mock is at `surat-keluar.service.test.ts:49`. [G-ANCHOR]

**Step 1: add**
- Apply Task 5's `suratKeluarBaseSchema` additions (plan:1788-1794) and the `createSuratKeluarSchema`/`updateSuratKeluarSchema` replacement (plan:1796-1831) in this task, so that `tsc` stays green at every commit.
- Move `describe('skema surat keluar', …)` (plan:1590-1612) into `rangkaian.schemas.test.ts`.
- If `schemas.test.ts` has `balasanUntuk` output expectations for `createSuratKeluarSchema`, change them to `tindakLanjut: { jenis: 'surat_masuk', suratId, jenisRelasi: 'balasan' }`. [T8-2]

**`tindak-lanjut.service.ts`:** delete the local `interface TindakLanjutInput` (plan:3169) and use `import type { TindakLanjutInput } from '../../validators/schemas.js';`. [T8-2]

**Actors.** Every `rangkaianService.ensureForSurat`/`attach` call uses `aktorPenulis(actor, audit)`. [T1-3]

**Lock order.** `attachSuratKeluar` runs inside SK create after the numbering lock. That already gives SK → SM (induk, via `ensureForSurat`'s `lockSurat`) → R, which matches GC#30. Add this comment:

> Inversi terhadap registrasi SM ber-Nomor Referensi (Task 9: SM → SK) diterima sebagai residu; ditangani `denganRetryDeadlock` di batas transaksi terluar. [T8-3]

**Reopen** [T8-4]. After `const hasil = await rangkaianService.attach(…)`, when `hasil.reopened` is true:

```ts
const anggotaSm = rowsOf<{ id: string }>(await tx.execute(sql`SELECT surat_masuk_id AS id FROM rangkaian_anggota WHERE rangkaian_id = ${hasil.rangkaianId} AND surat_masuk_id IS NOT NULL`)).map(r => r.id);
await lockSuratMasukRows(tx, anggotaSm);           // SM → (R sudah terkunci; aman: SM baru hanya bertambah lewat jalur yang mengunci R lebih dulu)
await recomputeSuratMasuk(tx, anggotaSm, audit);
```

Import `lockSuratMasukRows` and `recomputeSuratMasuk` from deps. The existing induk recompute (plan:3247) is folded into this.

**Step 6 run list: fix the path.** `src/__tests__/surat-file-security.routes.test.ts` becomes `src/routes/__tests__/surat-file-security.routes.test.ts`. Add `src/__tests__/rangkaian.schemas.test.ts` and `npx tsc --noEmit -p tsconfig.json`. [T8-1]

**Step 7 `git add`:** add `backend/src/validators/schemas.ts backend/src/__tests__/rangkaian.schemas.test.ts`, and `backend/src/__tests__/schemas.test.ts` if it changed.

---


**C-4 (critic) — Tasks 8, 9, 12, 13: deadlock retry at the P0 transaction boundaries that P3 extends (**BLOCKING, RB:91**) [C-4]**


G-RETRY (amend:19) wraps only P3-owned transactions. T8-3 (amend:401-403, rul:113) nevertheless claims that the real SK/SM inversion is "ditangani `denganRetryDeadlock` di batas transaksi terluar". No amendment wraps those boundaries.

The inversion is concrete:
- **SK create:** locks the unit template, then the **existing** last SK row FOR UPDATE, then (via T8) SM X (`surat-keluar.service.ts:198-217`).
- **SM registration:** locks the template, then the last SM row FOR UPDATE, then (via T9 Nomor Referensi) SK Y (`surat-masuk.service.ts:193-212`).
- **The deadlock:** two different units deadlock when each one's "last row" is the other's target.

After P3, these 8 `db.transaction` calls all reach surat → rangkaian locks through the P3 hooks:

| File | Line | Method |
|---|---|---|
| `surat-keluar.service.ts` | `:198` | create |
| `surat-keluar.service.ts` | `:388` | update |
| `surat-keluar.service.ts` | `:459` | delete |
| `surat-masuk.service.ts` | `:193` | create |
| `surat-masuk.service.ts` | `:331` | update |
| `surat-masuk.service.ts` | `:404` | delete |
| `approval.service.ts` | `:378` | approve |
| `approval.service.ts` | `:537` | reject |

Required changes:
- **Wrap only those 8 calls:** `await denganRetryDeadlock(() => db.transaction(async (tx) => { … }))`.
  - Work done before the transaction stays outside the wrapper, so a retry never repeats an external side effect. That work is the route-level blob upload (`surat-masuk.routes.ts:259-279`) and `prepareExisting` (`surat-keluar.service.ts:189-194`).
  - Existing `catch` mappings stay around the wrapper.
- **Move the helper.** Implement `denganRetryDeadlock` in `backend/src/utils/deadlock-retry.ts`; it only needs `hasPostgresErrorCode` and `ConflictError`. `deps.ts` re-exports it (T1), and the amend:89-99 location changes to match. This keeps P0 services out of the `deps.ts` import graph.
- **Tests.** In the `surat-keluar.service.test.ts` and `approval.service` unit tests:
  - the first `db.transaction` rejects with `{ cause: { code: '40P01' } }`;
  - the second resolves;
  - expect 2 calls and a normal result.



### Task 9: Registrasi surat masuk — disposisi multi-unit dan Nomor Referensi (skenario d)

**Files:**
- Modify: `backend/src/services/rangkaian/tindak-lanjut.service.ts` (tambah `referensiSuratMasuk`)
- Modify: `backend/src/services/rangkaian/tindak-lanjut.hook.ts` (tambah `afterSuratMasukInsert`)
- Modify: `backend/src/services/surat-masuk.service.ts:1-27` (impor), `:160-292` (create)
- Modify: `backend/src/routes/surat-masuk.routes.ts:273-291` (kirim `actor`)
- Modify: `backend/src/__tests__/surat-masuk.service.test.ts:54-60,136-183`
- Test: `backend/src/__tests__/tindak-lanjut.hook.test.ts`, `backend/integration/registrasi-surat-masuk.postgres.test.ts`

**Interfaces:**
- Consumes: `distributionService.distributeMany(data, audit, tx)` (Task 7); `recordAccessService.checkRead`, `aktor`, `rangkaianService.ensureForSurat/ensureForSuratMasuk/attach` (P1), `recomputeRangkaian` (deps); `DisposisiRoutingInput` (Task 5).
- Produces: `tindakLanjutService.referensiSuratMasuk(tx, { user, suratMasuk: { id, unitKerjaId }, referensi: { jenis: 'surat_keluar'; id }, audit? }): Promise<{ rangkaianId: string; lanjutanDariId: string | null; dibukaKembali: boolean }>`; hook `afterSuratMasukInsert(tx, { user?, inserted, disposisi?, referensi?, audit? }): Promise<{ referensi; disposisi: SuratDistribution[] } | null>`; `suratMasukService.create(input: CreateSuratMasukInput, ...)` dengan `CreateSuratMasukInput = Omit<NewSuratMasuk, 'disposisi'> & { disposisi?: string[] | DisposisiRoutingInput | null; referensi?: {...}; actor?: RecordUser | null }`.

- [ ] **Step 1: Tulis test hook yang gagal**

```ts
// backend/src/__tests__/tindak-lanjut.hook.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ referensi: vi.fn(), distributeMany: vi.fn(), attach: vi.fn() }));
vi.mock('../config/database', () => ({ db: {} }));
vi.mock('../services/rangkaian/tindak-lanjut.service.js', () => ({
    tindakLanjutService: { referensiSuratMasuk: mocks.referensi, attachSuratKeluar: mocks.attach },
}));
vi.mock('../services/distribution.service.js', () => ({ distributionService: { distributeMany: mocks.distributeMany } }));
vi.mock('../services/rangkaian/deps.js', () => ({ recomputeForSuratKeluar: vi.fn() }));

const { afterSuratMasukInsert } = await import('../services/rangkaian/tindak-lanjut.hook.js');
const tx = {} as any;
const user = { id: 'user-tu', role: 'admin_unit', unitKerjaId: 'sesditjen' };
const inserted = { id: 'sm-1', unitKerjaId: 'sesditjen' };

describe('afterSuratMasukInsert', () => {
    beforeEach(() => {
        mocks.referensi.mockReset().mockResolvedValue({ rangkaianId: 'rs-1', lanjutanDariId: null, dibukaKembali: false });
        mocks.distributeMany.mockReset().mockResolvedValue([{ id: 'dist-1' }]);
    });

    it('tidak melakukan apa pun tanpa disposisi maupun referensi', async () => {
        expect(await afterSuratMasukInsert(tx, { user, inserted })).toBeNull();
        expect(mocks.distributeMany).not.toHaveBeenCalled();
    });

    it('referensi diproses sebelum disposisi, keduanya di transaksi yang sama', async () => {
        const urutan: string[] = [];
        mocks.referensi.mockImplementation(async () => { urutan.push('referensi'); return { rangkaianId: 'rs-1', lanjutanDariId: null, dibukaKembali: false }; });
        mocks.distributeMany.mockImplementation(async () => { urutan.push('disposisi'); return [{ id: 'dist-1' }]; });
        const disposisi = { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }], instruksi: 'Mohon ditindaklanjuti' };
        await afterSuratMasukInsert(tx, { user, inserted, disposisi, referensi: { jenis: 'surat_keluar', id: 'sk-1' }, audit: { userId: 'user-tu' } });
        expect(urutan).toEqual(['referensi', 'disposisi']);
        expect(mocks.distributeMany).toHaveBeenCalledWith({
            suratMasukId: 'sm-1', sourceUnitId: 'sesditjen', targets: disposisi.targets, instruksi: 'Mohon ditindaklanjuti', sentBy: 'user-tu',
        }, { userId: 'user-tu' }, tx);
    });

    it('menolak registrasi berantai tanpa pengguna', async () => {
        await expect(afterSuratMasukInsert(tx, { user: null, inserted, disposisi: { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: false }] } }))
            .rejects.toMatchObject({ statusCode: 400 });
    });
});
```

Di `backend/src/__tests__/surat-masuk.service.test.ts` tambahkan setelah `vi.mock('../config/database', ...)` (baris 54):

```ts
const hookMocks = vi.hoisted(() => ({
    afterSuratMasukInsert: vi.fn(async () => null as any),
    guardSuratMasukMutation: vi.fn(async () => null as any),
    afterSuratMasukMutation: vi.fn(async () => undefined),
}));
vi.mock('../services/rangkaian/tindak-lanjut.hook.js', () => hookMocks);
```

dan di `describe('create')` tambahkan:

```ts
        it('meneruskan routing disposisi ke hook dan menyimpan label tambahan saja', async () => {
            enqueue([], [templateRow], [{ noUrut: 5 }], [{ id: 'new', noUrut: 6, unitKerjaId: 'u1' }], [{ id: 'new', noUrut: 6, disposisi: ['Kabag Umum', 'Dit. BPPT'] }]);
            hookMocks.afterSuratMasukInsert.mockResolvedValueOnce({ referensi: null, disposisi: [{ id: 'dist-1' }] });
            const actor = { id: 'user-tu', role: 'admin_unit', unitKerjaId: 'u1' };
            const routing = { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }], instruksi: 'Mohon ditindaklanjuti', labelTambahan: ['Kabag Umum'] };
            const res = await svc.create({ unitKerjaId: 'u1', tahun: 2026, tanggalSurat: '2026-08-01', disposisi: routing, actor } as any);
            expect(capturedValues.at(-1)).toMatchObject({ disposisi: ['Kabag Umum'] });
            expect(hookMocks.afterSuratMasukInsert).toHaveBeenCalledWith(expect.anything(), {
                user: actor, inserted: { id: 'new', unitKerjaId: 'u1' }, disposisi: routing, referensi: undefined, audit: undefined,
            });
            expect(res.disposisi).toEqual(['Kabag Umum', 'Dit. BPPT']);
        });

        it('label disposisi lama tetap disimpan tanpa memanggil hook berantai', async () => {
            enqueue([], [templateRow], [], [{ id: 'new', noUrut: 1, unitKerjaId: 'u1' }]);
            await svc.create({ unitKerjaId: 'u1', tahun: 2026, tanggalSurat: '2026-03-17', disposisi: ['Ditjen'] } as any);
            expect(capturedValues.at(-1)).toMatchObject({ disposisi: ['Ditjen'] });
            expect(hookMocks.afterSuratMasukInsert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ disposisi: undefined, referensi: undefined }));
            expect(resultQueue).toHaveLength(0);
        });
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/tindak-lanjut.hook.test.ts src/__tests__/surat-masuk.service.test.ts`
Expected: FAIL — `afterSuratMasukInsert` tidak diekspor; label routing tidak dipisah.

- [ ] **Step 3: Implementasi `referensiSuratMasuk` dan hook**

Tambahkan ke objek `tindakLanjutService` di `tindak-lanjut.service.ts`:

```ts
    /**
     * Skenario (d): surat masuk membalas surat keluar kita. Rujukan aktif/selesai →
     * gabung dengan relasi 'merujuk' (selesai dibuka kembali, diaudit); rujukan
     * diberkaskan → rangkaian BARU dengan lanjutan_dari_id (tidak mewarisi jangkauan).
     */
    async referensiSuratMasuk(tx: Tx, params: {
        user: RecordUser;
        suratMasuk: { id: string; unitKerjaId: string };
        referensi: { jenis: 'surat_keluar'; id: string };
        audit?: CriticalAuditContext;
    }): Promise<{ rangkaianId: string; lanjutanDariId: string | null; dibukaKembali: boolean }> {
        const { user, suratMasuk: sm, referensi, audit } = params;
        const akses = await recordAccessService.checkRead(user, 'surat_keluar', referensi.id, tx);
        if (!akses.exists || !akses.allowed) throw new NotFoundError('Surat rujukan');
        const actor = aktor(user, audit);
        const rujukan = await rangkaianService.ensureForSurat(tx, { jenis: 'surat_keluar', id: referensi.id }, actor);
        if (rujukan.status === 'diberkaskan') {
            const baru = await rangkaianService.ensureForSuratMasuk(tx, sm.id, actor);
            await tx.execute(sql`UPDATE rangkaian_surat SET lanjutan_dari_id = ${rujukan.rangkaianId}, updated_at = now() WHERE id = ${baru.rangkaianId}`);
            if (audit) {
                await auditLogService.logActionOrThrow({ ...audit, action: 'update', entityType: 'rangkaian_surat', entityId: baru.rangkaianId,
                    changes: { after: { lanjutanDariId: rujukan.rangkaianId }, suratMasukId: sm.id, rujukanSuratKeluarId: referensi.id } }, tx);
            }
            return { rangkaianId: baru.rangkaianId, lanjutanDariId: rujukan.rangkaianId, dibukaKembali: false };
        }
        // P1 attach: anggota + relasi 'merujuk'; rangkaian 'selesai' dibuka kembali (audit status_change).
        const hasil = await rangkaianService.attach(tx, {
            rangkaianId: rujukan.rangkaianId,
            surat: { jenis: 'surat_masuk', id: sm.id },
            keAnggotaId: rujukan.anggotaId,
            jenisRelasi: 'merujuk',
            keterangan: null,
            sumber: 'aplikasi',
        }, actor);
        await recomputeRangkaian(tx, rujukan.rangkaianId, audit);
        return { rangkaianId: rujukan.rangkaianId, lanjutanDariId: null, dibukaKembali: hasil.reopened };
    },
```

Tambahkan ke `tindak-lanjut.hook.ts`:

```ts
import { distributionService } from '../distribution.service.js';
import type { DisposisiRoutingInput } from '../../validators/schemas.js';

export async function afterSuratMasukInsert(tx: Tx, ctx: {
    user?: RecordUser | null;
    inserted: { id: string; unitKerjaId: string };
    disposisi?: DisposisiRoutingInput;
    referensi?: { jenis: 'surat_keluar'; id: string };
    audit?: CriticalAuditContext;
}) {
    if (!ctx.disposisi && !ctx.referensi) return null;
    if (!ctx.user?.id) {
        throw new ValidationError('Registrasi dengan disposisi atau Nomor Referensi memerlukan pengguna yang terautentikasi.');
    }
    const referensi = ctx.referensi
        ? await tindakLanjutService.referensiSuratMasuk(tx, { user: ctx.user, suratMasuk: ctx.inserted, referensi: ctx.referensi, audit: ctx.audit })
        : null;
    const disposisi = ctx.disposisi
        ? await distributionService.distributeMany({
            suratMasukId: ctx.inserted.id,
            sourceUnitId: ctx.inserted.unitKerjaId,
            targets: ctx.disposisi.targets,
            instruksi: ctx.disposisi.instruksi ?? null,
            sentBy: ctx.user.id,
        }, ctx.audit, tx)
        : [];
    return { referensi, disposisi };
}
```

(Impor `sql` dari `drizzle-orm` dan `NotFoundError` sudah ada di `tindak-lanjut.service.ts`.)

- [ ] **Step 4: Ubah `SuratMasukService.create` dan route**

Di `backend/src/services/surat-masuk.service.ts` tambah impor:

```ts
import { afterSuratMasukInsert } from './rangkaian/tindak-lanjut.hook.js';
import type { DisposisiRoutingInput } from '../validators/schemas.js';
import type { RecordUser } from './record-access.service.js';

export type CreateSuratMasukInput = Omit<NewSuratMasuk, 'disposisi'> & {
    disposisi?: string[] | DisposisiRoutingInput | null;
    referensi?: { jenis: 'surat_keluar'; id: string };
    actor?: RecordUser | null;
};
```

Ubah tanda tangan `create(` (baris 160-161) menjadi `async create(\n        input: CreateSuratMasukInput,` dan sisipkan di baris pertama badan fungsi:

```ts
        const { disposisi: disposisiInput, referensi, actor, ...rest } = input;
        const routing = disposisiInput && !Array.isArray(disposisiInput) ? disposisiInput : undefined;
        // Label text[] hanya berisi label lama/Kabag; nama unit ditambahkan oleh distribute().
        const labels = Array.isArray(disposisiInput) ? disposisiInput : routing?.labelTambahan;
        const data = { ...rest, ...(labels ? { disposisi: labels } : {}) } as NewSuratMasuk;
```

Ubah `createImported(data: NewSuratMasuk, ...)` agar meneruskan `data as CreateSuratMasukInput`. Setelah blok `if (preparedAttachment) {...}` (baris 251) sisipkan:

```ts
                const registrasi = await afterSuratMasukInsert(tx, {
                    user: actor ?? null,
                    inserted: { id: inserted.id, unitKerjaId: inserted.unitKerjaId },
                    disposisi: routing,
                    referensi,
                    audit: auditContext,
                });
                const tersimpan = registrasi
                    ? (await tx.select().from(suratMasuk).where(eq(suratMasuk.id, inserted.id)).limit(1))[0]
                    : inserted;
```

Di audit create (baris 259-267) tambah `disposisiUnitIds: routing?.targets.map((t) => t.unitKerjaId) ?? null, referensiSuratKeluarId: referensi?.id ?? null,` pada `after`, dan ganti `return (await hydrateSuratRuleSelections(tx, [inserted], 'masuk'))[0];` (baris 281) menjadi `return (await hydrateSuratRuleSelections(tx, [tersimpan], 'masuk'))[0];`.

Di `backend/src/routes/surat-masuk.routes.ts` pada `suratMasukService.create({` (baris 273) tambah `actor: req.user,` setelah `createdBy: req.user?.id,`.

- [ ] **Step 5: Jalankan test unit, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/tindak-lanjut.hook.test.ts src/__tests__/surat-masuk.service.test.ts src/services/__tests__/surat-masuk.service.test.ts src/routes/__tests__/surat-masuk.routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Tulis test Postgres registrasi (skenario d)**

```ts
// backend/integration/registrasi-surat-masuk.postgres.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

const state = vi.hoisted(() => ({ db: null as any }));
const proxy = () => ({ db: new Proxy({}, { get: (_t, key) => {
    const value = state.db?.[key];
    return typeof value === 'function' ? value.bind(state.db) : value;
} }) });
vi.mock('../src/config/database', proxy);
vi.mock('../src/config/database.js', proxy);
vi.mock('../src/services/srikandi-producer.service.js', () => ({ srikandiBusinessProducer: {
    suratMasukCreated: async () => {}, suratKeluarCreated: async () => {},
} }));

const { suratMasukService } = await import('../src/services/surat-masuk.service.js');

let h: RangkaianTestDatabase;
let tu: TestUser; let bppt: TestUser;
const audit = () => ({ userId: tu.id, userEmail: tu.email });
const catat = (extra: Record<string, unknown>) => suratMasukService.create({
    unitKerjaId: 'sesditjen', tanggalSurat: '2026-09-21', perihal: 'Tanggapan atas surat Direktorat', dari: 'Pemda Sintetis',
    createdBy: tu.id, actor: tu, ...extra,
} as any, audit());

beforeAll(async () => {
    h = await createRangkaianTestDatabase('registrasi');
    state.db = h.db;
    await h.seedUnits();
    tu = await h.seedUser('admin_unit', 'sesditjen');
    bppt = await h.seedUser('admin_unit', 'dir_bppt');
}, 120_000);
afterAll(async () => { await h?.close(); });

describe('registrasi surat masuk dengan disposisi dan Nomor Referensi', () => {
    it('registrasi + disposisi: satu transaksi membuat surat, rangkaian, dan dua disposisi', async () => {
        const sm = await catat({ nomorSurat: 'EXT-1/2026', disposisi: { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }, { unitKerjaId: 'dir_ptep' }], instruksi: 'Mohon ditindaklanjuti', labelTambahan: ['Kabag Program dan Hukum'] } });
        expect(sm.disposisi).toEqual(['Kabag Program dan Hukum', 'Dit. BPPT', 'Dit. PTEP']);
        const dist = await h.query('SELECT target_unit_id, rangkaian_id FROM surat_distributions WHERE surat_masuk_id = $1 ORDER BY target_unit_id', [sm.id]);
        expect(dist.map((d: any) => d.target_unit_id)).toEqual(['dir_bppt', 'dir_ptep']);
        expect(dist[0].rangkaian_id).toBeTruthy();
    });

    it('registrasi gagal seluruhnya bila disposisi tidak sah (tidak ada surat yatim)', async () => {
        await expect(catat({ nomorSurat: 'EXT-2/2026', disposisi: { targets: [{ unitKerjaId: 'bagian_umum' }] } })).rejects.toMatchObject({ statusCode: 400 });
        expect(await h.query("SELECT id FROM surat_masuk WHERE nomor_surat = 'EXT-2/2026'")).toEqual([]);
    });

    it('rujukan aktif/selesai: bergabung dengan relasi merujuk dan membuka kembali rangkaian selesai', async () => {
        const sk = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'B-5/2026', approvalStatus: 'approved', asalNaskah: 'inisiatif' });
        const sm1 = await catat({ nomorSurat: 'EXT-3/2026', referensi: { jenis: 'surat_keluar', id: sk } });
        const [anggota] = await h.query('SELECT rangkaian_id FROM rangkaian_anggota WHERE surat_masuk_id = $1', [sm1.id]);
        await h.query("UPDATE rangkaian_surat SET status = 'selesai', selesai_at = now() WHERE id = $1", [anggota.rangkaian_id]);
        const sm2 = await catat({ nomorSurat: 'EXT-4/2026', referensi: { jenis: 'surat_keluar', id: sk } });
        const [a2] = await h.query('SELECT rangkaian_id FROM rangkaian_anggota WHERE surat_masuk_id = $1', [sm2.id]);
        expect(a2.rangkaian_id).toBe(anggota.rangkaian_id);
        const [{ n }] = await h.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'rangkaian_surat' AND action = 'status_change' AND entity_id = $1 AND changes->'after'->>'status' = 'aktif'", [anggota.rangkaian_id]);
        expect(n).toBeGreaterThanOrEqual(1);
    });

    it('rujukan diberkaskan: rangkaian baru dengan lanjutan_dari_id yang tidak mewarisi jangkauan', async () => {
        const sk = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'B-6/2026', approvalStatus: 'approved', asalNaskah: 'inisiatif' });
        const sm1 = await catat({ nomorSurat: 'EXT-5/2026', referensi: { jenis: 'surat_keluar', id: sk } });
        const [lama] = await h.query('SELECT rangkaian_id FROM rangkaian_anggota WHERE surat_masuk_id = $1', [sm1.id]);
        const klasifikasi = await h.ensureKlasifikasi();
        await h.query(`UPDATE rangkaian_surat SET status = 'diberkaskan', unit_pengolah_id = 'dir_bppt', klasifikasi_item_id = $2, diberkaskan_at = now(), diberkaskan_by = $3 WHERE id = $1`, [lama.rangkaian_id, klasifikasi, tu.id]);
        const sm2 = await catat({ nomorSurat: 'EXT-6/2026', referensi: { jenis: 'surat_keluar', id: sk } });
        const [baru] = await h.query(`SELECT rs.id, rs.lanjutan_dari_id FROM rangkaian_anggota a JOIN rangkaian_surat rs ON rs.id = a.rangkaian_id WHERE a.surat_masuk_id = $1`, [sm2.id]);
        expect(baru.id).not.toBe(lama.rangkaian_id);
        expect(baru.lanjutan_dari_id).toBe(lama.rangkaian_id);
    });

    it('rujukan yang tidak dapat dibaca pencatat → 404 tanpa kebocoran', async () => {
        const skRahasia = await h.insertSuratKeluar({ unitKerjaId: 'dir_ptep', nomorSurat: 'R-9/2026', klasifikasiKeamanan: 'rahasia', approvalStatus: 'approved' });
        await expect(catat({ nomorSurat: 'EXT-7/2026', referensi: { jenis: 'surat_keluar', id: skRahasia } })).rejects.toMatchObject({ statusCode: 404 });
    });
});
```

Run: `cd backend && TEST_POSTGRES_URL=postgresql://simsa_test:simsa_test@127.0.0.1:5432/simsa_test npx vitest run --config vitest.postgres.config.ts integration/registrasi-surat-masuk.postgres.test.ts`
Expected: PASS (5 test).

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/rangkaian/tindak-lanjut.service.ts backend/src/services/rangkaian/tindak-lanjut.hook.ts backend/src/services/surat-masuk.service.ts backend/src/routes/surat-masuk.routes.ts backend/src/__tests__/tindak-lanjut.hook.test.ts backend/src/__tests__/surat-masuk.service.test.ts backend/integration/registrasi-surat-masuk.postgres.test.ts
git commit -m "feat(registrasi): surat masuk dengan disposisi multi-unit dan Nomor Referensi (lanjutan bila diberkaskan)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


#### Amandemen pra-eksekusi Task 9 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


**Interfaces: add this note** [T9-1]:

> P1 `attach` membuka kembali rangkaian `selesai`, tetapi `recomputeRangkaian` langsung setelahnya menutupnya lagi (`deriveRangkaianStatus`, `backend/src/services/rangkaian-status.ts:34-44`) sampai Task 12 menambahkan fakta `suratMasukBelumDitangani`. Test Postgres Task 9 hanya menegaskan baris audit pembukaan kembali; asersi status akhir `aktif` untuk jalur referensi ada di Task 12.

**`referensiSuratMasuk`:** use `aktorPenulis`. After `attach`, when `hasil.reopened` is true, recompute all SM members of `hasil.rangkaianId`: read the ids, `lockSuratMasukRows`, then `recomputeSuratMasuk`, the same snippet as Task 8. The newly registered SM row is already locked by the create. [T9-2]

**Hook deps mock** (`tindak-lanjut.hook.test.ts`, plan:3548): add `lockSuratMasukRows: vi.fn(async () => [])`, `aktorPenulis: (u, a) => ({ ...(a ?? {}), userId: 'u' })` and `recomputeSuratMasuk: vi.fn(async () => [])`.

---


**C-4 (critic) — Tasks 8, 9, 12, 13: deadlock retry at the P0 transaction boundaries that P3 extends (**BLOCKING, RB:91**) [C-4]**


G-RETRY (amend:19) wraps only P3-owned transactions. T8-3 (amend:401-403, rul:113) nevertheless claims that the real SK/SM inversion is "ditangani `denganRetryDeadlock` di batas transaksi terluar". No amendment wraps those boundaries.

The inversion is concrete:
- **SK create:** locks the unit template, then the **existing** last SK row FOR UPDATE, then (via T8) SM X (`surat-keluar.service.ts:198-217`).
- **SM registration:** locks the template, then the last SM row FOR UPDATE, then (via T9 Nomor Referensi) SK Y (`surat-masuk.service.ts:193-212`).
- **The deadlock:** two different units deadlock when each one's "last row" is the other's target.

After P3, these 8 `db.transaction` calls all reach surat → rangkaian locks through the P3 hooks:

| File | Line | Method |
|---|---|---|
| `surat-keluar.service.ts` | `:198` | create |
| `surat-keluar.service.ts` | `:388` | update |
| `surat-keluar.service.ts` | `:459` | delete |
| `surat-masuk.service.ts` | `:193` | create |
| `surat-masuk.service.ts` | `:331` | update |
| `surat-masuk.service.ts` | `:404` | delete |
| `approval.service.ts` | `:378` | approve |
| `approval.service.ts` | `:537` | reject |

Required changes:
- **Wrap only those 8 calls:** `await denganRetryDeadlock(() => db.transaction(async (tx) => { … }))`.
  - Work done before the transaction stays outside the wrapper, so a retry never repeats an external side effect. That work is the route-level blob upload (`surat-masuk.routes.ts:259-279`) and `prepareExisting` (`surat-keluar.service.ts:189-194`).
  - Existing `catch` mappings stay around the wrapper.
- **Move the helper.** Implement `denganRetryDeadlock` in `backend/src/utils/deadlock-retry.ts`; it only needs `hasPostgresErrorCode` and `ConflictError`. `deps.ts` re-exports it (T1), and the amend:89-99 location changes to match. This keeps P0 services out of the `deps.ts` import graph.
- **Tests.** In the `surat-keluar.service.test.ts` and `approval.service` unit tests:
  - the first `db.transaction` rejects with `{ cause: { code: '40P01' } }`;
  - the second resolves;
  - expect 2 calls and a normal result.



## D. Disposisi: Kotak, Penyelesaian, Tolak, Tutup

### Task 10: Kotak disposisi bertopeng, terima eksplisit, penyelesaian dengan `checkRead`, tolak

**Files:**
- Modify: `backend/src/services/distribution.service.ts:104-165` (`findInbox`), `:257-308` (`receive` tetap), `:313-363` (`process`), `:368-421` (`reject`), tambah `kandidatPenyelesaian`
- Modify: `backend/src/routes/distribution.routes.ts:71-89` (inbox), `:229-303` (receive/process/reject), tambah `GET /:id/kandidat-penyelesaian`
- Modify: `backend/src/__tests__/distribution.service.test.ts:107-200`, `backend/src/__tests__/distribution-layanan.routes.test.ts:33-35,110-145`
- Test: `backend/integration/kotak-disposisi.postgres.test.ts`

**Interfaces:**
- Consumes: `recordAccessService.checkRead/checkMany`, `recomputeRangkaian`, `recomputeSuratMasuk` (deps); `disposisiGrantService.cabut` (Task 6); `processDistributionSchema`/`ProcessDistributionInput` (Task 5); `jakartaDate()`; `rangkaianSurat` (P1 schema).
- Produces: `findInbox(unitKerjaId, filters: DistributionFilters & { lewatBatas?: boolean }, user?: RecordUser)` → baris `{ ...distribusi, surat, sourceUnit, rangkaian: { id, kode } | null, masked: boolean }` (baris tersamar: `suratMasukId: null`, `surat: { id: null, nomorSurat: null, perihal: null, dari: null, tanggalSurat: null, sifatSurat: null, label: 'Dikecualikan' }`, `instruction/catatanPenyelesaian/rejectionReason/penyelesaianSuratKeluarId: null`); `process(distributionId, unitScope, auditContext, penyelesaian: ProcessDistributionInput, actor: RecordUser)`; `reject(...)` kini mencabut grant disposisi dan menghitung ulang; `kandidatPenyelesaian(distributionId, unitKerjaId): Promise<Array<{ id; nomorSurat; perihal; tanggalSurat }>>`; `PESAN_BELUM_DAPAT_MEMBACA`; `GET /api/distributions/inbox?lewatBatas=true`; `GET /api/distributions/:id/kandidat-penyelesaian`; `PUT /api/distributions/:id/process` body `processDistributionSchema`.

- [ ] **Step 1: Perbarui test unit (gagal)**

Di `backend/src/__tests__/distribution.service.test.ts` ganti `describe('findInbox')`, `describe('process')`, dan `describe('reject')` (baris 107-200) dengan:

```ts
    const USER = { id: 'user-1', role: 'admin_unit', unitKerjaId: 'unit-1' };

    describe('findInbox', () => {
        const baris = { distribution: { id: 'd1', suratMasukId: 's1', instruction: 'Rahasia: segera', status: 'sent' },
            surat: { id: 's1', nomorSurat: 'R-1', perihal: 'Tukar guling', dari: 'Pemda', tanggalSurat: '2026-09-01', sifatSurat: 'rahasia' },
            sourceUnit: { id: 'sesditjen', name: 'Sesditjen' }, rangkaian: { id: 'rs-1', kode: 'RS-2026-000001' } };

        it('menampilkan baris terbaca apa adanya', async () => {
            rangkaianMocks.checkMany.mockResolvedValueOnce(new Map([['surat_masuk:s1', { allowed: true }]]));
            enqueue([{ count: 1 }], [baris]);
            const res = await svc.findInbox('unit-1', {}, USER);
            expect(res.data[0]).toMatchObject({ id: 'd1', masked: false, surat: { perihal: 'Tukar guling' }, rangkaian: { kode: 'RS-2026-000001' } });
        });

        it('baris yang tidak boleh dibaca tetap tampil tersamar tanpa id surat', async () => {
            rangkaianMocks.checkMany.mockResolvedValueOnce(new Map([['surat_masuk:s1', { allowed: false }]]));
            enqueue([{ count: 1 }], [baris]);
            const res = await svc.findInbox('unit-1', {}, USER);
            expect(res.data[0]).toMatchObject({
                id: 'd1', masked: true, suratMasukId: null, instruction: null,
                surat: { id: null, nomorSurat: null, perihal: null, dari: null, label: 'Dikecualikan' },
            });
            expect(JSON.stringify(res.data[0])).not.toContain('s1');
        });

        it('should apply status filter', async () => {
            rangkaianMocks.checkMany.mockResolvedValueOnce(new Map());
            enqueue([{ count: 0 }], []);
            const res = await svc.findInbox('unit-1', { status: 'received', page: 1, limit: 10, lewatBatas: true }, USER);
            expect(res.data).toEqual([]);
        });
    });

    describe('process', () => {
        const dist = { id: 'dist-1', status: 'sent', suratMasukId: 'sm-1', targetUnitId: 'unit-1', rangkaianId: 'rs-1', receivedAt: null, receivedBy: null };

        beforeEach(() => rangkaianMocks.checkRead.mockReset().mockResolvedValue({ exists: true, allowed: true }));

        it('menyelesaikan dengan catatan, menerima implisit, mencabut grant, dan menghitung ulang', async () => {
            enqueue([{ rangkaianId: 'rs-1' }], [dist], [{ ...dist, status: 'processed' }]);
            const res = await svc.process('dist-1', 'unit-1', { userId: 'user-1' }, { catatanPenyelesaian: 'Sudah dikoordinasikan' }, USER);
            expect(res.status).toBe('processed');
            expect(auditMocks.logActionOrThrow.mock.calls.map(([entry]: any[]) => entry.action)).toEqual(['receive_distribution', 'process_distribution']);
            expect(rangkaianMocks.cabut).toHaveBeenCalledWith(mockDb, expect.objectContaining({ distribusiId: 'dist-1', actorId: 'user-1' }), { userId: 'user-1' });
            expect(rangkaianMocks.recomputeRangkaian).toHaveBeenCalledWith(mockDb, 'rs-1', { userId: 'user-1' });
            expect(rangkaianMocks.recomputeSuratMasuk).toHaveBeenCalledWith(mockDb, ['sm-1'], { userId: 'user-1' });
        });

        it('403 bila induk tidak dapat dibaca', async () => {
            rangkaianMocks.checkRead.mockResolvedValueOnce({ exists: true, allowed: false });
            enqueue([{ rangkaianId: 'rs-1' }], [dist]);
            await expect(svc.process('dist-1', 'unit-1', undefined, { catatanPenyelesaian: 'Sudah dikoordinasikan' }, USER))
                .rejects.toMatchObject({ statusCode: 403 });
            expect(resultQueue).toHaveLength(0);
        });

        it('422 bila surat keluar penyelesaian tidak sah', async () => {
            enqueue([{ rangkaianId: 'rs-1' }], [dist], []);
            await expect(svc.process('dist-1', 'unit-1', undefined, { penyelesaianSuratKeluarId: 'sk-x' }, USER))
                .rejects.toMatchObject({ statusCode: 422 });
        });

        it.each(['rejected', 'processed'])('menolak disposisi berstatus %s', async (status) => {
            enqueue([{ rangkaianId: 'rs-1' }], [{ ...dist, status }]);
            await expect(svc.process('dist-1', 'unit-1', undefined, { catatanPenyelesaian: 'Sudah dikoordinasikan' }, USER))
                .rejects.toThrow(/sudah selesai atau ditolak/);
        });

        it('menolak transisi bersamaan', async () => {
            enqueue([{ rangkaianId: 'rs-1' }], [{ ...dist, status: 'received' }], []);
            await expect(svc.process('dist-1', 'unit-1', undefined, { catatanPenyelesaian: 'Sudah dikoordinasikan' }, USER))
                .rejects.toThrow(/sudah selesai atau ditolak/);
        });

        it('menolak tanpa penyelesaian atau aktor', async () => {
            await expect(svc.process('dist-1', 'unit-1')).rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe('reject', () => {
        it('menolak dengan alasan, mencabut grant, dan menghitung ulang rangkaian', async () => {
            enqueue([{ rangkaianId: 'rs-1' }]);
            enqueue([{ id: 'dist-1', status: 'sent', rangkaianId: 'rs-1', suratMasukId: 'sm-1' }]);
            enqueue([{ id: 'dist-1', status: 'rejected', rejectionReason: 'Salah unit', rangkaianId: 'rs-1', suratMasukId: 'sm-1' }]);
            const res = await svc.reject('dist-1', 'Salah unit', 'unit-1', { userId: 'user-1' });
            expect(res.status).toBe('rejected');
            expect(rangkaianMocks.cabut).toHaveBeenCalledWith(mockDb, { distribusiId: 'dist-1', actorId: 'user-1', alasan: 'Disposisi ditolak unit tujuan: Salah unit' }, { userId: 'user-1' });
            expect(rangkaianMocks.recomputeRangkaian).toHaveBeenCalledWith(mockDb, 'rs-1', { userId: 'user-1' });
        });

        it('should throw if distribution not found', async () => {
            enqueue([]);
            await expect(svc.reject('missing', 'reason', 'unit-1')).rejects.toThrow();
        });

        it('should throw if already processed', async () => {
            enqueue([{ rangkaianId: null }], [{ id: 'dist-1', status: 'processed' }]);
            await expect(svc.reject('dist-1', 'reason', 'unit-1')).rejects.toThrow();
        });

        it('mengunci rangkaian sebelum baris distribusi (urutan kunci §11)', async () => {
            enqueue([{ rangkaianId: 'rs-1' }], [{ id: 'dist-1', status: 'sent', rangkaianId: 'rs-1' }], [{ id: 'dist-1', status: 'rejected', rangkaianId: 'rs-1' }]);
            await svc.reject('dist-1', 'Salah unit', 'unit-1');
            expect(rangkaianMocks.lockRangkaian).toHaveBeenCalledWith(mockDb, ['rs-1']);
        });
    });
```

Di `backend/src/__tests__/distribution-layanan.routes.test.ts`:
- tambahkan `checkRead: vi.fn(),` pada `mocks.recordAccess` dan di `beforeEach`: `mocks.recordAccess.checkRead.mockResolvedValue({ exists: true, allowed: true, unitKerjaId: 'unit-a' });`
- tambahkan `kandidatPenyelesaian: vi.fn(),` pada `mocks.distribution`;
- ubah ekspektasi `findInbox` menjadi `expect(mocks.distribution.findInbox).toHaveBeenCalledWith('unit-a', expect.objectContaining({ lewatBatas: false }), expect.objectContaining({ id: 'user-1' }));`
- ubah dua ekspektasi `process` menjadi `toHaveBeenCalledWith('dist-1', 'unit-a', expect.objectContaining({ userId: 'user-1' }), {}, expect.objectContaining({ id: 'user-1' }))` (dan `'unit-b'` untuk kasus super_admin);
- tambahkan test:

```ts
    it('menolak Terima untuk surat yang belum dapat dibaca, tetapi Tolak tetap diizinkan', async () => {
        mocks.recordAccess.checkRead.mockResolvedValue({ exists: true, allowed: false, unitKerjaId: 'sesditjen' });
        await request(app).put('/distributions/dist-1/receive').expect(403);
        await request(app).put('/distributions/dist-1/reject').send({ reason: 'Bukan unit tujuan' }).expect(200);
        expect(mocks.distribution.receive).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/distribution.service.test.ts src/__tests__/distribution-layanan.routes.test.ts`
Expected: FAIL — baris tidak disamarkan, `process` masih menolak status `sent`, `cabut` tidak dipanggil.

- [ ] **Step 3: Implementasi di `distribution.service.ts`**

Tambah impor:

```ts
import { type SQL } from 'drizzle-orm';
import { rangkaianSurat } from '../db/schema';
import { ForbiddenError } from '../utils/errors.js';
import { jakartaDate } from '../utils/jakarta-date.js';
import { lockRangkaian, recordAccessService, recomputeSuratMasuk } from './rangkaian/deps.js';
import { rowsOf } from './rangkaian/sql-rows.js';
import type { RecordUser } from './record-access.service.js';
import type { ProcessDistributionInput } from '../validators/schemas.js';

export const PESAN_BELUM_DAPAT_MEMBACA = 'Surat belum dapat Anda baca. Ajukan akses atau hubungi TU sebelum menindaklanjuti disposisi.';
const PESAN_PENYELESAIAN_TIDAK_SAH = 'Surat keluar penyelesaian harus sudah disetujui, milik unit Anda, dan anggota rangkaian yang sama.';

type InboxRow = {
    distribution: SuratDistribution;
    surat: { id: string; nomorSurat: string | null; perihal: string | null; dari: string | null; tanggalSurat: string | null; sifatSurat: string | null };
    sourceUnit: { id: string; name: string };
    rangkaian: { id: string | null; kode: string | null } | null;
};

/** Placeholder §4.8: metadata routing tetap, isi surat dan turunannya disamarkan. */
function samarkanBarisKotak(row: InboxRow) {
    return {
        ...row.distribution,
        suratMasukId: null,
        instruction: null,
        catatanPenyelesaian: null,
        rejectionReason: null,
        penyelesaianSuratKeluarId: null,
        surat: { id: null, nomorSurat: null, perihal: null, dari: null, tanggalSurat: null, sifatSurat: null, label: 'Dikecualikan' as const },
        sourceUnit: row.sourceUnit,
        rangkaian: row.rangkaian?.id ? row.rangkaian : null,
        masked: true,
    };
}
```

Ganti `findInbox` (baris 107-165) dengan:

```ts
    /**
     * Kotak disposisi: baris milik target SELALU tampil (routing), disamarkan bila
     * kelasnya tidak boleh dibaca, sehingga target tetap bisa Tolak dan pengawas
     * bisa Tutup Disposisi (§5).
     */
    async findInbox(
        unitKerjaId: string,
        filters: DistributionFilters & { lewatBatas?: boolean } = {},
        user?: RecordUser,
    ) {
        const { status, page = 1, limit = 20, lewatBatas } = filters;
        const offset = (page - 1) * limit;
        const conditions = [eq(suratDistributions.targetUnitId, unitKerjaId)];
        if (status) conditions.push(eq(suratDistributions.status, status));
        if (lewatBatas) {
            conditions.push(sql`${suratDistributions.batasWaktu} < ${jakartaDate()}::date AND ${suratDistributions.status} IN ('sent', 'received')`);
        }

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(suratDistributions)
            .where(and(...conditions));

        const data: InboxRow[] = await db
            .select({
                distribution: suratDistributions,
                surat: {
                    id: suratMasuk.id,
                    nomorSurat: suratMasuk.nomorSurat,
                    perihal: suratMasuk.perihal,
                    dari: suratMasuk.dari,
                    tanggalSurat: suratMasuk.tanggalSurat,
                    sifatSurat: suratMasuk.sifatSurat,
                },
                sourceUnit: { id: unitKerja.id, name: unitKerja.name },
                rangkaian: { id: rangkaianSurat.id, kode: rangkaianSurat.kode },
            })
            .from(suratDistributions)
            .innerJoin(suratMasuk, eq(suratDistributions.suratMasukId, suratMasuk.id))
            .innerJoin(unitKerja, eq(suratDistributions.sourceUnitId, unitKerja.id))
            .leftJoin(rangkaianSurat, eq(rangkaianSurat.id, suratDistributions.rangkaianId))
            .where(and(...conditions))
            .orderBy(desc(suratDistributions.sentAt))
            .limit(limit)
            .offset(offset) as InboxRow[];

        const akses = user
            ? await recordAccessService.checkMany(user, data.map((row) => ({ type: 'surat_masuk' as const, id: row.surat.id })), db)
            : new Map();

        return {
            data: data.map((row) => (akses.get(`surat_masuk:${row.surat.id}`)?.allowed === true
                ? { ...row.distribution, surat: row.surat, sourceUnit: row.sourceUnit, rangkaian: row.rangkaian?.id ? row.rangkaian : null, masked: false }
                : samarkanBarisKotak(row))),
            pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
        };
    }
```

Ganti `process` (baris 313-363) dengan:

```ts
    /**
     * Penyelesaian disposisi: checkRead atas induk wajib; surat keluar penyelesaian
     * harus approved, milik unit target, dan anggota rangkaian yang sama. `sent`
     * diterima implisit di transaksi yang sama (diaudit). Grant disposisi dicabut.
     */
    async process(
        distributionId: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        auditContext?: CriticalAuditContext,
        penyelesaian?: ProcessDistributionInput,
        actor?: RecordUser,
    ) {
        if (!penyelesaian || !actor?.id) {
            throw new ValidationError('Penyelesaian memerlukan surat keluar penyelesaian atau catatan minimal 10 karakter.');
        }
        return db.transaction(async (tx) => {
            const distribution = await this.kunciDisposisi(tx, this.targetRecordWhere(distributionId, unitScope));
            if (!distribution) throw new AppError('Distribution not found', 404);
            if (distribution.status !== 'sent' && distribution.status !== 'received') {
                throw new ValidationError('Disposisi sudah selesai atau ditolak');
            }
            const baca = await recordAccessService.checkRead(actor, 'surat_masuk', distribution.suratMasukId, tx);
            if (!baca.exists || !baca.allowed) throw new ForbiddenError(PESAN_BELUM_DAPAT_MEMBACA);

            const skId = 'penyelesaianSuratKeluarId' in penyelesaian ? penyelesaian.penyelesaianSuratKeluarId : null;
            const catatan = 'catatanPenyelesaian' in penyelesaian ? penyelesaian.catatanPenyelesaian : null;
            if (skId) {
                const [sah] = rowsOf(await tx.execute(sql`
                    SELECT sk.id FROM surat_keluar sk
                      JOIN rangkaian_anggota a ON a.surat_keluar_id = sk.id
                     WHERE sk.id = ${skId} AND sk.is_deleted IS NOT TRUE AND sk.approval_status = 'approved'
                       AND sk.unit_kerja_id = ${distribution.targetUnitId} AND a.rangkaian_id = ${distribution.rangkaianId}`));
                if (!sah) throw new AppError(PESAN_PENYELESAIAN_TIDAK_SAH, 422);
            }

            const now = new Date();
            const [result] = await tx
                .update(suratDistributions)
                .set({
                    status: 'processed',
                    processedAt: now,
                    processedBy: actor.id,
                    receivedAt: distribution.receivedAt ?? now,
                    receivedBy: distribution.receivedBy ?? actor.id,
                    penyelesaianSuratKeluarId: skId,
                    catatanPenyelesaian: catatan,
                    updatedAt: now,
                })
                .where(and(
                    this.targetRecordWhere(distributionId, unitScope),
                    inArray(suratDistributions.status, ['sent', 'received']),
                ))
                .returning();
            if (!result) throw new ValidationError('Disposisi sudah selesai atau ditolak');

            if (auditContext) {
                if (distribution.status === 'sent') {
                    await auditLogService.logActionOrThrow({
                        ...auditContext, action: 'receive_distribution', entityType: 'surat_distribution', entityId: distributionId,
                        changes: { before: { status: 'sent' }, after: { status: 'received' }, implisit: true, via: 'penyelesaian' },
                    }, tx);
                }
                await auditLogService.logActionOrThrow({
                    ...auditContext, action: 'process_distribution', entityType: 'surat_distribution', entityId: distributionId,
                    changes: { before: { status: distribution.status }, after: { status: 'processed', penyelesaianSuratKeluarId: skId, catatanPenyelesaian: catatan } },
                }, tx);
            }
            await disposisiGrantService.cabut(tx, { distribusiId: distributionId, actorId: actor.id, alasan: 'Disposisi telah diselesaikan oleh unit tujuan.' }, auditContext);
            if (result.rangkaianId) await recomputeRangkaian(tx, result.rangkaianId, auditContext);
            await recomputeSuratMasuk(tx, [result.suratMasukId], auditContext);
            return result;
        });
    }
```

Tambahkan helper privat (dipakai `process`, `reject`, dan `tutupOlehPengawas`) agar urutan kunci selalu rangkaian → distribusi, sama dengan jalur tindak lanjut (mencegah deadlock):

```ts
    /** Kunci baris rangkaian (id menaik) SEBELUM baris distribusi, lalu kembalikan distribusi terkunci. */
    private async kunciDisposisi(tx: Tx, where: SQL) {
        const [awal] = await tx.select({ rangkaianId: suratDistributions.rangkaianId })
            .from(suratDistributions).where(where).limit(1);
        if (!awal) return undefined;
        if (awal.rangkaianId) await lockRangkaian(tx, [awal.rangkaianId]);
        const [distribution] = await tx.select().from(suratDistributions).where(where).limit(1).for('update');
        return distribution;
    }
```

Di `reject`, ganti blok `const [distribution] = await tx.select()...limit(1);` (baris 375-379) dengan `const distribution = await this.kunciDisposisi(tx, this.targetRecordWhere(distributionId, unitScope));`, lalu sebelum `return result;` (baris 419) sisipkan:

```ts
        await disposisiGrantService.cabut(tx, {
            distribusiId: distributionId,
            actorId: auditContext?.userId || distribution.receivedBy || distribution.sentBy || '',
            alasan: `Disposisi ditolak unit tujuan: ${reason}`,
        }, auditContext);
        if (result.rangkaianId) await recomputeRangkaian(tx, result.rangkaianId, auditContext);
```

Tambahkan metode baru sebelum `findById`:

```ts
    /** Surat keluar approved milik unit target di rangkaian yang sama — kandidat Penyelesaian. */
    async kandidatPenyelesaian(distributionId: string, unitKerjaId: string) {
        return rowsOf<{ id: string; nomorSurat: string | null; perihal: string | null; tanggalSurat: string | null }>(await db.execute(sql`
            SELECT sk.id, sk.nomor_surat AS "nomorSurat", sk.perihal, sk.tanggal_surat::text AS "tanggalSurat"
              FROM surat_distributions d
              JOIN rangkaian_anggota a ON a.rangkaian_id = d.rangkaian_id AND a.surat_keluar_id IS NOT NULL
              JOIN surat_keluar sk ON sk.id = a.surat_keluar_id
             WHERE d.id = ${distributionId} AND d.target_unit_id = ${unitKerjaId}
               AND sk.unit_kerja_id = ${unitKerjaId} AND sk.is_deleted IS NOT TRUE AND sk.approval_status = 'approved'
             ORDER BY sk.tanggal_surat DESC NULLS LAST, sk.id`));
    }
```

- [ ] **Step 4: Implementasi di `distribution.routes.ts`**

Tambah impor `processDistributionSchema` dari `../validators/schemas`. Ganti handler inbox (baris 79-83) agar memanggil:

```ts
        const result = await distributionService.findInbox(unitKerjaId as string, {
            status: status as string,
            page: page ? parseInt(page as string) : 1,
            limit: limit ? parseInt(limit as string) : 20,
            lewatBatas: req.query.lewatBatas === 'true',
        }, req.user);
```

Sisipkan sebelum `router.get('/:id', ...)`:

```ts
router.get('/:id/kandidat-penyelesaian', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = resolveConcreteDistributionUnit(req, res);
        if (!unitKerjaId) return;
        const data = await distributionService.kandidatPenyelesaian(req.params.id as string, unitKerjaId);
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});
```

Ganti handler `receive`, `process`, `reject` (baris 229-303) dengan:

```ts
router.put('/:id/receive', canWriteMiddleware(), async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const unitKerjaId = resolveConcreteDistributionUnit(req, res);
        if (!unitKerjaId) return;
        const record = await distributionService.findById(id, unitKerjaId);
        if (!record) return res.status(404).json({ error: 'Distribution not found' });
        const baca = await recordAccessService.checkRead(req.user, 'surat_masuk', record.surat.id);
        if (!baca.exists || !baca.allowed) {
            return res.status(403).json({ error: 'Surat belum dapat Anda baca. Ajukan akses atau hubungi TU.' });
        }
        const result = await distributionService.receive(id, req.user?.id || '', unitKerjaId,
            { userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip });
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

router.put('/:id/process', canWriteMiddleware(), validateBody(processDistributionSchema), async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const unitKerjaId = resolveConcreteDistributionUnit(req, res);
        if (!unitKerjaId) return;
        if (!(await distributionService.findById(id, unitKerjaId))) {
            return res.status(404).json({ error: 'Distribution not found' });
        }
        const result = await distributionService.process(id, unitKerjaId,
            { userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip }, req.body, req.user);
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

// Tolak tetap tersedia untuk baris tersamar (target tidak perlu dapat membaca surat).
router.put('/:id/reject', canWriteMiddleware(), validateBody(rejectDistributionSchema), async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const { reason } = req.body;
        if (!reason) return res.status(400).json({ error: 'Alasan penolakan wajib diisi' });
        const unitKerjaId = resolveConcreteDistributionUnit(req, res);
        if (!unitKerjaId) return;
        if (!(await distributionService.findById(id, unitKerjaId))) {
            return res.status(404).json({ error: 'Distribution not found' });
        }
        const result = await distributionService.reject(id, reason, unitKerjaId,
            { userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip });
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});
```

Hapus helper `canAccessDistributionInUnit` (baris 41-46) yang kini tidak terpakai.

- [ ] **Step 5: Jalankan test unit, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/distribution.service.test.ts src/__tests__/distribution-layanan.routes.test.ts src/__tests__/notification.service.test.ts`
Expected: PASS.

- [ ] **Step 6: Tulis test Postgres kotak disposisi (termasuk Review Focus #4)**

```ts
// backend/integration/kotak-disposisi.postgres.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

const state = vi.hoisted(() => ({ db: null as any }));
const proxy = () => ({ db: new Proxy({}, { get: (_t, key) => {
    const value = state.db?.[key];
    return typeof value === 'function' ? value.bind(state.db) : value;
} }) });
vi.mock('../src/config/database', proxy);
vi.mock('../src/config/database.js', proxy);

const { distributionService } = await import('../src/services/distribution.service.js');
const { recordAccessGrantService } = await import('../src/services/record-access-grant.service.js');

let h: RangkaianTestDatabase;
let tu: TestUser; let bppt: TestUser; let ptep: TestUser; let superA: TestUser;
let smBiasa: string; let smRahasia: string; let distBppt: string; let distPtepRahasia: string; let rangkaianBiasa: string;
const audit = (u: TestUser) => ({ userId: u.id, userEmail: u.email });

beforeAll(async () => {
    h = await createRangkaianTestDatabase('kotak');
    state.db = h.db;
    await h.seedUnits();
    tu = await h.seedUser('admin_unit', 'sesditjen');
    bppt = await h.seedUser('admin_unit', 'dir_bppt');
    ptep = await h.seedUser('admin_unit', 'dir_ptep');
    superA = await h.seedUser('super_admin', null);
    smBiasa = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-30/2026', perihal: 'Undangan koordinasi' });
    smRahasia = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'R-30/2026', perihal: 'Tukar guling kawasan', sifatSurat: 'Rahasia' });
    const biasa = await distributionService.distributeMany({ suratMasukId: smBiasa, sourceUnitId: 'sesditjen', sentBy: tu.id,
        targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }, { unitKerjaId: 'dir_ptep' }], instruksi: 'Mohon hadir' }, audit(tu));
    distBppt = biasa.find((r) => r.targetUnitId === 'dir_bppt')!.id;
    rangkaianBiasa = biasa[0].rangkaianId!;
    process.env.RANGKAIAN_AJUKAN_AKSES = 'true';
    distPtepRahasia = (await distributionService.distribute({ suratMasukId: smRahasia, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ptep', sentBy: tu.id, instruction: 'Isi rahasia' }, audit(tu))).id;
    delete process.env.RANGKAIAN_AJUKAN_AKSES;
}, 120_000);
afterEach(() => vi.useRealTimers());
afterAll(async () => { await h?.close(); });

describe('kotak disposisi dan penyelesaian', () => {
    it('baris surat yang tidak boleh dibaca tampil tersamar tanpa id surat, perihal, atau instruksi', async () => {
        const { data } = await distributionService.findInbox('dir_ptep', {}, ptep);
        const rahasia = data.find((row: any) => row.id === distPtepRahasia)!;
        expect(rahasia).toMatchObject({ masked: true, suratMasukId: null, instruction: null, surat: { id: null, perihal: null, label: 'Dikecualikan' } });
        expect(JSON.stringify(rahasia)).not.toContain(smRahasia);
        expect(JSON.stringify(rahasia)).not.toContain('Tukar guling');
        expect(data.find((row: any) => row.surat.id === smBiasa)).toMatchObject({ masked: false, instruction: 'Mohon hadir' });
    });

    it('filter lewat batas memakai tanggal Jakarta', async () => {
        await h.query("UPDATE surat_distributions SET batas_waktu = '2026-09-26' WHERE id = $1", [distBppt]);
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-26T17:30:00Z')); // 27 Sep 00.30 WIB
        expect((await distributionService.findInbox('dir_bppt', { lewatBatas: true }, bppt)).data.map((r: any) => r.id)).toEqual([distBppt]);
        vi.setSystemTime(new Date('2026-09-26T16:30:00Z')); // 26 Sep 23.30 WIB
        expect((await distributionService.findInbox('dir_bppt', { lewatBatas: true }, bppt)).data).toEqual([]);
    });

    it('penyelesaian mewajibkan checkRead atas induk (403) dan dapat dibuka setelah grant disetujui', async () => {
        await expect(distributionService.process(distPtepRahasia, 'dir_ptep', audit(ptep), { catatanPenyelesaian: 'Sudah dikoordinasikan dengan TU' }, ptep))
            .rejects.toMatchObject({ statusCode: 403 });
        const [grant] = await h.query<{ id: string }>("SELECT id FROM record_access_grants WHERE target_user_id = $1 AND entity_id = $2 AND status = 'pending'", [ptep.id, smRahasia]);
        await recordAccessGrantService.approve(grant.id, superA.id, 'Disetujui untuk tindak lanjut', new Date(Date.now() + 3600_000), audit(superA));
        await distributionService.process(distPtepRahasia, 'dir_ptep', audit(ptep), { catatanPenyelesaian: 'Sudah dikoordinasikan dengan TU' }, ptep);
        const [g] = await h.query('SELECT status, revoked_by FROM record_access_grants WHERE id = $1', [grant.id]);
        expect(g).toEqual({ status: 'revoked', revoked_by: ptep.id });
    });

    it('penyelesaian dengan surat keluar: harus approved, milik unit target, dan anggota rangkaian yang sama', async () => {
        const skLuar = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'ND-L/2026', approvalStatus: 'approved' });
        await expect(distributionService.process(distBppt, 'dir_bppt', audit(bppt), { penyelesaianSuratKeluarId: skLuar }, bppt))
            .rejects.toMatchObject({ statusCode: 422 });
        const skDraft = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'ND-D/2026', approvalStatus: 'draft' });
        await h.query("INSERT INTO rangkaian_anggota (rangkaian_id, surat_keluar_id, unit_kerja_id, sumber) VALUES ($1, $2, 'dir_bppt', 'aplikasi')", [rangkaianBiasa, skDraft]);
        await expect(distributionService.process(distBppt, 'dir_bppt', audit(bppt), { penyelesaianSuratKeluarId: skDraft }, bppt))
            .rejects.toMatchObject({ statusCode: 422 });
        expect(await distributionService.kandidatPenyelesaian(distBppt, 'dir_bppt')).toEqual([]);
        await h.query("UPDATE surat_keluar SET approval_status = 'approved' WHERE id = $1", [skDraft]);
        expect((await distributionService.kandidatPenyelesaian(distBppt, 'dir_bppt')).map((k) => k.id)).toEqual([skDraft]);
        const selesai = await distributionService.process(distBppt, 'dir_bppt', audit(bppt), { penyelesaianSuratKeluarId: skDraft }, bppt);
        expect(selesai).toMatchObject({ status: 'processed', processedBy: bppt.id, penyelesaianSuratKeluarId: skDraft, receivedBy: bppt.id });
    });
});
```

Run: `cd backend && TEST_POSTGRES_URL=postgresql://simsa_test:simsa_test@127.0.0.1:5432/simsa_test npx vitest run --config vitest.postgres.config.ts integration/kotak-disposisi.postgres.test.ts`
Expected: PASS (4 test).

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/distribution.service.ts backend/src/routes/distribution.routes.ts backend/src/__tests__/distribution.service.test.ts backend/src/__tests__/distribution-layanan.routes.test.ts backend/integration/kotak-disposisi.postgres.test.ts
git commit -m "feat(disposisi): kotak disposisi bertopeng, penyelesaian dengan checkRead, dan pencabutan grant

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


#### Amandemen pra-eksekusi Task 10 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


**Files: change**
- Anchor the service edits on method names. Real locations are `findInbox` `:152-210`, `receive` `:302-353`, `process` `:358-408`, `reject` `:413-466`.
- Anchor the test edits on `describe('findInbox'` `:150`, `describe('process'` `:198`, `describe('reject'` `:226`, and `describe('receive'` `:178`, which **is now modified**. [T10-10, G-ANCHOR]
- **Add:**
  - Modify `distribution.service.ts` `receive` (it is no longer unchanged).
  - Modify `backend/src/routes/distribution.routes.ts` GET `/:id` (`:161-180`).
  - Modify `backend/src/services/notification.service.ts` `getDistributionNotifications` (`:308-350`) and its caller.
  - Modify `backend/src/__tests__/distribution-inbox-classification.test.ts`.
  - Modify `backend/src/__tests__/helpers/surat-inbox-pglite.ts`.
  - Modify `backend/src/middlewares/demo-access.middleware.ts:111` and `backend/src/__tests__/demo-access.middleware.test.ts`.

**Interfaces: add**
- Depends on Task 7: `recomputeRangkaian`, `Tx`, `inArray`, `disposisiGrantService`.
- Depends on Task 1: `lockSuratMasukRows`, `lockRangkaian`, `readRefKey`, `LABEL_DIKECUALIKAN`, `denganRetryDeadlock`.
- Imports are merged into the Task 7 block; no second statement for a module already imported. [G-IMPORT, T10-9]

**`kunciDisposisi`: replace plan:4178-4190 with** [T10-1]:

```ts
/**
 * GC#30: surat_masuk → rangkaian_surat → surat_distributions. Dipakai receive, process, reject,
 * tutupOlehPengawas. Bila rangkaian_id berubah (gabung bersamaan) antara baca awal dan kunci,
 * ulangi sekali; kedua kalinya 409.
 */
private async kunciDisposisi(tx: Tx, where: SQL) {
    for (let ke = 0; ke < 2; ke += 1) {
        const [awal] = await tx.select({ suratMasukId: suratDistributions.suratMasukId, rangkaianId: suratDistributions.rangkaianId })
            .from(suratDistributions).where(where).limit(1);
        if (!awal) return undefined;
        await lockSuratMasukRows(tx, [awal.suratMasukId]);
        if (awal.rangkaianId) await lockRangkaian(tx, [awal.rangkaianId]);
        const [distribution] = await tx.select().from(suratDistributions).where(where).limit(1).for('update');
        if (!distribution) return undefined;
        if (distribution.rangkaianId === awal.rangkaianId) return distribution;
    }
    throw new ConflictError('Data disposisi berubah bersamaan; muat ulang lalu coba lagi.');
}
```

**`process`:** wrap it as `return denganRetryDeadlock(() => db.transaction(async (tx) => { … }))`. `recomputeSuratMasuk(tx, [result.suratMasukId], …)` is now safe because the SM is locked first. Pass `suratMasukId: distribution.suratMasukId` to `cabut` (Task 6 signature).

**`receive` (now modified)** [T10-2]:
- Inside its transaction, replace the plain `tx.select().from(suratDistributions).where(this.targetRecordWhere(distributionId, unitScope)).limit(1)` (`:309-313`) with `const distribution = await this.kunciDisposisi(tx, this.targetRecordWhere(distributionId, unitScope));`.
- Wrap it in `denganRetryDeadlock(() => db.transaction(…))`.
- Why: the UPDATE's BEFORE-row trigger takes FOR SHARE on the rangkaian after the tuple lock (`0046_rangkaian_surat.sql:295-298`), so R must already be held.
- Unit test: extend the `describe('receive')` queue with the extra unlocked read and the lock calls (deps mock).

**`reject`:**
- Use `kunciDisposisi`.
- Replace the `actorId` fallback expression with `const actorId = auditContext?.userId || distribution.receivedBy || distribution.sentBy; if (!actorId) throw new ValidationError('Pelaku penolakan tidak diketahui');`. [T10-8]
- Pass `suratMasukId: distribution.suratMasukId` and `alasan: \`Disposisi ditolak unit tujuan: ${reason}\`` to `cabut`. If the reason is under 10 characters, pad it through the prefix, which is already ≥10.
- Wrap in `denganRetryDeadlock`.

**`findInbox`:**
- Add `sql\`${suratMasuk.isDeleted} IS NOT TRUE\`` to `conditions`. The count query must then `innerJoin(suratMasuk, …)` too. [T10-6]
- Use `akses.get(readRefKey({ type: 'surat_masuk', id: row.surat.id }))`.
- In `samarkanBarisKotak`, use `label: LABEL_DIKECUALIKAN`. [T10-9]

**`kandidatPenyelesaian(distributionId, unitKerjaId, user)`** [T10-7]:
- Add `const ctx = await resolveKonteksBaca(user, db as never);` and `AND (${visibleSql(ctx, { type: 'surat_keluar', alias: 'sk' }, 'list')})`, with `resolveKonteksBaca` and `visibleSql` from deps.
- The route passes `req.user`.

**Receive route.** Use `PESAN_BELUM_DAPAT_MEMBACA` instead of the inline text (plan:4259). [T10-9]

**`GET /api/distributions/:id`: replace the handler** (`backend/src/routes/distribution.routes.ts:161-180`) [T10-4]:

```ts
router.get('/:id', async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const result = await distributionService.findById(id, resolveRecordUnitScope(req));
        if (!result) return res.status(404).json({ error: 'Distribution not found' });
        const pemilik = isAllowedForRecordUnit(req.user, result.sourceUnitId);
        if (!pemilik) {
            const baca = await recordAccessService.checkRead(req.user, 'surat_masuk', result.surat.id);
            if (!baca.exists || !baca.allowed) {
                return res.json({ success: true, data: distributionService.samarkan(result) });
            }
        } else if (!isAllowedForClassification(req.user, result.surat.sifatSurat)) {
            return res.status(404).json({ error: 'Distribution not found' });
        }
        res.json({ success: true, data: { ...result, surat: sanitizeSuratRecord(result.surat, 'surat_masuk') } });
    } catch (error) { next(error); }
});
```

Supporting changes:
- Export a public `samarkan(row)` on `DistributionService`. It returns the `samarkanBarisKotak` shape (no `suratMasukId`, no surat id or content, routing metadata kept).
- Import `isAllowedForRecordUnit` from `record-access.service.js`.
- Add a Postgres case to `kotak-disposisi.postgres.test.ts`: a Terbatas SM disposed to `dir_bppt` with no grant. `GET /api/distributions/:id` as `bpptAdmin` returns `data.surat.id === null`, `data.surat.perihal === null`, `data.suratMasukId === null` and `data.instruction === null`.

**Notifications** [T10-5]:
- `getDistributionNotifications(unitKerjaId, userId, securityClassifications?, knownReadIds?, userRole = 'user', user?: RecordUser)`. When `user` is given:
  - drop the `klasifikasiInSql` condition, but keep `sm.is_deleted IS NOT TRUE`;
  - select `suratMasukId`;
  - run `recordAccessService.checkMany(user, rows.map(r => ({ type: 'surat_masuk', id: r.suratMasukId })))`;
  - for rows that are not `allowed`, set `message: 'Dikecualikan'` (no nomor, perihal or instruction).
- Update the caller to pass `req.user`, and replace the comment "Predikat yang sama dengan DistributionService.findInbox" with "Kebijakan penyamaran sama dengan DistributionService.findInbox (§4.8)".
- Add a `notification.service.test.ts` case: a masked row yields `message === 'Dikecualikan'`.

**`distribution-inbox-classification.test.ts`** [T10-3]:
- In `helpers/surat-inbox-pglite.ts`, add `CREATE TABLE rangkaian_surat (id uuid PRIMARY KEY, kode text NOT NULL);`.
- In the test, `vi.mock('../services/rangkaian/deps.js', …)` with a `recordAccessService.checkMany` that maps allowed classes (`biasa` and aliases) to `allowed:true`, and the rest to `allowed:false`.
- Rewrite the four inbox cases:
  - call `service.findInbox('dir_bppt', { limit: 50 }, { id: 'u', role: 'admin_unit', unitKerjaId: 'dir_bppt' })`;
  - assert all 9 rows are returned;
  - rows 1-5 have `masked:false` with a `surat.id`; rows 6-9 have `masked:true` with `surat.id === null`;
  - `pagination.total === 9`.
- Keep the `findOutbox` case unchanged.

**Allowlist.** At `:111`, extend `${UUID}` to `${UUID}(?:/kandidat-penyelesaian)?`, and add `['GET', \`/api/distributions/${id}/kandidat-penyelesaian\`]` to the `it.each`. [T10-11]

**Unit test fix.** Replace `it('should apply status filter', …)` (plan:3893-3898) with one that captures the `where` argument passed to the chain mock and asserts it contains the status condition, or delete it and rely on `kotak-disposisi.postgres.test.ts`. [T10-10]

**Step 5 run list: add** `src/__tests__/distribution-inbox-classification.test.ts src/__tests__/demo-access.middleware.test.ts src/__tests__/notification.service.test.ts` and `npx tsc --noEmit -p tsconfig.json`.

**Postgres (`kotak-disposisi.postgres.test.ts`): add**
- `catatanPenyelesaian: null` and `rejectionReason: null` to the masked-row assertion (R18 nit).
- A `receive` ∥ `process` `Promise.all` on the same distribution: both settle without 40P01 (one may 400 on status).

---


**C-1 (critic) — Task 10: `GET /api/distributions/:id` uses `checkRead` for every caller and audits cross-unit reads (**BLOCKING, security**) [C-1]**


The amended handler (amend:501-519) still authorizes the **source** unit by role class, via `isAllowedForRecordUnit` plus `isAllowedForClassification`. That is fail-open against `checkRead`:
- **Role class passes Terbatas.** `kelasUntukRole('admin_unit')` is `['biasa','terbatas']` (`backend/src/services/access/visibility-spec.ts:219-226`), so `isAllowedForClassification` passes Terbatas (`record-access.service.ts:57-65`).
- **`checkRead` would refuse.** `evaluateOwnerAccess` requires a grant for every controlled class (`record-access.service.ts:216-225`).
  - A super_admin (`kecocokanUnitRekaman` → `semua`, `visibility-spec.ts:231`) with no grant on a Rahasia SM gets 404 on `GET /api/surat-masuk/:id` (`surat-masuk.routes.ts:183-189`).
  - So does a source-unit admin with no grant on a Terbatas SM.
  - The amended `/distributions/:id` still returns the full `surat_masuk` row to both (`distribution.service.ts:471-483`).
- **No audit on the target branch.** It returns content read via `peserta`/grant with no `view_via_rangkaian` audit. That breaks the P2 invariant (FR:5; compare `surat-masuk.routes.ts:195-206`).

Replace the amend:501-519 handler with:

```ts
router.get('/:id', async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        // findById is already limited to the source OR target unit (accessibleRecordWhere, distribution.service.ts:286-297).
        const result = await distributionService.findById(id, resolveRecordUnitScope(req));
        if (!result) return res.status(404).json({ error: 'Distribution not found' });
        const baca = await recordAccessService.checkRead(req.user, 'surat_masuk', result.surat.id);
        if (!baca.exists || !baca.allowed) {
            return res.json({ success: true, data: distributionService.samarkan(result) }); // a party to the disposisi: routing only
        }
        if (baca.via !== 'owner') {
            await auditLogService.logActionOrThrow({
                userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip,
                action: 'view_via_rangkaian', entityType: 'surat_masuk', entityId: result.surat.id,
                changes: { via: baca.via, rangkaianId: baca.rangkaianId, grantId: baca.grantId, distribusiId: id },
            });
        }
        res.json({ success: true, data: { ...result, surat: sanitizeSuratRecord(result.surat, 'surat_masuk') } });
    } catch (error) { next(error); }
});
```

- Drop the `isAllowedForRecordUnit`/`isAllowedForClassification` imports if they become unused, and import `auditLogService`.
- Add these Postgres cases to `kotak-disposisi.postgres.test.ts`, in addition to the T10-4 case:

| Case | Expected |
|---|---|
| (a) super_admin, Rahasia SM, no grant | `data.surat.perihal === null` |
| (b) source `admin_unit`, own Terbatas SM, no grant | masked |
| (c) target with an approved disposisi grant | full row, plus exactly one `view_via_rangkaian` audit row carrying `grantId` |


**C-9 (critic) — Task 10: the outbox also excludes soft-deleted SMs (FR:28) [C-9]**


`findOutbox` matches the list policy on class but not on deletion:
- Its role-class filter equals the own-unit list clause of `visibleSql` (`visibility-spec.ts:392-397`).
- The list policy also requires `is_deleted IS NOT TRUE` (`:400`), which `findOutbox` lacks (`distribution.service.ts:223-234`).

Changes:
- Add `sql\`${suratMasuk.isDeleted} IS NOT TRUE\`` to `conditions`. It covers both the count and the rows, since both already `innerJoin(suratMasuk)`.
- In `distribution-inbox-classification.test.ts`, the `findOutbox` case gains one soft-deleted SM that must not appear. This is the only change to that case.



### Task 11: Tutup Disposisi oleh pengawas

**Files:**
- Modify: `backend/src/services/distribution.service.ts` (tambah `tutupOlehPengawas`)
- Modify: `backend/src/routes/rangkaian.routes.ts` (route `POST /disposisi/:distribusiId/tutup`)
- Modify: `backend/src/middlewares/demo-access.middleware.ts`, `backend/src/__tests__/demo-access.middleware.test.ts`
- Test: `backend/src/__tests__/rangkaian-aksi.routes.test.ts`, `backend/integration/tutup-disposisi.postgres.test.ts`

**Interfaces:**
- Consumes: `isPengawas`, `recomputeRangkaian`, `recomputeSuratMasuk` (deps); `disposisiGrantService.cabut`; `alasanSchema` (Task 5); `isFullAdmin` (Task 1).
- Produces: `distributionService.tutupOlehPengawas(distribusiId: string, actor: RecordUser, alasan: string, auditContext?): Promise<SuratDistribution>` → `status='processed'`, `ditutup_pengawas=true`, `processed_by=pengawas`, `catatan_penyelesaian=alasan`; route `POST /api/rangkaian/disposisi/:distribusiId/tutup` body `{ alasan ≥10 }`.

- [ ] **Step 1: Tulis test route yang gagal**

```ts
// backend/src/__tests__/rangkaian-aksi.routes.test.ts
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    tutup: vi.fn(),
    user: { id: 'user-tu', email: 't@example.test', name: 'T', role: 'admin_unit', unitKerjaId: 'sesditjen' },
}));
vi.mock('../config/database', () => ({ db: {} }));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => { req.user = { ...mocks.user }; next(); },
}));
vi.mock('../services/distribution.service.js', () => ({ distributionService: { tutupOlehPengawas: mocks.tutup } }));

const { default: router } = await import('../routes/rangkaian.routes');
const app = express();
app.use(express.json());
app.use('/api/rangkaian', router);
app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ error: error.message }));

const DIST = '550e8400-e29b-41d4-a716-446655440000';

describe('POST /api/rangkaian/disposisi/:distribusiId/tutup', () => {
    beforeEach(() => {
        mocks.tutup.mockReset().mockResolvedValue({ id: DIST, status: 'processed', ditutupPengawas: true });
        mocks.user.role = 'admin_unit';
    });

    it('meneruskan alasan dan aktor ke layanan', async () => {
        const res = await request(app).post(`/api/rangkaian/disposisi/${DIST}/tutup`).send({ alasan: 'Target tidak dapat memproses surat lama' }).expect(200);
        expect(res.body.data).toMatchObject({ ditutupPengawas: true });
        expect(mocks.tutup).toHaveBeenCalledWith(DIST, expect.objectContaining({ id: 'user-tu' }), 'Target tidak dapat memproses surat lama', expect.objectContaining({ userId: 'user-tu' }));
    });

    it('400 untuk alasan < 10 karakter atau id bukan UUID', async () => {
        await request(app).post(`/api/rangkaian/disposisi/${DIST}/tutup`).send({ alasan: 'singkat' }).expect(400);
        await request(app).post('/api/rangkaian/disposisi/xyz/tutup').send({ alasan: 'Target tidak dapat memproses' }).expect(400);
        expect(mocks.tutup).not.toHaveBeenCalled();
    });

    it('403 untuk role read-only', async () => {
        mocks.user.role = 'staff';
        await request(app).post(`/api/rangkaian/disposisi/${DIST}/tutup`).send({ alasan: 'Target tidak dapat memproses' }).expect(403);
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/rangkaian-aksi.routes.test.ts`
Expected: FAIL — route 404.

- [ ] **Step 3: Implementasi layanan dan route**

Tambahkan di `DistributionService` (setelah `reject`), dengan impor `isFullAdmin` dari `./rangkaian/roles.js` dan `isPengawas` dari `./rangkaian/deps.js`:

```ts
    /**
     * §2c/§5: pengawas menutup disposisi yang tidak dapat diproses target, agar
     * rangkaian tidak macet. processed + ditutup_pengawas; grant disposisi dicabut.
     */
    async tutupOlehPengawas(distribusiId: string, actor: RecordUser, alasan: string, auditContext?: CriticalAuditContext) {
        return db.transaction(async (tx) => {
            const pengawas = actor.role === 'super_admin'
                || (isFullAdmin(actor) && await isPengawas(actor, tx));
            if (!pengawas || !actor.id) throw new ForbiddenError('Hanya admin unit pengawas yang dapat menutup disposisi.');
            const distribution = await this.kunciDisposisi(tx, eq(suratDistributions.id, distribusiId));
            if (!distribution) throw new AppError('Distribution not found', 404);
            if (distribution.status !== 'sent' && distribution.status !== 'received') {
                throw new ConflictError('Disposisi sudah selesai atau ditolak');
            }
            const now = new Date();
            const [result] = await tx.update(suratDistributions)
                .set({
                    status: 'processed', ditutupPengawas: true, processedBy: actor.id, processedAt: now,
                    catatanPenyelesaian: alasan.trim(), updatedAt: now,
                })
                .where(and(eq(suratDistributions.id, distribusiId), inArray(suratDistributions.status, ['sent', 'received'])))
                .returning();
            if (!result) throw new ConflictError('Disposisi sudah selesai atau ditolak');
            if (auditContext) {
                await auditLogService.logActionOrThrow({
                    ...auditContext, action: 'process_distribution', entityType: 'surat_distribution', entityId: distribusiId,
                    changes: { before: { status: distribution.status }, after: { status: 'processed', ditutupPengawas: true }, alasan: alasan.trim() },
                }, tx);
            }
            await disposisiGrantService.cabut(tx, { distribusiId, actorId: actor.id, alasan: `Disposisi ditutup pengawas: ${alasan.trim()}` }, auditContext);
            if (result.rangkaianId) await recomputeRangkaian(tx, result.rangkaianId, auditContext);
            await recomputeSuratMasuk(tx, [result.suratMasukId], auditContext);
            return result;
        });
    }
```

Di `rangkaian.routes.ts` (impor `alasanSchema` dan `distributionService`):

```ts
import { alasanSchema } from '../validators/schemas';
import { distributionService } from '../services/distribution.service.js';

router.post('/disposisi/:distribusiId/tutup', validateIdParam('distribusiId'), canWriteMiddleware(), validateBody(alasanSchema),
    async (req: AuthRequest, res, next) => {
        try {
            const data = await distributionService.tutupOlehPengawas(req.params.distribusiId as string, req.user!, req.body.alasan, auditOf(req));
            res.json({ success: true, data });
        } catch (error) {
            next(error);
        }
    });
```

Allowlist (demo): `{ methods: POST, path: exact(\`/rangkaian/disposisi/${UUID}/tutup\`) },` dan kasus test `['POST', \`/api/rangkaian/disposisi/${id}/tutup\`]`.

- [ ] **Step 4: Jalankan test route, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/rangkaian-aksi.routes.test.ts src/__tests__/demo-access.middleware.test.ts`
Expected: PASS.

- [ ] **Step 5: Test Postgres tutup disposisi**

```ts
// backend/integration/tutup-disposisi.postgres.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

const state = vi.hoisted(() => ({ db: null as any }));
const proxy = () => ({ db: new Proxy({}, { get: (_t, key) => {
    const value = state.db?.[key];
    return typeof value === 'function' ? value.bind(state.db) : value;
} }) });
vi.mock('../src/config/database', proxy);
vi.mock('../src/config/database.js', proxy);

const { distributionService } = await import('../src/services/distribution.service.js');

let h: RangkaianTestDatabase;
let tu: TestUser; let bppt: TestUser; let sesditjenLama: TestUser;
let dist: string;
const audit = (u: TestUser) => ({ userId: u.id, userEmail: u.email });

beforeAll(async () => {
    h = await createRangkaianTestDatabase('tutup');
    state.db = h.db;
    await h.seedUnits();
    tu = await h.seedUser('admin_unit', 'sesditjen');
    bppt = await h.seedUser('admin_unit', 'dir_bppt');
    sesditjenLama = await h.seedUser('admin_sesditjen', null);
    const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-40/2026' });
    dist = (await distributionService.distribute({ suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ktpp', sentBy: tu.id }, audit(tu))).id;
}, 120_000);
afterAll(async () => { await h?.close(); });

describe('Tutup Disposisi oleh pengawas', () => {
    it('admin direktorat (bukan pengawas) ditolak 403', async () => {
        await expect(distributionService.tutupOlehPengawas(dist, bppt, 'Target tidak dapat memproses', audit(bppt)))
            .rejects.toMatchObject({ statusCode: 403 });
    });

    it('admin_sesditjen lama (unit NULL) tetap pengawas lewat mandat unit efektif', async () => {
        const row = await distributionService.tutupOlehPengawas(dist, sesditjenLama, 'Target tidak dapat memproses surat lama', audit(sesditjenLama));
        expect(row).toMatchObject({ status: 'processed', ditutupPengawas: true, processedBy: sesditjenLama.id, catatanPenyelesaian: 'Target tidak dapat memproses surat lama' });
        const [{ n }] = await h.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'surat_distribution' AND action = 'process_distribution' AND entity_id = $1 AND changes->'after'->>'ditutupPengawas' = 'true'", [dist]);
        expect(n).toBe(1);
    });

    it('disposisi yang sudah ditutup tidak dapat ditutup ulang (409)', async () => {
        await expect(distributionService.tutupOlehPengawas(dist, tu, 'Percobaan menutup ulang', audit(tu)))
            .rejects.toMatchObject({ statusCode: 409 });
    });
});
```

Run: `cd backend && TEST_POSTGRES_URL=postgresql://simsa_test:simsa_test@127.0.0.1:5432/simsa_test npx vitest run --config vitest.postgres.config.ts integration/tutup-disposisi.postgres.test.ts`
Expected: PASS (3 test).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/distribution.service.ts backend/src/routes/rangkaian.routes.ts backend/src/middlewares/demo-access.middleware.ts backend/src/__tests__/demo-access.middleware.test.ts backend/src/__tests__/rangkaian-aksi.routes.test.ts backend/integration/tutup-disposisi.postgres.test.ts
git commit -m "feat(disposisi): Tutup Disposisi oleh admin unit pengawas dengan alasan dan audit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


#### Amandemen pra-eksekusi Task 11 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


**`tutupOlehPengawas`** [T11-1]:
1. Wrap the body in `denganRetryDeadlock(() => db.transaction(async (tx) => { … }))`.
2. Replace the inline pengawas check with a lock-first flow:

   ```ts
   if (!actor.id) throw new ForbiddenError('Hanya admin unit pengawas yang dapat menutup disposisi.');
   const distribution = await this.kunciDisposisi(tx, eq(suratDistributions.id, distribusiId));
   if (!distribution) throw new AppError('Distribution not found', 404);
   const [sm] = await tx.select({ unitKerjaId: suratMasuk.unitKerjaId }).from(suratMasuk).where(eq(suratMasuk.id, distribution.suratMasukId)).limit(1);
   if (!(await pengawasUntukUnit(actor, sm?.unitKerjaId, tx))) throw new ForbiddenError('Hanya admin unit pengawas yang dapat menutup disposisi.');
   ```

3. Import `pengawasUntukUnit` from deps. Drop the separate `isFullAdmin`/`isPengawas` imports if they are unused.
4. Pass `suratMasukId: distribution.suratMasukId` to `cabut`.

**Routes.** Merge the imports (`alasanSchema` into the existing `validators/schemas` import; `distributionService` as a new module import). This relies on `auditOf` and `canWriteMiddleware` from Task 6. [G-IMPORT]

**Tests: add**
- Postgres: a pengawas (sesditjen, `is_unit_pengawas`) closing a disposisi on an SM whose unit is outside `dalamCakupanPengawas`. Create a unit `x_lain` via SQL; expect 403.
- Postgres: `tutupOlehPengawas` ∥ `distributionService.distribute` on the same SM, both via `Promise.all`; both settle without 40P01.

---


**C-7 (critic) — Tasks 11, 16, 25: one predicate for Tutup Disposisi [C-7]**


The amendments anchor Tutup Disposisi on different units:
- T11-1 (amend:567-568) authorizes on the **SM** unit.
- T16-4 (amend:926, 933) offers `tutup_disposisi` from the **rangkaian** tier, which is `dalamCakupanPengawas(unitPencatatId)` (`rangkaian-read.service.ts:290-292`).

After gabung or tautan, an SM from an out-of-scope unit can sit in a rangkaian whose pencatat is in scope, or the reverse. The button then either returns 403, or is hidden while the server would allow the action.

Required changes:
- **Server (T11):** keep the predicate `pengawasUntukUnit(actor, sm.unit_kerja_id)`.
- **404/403 split (F1).** When the predicate is false:
  - return 404 if the actor is neither source nor target and `checkRead(actor,'surat_masuk',sm.id).allowed` is false;
  - otherwise return 403.
- **Offer (T16-4).** Offer `tutup_disposisi` only when `(super_admin || (isFullAdmin && isPengawas))` holds **and** an open disposisi in the rangkaian has its SM unit in scope:

  ```sql
  EXISTS (SELECT 1 FROM surat_distributions d JOIN surat_masuk sm ON sm.id = d.surat_masuk_id
          WHERE d.rangkaian_id = R AND d.status IN ('sent','received') AND <dalamCakupanPengawasSql(sm.unit_kerja_id)>)
  ```

  - `dalamCakupanPengawasSql` is at `visibility-spec.ts:265`; re-export it via deps.
  - For super_admin, drop the scope clause.
- **T25:** keep the per-row button. The server stays authoritative per row.


**Ruling kontroler [CTRL-1] (menimpa G-SA untuk Tutup Disposisi):** Tutup Disposisi hanya untuk admin pengawas sesuai spec:478 (spec mengikat). `super_admin` TIDAK otomatis boleh Tutup Disposisi; ia hanya boleh bila juga memenuhi aturan pengawas biasa (role FULL_ADMIN + unit efektif `is_unit_pengawas` + `dalamCakupanPengawas`). Untuk aksi lain, G-SA (super_admin ⊇ pengawas) tetap berlaku. Konsekuensi: `tutupOlehPengawas` dan `computeRangkaianAksi`/`tutup_disposisi` memakai predikat pengawas tanpa jalan pintas super_admin; butir G-SA di C-12 (gerbang rilis) tidak lagi diperlukan untuk Tutup.



## E. Status Turunan

### Task 12: Status turunan — fakta "surat masuk belum ditangani", `statusAlur`, hook approve/reject/ubah surat keluar

**Files:**
- Modify: `backend/src/services/rangkaian-status.ts` (P1: `RangkaianStatusFacts` + aturan + `deriveStatusAlur`)
- Modify: `backend/src/services/rangkaian.service.ts` (P1: kueri fakta di `recomputeStatus`)
- Create: `backend/src/services/rangkaian/rangkaian-status.service.ts`
- Modify: `backend/src/services/rangkaian/deps.ts` (isi `recomputeForSuratKeluar`)
- Modify: `backend/src/services/approval.service.ts:1-40` (impor), `:496-521` (approve final), `:604-640` (reject)
- Modify: `backend/src/__tests__/approval-signature-security.service.test.ts:30-40` (mock hook)
- Test: `backend/src/__tests__/rangkaian-status-p3.test.ts` (`rangkaian-status.test.ts` milik P1 tidak diubah), `backend/integration/status-turunan.postgres.test.ts`

**Interfaces:**
- Consumes: `deriveRangkaianStatus(facts: RangkaianStatusFacts)`, `deriveSuratMasukStatus`, `rangkaianService.recomputeStatus/recomputeSuratMasukStatus` (P1); `afterSuratKeluarChanged` (Task 8 hook).
- Produces:
  - `RangkaianStatusFacts.suratMasukBelumDitangani?: number` (opsional; tanpa nilai = perilaku P1)
  - `deriveStatusAlur(input: { rangkaianStatus: RangkaianStatus | null; adaDisposisi: boolean; adaTindakLanjut: boolean }): StatusAlur` dengan `StatusAlur = 'terdaftar' | 'didisposisikan' | 'ditindaklanjuti' | 'selesai' | 'diberkaskan'`
  - `rangkaianStatusService.hitungPenghalang(tx, rangkaianId): Promise<{ disposisiTerbuka: number; anggotaBlokir: number }>` — himpunan penghalang sama persis dengan fakta P1 (`open_disposisi`, `blocking_anggota`)
  - `recomputeForSuratKeluar(tx, suratKeluarId, audit?)` (deps) — dipanggil hook `afterSuratKeluarChanged`

Resolusi spec (§2d/§8): surat masuk anggota **belum ditangani** bila tidak punya disposisi `processed` di rangkaiannya **dan** tidak punya relasi aktif `balasan`/`tindak_lanjut` dari surat keluar hidup `approved`. Selama ada yang belum ditangani (dan tidak `selesai_manual`, bukan `data_lama`), rangkaian tetap `aktif` — sehingga surat masuk baru yang bergabung lewat Nomor Referensi benar-benar membuka kembali rangkaian, alih-alih langsung ditutup lagi oleh bukti lama.

- [ ] **Step 1: Tulis test murni yang gagal**

```ts
// backend/src/__tests__/rangkaian-status-p3.test.ts
import { describe, expect, it } from 'vitest';
import { deriveRangkaianStatus, deriveStatusAlur, type RangkaianStatusFacts } from '../services/rangkaian-status';

const dasar: RangkaianStatusFacts = {
    current: 'aktif', asal: 'surat_masuk', selesaiManual: false, openDisposisi: 0,
    processedDisposisi: 0, blockingAnggota: 0, approvedTindakLanjut: 0,
};

describe('fakta suratMasukBelumDitangani (P3)', () => {
    it.each<[string, Partial<RangkaianStatusFacts>, string]>([
        ['surat masuk baru menahan rangkaian aktif walau disposisi lama processed', { current: 'selesai', processedDisposisi: 1, suratMasukBelumDitangani: 1 }, 'aktif'],
        ['rangkaian inisiatif dengan surat masuk merujuk yang belum ditangani tetap aktif', { asal: 'inisiatif', suratMasukBelumDitangani: 1 }, 'aktif'],
        ['selesai manual tetap selesai', { current: 'selesai', selesaiManual: true, suratMasukBelumDitangani: 1 }, 'selesai'],
        ['data_lama tidak dibuka oleh fakta ini', { current: 'selesai', asal: 'data_lama', suratMasukBelumDitangani: 1 }, 'selesai'],
        ['tanpa fakta baru perilaku P1 tetap', { processedDisposisi: 1 }, 'selesai'],
        ['nol surat belum ditangani sama dengan tanpa fakta', { processedDisposisi: 1, suratMasukBelumDitangani: 0 }, 'selesai'],
    ])('%s', (_nama, patch, hasil) => {
        expect(deriveRangkaianStatus({ ...dasar, ...patch })).toBe(hasil);
    });
});

describe('deriveStatusAlur', () => {
    it.each([
        [{ rangkaianStatus: null, adaDisposisi: false, adaTindakLanjut: false }, 'terdaftar'],
        [{ rangkaianStatus: 'aktif', adaDisposisi: true, adaTindakLanjut: false }, 'didisposisikan'],
        [{ rangkaianStatus: 'aktif', adaDisposisi: true, adaTindakLanjut: true }, 'ditindaklanjuti'],
        [{ rangkaianStatus: 'selesai', adaDisposisi: true, adaTindakLanjut: true }, 'selesai'],
        [{ rangkaianStatus: 'diberkaskan', adaDisposisi: false, adaTindakLanjut: false }, 'diberkaskan'],
    ] as const)('%j → %s', (input, hasil) => {
        expect(deriveStatusAlur(input as any)).toBe(hasil);
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/rangkaian-status-p3.test.ts`
Expected: FAIL — `deriveStatusAlur` tidak diekspor; kasus pertama menghasilkan `selesai`.

- [ ] **Step 3: Perluas aturan murni P1**

Di `backend/src/services/rangkaian-status.ts`:

1. Tambahkan bidang pada `RangkaianStatusFacts`:

```ts
    /** P3 (§2d): surat masuk anggota hidup tanpa disposisi processed dan tanpa balasan/tindak lanjut approved. */
    suratMasukBelumDitangani?: number;
```

2. Di `deriveRangkaianStatus`, sisipkan tepat setelah baris `if (facts.selesaiManual) return 'selesai';`:

```ts
    if ((facts.suratMasukBelumDitangani ?? 0) > 0 && facts.asal !== 'data_lama') return 'aktif';
```

3. Tambahkan di akhir berkas:

```ts
export type StatusAlur = 'terdaftar' | 'didisposisikan' | 'ditindaklanjuti' | 'selesai' | 'diberkaskan';

/** §8: statusAlur turunan, dikembalikan API dan tidak disimpan. */
export function deriveStatusAlur(input: { rangkaianStatus: RangkaianStatus | null; adaDisposisi: boolean; adaTindakLanjut: boolean }): StatusAlur {
    if (input.rangkaianStatus === 'diberkaskan') return 'diberkaskan';
    if (input.rangkaianStatus === 'selesai') return 'selesai';
    if (input.adaTindakLanjut) return 'ditindaklanjuti';
    if (input.adaDisposisi) return 'didisposisikan';
    return 'terdaftar';
}
```

- [ ] **Step 4: Jalankan test murni (P1 + P3), pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/rangkaian-status-p3.test.ts src/__tests__/rangkaian-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Isi fakta di `recomputeStatus` P1 dan layanan P3**

Di `backend/src/services/rangkaian.service.ts`, pada kueri fakta `recomputeStatus` (blok `SELECT (SELECT count(*)...) AS open_disposisi, ...`), tambahkan kolom berikut setelah `AS approved_tindak_lanjut`:

```sql
                    ,
                    (SELECT count(*)::int FROM rangkaian_anggota a
                      JOIN surat_masuk sm ON sm.id = a.surat_masuk_id
                      WHERE a.rangkaian_id = ${rangkaian.id}
                        AND sm.is_deleted IS NOT TRUE
                        AND NOT EXISTS (SELECT 1 FROM surat_distributions d
                                         WHERE d.rangkaian_id = ${rangkaian.id} AND d.surat_masuk_id = sm.id AND d.status = 'processed')
                        AND NOT EXISTS (SELECT 1 FROM rangkaian_relasi r
                                          JOIN rangkaian_anggota da ON da.id = r.dari_anggota_id
                                          JOIN surat_keluar k ON k.id = da.surat_keluar_id
                                         WHERE r.ke_anggota_id = a.id AND r.cancelled_at IS NULL
                                           AND r.jenis_relasi IN ('balasan', 'tindak_lanjut')
                                           AND k.is_deleted IS NOT TRUE AND k.approval_status = 'approved')) AS surat_masuk_belum_ditangani
```

tambahkan `surat_masuk_belum_ditangani: number` pada tipe `RangkaianFacts`, dan teruskan `suratMasukBelumDitangani: facts.surat_masuk_belum_ditangani,` pada pemanggilan `deriveRangkaianStatus({...})`. Kunci rangkaian P1 (statement `lockRangkaian` terpisah sebelum kueri fakta) tetap dipertahankan — itulah yang membuat dua penyelesaian bersamaan melihat snapshot terbaru (diuji Task 17 "race").

```ts
// backend/src/services/rangkaian/rangkaian-status.service.ts
import { sql } from 'drizzle-orm';
import type { Tx } from './deps.js';
import { rowsOf } from './sql-rows.js';

export const rangkaianStatusService = {
    /**
     * Penghalang §8/§9 dengan definisi SAMA dengan fakta P1 `open_disposisi` dan
     * `blocking_anggota` — dipakai Tandai Selesai dan Berkaskan.
     */
    async hitungPenghalang(tx: Tx, rangkaianId: string): Promise<{ disposisiTerbuka: number; anggotaBlokir: number }> {
        const [row] = rowsOf<{ disposisi_terbuka: number; anggota_blokir: number }>(await tx.execute(sql`
            SELECT (SELECT count(*)::int FROM surat_distributions d
                     WHERE d.rangkaian_id = ${rangkaianId} AND d.status IN ('sent', 'received')) AS disposisi_terbuka,
                   (SELECT count(*)::int FROM rangkaian_anggota a
                      JOIN surat_keluar k ON k.id = a.surat_keluar_id
                     WHERE a.rangkaian_id = ${rangkaianId}
                       AND k.is_deleted IS NOT TRUE
                       AND k.approval_status IN ('draft', 'pending', 'rejected')
                       AND (a.peran = 'induk' OR EXISTS (
                           SELECT 1 FROM rangkaian_relasi r WHERE r.dari_anggota_id = a.id AND r.cancelled_at IS NULL
                       ))) AS anggota_blokir`));
        return { disposisiTerbuka: row?.disposisi_terbuka ?? 0, anggotaBlokir: row?.anggota_blokir ?? 0 };
    },
};
```

Di `backend/src/services/rangkaian/deps.ts` ganti stub `recomputeForSuratKeluar` dengan:

```ts
/** Setelah surat keluar berubah: hitung ulang rangkaiannya dan surat masuk yang ditujunya. */
export async function recomputeForSuratKeluar(tx: Tx, suratKeluarId: string, audit?: CriticalAuditContext): Promise<void> {
    const [anggota] = barisDari<{ id: string; rangkaian_id: string }>(await tx.execute(sql`
        SELECT id, rangkaian_id FROM rangkaian_anggota WHERE surat_keluar_id = ${suratKeluarId}`));
    if (!anggota) return;
    await recomputeRangkaian(tx, anggota.rangkaian_id, audit);
    const tujuan = barisDari<{ surat_masuk_id: string }>(await tx.execute(sql`
        SELECT DISTINCT ka.surat_masuk_id FROM rangkaian_relasi r
          JOIN rangkaian_anggota ka ON ka.id = r.ke_anggota_id
         WHERE r.dari_anggota_id = ${anggota.id} AND ka.surat_masuk_id IS NOT NULL`));
    await recomputeSuratMasuk(tx, tujuan.map((row) => row.surat_masuk_id), audit);
}
```

- [ ] **Step 6: Hook approve/reject**

Di `backend/src/services/approval.service.ts` tambah impor:

```ts
import { afterSuratKeluarChanged } from './rangkaian/tindak-lanjut.hook.js';
```

Di `approve`, setelah `if (!updatedSurat) throw new ConflictError('Status surat telah berubah.');` (baris 509) sisipkan:

```ts
            if (!nextApproverId) {
                // Persetujuan final: status surat masuk & rangkaian diturunkan di tx yang sama (§5, §8).
                await afterSuratKeluarChanged(tx, suratId, { userId: freshActor.id });
            }
```

Di `reject`, setelah `if (!updatedSurat) throw new ConflictError('Status surat telah berubah.');` (baris 630) sisipkan:

```ts
            await afterSuratKeluarChanged(tx, suratId, { userId: freshActor.id });
```

Di `backend/src/__tests__/approval-signature-security.service.test.ts` tambahkan setelah `vi.mock('../config/database.js', ...)`:

```ts
vi.mock('../services/rangkaian/tindak-lanjut.hook.js', () => ({
    afterSuratKeluarChanged: vi.fn(async () => undefined),
}));
```

- [ ] **Step 7: Test Postgres status turunan**

```ts
// backend/integration/status-turunan.postgres.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

const state = vi.hoisted(() => ({ db: null as any }));
const proxy = () => ({ db: new Proxy({}, { get: (_t, key) => {
    const value = state.db?.[key];
    return typeof value === 'function' ? value.bind(state.db) : value;
} }) });
vi.mock('../src/config/database', proxy);
vi.mock('../src/config/database.js', proxy);
vi.mock('../src/services/srikandi-producer.service.js', () => ({ srikandiBusinessProducer: {
    suratMasukCreated: async () => {}, suratKeluarCreated: async () => {},
} }));

const { suratKeluarService } = await import('../src/services/surat-keluar.service.js');
const { suratMasukService } = await import('../src/services/surat-masuk.service.js');
const { recomputeForSuratKeluar, recomputeSuratMasuk } = await import('../src/services/rangkaian/deps.js');

let h: RangkaianTestDatabase;
let tu: TestUser;
const audit = () => ({ userId: tu.id, userEmail: tu.email });
const approve = (id: string) => h.db.transaction(async (tx: any) => {
    await tx.execute(sql`UPDATE surat_keluar SET approval_status = 'approved' WHERE id = ${id}`);
    await recomputeForSuratKeluar(tx, id, audit());
});
const statusRangkaianSurat = async (kolom: 'surat_masuk_id' | 'surat_keluar_id', id: string) =>
    (await h.query(`SELECT rs.status FROM rangkaian_anggota a JOIN rangkaian_surat rs ON rs.id = a.rangkaian_id WHERE a.${kolom} = $1`, [id]))[0].status;
const buatKeluar = (extra: Record<string, unknown>) => suratKeluarService.create({ unitKerjaId: 'sesditjen', naskahDinas: 'Surat Dinas',
    tanggalSurat: '2026-09-22', perihal: 'Balasan', kepada: 'Pemda', createdBy: tu.id, actor: tu, ...extra } as any, audit());

beforeAll(async () => {
    h = await createRangkaianTestDatabase('statusturunan');
    state.db = h.db;
    await h.seedUnits();
    tu = await h.seedUser('admin_unit', 'sesditjen');
}, 120_000);
afterAll(async () => { await h?.close(); });

describe('status turunan monoton dan diaudit', () => {
    it('balasan draft tidak memicu sudah_dibalas; persetujuan memicu dan diaudit; draft lain yang dihapus tidak memblokir selesai', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-50/2026' });
        const balasan = await buatKeluar({ tindakLanjut: { jenis: 'surat_masuk', suratId: sm, jenisRelasi: 'balasan' } });
        const cadangan = await buatKeluar({ perihal: 'Cadangan', tindakLanjut: { jenis: 'surat_masuk', suratId: sm, jenisRelasi: 'tindak_lanjut' } });
        expect((await h.query('SELECT status FROM surat_masuk WHERE id = $1', [sm]))[0].status).toBe('belum_dibalas');
        await approve(balasan.id);
        expect((await h.query('SELECT status FROM surat_masuk WHERE id = $1', [sm]))[0].status).toBe('sudah_dibalas');
        const [{ n }] = await h.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'surat_masuk' AND action = 'status_change' AND entity_id = $1", [sm]);
        expect(n).toBe(1);
        expect(await statusRangkaianSurat('surat_masuk_id', sm)).toBe('aktif'); // draft cadangan masih memblokir
        await suratKeluarService.delete(cadangan.id, tu.id, 'sesditjen', audit());
        expect(await statusRangkaianSurat('surat_masuk_id', sm)).toBe('selesai');
    });

    it('monoton: status impor sudah_dibalas tanpa bukti rangkaian tidak diturunkan', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-51/2026' });
        await h.query("UPDATE surat_masuk SET status = 'sudah_dibalas' WHERE id = $1", [sm]);
        await h.db.transaction((tx: any) => recomputeSuratMasuk(tx, [sm], audit()));
        expect((await h.query('SELECT status FROM surat_masuk WHERE id = $1', [sm]))[0].status).toBe('sudah_dibalas');
    });

    it('status diturunkan kembali bila buktinya berasal dari rangkaian (relasi dibatalkan)', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-52/2026' });
        const balasan = await buatKeluar({ tindakLanjut: { jenis: 'surat_masuk', suratId: sm, jenisRelasi: 'balasan' } });
        await approve(balasan.id);
        await h.query(`UPDATE rangkaian_relasi SET cancelled_at = now(), cancelled_by = $2, cancellation_reason = 'Salah tautan surat'
            WHERE dari_anggota_id = (SELECT id FROM rangkaian_anggota WHERE surat_keluar_id = $1)`, [balasan.id, tu.id]);
        await h.db.transaction((tx: any) => recomputeSuratMasuk(tx, [sm], audit()));
        expect((await h.query('SELECT status FROM surat_masuk WHERE id = $1', [sm]))[0].status).toBe('belum_dibalas');
    });

    it('surat masuk yang bergabung lewat Nomor Referensi menahan rangkaian inisiatif tetap aktif', async () => {
        const sk = await buatKeluar({ perihal: 'Permintaan data', asalNaskah: 'inisiatif' });
        await approve(sk.id);
        const sm = await suratMasukService.create({ unitKerjaId: 'sesditjen', tanggalSurat: '2026-09-23', perihal: 'Jawaban data',
            dari: 'Pemda', nomorSurat: 'EXT-52/2026', createdBy: tu.id, actor: tu, referensi: { jenis: 'surat_keluar', id: sk.id } } as any, audit());
        expect(await statusRangkaianSurat('surat_masuk_id', sm.id)).toBe('aktif');
    });
});
```

Run: `cd backend && npx vitest run src/__tests__/rangkaian-status-p3.test.ts src/__tests__/rangkaian-status.test.ts src/__tests__/approval-signature-security.service.test.ts src/__tests__/approval-security.routes.test.ts src/__tests__/rangkaian.service.integration.test.ts && TEST_POSTGRES_URL=postgresql://simsa_test:simsa_test@127.0.0.1:5432/simsa_test npx vitest run --config vitest.postgres.config.ts integration/status-turunan.postgres.test.ts integration/tindak-lanjut.postgres.test.ts integration/disposisi.postgres.test.ts integration/kotak-disposisi.postgres.test.ts integration/registrasi-surat-masuk.postgres.test.ts`
Expected: PASS. Bila ada kasus di test P1 `rangkaian.service.integration.test.ts` yang mengharapkan `selesai` padahal surat masuk anggotanya belum ditangani, itu perubahan yang disengaja (§2d): sesuaikan ekspektasi kasus itu dan catat di deskripsi PR.

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/rangkaian-status.ts backend/src/services/rangkaian.service.ts backend/src/services/rangkaian/rangkaian-status.service.ts backend/src/services/rangkaian/deps.ts backend/src/services/approval.service.ts backend/src/__tests__/rangkaian-status-p3.test.ts backend/src/__tests__/approval-signature-security.service.test.ts backend/integration/status-turunan.postgres.test.ts
git commit -m "feat(rangkaian): fakta surat masuk belum ditangani, statusAlur, dan recompute setelah approve/reject

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


#### Amandemen pra-eksekusi Task 12 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


**Files: add**
- Modify `backend/src/services/rangkaian.service.ts`: export the fact builders.
- Modify `backend/src/__tests__/rangkaian-deps.contract.test.ts`: `deriveStatusAlur` and builders via deps.

**Anchors.** Use the text `if (!updatedSurat) throw new ConflictError('Status surat telah berubah.');` in `approve` (`approval.service.ts:511`) and in `reject` (`:628`). [T12-7]

**Step 5: replace the `hitungPenghalang` SQL with a single source of truth** [T12-1]. In `rangkaian.service.ts`, extract from `recomputeStatus` (`:389-418`) and export:

```ts
/** Himpunan penghalang §8 — SATU definisi untuk auto-selesai (recomputeStatus) dan berkaskan/tandai selesai (P3). */
export function anggotaMemblokirSql(rangkaianId: SQL | string): SQL {
    const blocking = sql.join(BLOCKING_APPROVAL_STATUSES.map((s) => sql`${s}`), sql`, `);
    return sql`(SELECT count(*)::int FROM rangkaian_anggota a
        JOIN surat_keluar k ON k.id = a.surat_keluar_id
        WHERE a.rangkaian_id = ${rangkaianId}
          AND k.is_deleted IS NOT TRUE
          AND k.approval_status IN (${blocking})
          AND NOT (
              EXISTS (SELECT 1 FROM rangkaian_relasi r WHERE r.dari_anggota_id = a.id)
              AND NOT EXISTS (SELECT 1 FROM rangkaian_relasi r WHERE r.dari_anggota_id = a.id AND r.cancelled_at IS NULL)
          ))`;
}
export function disposisiTerbukaSql(rangkaianId: SQL | string): SQL {
    return sql`(SELECT count(*)::int FROM surat_distributions d
        JOIN surat_masuk sm ON sm.id = d.surat_masuk_id AND sm.is_deleted IS NOT TRUE
        WHERE d.rangkaian_id = ${rangkaianId} AND d.status IN ('sent', 'received'))`;
}
```

How the builders are used:
- `recomputeStatus` uses `${disposisiTerbukaSql(rangkaian.id)} AS open_disposisi` and `${anggotaMemblokirSql(rangkaian.id)} AS blocking_anggota`.
- It also adds the same `JOIN surat_masuk sm … is_deleted IS NOT TRUE` to `processed_disposisi`. [T12-3]
- Deps re-exports `anggotaMemblokirSql` and `disposisiTerbukaSql`.
- `hitungPenghalang` becomes:

  ```ts
  const [row] = rowsOf<{ disposisi_terbuka: number; anggota_blokir: number }>(await tx.execute(sql`
      SELECT ${disposisiTerbukaSql(rangkaianId)} AS disposisi_terbuka, ${anggotaMemblokirSql(rangkaianId)} AS anggota_blokir`));
  ```

**`recomputeForSuratKeluar` (deps): replace the plan body** [T12-2]:

```ts
export async function recomputeForSuratKeluar(tx: Tx, suratKeluarId: string, audit?: CriticalAuditContext): Promise<void> {
    const [anggota] = barisDari<{ id: string; rangkaian_id: string }>(await tx.execute(sql`
        SELECT id, rangkaian_id FROM rangkaian_anggota WHERE surat_keluar_id = ${suratKeluarId}`));
    if (!anggota) return;
    const tujuan = barisDari<{ surat_masuk_id: string }>(await tx.execute(sql`
        SELECT DISTINCT ka.surat_masuk_id FROM rangkaian_relasi r
          JOIN rangkaian_anggota ka ON ka.id = r.ke_anggota_id
         WHERE r.dari_anggota_id = ${anggota.id} AND ka.surat_masuk_id IS NOT NULL`)).map((r) => r.surat_masuk_id);
    // GC#30: pemanggil memegang baris surat_keluar (approval.service.ts:400); surat_masuk dikunci SEBELUM rangkaian.
    await lockSuratMasukRowsLokal(tx, tujuan);
    await recomputeRangkaian(tx, anggota.rangkaian_id, audit);
    await recomputeSuratMasuk(tx, tujuan, audit);
}
```

**Deps re-exports** [T12-5]:
- `export { deriveStatusAlur } from '../rangkaian-status.js';`
- `export type { StatusAlur } from '../rangkaian-status.js';`
- Contract test: `expect(typeof deps.deriveStatusAlur).toBe('function')` and the builders are functions.

**Postgres (`status-turunan.postgres.test.ts`): add**
- **Gabung-demoted draft induk** [T12-4]. Rangkaian A has a draft SK induk; rangkaian B is aktif with its disposisi processed. Gabung A into B via `rangkaianService.gabung`. Expect `hitungPenghalang(B).anggotaBlokir === 1`. Once Task 14 exists, `tandaiSelesai`/`berkaskan` on B return 409; add that assertion in Task 14's `berkas.postgres.test.ts`.
- **Soft-deleted SM with an open disposisi** does not keep the rangkaian `aktif`. Recompute gives `selesai` once the other evidence exists. [T12-3]
- **Nomor Referensi path, final state** [T9-1]. Register an SM with `referensi` to an approved inisiatif SK whose rangkaian is `selesai`. Expect the final `rangkaian_surat.status === 'aktif'`.
- **Approve ∥ distribute race.** `approvalService.approve` final on an SK that replies to SM X, raced via `Promise.all` with `distributionService.distribute` on X. Both settle without 40P01.

**File Structure (plan:67) / contract (plan:154):** `rangkaianStatusService.{ hitungPenghalang }`. `recomputeForSuratKeluar` is in `deps.ts`. [T12-6]

---


**C-4 (critic) — Tasks 8, 9, 12, 13: deadlock retry at the P0 transaction boundaries that P3 extends (**BLOCKING, RB:91**) [C-4]**


G-RETRY (amend:19) wraps only P3-owned transactions. T8-3 (amend:401-403, rul:113) nevertheless claims that the real SK/SM inversion is "ditangani `denganRetryDeadlock` di batas transaksi terluar". No amendment wraps those boundaries.

The inversion is concrete:
- **SK create:** locks the unit template, then the **existing** last SK row FOR UPDATE, then (via T8) SM X (`surat-keluar.service.ts:198-217`).
- **SM registration:** locks the template, then the last SM row FOR UPDATE, then (via T9 Nomor Referensi) SK Y (`surat-masuk.service.ts:193-212`).
- **The deadlock:** two different units deadlock when each one's "last row" is the other's target.

After P3, these 8 `db.transaction` calls all reach surat → rangkaian locks through the P3 hooks:

| File | Line | Method |
|---|---|---|
| `surat-keluar.service.ts` | `:198` | create |
| `surat-keluar.service.ts` | `:388` | update |
| `surat-keluar.service.ts` | `:459` | delete |
| `surat-masuk.service.ts` | `:193` | create |
| `surat-masuk.service.ts` | `:331` | update |
| `surat-masuk.service.ts` | `:404` | delete |
| `approval.service.ts` | `:378` | approve |
| `approval.service.ts` | `:537` | reject |

Required changes:
- **Wrap only those 8 calls:** `await denganRetryDeadlock(() => db.transaction(async (tx) => { … }))`.
  - Work done before the transaction stays outside the wrapper, so a retry never repeats an external side effect. That work is the route-level blob upload (`surat-masuk.routes.ts:259-279`) and `prepareExisting` (`surat-keluar.service.ts:189-194`).
  - Existing `catch` mappings stay around the wrapper.
- **Move the helper.** Implement `denganRetryDeadlock` in `backend/src/utils/deadlock-retry.ts`; it only needs `hasPostgresErrorCode` and `ConflictError`. `deps.ts` re-exports it (T1), and the amend:89-99 location changes to match. This keeps P0 services out of the `deps.ts` import graph.
- **Tests.** In the `surat-keluar.service.test.ts` and `approval.service` unit tests:
  - the first `db.transaction` rejects with `{ cause: { code: '40P01' } }`;
  - the second resolves;
  - expect 2 calls and a normal result.


**C-6 (critic) — Tasks 12 and 2: open disposisi with a NULL `rangkaian_id` on member SMs, and the backfill lock order [C-6]**


The trigger and the fact queries disagree about NULL-`rangkaian_id` distributions:
- Trigger 0046 treats such a distribution as belonging to every rangkaian its SM is a member of (`0046_rangkaian_surat.sql:255-256`, `:274-281`).
- The P1 facts and the T12-1 builders count only `d.rangkaian_id = R` (`rangkaian.service.ts:394-395`; amend:606-610).

T2-2 accepts a deploy window in which P3 is live before the backfill re-run (amend:141). In that window:
1. A P2-era NULL `sent` row on a member SM does not block Berkaskan.
2. After Berkaskan, receive/process/reject/tutup on that row raise 23514.
3. The backfill re-run's UPDATE (plan:737-739) also raises 23514 inside the batch transaction. The batch rolls back and throws (plan:745-747).
4. The script exits before every later SM, so `sisaTanpaRangkaian: 0` becomes unreachable.

Separately, the backfill's existing-rangkaian path UPDATEs `surat_distributions` without first locking `rangkaian_surat`. That breaks RB:90 and RB:103 ("atau baris rangkaian"), and the path now runs concurrently with live P3 code.

**(a) `disposisiTerbukaSql`** (replaces amend:606-610). Once NULL rows reach 0 this is a no-op; inside the window it fails closed.

```ts
export function disposisiTerbukaSql(rangkaianId: SQL | string): SQL {
    return sql`(SELECT count(*)::int FROM surat_distributions d
        JOIN surat_masuk sm ON sm.id = d.surat_masuk_id AND sm.is_deleted IS NOT TRUE
        WHERE d.status IN ('sent', 'received')
          AND (d.rangkaian_id = ${rangkaianId}
               OR (d.rangkaian_id IS NULL AND EXISTS (SELECT 1 FROM rangkaian_anggota ma
                    WHERE ma.rangkaian_id = ${rangkaianId} AND ma.surat_masuk_id = d.surat_masuk_id))))`;
}
```

**(b) Backfill.** Insert after `let rangkaianId = anggota?.rangkaian_id ?? null;` (plan:710):

```js
if (rangkaianId) {
  const { rows: [rs] } = await client.query('SELECT status FROM rangkaian_surat WHERE id = $1 FOR UPDATE', [rangkaianId]); // RB:90 surat → rangkaian → distribusi
  if (rs.status !== 'aktif' && rs.status !== 'selesai') { dilewati.push({ suratMasukId: surat.id, rangkaianId, status: rs.status }); cursor = surat.id; continue; }
}
```

Supporting changes:
- Return `dilewati` in the result.
- `main` sets `process.exitCode = 1` when `dilewati.length > 0`, and prints the list.
- The runbook exit criterion (amend:142) adds "`dilewati` kosong".
- Test: take an SM that is a member of a `diberkaskan` rangkaian and has a NULL `sent` row. The rest of the batch is filled, `dilewati.length === 1` and `sisaTanpaRangkaian === 1`.



### Task 13: Guard update/delete surat masuk anggota rangkaian

**Files:**
- Modify: `backend/src/services/rangkaian/tindak-lanjut.hook.ts` (tambah `guardSuratMasukMutation`, `afterSuratMasukMutation`)
- Modify: `backend/src/services/surat-masuk.service.ts:294-384` (update), `:386-430` (delete)
- Modify: `backend/src/routes/surat-masuk.routes.ts:465-497` (DELETE meneruskan `alasan`)
- Modify: `backend/src/routes/__tests__/surat-masuk.routes.test.ts:30-37`
- Test: `backend/integration/guard-surat-masuk.postgres.test.ts`

**Interfaces:**
- Consumes: `recomputeRangkaian` (deps), `rowsOf`, `updateSuratMasukSchema.alasan` (Task 5).
- Produces: `guardSuratMasukMutation(tx, { suratMasukId: string; perubahan: Record<string, unknown> | 'hapus'; alasan?: string | null; audit? }): Promise<{ rangkaianId: string } | null>`; `afterSuratMasukMutation(tx, guard, suratMasukId, audit?)`; `suratMasukService.delete(id, deletedBy, unitScope, auditContext?, options?: { alasan?: string })`.

- [ ] **Step 1: Tulis test Postgres yang gagal**

```ts
// backend/integration/guard-surat-masuk.postgres.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

const state = vi.hoisted(() => ({ db: null as any }));
const proxy = () => ({ db: new Proxy({}, { get: (_t, key) => {
    const value = state.db?.[key];
    return typeof value === 'function' ? value.bind(state.db) : value;
} }) });
vi.mock('../src/config/database', proxy);
vi.mock('../src/config/database.js', proxy);

const { suratMasukService } = await import('../src/services/surat-masuk.service.js');
const { distributionService } = await import('../src/services/distribution.service.js');

let h: RangkaianTestDatabase;
let tu: TestUser;
const audit = () => ({ userId: tu.id, userEmail: tu.email });

async function suratDenganRangkaian(nomor: string) {
    const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: nomor, perihal: 'Perihal awal' });
    const [row] = await distributionService.distributeMany({ suratMasukId: sm, sourceUnitId: 'sesditjen', sentBy: tu.id, targets: [{ unitKerjaId: 'dir_bppt' }] }, audit());
    return { sm, rangkaianId: row.rangkaianId!, distribusiId: row.id };
}

beforeAll(async () => {
    h = await createRangkaianTestDatabase('guard');
    state.db = h.db;
    await h.seedUnits();
    tu = await h.seedUser('admin_unit', 'sesditjen');
}, 120_000);
afterAll(async () => { await h?.close(); });

describe('guard surat masuk anggota rangkaian', () => {
    it('rangkaian aktif: ubah perihal wajib alasan ≥10 dan diaudit; kolom lain bebas', async () => {
        const { sm, rangkaianId } = await suratDenganRangkaian('G-1/2026');
        await expect(suratMasukService.update(sm, { perihal: 'Perihal baru' } as any, 'sesditjen', undefined, audit()))
            .rejects.toMatchObject({ statusCode: 400 });
        await suratMasukService.update(sm, { keterangan: 'Catatan tambahan' } as any, 'sesditjen', undefined, audit());
        await suratMasukService.update(sm, { perihal: 'Perihal awal' } as any, 'sesditjen', undefined, audit()); // nilai sama = bukan perubahan
        const hasil = await suratMasukService.update(sm, { perihal: 'Perihal baru', alasan: 'Salah ketik saat registrasi' } as any, 'sesditjen', undefined, audit());
        expect(hasil).toMatchObject({ perihal: 'Perihal baru' });
        expect(hasil).not.toHaveProperty('alasan');
        const [{ n }] = await h.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'rangkaian_surat' AND action = 'update' AND entity_id = $1 AND changes->>'koreksiAnggota' = 'true'", [rangkaianId]);
        expect(n).toBe(1);
    });

    it('rangkaian aktif: soft delete wajib alasan', async () => {
        const { sm } = await suratDenganRangkaian('G-2/2026');
        await expect(suratMasukService.delete(sm, tu.id, 'sesditjen', audit())).rejects.toMatchObject({ statusCode: 400 });
        expect(await suratMasukService.delete(sm, tu.id, 'sesditjen', audit(), { alasan: 'Registrasi ganda oleh operator' })).toMatchObject({ isDeleted: true });
    });

    it('rangkaian diberkaskan: ubah nomor/perihal/sifat dan hapus ditolak 409', async () => {
        const { sm, rangkaianId, distribusiId } = await suratDenganRangkaian('G-3/2026');
        await h.query("UPDATE surat_distributions SET status = 'processed', processed_at = now(), catatan_penyelesaian = 'Selesai ditangani' WHERE id = $1", [distribusiId]);
        const klasifikasi = await h.ensureKlasifikasi();
        await h.query(`UPDATE rangkaian_surat SET status = 'diberkaskan', unit_pengolah_id = 'dir_bppt', klasifikasi_item_id = $2, diberkaskan_at = now(), diberkaskan_by = $3 WHERE id = $1`, [rangkaianId, klasifikasi, tu.id]);
        await expect(suratMasukService.update(sm, { sifatSurat: 'rahasia', alasan: 'Koreksi klasifikasi surat' } as any, 'sesditjen', undefined, audit()))
            .rejects.toMatchObject({ statusCode: 409 });
        await expect(suratMasukService.delete(sm, tu.id, 'sesditjen', audit(), { alasan: 'Registrasi ganda oleh operator' }))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    it('surat tunggal (bukan anggota) tidak memerlukan alasan', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'G-4/2026' });
        expect(await suratMasukService.update(sm, { perihal: 'Bebas diubah' } as any, 'sesditjen', undefined, audit())).toMatchObject({ perihal: 'Bebas diubah' });
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && TEST_POSTGRES_URL=postgresql://simsa_test:simsa_test@127.0.0.1:5432/simsa_test npx vitest run --config vitest.postgres.config.ts integration/guard-surat-masuk.postgres.test.ts`
Expected: FAIL — perubahan tanpa alasan berhasil; `delete` mengabaikan status berkas.

- [ ] **Step 3: Implementasi guard di hook**

Tambahkan ke `backend/src/services/rangkaian/tindak-lanjut.hook.ts`:

```ts
import { sql } from 'drizzle-orm';
import { ConflictError } from '../../utils/errors.js';
import auditLogService from '../audit-log.service.js';
import { recomputeRangkaian } from './deps.js';
import { rowsOf } from './sql-rows.js';

const KOLOM_SENSITIF = ['nomorSurat', 'perihal', 'sifatSurat'] as const;

/**
 * §5: anggota rangkaian diberkaskan → ubah nomor/perihal/sifat & soft delete 409.
 * Anggota rangkaian aktif/selesai → wajib alasan ≥10 yang diaudit.
 */
export async function guardSuratMasukMutation(tx: Tx, ctx: {
    suratMasukId: string;
    perubahan: Record<string, unknown> | 'hapus';
    alasan?: string | null;
    audit?: CriticalAuditContext;
}): Promise<{ rangkaianId: string } | null> {
    const [row] = rowsOf<{ rangkaian_id: string; status: string; nomor_surat: string | null; perihal: string | null; sifat_surat: string | null }>(
        await tx.execute(sql`
            SELECT a.rangkaian_id, rs.status, sm.nomor_surat, sm.perihal, sm.sifat_surat
              FROM rangkaian_anggota a
              JOIN rangkaian_surat rs ON rs.id = a.rangkaian_id
              JOIN surat_masuk sm ON sm.id = a.surat_masuk_id
             WHERE a.surat_masuk_id = ${ctx.suratMasukId}`),
    );
    if (!row) return null;
    const lama: Record<(typeof KOLOM_SENSITIF)[number], string | null> = {
        nomorSurat: row.nomor_surat, perihal: row.perihal, sifatSurat: row.sifat_surat,
    };
    const perubahan = ctx.perubahan;
    const berubah = perubahan === 'hapus'
        ? ['hapus']
        : KOLOM_SENSITIF.filter((kolom) => perubahan[kolom] !== undefined && perubahan[kolom] !== lama[kolom]);
    if (berubah.length === 0) return null;
    if (row.status === 'diberkaskan') {
        throw new ConflictError('Surat ini bagian dari berkas rangkaian yang sudah diberkaskan; nomor, perihal, sifat, dan penghapusan dikunci.');
    }
    const alasan = ctx.alasan?.trim() ?? '';
    if (alasan.length < 10) {
        throw new ValidationError('Perubahan nomor/perihal/sifat atau penghapusan surat dalam rangkaian wajib disertai alasan (minimal 10 karakter).');
    }
    if (ctx.audit) {
        await auditLogService.logActionOrThrow({
            ...ctx.audit, action: 'update', entityType: 'rangkaian_surat', entityId: row.rangkaian_id,
            changes: { koreksiAnggota: true, suratMasukId: ctx.suratMasukId, kolom: berubah, alasan, before: lama },
        }, tx);
    }
    return { rangkaianId: row.rangkaian_id };
}

export async function afterSuratMasukMutation(tx: Tx, guard: { rangkaianId: string } | null, _suratMasukId: string, audit?: CriticalAuditContext) {
    if (guard) await recomputeRangkaian(tx, guard.rangkaianId, audit);
}
```

(Gabungkan impor dengan impor yang sudah ada di berkas — `ValidationError`, `CriticalAuditContext`, `Tx` sudah diimpor sejak Task 8.)

- [ ] **Step 4: Pakai guard di `SuratMasukService.update/delete`**

Tambah impor `guardSuratMasukMutation, afterSuratMasukMutation` dari `./rangkaian/tindak-lanjut.hook.js`. Di `update`, ubah tanda tangan parameter `data` menjadi `data: Partial<SuratMasuk> & { alasan?: string }` dan sisipkan di awal badan `db.transaction(async (tx) => {` (baris 331):

```ts
            const { alasan, ...patch } = data;
            const guard = await guardSuratMasukMutation(tx, { suratMasukId: id, perubahan: patch, alasan, audit: auditContext });
```

Ganti semua pemakaian `data` di dalam transaksi itu (baris 332-378: `hasSuratRuleSelection(data)`, `prepareSuratRuleSelection(tx, 'masuk', data, current)`, `.set({ ...data, ...`, `fields: Object.keys(data)`) menjadi `patch`, lalu sebelum `return result ? ...` (baris 382) sisipkan:

```ts
            if (result) await afterSuratMasukMutation(tx, guard, id, auditContext);
```

Di `delete`, tambah parameter kelima `options: { alasan?: string } = {}` dan sisipkan di awal `db.transaction(async (tx) => {` (baris 404):

```ts
            const guard = await guardSuratMasukMutation(tx, { suratMasukId: id, perubahan: 'hapus', alasan: options.alasan, audit: auditContext });
```

serta sebelum `return result;` sisipkan `if (result) await afterSuratMasukMutation(tx, guard, id, auditContext);`. Tambahkan `alasan: options.alasan ?? null` pada `changes.after` audit delete.

Di `backend/src/routes/surat-masuk.routes.ts` DELETE (baris 481-485) ganti panggilan dengan:

```ts
        const alasan = typeof req.body?.alasan === 'string' ? req.body.alasan : undefined;
        const result = await suratMasukService.delete(id, req.user?.id, unitScope, {
            userId: req.user?.id,
            userEmail: req.user?.email,
            ipAddress: req.ip,
        }, { alasan });
```

Di `backend/src/routes/__tests__/surat-masuk.routes.test.ts` tambah `delete: vi.fn(),` pada mock `suratMasukService` dan test:

```ts
    describe('DELETE /api/surat-masuk/:id', () => {
        it('meneruskan alasan koreksi ke layanan', async () => {
            (suratMasukService.findById as any).mockResolvedValue({ id: '1', unitKerjaId: 'ditjen', isArchived: false });
            (suratMasukService.delete as any).mockResolvedValue({ id: '1' });
            await request(app).delete('/api/surat-masuk/1').send({ alasan: 'Registrasi ganda oleh operator' }).expect(200);
            expect(suratMasukService.delete).toHaveBeenCalledWith('1', 'user-1', 'ditjen', expect.objectContaining({ userId: 'user-1' }), { alasan: 'Registrasi ganda oleh operator' });
        });
    });
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `cd backend && npx vitest run src/routes/__tests__/surat-masuk.routes.test.ts src/__tests__/surat-masuk.service.test.ts && TEST_POSTGRES_URL=postgresql://simsa_test:simsa_test@127.0.0.1:5432/simsa_test npx vitest run --config vitest.postgres.config.ts integration/guard-surat-masuk.postgres.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/rangkaian/tindak-lanjut.hook.ts backend/src/services/surat-masuk.service.ts backend/src/routes/surat-masuk.routes.ts backend/src/routes/__tests__/surat-masuk.routes.test.ts backend/integration/guard-surat-masuk.postgres.test.ts
git commit -m "feat(rangkaian): guard ubah/hapus surat masuk anggota rangkaian dengan alasan dan kunci berkas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


#### Amandemen pra-eksekusi Task 13 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


**Files: change**
- `surat-masuk.routes.ts:465-497` / `481-485` → anchor on `router.delete('/:id'` (`:479-510`, call at `:496-500`). [T13-4]

**Interfaces: add**
- The frontend consumer of `alasan` is in **Task 24** and is mandatory. Without it, TU cannot correct or delete any disposed SM. [T13-3]

**`guardSuratMasukMutation`: replace the unlocked read with** [T13-1]:

```ts
export async function guardSuratMasukMutation(tx: Tx, ctx: {…}): Promise<GuardHasil | null> {
    // GC#30: surat_masuk → rangkaian. Selalu dikunci (update hanya mengunci bila ada pilihan aturan: surat-masuk.service.ts:331-339).
    const [sm] = rowsOf<{ nomor_surat: string | null; perihal: string | null; sifat_surat: string | null }>(await tx.execute(sql`
        SELECT nomor_surat, perihal, sifat_surat FROM surat_masuk WHERE id = ${ctx.suratMasukId} FOR UPDATE`));
    if (!sm) return null;
    const bacaKeanggotaan = async () => rowsOf<{ rangkaian_id: string }>(await tx.execute(sql`
        SELECT rangkaian_id FROM rangkaian_anggota WHERE surat_masuk_id = ${ctx.suratMasukId}`))[0] ?? null;
    let anggota = await bacaKeanggotaan();
    if (!anggota) return null;
    let [r] = await lockRangkaian(tx, [anggota.rangkaian_id]);
    const ulang = await bacaKeanggotaan();                  // gabung bersamaan memindahkan anggota (FK ON UPDATE CASCADE)
    if (ulang && ulang.rangkaian_id !== anggota.rangkaian_id) {
        anggota = ulang;
        [r] = await lockRangkaian(tx, [anggota.rangkaian_id]);
    }
    // … hitung `berubah` dari `sm` seperti rencana; 409 bila r.status === 'diberkaskan'; alasan ≥10 …
    return { rangkaianId: anggota.rangkaian_id, auditTertunda: ctx.audit ? { kolom: berubah, alasan, before: lama } : null };
}
```

**Audit only after a successful write** [T13-2]:
- Move the `logActionOrThrow` of `koreksiAnggota` out of the guard and into `afterSuratMasukMutation(tx, guard, suratMasukId, audit)`, which runs only when `result` is truthy.
- `GuardHasil = { rangkaianId: string; auditTertunda: { kolom: string[]; alasan: string; before: Record<string, string | null> } | null }`.

**Delete route.** Keep `const alasan = typeof req.body?.alasan === 'string' ? req.body.alasan : undefined;`. `express.json` parses DELETE bodies, and `sanitize` keeps `alasan` multiline.

**Tests: add to `guard-surat-masuk.postgres.test.ts`**
- A PUT whose UPDATE matches 0 rows (archived SM) with a valid `alasan` writes no `koreksiAnggota` audit.
- `berkasService.berkaskan` ∥ a guarded update of a member SM: the update either happens before (and is audited), or fails 409 afterwards. It never succeeds after `diberkaskan`.

---


**C-4 (critic) — Tasks 8, 9, 12, 13: deadlock retry at the P0 transaction boundaries that P3 extends (**BLOCKING, RB:91**) [C-4]**


G-RETRY (amend:19) wraps only P3-owned transactions. T8-3 (amend:401-403, rul:113) nevertheless claims that the real SK/SM inversion is "ditangani `denganRetryDeadlock` di batas transaksi terluar". No amendment wraps those boundaries.

The inversion is concrete:
- **SK create:** locks the unit template, then the **existing** last SK row FOR UPDATE, then (via T8) SM X (`surat-keluar.service.ts:198-217`).
- **SM registration:** locks the template, then the last SM row FOR UPDATE, then (via T9 Nomor Referensi) SK Y (`surat-masuk.service.ts:193-212`).
- **The deadlock:** two different units deadlock when each one's "last row" is the other's target.

After P3, these 8 `db.transaction` calls all reach surat → rangkaian locks through the P3 hooks:

| File | Line | Method |
|---|---|---|
| `surat-keluar.service.ts` | `:198` | create |
| `surat-keluar.service.ts` | `:388` | update |
| `surat-keluar.service.ts` | `:459` | delete |
| `surat-masuk.service.ts` | `:193` | create |
| `surat-masuk.service.ts` | `:331` | update |
| `surat-masuk.service.ts` | `:404` | delete |
| `approval.service.ts` | `:378` | approve |
| `approval.service.ts` | `:537` | reject |

Required changes:
- **Wrap only those 8 calls:** `await denganRetryDeadlock(() => db.transaction(async (tx) => { … }))`.
  - Work done before the transaction stays outside the wrapper, so a retry never repeats an external side effect. That work is the route-level blob upload (`surat-masuk.routes.ts:259-279`) and `prepareExisting` (`surat-keluar.service.ts:189-194`).
  - Existing `catch` mappings stay around the wrapper.
- **Move the helper.** Implement `denganRetryDeadlock` in `backend/src/utils/deadlock-retry.ts`; it only needs `hasPostgresErrorCode` and `ConflictError`. `deps.ts` re-exports it (T1), and the amend:89-99 location changes to match. This keeps P0 services out of the `deps.ts` import graph.
- **Tests.** In the `surat-keluar.service.test.ts` and `approval.service` unit tests:
  - the first `db.transaction` rejects with `{ cause: { code: '40P01' } }`;
  - the second resolves;
  - expect 2 calls and a normal result.



## F. Selesai, Berkaskan, Tautan, Gabung

### Task 14: Tandai Selesai, Buka Kembali, Berkaskan (dua langkah), Ubah Unit Pengolah

**Files:**
- Create: `backend/src/services/rangkaian/berkas.service.ts`
- Modify: `backend/src/routes/rangkaian.routes.ts` (5 route)
- Modify: `backend/src/middlewares/demo-access.middleware.ts`, `backend/src/__tests__/demo-access.middleware.test.ts`
- Modify: `backend/src/__tests__/rangkaian-aksi.routes.test.ts`
- Test: `backend/integration/berkas.postgres.test.ts`

**Interfaces:**
- Consumes: `lockRangkaian` (`RangkaianTerkunciP3`), `isPengawas`, `loadJangkauan`, `recomputeSuratMasuk` (deps); `rangkaianStatusService.hitungPenghalang` (Task 12); `selesaiRangkaianSchema`, `alasanSchema`, `berkaskanSchema`, `unitPengolahSchema` (Task 5).
- Produces: `berkasService.unitDalamJangkauanBerkas(executor, rangkaianId): Promise<string[]>`; `berkasService.opsiBerkas(user, rangkaianId): Promise<{ status; unitPengolahId; klasifikasiIndukId: number | null; unitDalamJangkauan: Array<{ id: string; name: string }> }>`; `berkasService.tandaiSelesai(user, id, catatan, audit?)`; `berkasService.bukaKembali(user, id, alasan, audit?)`; `berkasService.berkaskan(user, id, { unitPengolahId, klasifikasiItemId, konfirmasi: true, catatan? }, audit?)`; `berkasService.ubahUnitPengolah(user, id, unitPengolahId, audit?): Promise<{ id; unitPengolahId; aksesBaru: string[] }>`; route `POST /:id/selesai`, `POST /:id/buka-kembali`, `POST /:id/berkaskan`, `PUT /:id/unit-pengolah`, `GET /:id/opsi-berkas`. (`GET /api/rangkaian` — daftar Berkas Rangkaian — dimiliki P4.)

- [ ] **Step 1: Tulis test route & Postgres yang gagal**

Tambahkan ke `backend/src/__tests__/rangkaian-aksi.routes.test.ts` (perluas `mocks` dengan `berkas: { tandaiSelesai: vi.fn(), bukaKembali: vi.fn(), berkaskan: vi.fn(), ubahUnitPengolah: vi.fn(), opsiBerkas: vi.fn() }` dan `vi.mock('../services/rangkaian/berkas.service.js', () => ({ berkasService: mocks.berkas }))`):

```ts
const RS = '650e8400-e29b-41d4-a716-446655440000';

describe('aksi berkas rangkaian', () => {
    beforeEach(() => {
        for (const fn of Object.values(mocks.berkas)) (fn as any).mockReset().mockResolvedValue({ id: RS });
    });

    it('berkaskan wajib konfirmasi dua langkah (400 tanpa konfirmasi)', async () => {
        await request(app).post(`/api/rangkaian/${RS}/berkaskan`).send({ unitPengolahId: 'dir_bppt', klasifikasiItemId: 5 }).expect(400);
        await request(app).post(`/api/rangkaian/${RS}/berkaskan`).send({ unitPengolahId: 'dir_bppt', klasifikasiItemId: 5, konfirmasi: true }).expect(200);
        expect(mocks.berkas.berkaskan).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-tu' }), RS,
            { unitPengolahId: 'dir_bppt', klasifikasiItemId: 5, konfirmasi: true }, expect.objectContaining({ userId: 'user-tu' }));
    });

    it('tandai selesai wajib catatan ≥10; buka kembali wajib alasan ≥10', async () => {
        await request(app).post(`/api/rangkaian/${RS}/selesai`).send({ catatan: 'singkat' }).expect(400);
        await request(app).post(`/api/rangkaian/${RS}/selesai`).send({ catatan: 'Ditangani lewat rapat koordinasi' }).expect(200);
        await request(app).post(`/api/rangkaian/${RS}/buka-kembali`).send({ alasan: 'Ada surat susulan dari Pemda' }).expect(200);
    });

    it('ubah unit pengolah dan opsi berkas', async () => {
        await request(app).put(`/api/rangkaian/${RS}/unit-pengolah`).send({ unitPengolahId: 'dir_ptep' }).expect(200);
        await request(app).get(`/api/rangkaian/${RS}/opsi-berkas`).expect(200);
        expect(mocks.berkas.opsiBerkas).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-tu' }), RS);
    });
});
```

```ts
// backend/integration/berkas.postgres.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

const state = vi.hoisted(() => ({ db: null as any }));
const proxy = () => ({ db: new Proxy({}, { get: (_t, key) => {
    const value = state.db?.[key];
    return typeof value === 'function' ? value.bind(state.db) : value;
} }) });
vi.mock('../src/config/database', proxy);
vi.mock('../src/config/database.js', proxy);

const { distributionService } = await import('../src/services/distribution.service.js');
const { berkasService } = await import('../src/services/rangkaian/berkas.service.js');

let h: RangkaianTestDatabase;
let tu: TestUser; let bppt: TestUser; let ptep: TestUser; let plp: TestUser;
let klasifikasi: number;
const audit = (u: TestUser) => ({ userId: u.id, userEmail: u.email });

async function rangkaianBaru(nomor: string, targets = [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }, { unitKerjaId: 'dir_ptep' }]) {
    const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: nomor });
    const rows = await distributionService.distributeMany({ suratMasukId: sm, sourceUnitId: 'sesditjen', sentBy: tu.id, targets }, audit(tu));
    return { sm, id: rows[0].rangkaianId!, rows };
}

beforeAll(async () => {
    h = await createRangkaianTestDatabase('berkas');
    state.db = h.db;
    await h.seedUnits();
    tu = await h.seedUser('admin_unit', 'sesditjen');
    bppt = await h.seedUser('admin_unit', 'dir_bppt');
    ptep = await h.seedUser('admin_unit', 'dir_ptep');
    plp = await h.seedUser('admin_unit', 'dir_plp');
    klasifikasi = await h.ensureKlasifikasi();
}, 120_000);
afterAll(async () => { await h?.close(); });

describe('berkaskan dan status manual', () => {
    it('berkaskan ditolak selama disposisi terbuka (409) lalu berhasil setelah selesai; trigger mengunci', async () => {
        const r = await rangkaianBaru('B-1/2026');
        const input = { unitPengolahId: 'dir_bppt', klasifikasiItemId: klasifikasi, konfirmasi: true as const };
        await expect(berkasService.berkaskan(bppt, r.id, input, audit(bppt))).rejects.toMatchObject({ statusCode: 409 });
        await h.query("UPDATE surat_distributions SET status = 'processed', processed_at = now(), catatan_penyelesaian = 'Sudah ditangani' WHERE rangkaian_id = $1", [r.id]);
        await expect(berkasService.berkaskan(bppt, r.id, { ...input, unitPengolahId: 'dir_plp' }, audit(bppt)))
            .rejects.toMatchObject({ statusCode: 422, message: 'Disposisikan dulu ke unit ini' });
        await expect(berkasService.berkaskan(plp, r.id, input, audit(plp))).rejects.toMatchObject({ statusCode: 404 });
        const hasil = await berkasService.berkaskan(bppt, r.id, input, audit(bppt));
        expect(hasil).toMatchObject({ status: 'diberkaskan', unitPengolahId: 'dir_bppt', klasifikasiItemId: klasifikasi, diberkaskanBy: bppt.id });
        await expect(h.query("UPDATE rangkaian_surat SET status = 'aktif' WHERE id = $1", [r.id])).rejects.toThrow();
        await expect(h.query("UPDATE surat_distributions SET rangkaian_id = $1 WHERE id = $2", [r.id, r.rows[1].id])).rejects.toThrow();
    });

    it('tandai selesai oleh pencatat mengisi selesai_manual dan menurunkan status surat masuk; peserta non-pengolah 403', async () => {
        const r = await rangkaianBaru('B-2/2026', [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }]);
        await h.query("UPDATE surat_distributions SET status = 'rejected', rejection_reason = 'Salah alamat' WHERE rangkaian_id = $1", [r.id]);
        await h.query("INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status, rangkaian_id) VALUES ($1, 'sesditjen', 'dir_ptep', 'processed', $2)", [r.sm, r.id]);
        await h.query("UPDATE rangkaian_surat SET status = 'aktif', unit_pengolah_id = NULL WHERE id = $1", [r.id]);
        await expect(berkasService.tandaiSelesai(ptep, r.id, 'Ditangani lewat rapat koordinasi', audit(ptep))).rejects.toMatchObject({ statusCode: 403 });
        await berkasService.tandaiSelesai(tu, r.id, 'Ditangani lewat rapat koordinasi', audit(tu));
        const [rs] = await h.query('SELECT status, selesai_manual, selesai_by, catatan_selesai FROM rangkaian_surat WHERE id = $1', [r.id]);
        expect(rs).toEqual({ status: 'selesai', selesai_manual: true, selesai_by: tu.id, catatan_selesai: 'Ditangani lewat rapat koordinasi' });
        expect((await h.query('SELECT status FROM surat_masuk WHERE id = $1', [r.sm]))[0].status).toBe('sudah_dibalas');
        await berkasService.bukaKembali(tu, r.id, 'Ada surat susulan dari Pemda', audit(tu));
        expect((await h.query('SELECT status, selesai_manual FROM rangkaian_surat WHERE id = $1', [r.id]))[0]).toEqual({ status: 'aktif', selesai_manual: false });
    });

    it('ubah unit pengolah hanya ke unit dalam jangkauan; oleh pencatat/pengawas', async () => {
        const r = await rangkaianBaru('B-3/2026');
        await expect(berkasService.ubahUnitPengolah(bppt, r.id, 'dir_ptep', audit(bppt))).rejects.toMatchObject({ statusCode: 403 });
        await expect(berkasService.ubahUnitPengolah(tu, r.id, 'dir_plp', audit(tu))).rejects.toMatchObject({ statusCode: 422 });
        expect(await berkasService.ubahUnitPengolah(tu, r.id, 'dir_ptep', audit(tu))).toEqual({ id: r.id, unitPengolahId: 'dir_ptep', aksesBaru: [] });
        const opsi = await berkasService.opsiBerkas(tu, r.id);
        expect(opsi.unitDalamJangkauan.map((u) => u.id).sort()).toEqual(['dir_bppt', 'dir_ptep', 'sesditjen']);
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/rangkaian-aksi.routes.test.ts`
Expected: FAIL — route berkas belum ada.

- [ ] **Step 3: Implementasi `berkas.service.ts`**

```ts
// backend/src/services/rangkaian/berkas.service.ts
import { sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors.js';
import auditLogService, { type CriticalAuditContext } from '../audit-log.service.js';
import {
    isPengawas, loadJangkauan, lockRangkaian, recomputeSuratMasuk,
    type Executor, type RangkaianTerkunciP3, type RecordUser, type Tx,
} from './deps.js';
import { rangkaianStatusService } from './rangkaian-status.service.js';
import { isFullAdmin, unitEfektif } from './roles.js';
import { rowsOf } from './sql-rows.js';

type Peran = 'pengolah' | 'pencatat' | 'pengawas';
type Rangkaian = RangkaianTerkunciP3;

/** 403 bagi peserta tanpa peran; 404 bagi yang bahkan tidak dalam jangkauan (tanpa oracle). */
async function assertPeran(tx: Executor, user: RecordUser, r: Rangkaian, peran: Peran[]) {
    const unit = unitEfektif(user);
    if (isFullAdmin(user)) {
        if (user.role === 'super_admin') return;
        if (peran.includes('pengolah') && unit && unit === r.unitPengolahId) return;
        if (peran.includes('pencatat') && unit && unit === r.unitPencatatId) return;
        if (peran.includes('pengawas') && await isPengawas(user, tx)) return;
    }
    const jangkauan = await loadJangkauan(tx, r.id);
    if (unit && jangkauan.includes(unit)) throw new ForbiddenError('Anda tidak berwenang atas rangkaian ini.');
    throw new NotFoundError('Rangkaian');
}

async function kunci(tx: Tx, id: string): Promise<Rangkaian> {
    const [r] = await lockRangkaian(tx, [id]);
    if (!r) throw new NotFoundError('Rangkaian');
    return r;
}

async function suratMasukAnggota(tx: Tx, rangkaianId: string): Promise<string[]> {
    return rowsOf<{ surat_masuk_id: string }>(await tx.execute(sql`
        SELECT surat_masuk_id FROM rangkaian_anggota WHERE rangkaian_id = ${rangkaianId} AND surat_masuk_id IS NOT NULL`))
        .map((row) => row.surat_masuk_id);
}

export const berkasService = {
    /** §5 batas unitPengolahId: target disposisi non-rejected ∪ penulis anggota (termasuk pemilik induk). */
    async unitDalamJangkauanBerkas(executor: Executor, rangkaianId: string): Promise<string[]> {
        return rowsOf<{ unit: string }>(await (executor as any).execute(sql`
            SELECT DISTINCT unit FROM (
                SELECT d.target_unit_id AS unit FROM surat_distributions d WHERE d.rangkaian_id = ${rangkaianId} AND d.status <> 'rejected'
                UNION
                SELECT a.unit_kerja_id AS unit FROM rangkaian_anggota a WHERE a.rangkaian_id = ${rangkaianId}
            ) u ORDER BY unit`)).map((row) => row.unit);
    },

    async aksesBaru(executor: Executor, rangkaianId: string, units: string[]): Promise<string[]> {
        const sekarang = new Set(await loadJangkauan(executor, rangkaianId));
        return units.filter((unit) => !sekarang.has(unit));
    },

    async opsiBerkas(user: RecordUser, rangkaianId: string) {
        return db.transaction(async (tx) => {
            const [r] = rowsOf<any>(await tx.execute(sql`
                SELECT id, kode, status, asal, unit_pencatat_id AS "unitPencatatId", unit_pengolah_id AS "unitPengolahId"
                  FROM rangkaian_surat WHERE id = ${rangkaianId}`));
            if (!r) throw new NotFoundError('Rangkaian');
            await assertPeran(tx, user, r, ['pengolah', 'pencatat', 'pengawas']);
            const ids = await this.unitDalamJangkauanBerkas(tx, rangkaianId);
            const unit = rowsOf<{ id: string; name: string }>(await tx.execute(sql`
                SELECT id, name FROM unit_kerja WHERE id = ANY(string_to_array(${ids.join(',')}, ',')) ORDER BY name`));
            const [induk] = rowsOf<{ klasifikasi_item_id: number | null }>(await tx.execute(sql`
                SELECT coalesce(sm.klasifikasi_item_id, sk.klasifikasi_item_id) AS klasifikasi_item_id
                  FROM rangkaian_anggota a
                  LEFT JOIN surat_masuk sm ON sm.id = a.surat_masuk_id
                  LEFT JOIN surat_keluar sk ON sk.id = a.surat_keluar_id
                 WHERE a.rangkaian_id = ${rangkaianId} AND a.peran = 'induk'`));
            return { status: r.status, unitPengolahId: r.unitPengolahId, klasifikasiIndukId: induk?.klasifikasi_item_id ?? null, unitDalamJangkauan: unit };
        });
    },

    async tandaiSelesai(user: RecordUser, rangkaianId: string, catatan: string, audit?: CriticalAuditContext) {
        return db.transaction(async (tx) => {
            const r = await kunci(tx, rangkaianId);
            await assertPeran(tx, user, r, ['pengolah', 'pencatat']);
            if (r.status !== 'aktif') throw new ConflictError('Hanya rangkaian aktif yang dapat ditandai selesai.');
            const penghalang = await rangkaianStatusService.hitungPenghalang(tx, rangkaianId);
            if (penghalang.disposisiTerbuka > 0 || penghalang.anggotaBlokir > 0) {
                throw new ConflictError('Masih ada disposisi terbuka atau surat keluar draft/menunggu/ditolak dalam rangkaian.');
            }
            await tx.execute(sql`UPDATE rangkaian_surat
                SET status = 'selesai', selesai_manual = true, selesai_at = now(), selesai_by = ${user.id}, catatan_selesai = ${catatan.trim()}, updated_at = now()
                WHERE id = ${rangkaianId} AND status = 'aktif'`);
            if (audit) {
                await auditLogService.logActionOrThrow({ ...audit, action: 'status_change', entityType: 'rangkaian_surat', entityId: rangkaianId,
                    changes: { before: { status: 'aktif' }, after: { status: 'selesai', selesaiManual: true }, catatan: catatan.trim() } }, tx);
            }
            await recomputeSuratMasuk(tx, await suratMasukAnggota(tx, rangkaianId), audit);
            return { id: rangkaianId, status: 'selesai' as const };
        });
    },

    async bukaKembali(user: RecordUser, rangkaianId: string, alasan: string, audit?: CriticalAuditContext) {
        return db.transaction(async (tx) => {
            const r = await kunci(tx, rangkaianId);
            await assertPeran(tx, user, r, ['pengolah', 'pencatat']);
            if (r.status !== 'selesai') throw new ConflictError('Hanya rangkaian selesai yang dapat dibuka kembali.');
            await tx.execute(sql`UPDATE rangkaian_surat
                SET status = 'aktif', selesai_manual = false, selesai_at = NULL, selesai_by = NULL, catatan_selesai = NULL, updated_at = now()
                WHERE id = ${rangkaianId} AND status = 'selesai'`);
            if (audit) {
                await auditLogService.logActionOrThrow({ ...audit, action: 'status_change', entityType: 'rangkaian_surat', entityId: rangkaianId,
                    changes: { before: { status: 'selesai' }, after: { status: 'aktif' }, alasan: alasan.trim() } }, tx);
            }
            await recomputeSuratMasuk(tx, await suratMasukAnggota(tx, rangkaianId), audit);
            return { id: rangkaianId, status: 'aktif' as const };
        });
    },

    /** §9: dari selesai, atau aktif tanpa penghalang; unit dalam jangkauan; klasifikasi wajib. */
    async berkaskan(user: RecordUser, rangkaianId: string, input: { unitPengolahId: string; klasifikasiItemId: number; konfirmasi: true; catatan?: string }, audit?: CriticalAuditContext) {
        return db.transaction(async (tx) => {
            const r = await kunci(tx, rangkaianId);
            await assertPeran(tx, user, r, ['pengolah', 'pencatat', 'pengawas']);
            if (r.status !== 'aktif' && r.status !== 'selesai') throw new ConflictError('Rangkaian tidak dapat diberkaskan dari status ini.');
            const penghalang = await rangkaianStatusService.hitungPenghalang(tx, rangkaianId);
            if (penghalang.disposisiTerbuka > 0) throw new ConflictError('Masih ada disposisi terbuka dalam rangkaian.');
            if (penghalang.anggotaBlokir > 0) throw new ConflictError('Masih ada surat keluar draft/menunggu/ditolak dalam rangkaian.');
            if (!(await this.unitDalamJangkauanBerkas(tx, rangkaianId)).includes(input.unitPengolahId)) {
                throw new AppError('Disposisikan dulu ke unit ini', 422);
            }
            const [klasifikasi] = rowsOf(await tx.execute(sql`SELECT id FROM klasifikasi_arsip WHERE id = ${input.klasifikasiItemId}`));
            if (!klasifikasi) throw new AppError('Klasifikasi berkas tidak ditemukan', 422);
            const aksesBaru = await this.aksesBaru(tx, rangkaianId, [input.unitPengolahId]);
            const [updated] = rowsOf<any>(await tx.execute(sql`UPDATE rangkaian_surat
                SET status = 'diberkaskan', unit_pengolah_id = ${input.unitPengolahId}, klasifikasi_item_id = ${input.klasifikasiItemId},
                    diberkaskan_at = now(), diberkaskan_by = ${user.id}, updated_at = now()
                WHERE id = ${rangkaianId} AND status IN ('aktif', 'selesai')
                RETURNING id, status, unit_pengolah_id AS "unitPengolahId", klasifikasi_item_id AS "klasifikasiItemId",
                          diberkaskan_at AS "diberkaskanAt", diberkaskan_by AS "diberkaskanBy"`));
            if (!updated) throw new ConflictError('Status rangkaian berubah. Muat ulang data.');
            if (audit) {
                await auditLogService.logActionOrThrow({ ...audit, action: 'status_change', entityType: 'rangkaian_surat', entityId: rangkaianId,
                    changes: {
                        before: { status: r.status, unitPengolahId: r.unitPengolahId },
                        after: { status: 'diberkaskan', unitPengolahId: input.unitPengolahId, klasifikasiItemId: input.klasifikasiItemId },
                        catatan: input.catatan ?? null, aksesBaru,
                    } }, tx);
            }
            return updated;
        });
    },

    async ubahUnitPengolah(user: RecordUser, rangkaianId: string, unitPengolahId: string, audit?: CriticalAuditContext) {
        return db.transaction(async (tx) => {
            const r = await kunci(tx, rangkaianId);
            await assertPeran(tx, user, r, ['pencatat', 'pengawas']);
            if (r.status !== 'aktif' && r.status !== 'selesai') throw new ConflictError('Unit pengolah hanya dapat diubah sebelum diberkaskan.');
            if (!(await this.unitDalamJangkauanBerkas(tx, rangkaianId)).includes(unitPengolahId)) {
                throw new AppError('Disposisikan dulu ke unit ini', 422);
            }
            const aksesBaru = await this.aksesBaru(tx, rangkaianId, [unitPengolahId]);
            await tx.execute(sql`UPDATE rangkaian_surat SET unit_pengolah_id = ${unitPengolahId}, updated_at = now() WHERE id = ${rangkaianId}`);
            if (audit) {
                await auditLogService.logActionOrThrow({ ...audit, action: 'update', entityType: 'rangkaian_surat', entityId: rangkaianId,
                    changes: { before: { unitPengolahId: r.unitPengolahId }, after: { unitPengolahId }, aksesBaru } }, tx);
            }
            return { id: rangkaianId, unitPengolahId, aksesBaru };
        });
    },

};
```

- [ ] **Step 4: Route & allowlist**

Di `rangkaian.routes.ts` (impor `selesaiRangkaianSchema`, `berkaskanSchema`, `unitPengolahSchema` dan `berkasService`):

```ts
router.get('/:id/opsi-berkas', validateIdParam(), async (req: AuthRequest, res, next) => {
    try { res.json({ success: true, data: await berkasService.opsiBerkas(req.user!, req.params.id as string) }); } catch (error) { next(error); }
});
router.post('/:id/selesai', validateIdParam(), canWriteMiddleware(), validateBody(selesaiRangkaianSchema), async (req: AuthRequest, res, next) => {
    try { res.json({ success: true, data: await berkasService.tandaiSelesai(req.user!, req.params.id as string, req.body.catatan, auditOf(req)) }); } catch (error) { next(error); }
});
router.post('/:id/buka-kembali', validateIdParam(), canWriteMiddleware(), validateBody(alasanSchema), async (req: AuthRequest, res, next) => {
    try { res.json({ success: true, data: await berkasService.bukaKembali(req.user!, req.params.id as string, req.body.alasan, auditOf(req)) }); } catch (error) { next(error); }
});
router.post('/:id/berkaskan', validateIdParam(), canWriteMiddleware(), validateBody(berkaskanSchema), async (req: AuthRequest, res, next) => {
    try { res.json({ success: true, data: await berkasService.berkaskan(req.user!, req.params.id as string, req.body, auditOf(req)) }); } catch (error) { next(error); }
});
router.put('/:id/unit-pengolah', validateIdParam(), canWriteMiddleware(), validateBody(unitPengolahSchema), async (req: AuthRequest, res, next) => {
    try { res.json({ success: true, data: await berkasService.ubahUnitPengolah(req.user!, req.params.id as string, req.body.unitPengolahId, auditOf(req)) }); } catch (error) { next(error); }
});
```

Allowlist:

```ts
    { methods: GET, path: exact(`/rangkaian/${UUID}/(?:opsi-berkas|gabung/pratinjau)`) },
    { methods: POST, path: exact(`/rangkaian/${UUID}/(?:selesai|buka-kembali|berkaskan|tautan|gabung)`) },
    { methods: PUT, path: exact(`/rangkaian/${UUID}/unit-pengolah`) },
    { methods: POST, path: exact(`/rangkaian/relasi/${UUID}/batal`) },
```

(entri `tautan`, `gabung`, `gabung/pratinjau`, dan `relasi/.../batal` dipakai Task 15). Tambahkan ke `it.each` demo: `['POST', \`/api/rangkaian/${id}/berkaskan\`]`, `['PUT', \`/api/rangkaian/${id}/unit-pengolah\`]`, `['GET', \`/api/rangkaian/${id}/opsi-berkas\`]`, `['POST', \`/api/rangkaian/${id}/gabung\`]`. **Hapus** baris P2 Task 9 `['POST', \`/api/rangkaian/${id}/gabung\`, 'unsupported_route'],` dari daftar yang ditolak di `demo-access.middleware.test.ts` — route itu kini sah (kontradiksi lintas fase P2↔P3).

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/rangkaian-aksi.routes.test.ts src/__tests__/demo-access.middleware.test.ts && TEST_POSTGRES_URL=postgresql://simsa_test:simsa_test@127.0.0.1:5432/simsa_test npx vitest run --config vitest.postgres.config.ts integration/berkas.postgres.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/rangkaian/berkas.service.ts backend/src/routes/rangkaian.routes.ts backend/src/middlewares/demo-access.middleware.ts backend/src/__tests__/demo-access.middleware.test.ts backend/src/__tests__/rangkaian-aksi.routes.test.ts backend/integration/berkas.postgres.test.ts
git commit -m "feat(berkas): tandai selesai, buka kembali, berkaskan dua langkah, dan unit pengolah dalam jangkauan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


#### Amandemen pra-eksekusi Task 14 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


**Files: add**
- Modify `backend/src/services/rangkaian-read.service.ts`: export `tingkatAksesRangkaian`.
- Modify `backend/src/services/rangkaian/deps.ts`: re-export it.
- Modify `backend/src/__tests__/rangkaian-deps.contract.test.ts`.

**Interfaces: add** `tingkatAksesRangkaian(user, rangkaianId, executor?) : Promise<'owner' | 'pengawas' | 'peserta' | 'anggota' | null>`. This is shared with Tasks 15 and 16.

**Step 3, new P2 export** in `rangkaian-read.service.ts`, next to `tingkatRangkaian` (`:286-300`) [T14-1]:

```ts
/** Tier baca rangkaian (sama dengan getDetail): null → 404; 'anggota' = hanya ≥1 anggota terbaca. Mengikuti rantai digabung. */
export async function tingkatAksesRangkaian(user: RecordUser | undefined, rangkaianId: string, executor: ReadExecutor = db) {
    let rs = await muatRangkaian(executor, rangkaianId);
    for (let hop = 0; rs && rs.status === 'digabung' && rs.digabungKeId && hop < BATAS_HOP_GABUNG; hop += 1) rs = await muatRangkaian(executor, rs.digabungKeId);
    if (!rs) return null;
    const ctx = await resolveKonteksBaca(user, executor);
    const tingkat = await tingkatRangkaian(executor, ctx, rs);
    if (tingkat) return tingkat;
    const anggota = await muatAnggota(executor, rs.id);
    const akses = await recordAccessService.checkMany(user, anggota.slice(0, BATAS_NODE_DETAIL).map((a) => ({ type: a.jenis, id: a.suratId })), executor);
    return [...akses.values()].some((a) => a.allowed) ? 'anggota' as const : null;
}
```

Re-export it from deps: `export { tingkatAksesRangkaian } from '../rangkaian-read.service.js';`.

**`assertPeran`: replace the plan version** [T14-1]:

```ts
async function assertPeran(tx: Executor, user: RecordUser, r: Rangkaian, peran: Peran[]) {
    const tingkat = await tingkatAksesRangkaian(user, r.id, tx as never);
    if (!tingkat) throw new NotFoundError('Rangkaian');                       // tak terbaca → 404 (tanpa oracle, sama dengan GET P2)
    if (user.role === 'super_admin') return;
    const unit = unitEfektif(user);
    if (isFullAdmin(user)) {
        if (peran.includes('pengolah') && unit && unit === r.unitPengolahId) return;
        if (peran.includes('pencatat') && unit && unit === r.unitPencatatId) return;
        if (peran.includes('pengawas') && tingkat === 'pengawas') return;       // pengawas DALAM CAKUPAN (G-PENGAWAS)
    }
    throw new ForbiddenError('Anda tidak berwenang atas rangkaian ini.');     // terbaca tanpa peran → 403
}
```

**`kunci`: surat first** [T14-2]:

```ts
async function kunci(tx: Tx, id: string): Promise<Rangkaian> {
    const smAwal = await suratMasukAnggota(tx, id);          // tanpa kunci
    await lockSuratMasukRows(tx, smAwal);                     // GC#30: surat → rangkaian
    const [r] = await lockRangkaian(tx, [id]);
    if (!r) throw new NotFoundError('Rangkaian');
    const smSekarang = await suratMasukAnggota(tx, id);       // anggota hanya bertambah lewat jalur yang mengunci rangkaian ini
    if (smSekarang.some((sm) => !smAwal.includes(sm))) throw new ConflictError('Anggota rangkaian berubah bersamaan; muat ulang lalu coba lagi.');
    return r;
}
```

This is used by `tandaiSelesai`, `bukaKembali`, `berkaskan` and `ubahUnitPengolah`. Each of their `db.transaction(...)` calls becomes `denganRetryDeadlock(() => db.transaction(...))`.

**`bukaKembali`** [T14-3, T14-4]:
1. After the status check, add:

   ```ts
   if (!r.selesaiManual) throw new ConflictError('Rangkaian selesai otomatis; tambahkan disposisi atau tindak lanjut baru untuk membukanya kembali.');
   ```

2. Replace the audit `changes` with:

   ```ts
   { before: { status: 'selesai', selesaiAt: r.selesaiAt, selesaiBy: r.selesaiBy, catatanSelesai: r.catatanSelesai, selesaiManual: r.selesaiManual },
     after: { status: 'aktif', selesaiAt: null, selesaiBy: null, catatanSelesai: null, selesaiManual: false }, alasan: alasan.trim() }
   ```

**`opsiBerkas` / `unitDalamJangkauanBerkas`** [T14-5]:
- `opsiBerkas` authorizes with `tingkatAksesRangkaian`: null gives 404, otherwise 200 for any reader, including staff.
- It returns `klasifikasiInduk: { id, kode, jenis } | null` in place of the bare `klasifikasiIndukId`. Join `klasifikasi_arsip` on the induk's `klasifikasi_item_id` and select `kode` and `jenis`/`nama`, whichever the column is called in `backend/src/db/schema`.
- `unitDalamJangkauanBerkas` only counts anggota whose surat is not soft-deleted (GC#29).

**Tests: add**
- **Route tests (`rangkaian-aksi.routes.test.ts`):** mock `tingkatAksesRangkaian`.
- **Postgres (`berkas.postgres.test.ts`)** covers the following cases:

| Case | Expected |
|---|---|
| (a) Pengawas in scope (sesditjen), not in jangkauan, calls `tandaiSelesai` on a `dir_bppt` rangkaian | **403**; `GET /api/rangkaian/:id` for them is 200 |
| (b) Pengawas calls `berkaskan` on a rangkaian whose `unit_pencatat_id` is outside `dalamCakupanPengawas` and outside jangkauan | 404 |
| (c) Staff of a member unit calls `opsiBerkas` | 200 |
| (d) `bukaKembali` on an auto-selesai rangkaian | 409 |
| (e) `bukaKembali` audit `before` | contains `selesaiAt`, `selesaiBy`, `catatanSelesai` |
| (f) The Task 12 gabung-demoted draft induk case, then `tandaiSelesai`/`berkaskan` | 409 |
| (g) `berkaskan` ∥ `distributionService.distribute` on a member SM | no 40P01 |

**Frontend dependency.** `BerkaskanDialog` (Task 25) reads `klasifikasiInduk.kode`/`jenis`. Update the Task 18 mock at plan:8610-8611 accordingly.

---


**C-5 (critic) — Task 14: `opsiBerkas` must not return jangkauan to non-tier readers (**security**, supersedes part of T14-5) [C-5]**


T14-5 (amend:776, rul:187) returns 200, including the full `unitDalamJangkauan` list, "for any reader, including staff". That means tier `'anggota'` gets it too.

P2 deliberately hides participant units from non-tier readers:
- it returns `peserta: penuh ? await muatPeserta(…) : []` and `rangkaianTerkait: penuh ? … : []`;
- `penuh = tingkat !== null` (`rangkaian-read.service.ts:361-362`, and the return block).

Staff are never FULL_ADMIN, so they cannot act on these options anyway.

`opsiBerkas` status by tier:

| `tingkatAksesRangkaian` | Status |
|---|---|
| `null` | 404 |
| `'anggota'` | **403**: readable, so no oracle; consistent with F1 |
| `owner`, `pengawas`, `peserta` | 200 |

Change T14 Postgres case (c) (amend:788) to:
- staff of a member unit → 403;
- `admin_unit` of a disposisi target → 200.


**C-8 (critic) — Task 14: `tingkatAksesRangkaian` must mirror `getDetail`'s chain guard [C-8]**


The two functions end the `digabung` chain differently:
- The T14-1 loop (amend:715) stops at the hop limit and then returns a tier for a row that is still `digabung`.
- `getDetail` returns `null` on a hop limit or a cycle (`rangkaian-read.service.ts:336-346`).

The result is 404 on GET but 403 on the mutation, which is an existence oracle. Replace the loop with:

```ts
const dikunjungi = new Set<string>();
let rs = await muatRangkaian(executor, rangkaianId);
for (let hop = 0; rs && rs.status === 'digabung' && rs.digabungKeId; hop += 1) {
    if (hop >= BATAS_HOP_GABUNG || dikunjungi.has(rs.digabungKeId)) return null;
    dikunjungi.add(rs.id);
    rs = await muatRangkaian(executor, rs.digabungKeId);
}
```



### Task 15: Tautan, Gabung (otorisasi di atas primitif P1), Batal Relasi

**Files:**
- Create: `backend/src/services/rangkaian/rangkaian-link.service.ts`
- Modify: `backend/src/validators/schemas.ts` (tambah `tautanKeSuratSchema` setelah `tautanSchema`)
- Modify: `backend/src/routes/rangkaian.routes.ts` (5 route)
- Modify: `backend/src/middlewares/demo-access.middleware.ts`, `backend/src/__tests__/demo-access.middleware.test.ts`
- Modify: `backend/src/__tests__/rangkaian-aksi.routes.test.ts`
- Test: `backend/integration/rangkaian-link.postgres.test.ts`

**Interfaces:**
- Consumes: `rangkaianService.attach(tx, input, actor)` (P1: anggota + relasi, induk rangkaian 1-anggota diproses sebagai gabung, 409 bila anggota rangkaian lain yang lebih besar / relasi ganda, buka kembali `selesai`), `rangkaianService.gabung(tx, { targetId, sumberId, alasan }, actor)` (P1: kunci menaik, pindah anggota + distribusi, sumber `digabung`, recompute target, audit `merge` dengan `unitAksesBaru`), `rangkaianService.ensureForSurat`, `recordAccessService.check/checkRead`, `isPengawas`, `aktor`, `loadJangkauan`, `lockRangkaian`, `recomputeRangkaian`, `recomputeSuratMasuk` (deps); `tautanSchema`, `gabungSchema`, `alasanSchema` (Task 5).
- Produces: `rangkaianLinkService.tautan(user, rangkaianId, { jenis; suratId; keAnggotaId; jenisRelasi; keterangan? }, audit?): Promise<{ rangkaianId; relasiId; digabungDari: string | null }>`; `rangkaianLinkService.tautanKeSurat(user, { jenis; suratId; keJenis; keSuratId; jenisRelasi; keterangan? }, audit?)`; `rangkaianLinkService.pratinjauGabung(executor, sumberId, targetId): Promise<{ unitBaruDiTarget: string[]; unitBaruDiSumber: string[] }>`; `rangkaianLinkService.gabung(user, targetId, { sumberId, alasan }, audit?): Promise<{ targetId; sumberId; aksesBaru: { unitBaruDiTarget; unitBaruDiSumber } }>`; `rangkaianLinkService.batalRelasi(user, relasiId, alasan, audit?)`; `tautanKeSuratSchema`; route `POST /tautan`, `POST /:id/tautan`, `GET /:id/gabung/pratinjau?sumberId=`, `POST /:id/gabung`, `POST /relasi/:relasiId/batal`.

Resolusi spec: §5 hanya mendefinisikan `POST /:id/tautan`, padahal §2b.3 menautkan ND ke SK yang masih tunggal (belum punya rangkaian). Ditambahkan `POST /api/rangkaian/tautan` yang memanggil `ensureForSurat` atas surat tujuan (setelah `checkRead`) lalu memakai inti tautan yang sama, dalam satu transaksi.

- [ ] **Step 1: Tulis test Postgres yang gagal**

```ts
// backend/integration/rangkaian-link.postgres.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

const state = vi.hoisted(() => ({ db: null as any }));
const proxy = () => ({ db: new Proxy({}, { get: (_t, key) => {
    const value = state.db?.[key];
    return typeof value === 'function' ? value.bind(state.db) : value;
} }) });
vi.mock('../src/config/database', proxy);
vi.mock('../src/config/database.js', proxy);

const { distributionService } = await import('../src/services/distribution.service.js');
const { rangkaianLinkService } = await import('../src/services/rangkaian/rangkaian-link.service.js');
const { lacakService } = await import('../src/services/rangkaian/lacak.service.js');
const { rangkaianService, aktor } = await import('../src/services/rangkaian/deps.js');

let h: RangkaianTestDatabase;
let tu: TestUser; let bppt: TestUser;
const audit = (u: TestUser) => ({ userId: u.id, userEmail: u.email });
const anggotaDari = async (kolom: 'surat_masuk_id' | 'surat_keluar_id', id: string) =>
    (await h.query(`SELECT id, rangkaian_id FROM rangkaian_anggota WHERE ${kolom} = $1`, [id]))[0];
const pastikan = (u: TestUser, jenis: 'surat_masuk' | 'surat_keluar', id: string) =>
    h.db.transaction((tx: any) => rangkaianService.ensureForSurat(tx, { jenis, id }, aktor(u)));

beforeAll(async () => {
    h = await createRangkaianTestDatabase('tautan');
    state.db = h.db;
    await h.seedUnits();
    tu = await h.seedUser('admin_unit', 'sesditjen');
    bppt = await h.seedUser('admin_unit', 'dir_bppt');
}, 120_000);
afterAll(async () => { await h?.close(); });

describe('tautan, gabung, dan batal relasi', () => {
    it('tautan surat tunggal milik sendiri ke rangkaian tempat unit menjadi peserta', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'T-1/2026' });
        const [d] = await distributionService.distributeMany({ suratMasukId: sm, sourceUnitId: 'sesditjen', sentBy: tu.id, targets: [{ unitKerjaId: 'dir_bppt' }] }, audit(tu));
        const nd = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'ND-T1/2026' });
        const induk = await anggotaDari('surat_masuk_id', sm);
        const hasil = await rangkaianLinkService.tautan(bppt, d.rangkaianId!, { jenis: 'surat_keluar', suratId: nd, keAnggotaId: induk.id, jenisRelasi: 'tindak_lanjut' }, audit(bppt));
        expect(hasil).toMatchObject({ rangkaianId: d.rangkaianId, digabungDari: null });
        expect((await h.query('SELECT sumber FROM rangkaian_anggota WHERE surat_keluar_id = $1', [nd]))[0].sumber).toBe('tautan');
    });

    it('unit yang bukan peserta/pengawas tidak dapat menautkan (403)', async () => {
        const ptep = await h.seedUser('admin_unit', 'dir_ptep');
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'T-1b/2026' });
        const r = await pastikan(tu, 'surat_masuk', sm);
        const sk = await h.insertSuratKeluar({ unitKerjaId: 'dir_ptep', nomorSurat: 'ND-P/2026' });
        await expect(rangkaianLinkService.tautan(ptep, r.rangkaianId, { jenis: 'surat_keluar', suratId: sk, keAnggotaId: r.anggotaId, jenisRelasi: 'merujuk' }, audit(ptep)))
            .rejects.toMatchObject({ statusCode: 403 });
    });

    it('tautan ke surat tunggal (skenario b.3): rangkaian tujuan dipastikan dalam transaksi yang sama', async () => {
        const skK = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'KEP-B3/2026', naskahDinas: 'Keputusan', approvalStatus: 'approved', asalNaskah: 'inisiatif' });
        const nd = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'ND-B3/2026' });
        const hasil = await rangkaianLinkService.tautanKeSurat(bppt, { jenis: 'surat_keluar', suratId: nd, keJenis: 'surat_keluar', keSuratId: skK, jenisRelasi: 'menjelaskan' }, audit(bppt));
        const [induk] = await h.query('SELECT rangkaian_id, peran FROM rangkaian_anggota WHERE surat_keluar_id = $1', [skK]);
        expect(induk).toEqual({ rangkaian_id: hasil.rangkaianId, peran: 'induk' });
        expect((await anggotaDari('surat_keluar_id', nd)).rangkaian_id).toBe(hasil.rangkaianId);
    });

    it('tautan induk rangkaian 1-anggota diproses sebagai gabung dan Lacak mengikuti target', async () => {
        const skK = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'KEP-T2/2026', naskahDinas: 'Keputusan', approvalStatus: 'approved', asalNaskah: 'inisiatif' });
        const skN = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'ND-T2/2026', approvalStatus: 'approved' });
        const target = await pastikan(bppt, 'surat_keluar', skK);
        const sumber = await pastikan(bppt, 'surat_keluar', skN);
        const hasil = await rangkaianLinkService.tautan(bppt, target.rangkaianId, { jenis: 'surat_keluar', suratId: skN, keAnggotaId: target.anggotaId, jenisRelasi: 'menjelaskan' }, audit(bppt));
        expect(hasil.digabungDari).toBe(sumber.rangkaianId);
        expect((await h.query('SELECT status, digabung_ke_id FROM rangkaian_surat WHERE id = $1', [sumber.rangkaianId]))[0])
            .toEqual({ status: 'digabung', digabung_ke_id: target.rangkaianId });
        const lacak = await lacakService.search(bppt, { q: 'ND-T2/2026', mode: 'lacak', limit: 8 });
        expect(lacak.kelompok[0].kunci).toBe(target.rangkaianId);
    });

    it('gabung (skenario e): hanya pengawas, distribusi ikut pindah, target tetap aktif selama disposisi sumber terbuka, siklus ditolak', async () => {
        const skA = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'ND-E/2026', approvalStatus: 'approved', asalNaskah: 'inisiatif' });
        const a = (await pastikan(bppt, 'surat_keluar', skA)).rangkaianId;
        const smB = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-E/2026' });
        const [dB] = await distributionService.distributeMany({ suratMasukId: smB, sourceUnitId: 'sesditjen', sentBy: tu.id, targets: [{ unitKerjaId: 'dir_ptep' }] }, audit(tu));
        const b = dB.rangkaianId!;
        await expect(rangkaianLinkService.gabung(bppt, a, { sumberId: b, alasan: 'TU lupa mengisi Nomor Referensi' }, audit(bppt)))
            .rejects.toMatchObject({ statusCode: 403 });
        const pratinjau = await h.db.transaction((tx: any) => rangkaianLinkService.pratinjauGabung(tx, b, a));
        expect(pratinjau.unitBaruDiTarget).toContain('dir_ptep');
        const hasil = await rangkaianLinkService.gabung(tu, a, { sumberId: b, alasan: 'TU lupa mengisi Nomor Referensi' }, audit(tu));
        expect(hasil.aksesBaru.unitBaruDiTarget).toContain('dir_ptep');
        expect((await h.query('SELECT rangkaian_id FROM surat_distributions WHERE id = $1', [dB.id]))[0].rangkaian_id).toBe(a);
        expect((await h.query('SELECT status FROM rangkaian_surat WHERE id = $1', [a]))[0].status).toBe('aktif');
        await expect(rangkaianLinkService.gabung(tu, b, { sumberId: a, alasan: 'Percobaan membuat siklus' }, audit(tu)))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    it('batal relasi: alasan wajib, balasan_untuk dikosongkan, pembatalan ganda 409', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'T-5/2026' });
        const sk = await h.insertSuratKeluar({ unitKerjaId: 'sesditjen', nomorSurat: 'SD-T5/2026', approvalStatus: 'approved' });
        const r = await pastikan(tu, 'surat_masuk', sm);
        const { relasiId } = await h.db.transaction((tx: any) => rangkaianService.attach(tx, {
            rangkaianId: r.rangkaianId, surat: { jenis: 'surat_keluar', id: sk }, keAnggotaId: r.anggotaId, jenisRelasi: 'balasan',
        }, aktor(tu)));
        await h.query('UPDATE surat_keluar SET balasan_untuk = $1 WHERE id = $2', [sm, sk]);
        await rangkaianLinkService.batalRelasi(tu, relasiId, 'Balasan salah ditautkan', audit(tu));
        expect((await h.query('SELECT cancelled_by, cancellation_reason FROM rangkaian_relasi WHERE id = $1', [relasiId]))[0])
            .toEqual({ cancelled_by: tu.id, cancellation_reason: 'Balasan salah ditautkan' });
        expect((await h.query('SELECT balasan_untuk FROM surat_keluar WHERE id = $1', [sk]))[0].balasan_untuk).toBeNull();
        await expect(rangkaianLinkService.batalRelasi(tu, relasiId, 'Membatalkan untuk kedua kali', audit(tu))).rejects.toMatchObject({ statusCode: 409 });
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && TEST_POSTGRES_URL=postgresql://simsa_test:simsa_test@127.0.0.1:5432/simsa_test npx vitest run --config vitest.postgres.config.ts integration/rangkaian-link.postgres.test.ts`
Expected: FAIL — modul `rangkaian-link.service.js` belum ada.

- [ ] **Step 3: Implementasi `rangkaian-link.service.ts`**

```ts
// backend/src/services/rangkaian/rangkaian-link.service.ts
import { sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors.js';
import auditLogService, { type CriticalAuditContext } from '../audit-log.service.js';
import {
    aktor, isPengawas, loadJangkauan, lockRangkaian, rangkaianService, recomputeRangkaian, recomputeSuratMasuk,
    recordAccessService, type Executor, type JenisRelasi, type RecordUser, type SuratJenis, type Tx,
} from './deps.js';
import { isFullAdmin, unitEfektif } from './roles.js';
import { rowsOf } from './sql-rows.js';

interface TautanInput { jenis: SuratJenis; suratId: string; keAnggotaId: string; jenisRelasi: JenisRelasi; keterangan?: string | null }

async function pengawasAtauSuperAdmin(tx: Executor, user: RecordUser) {
    return user.role === 'super_admin' || (isFullAdmin(user) && await isPengawas(user, tx));
}

export const rangkaianLinkService = {
    async pratinjauGabung(executor: Executor, sumberId: string, targetId: string) {
        const [jSumber, jTarget] = await Promise.all([loadJangkauan(executor, sumberId), loadJangkauan(executor, targetId)]);
        return {
            unitBaruDiTarget: jSumber.filter((unit) => !jTarget.includes(unit)),
            unitBaruDiSumber: jTarget.filter((unit) => !jSumber.includes(unit)),
        };
    },

    /** §5: hanya admin pengawas/super_admin; pemindahan anggota+distribusi dikerjakan P1 `gabung`. */
    async gabung(user: RecordUser, targetId: string, input: { sumberId: string; alasan: string }, audit?: CriticalAuditContext) {
        return db.transaction(async (tx) => {
            if (!(await pengawasAtauSuperAdmin(tx, user))) {
                throw new ForbiddenError('Hanya admin unit pengawas yang dapat menggabungkan rangkaian.');
            }
            const aksesBaru = await this.pratinjauGabung(tx, input.sumberId, targetId);
            await rangkaianService.gabung(tx, { targetId, sumberId: input.sumberId, alasan: input.alasan.trim() }, aktor(user, audit));
            return { targetId, sumberId: input.sumberId, aksesBaru };
        });
    },

    async tautan(user: RecordUser, rangkaianId: string, input: TautanInput, audit?: CriticalAuditContext) {
        return db.transaction((tx) => this.tautanDalamTx(tx, user, rangkaianId, input, audit));
    },

    /** §2b.3: target boleh surat tunggal; rangkaiannya dipastikan dulu (setelah checkRead) di tx yang sama. */
    async tautanKeSurat(user: RecordUser, input: {
        jenis: SuratJenis; suratId: string; keJenis: SuratJenis; keSuratId: string; jenisRelasi: JenisRelasi; keterangan?: string | null;
    }, audit?: CriticalAuditContext) {
        return db.transaction(async (tx) => {
            const akses = await recordAccessService.checkRead(user, input.keJenis, input.keSuratId, tx);
            if (!akses.exists || !akses.allowed) throw new NotFoundError('Surat tujuan');
            const tujuan = await rangkaianService.ensureForSurat(tx, { jenis: input.keJenis, id: input.keSuratId }, aktor(user, audit));
            return this.tautanDalamTx(tx, user, tujuan.rangkaianId, {
                jenis: input.jenis, suratId: input.suratId, keAnggotaId: tujuan.anggotaId,
                jenisRelasi: input.jenisRelasi, keterangan: input.keterangan ?? null,
            }, audit);
        });
    },

    /** Pemilik surat (check() owner) yang juga peserta/pengawas rangkaian tujuan; inti keanggotaan = P1 attach. */
    async tautanDalamTx(tx: Tx, user: RecordUser, rangkaianId: string, input: TautanInput, audit?: CriticalAuditContext) {
        const milik = await recordAccessService.check(user, input.jenis, input.suratId);
        if (!milik.exists || !milik.mutable) throw new NotFoundError('Surat');
        const unit = unitEfektif(user);
        const peserta = unit ? (await loadJangkauan(tx, rangkaianId)).includes(unit) : false;
        if (!peserta && !(await pengawasAtauSuperAdmin(tx, user))) {
            throw new ForbiddenError('Unit Anda bukan peserta rangkaian tujuan.');
        }
        const hasil = await rangkaianService.attach(tx, {
            rangkaianId,
            surat: { jenis: input.jenis, id: input.suratId },
            keAnggotaId: input.keAnggotaId,
            jenisRelasi: input.jenisRelasi,
            keterangan: input.keterangan ?? null,
            sumber: 'tautan',
        }, aktor(user, audit));
        await recomputeRangkaian(tx, rangkaianId, audit);
        const smIds = rowsOf<{ id: string }>(await tx.execute(sql`
            SELECT surat_masuk_id AS id FROM rangkaian_anggota
             WHERE id IN (${hasil.anggotaId}, ${input.keAnggotaId}) AND surat_masuk_id IS NOT NULL`)).map((row) => row.id);
        await recomputeSuratMasuk(tx, smIds, audit);
        return { rangkaianId, relasiId: hasil.relasiId, digabungDari: hasil.digabungDari };
    },

    async batalRelasi(user: RecordUser, relasiId: string, alasan: string, audit?: CriticalAuditContext) {
        return db.transaction(async (tx) => {
            const [rel] = rowsOf<{ id: string; rangkaian_id: string; created_by: string | null; cancelled_at: Date | null; jenis_relasi: string; dari_sk: string | null; ke_sm: string | null }>(
                await tx.execute(sql`
                    SELECT r.id, r.rangkaian_id, r.created_by, r.cancelled_at, r.jenis_relasi,
                           da.surat_keluar_id AS dari_sk, ka.surat_masuk_id AS ke_sm
                      FROM rangkaian_relasi r
                      JOIN rangkaian_anggota da ON da.id = r.dari_anggota_id
                      JOIN rangkaian_anggota ka ON ka.id = r.ke_anggota_id
                     WHERE r.id = ${relasiId}`));
            if (!rel) throw new NotFoundError('Relasi');
            const [r] = await lockRangkaian(tx, [rel.rangkaian_id]);
            if (r.status === 'diberkaskan') throw new ConflictError('Rangkaian sudah diberkaskan; relasi tidak dapat dibatalkan.');
            if (rel.cancelled_at) throw new ConflictError('Relasi sudah dibatalkan.');
            const boleh = isFullAdmin(user) && (rel.created_by === user.id || await pengawasAtauSuperAdmin(tx, user));
            if (!boleh) throw new ForbiddenError('Hanya pembuat relasi atau pengawas yang dapat membatalkan relasi.');
            await tx.execute(sql`UPDATE rangkaian_relasi
                SET cancelled_at = now(), cancelled_by = ${user.id}, cancellation_reason = ${alasan.trim()}
                WHERE id = ${relasiId} AND cancelled_at IS NULL`);
            if (rel.jenis_relasi === 'balasan' && rel.dari_sk && rel.ke_sm) {
                await tx.execute(sql`UPDATE surat_keluar SET balasan_untuk = NULL, updated_at = now() WHERE id = ${rel.dari_sk} AND balasan_untuk = ${rel.ke_sm}`);
            }
            if (audit) {
                await auditLogService.logActionOrThrow({ ...audit, action: 'cancel', entityType: 'rangkaian_relasi', entityId: relasiId,
                    changes: { alasan: alasan.trim(), rangkaianId: rel.rangkaian_id } }, tx);
            }
            await recomputeRangkaian(tx, rel.rangkaian_id, audit);
            if (rel.ke_sm) await recomputeSuratMasuk(tx, [rel.ke_sm], audit);
            return { id: relasiId, cancelled: true };
        });
    },
};
```

- [ ] **Step 4: Skema, route, allowlist**

Tambahkan di `backend/src/validators/schemas.ts` setelah `tautanSchema`:

```ts
export const tautanKeSuratSchema = z.object({
    jenis: z.enum(['surat_masuk', 'surat_keluar']),
    suratId: uuidSchema,
    keJenis: z.enum(['surat_masuk', 'surat_keluar']),
    keSuratId: uuidSchema,
    jenisRelasi: z.enum(['balasan', 'tindak_lanjut', 'menjelaskan', 'merujuk']),
    keterangan: z.string().trim().max(2000).nullish(),
}).strict();
```

Di `rangkaian.routes.ts` (impor `tautanSchema`, `tautanKeSuratSchema`, `gabungSchema`, `rangkaianLinkService`, `db`):

```ts
router.post('/tautan', canWriteMiddleware(), validateBody(tautanKeSuratSchema), async (req: AuthRequest, res, next) => {
    try { res.status(201).json({ success: true, data: await rangkaianLinkService.tautanKeSurat(req.user!, req.body, auditOf(req)) }); } catch (error) { next(error); }
});
router.post('/:id/tautan', validateIdParam(), canWriteMiddleware(), validateBody(tautanSchema), async (req: AuthRequest, res, next) => {
    try { res.status(201).json({ success: true, data: await rangkaianLinkService.tautan(req.user!, req.params.id as string, req.body, auditOf(req)) }); } catch (error) { next(error); }
});
router.get('/:id/gabung/pratinjau', validateIdParam(), canWriteMiddleware(), async (req: AuthRequest, res, next) => {
    try {
        const sumberId = typeof req.query.sumberId === 'string' ? req.query.sumberId : '';
        if (!/^[0-9a-f-]{36}$/i.test(sumberId)) return res.status(400).json({ error: 'sumberId wajib berupa UUID' });
        res.json({ success: true, data: await db.transaction((tx) => rangkaianLinkService.pratinjauGabung(tx, sumberId, req.params.id as string)) });
    } catch (error) { next(error); }
});
router.post('/:id/gabung', validateIdParam(), canWriteMiddleware(), validateBody(gabungSchema), async (req: AuthRequest, res, next) => {
    try { res.json({ success: true, data: await rangkaianLinkService.gabung(req.user!, req.params.id as string, req.body, auditOf(req)) }); } catch (error) { next(error); }
});
router.post('/relasi/:relasiId/batal', validateIdParam('relasiId'), canWriteMiddleware(), validateBody(alasanSchema), async (req: AuthRequest, res, next) => {
    try { res.json({ success: true, data: await rangkaianLinkService.batalRelasi(req.user!, req.params.relasiId as string, req.body.alasan, auditOf(req)) }); } catch (error) { next(error); }
});
```

Allowlist tambahan (entri `tautan`/`gabung` per-id sudah dari Task 14): `{ methods: POST, path: exact('/rangkaian/tautan') },` dan kasus demo `['POST', '/api/rangkaian/tautan']`.

Tambahkan ke `rangkaian-aksi.routes.test.ts`: perluas `mocks` di `vi.hoisted` dengan `link: { tautan: vi.fn(), tautanKeSurat: vi.fn(), gabung: vi.fn(), pratinjauGabung: vi.fn(), batalRelasi: vi.fn() }`, tambah `vi.mock('../services/rangkaian/rangkaian-link.service.js', () => ({ rangkaianLinkService: mocks.link }))`, dan ubah mock `db` yang ada menjadi `vi.mock('../config/database', () => ({ db: { transaction: (fn: any) => fn({}) } }))`. Lalu tambahkan:

```ts
describe('tautan, gabung, batal', () => {
    it('gabung wajib alasan ≥10; batal relasi wajib alasan ≥10; pratinjau wajib sumberId UUID', async () => {
        mocks.link.gabung.mockResolvedValue({ targetId: RS });
        await request(app).post(`/api/rangkaian/${RS}/gabung`).send({ sumberId: DIST, alasan: 'pendek' }).expect(400);
        await request(app).post(`/api/rangkaian/${RS}/gabung`).send({ sumberId: DIST, alasan: 'TU lupa Nomor Referensi' }).expect(200);
        await request(app).post(`/api/rangkaian/relasi/${DIST}/batal`).send({ alasan: 'x' }).expect(400);
        await request(app).get(`/api/rangkaian/${RS}/gabung/pratinjau`).expect(400);
    });

    it('POST /tautan tidak tertangkap route /:id/tautan dan meneruskan payload', async () => {
        mocks.link.tautanKeSurat.mockResolvedValue({ rangkaianId: RS });
        const payload = { jenis: 'surat_keluar', suratId: DIST, keJenis: 'surat_keluar', keSuratId: RS, jenisRelasi: 'menjelaskan' };
        await request(app).post('/api/rangkaian/tautan').send(payload).expect(201);
        expect(mocks.link.tautanKeSurat).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-tu' }), payload, expect.objectContaining({ userId: 'user-tu' }));
    });
});
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/rangkaian-aksi.routes.test.ts src/__tests__/demo-access.middleware.test.ts && TEST_POSTGRES_URL=postgresql://simsa_test:simsa_test@127.0.0.1:5432/simsa_test npx vitest run --config vitest.postgres.config.ts integration/rangkaian-link.postgres.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/rangkaian/rangkaian-link.service.ts backend/src/validators/schemas.ts backend/src/routes/rangkaian.routes.ts backend/src/middlewares/demo-access.middleware.ts backend/src/__tests__/demo-access.middleware.test.ts backend/src/__tests__/rangkaian-aksi.routes.test.ts backend/integration/rangkaian-link.postgres.test.ts
git commit -m "feat(rangkaian): tautan (termasuk ke surat tunggal), gabung dengan otorisasi pengawas, dan batal relasi

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


#### Amandemen pra-eksekusi Task 15 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


**Files: add**
- Modify `backend/src/services/rangkaian.service.ts` (P1 `gabung`: audit ids, reopen).
- Modify `backend/src/__tests__/rangkaian.service.integration.test.ts` if its `merge` audit assertions use exact equality.

**Interfaces: add**
- Consumes `kunciSurat`, `lockSuratMasukRows`, `pengawasUntukUnit`, `tingkatAksesRangkaian`, `aktorPenulis` and `denganRetryDeadlock` (deps).
- `GabungResult` gains `anggotaIds`, `distribusiIds` and `pesertaDipindahIds`.

**Remove `pengawasAtauSuperAdmin`.** Use `pengawasUntukUnit(user, <unit_pencatat_id of the rangkaian>, tx)` everywhere. [G-PENGAWAS]

**`tautanKeSurat` / `tautan` / `tautanDalamTx`: lock prelude** [T15-1]. The public methods open `denganRetryDeadlock(() => db.transaction(...))`. Before any P1 call:

```ts
// GC#30: semua baris surat yang terlibat → semua rangkaian yang diketahui (satu pernyataan) → baru P1.
await kunciSurat(tx, {
    suratKeluarIds: [input.jenis, input.keJenis].map((j, i) => j === 'surat_keluar' ? [input.suratId, input.keSuratId][i] : null).filter(Boolean) as string[],
    suratMasukIds: [input.jenis, input.keJenis].map((j, i) => j === 'surat_masuk' ? [input.suratId, input.keSuratId][i] : null).filter(Boolean) as string[],
});
const idsRangkaian = rowsOf<{ rangkaian_id: string }>(await tx.execute(sql`
    SELECT rangkaian_id FROM rangkaian_anggota
     WHERE surat_masuk_id IN (${…sm ids…}) OR surat_keluar_id IN (${…sk ids…})`)).map((r) => r.rangkaian_id);
await lockRangkaian(tx, [...idsRangkaian, ...(rangkaianIdTujuan ? [rangkaianIdTujuan] : [])]);
```

Build the `IN` lists with `uuidArraySql` (`= ANY(...)`). P1's own `lockSurat`/`lockRangkaian` inside `ensureForSurat`/`attach` then re-lock rows this transaction already holds, which is a no-op.

The snippet is written for `tautanKeSurat`, whose `input` has `keJenis`/`keSuratId`. For `tautan(user, rangkaianId, input)`, which targets by `keAnggotaId`, first resolve the target surat unlocked with `SELECT surat_masuk_id, surat_keluar_id FROM rangkaian_anggota WHERE id = ${input.keAnggotaId}` (404 if missing). Then run the same `kunciSurat` over {source surat, target surat}, and `lockRangkaian` over {`rangkaianId`, the source's existing rangkaian if any} in one statement.

**Authorization in `tautanDalamTx`** [T15-3, T15-8, T15-9]:

```ts
const tingkat = await tingkatAksesRangkaian(user, rangkaianId, tx as never);
if (!tingkat) throw new NotFoundError('Rangkaian');
const milik = await recordAccessService.check(user, input.jenis, input.suratId);
if (!milik.exists || !milik.allowed || !isFullAdmin(user) || !isAllowedForRecordUnit(user, milik.unitKerjaId!)) throw new NotFoundError('Surat');
const unit = unitEfektif(user);
const [rt] = await lockRangkaian(tx, [rangkaianId]);                       // no-op bila sudah terkunci
const peserta = unit ? (await loadJangkauan(tx, rangkaianId)).includes(unit) : false;
if (!peserta && !(await pengawasUntukUnit(user, rt.unitPencatatId, tx))) throw new ForbiddenError('Unit Anda bukan peserta rangkaian tujuan.');
```

- **Why `check().allowed` and not `mutable`:** P1 `attach` never updates the surat row, and spec:776 expects archived letters to be linkable.
- **Implicit gabung guard:** before `attach`, if the source surat is the `induk` of another rangkaian with exactly 1 anggota that has non-rejected distributions to units not in `loadJangkauan(tx, rangkaianId)`, and the caller is not `pengawasUntukUnit` for the target, throw `ConflictError('Surat ini induk rangkaian lain yang memiliki disposisi aktif; gunakan Gabungkan Rangkaian (perlu pengawas).')`.
- **Diberkaskan message** [T15-11]: before `attach`, if the surat is already a member of a rangkaian with status `diberkaskan`, throw `ConflictError(\`Surat sudah menjadi bagian berkas ${kode} yang diberkaskan; buat surat lanjutan.\`)`.
- **After `attach`:** when `hasil.reopened` or `hasil.digabungDari` is set, recompute every SM member of `rangkaianId` (ids read, then `lockSuratMasukRows`, which is a no-op for already-held rows). Otherwise recompute only `[hasil.anggotaId, input.keAnggotaId]`'s SMs, as planned. [T15-7]
- **Actors:** use `aktorPenulis` for `ensureForSurat` and `attach`.

**Route test (plan:5545-5552).** Tautan by a unit that cannot read the target rangkaian gives **404**. Readable but neither participant nor pengawas-in-scope gives 403. Add both cases. [T15-3]

**`gabung`** [T15-4]:
- Authorize: `pengawasUntukUnit(user, target.unit_pencatat_id, tx) && pengawasUntukUnit(user, sumber.unit_pencatat_id, tx)`. Read both unlocked first; unreadable gives 404.
- Lock: read the SM member ids of both rangkaian, then `lockSuratMasukRows`, then call P1 `rangkaianService.gabung(tx, …, aktorPenulis(user, audit))`.
- Recompute: `recomputeSuratMasuk(tx, <all SM ids>, audit)`.
- Return `{ targetId, sumberId, unitBaruDiTarget: hasil.unitAksesBaru, anggotaIds: hasil.anggotaIds, distribusiIds: hasil.distribusiIds }`. Do NOT compute `pratinjauGabung` inside the transaction.

**P1 `gabung` (`rangkaian.service.ts:570-635`): modify** [T15-5, T15-6]:
- The peserta UPDATE gets `RETURNING p.id`, captured as `peserta`.
- Add `anggotaIds: anggota.map(a => a.id)`, `distribusiIds: distribusi.map(d => d.id)` and `pesertaDipindahIds: barisDari(peserta).map(p => p.id)` to the `merge` audit `changes` and to the returned `GabungResult`, extending the interface at `:187-194`.
- Before `const [statusTarget] = await rangkaianService.recomputeStatus(...)`, add:

  ```ts
  if (target.status === 'selesai' && anggota.length > 0) {
      await bukaKembaliOtomatis(tx, target, actor, 'Rangkaian lain digabungkan ke rangkaian ini');
  }
  ```

- Run the P1 suites after the change: `src/__tests__/rangkaian.service.integration.test.ts` and `src/__tests__/rangkaian.service.test.ts` if present. Relax exact `merge` audit equality to `toMatchObject` where needed.

**`pratinjauGabung` route (`GET /:id/gabung/pratinjau`)** [T15-10]:
1. Validate the id: `const sumber = uuidSchema.safeParse(req.query.sumberId); if (!sumber.success) return res.status(400).json({ error: 'sumberId tidak valid' });`.
2. Authorize: `tingkatAksesRangkaian` on both, where null gives 404, then `pengawasUntukUnit` on both `unit_pencatat_id`s, where false gives 403.
3. Then call `rangkaianLinkService.pratinjauGabung(db, sumber.data, id)`.

**`batalRelasi`** [T15-2, T15-11]:
1. Authority first: read `rel` unlocked (404 if missing). Compute `boleh = isFullAdmin(user) && (rel.created_by === user.id || await pengawasUntukUnit(user, <rangkaian.unit_pencatat_id>, tx))`. Throw 403 when `!boleh`, before any 409.
2. Lock: `kunciSurat(tx, { suratKeluarIds: [rel.dari_sk].filter(Boolean), suratMasukIds: [rel.ke_sm].filter(Boolean) })`, then `lockRangkaian(tx, [rel.rangkaian_id])`.
3. Re-read `rel` after the locks. If its `rangkaian_id` changed because of a concurrent gabung, `lockRangkaian` the new id once and re-read; if it changed again, throw 409.
4. Then apply the existing 409 checks: diberkaskan, already cancelled.
5. Add `balasanUntukDikosongkan: rel.jenis_relasi === 'balasan' ? rel.dari_sk : null` to the `cancel` audit `changes`.

**Postgres (`rangkaian-link.postgres.test.ts`): add**
- `merge` audit `anggotaIds`/`distribusiIds` equal the moved rows.
- Gabung into a manually `selesai` target reopens it, with an audit carrying the `selesai_*` values.
- SM statuses of the source members are recomputed after gabung.
- An owner links an **archived** SM successfully.
- A non-pengawas owner's tautan that would implicitly merge a rangkaian with an active disposisi to an outside unit returns 409.
- `tautanKeSurat` ∥ `gabung` on overlapping rangkaian, both via `Promise.all`, with no 40P01.
- Pratinjau with `sumberId='------------------------------------'` returns 400.

---



### Task 16: `aksiDiizinkan[]` dan `statusAlur` pada detail surat dan rangkaian

**Files:**
- Create: `backend/src/services/rangkaian/aksi.ts`
- Modify: `backend/src/routes/surat-masuk.routes.ts:182-199` (GET `/:id` versi P2), `backend/src/routes/surat-keluar.routes.ts:151-168`, `backend/src/routes/rangkaian.routes.ts` (GET `/:id`, `/by-surat/...` versi P2)
- Test: `backend/src/__tests__/rangkaian-aksi.test.ts`, `backend/src/__tests__/surat-detail-aksi.routes.test.ts`

**Interfaces:**
- Consumes: `isPengawas`, `RecordReadAccess` (deps); `deriveStatusAlur` (Task 12, di `services/rangkaian-status.ts`); `unitEfektif`, `FULL_ADMIN_ROLES`; respons P2 `GET /:id` yang sudah memuat `aksesMelalui` dan `aksiDiizinkan: []`.
- Produces:
  - `type SuratAksi = 'edit' | 'hapus' | 'arsipkan' | 'saya_balas' | 'buat_nota_dinas' | 'buat_nd_penjelas' | 'disposisi' | 'tautkan' | 'terima' | 'penyelesaian'`
  - `type RangkaianAksi = 'tandai_selesai' | 'buka_kembali' | 'berkaskan' | 'ubah_unit_pengolah' | 'gabung' | 'tutup_disposisi' | 'batal_relasi'`
  - `computeSuratAksi(role: string, ctx: SuratAksiContext): SuratAksi[]`
  - `computeRangkaianAksi(ctx: RangkaianAksiContext): RangkaianAksi[]`
  - `suratAksiPayload(user, jenis, suratId, access): Promise<{ aksiDiizinkan: SuratAksi[]; statusAlur: StatusAlur; distribusiUnitSaya: { id; status } | null; rangkaian: { id; kode; status } | null }>`
  - `rangkaianAksiUntuk(user, rangkaianId): Promise<RangkaianAksi[]>`
  - Respons `GET /api/surat-masuk/:id` & `GET /api/surat-keluar/:id`: `data` ditambah `aksiDiizinkan`, `statusAlur`, `distribusiUnitSaya`, `rangkaian`; `GET /api/rangkaian/:id` & `/by-surat/...`: `data.aksiDiizinkan` diisi `computeRangkaianAksi`.

- [ ] **Step 1: Tulis test tabel yang gagal**

```ts
// backend/src/__tests__/rangkaian-aksi.test.ts
import { describe, expect, it } from 'vitest';
import { computeRangkaianAksi, computeSuratAksi, type SuratAksiContext } from '../services/rangkaian/aksi';

const ctx: SuratAksiContext = {
    jenis: 'surat_masuk', via: 'owner', isArchived: false, naskahDinas: null,
    rangkaian: { id: 'rs-1', kode: 'RS-2026-000001', status: 'aktif', unitPencatatId: 'sesditjen', unitPengolahId: 'dir_bppt' },
    distribusiUnitSaya: null, isPengawas: false,
};

describe('computeSuratAksi', () => {
    it('pemilik (TU) mendapat edit, hapus, arsip, disposisi, tautkan, dan tindak lanjut', () => {
        expect(computeSuratAksi('admin_unit', ctx).sort()).toEqual(['arsipkan', 'buat_nota_dinas', 'disposisi', 'edit', 'hapus', 'saya_balas', 'tautkan']);
    });

    it('direktorat penerima disposisi hanya mendapat Saya Balas, Buat ND, Terima, Penyelesaian', () => {
        const aksi = computeSuratAksi('admin_unit', { ...ctx, via: 'peserta', distribusiUnitSaya: { id: 'd1', status: 'sent' } });
        expect(aksi.sort()).toEqual(['buat_nota_dinas', 'penyelesaian', 'saya_balas', 'terima']);
    });

    it('peserta tanpa disposisi hidup (ditolak) tidak mendapat aksi tulis', () => {
        expect(computeSuratAksi('admin_unit', { ...ctx, via: 'peserta', distribusiUnitSaya: { id: 'd1', status: 'rejected' } })).toEqual([]);
    });

    it('role read-only lama tidak pernah mendapat aksi', () => {
        expect(computeSuratAksi('staff', ctx)).toEqual([]);
        expect(computeSuratAksi('auditor', { ...ctx, via: 'owner' })).toEqual([]);
    });

    it('rangkaian diberkaskan menutup tindak lanjut, disposisi, tautan, dan hapus', () => {
        expect(computeSuratAksi('admin_unit', { ...ctx, rangkaian: { ...ctx.rangkaian!, status: 'diberkaskan' } }).sort()).toEqual(['arsipkan', 'edit']);
    });

    it('ND Penjelas hanya untuk surat keluar ber-naskah Keputusan', () => {
        const sk = { ...ctx, jenis: 'surat_keluar' as const, naskahDinas: 'Keputusan', rangkaian: null };
        expect(computeSuratAksi('admin_unit', sk)).toContain('buat_nd_penjelas');
        expect(computeSuratAksi('admin_unit', { ...sk, naskahDinas: 'Nota Dinas' })).not.toContain('buat_nd_penjelas');
        expect(computeSuratAksi('admin_unit', sk)).not.toContain('disposisi');
    });
});

describe('computeRangkaianAksi', () => {
    const r = { status: 'aktif' as const, unitPencatatId: 'sesditjen', unitPengolahId: 'dir_bppt' };
    it.each([
        ['pengolah', { role: 'admin_unit', unitEfektif: 'dir_bppt', isPengawas: false }, ['berkaskan', 'tandai_selesai']],
        ['pencatat pengawas', { role: 'admin_unit', unitEfektif: 'sesditjen', isPengawas: true }, ['batal_relasi', 'berkaskan', 'gabung', 'tandai_selesai', 'tutup_disposisi', 'ubah_unit_pengolah']],
        ['peserta biasa', { role: 'admin_unit', unitEfektif: 'dir_ptep', isPengawas: false }, []],
        ['staff', { role: 'staff', unitEfektif: 'sesditjen', isPengawas: false }, []],
    ] as const)('%s', (_n, who, hasil) => {
        expect(computeRangkaianAksi({ ...who, rangkaian: r, adaDisposisiTerbuka: true }).sort()).toEqual([...hasil]);
    });

    it('selesai → buka kembali; diberkaskan → tanpa aksi', () => {
        expect(computeRangkaianAksi({ role: 'admin_unit', unitEfektif: 'dir_bppt', isPengawas: false, rangkaian: { ...r, status: 'selesai' }, adaDisposisiTerbuka: false }))
            .toEqual(expect.arrayContaining(['buka_kembali', 'berkaskan']));
        expect(computeRangkaianAksi({ role: 'super_admin', unitEfektif: null, isPengawas: false, rangkaian: { ...r, status: 'diberkaskan' }, adaDisposisiTerbuka: false }))
            .toEqual([]);
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/rangkaian-aksi.test.ts`
Expected: FAIL — modul `aksi` belum ada.

- [ ] **Step 3: Implementasi `aksi.ts`**

```ts
// backend/src/services/rangkaian/aksi.ts
import { sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { isPengawas, type RecordReadAccess, type RecordUser, type SuratJenis } from './deps.js';
import { deriveStatusAlur, type RangkaianStatus, type StatusAlur } from '../rangkaian-status.js';
import { FULL_ADMIN_ROLES, unitEfektif } from './roles.js';
import { rowsOf } from './sql-rows.js';

export type SuratAksi = 'edit' | 'hapus' | 'arsipkan' | 'saya_balas' | 'buat_nota_dinas' | 'buat_nd_penjelas'
    | 'disposisi' | 'tautkan' | 'terima' | 'penyelesaian';
export type RangkaianAksi = 'tandai_selesai' | 'buka_kembali' | 'berkaskan' | 'ubah_unit_pengolah'
    | 'gabung' | 'tutup_disposisi' | 'batal_relasi';

export interface SuratAksiContext {
    jenis: SuratJenis;
    via: 'owner' | 'pengawas' | 'peserta' | null;
    isArchived: boolean;
    naskahDinas: string | null;
    rangkaian: { id: string; kode: string; status: RangkaianStatus; unitPencatatId: string; unitPengolahId: string | null } | null;
    distribusiUnitSaya: { id: string; status: 'sent' | 'received' | 'processed' | 'rejected' } | null;
    isPengawas: boolean;
}

/** §7: menu diturunkan dari hak server, bukan canWrite(unit rekaman). Hanya FULL_ADMIN yang menulis. */
export function computeSuratAksi(role: string, ctx: SuratAksiContext): SuratAksi[] {
    if (!FULL_ADMIN_ROLES.has(role)) return [];
    const aksi = new Set<SuratAksi>();
    const tertutup = ctx.rangkaian?.status === 'diberkaskan';
    const pemilik = ctx.via === 'owner';
    const disposisiHidup = ctx.distribusiUnitSaya?.status === 'sent' || ctx.distribusiUnitSaya?.status === 'received';
    if (pemilik && !ctx.isArchived) {
        aksi.add('edit');
        aksi.add('arsipkan');
        if (!tertutup) aksi.add('hapus');
    }
    if (pemilik && !tertutup) {
        if (ctx.jenis === 'surat_masuk') aksi.add('disposisi');
        aksi.add('tautkan');
    }
    if (!tertutup && (pemilik || disposisiHidup || ctx.isPengawas)) {
        aksi.add('saya_balas');
        aksi.add('buat_nota_dinas');
        if (ctx.jenis === 'surat_keluar' && /keputusan/i.test(ctx.naskahDinas ?? '')) aksi.add('buat_nd_penjelas');
    }
    if (ctx.distribusiUnitSaya?.status === 'sent') aksi.add('terima');
    if (disposisiHidup) aksi.add('penyelesaian');
    return [...aksi];
}

export interface RangkaianAksiContext {
    role: string;
    unitEfektif: string | null;
    isPengawas: boolean;
    rangkaian: { status: RangkaianStatus; unitPencatatId: string; unitPengolahId: string | null };
    adaDisposisiTerbuka: boolean;
}

export function computeRangkaianAksi(ctx: RangkaianAksiContext): RangkaianAksi[] {
    if (!FULL_ADMIN_ROLES.has(ctx.role)) return [];
    const { status } = ctx.rangkaian;
    if (status !== 'aktif' && status !== 'selesai') return [];
    const sa = ctx.role === 'super_admin';
    const pengolah = Boolean(ctx.unitEfektif) && ctx.unitEfektif === ctx.rangkaian.unitPengolahId;
    const pencatat = Boolean(ctx.unitEfektif) && ctx.unitEfektif === ctx.rangkaian.unitPencatatId;
    const pengawas = sa || ctx.isPengawas;
    const aksi = new Set<RangkaianAksi>();
    if (status === 'aktif' && (sa || pengolah || pencatat)) aksi.add('tandai_selesai');
    if (status === 'selesai' && (sa || pengolah || pencatat)) aksi.add('buka_kembali');
    if (sa || pengolah || pencatat || pengawas) aksi.add('berkaskan');
    if (sa || pencatat || pengawas) aksi.add('ubah_unit_pengolah');
    if (pengawas) {
        aksi.add('gabung');
        aksi.add('batal_relasi');
        if (ctx.adaDisposisiTerbuka) aksi.add('tutup_disposisi');
    }
    return [...aksi];
}

export async function suratAksiPayload(user: RecordUser, jenis: SuratJenis, suratId: string, access: RecordReadAccess) {
    const unit = unitEfektif(user);
    const [meta] = rowsOf<any>(await db.execute(jenis === 'surat_masuk'
        ? sql`SELECT sm.is_archived, NULL::text AS naskah_dinas, rs.id AS rangkaian_id, rs.kode, rs.status, rs.unit_pencatat_id, rs.unit_pengolah_id,
                     EXISTS (SELECT 1 FROM surat_distributions d WHERE d.surat_masuk_id = sm.id AND d.status <> 'rejected') AS ada_disposisi,
                     EXISTS (SELECT 1 FROM rangkaian_relasi r WHERE r.ke_anggota_id = a.id AND r.cancelled_at IS NULL) AS ada_tindak_lanjut
                FROM surat_masuk sm LEFT JOIN rangkaian_anggota a ON a.surat_masuk_id = sm.id LEFT JOIN rangkaian_surat rs ON rs.id = a.rangkaian_id
               WHERE sm.id = ${suratId}`
        : sql`SELECT sk.is_archived, sk.naskah_dinas, rs.id AS rangkaian_id, rs.kode, rs.status, rs.unit_pencatat_id, rs.unit_pengolah_id,
                     false AS ada_disposisi,
                     EXISTS (SELECT 1 FROM rangkaian_relasi r WHERE r.ke_anggota_id = a.id AND r.cancelled_at IS NULL) AS ada_tindak_lanjut
                FROM surat_keluar sk LEFT JOIN rangkaian_anggota a ON a.surat_keluar_id = sk.id LEFT JOIN rangkaian_surat rs ON rs.id = a.rangkaian_id
               WHERE sk.id = ${suratId}`));
    const [distribusi] = jenis === 'surat_masuk' && unit
        ? rowsOf<{ id: string; status: 'sent' | 'received' | 'processed' | 'rejected' }>(await db.execute(sql`
            SELECT id, status FROM surat_distributions
             WHERE surat_masuk_id = ${suratId} AND target_unit_id = ${unit}
             ORDER BY (status = 'rejected'), sent_at DESC LIMIT 1`))
        : [];
    const rangkaian = meta?.rangkaian_id
        ? { id: meta.rangkaian_id, kode: meta.kode, status: meta.status as RangkaianStatus, unitPencatatId: meta.unit_pencatat_id, unitPengolahId: meta.unit_pengolah_id }
        : null;
    const ctx: SuratAksiContext = {
        jenis, via: access.via, isArchived: Boolean(meta?.is_archived), naskahDinas: meta?.naskah_dinas ?? null, rangkaian,
        distribusiUnitSaya: distribusi ?? null, isPengawas: await isPengawas(user),
    };
    return {
        aksiDiizinkan: computeSuratAksi(user.role ?? '', ctx),
        statusAlur: deriveStatusAlur({ rangkaianStatus: rangkaian?.status ?? null, adaDisposisi: Boolean(meta?.ada_disposisi), adaTindakLanjut: Boolean(meta?.ada_tindak_lanjut) }) as StatusAlur,
        distribusiUnitSaya: distribusi ?? null,
        rangkaian: rangkaian ? { id: rangkaian.id, kode: rangkaian.kode, status: rangkaian.status } : null,
    };
}

export async function rangkaianAksiUntuk(user: RecordUser, rangkaianId: string): Promise<RangkaianAksi[]> {
    const [r] = rowsOf<any>(await db.execute(sql`
        SELECT status, unit_pencatat_id, unit_pengolah_id,
               EXISTS (SELECT 1 FROM surat_distributions d WHERE d.rangkaian_id = rs.id AND d.status IN ('sent', 'received')) AS ada_terbuka
          FROM rangkaian_surat rs WHERE rs.id = ${rangkaianId}`));
    if (!r) return [];
    return computeRangkaianAksi({
        role: user.role ?? '', unitEfektif: unitEfektif(user), isPengawas: await isPengawas(user),
        rangkaian: { status: r.status, unitPencatatId: r.unit_pencatat_id, unitPengolahId: r.unit_pengolah_id },
        adaDisposisiTerbuka: r.ada_terbuka,
    });
}
```

- [ ] **Step 4: Pasang di route detail**

Di `backend/src/routes/surat-masuk.routes.ts` handler `GET /:id` (versi P2 memakai `checkRead` dan memuat dengan `scopeForAuthorizedRead`), ganti pengiriman respons sukses dengan:

```ts
        const aksi = await suratAksiPayload(req.user!, 'surat_masuk', id, access);
        res.json({ success: true, data: { ...sanitizeSuratRecord(result, 'surat_masuk'), aksesMelalui: access.via, ...aksi } });
```

(dengan `import { suratAksiPayload } from '../services/rangkaian/aksi.js';`). Respons P2 sudah memuat `aksesMelalui` dan `aksiDiizinkan: []`; sebaran `...aksi` menimpa `aksiDiizinkan` dengan hasil server P3. Lakukan hal yang sama pada `backend/src/routes/surat-keluar.routes.ts` GET `/:id` dengan `'surat_keluar'`. Di `rangkaian.routes.ts` pada kedua handler GET P2, sebelum `res.json(...)` tambahkan:

```ts
        if (detail) detail.aksiDiizinkan = await rangkaianAksiUntuk(req.user!, detail.rangkaian.id);
```

- [ ] **Step 5: Test route detail**

```ts
// backend/src/__tests__/surat-detail-aksi.routes.test.ts
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const ID = '550e8400-e29b-41d4-a716-446655440000';
const mocks = vi.hoisted(() => ({ payload: vi.fn() }));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { id: 'user-bppt', email: 'b@example.test', name: 'B', role: 'admin_unit', unitKerjaId: 'dir_bppt' };
        next();
    },
}));
vi.mock('../services/surat-masuk.service', () => ({ suratMasukService: {
    findById: vi.fn(async () => ({ id: ID, unitKerjaId: 'sesditjen', perihal: 'Permohonan', filePath: null })),
} }));
vi.mock('../services/record-access.service.js', () => {
    const akses = { exists: true, allowed: true, mutable: false, via: 'peserta', rangkaianId: 'rs-1', unitKerjaId: 'sesditjen', classification: 'biasa', grantId: null, accessPurpose: null, grantAccessMode: null, grantExpiresAt: null };
    return {
        allowedSecurityClassifications: () => ['biasa', 'terbatas'],
        isAllowedForClassification: () => true,
        recordAccessService: { check: vi.fn(async () => ({ ...akses, allowed: false, mutable: false })), checkRead: vi.fn(async () => akses) },
    };
});
vi.mock('../services/rangkaian/aksi.js', () => ({ suratAksiPayload: mocks.payload }));
vi.mock('../config/database', () => ({ db: {} }));
vi.mock('../services/audit-log.service.js', () => {
    const service = { logAction: vi.fn(), logActionOrThrow: vi.fn(async () => undefined) };
    return { default: service, auditLogService: service };
});

const { default: router } = await import('../routes/surat-masuk.routes');
const app = express();
app.use('/api/surat-masuk', router);

describe('GET /api/surat-masuk/:id menyertakan aksiDiizinkan dari server', () => {
    it('penerima disposisi mendapat aksi dari server, dan GET tidak mengubah status disposisi', async () => {
        mocks.payload.mockResolvedValue({ aksiDiizinkan: ['saya_balas', 'terima'], statusAlur: 'didisposisikan', distribusiUnitSaya: { id: 'd1', status: 'sent' }, rangkaian: { id: 'rs-1', kode: 'RS-2026-000001', status: 'aktif' } });
        const res = await request(app).get(`/api/surat-masuk/${ID}`).expect(200);
        expect(res.body.data).toMatchObject({ aksesMelalui: 'peserta', aksiDiizinkan: ['saya_balas', 'terima'], distribusiUnitSaya: { status: 'sent' } });
        expect(mocks.payload).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-bppt' }), 'surat_masuk', ID, expect.objectContaining({ via: 'peserta' }));
    });
});
```

- [ ] **Step 6: Jalankan test, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/rangkaian-aksi.test.ts src/__tests__/surat-detail-aksi.routes.test.ts src/routes/__tests__/surat-masuk.routes.test.ts src/routes/__tests__/surat-file-security.routes.test.ts`
Expected: PASS. (Bila `surat-masuk.routes.test.ts` P2 belum me-mock `rangkaian/aksi.js`, tambahkan `vi.mock('../../services/rangkaian/aksi.js', () => ({ suratAksiPayload: vi.fn(async () => ({ aksiDiizinkan: [], statusAlur: 'terdaftar', distribusiUnitSaya: null, rangkaian: null })) }))`.)

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/rangkaian/aksi.ts backend/src/routes/surat-masuk.routes.ts backend/src/routes/surat-keluar.routes.ts backend/src/routes/rangkaian.routes.ts backend/src/__tests__/rangkaian-aksi.test.ts backend/src/__tests__/surat-detail-aksi.routes.test.ts backend/src/routes/__tests__/surat-masuk.routes.test.ts
git commit -m "feat(rangkaian): aksiDiizinkan dan statusAlur dari server pada detail surat dan rangkaian

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


#### Amandemen pra-eksekusi Task 16 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


**Files: add** (to Files and Step 6's run list, all under `backend/`) [T16-2]:

| File | Change |
|---|---|
| `src/__tests__/rangkaian-akses.routes.integration.test.ts` | `:53`: change `aksiDiizinkan: []` to the set `computeSuratAksi` yields for that fixture (pengawas, surat_keluar, not owner): `['saya_balas','buat_nota_dinas']`, plus `'buat_nd_penjelas'` only if the fixture's `naskahDinas` matches `/keputusan/i`. Assert with `expect.arrayContaining` plus a length check. |
| `src/routes/__tests__/surat-file-security.routes.test.ts` | `:702`: update if red. |
| `src/routes/__tests__/rangkaian.routes.test.ts` | Add `vi.mock('../../services/rangkaian/aksi.js', () => ({ rangkaianAksiUntuk: vi.fn(async () => []), suratAksiPayload: vi.fn() }))`; `:55` stays `[]`. |
| `src/routes/__tests__/surat-masuk.routes.test.ts` | Add the `aksi.js` mock from plan:6094 (**mandatory**, not conditional). |
| `src/__tests__/surat-id-param.routes.test.ts` | Add to the run list. |
| `src/__tests__/record-unit-scope.routes.test.ts` | Add to the run list. |
| `src/__tests__/record-access-read.integration.test.ts` | Add to the run list. |

**Title / Produces.** Drop "`statusAlur` pada … rangkaian". `statusAlur` is returned only on the surat detail (`GET /api/surat-masuk|keluar/:id`); `RangkaianDetail` is unchanged (`rangkaian-read.service.ts:103-129`). [T16-5]

**`aksi.ts` imports: replace plan:5904-5906 with** [T16-1]:

```ts
import {
    deriveStatusAlur, pengawasUntukUnit, tingkatAksesRangkaian,
    type RangkaianStatus, type RecordReadAccess, type RecordUser, type StatusAlur, type SuratJenis,
} from './deps.js';
import { rangkaianStatusService } from './rangkaian-status.service.js';
```

Do not import from `../rangkaian-status.js`: it does not export `RangkaianStatus` (TS2459). For blockers, import `rangkaianStatusService` from `./rangkaian-status.service.js`, which is a P3 module and therefore allowed.

**`SuratAksiContext`: add** `mutable: boolean` (from `access.mutable`) and `pengawasDalamCakupan: boolean`, which replaces `isPengawas`. The latter is `access.via === 'pengawas' || await pengawasUntukUnit(user, <record unit>)`.

**`computeSuratAksi`: changes** [T16-3]:
- Owner write actions are gated on `mutable`: `if (ctx.mutable && !ctx.isArchived) { edit, arsipkan; if (!tertutup) hapus }` and `if (ctx.mutable && !tertutup) { disposisi (SM), tautkan }`.
- The tindak lanjut branch uses `(pemilik || disposisiHidup || ctx.pengawasDalamCakupan)`, where `pemilik = ctx.via === 'owner'`.

**`RangkaianAksiContext`: changes** [T16-4]:
- Replace `isPengawas` with `pengawas: boolean`, computed as `tingkat === 'pengawas' || role === 'super_admin'` from `tingkatAksesRangkaian`.
- Add `selesaiManual: boolean` and `adaPenghalang: boolean`, computed via `rangkaianStatusService.hitungPenghalang` (`disposisiTerbuka + anggotaBlokir > 0`).

**`computeRangkaianAksi`: changes**
- `tandai_selesai` only when `status === 'aktif' && !adaPenghalang && (sa || pengolah || pencatat)`.
- `buka_kembali` only when `status === 'selesai' && selesaiManual && (sa || pengolah || pencatat)`.
- `berkaskan` only when `!adaPenghalang && (…)`.
- `gabung`/`batal_relasi`/`tutup_disposisi` use `pengawas` as defined above.
- Update the table test (`rangkaian-aksi.test.ts`) accordingly.

**Handler edits.** Anchor on the literal `aksiDiizinkan: []` in each GET handler: `backend/src/routes/surat-masuk.routes.ts:208` (handler `:183-211`), `backend/src/routes/surat-keluar.routes.ts:177` (handler `:152-180`), and the two `rangkaian.routes.ts` GET handlers. Patch both surat detail handlers; do not dedupe them in P3. [T16-7, T16-9]

**Grant use via the panel** [T16-8]:
- `rangkaianReadService.getDetail` additionally returns a non-enumerable/internal `grantIds: string[]`: the `grantId` of every node whose `ReadAccessResult.via !== 'owner' && grantId`.
- Strip it before responding: the GET handlers do `const { grantIds = [], ...detail } = hasil`.
- Include `grantIds` in the existing `view_via_rangkaian` audit `changes`.
- Call `await recordAccessService.markGrantUsed(id)` for each id before `res.json`.
- Test: a node readable only via an approved grant produces an audit with `changes.grantIds` containing it.

**Test title.** Rename "…dan GET tidak mengubah status disposisi" (plan:6082-6087) to "…" without that clause, or add an assertion that no `update`/`insert` ran on the db mock. [T16-10]

**Step 7 `git add`: add** every file listed above.

---


**C-3 (critic) — Task 16: gate `tautkan` on read ownership, not `mutable` (resolves T16-3 vs T15-8) [C-3]**


The two amendments contradict each other:
- T16-3 (amend:922) offers `tautkan` only when `ctx.mutable`.
- T15-8 (amend:841, rul:205) deliberately authorizes tautan on **archived** letters (spec:776).
- Owner `mutable` is false for every archived record (`record-access.service.ts:226-229`). The metadata `mutable` means "not deleted and not archived" (`:109`, `:130`, `:289`).

So the UI never offers what the server accepts. Change `computeSuratAksi` as follows:
- **Keep `mutable` gating** for edit, arsipkan, hapus and disposisi.
- **Change `tautkan`** to `if (ctx.via === 'owner' && ctx.isFullAdmin && !tertutup) tautkan`. This is the T15-8 predicate: `check().allowed` ∧ FULL_ADMIN ∧ own unit.
- **Add a row to `rangkaian-aksi.test.ts`:** an archived owner SM contains `tautkan` and lacks `edit`/`hapus`/`disposisi`.


**C-7 (critic) — Tasks 11, 16, 25: one predicate for Tutup Disposisi [C-7]**


The amendments anchor Tutup Disposisi on different units:
- T11-1 (amend:567-568) authorizes on the **SM** unit.
- T16-4 (amend:926, 933) offers `tutup_disposisi` from the **rangkaian** tier, which is `dalamCakupanPengawas(unitPencatatId)` (`rangkaian-read.service.ts:290-292`).

After gabung or tautan, an SM from an out-of-scope unit can sit in a rangkaian whose pencatat is in scope, or the reverse. The button then either returns 403, or is hidden while the server would allow the action.

Required changes:
- **Server (T11):** keep the predicate `pengawasUntukUnit(actor, sm.unit_kerja_id)`.
- **404/403 split (F1).** When the predicate is false:
  - return 404 if the actor is neither source nor target and `checkRead(actor,'surat_masuk',sm.id).allowed` is false;
  - otherwise return 403.
- **Offer (T16-4).** Offer `tutup_disposisi` only when `(super_admin || (isFullAdmin && isPengawas))` holds **and** an open disposisi in the rangkaian has its SM unit in scope:

  ```sql
  EXISTS (SELECT 1 FROM surat_distributions d JOIN surat_masuk sm ON sm.id = d.surat_masuk_id
          WHERE d.rangkaian_id = R AND d.status IN ('sent','received') AND <dalamCakupanPengawasSql(sm.unit_kerja_id)>)
  ```

  - `dalamCakupanPengawasSql` is at `visibility-spec.ts:265`; re-export it via deps.
  - For super_admin, drop the scope clause.
- **T25:** keep the per-row button. The server stays authoritative per row.


**Ruling kontroler [CTRL-1] (menimpa G-SA untuk Tutup Disposisi):** Tutup Disposisi hanya untuk admin pengawas sesuai spec:478 (spec mengikat). `super_admin` TIDAK otomatis boleh Tutup Disposisi; ia hanya boleh bila juga memenuhi aturan pengawas biasa (role FULL_ADMIN + unit efektif `is_unit_pengawas` + `dalamCakupanPengawas`). Untuk aksi lain, G-SA (super_admin ⊇ pengawas) tetap berlaku. Konsekuensi: `tutupOlehPengawas` dan `computeRangkaianAksi`/`tutup_disposisi` memakai predikat pengawas tanpa jalan pintas super_admin; butir G-SA di C-12 (gerbang rilis) tidak lagi diperlukan untuk Tutup.



### Task 17: Skenario a–e end-to-end di PostgreSQL + race auto-selesai

**Files:**
- Test: `backend/integration/skenario-rangkaian.postgres.test.ts`

**Interfaces:**
- Consumes: `suratMasukService.create`, `suratKeluarService.create`, `distributionService.{distributeMany,process,reject,receive}`, `recomputeForSuratKeluar` (deps), `berkasService.berkaskan`, `rangkaianLinkService.gabung`, `lacakService.search`, `suratAksiPayload`, `recordAccessService.checkRead` — semua dari task sebelumnya.
- Produces: bukti kriteria keluar §10 P3 "skenario a–e lulus di Postgres".

- [ ] **Step 1: Tulis test skenario**

```ts
// backend/integration/skenario-rangkaian.postgres.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

const state = vi.hoisted(() => ({ db: null as any }));
const proxy = () => ({ db: new Proxy({}, { get: (_t, key) => {
    const value = state.db?.[key];
    return typeof value === 'function' ? value.bind(state.db) : value;
} }) });
vi.mock('../src/config/database', proxy);
vi.mock('../src/config/database.js', proxy);
vi.mock('../src/services/srikandi-producer.service.js', () => ({ srikandiBusinessProducer: {
    suratMasukCreated: async () => {}, suratKeluarCreated: async () => {},
} }));

const { suratMasukService } = await import('../src/services/surat-masuk.service.js');
const { suratKeluarService } = await import('../src/services/surat-keluar.service.js');
const { distributionService } = await import('../src/services/distribution.service.js');

const { berkasService } = await import('../src/services/rangkaian/berkas.service.js');
const { rangkaianLinkService } = await import('../src/services/rangkaian/rangkaian-link.service.js');
const { lacakService } = await import('../src/services/rangkaian/lacak.service.js');
const { suratAksiPayload } = await import('../src/services/rangkaian/aksi.js');
const { recordAccessService, recomputeForSuratKeluar } = await import('../src/services/rangkaian/deps.js');

let h: RangkaianTestDatabase;
let tu: TestUser; let bppt: TestUser; let ptep: TestUser;
let klasifikasi: number;
const audit = (u: TestUser) => ({ userId: u.id, userEmail: u.email });
const statusRangkaian = async (id: string) => (await h.query('SELECT status FROM rangkaian_surat WHERE id = $1', [id]))[0].status;
const statusSurat = async (id: string) => (await h.query('SELECT status FROM surat_masuk WHERE id = $1', [id]))[0].status;
const rangkaianDari = async (kolom: 'surat_masuk_id' | 'surat_keluar_id', id: string) =>
    (await h.query(`SELECT rangkaian_id FROM rangkaian_anggota WHERE ${kolom} = $1`, [id]))[0]?.rangkaian_id as string | undefined;
const setujui = (id: string) => h.db.transaction(async (tx: any) => {
    await tx.execute(sql`UPDATE surat_keluar SET approval_status = 'approved' WHERE id = ${id}`);
    await recomputeForSuratKeluar(tx, id, audit(tu));
});
const catatMasuk = (nomor: string, extra: Record<string, unknown>) => suratMasukService.create({
    unitKerjaId: 'sesditjen', tanggalSurat: '2026-09-23', perihal: `Perihal ${nomor}`, dari: 'Pemda Sintetis', nomorSurat: nomor,
    createdBy: tu.id, actor: tu, ...extra,
} as any, audit(tu));
const buatKeluar = (u: TestUser, extra: Record<string, unknown>) => suratKeluarService.create({
    unitKerjaId: u.unitKerjaId, naskahDinas: 'Nota Dinas', tanggalSurat: '2026-09-24', perihal: 'Tindak lanjut', kepada: 'Direktur Jenderal',
    createdBy: u.id, actor: u, ...extra,
} as any, audit(u));

beforeAll(async () => {
    h = await createRangkaianTestDatabase('skenario');
    state.db = h.db;
    await h.seedUnits();
    tu = await h.seedUser('admin_unit', 'sesditjen');
    bppt = await h.seedUser('admin_unit', 'dir_bppt');
    ptep = await h.seedUser('admin_unit', 'dir_ptep');
    klasifikasi = await h.ensureKlasifikasi();
}, 120_000);
afterAll(async () => { await h?.close(); });

describe('skenario §2', () => {
    it('(a) TU mencatat → disposisi BPPT → BPPT membalas → diberkaskan di BPPT', async () => {
        expect((await lacakService.search(tu, { q: 'A-1/2026', mode: 'cek', limit: 8 })).kelompok).toEqual([]);
        const sm = await catatMasuk('A-1/2026', { disposisi: { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }], instruksi: 'Mohon ditindaklanjuti' } });
        expect((await lacakService.search(tu, { q: 'a1-2026', mode: 'cek', limit: 8 })).kelompok).toHaveLength(1);
        const rs = (await rangkaianDari('surat_masuk_id', sm.id))!;
        const akses = await recordAccessService.checkRead(bppt, 'surat_masuk', sm.id);
        expect(akses).toMatchObject({ allowed: true, mutable: false, via: 'peserta' });
        const aksi = await suratAksiPayload(bppt, 'surat_masuk', sm.id, akses);
        expect(aksi.aksiDiizinkan.sort()).toEqual(['buat_nota_dinas', 'penyelesaian', 'saya_balas', 'terima']);
        expect((await h.query('SELECT status FROM surat_distributions WHERE surat_masuk_id = $1', [sm.id]))[0].status).toBe('sent');
        const nd = await buatKeluar(bppt, { tindakLanjut: { jenis: 'surat_masuk', suratId: sm.id, jenisRelasi: 'tindak_lanjut' } });
        const [dist] = await h.query('SELECT id, status FROM surat_distributions WHERE surat_masuk_id = $1', [sm.id]);
        expect(dist.status).toBe('received');
        expect(await statusSurat(sm.id)).toBe('belum_dibalas');
        await setujui(nd.id);
        expect(await statusSurat(sm.id)).toBe('sudah_dibalas');
        await distributionService.process(dist.id, 'dir_bppt', audit(bppt), { penyelesaianSuratKeluarId: nd.id }, bppt);
        expect(await statusRangkaian(rs)).toBe('selesai');
        await berkasService.berkaskan(bppt, rs, { unitPengolahId: 'dir_bppt', klasifikasiItemId: klasifikasi, konfirmasi: true }, audit(bppt));
        expect(await statusRangkaian(rs)).toBe('diberkaskan');
        await expect(distributionService.distribute({ suratMasukId: sm.id, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ptep', sentBy: tu.id }, audit(tu)))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    it('(b) SK inisiatif lalu ND penjelas: satu kartu Lacak, selesai otomatis setelah semua disetujui', async () => {
        const sk = await buatKeluar(bppt, { naskahDinas: 'Keputusan', perihal: 'Penetapan tim terpadu', asalNaskah: 'inisiatif' });
        expect(await rangkaianDari('surat_keluar_id', sk.id)).toBeUndefined();
        const nd = await buatKeluar(bppt, { perihal: `Penjelasan Keputusan Nomor ${sk.nomorSurat}`, tindakLanjut: { jenis: 'surat_keluar', suratId: sk.id, jenisRelasi: 'menjelaskan' } });
        const rs = (await rangkaianDari('surat_keluar_id', sk.id))!;
        expect(await statusRangkaian(rs)).toBe('aktif');
        await setujui(sk.id);
        await setujui(nd.id);
        expect(await statusRangkaian(rs)).toBe('selesai');
        const kartuNomor = await lacakService.search(bppt, { q: sk.nomorSurat, mode: 'lacak', limit: 8 });
        const kartuPerihal = await lacakService.search(bppt, { q: 'Penjelasan Keputusan', mode: 'lacak', limit: 8 });
        expect(kartuNomor.kelompok[0].kunci).toBe(rs);
        expect(kartuPerihal.kelompok[0].kunci).toBe(rs);
        expect(kartuNomor.kelompok[0].rangkaian?.tahun).toBe(2026);
    });

    it('(c) dua direktorat: tolak mencabut jangkauan, disposisi ulang, selesai setelah semua processed, diberkaskan sekali', async () => {
        const sm = await catatMasuk('C-1/2026', { disposisi: { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }, { unitKerjaId: 'dir_ptep' }] } });
        const rs = (await rangkaianDari('surat_masuk_id', sm.id))!;
        const ptepDist = (await h.query("SELECT id FROM surat_distributions WHERE surat_masuk_id = $1 AND target_unit_id = 'dir_ptep'", [sm.id]))[0].id;
        await distributionService.reject(ptepDist, 'Bukan tugas PTEP', 'dir_ptep', audit(ptep));
        expect((await recordAccessService.checkRead(ptep, 'surat_masuk', sm.id)).allowed).toBe(false);
        const ulang = await distributionService.distribute({ suratMasukId: sm.id, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ptep', sentBy: tu.id }, audit(tu));
        const ndB = await buatKeluar(bppt, { tindakLanjut: { jenis: 'surat_masuk', suratId: sm.id, jenisRelasi: 'tindak_lanjut' } });
        const ndP = await buatKeluar(ptep, { tindakLanjut: { jenis: 'surat_masuk', suratId: sm.id, jenisRelasi: 'tindak_lanjut' } });
        await setujui(ndB.id);
        await setujui(ndP.id);
        const bpptDist = (await h.query("SELECT id FROM surat_distributions WHERE surat_masuk_id = $1 AND target_unit_id = 'dir_bppt'", [sm.id]))[0].id;
        await distributionService.process(bpptDist, 'dir_bppt', audit(bppt), { penyelesaianSuratKeluarId: ndB.id }, bppt);
        expect(await statusRangkaian(rs)).toBe('aktif');
        await distributionService.process(ulang.id, 'dir_ptep', audit(ptep), { penyelesaianSuratKeluarId: ndP.id }, ptep);
        expect(await statusRangkaian(rs)).toBe('selesai');
        await berkasService.berkaskan(tu, rs, { unitPengolahId: 'dir_bppt', klasifikasiItemId: klasifikasi, konfirmasi: true }, audit(tu));
        await expect(berkasService.berkaskan(tu, rs, { unitPengolahId: 'dir_bppt', klasifikasiItemId: klasifikasi, konfirmasi: true }, audit(tu)))
            .rejects.toMatchObject({ statusCode: 409 });
        expect((await recordAccessService.checkRead(ptep, 'surat_masuk', sm.id)).allowed).toBe(true);
        expect((await h.query('SELECT unit_kerja_id FROM surat_keluar WHERE id = $1', [ndP.id]))[0].unit_kerja_id).toBe('dir_ptep');
    });

    it('(d) surat masuk membalas surat keluar kita: bergabung (merujuk), aktif kembali, selesai setelah ditangani', async () => {
        const sk = await buatKeluar(bppt, { naskahDinas: 'Surat Dinas', perihal: 'Permintaan data ke Pemda', asalNaskah: 'inisiatif' });
        await setujui(sk.id);
        const rs = (await rangkaianDari('surat_keluar_id', sk.id)) ?? null;
        expect(rs).toBeNull();
        const sm = await catatMasuk('D-1/2026', { referensi: { jenis: 'surat_keluar', id: sk.id }, disposisi: { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }] } });
        const rsBaru = (await rangkaianDari('surat_masuk_id', sm.id))!;
        expect(await rangkaianDari('surat_keluar_id', sk.id)).toBe(rsBaru);
        expect(await statusRangkaian(rsBaru)).toBe('aktif');
        const dist = (await h.query('SELECT id FROM surat_distributions WHERE surat_masuk_id = $1', [sm.id]))[0].id;
        await distributionService.process(dist, 'dir_bppt', audit(bppt), { catatanPenyelesaian: 'Data sudah diterima dan diolah' }, bppt);
        expect(await statusRangkaian(rsBaru)).toBe('selesai');
        expect(await statusSurat(sm.id)).toBe('sudah_dibalas');
    });

    it('(e) TU lupa Nomor Referensi: pengawas menggabungkan, disposisi ikut pindah, Lacak mengikuti target', async () => {
        const skA = await buatKeluar(bppt, { naskahDinas: 'Surat Dinas', perihal: 'Undangan verifikasi lokasi', asalNaskah: 'inisiatif' });
        const ndA = await buatKeluar(bppt, { tindakLanjut: { jenis: 'surat_keluar', suratId: skA.id, jenisRelasi: 'tindak_lanjut' } });
        await setujui(skA.id);
        await setujui(ndA.id);
        const a = (await rangkaianDari('surat_keluar_id', skA.id))!;
        const smB = await catatMasuk('E-1/2026', { disposisi: { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }] } });
        const b = (await rangkaianDari('surat_masuk_id', smB.id))!;
        await rangkaianLinkService.gabung(tu, a, { sumberId: b, alasan: 'TU lupa mengisi Nomor Referensi' }, audit(tu));
        expect(await statusRangkaian(b)).toBe('digabung');
        expect(await statusRangkaian(a)).toBe('aktif');
        expect((await h.query('SELECT rangkaian_id FROM surat_distributions WHERE surat_masuk_id = $1', [smB.id]))[0].rangkaian_id).toBe(a);
        expect((await lacakService.search(tu, { q: 'E-1/2026', mode: 'lacak', limit: 8 })).kelompok[0].kunci).toBe(a);
    });

    it('race: dua penyelesaian bersamaan tetap berakhir selesai (kunci rangkaian menaik)', async () => {
        const sm = await catatMasuk('R-1/2026', { disposisi: { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }, { unitKerjaId: 'dir_ptep' }] } });
        const rs = (await rangkaianDari('surat_masuk_id', sm.id))!;
        const rows = await h.query<{ id: string; target_unit_id: string }>('SELECT id, target_unit_id FROM surat_distributions WHERE surat_masuk_id = $1', [sm.id]);
        const siapa = (unit: string) => (unit === 'dir_bppt' ? bppt : ptep);
        await Promise.all(rows.map((row) => distributionService.process(row.id, row.target_unit_id, audit(siapa(row.target_unit_id)),
            { catatanPenyelesaian: 'Ditangani bersamaan oleh direktorat' }, siapa(row.target_unit_id))));
        expect(await statusRangkaian(rs)).toBe('selesai');
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan lulus**

Run: `cd backend && TEST_POSTGRES_URL=postgresql://simsa_test:simsa_test@127.0.0.1:5432/simsa_test npx vitest run --config vitest.postgres.config.ts integration/skenario-rangkaian.postgres.test.ts`
Expected: PASS (6 test). Kegagalan di sini menunjukkan celah integrasi antartask — perbaiki di task pemilik kode, bukan dengan melonggarkan skenario.

- [ ] **Step 3: Jalankan seluruh suite backend + typecheck**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json && npx vitest run && TEST_POSTGRES_URL=postgresql://simsa_test:simsa_test@127.0.0.1:5432/simsa_test npx vitest run --config vitest.postgres.config.ts`
Expected: tanpa error tipe; semua test PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/integration/skenario-rangkaian.postgres.test.ts
git commit -m "test(rangkaian): skenario a-e end-to-end dan race auto-selesai di PostgreSQL

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


#### Amandemen pra-eksekusi Task 17 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


**Step 1: add these races** to `describe('skenario §2')` [T17-1]. Each builds its fixture, runs the pair with `Promise.all(...map(p => p.then(() => 'ok', e => e)))`, asserts that no result has `code === '40P01'` or `cause.code === '40P01'`, and asserts the final state is consistent (statuses recomputed, no orphan rows).

| Race | Detail |
|---|---|
| process ∥ distribute | same SM, a new target |
| receive ∥ process | same distribution |
| tutupOlehPengawas ∥ distribute | same SM |
| `approvalService.approve` ∥ distribute | final approve of an SK replying to SM X, raced with distribute on X |
| tautanKeSurat ∥ gabung | overlapping rangkaian |
| berkaskan ∥ guarded `suratMasukService.update` | on a member SM; the update is either audited before, or 409 after |

At least one SK in scenarios (a)/(b) must be approved through `approvalService.approve` rather than `setujui` (plan:6151-6154), so that the Task 12 hook and lock order run end to end.

**Step 3.** Depends on the Task 10 test fixes (inbox classification) and the Task 16 test updates. If either is red, fix it in that task, not here.

---


**C-11 (critic) — Task 17: the approve fixture needs submit, an approver and a request (**test completeness**) [C-11]**


T17-1 (amend:964) asks for `approvalService.approve` without saying how to build the fixture. `approve` (`approval.service.ts:378-420`) requires:
- the advisory mandate lock;
- a fresh actor in `ADMIN_ROLES` of the SK's unit (`assertApproverMandate`, `:73-83`);
- `approvalStatus === 'pending'` with `currentApproverId === actor.id`;
- a pending `approval_requests` row.

Build the fixture in this order:
1. Create the SK through `suratKeluarService.create`. The author is `bpptStaff` or an admin.
2. Call `approvalService.submit(skId, author, bpptAdmin.id)` (`:229`).
3. Call `approvalService.approve(skId, bpptAdmin, 'dir_bppt')`.

`bpptAdmin` must be a different user from the author. The harness must seed it as a fresh, active user of `dir_bppt`.



## G. Frontend

### Task 18: Service klien rangkaian/distribusi dan hook `useLacakSearch`

**Files:**
- Modify: `frontend/src/services/rangkaian.service.js` (dibuat P2 dengan `getById`/`getBySurat`; tambahkan metode P3 ke objek yang sama — bila berkas belum ada, buat dengan `import api from './api'` dan objek `rangkaianService` berisi metode di bawah)
- Modify: `frontend/src/services/distribution.service.js:78-100`
- Create: `frontend/src/hooks/use-lacak-search.js`
- Test: `frontend/src/services/rangkaian.service.p3.test.js`, `frontend/src/hooks/use-lacak-search.test.jsx`

**Interfaces:**
- Consumes: kontrak `/api/rangkaian/lacak` dan endpoint Task 4–16.
- Produces: `rangkaianService.{ lacak({ q, mode, tahun, jenis, limit }, { signal }), tandaiSelesai(id, catatan), bukaKembali(id, alasan), opsiBerkas(id), berkaskan(id, { unitPengolahId, klasifikasiItemId, catatan }), ubahUnitPengolah(id, unitPengolahId), tautkanKeSurat(payload), pratinjauGabung(id, sumberId), gabung(id, { sumberId, alasan }), batalRelasi(relasiId, alasan), tutupDisposisi(distribusiId, alasan), ajukanAkses(anggotaId, purpose) }`; `distributionService.{ getOpsi(), distributeMany({ suratMasukId, sourceUnitId, targets, instruksi }), process(id, unitKerjaId, penyelesaian), getKandidatPenyelesaian(id, unitKerjaId) }`; `useLacakSearch(term, { mode, jenis, tahun, enabled }) → { loading, error, data }` (debounce 300 ms, min 3 karakter, AbortController, penjaga urutan basi, cache 20 entri). Ini **satu-satunya** hook Lacak lintas fase: P4 Task 10 mengganti isinya menjadi superset `{ status, loading, data, error, q, retry }` (opsi tambahan `debounceMs`), sehingga test berkas ini wajib tetap hijau; jangan membuat hook Lacak kedua.

- [ ] **Step 1: Tulis test yang gagal**

```js
// frontend/src/services/rangkaian.service.p3.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }))
vi.mock('./api', () => ({ default: mocks, api: mocks }))

const { rangkaianService } = await import('./rangkaian.service')
const { distributionService } = await import('./distribution.service')

beforeEach(() => {
    vi.clearAllMocks()
    mocks.get.mockResolvedValue({ success: true, data: { ok: true } })
    mocks.post.mockResolvedValue({ success: true, data: { ok: true } })
    mocks.put.mockResolvedValue({ success: true, data: { ok: true } })
})

describe('rangkaianService', () => {
    it('lacak meneruskan parameter dan AbortSignal', async () => {
        const controller = new AbortController()
        await rangkaianService.lacak({ q: 'B-12', mode: 'referensi', jenis: 'surat_keluar' }, { signal: controller.signal })
        expect(mocks.get).toHaveBeenCalledWith('/api/rangkaian/lacak',
            { q: 'B-12', mode: 'referensi', tahun: undefined, jenis: 'surat_keluar', limit: 8 }, { signal: controller.signal })
    })

    it.each([
        ['tandaiSelesai', ['rs-1', 'Catatan penyelesaian'], 'post', ['/api/rangkaian/rs-1/selesai', { catatan: 'Catatan penyelesaian' }]],
        ['bukaKembali', ['rs-1', 'Ada surat susulan'], 'post', ['/api/rangkaian/rs-1/buka-kembali', { alasan: 'Ada surat susulan' }]],
        ['berkaskan', ['rs-1', { unitPengolahId: 'dir_bppt', klasifikasiItemId: 7 }], 'post', ['/api/rangkaian/rs-1/berkaskan', { unitPengolahId: 'dir_bppt', klasifikasiItemId: 7, konfirmasi: true }]],
        ['ubahUnitPengolah', ['rs-1', 'dir_ptep'], 'put', ['/api/rangkaian/rs-1/unit-pengolah', { unitPengolahId: 'dir_ptep' }]],
        ['gabung', ['rs-1', { sumberId: 'rs-2', alasan: 'TU lupa referensi' }], 'post', ['/api/rangkaian/rs-1/gabung', { sumberId: 'rs-2', alasan: 'TU lupa referensi' }]],
        ['batalRelasi', ['rel-1', 'Salah tautan surat'], 'post', ['/api/rangkaian/relasi/rel-1/batal', { alasan: 'Salah tautan surat' }]],
        ['tutupDisposisi', ['d-1', 'Target tidak memproses'], 'post', ['/api/rangkaian/disposisi/d-1/tutup', { alasan: 'Target tidak memproses' }]],
        ['ajukanAkses', ['a-1', 'Menindaklanjuti disposisi TU'], 'post', ['/api/rangkaian/anggota/a-1/ajukan-akses', { purpose: 'Menindaklanjuti disposisi TU', accessMode: 'view' }]],
    ])('%s memanggil endpoint yang benar', async (method, args, verb, expected) => {
        await rangkaianService[method](...args)
        expect(mocks[verb]).toHaveBeenCalledWith(...expected)
    })
})

describe('distributionService P3', () => {
    it('distributeMany mengirim targets dan instruksi', async () => {
        await distributionService.distributeMany({ suratMasukId: 's1', sourceUnitId: 'sesditjen', targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }], instruksi: 'Segera' })
        expect(mocks.post).toHaveBeenCalledWith('/api/distributions', { suratMasukId: 's1', sourceUnitId: 'sesditjen', targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }], instruction: 'Segera' })
    })

    it('process mengirim penyelesaian', async () => {
        await distributionService.process('d1', 'dir_bppt', { catatanPenyelesaian: 'Sudah dikoordinasikan' })
        expect(mocks.put).toHaveBeenCalledWith('/api/distributions/d1/process?unitKerjaId=dir_bppt', { catatanPenyelesaian: 'Sudah dikoordinasikan' })
    })
})
```

```jsx
// frontend/src/hooks/use-lacak-search.test.jsx
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ lacak: vi.fn() }))
vi.mock('@/services/rangkaian.service', () => ({ rangkaianService: { lacak: mocks.lacak }, default: { lacak: mocks.lacak } }))
const { useLacakSearch } = await import('./use-lacak-search')

const hasil = (q) => ({ q, mode: 'referensi', jenisKueri: 'nomor', kelompok: [] })

beforeEach(() => {
    vi.useFakeTimers()
    mocks.lacak.mockReset().mockImplementation(async ({ q }) => hasil(q))
})
afterEach(() => vi.useRealTimers())

describe('useLacakSearch', () => {
    it('debounce 300 ms, minimal 3 karakter, satu permintaan untuk ketikan beruntun', async () => {
        const { result, rerender } = renderHook(({ term }) => useLacakSearch(term, { mode: 'referensi' }), { initialProps: { term: 'ab' } })
        await act(async () => { await vi.advanceTimersByTimeAsync(400) })
        expect(mocks.lacak).not.toHaveBeenCalled()
        rerender({ term: 'B-1' })
        await act(async () => { await vi.advanceTimersByTimeAsync(200) })
        rerender({ term: 'B-12' })
        await act(async () => { await vi.advanceTimersByTimeAsync(300) })
        expect(mocks.lacak).toHaveBeenCalledTimes(1)
        expect(mocks.lacak).toHaveBeenCalledWith({ q: 'B-12', mode: 'referensi', jenis: undefined, tahun: undefined }, { signal: expect.any(AbortSignal) })
        expect(result.current.data).toEqual(hasil('B-12'))
    })

    it('membatalkan permintaan lama dan mengabaikan respons basi', async () => {
        let selesaiLama
        mocks.lacak.mockImplementationOnce(({ q }, { signal }) => new Promise((resolve) => { selesaiLama = () => resolve(hasil(q)); signal.addEventListener('abort', () => {}) }))
        const { result, rerender } = renderHook(({ term }) => useLacakSearch(term), { initialProps: { term: 'lama sekali' } })
        await act(async () => { await vi.advanceTimersByTimeAsync(300) })
        const sinyalLama = mocks.lacak.mock.calls[0][1].signal
        rerender({ term: 'baru saja' })
        expect(sinyalLama.aborted).toBe(true)
        await act(async () => { await vi.advanceTimersByTimeAsync(300) })
        await act(async () => { selesaiLama() })
        expect(result.current.data.q).toBe('baru saja')
    })

    it('memakai cache untuk kueri yang sama', async () => {
        const { rerender } = renderHook(({ term }) => useLacakSearch(term), { initialProps: { term: 'Nota dinas' } })
        await act(async () => { await vi.advanceTimersByTimeAsync(300) })
        rerender({ term: 'Nota dinas x' })
        await act(async () => { await vi.advanceTimersByTimeAsync(300) })
        rerender({ term: 'Nota dinas' })
        await act(async () => { await vi.advanceTimersByTimeAsync(300) })
        expect(mocks.lacak).toHaveBeenCalledTimes(2)
    })
})
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd frontend && npx vitest run src/services/rangkaian.service.p3.test.js src/hooks/use-lacak-search.test.jsx`
Expected: FAIL — `rangkaianService.lacak is not a function`, hook belum ada.

- [ ] **Step 3: Implementasi service**

Tambahkan ke objek `rangkaianService` di `frontend/src/services/rangkaian.service.js`:

```js
    /** GET /api/rangkaian/lacak — mode 'lacak' | 'referensi' | 'cek'. */
    async lacak({ q, mode = 'lacak', tahun, jenis, limit = 8 }, { signal } = {}) {
        const response = await api.get('/api/rangkaian/lacak', { q, mode, tahun, jenis, limit }, { signal })
        return response.data
    },
    async tandaiSelesai(id, catatan) {
        return (await api.post(`/api/rangkaian/${id}/selesai`, { catatan })).data
    },
    async bukaKembali(id, alasan) {
        return (await api.post(`/api/rangkaian/${id}/buka-kembali`, { alasan })).data
    },
    async opsiBerkas(id) {
        return (await api.get(`/api/rangkaian/${id}/opsi-berkas`)).data
    },
    async berkaskan(id, { unitPengolahId, klasifikasiItemId, catatan }) {
        return (await api.post(`/api/rangkaian/${id}/berkaskan`, {
            unitPengolahId, klasifikasiItemId, konfirmasi: true, ...(catatan ? { catatan } : {}),
        })).data
    },
    async ubahUnitPengolah(id, unitPengolahId) {
        return (await api.put(`/api/rangkaian/${id}/unit-pengolah`, { unitPengolahId })).data
    },
    async tautkanKeSurat(payload) {
        return (await api.post('/api/rangkaian/tautan', payload)).data
    },
    async pratinjauGabung(id, sumberId) {
        return (await api.get(`/api/rangkaian/${id}/gabung/pratinjau`, { sumberId })).data
    },
    async gabung(id, { sumberId, alasan }) {
        return (await api.post(`/api/rangkaian/${id}/gabung`, { sumberId, alasan })).data
    },
    async batalRelasi(relasiId, alasan) {
        return (await api.post(`/api/rangkaian/relasi/${relasiId}/batal`, { alasan })).data
    },
    async tutupDisposisi(distribusiId, alasan) {
        return (await api.post(`/api/rangkaian/disposisi/${distribusiId}/tutup`, { alasan })).data
    },
    async ajukanAkses(anggotaId, purpose) {
        return (await api.post(`/api/rangkaian/anggota/${anggotaId}/ajukan-akses`, { purpose, accessMode: 'view' })).data
    },
```

Di `frontend/src/services/distribution.service.js`, ganti metode `process` dan tambahkan metode baru:

```js
    /** Chip instruksi statis dan status jalur akses disposisi surat terkendali. */
    async getOpsi() {
        const response = await api.get('/api/distributions/opsi');
        return response.data;
    },

    /** Disposisi multi-direktorat dalam satu transaksi. */
    async distributeMany({ suratMasukId, sourceUnitId, targets, instruksi }) {
        const response = await api.post('/api/distributions', { suratMasukId, sourceUnitId, targets, instruction: instruksi || null });
        return response.data;
    },

    /** Penyelesaian: { penyelesaianSuratKeluarId } atau { catatanPenyelesaian ≥10 }. */
    async process(id, unitKerjaId, penyelesaian) {
        const response = await api.put(withUnit(`/api/distributions/${id}/process`, unitKerjaId), penyelesaian);
        return response.data;
    },

    async getKandidatPenyelesaian(id, unitKerjaId) {
        const response = await api.get(`/api/distributions/${id}/kandidat-penyelesaian`, { unitKerjaId });
        return response.data || [];
    },
```

- [ ] **Step 4: Implementasi hook**

```js
// frontend/src/hooks/use-lacak-search.js
import { useEffect, useRef, useState } from 'react'
import { rangkaianService } from '@/services/rangkaian.service'

const DEBOUNCE_MS = 300
const MIN_KARAKTER = 3
const BATAS_CACHE = 20
const KOSONG = { loading: false, error: null, data: null }

/** Pencarian Lacak dengan debounce, AbortController, penjaga urutan basi, dan cache LRU 20 entri (§6). */
export function useLacakSearch(term, { mode = 'lacak', jenis, tahun, enabled = true } = {}) {
    const [state, setState] = useState(KOSONG)
    const cacheRef = useRef(new Map())
    const urutanRef = useRef(0)

    useEffect(() => {
        const q = (term || '').trim()
        const urutan = ++urutanRef.current
        if (!enabled || q.length < MIN_KARAKTER) {
            setState(KOSONG)
            return undefined
        }
        const kunci = JSON.stringify([q, mode, jenis ?? null, tahun ?? null])
        const tersimpan = cacheRef.current.get(kunci)
        if (tersimpan) {
            cacheRef.current.delete(kunci)
            cacheRef.current.set(kunci, tersimpan)
            setState({ loading: false, error: null, data: tersimpan })
            return undefined
        }
        const controller = new AbortController()
        setState((prev) => ({ ...prev, loading: true, error: null }))
        const timer = setTimeout(async () => {
            try {
                const data = await rangkaianService.lacak({ q, mode, jenis, tahun }, { signal: controller.signal })
                if (urutan !== urutanRef.current) return
                cacheRef.current.set(kunci, data)
                if (cacheRef.current.size > BATAS_CACHE) cacheRef.current.delete(cacheRef.current.keys().next().value)
                setState({ loading: false, error: null, data })
            } catch (error) {
                if (controller.signal.aborted || urutan !== urutanRef.current) return
                setState({ loading: false, error, data: null })
            }
        }, DEBOUNCE_MS)
        return () => {
            clearTimeout(timer)
            controller.abort()
        }
    }, [term, mode, jenis, tahun, enabled])

    return state
}
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `cd frontend && npx vitest run src/services/rangkaian.service.p3.test.js src/hooks/use-lacak-search.test.jsx src/services/integration-contracts.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/rangkaian.service.js frontend/src/services/distribution.service.js frontend/src/hooks/use-lacak-search.js frontend/src/services/rangkaian.service.p3.test.js frontend/src/hooks/use-lacak-search.test.jsx
git commit -m "feat(frontend): service rangkaian/distribusi P3 dan hook useLacakSearch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


#### Amandemen pra-eksekusi Task 18 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


**Files: change**
- `frontend/src/services/rangkaian.service.js` exists (P2, `:1-18`); drop the "bila berkas belum ada, buat…" clause.
- Put the tests into the existing `frontend/src/services/rangkaian.service.test.js`, adding `post: vi.fn()` and `put: vi.fn()` to its `./api` mock, instead of a new `rangkaian.service.p3.test.js`. [T18-3]
- **Add:** Modify `frontend/src/services/integration-contracts.test.js:238-251`.

**Service methods.** Every P3 path id is wrapped in `encodeURIComponent(...)`, like the P2 `getById`/`getBySurat` (`rangkaian.service.js:7,13`). Update the expected URLs in the test table (plan:6343-6348) only if the ids contain special characters; the fixture ids do not. [T18-3]

**`integration-contracts.test.js`** [T18-1]:
- `await distributionService.process('dist-1', 'unit-a');` becomes `await distributionService.process('dist-1', 'unit-a', { catatanPenyelesaian: 'Sudah dikoordinasikan' });`.
- `expect(apiMock.put).toHaveBeenNthCalledWith(2, '/api/distributions/dist-1/process?unitKerjaId=unit-a');` becomes `…NthCalledWith(2, '/api/distributions/dist-1/process?unitKerjaId=unit-a', { catatanPenyelesaian: 'Sudah dikoordinasikan' });`.
- Add the file to Step 6 `git add`.

**`use-lacak-search.js`: replace the plan implementation** (plan:6505-6557) with the version below. [T18-2]

This version was verified in the scratchpad against the repo ESLint config (0 errors) and against the plan's three tests at plan:6370-6422 (3/3 PASS, unchanged).

What it keeps from the plan:
- the 300 ms debounce and the 3-character minimum;
- the per-hook LRU cache of 20 entries;
- `lacak({ q, mode, jenis, tahun }, { signal })`, with no `limit`;
- aborting the old request on change, ignoring stale responses, and keeping the previous data while loading.

The difference: no `setState` runs synchronously in the effect body. The empty state and cache hits are derived during render, and every `setState` sits in a timer callback.

`retry()` is added as a superset of `{ loading, error, data }`, with the same name and signature P4 Task 10 plans (P4 plan:1972). P4 Task 10 keeps it. Task 20's "Coba lagi" button uses it.

```js
// frontend/src/hooks/use-lacak-search.js
import { useEffect, useState } from 'react'
import rangkaianService from '@/services/rangkaian.service'

const DEBOUNCE_MS = 300
const MIN_KARAKTER = 3
const BATAS_CACHE = 20
const KOSONG = { loading: false, error: null, data: null }

function simpan(prev, kunci, data) {
    const next = new Map(prev)
    next.delete(kunci)
    next.set(kunci, data)
    if (next.size > BATAS_CACHE) next.delete(next.keys().next().value)
    return next
}

/**
 * Pencarian Lacak dengan debounce, AbortController, penjaga respons basi, dan cache LRU 20 entri per hook (§6).
 * Tanpa setState sinkron di badan effect (react-hooks/set-state-in-effect): keadaan kosong/cache diturunkan saat render,
 * semua setState berada di callback timer.
 */
export function useLacakSearch(term, { mode = 'lacak', jenis, tahun, enabled = true } = {}) {
    const q = (term || '').trim()
    const kunci = enabled && q.length >= MIN_KARAKTER ? JSON.stringify([q, mode, jenis ?? null, tahun ?? null]) : null
    const [cache, setCache] = useState(() => new Map())
    const [gagal, setGagal] = useState({ kunci: null, error: null })
    const [terakhir, setTerakhir] = useState(null)
    const [percobaan, setPercobaan] = useState(0)
    const tersimpan = kunci ? cache.get(kunci) : undefined

    useEffect(() => {
        if (!kunci) return undefined
        if (tersimpan !== undefined) {
            // Sentuh entri LRU (asinkron, bukan setState sinkron di effect).
            const sentuh = setTimeout(() => setCache((prev) => (prev.get(kunci) === tersimpan ? simpan(prev, kunci, tersimpan) : prev)), 0)
            return () => clearTimeout(sentuh)
        }
        const controller = new AbortController()
        const timer = setTimeout(async () => {
            try {
                const data = await rangkaianService.lacak({ q, mode, jenis, tahun }, { signal: controller.signal })
                if (controller.signal.aborted) return
                setCache((prev) => simpan(prev, kunci, data))
                setTerakhir(data)
            } catch (error) {
                if (controller.signal.aborted) return
                setGagal({ kunci, error })
            }
        }, DEBOUNCE_MS)
        return () => {
            clearTimeout(timer)
            controller.abort()
        }
    }, [kunci, tersimpan, q, mode, jenis, tahun, percobaan])

    /** Superset kontrak P3 (nama & tanda tangan sama dengan P4 Task 10): ulangi kueri yang gagal. */
    const retry = () => {
        setGagal({ kunci: null, error: null })
        setPercobaan((n) => n + 1)
    }

    if (!kunci) return { ...KOSONG, retry }
    if (tersimpan !== undefined) return { loading: false, error: null, data: tersimpan, retry }
    if (gagal.kunci === kunci) return { loading: false, error: gagal.error, data: null, retry }
    return { loading: true, error: null, data: terakhir, retry }
}
```

**Step 5: add** `cd frontend && npx eslint src/hooks/use-lacak-search.js src/services/rangkaian.service.js src/services/distribution.service.js`. Expected: 0 errors.

---



### Task 19: `TindakLanjutMenu` menggantikan "Balas Surat"; gating dari `aksiDiizinkan`

**Files:**
- Create: `frontend/src/lib/tindak-lanjut.js`
- Create: `frontend/src/components/surat/TindakLanjutMenu.jsx`
- Modify: `frontend/src/components/surat-masuk/DetailHeader.jsx:1-140`
- Modify: `frontend/src/components/surat-masuk/StatusSidebar.jsx:10,132-175`
- Modify: `frontend/src/pages/SuratMasukDetail.jsx:19-180`
- Modify: `frontend/src/pages/SuratKeluarDetail.jsx:44-48,245-322`
- Modify: `frontend/src/pages/SuratMasuk.jsx:699-721`
- Test: `frontend/src/components/surat/TindakLanjutMenu.test.jsx`, `frontend/src/components/surat-masuk/__tests__/DetailHeader.aksi.test.jsx`

**Interfaces:**
- Consumes: `data.aksiDiizinkan`, `data.aksesMelalui`, `data.distribusiUnitSaya`, `data.rangkaian` dari GET detail (Task 16); `distributionService.receive`.
- Produces: `buildTindakLanjutState(jenis, surat, aksi): { tindakLanjut: { jenis, suratId, nomorSurat, perihal, rangkaianKode, jenisRelasi, distribusiId?, terkunci: true }, preset: { naskahDinas?, perihal, kepada? } }`; `toTindakLanjutPayload(referensi)`; `isKeputusan(naskah)`; `isSifatTerkendali(sifat)`; `JENIS_RELASI_LABEL`; `<TindakLanjutMenu jenis surat aksiDiizinkan onDisposisi? onTautkan? onTerima? onPenyelesaian? variant? className? label? />`; `DetailHeader` props baru `{ surat, onBack, onEdit, onDistribute, onArchive, onTerima, onPenyelesaian, onTautkan, isAdmin }`; penyelesaian dari detail menavigasi ke `/distribusi?penyelesaian=<distribusiId>`.

- [ ] **Step 1: Tulis test yang gagal**

```jsx
// frontend/src/components/surat/TindakLanjutMenu.test.jsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { TindakLanjutMenu } from './TindakLanjutMenu'

let router
afterEach(() => { cleanup(); router?.dispose() })

function tampilkan(props) {
    router = createMemoryRouter([
        { path: '/', element: <TindakLanjutMenu {...props} /> },
        { path: '/surat/keluar/tambah', element: <h1>Form surat keluar</h1> },
    ])
    render(<RouterProvider router={router} />)
}
const bukaMenu = () => fireEvent.keyDown(screen.getByRole('button', { name: /Tindak Lanjut/ }), { key: 'Enter' })
const suratMasuk = { id: 'sm-1', nomorSurat: 'B-12/2026', perihal: 'Permohonan data', dari: 'Pemda', rangkaian: { kode: 'RS-2026-000001' }, distribusiUnitSaya: { id: 'd1', status: 'sent' } }

describe('TindakLanjutMenu', () => {
    it('tidak dirender tanpa aksi yang diizinkan server', () => {
        tampilkan({ jenis: 'surat_masuk', surat: suratMasuk, aksiDiizinkan: [] })
        expect(screen.queryByRole('button', { name: /Tindak Lanjut/ })).toBeNull()
    })

    it('Saya Balas membawa Nomor Referensi terkunci, disposisi aktif, dan preset balasan', async () => {
        tampilkan({ jenis: 'surat_masuk', surat: suratMasuk, aksiDiizinkan: ['saya_balas', 'buat_nota_dinas'] })
        bukaMenu()
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Saya Balas' }))
        await screen.findByRole('heading', { name: 'Form surat keluar' })
        expect(router.state.location.state).toEqual({
            tindakLanjut: { jenis: 'surat_masuk', suratId: 'sm-1', nomorSurat: 'B-12/2026', perihal: 'Permohonan data', rangkaianKode: 'RS-2026-000001', distribusiId: 'd1', jenisRelasi: 'balasan', terkunci: true },
            preset: { perihal: 'Balasan: Permohonan data', kepada: 'Pemda' },
        })
    })

    it('ND Penjelas hanya muncul bila diizinkan dan memakai relasi menjelaskan', async () => {
        tampilkan({ jenis: 'surat_keluar', surat: { id: 'sk-1', nomorSurat: 'KEP-7/2026', perihal: 'Penetapan tim', naskahDinas: 'Keputusan' }, aksiDiizinkan: ['buat_nd_penjelas'] })
        bukaMenu()
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Buat ND Penjelas' }))
        await screen.findByRole('heading', { name: 'Form surat keluar' })
        expect(router.state.location.state.tindakLanjut.jenisRelasi).toBe('menjelaskan')
        expect(router.state.location.state.preset).toEqual({ naskahDinas: 'Nota Dinas', perihal: 'Penjelasan Keputusan Nomor KEP-7/2026' })
    })

    it('aksi berbasis callback hanya tampil bila handler tersedia', async () => {
        const onTerima = vi.fn()
        tampilkan({ jenis: 'surat_masuk', surat: suratMasuk, aksiDiizinkan: ['terima', 'penyelesaian', 'disposisi'], onTerima })
        bukaMenu()
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Terima Disposisi' }))
        expect(onTerima).toHaveBeenCalled()
        bukaMenu()
        expect(screen.queryByRole('menuitem', { name: 'Penyelesaian' })).toBeNull()
        expect(screen.queryByRole('menuitem', { name: 'Disposisi ke Direktorat' })).toBeNull()
    })
})
```

```jsx
// frontend/src/components/surat-masuk/__tests__/DetailHeader.aksi.test.jsx
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { DetailHeader } from '../DetailHeader'

afterEach(cleanup)
const dasar = { id: 'sm-1', nomorSurat: 'B-12/2026', perihal: 'Permohonan', isArchived: false }
const tampil = (surat) => render(<MemoryRouter><DetailHeader surat={surat} onBack={() => {}} onEdit={() => {}} onDistribute={() => {}} onArchive={() => {}} isAdmin /></MemoryRouter>)

it('edit/arsip disembunyikan bila akses bukan pemilik; menu tindak lanjut dari server tetap tampil', () => {
    tampil({ ...dasar, aksesMelalui: 'peserta', aksiDiizinkan: ['saya_balas', 'terima'] })
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Arsipkan' })).toBeNull()
    expect(screen.getAllByRole('button', { name: /Tindak Lanjut/ }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Balas Surat/ })).toBeNull()
})

it('pemilik tetap mendapat edit dan arsip (respons lama tanpa aksesMelalui dianggap pemilik)', () => {
    tampil({ ...dasar })
    expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Arsipkan' }).length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd frontend && npx vitest run src/components/surat/TindakLanjutMenu.test.jsx src/components/surat-masuk/__tests__/DetailHeader.aksi.test.jsx`
Expected: FAIL — komponen belum ada; DetailHeader masih menampilkan Edit untuk peserta.

- [ ] **Step 3: Implementasi helper dan menu**

```js
// frontend/src/lib/tindak-lanjut.js
export const JENIS_RELASI_LABEL = Object.freeze({
    balasan: 'Balasan',
    tindak_lanjut: 'Tindak lanjut',
    menjelaskan: 'Menjelaskan',
    merujuk: 'Merujuk',
})

const SIFAT_BIASA = new Set(['biasa', 'biasa/terbuka', 'terbuka', 'segera', 'sangat_segera', 'undangan', 'penting'])

/** Cermin normalizeSecurityClassification backend: nilai tak dikenal dianggap terkendali. */
export function isSifatTerkendali(sifat) {
    const normalized = String(sifat || 'biasa').trim().toLowerCase().replace(/[\s-]+/g, '_')
    return !SIFAT_BIASA.has(normalized)
}

export function isKeputusan(naskahDinas) {
    return /keputusan/i.test(naskahDinas || '')
}

/** location.state untuk /surat/keluar/tambah dari menu Tindak Lanjut / Kotak Disposisi. */
export function buildTindakLanjutState(jenis, surat, aksi) {
    const disposisiHidup = surat.distribusiUnitSaya && ['sent', 'received'].includes(surat.distribusiUnitSaya.status)
    const referensi = {
        jenis,
        suratId: surat.id,
        nomorSurat: surat.nomorSurat || null,
        perihal: surat.perihal || null,
        rangkaianKode: surat.rangkaian?.kode || null,
        ...(disposisiHidup ? { distribusiId: surat.distribusiUnitSaya.id } : {}),
    }
    if (aksi === 'buat_nd_penjelas') {
        return {
            tindakLanjut: { ...referensi, jenisRelasi: 'menjelaskan', terkunci: true },
            preset: { naskahDinas: 'Nota Dinas', perihal: `Penjelasan Keputusan Nomor ${surat.nomorSurat || ''}`.trim() },
        }
    }
    if (aksi === 'buat_nota_dinas') {
        return {
            tindakLanjut: { ...referensi, jenisRelasi: 'tindak_lanjut', terkunci: true },
            preset: { naskahDinas: 'Nota Dinas', perihal: `Tindak lanjut: ${surat.perihal || ''}` },
        }
    }
    return {
        tindakLanjut: { ...referensi, jenisRelasi: jenis === 'surat_masuk' ? 'balasan' : 'tindak_lanjut', terkunci: true },
        preset: { perihal: `Balasan: ${surat.perihal || ''}`, kepada: jenis === 'surat_masuk' ? (surat.dari || '') : (surat.kepada || '') },
    }
}

/** Bentuk payload `tindakLanjut` untuk POST /api/surat-keluar. */
export function toTindakLanjutPayload(referensi) {
    if (!referensi) return undefined
    const { jenis, suratId, jenisRelasi, distribusiId } = referensi
    return distribusiId ? { jenis, suratId, jenisRelasi, distribusiId } : { jenis, suratId, jenisRelasi }
}
```

Perhatikan urutan kunci objek `tindakLanjut` harus sama dengan test (`jenis, suratId, nomorSurat, perihal, rangkaianKode, distribusiId, jenisRelasi, terkunci`) — `toEqual` tidak peka urutan, jadi cukup isi sama.

```jsx
// frontend/src/components/surat/TindakLanjutMenu.jsx
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ClipboardCheck, FileSignature, FileText, Inbox, Link2, Reply, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { buildTindakLanjutState } from '@/lib/tindak-lanjut'

/** Menu Tindak Lanjut (§7): item tampil sesuai aksiDiizinkan dari server, bukan canWrite(unit rekaman). */
export function TindakLanjutMenu({
    jenis, surat, aksiDiizinkan = [], onDisposisi, onTautkan, onTerima, onPenyelesaian,
    variant = 'secondary', className, label = 'Tindak Lanjut',
}) {
    const navigate = useNavigate()
    const aksi = new Set(aksiDiizinkan)
    const keForm = (jenisAksi) => navigate('/surat/keluar/tambah', { state: buildTindakLanjutState(jenis, surat, jenisAksi) })
    const items = [
        aksi.has('saya_balas') && { key: 'saya_balas', text: 'Saya Balas', Icon: Reply, onSelect: () => keForm('saya_balas') },
        aksi.has('buat_nota_dinas') && { key: 'buat_nota_dinas', text: 'Buat Nota Dinas', Icon: FileText, onSelect: () => keForm('buat_nota_dinas') },
        aksi.has('buat_nd_penjelas') && { key: 'buat_nd_penjelas', text: 'Buat ND Penjelas', Icon: FileSignature, onSelect: () => keForm('buat_nd_penjelas') },
        aksi.has('disposisi') && onDisposisi && { key: 'disposisi', text: 'Disposisi ke Direktorat', Icon: Send, onSelect: onDisposisi },
        aksi.has('terima') && onTerima && { key: 'terima', text: 'Terima Disposisi', Icon: Inbox, onSelect: onTerima },
        aksi.has('penyelesaian') && onPenyelesaian && { key: 'penyelesaian', text: 'Penyelesaian', Icon: ClipboardCheck, onSelect: onPenyelesaian },
        aksi.has('tautkan') && onTautkan && { key: 'tautkan', text: 'Tautkan ke Rangkaian', Icon: Link2, onSelect: onTautkan },
    ].filter(Boolean)
    if (items.length === 0) return null
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button type="button" variant={variant} className={className}>
                    {label}
                    <ChevronDown className="ml-2 h-4 w-4" aria-hidden="true" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                {items.map(({ key, text, Icon, onSelect }) => (
                    <DropdownMenuItem key={key} onSelect={onSelect}>
                        <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
                        {text}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
```

- [ ] **Step 4: Pasang di DetailHeader, StatusSidebar, halaman detail, daftar**

`frontend/src/components/surat-masuk/DetailHeader.jsx`: ganti impor ikon baris 1 menjadi `import { ArrowLeft, MailOpen, Edit, Archive, MoreHorizontal } from 'lucide-react';`, tambah `import { TindakLanjutMenu } from '@/components/surat/TindakLanjutMenu';`, ganti tanda tangan menjadi `export function DetailHeader({ surat, onBack, onEdit, onDistribute, onArchive, onTerima, onPenyelesaian, onTautkan, isAdmin })`, dan tambah di awal badan fungsi:

```jsx
    // Respons lama tanpa aksesMelalui berasal dari jalur pemilik.
    const milik = (surat.aksesMelalui ?? 'owner') === 'owner';
    const bolehUbah = isAdmin && milik;
    const menu = (variant, className) => (
        <TindakLanjutMenu
            jenis="surat_masuk"
            surat={surat}
            aksiDiizinkan={surat.aksiDiizinkan || []}
            onDisposisi={onDistribute}
            onTerima={onTerima}
            onPenyelesaian={onPenyelesaian}
            onTautkan={onTautkan}
            variant={variant}
            className={className}
        />
    );
```

Ganti blok "Desktop Actions" (baris 53-89) dengan:

```jsx
                <div className="hidden md:flex gap-2">
                    {bolehUbah && (
                        <Button variant="secondary" className="bg-card/20 hover:bg-card/30 text-white border-0 backdrop-blur-sm" onClick={onEdit}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                        </Button>
                    )}
                    {menu('secondary', 'bg-card/20 hover:bg-card/30 text-white border-0 backdrop-blur-sm')}
                    {bolehUbah && !surat.isArchived && (
                        <Button className="bg-card text-emerald-700 dark:text-emerald-300 hover:bg-card/90" onClick={onArchive}>
                            <Archive className="mr-2 h-4 w-4" />
                            Arsipkan
                        </Button>
                    )}
                </div>
```

dan blok "Mobile Actions" (baris 91-136) dengan:

```jsx
                <div className="md:hidden flex gap-2">
                    {bolehUbah && (
                        <Button variant="secondary" size="sm" className="bg-card/20 hover:bg-card/30 text-white border-0 flex-1" onClick={onEdit}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                        </Button>
                    )}
                    {menu('secondary', 'bg-card/20 hover:bg-card/30 text-white border-0')}
                    {bolehUbah && !surat.isArchived && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="secondary" size="icon" className="bg-card/20 hover:bg-card/30 text-white border-0" aria-label="Aksi lain">
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={onArchive}>
                                    <Archive className="mr-2 h-4 w-4" />
                                    Arsipkan
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>
```

`frontend/src/components/surat-masuk/StatusSidebar.jsx`: ubah tanda tangan menjadi `({ surat, onEdit, onDistribute, onArchive, onTerima, onPenyelesaian, isAdmin })`, impor `TindakLanjutMenu`, hapus impor `Send, Reply`, dan ganti isi `CardContent` "Aksi Cepat" (baris 138-172) menjadi:

```jsx
                        {isAdmin && (surat.aksesMelalui ?? 'owner') === 'owner' && (
                            <Button variant="outline" className="w-full justify-start" onClick={onEdit}>
                                <Edit className="mr-2 h-4 w-4" />
                                Edit Surat
                            </Button>
                        )}
                        <TindakLanjutMenu
                            jenis="surat_masuk"
                            surat={surat}
                            aksiDiizinkan={surat.aksiDiizinkan || []}
                            onDisposisi={onDistribute}
                            onTerima={onTerima}
                            onPenyelesaian={onPenyelesaian}
                            variant="outline"
                            className="w-full justify-between"
                        />
                        {isAdmin && (surat.aksesMelalui ?? 'owner') === 'owner' && !surat.isArchived && (
                            <Button variant="outline" className="w-full justify-start" onClick={onArchive}>
                                <Archive className="mr-2 h-4 w-4" />
                                Arsipkan
                            </Button>
                        )}
```

dan ubah kondisi pembungkus kartu (baris 133) dari `{isAdmin && (` menjadi `{(isAdmin || (surat.aksiDiizinkan || []).length > 0) && (`.

`frontend/src/pages/SuratMasukDetail.jsx`: hapus `handleReply` (baris 70-81); tambah impor `distributionService` dan `useNavigate` sudah ada; tambah handler:

```jsx
    const handleTerima = async () => {
        try {
            await distributionService.receive(surat.distribusiUnitSaya.id, resolveEffectiveUnitKerjaId(user))
            toast({ title: 'Berhasil', description: 'Disposisi diterima' })
            fetchSurat()
        } catch (error) {
            toast({ title: 'Error', description: error.message || 'Gagal menerima disposisi', variant: 'destructive' })
        }
    }
    const handlePenyelesaian = () => navigate(`/distribusi?penyelesaian=${surat.distribusiUnitSaya.id}`)
```

Pada `<DetailHeader ... />` dan `<StatusSidebar ... />` hapus `onReply={handleReply}` dan tambahkan `onTerima={handleTerima}` dan `onPenyelesaian={handlePenyelesaian}`. Pada `<DistributeDialog suratData={{...}}>` tambahkan `sifatSurat: surat.sifatSurat,` ke objek `suratData`.

`frontend/src/pages/SuratKeluarDetail.jsx`: impor `TindakLanjutMenu`; setelah baris 48 tambahkan `const milik = (surat?.aksesMelalui ?? 'owner') === 'owner'`; ubah `canEdit`/`canArchive` (baris 245-246) menjadi `isAdmin && milik && ...`; di blok Desktop Actions (baris 298-320) ubah pembungkus `{isAdmin && (` menjadi `{(isAdmin || (surat.aksiDiizinkan || []).length > 0) && (` dan tambahkan sebelum tombol Arsipkan:

```jsx
                            <TindakLanjutMenu
                                jenis="surat_keluar"
                                surat={surat}
                                aksiDiizinkan={surat.aksiDiizinkan || []}
                                variant="secondary"
                                className="bg-card/20 hover:bg-card/30 text-white border-0 backdrop-blur-sm"
                            />
```

`frontend/src/pages/SuratMasuk.jsx`: impor `buildTindakLanjutState` dan ikon `Reply, FileText`; di menu baris (setelah item "Edit Surat", baris 708-710) sisipkan:

```jsx
                                                                    <DropdownMenuItem onClick={() => navigate('/surat/keluar/tambah', { state: buildTindakLanjutState('surat_masuk', row, 'saya_balas') })}>
                                                                        <Reply className="h-4 w-4 mr-2" /> Saya Balas
                                                                    </DropdownMenuItem>
                                                                    <DropdownMenuItem onClick={() => navigate('/surat/keluar/tambah', { state: buildTindakLanjutState('surat_masuk', row, 'buat_nota_dinas') })}>
                                                                        <FileText className="h-4 w-4 mr-2" /> Buat Nota Dinas
                                                                    </DropdownMenuItem>
```

(`navigate` sudah tersedia di `SuratMasuk.jsx` untuk `handleViewDetail`; bila tidak, tambahkan `const navigate = useNavigate()`.)

- [ ] **Step 5: Jalankan test, pastikan lulus (termasuk regresi halaman)**

Run: `cd frontend && npx vitest run src/components/surat/TindakLanjutMenu.test.jsx src/components/surat-masuk src/pages/surat-archive-dialog.test.jsx src/pages/SuratKeluarDetail.rules.test.jsx src/pages/surat-pagination-recovery.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/tindak-lanjut.js frontend/src/components/surat/TindakLanjutMenu.jsx frontend/src/components/surat/TindakLanjutMenu.test.jsx frontend/src/components/surat-masuk/DetailHeader.jsx frontend/src/components/surat-masuk/StatusSidebar.jsx frontend/src/components/surat-masuk/__tests__/DetailHeader.aksi.test.jsx frontend/src/pages/SuratMasukDetail.jsx frontend/src/pages/SuratKeluarDetail.jsx frontend/src/pages/SuratMasuk.jsx
git commit -m "feat(frontend): menu Tindak Lanjut dari aksiDiizinkan server menggantikan Balas Surat

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


#### Amandemen pra-eksekusi Task 19 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


**Files: add**
- Modify `frontend/src/components/surat/AlurSuratPanel.jsx` (re-export `JENIS_RELASI_LABEL`, add the `onChanged` prop).
- Modify `frontend/src/pages/SuratKeluarDetail.jsx:324-358` (mobile block).

**`lib/tindak-lanjut.js`** [T19-1, T19-2]:
- **`JENIS_RELASI_LABEL`:** define it here with the same values as `AlurSuratPanel.jsx:11`. In `AlurSuratPanel.jsx`, replace the local `export const JENIS_RELASI_LABEL = {…}` with `export { JENIS_RELASI_LABEL } from '@/lib/tindak-lanjut'` plus `import { JENIS_RELASI_LABEL } from '@/lib/tindak-lanjut'` for its own use. The P2 export contract is kept.
- **`isSifatTerkendali`:** mirror the backend exactly:

  ```js
  const BIASA_ALIAS = new Set([/* sama dengan BIASA_SIFAT_ALIASES backend/src/services/access/visibility-spec.ts:13-21 */])
  const TERKENDALI = new Set(['terbatas', 'rahasia', 'sangat_rahasia'])
  export function normalisasiSifat(v) { const s = String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_'); return BIASA_ALIAS.has(s) || s === '' ? 'biasa' : s }
  export function isSifatTerkendali(v) { return TERKENDALI.has(normalisasiSifat(v)) }
  ```

  Delete the comment claiming the "not biasa" variant mirrors the backend. Test: `isSifatTerkendali('klasifikasi-aneh') === false`, `isSifatTerkendali('Sangat Rahasia') === true`.

**`SuratKeluarDetail.jsx`** [T19-3, T19-4]:
- Do **not** add a page-level `const milik`. P2 `isAdmin` at `:50` already folds in `aksesMelalui === 'owner'`.
- Gate Edit/Arsipkan as `const aksi = surat?.aksiDiizinkan; const bolehEdit = Array.isArray(aksi) ? aksi.includes('edit') : isAdmin;`, and the same pattern for `'arsipkan'`, ANDed with the existing approvalStatus rule for `canEdit`/`canArchive` (`:247-248`).
- In the mobile block (`:324-358`), also render `<TindakLanjutMenu … />`, gated by `(surat.aksiDiizinkan || []).length > 0`.

**`DetailHeader` / `StatusSidebar` (SM).** Gate Edit/Arsipkan/Hapus with `aksiDiizinkan.includes('edit'|'arsipkan'|'hapus')` when `aksiDiizinkan` is an array; otherwise fall back to `isAdmin`. Keeping the component-level `aksesMelalui === 'owner'` check as defense in depth is fine. [T19-3]

**`SuratMasuk.jsx`.** Import only `buildTindakLanjutState` from `@/lib/tindak-lanjut`. `Reply` and `FileText` are already imported at `:5`; do not import them again. [T19-5]

**Refresh after actions** [T19-6]:
- `AlurSuratPanel` accepts an optional `onChanged` prop, called after its own reload (see Task 25).
- `SuratMasukDetail`/`SuratKeluarDetail` pass `onChanged={fetchSurat}`.
- In `SuratMasukDetail.jsx`, the `DistributeDialog` `onSuccess` (`:177-183`) also calls `fetchSurat()`.

---



### Task 20: `ReferensiSection`, mode TambahSuratKeluar (inisiatif/tindak lanjut/ND penjelas), route `/surat/keluar/inisiatif`

**Files:**
- Create: `frontend/src/components/surat-keluar/ReferensiSection.jsx`
- Modify: `frontend/src/pages/TambahSuratKeluar.jsx:1-120` (impor, tanda tangan), `:168-209` (state & prefill), `:240-282` (edit & picker lama), `:318-339` (handler lama), `:400-412` (payload create), `:569-672` (kartu referensi)
- Modify: `frontend/src/App.jsx:248`
- Modify: `frontend/src/pages/surat-reply-picker.test.jsx` (ditulis ulang), `frontend/src/pages/surat-form-behavior.test.jsx:172-175`
- Test: `frontend/src/pages/TambahSuratKeluar.modes.test.jsx`

**Interfaces:**
- Consumes: `useLacakSearch` (Task 18), `buildTindakLanjutState`, `toTindakLanjutPayload`, `JENIS_RELASI_LABEL` (Task 19).
- Produces: `<ReferensiSection mode referensi onPilih onHapus onUbahRelasi disabled autoOpen jenisFilter label />` (dipakai juga Task 24); `TambahSuratKeluar({ mode })` dengan `mode === 'inisiatif'`; query `?naskah=<Naskah>` (mode inisiatif) dan `?pilih=referensi` (buka picker otomatis); payload create `asalNaskah: 'inisiatif'` atau `tindakLanjut: {...}` (tanpa `balasanUntuk`).

- [ ] **Step 1: Tulis ulang test picker dan test mode (gagal)**

```jsx
// frontend/src/pages/surat-reply-picker.test.jsx
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TambahSuratKeluar from '@/pages/TambahSuratKeluar'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'review-user', role: 'admin_dirjen', unitKerjaId: 'ditjen' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { fileUploads: false } }) }))
vi.mock('@/services/api', () => ({ default: { get: mocks.get }, api: { get: mocks.get } }))

const node = { anggotaId: null, jenis: 'surat_masuk', id: 'letter-101', nomorSurat: 'SM-101', perihal: 'UNIQUE-OLDER-LETTER',
    tanggalSurat: '2026-01-02', tahun: 2026, naskah: null, unitKerjaId: 'ditjen', unitNama: 'Ditjen', relasi: null, masked: false }
const kelompok101 = { kunci: 'surat:letter-101', skor: 90, tanggalTerbaru: '2026-01-02', rangkaian: null,
    cocok: [{ jenis: 'surat_masuk', id: 'letter-101', nomorSurat: 'SM-101', perihal: 'UNIQUE-OLDER-LETTER', tahun: 2026, skor: 90 }],
    pratinjau: [node], jumlahAnggota: 1, pratinjauTerpotong: false }
let router
beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    mocks.get.mockImplementation(async (url, params) => {
        if (url === '/api/surat-keluar/existing') return { data: { id: 'existing', unitKerjaId: 'ditjen', approvalStatus: 'draft', balasanUntuk: 'letter-101',
            naskahDinas: 'Nota Dinas', perihal: 'Balasan tersimpan', tanggalSurat: '2026-09-12' } }
        if (url === '/api/surat-masuk/letter-101') return { data: { id: 'letter-101', nomorSurat: 'SM-101', perihal: 'UNIQUE-OLDER-LETTER', status: 'sudah_dibalas' } }
        if (url === '/api/rangkaian/lacak') return { success: true, data: { q: params.q, mode: params.mode, jenisKueri: 'nomor',
            kelompok: params.q.includes('101') ? [kelompok101] : [] } }
        if (url === '/api/surat-keluar/next-number') return { data: { nomorSurat: '001/ND/09/2026' } }
        throw new Error(`Unexpected request ${url}`)
    })
})
afterEach(() => { cleanup(); router?.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })

it('mencari lewat Lacak mode referensi (termasuk surat yang sudah dibalas) lalu memilih dengan keyboard', async () => {
    router = createMemoryRouter([{ path: '/', element: <TambahSuratKeluar /> }])
    render(<RouterProvider router={router} />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Nomor Referensi' }))
    vi.useFakeTimers()
    fireEvent.change(screen.getByPlaceholderText('Ketik minimal 3 karakter nomor atau perihal...'), { target: { value: 'SM-101' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    vi.useRealTimers()
    await screen.findByText('SM-101')
    expect(mocks.get).toHaveBeenCalledWith('/api/rangkaian/lacak', { q: 'SM-101', mode: 'referensi', tahun: undefined, jenis: undefined, limit: 8 }, { signal: expect.any(AbortSignal) })
    fireEvent.keyDown(screen.getByPlaceholderText('Ketik minimal 3 karakter nomor atau perihal...'), { key: 'Enter' })
    await screen.findByRole('button', { name: 'Hapus surat rujukan yang dipilih' })
    expect(screen.getByText('SM-101')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Jenis relasi' })).toHaveValue('balasan')
})

it('kurang dari 3 karakter tidak memanggil server', async () => {
    router = createMemoryRouter([{ path: '/', element: <TambahSuratKeluar /> }])
    render(<RouterProvider router={router} />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Nomor Referensi' }))
    vi.useFakeTimers()
    fireEvent.change(screen.getByPlaceholderText('Ketik minimal 3 karakter nomor atau perihal...'), { target: { value: 'SM' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    vi.useRealTimers()
    expect(mocks.get.mock.calls.some(([url]) => url === '/api/rangkaian/lacak')).toBe(false)
})

it('mode edit menampilkan rujukan tersimpan terkunci tanpa memanggil Lacak', async () => {
    router = createMemoryRouter([{ path: '/edit/:id', element: <TambahSuratKeluar /> }], { initialEntries: ['/edit/existing'] })
    render(<RouterProvider router={router} />)
    await screen.findByText('SM-101')
    expect(screen.getByLabelText('Nomor Referensi terkunci')).toBeInTheDocument()
    expect(mocks.get.mock.calls.some(([url]) => url === '/api/rangkaian/lacak')).toBe(false)
})
```

```jsx
// frontend/src/pages/TambahSuratKeluar.modes.test.jsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TambahSuratKeluar from '@/pages/TambahSuratKeluar'
import { buildTindakLanjutState } from '@/lib/tindak-lanjut'

const fixtures = vi.hoisted(() => ({ create: vi.fn(), getNextNumber: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-bppt', role: 'admin_unit', unitKerjaId: 'dir_bppt' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { fileUploads: false } }) }))
vi.mock('@/services/surat-keluar.service', () => ({ suratKeluarService: { create: fixtures.create, getNextNumber: fixtures.getNextNumber, getById: vi.fn() } }))
vi.mock('@/services/surat-masuk.service', () => ({ suratMasukService: { getById: vi.fn() } }))
// Pemilih popup diganti <select> native (pola surat-date-input.test.jsx); form aslinya tetap utuh.
vi.mock('@/components/ui/searchable-select', () => ({
    SearchableSelect: ({ id, ariaLabel, value, onValueChange, options }) => (
        <select id={id} aria-label={ariaLabel} value={value} onChange={event => onValueChange(event.target.value)}>
            <option value="">Pilih</option>
            {options.map(option => {
                const item = typeof option === 'string' ? { value: option, label: option } : option
                return <option key={item.value} value={item.value}>{item.label}</option>
            })}
        </select>
    ),
}))

let router
beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    fixtures.create.mockResolvedValue({ data: { id: 'sk-baru' } })
    fixtures.getNextNumber.mockResolvedValue({ nomorSurat: '001/X/09/2026' })
})
afterEach(() => { cleanup(); router?.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function isiDanKirim(container) {
    fireEvent.change(document.getElementById('tanggal-surat-keluar'), { target: { value: '2026-09-24' } })
    fireEvent.change(document.getElementById('penerima-surat-keluar'), { target: { value: 'Direktur Jenderal' } })
    fireEvent.submit(container.querySelector('form'))
}

describe('mode TambahSuratKeluar', () => {
    it('inisiatif: badge, naskah dari query, payload asalNaskah tanpa induk', async () => {
        router = createMemoryRouter([
            { path: '/surat/keluar/inisiatif', element: <TambahSuratKeluar mode="inisiatif" /> },
            { path: '/surat/keluar', element: <h1>Daftar</h1> },
        ], { initialEntries: ['/surat/keluar/inisiatif?naskah=Keputusan'] })
        const view = render(<RouterProvider router={router} />)
        expect(screen.getByText('Inisiatif: memulai rangkaian baru')).toBeInTheDocument()
        expect(document.getElementById('naskah-dinas')).toHaveValue('Keputusan')
        fireEvent.change(document.getElementById('perihal-surat-keluar'), { target: { value: 'Penetapan tim terpadu' } })
        isiDanKirim(view.container)
        await waitFor(() => expect(fixtures.create).toHaveBeenCalled())
        const payload = fixtures.create.mock.calls[0][0]
        expect(payload).toMatchObject({ asalNaskah: 'inisiatif', naskahDinas: 'Keputusan', perihal: 'Penetapan tim terpadu' })
        expect(payload).not.toHaveProperty('tindakLanjut')
        expect(payload).not.toHaveProperty('balasanUntuk')
    })

    it('ND Penjelas dari detail Keputusan: chip terkunci, preset, payload relasi menjelaskan', async () => {
        const state = buildTindakLanjutState('surat_keluar', { id: 'sk-kep', nomorSurat: 'KEP-7/2026', perihal: 'Penetapan tim' }, 'buat_nd_penjelas')
        router = createMemoryRouter([
            { path: '/surat/keluar/tambah', element: <TambahSuratKeluar /> },
            { path: '/surat/keluar', element: <h1>Daftar</h1> },
        ], { initialEntries: [{ pathname: '/surat/keluar/tambah', state }] })
        const view = render(<RouterProvider router={router} />)
        expect(await screen.findByText('KEP-7/2026')).toBeInTheDocument()
        expect(screen.getByLabelText('Nomor Referensi terkunci')).toBeInTheDocument()
        expect(document.getElementById('naskah-dinas')).toHaveValue('Nota Dinas')
        expect(document.getElementById('perihal-surat-keluar')).toHaveValue('Penjelasan Keputusan Nomor KEP-7/2026')
        isiDanKirim(view.container)
        await waitFor(() => expect(fixtures.create).toHaveBeenCalled())
        expect(fixtures.create.mock.calls[0][0].tindakLanjut).toEqual({ jenis: 'surat_keluar', suratId: 'sk-kep', jenisRelasi: 'menjelaskan' })
    })
})
```

Di `frontend/src/pages/surat-form-behavior.test.jsx` ubah test "names the outgoing reply selector" menjadi:

```jsx
it('names the outgoing reference display for keyboard and screen reader users', async () => {
    await renderForm(pages[1]);
    expect(screen.getByText('Nomor Referensi')).toBeInTheDocument();
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd frontend && npx vitest run src/pages/surat-reply-picker.test.jsx src/pages/TambahSuratKeluar.modes.test.jsx`
Expected: FAIL — combobox "Nomor Referensi" dan teks inisiatif tidak ada.

- [ ] **Step 3: Implementasi `ReferensiSection`**

```jsx
// frontend/src/components/surat-keluar/ReferensiSection.jsx
import { useEffect, useState } from 'react'
import { Loader2, Lock, Mail, Search, Sparkles, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { useLacakSearch } from '@/hooks/use-lacak-search'
import { JENIS_RELASI_LABEL } from '@/lib/tindak-lanjut'

const PLACEHOLDER = 'Ketik minimal 3 karakter nomor atau perihal...'

/** Kartu Nomor Referensi (§7): inisiatif, chip terkunci (tindak lanjut), atau picker berbasis Lacak mode=referensi. */
export function ReferensiSection({
    mode, referensi, onPilih, onHapus, onUbahRelasi, disabled = false, autoOpen = false, jenisFilter, label = 'Nomor Referensi',
}) {
    const [open, setOpen] = useState(autoOpen)
    const [term, setTerm] = useState('')
    const { loading, error, data } = useLacakSearch(term, { mode: 'referensi', jenis: jenisFilter, enabled: open })
    useEffect(() => { if (autoOpen) setOpen(true) }, [autoOpen])

    if (mode === 'inisiatif') {
        return (
            <div role="status" className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:bg-emerald-500/15">
                <Sparkles className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                <div className="space-y-1">
                    <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-300">Inisiatif</Badge>
                    <p className="text-sm font-medium">Inisiatif: memulai rangkaian baru</p>
                    <p className="text-xs text-muted-foreground">Surat ini tidak merujuk surat lain. Surat terkait dapat ditautkan kemudian.</p>
                </div>
            </div>
        )
    }

    if (referensi) {
        return (
            <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 dark:bg-blue-500/15">
                <Mail className="h-5 w-5 flex-shrink-0 text-blue-600" aria-hidden="true" />
                <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">{label}</p>
                    <p className="font-medium text-blue-900 dark:text-blue-300">{referensi.nomorSurat || 'Tanpa Nomor'}</p>
                    <p className="truncate text-sm text-blue-700 dark:text-blue-300">{referensi.perihal}</p>
                    {referensi.rangkaianKode && <Badge variant="outline">{referensi.rangkaianKode}</Badge>}
                </div>
                {referensi.terkunci ? (
                    <Lock className="h-4 w-4 flex-shrink-0 text-blue-600" aria-label="Nomor Referensi terkunci" role="img" />
                ) : (
                    <div className="flex flex-shrink-0 items-center gap-2">
                        <select
                            aria-label="Jenis relasi"
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                            value={referensi.jenisRelasi}
                            onChange={(event) => onUbahRelasi?.(event.target.value)}
                            disabled={disabled}
                        >
                            {Object.entries(JENIS_RELASI_LABEL).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                        </select>
                        <Button type="button" variant="ghost" size="sm" onClick={onHapus} disabled={disabled}>
                            <X className="h-4 w-4" aria-hidden="true" />
                            <span className="sr-only">Hapus surat rujukan yang dipilih</span>
                        </Button>
                    </div>
                )}
            </div>
        )
    }

    const kelompok = data?.kelompok ?? []
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button type="button" variant="outline" role="combobox" aria-label={label} aria-expanded={open} disabled={disabled}
                    className="h-12 w-full justify-start border-dashed text-muted-foreground hover:border-solid">
                    <Search className="mr-2 h-4 w-4" aria-hidden="true" />
                    <span>Cari nomor atau perihal surat rujukan...</span>
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0 sm:w-[520px]" align="start">
                <Command shouldFilter={false}>
                    <CommandInput placeholder={PLACEHOLDER} value={term} onValueChange={setTerm} />
                    <CommandList>
                        {error && <p role="alert" className="p-3 text-sm text-destructive">{error.message || 'Pencarian gagal'}</p>}
                        <CommandEmpty>
                            {loading ? (
                                <span className="flex items-center justify-center gap-2 py-6 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Memuat...</span>
                            ) : (
                                <span className="block py-6 text-center text-sm text-muted-foreground">
                                    {term.trim().length < 3 ? 'Ketik minimal 3 karakter' : 'Tidak ada surat yang cocok'}
                                </span>
                            )}
                        </CommandEmpty>
                        {kelompok.map((grup) => (
                            <CommandGroup key={grup.kunci} heading={grup.rangkaian ? `${grup.rangkaian.kode} · ${grup.rangkaian.tahun}` : 'Surat tunggal'}>
                                {grup.pratinjau.filter((n) => !n.masked).map((n) => (
                                    <CommandItem
                                        key={`${n.jenis}:${n.id}`}
                                        value={`${n.jenis}:${n.id}`}
                                        onSelect={() => {
                                            onPilih({
                                                jenis: n.jenis, suratId: n.id, nomorSurat: n.nomorSurat, perihal: n.perihal,
                                                unitKerjaId: n.unitKerjaId, unitNama: n.unitNama, rangkaianKode: grup.rangkaian?.kode ?? null,
                                                jenisRelasi: n.jenis === 'surat_masuk' ? 'balasan' : 'tindak_lanjut', terkunci: false,
                                            })
                                            setOpen(false)
                                            setTerm('')
                                        }}
                                        className="cursor-pointer py-3"
                                    >
                                        <div className="min-w-0">
                                            <p className="truncate font-medium">{n.nomorSurat || '-'}</p>
                                            <p className="truncate text-sm text-muted-foreground">{n.perihal}</p>
                                            <p className="text-xs text-muted-foreground">{n.jenis === 'surat_masuk' ? 'Surat masuk' : 'Surat keluar'} · {n.unitNama} · {n.tahun}</p>
                                        </div>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
```

- [ ] **Step 4: Ubah `TambahSuratKeluar.jsx`**

1. Impor (baris 4-16 dan 32-51): tambahkan `useSearchParams` pada impor `react-router-dom`; tambah `import { ReferensiSection } from '@/components/surat-keluar/ReferensiSection';` dan `import { toTindakLanjutPayload } from '@/lib/tindak-lanjut';`; hapus impor `usePaginatedResource`, `ResourcePagination`, `Popover*`, `Command*`, dan ikon `Search, Mail` yang tidak lagi dipakai.
2. Baris 121: `export default function TambahSuratKeluar({ mode: modeProp } = {}) {` dan setelah `const location = useLocation();` tambahkan:

```jsx
    const [searchParams] = useSearchParams();
    const mode = modeProp === 'inisiatif' ? 'inisiatif' : undefined;
    const naskahDariQuery = mode === 'inisiatif' && NASKAH_DINAS_OPTIONS.includes(searchParams.get('naskah') || '')
        ? searchParams.get('naskah') : '';
```

3. Ganti state picker lama (baris 168-172) dengan `const [referensi, setReferensi] = useState(null);` dan ubah `naskahDinas: '',` pada state awal `formData` menjadi `naskahDinas: naskahDariQuery,`.
4. Ganti efek `replyTo` (baris 192-209) dengan:

```jsx
    // Prefill dari menu Tindak Lanjut / Kotak Disposisi (state.tindakLanjut) atau klien lama (state.replyTo).
    useEffect(() => {
        if (isEditMode) return;
        const state = location.state;
        const tindakLanjut = state?.tindakLanjut ?? (state?.replyTo ? {
            jenis: 'surat_masuk', suratId: state.replyTo.id, nomorSurat: state.replyTo.nomorSurat,
            perihal: state.replyTo.perihal, jenisRelasi: 'balasan', terkunci: true,
        } : null);
        if (!tindakLanjut) return;
        const preset = state?.preset ?? (state?.replyTo ? { perihal: `Balasan: ${state.replyTo.perihal || ''}`, kepada: state.replyTo.dari || '' } : {});
        setReferensi(tindakLanjut);
        setFormData(prev => ({ ...prev, ...preset }));
        setDirty();
    }, [location.state, isEditMode, setDirty]);
```

5. Di `fetchSuratData` ganti blok `if (data.balasanUntuk) {...}` (baris 245-252) dengan:

```jsx
            if (data.balasanUntuk) {
                try {
                    const suratMasuk = await suratMasukService.getById(data.balasanUntuk);
                    setReferensi({ jenis: 'surat_masuk', suratId: suratMasuk.id, nomorSurat: suratMasuk.nomorSurat,
                        perihal: suratMasuk.perihal, jenisRelasi: 'balasan', terkunci: true });
                } catch (err) {
                    console.error('Error fetching related surat masuk:', err);
                }
            }
```

6. Hapus efek debounce picker dan `loadReplyPage`/`replyOptions`/`loadingSuratMasuk` (baris 267-281) serta handler `handleSelectSuratMasuk`/`clearSuratMasuk` (baris 318-339).
7. Di `handleSubmit` cabang create (baris 404-409) ganti dengan:

```jsx
                const { balasanUntuk: _balasanLama, ...tanpaBalasan } = dataToSubmit;
                await suratKeluarService.create({
                    ...tanpaBalasan,
                    ...buildOutgoingNumberingPayload(formData.nomorSurat),
                    tahun: Number(formData.tanggalSurat?.slice(0, 4)) || new Date().getFullYear(),
                    ...(mode === 'inisiatif' ? { asalNaskah: 'inisiatif' } : {}),
                    ...(referensi && mode !== 'inisiatif' ? { tindakLanjut: toTindakLanjutPayload(referensi) } : {}),
                }, filesEnabled ? selectedFile : null);
```

8. Ganti kartu "Section 1: Balasan Surat" (baris 569-672) dengan:

```jsx
                {/* Section 1: Nomor Referensi / Asal Naskah */}
                <Card className="overflow-hidden border-border/50 shadow-sm transition-all hover:shadow-md">
                    <CardContent className="p-6 space-y-5">
                        <SectionHeader
                            icon={Reply}
                            title={mode === 'inisiatif' ? 'Asal Naskah' : 'Nomor Referensi'}
                            description={mode === 'inisiatif'
                                ? 'Surat inisiatif memulai rangkaian baru'
                                : 'Kaitkan dengan surat masuk atau surat keluar yang ditindaklanjuti (opsional)'}
                        />
                        <ReferensiSection
                            mode={mode}
                            referensi={referensi}
                            onPilih={(pilihan) => { if (saveLockedRef.current) return; setReferensi(pilihan); setDirty(); }}
                            onHapus={() => { if (saveLockedRef.current) return; setReferensi(null); setDirty(); }}
                            onUbahRelasi={(jenisRelasi) => setReferensi(prev => (prev ? { ...prev, jenisRelasi } : prev))}
                            disabled={saveLocked || isEditMode || !resolvedUnitKerjaId}
                            autoOpen={!isEditMode && searchParams.get('pilih') === 'referensi'}
                        />
                    </CardContent>
                </Card>
```

Di `frontend/src/App.jsx` setelah baris `{ path: "/surat/keluar/tambah", ... }` (baris 248) tambahkan:

```jsx
      { path: "/surat/keluar/inisiatif", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><TambahSuratKeluar mode="inisiatif" /></RoleGuard> },
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `cd frontend && npx vitest run src/pages/surat-reply-picker.test.jsx src/pages/TambahSuratKeluar.modes.test.jsx src/pages/surat-form-behavior.test.jsx src/pages/surat-archive-selection.test.jsx src/pages/surat-date-input.test.jsx src/pages/surat-picker-contract.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/surat-keluar/ReferensiSection.jsx frontend/src/pages/TambahSuratKeluar.jsx frontend/src/App.jsx frontend/src/pages/surat-reply-picker.test.jsx frontend/src/pages/TambahSuratKeluar.modes.test.jsx frontend/src/pages/surat-form-behavior.test.jsx
git commit -m "feat(frontend): Nomor Referensi berbasis Lacak dan mode Surat Inisiatif di form surat keluar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


#### Amandemen pra-eksekusi Task 20 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


**`ReferensiSection.jsx`** [T20-1, T20-3]:
- **Delete** `useEffect(() => { if (autoOpen) setOpen(true) }, [autoOpen])` (plan:7150). `useState(autoOpen)` (plan:7147) already sets the initial value; for a later forced reopen, the parent remounts with `key`. Remove `useEffect` from the imports if it is unused.
- When `error` is set, do not render `CommandEmpty`. Render the error text and a `<Button type="button" variant="link" onClick={retry}>Coba lagi</Button>`, where `retry` is destructured from `useLacakSearch(...)` (added by Task 18; same name as P4 Task 10). Failed queries are never cached, so `retry()` re-runs the request.
- Add a `relasiTetap` prop (boolean). When true, hide the "Jenis relasi" `<select>` (plan:7179-7187). Task 24 uses it.

**`TambahSuratKeluar.jsx`** [T20-2, T20-4]:
- **Create payload** (plan:7306-7312): in create mode (not `isEditMode`), when there is no `referensi`, send `asalNaskah: 'inisiatif'` regardless of `mode` (spec:51,69). With a referensi, send `tindakLanjut` as planned; the server sets `asalNaskah: 'tindak_lanjut'`.
- **Edit mode:** after `fetchSuratData` loads the record, if `Array.isArray(data.aksiDiizinkan) && !data.aksiDiizinkan.includes('edit')`, show the toast "Surat ini tidak dapat diubah dari unit Anda" and `navigate(\`/surat/keluar/${id}\`, { replace: true })`.

**`surat-reply-picker.test.jsx` rewrite: add** the case "menampilkan Coba lagi saat pencarian gagal dan tidak menampilkan 'Tidak ada surat yang cocok'". It replaces the dropped case at `:65-74`.

**`TambahSuratKeluar.modes.test.jsx`: add**
- Create without a referensi, in any mode, sends `asalNaskah: 'inisiatif'`.
- Edit of a record without `'edit'` in `aksiDiizinkan` redirects.

**Step (run): add** `cd frontend && npx eslint src/components/surat-keluar/ReferensiSection.jsx src/pages/TambahSuratKeluar.jsx`. Expected: 0 errors.

---



### Task 21: Split button "Buat Surat Inisiatif", badge asal naskah, quick action Dashboard

**Files:**
- Modify: `frontend/src/pages/SuratKeluar.jsx:379-386` (split button), `:643-648` (badge)
- Modify: `frontend/src/pages/Dashboard.jsx:393-394`
- Modify: `frontend/src/pages/Dashboard.workflow.test.jsx:84`
- Test: `frontend/src/pages/SuratKeluar.inisiatif.test.jsx`

**Interfaces:**
- Consumes: route `/surat/keluar/inisiatif` (Task 20); `row.asalNaskah` dari daftar surat keluar.
- Produces: tombol "Buat Surat Inisiatif" (link `/surat/keluar/inisiatif`), menu "Pilihan surat keluar lainnya" (Nota Dinas, Surat Edaran, Surat Undangan, Keputusan, Surat Tugas, Lainnya…, Tindak Lanjut Surat Masuk… → `/surat/keluar/tambah?pilih=referensi`); badge "Inisiatif"/"Tindak Lanjut".

- [ ] **Step 1: Tulis test yang gagal**

```jsx
// frontend/src/pages/SuratKeluar.inisiatif.test.jsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import SuratKeluar from './SuratKeluar'

const mocks = vi.hoisted(() => ({ getAll: vi.fn(), getStats: vi.fn() }))
vi.mock('@/services/surat-keluar.service', () => ({ default: { getAll: mocks.getAll, getStats: mocks.getStats } }))
vi.mock('@/services/approval.service', () => ({ default: { getPending: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/services/settings.service', () => ({ default: { getAllUnitKerja: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u', role: 'admin_unit', unitKerjaId: 'dir_bppt' }, canWrite: () => true }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: false } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => null }))
vi.mock('@/components/ImportFromGDrive', () => ({ default: () => null }))
vi.mock('@/components/ImportCsvDialog', () => ({ default: () => null }))

let router
beforeEach(() => {
    vi.clearAllMocks()
    mocks.getStats.mockResolvedValue({ total: 2, diarsipkan: 0 })
    mocks.getAll.mockResolvedValue({ success: true, pagination: { total: 2, totalPages: 1 }, data: [
        { id: 'a', nomorSurat: '001/2026', perihal: 'Surat inisiatif', kepada: 'X', unitKerjaId: 'dir_bppt', approvalStatus: 'draft', asalNaskah: 'inisiatif' },
        { id: 'b', nomorSurat: '002/2026', perihal: 'Surat tindak lanjut', kepada: 'Y', unitKerjaId: 'dir_bppt', approvalStatus: 'draft', asalNaskah: 'tindak_lanjut' },
    ] })
})
afterEach(() => { cleanup(); router?.dispose() })

it('menampilkan split button inisiatif dan badge asal naskah', async () => {
    router = createMemoryRouter([
        { path: '/surat/keluar', element: <SuratKeluar /> },
        { path: '/surat/keluar/inisiatif', element: <h1>Form inisiatif</h1> },
    ], { initialEntries: ['/surat/keluar'] })
    render(<RouterProvider router={router} />)
    await screen.findByText('Surat inisiatif')
    expect(screen.getByRole('link', { name: /Buat Surat Inisiatif/ })).toHaveAttribute('href', '/surat/keluar/inisiatif')
    expect(screen.getByText('Inisiatif', { selector: '[data-badge="asal-naskah"]' })).toBeInTheDocument()
    expect(screen.getByText('Tindak Lanjut', { selector: '[data-badge="asal-naskah"]' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Pilihan surat keluar lainnya' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Keputusan' }))
    await screen.findByRole('heading', { name: 'Form inisiatif' })
    expect(router.state.location.search).toBe('?naskah=Keputusan')
})
```

Di `frontend/src/pages/Dashboard.workflow.test.jsx` setelah baris 84 tambahkan:

```jsx
        fireEvent.click(within(actions).getByRole('button', { name: 'Buat Surat Inisiatif' }))
        expect(mocks.navigate).toHaveBeenCalledWith('/surat/keluar/inisiatif')
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd frontend && npx vitest run src/pages/SuratKeluar.inisiatif.test.jsx src/pages/Dashboard.workflow.test.jsx`
Expected: FAIL — link "Buat Surat Inisiatif" tidak ada.

- [ ] **Step 3: Implementasi**

Di `SuratKeluar.jsx` tambahkan konstanta modul (setelah impor):

```jsx
const NASKAH_INISIATIF = ['Nota Dinas', 'Surat Edaran', 'Surat Undangan', 'Keputusan', 'Surat Tugas'];
```

Ganti blok tombol "Surat Baru" (baris 379-386) dengan:

```jsx
                    {isAdmin && (
                        <div className="flex" role="group" aria-label="Buat surat keluar">
                            <Button asChild size="sm" className="h-9 rounded-r-none shadow-sm">
                                <Link to="/surat/keluar/inisiatif">
                                    <Plus className="mr-2 h-3.5 w-3.5" />
                                    Buat Surat Inisiatif
                                </Link>
                            </Button>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button size="sm" className="h-9 rounded-l-none border-l border-primary-foreground/20 px-2" aria-label="Pilihan surat keluar lainnya">
                                        <ChevronDown className="h-3.5 w-3.5" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-60">
                                    {NASKAH_INISIATIF.map((naskah) => (
                                        <DropdownMenuItem key={naskah} onSelect={() => navigate(`/surat/keluar/inisiatif?naskah=${encodeURIComponent(naskah)}`)}>
                                            {naskah}
                                        </DropdownMenuItem>
                                    ))}
                                    <DropdownMenuItem onSelect={() => navigate('/surat/keluar/inisiatif')}>Lainnya…</DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onSelect={() => navigate('/surat/keluar/tambah?pilih=referensi')}>Tindak Lanjut Surat Masuk…</DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    )}
```

Setelah badge "Balasan" (baris 648) tambahkan:

```jsx
                                                        {row.asalNaskah === 'inisiatif' && (
                                                            <Badge data-badge="asal-naskah" variant="outline" className="border-emerald-200 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15">Inisiatif</Badge>
                                                        )}
                                                        {row.asalNaskah === 'tindak_lanjut' && (
                                                            <Badge data-badge="asal-naskah" variant="outline" className="border-sky-200 text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-500/15">Tindak Lanjut</Badge>
                                                        )}
```

Di `Dashboard.jsx` setelah tombol "Catat Surat Keluar" (baris 394) tambahkan:

```jsx
                    <Button variant="outline" onClick={() => navigate('/surat/keluar/inisiatif')}><Plus aria-hidden="true" className="mr-2 h-4 w-4" />Buat Surat Inisiatif</Button>
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `cd frontend && npx vitest run src/pages/SuratKeluar.inisiatif.test.jsx src/pages/Dashboard.workflow.test.jsx src/pages/SuratLists.feedback.test.jsx src/pages/surat-archive-dialog.test.jsx src/components/app-sidebar.groups.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SuratKeluar.jsx frontend/src/pages/Dashboard.jsx frontend/src/pages/Dashboard.workflow.test.jsx frontend/src/pages/SuratKeluar.inisiatif.test.jsx
git commit -m "feat(frontend): split button Buat Surat Inisiatif, badge asal naskah, dan quick action dashboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 22: DistributeDialog multi-target (chip instruksi, batas waktu, penanggung jawab, aturan terkendali)

**Files:**
- Modify: `frontend/src/components/DistributeDialog.jsx` (ganti isi berkas)
- Modify: `frontend/src/pages/SuratMasuk.jsx:790-795` (tidak perlu diubah bila `suratData={selectedSurat}` sudah membawa `sifatSurat`; pastikan demikian)
- Test: `frontend/src/components/DistributeDialog.test.jsx`

**Interfaces:**
- Consumes: `distributionService.getDistributableUnits`, `getOpsi`, `distributeMany` (Task 18); `isSifatTerkendali` (Task 19).
- Produces: `<DistributeDialog open onOpenChange suratData={{ id, nomorSurat, perihal, sifatSurat }} sourceUnitId onSuccess />`; `PESAN_TERKENDALI` (teks persis backend).

- [ ] **Step 1: Tulis test yang gagal**

```jsx
// frontend/src/components/DistributeDialog.test.jsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DistributeDialog, PESAN_TERKENDALI } from './DistributeDialog'

const mocks = vi.hoisted(() => ({ getDistributableUnits: vi.fn(), getOpsi: vi.fn(), distributeMany: vi.fn(), toast: vi.fn() }))
vi.mock('@/services/distribution.service', () => ({ default: mocks, distributionService: mocks }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))

const surat = { id: 'sm-1', nomorSurat: 'B-1/2026', perihal: 'Permohonan data', sifatSurat: 'biasa' }
const tampil = (extra = {}) => render(<DistributeDialog open onOpenChange={vi.fn()} suratData={{ ...surat, ...extra }} sourceUnitId="sesditjen" onSuccess={vi.fn()} />)

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getDistributableUnits.mockResolvedValue([
        { id: 'dir_bppt', name: 'Dit. BPPT', unitType: 'direktorat' },
        { id: 'dir_ptep', name: 'Dit. PTEP', unitType: 'direktorat' },
        { id: 'bagian_umum', name: 'Bagian Umum', unitType: 'bagian' },
    ])
    mocks.getOpsi.mockResolvedValue({ instruksi: ['Untuk diketahui', 'Mohon dikoordinasikan'], jalurAksesTerkendali: false })
    mocks.distributeMany.mockResolvedValue([{ id: 'd1' }, { id: 'd2' }])
})
afterEach(cleanup)

describe('DistributeDialog', () => {
    it('multi-target dengan penanggung jawab, batas waktu, dan chip instruksi; bagian tidak ditawarkan', async () => {
        tampil()
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Dit. BPPT' }))
        fireEvent.click(screen.getByRole('checkbox', { name: 'Dit. PTEP' }))
        expect(screen.queryByRole('checkbox', { name: 'Bagian Umum' })).toBeNull()
        fireEvent.click(screen.getByRole('radio', { name: 'Dit. BPPT' }))
        fireEvent.change(screen.getByLabelText('Batas waktu'), { target: { value: '2026-10-01' } })
        fireEvent.click(screen.getByRole('button', { name: 'Untuk diketahui' }))
        fireEvent.click(screen.getByRole('button', { name: 'Mohon dikoordinasikan' }))
        fireEvent.click(screen.getByRole('button', { name: /Disposisikan/ }))
        await waitFor(() => expect(mocks.distributeMany).toHaveBeenCalledWith({
            suratMasukId: 'sm-1', sourceUnitId: 'sesditjen',
            targets: [
                { unitKerjaId: 'dir_bppt', penanggungJawab: true, batasWaktu: '2026-10-01' },
                { unitKerjaId: 'dir_ptep', penanggungJawab: false, batasWaktu: '2026-10-01' },
            ],
            instruksi: 'Untuk diketahui\nMohon dikoordinasikan',
        }))
    })

    it('surat terkendali diblokir selama jalur akses disposisi mati', async () => {
        tampil({ sifatSurat: 'Rahasia' })
        expect(await screen.findByText(PESAN_TERKENDALI)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Disposisikan/ })).toBeDisabled()
    })

    it('jalur akses menyala: info permohonan grant disposisi', async () => {
        mocks.getOpsi.mockResolvedValue({ instruksi: [], jalurAksesTerkendali: true })
        tampil({ sifatSurat: 'rahasia' })
        expect(await screen.findByText(/Permohonan akses disposisi akan diajukan/)).toBeInTheDocument()
    })
})
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd frontend && npx vitest run src/components/DistributeDialog.test.jsx`
Expected: FAIL — `PESAN_TERKENDALI` tidak diekspor; tidak ada checkbox.

- [ ] **Step 3: Implementasi (ganti seluruh `DistributeDialog.jsx`)**

```jsx
// frontend/src/components/DistributeDialog.jsx
import { useCallback, useEffect, useState } from 'react'
import { Loader2, Send, ShieldAlert } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import distributionService from '@/services/distribution.service'
import { isSifatTerkendali } from '@/lib/tindak-lanjut'

export const PESAN_TERKENDALI = 'Surat terkendali belum dapat didisposisikan; tangani di unit pencatat atau aktifkan jalur akses disposisi'
const OPSI_KOSONG = { instruksi: [], jalurAksesTerkendali: false }

/** Disposisi ke Direktorat (§7): multi-target, chip instruksi, batas waktu, penanggung jawab (Unit Pengolah). */
export function DistributeDialog({ open, onOpenChange, suratData, sourceUnitId, onSuccess }) {
    const { toast } = useToast()
    const [loading, setLoading] = useState(false)
    const [loadingUnits, setLoadingUnits] = useState(false)
    const [units, setUnits] = useState([])
    const [opsi, setOpsi] = useState(OPSI_KOSONG)
    const [targets, setTargets] = useState([])
    const [penanggungJawab, setPenanggungJawab] = useState('')
    const [batasWaktu, setBatasWaktu] = useState('')
    const [instruction, setInstruction] = useState('')
    const terkendali = isSifatTerkendali(suratData?.sifatSurat)
    const diblokir = terkendali && !opsi.jalurAksesTerkendali

    const reset = () => {
        setTargets([])
        setPenanggungJawab('')
        setBatasWaktu('')
        setInstruction('')
    }

    const muat = useCallback(async () => {
        setLoadingUnits(true)
        try {
            const [daftar, pilihan] = await Promise.all([
                distributionService.getDistributableUnits(sourceUnitId),
                distributionService.getOpsi().catch(() => OPSI_KOSONG),
            ])
            // D6: unit bagian hanya label, tidak pernah menjadi target disposisi.
            setUnits(Array.isArray(daftar) ? daftar.filter((unit) => unit.unitType !== 'bagian') : [])
            setOpsi(pilihan || OPSI_KOSONG)
        } catch (error) {
            console.error('Error loading units:', error)
            toast({ title: 'Error', description: 'Gagal memuat daftar unit kerja', variant: 'destructive' })
        } finally {
            setLoadingUnits(false)
        }
    }, [sourceUnitId, toast])

    useEffect(() => {
        if (open && sourceUnitId) void muat()
    }, [muat, open, sourceUnitId])

    const toggleTarget = (id) => {
        setTargets((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
        setPenanggungJawab((prev) => (prev === id ? '' : prev))
    }
    const tambahInstruksi = (teks) => setInstruction((prev) => (prev.trim() ? `${prev.trim()}\n${teks}` : teks))

    const handleSubmit = async () => {
        if (!sourceUnitId) {
            toast({ title: 'Unit kerja belum dipilih', description: 'Disposisi memerlukan unit pencatat yang konkret.', variant: 'destructive' })
            return
        }
        if (targets.length === 0) {
            toast({ title: 'Validasi', description: 'Pilih minimal satu unit tujuan', variant: 'destructive' })
            return
        }
        setLoading(true)
        try {
            await distributionService.distributeMany({
                suratMasukId: suratData.id,
                sourceUnitId,
                targets: targets.map((unitKerjaId) => ({
                    unitKerjaId,
                    penanggungJawab: unitKerjaId === penanggungJawab,
                    ...(batasWaktu ? { batasWaktu } : {}),
                })),
                instruksi: instruction.trim() || null,
            })
            toast({ title: 'Berhasil', description: `Surat didisposisikan ke ${targets.length} unit` })
            reset()
            onOpenChange(false)
            onSuccess?.()
        } catch (error) {
            console.error('Error distributing:', error)
            toast({ title: 'Error', description: error.response?.data?.error || error.message || 'Gagal mendisposisikan surat', variant: 'destructive' })
        } finally {
            setLoading(false)
        }
    }

    const handleClose = () => {
        if (loading) return
        reset()
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Send className="h-5 w-5 text-primary" />
                        Disposisi ke Direktorat
                    </DialogTitle>
                    <DialogDescription>Teruskan surat ke satu atau beberapa unit untuk ditindaklanjuti</DialogDescription>
                </DialogHeader>

                <div className="max-h-[65vh] space-y-4 overflow-y-auto py-2">
                    {suratData && (
                        <div className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
                            <p><span className="text-muted-foreground">Nomor Surat:</span> <span className="font-medium">{suratData.nomorSurat}</span></p>
                            <p className="truncate"><span className="text-muted-foreground">Perihal:</span> {suratData.perihal}</p>
                        </div>
                    )}
                    {diblokir && (
                        <Alert variant="destructive">
                            <ShieldAlert className="h-4 w-4" />
                            <AlertDescription>{PESAN_TERKENDALI}</AlertDescription>
                        </Alert>
                    )}
                    {terkendali && !diblokir && (
                        <Alert>
                            <ShieldAlert className="h-4 w-4" />
                            <AlertDescription>Permohonan akses disposisi akan diajukan untuk admin unit tujuan dan menunggu persetujuan super admin.</AlertDescription>
                        </Alert>
                    )}

                    <fieldset className="space-y-2" disabled={diblokir || loadingUnits}>
                        <legend className="text-sm font-medium">Unit tujuan <span className="text-destructive">*</span></legend>
                        {loadingUnits ? (
                            <p className="text-sm text-muted-foreground">Memuat...</p>
                        ) : (
                            <div className="grid gap-2 sm:grid-cols-2">
                                {units.map((unit) => (
                                    <label key={unit.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                                        <input type="checkbox" checked={targets.includes(unit.id)} onChange={() => toggleTarget(unit.id)} />
                                        {unit.name}
                                    </label>
                                ))}
                            </div>
                        )}
                    </fieldset>

                    {targets.length > 0 && (
                        <fieldset className="space-y-2" disabled={diblokir}>
                            <legend className="text-sm font-medium">Penanggung jawab (Unit Pengolah)</legend>
                            {targets.map((id) => (
                                <label key={id} className="flex items-center gap-2 text-sm">
                                    <input type="radio" name="penanggung-jawab" value={id} checked={penanggungJawab === id} onChange={() => setPenanggungJawab(id)} />
                                    {units.find((unit) => unit.id === id)?.name || id}
                                </label>
                            ))}
                        </fieldset>
                    )}

                    <div className="space-y-2">
                        <Label htmlFor="batas-waktu-disposisi">Batas waktu</Label>
                        <Input id="batas-waktu-disposisi" type="date" value={batasWaktu} onChange={(event) => setBatasWaktu(event.target.value)} disabled={diblokir} />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="instruction">Instruksi / Catatan</Label>
                        {opsi.instruksi.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {opsi.instruksi.map((teks) => (
                                    <Button key={teks} type="button" size="sm" variant="outline" onClick={() => tambahInstruksi(teks)} disabled={diblokir}>{teks}</Button>
                                ))}
                            </div>
                        )}
                        <Textarea id="instruction" value={instruction} onChange={(event) => setInstruction(event.target.value)} rows={3} disabled={diblokir}
                            placeholder="Contoh: Mohon ditindaklanjuti sesuai tugas pokok dan fungsi..." />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={handleClose} disabled={loading}>Batal</Button>
                    <Button onClick={handleSubmit} disabled={loading || diblokir || !sourceUnitId || targets.length === 0}>
                        {loading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Mengirim...</>) : (<><Send className="mr-2 h-4 w-4" />Disposisikan</>)}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `cd frontend && npx vitest run src/components/DistributeDialog.test.jsx src/pages/surat-archive-dialog.test.jsx src/pages/surat-pagination-recovery.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/DistributeDialog.jsx frontend/src/components/DistributeDialog.test.jsx
git commit -m "feat(frontend): dialog disposisi multi-direktorat dengan penanggung jawab dan aturan surat terkendali

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


#### Amandemen pra-eksekusi Task 22 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


**Files: change**
- `frontend/src/pages/SuratMasuk.jsx:790-795 (tidak perlu diubah…)` becomes **Modify `frontend/src/pages/SuratMasuk.jsx:251-257`**. In `handleOpenDistributeDialog`, add `sifatSurat: surat.sifatSurat,` to the `setSelectedSurat({...})` object. [T22-1]
- **Add:** Modify `frontend/src/lib/tindak-lanjut.js`.

**Shared helpers** [T22-2]:
- `PESAN_TERKENDALI` moves to `lib/tindak-lanjut.js` (exact GC#28 text). `DistributeDialog.jsx` does `import { PESAN_TERKENDALI } from '@/lib/tindak-lanjut'` and `export { PESAN_TERKENDALI }` (primitive re-export; react-refresh allows it) so the Task 22 test keeps working.
- Add to `lib/tindak-lanjut.js`: `export function appendInstruksi(prev, teks) { const p = (prev ?? '').trimEnd(); return p ? \`${p}\n${teks}\` : teks }`.
- Add `frontend/src/hooks/use-disposisi-opsi.js`. It exports `useDisposisiOpsi(sourceUnitId)` → `{ units, instruksi, jalurAksesTerkendali, loading }` and contains the `getDistributableUnits` + `unitType !== 'bagian'` filter + `getOpsi` fallback logic from plan:7628-7632. `DistributeDialog` uses both helpers; Task 24 reuses them.

**Step (run): add** `cd frontend && npx eslint src/components/DistributeDialog.jsx src/lib/tindak-lanjut.js src/hooks/use-disposisi-opsi.js`.

---



### Task 23: Kotak Disposisi — tautan detail, Terima/Buat Tindak Lanjut/Penyelesaian, batas waktu, baris tersamar

**Files:**
- Create: `frontend/src/components/distribusi/PenyelesaianDialog.jsx`
- Modify: `frontend/src/pages/DistributionInbox.jsx:1-38` (impor), `:47-131` (state, loadData, handler), `:315-425` (tabel inbox), `:500` (render dialog)
- Test: `frontend/src/pages/DistributionInbox.test.jsx`

**Interfaces:**
- Consumes: `distributionService.getInbox(unit, { lewatBatas })`, `receive`, `reject`, `process(id, unit, penyelesaian)`, `getKandidatPenyelesaian` (Task 18); `buildTindakLanjutState` (Task 19); query `?penyelesaian=<distribusiId>` dari detail surat (Task 19).
- Produces: `<PenyelesaianDialog open onOpenChange distribusi unitKerjaId onSelesai />`; tombol beraria-label `Terima Surat`, `Buat Tindak Lanjut`, `Penyelesaian`, `Tolak & Kembalikan`; kolom "Batas Waktu" dan filter "Lewat batas waktu".

- [ ] **Step 1: Tulis test yang gagal**

```jsx
// frontend/src/pages/DistributionInbox.test.jsx
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DistributionInbox from './DistributionInbox'

const mocks = vi.hoisted(() => ({
    svc: { getInbox: vi.fn(), getOutbox: vi.fn(), getStats: vi.fn(), receive: vi.fn(), process: vi.fn(), reject: vi.fn(), getKandidatPenyelesaian: vi.fn() },
    toast: vi.fn(),
}))
vi.mock('@/services/distribution.service', () => ({ default: mocks.svc, distributionService: mocks.svc }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-bppt', role: 'admin_unit', unitKerjaId: 'dir_bppt' } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))

const terbuka = { id: 'd1', status: 'received', masked: false, instruction: 'Mohon hadir', batasWaktu: '2026-09-30', sentAt: '2026-09-20T01:00:00Z',
    surat: { id: 's1', nomorSurat: 'SM-1/2026', perihal: 'Undangan koordinasi', dari: 'Pemda' }, sourceUnit: { id: 'sesditjen', name: 'Sesditjen' },
    rangkaian: { id: 'rs-1', kode: 'RS-2026-000001' } }
const tersamar = { id: 'd2', status: 'sent', masked: true, instruction: null, batasWaktu: null, sentAt: '2026-09-21T01:00:00Z',
    surat: { id: null, nomorSurat: null, perihal: null, label: 'Dikecualikan' }, sourceUnit: { id: 'sesditjen', name: 'Sesditjen' }, rangkaian: null }

function tampil(entry = '/distribusi') {
    render(<MemoryRouter initialEntries={[entry]}><Routes>
        <Route path="/distribusi" element={<DistributionInbox />} />
        <Route path="/surat/keluar/tambah" element={<h1>Form surat keluar</h1>} />
    </Routes></MemoryRouter>)
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.svc.getInbox.mockResolvedValue([terbuka, tersamar])
    mocks.svc.getOutbox.mockResolvedValue([])
    mocks.svc.getStats.mockResolvedValue({ inbox: { total: 2, pending: 1, received: 1, processed: 0, rejected: 0 }, outbox: { total: 0, pending: 0, processed: 0, rejected: 0 } })
    mocks.svc.getKandidatPenyelesaian.mockResolvedValue([{ id: 'sk-1', nomorSurat: 'ND-1/2026', perihal: 'Tindak lanjut', tanggalSurat: '2026-09-22' }])
    mocks.svc.process.mockResolvedValue({ id: 'd1', status: 'processed' })
})
afterEach(cleanup)

describe('Kotak Disposisi', () => {
    it('baris terbaca menjadi tautan ke detail; baris tersamar hanya dapat ditolak', async () => {
        tampil()
        expect(await screen.findByRole('link', { name: 'SM-1/2026' })).toHaveAttribute('href', '/surat/masuk/s1')
        const baris = screen.getByText('Dikecualikan').closest('tr')
        expect(within(baris).getByText('Ajukan akses / hubungi TU')).toBeInTheDocument()
        expect(within(baris).queryByRole('button', { name: 'Terima Surat' })).toBeNull()
        expect(within(baris).queryByRole('button', { name: 'Penyelesaian' })).toBeNull()
        expect(within(baris).getByRole('button', { name: 'Tolak & Kembalikan' })).toBeInTheDocument()
    })

    it('penyelesaian dengan surat keluar kandidat atau catatan ≥10 karakter', async () => {
        tampil()
        const baris = (await screen.findByRole('link', { name: 'SM-1/2026' })).closest('tr')
        fireEvent.click(within(baris).getByRole('button', { name: 'Penyelesaian' }))
        const dialog = within(await screen.findByRole('dialog'))
        fireEvent.click(await dialog.findByRole('radio', { name: /ND-1\/2026/ }))
        fireEvent.click(dialog.getByRole('button', { name: 'Simpan Penyelesaian' }))
        await waitFor(() => expect(mocks.svc.process).toHaveBeenCalledWith('d1', 'dir_bppt', { penyelesaianSuratKeluarId: 'sk-1' }))
    })

    it('catatan kurang dari 10 karakter tidak dapat disimpan', async () => {
        tampil()
        const baris = (await screen.findByRole('link', { name: 'SM-1/2026' })).closest('tr')
        fireEvent.click(within(baris).getByRole('button', { name: 'Penyelesaian' }))
        const dialog = within(await screen.findByRole('dialog'))
        fireEvent.click(dialog.getByRole('radio', { name: /Catatan penyelesaian/ }))
        fireEvent.change(dialog.getByLabelText('Isi catatan penyelesaian'), { target: { value: 'singkat' } })
        expect(dialog.getByRole('button', { name: 'Simpan Penyelesaian' })).toBeDisabled()
    })

    it('Buat Tindak Lanjut membuka form surat keluar dengan disposisi terkait', async () => {
        tampil()
        const baris = (await screen.findByRole('link', { name: 'SM-1/2026' })).closest('tr')
        fireEvent.click(within(baris).getByRole('button', { name: 'Buat Tindak Lanjut' }))
        expect(await screen.findByRole('heading', { name: 'Form surat keluar' })).toBeInTheDocument()
    })

    it('filter lewat batas waktu meminta server dengan lewatBatas', async () => {
        tampil()
        await screen.findByRole('link', { name: 'SM-1/2026' })
        fireEvent.click(screen.getByRole('checkbox', { name: 'Lewat batas waktu' }))
        await waitFor(() => expect(mocks.svc.getInbox).toHaveBeenLastCalledWith('dir_bppt', { lewatBatas: true }))
    })

    it('?penyelesaian=<id> dari detail surat langsung membuka dialog penyelesaian', async () => {
        tampil('/distribusi?penyelesaian=d1')
        expect(await screen.findByRole('dialog', { name: 'Penyelesaian Disposisi' })).toBeInTheDocument()
    })
})
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd frontend && npx vitest run src/pages/DistributionInbox.test.jsx`
Expected: FAIL — tidak ada tautan/aria-label/dialog.

- [ ] **Step 3: Implementasi `PenyelesaianDialog`**

```jsx
// frontend/src/components/distribusi/PenyelesaianDialog.jsx
import { useEffect, useState } from 'react'
import { ClipboardCheck, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import distributionService from '@/services/distribution.service'

/** Penyelesaian disposisi (§5): surat keluar approved milik unit di rangkaian yang sama, atau catatan ≥10. */
export function PenyelesaianDialog({ open, onOpenChange, distribusi, unitKerjaId, onSelesai }) {
    const { toast } = useToast()
    const [kandidat, setKandidat] = useState([])
    const [pilihan, setPilihan] = useState('')
    const [catatan, setCatatan] = useState('')
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (!open || !distribusi) return undefined
        setPilihan('')
        setCatatan('')
        let aktif = true
        distributionService.getKandidatPenyelesaian(distribusi.id, unitKerjaId)
            .then((rows) => { if (aktif) setKandidat(rows) })
            .catch(() => { if (aktif) setKandidat([]) })
        return () => { aktif = false }
    }, [open, distribusi, unitKerjaId])

    const siap = pilihan === 'catatan' ? catatan.trim().length >= 10 : Boolean(pilihan)

    const simpan = async () => {
        setLoading(true)
        try {
            await distributionService.process(distribusi.id, unitKerjaId, pilihan === 'catatan'
                ? { catatanPenyelesaian: catatan.trim() }
                : { penyelesaianSuratKeluarId: pilihan })
            toast({ title: 'Berhasil', description: 'Disposisi diselesaikan' })
            onOpenChange(false)
            onSelesai?.()
        } catch (error) {
            toast({ title: 'Error', description: error.response?.data?.error || error.message || 'Gagal menyelesaikan disposisi', variant: 'destructive' })
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(value) => !loading && onOpenChange(value)}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" />Penyelesaian Disposisi</DialogTitle>
                    <DialogDescription>Pilih surat keluar penyelesaian yang sudah disetujui, atau tulis catatan penyelesaian.</DialogDescription>
                </DialogHeader>
                <fieldset className="space-y-2">
                    <legend className="text-sm font-medium">Bukti penyelesaian</legend>
                    {kandidat.length === 0 && (
                        <p className="text-sm text-muted-foreground">Belum ada surat keluar disetujui milik unit Anda di rangkaian ini.</p>
                    )}
                    {kandidat.map((sk) => (
                        <label key={sk.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                            <input type="radio" name="penyelesaian" value={sk.id} checked={pilihan === sk.id} onChange={() => setPilihan(sk.id)} />
                            <span>{sk.nomorSurat || 'Tanpa nomor'} — {sk.perihal}</span>
                        </label>
                    ))}
                    <label className="flex items-start gap-2 rounded-md border p-2 text-sm">
                        <input type="radio" name="penyelesaian" value="catatan" checked={pilihan === 'catatan'} onChange={() => setPilihan('catatan')} />
                        <span>Catatan penyelesaian (tanpa surat keluar)</span>
                    </label>
                    {pilihan === 'catatan' && (
                        <div className="space-y-1">
                            <Textarea aria-label="Isi catatan penyelesaian" value={catatan} onChange={(event) => setCatatan(event.target.value)} rows={4} />
                            <p className="text-xs text-muted-foreground">Minimal 10 karakter.</p>
                        </div>
                    )}
                </fieldset>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Batal</Button>
                    <Button onClick={simpan} disabled={!siap || loading}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Simpan Penyelesaian
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
```

- [ ] **Step 4: Ubah `DistributionInbox.jsx`**

1. Impor tambahan:

```jsx
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ClipboardCheck, FilePlus2 } from 'lucide-react'
import { PenyelesaianDialog } from '@/components/distribusi/PenyelesaianDialog'
import { buildTindakLanjutState } from '@/lib/tindak-lanjut'
```

2. State baru (setelah baris 59):

```jsx
    const [lewatBatas, setLewatBatas] = useState(false)
    const [penyelesaianTarget, setPenyelesaianTarget] = useState(null)
    const [searchParams, setSearchParams] = useSearchParams()
    const navigate = useNavigate()
    const hariIniJakarta = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
```

3. Di `loadData` ganti `distributionService.getInbox(unitKerjaId),` dengan `distributionService.getInbox(unitKerjaId, lewatBatas ? { lewatBatas: true } : {}),` dan dependensi `useCallback` menjadi `[lewatBatas, toast, unitKerjaId]`.

4. Setelah efek `loadData` tambahkan:

```jsx
    // Tombol Penyelesaian di detail surat menavigasi ke /distribusi?penyelesaian=<id>.
    useEffect(() => {
        const id = searchParams.get('penyelesaian')
        if (!id || inboxData.length === 0) return
        const baris = inboxData.find((item) => item.id === id && !item.masked)
        if (baris) setPenyelesaianTarget(baris)
        setSearchParams({}, { replace: true })
    }, [inboxData, searchParams, setSearchParams])

    const bukaTindakLanjut = (item) => navigate('/surat/keluar/tambah', {
        state: buildTindakLanjutState('surat_masuk', {
            id: item.surat.id, nomorSurat: item.surat.nomorSurat, perihal: item.surat.perihal, dari: item.surat.dari,
            rangkaian: item.rangkaian, distribusiUnitSaya: { id: item.id, status: item.status },
        }, 'buat_nota_dinas'),
    })
```

5. Hapus `handleProcess` (baris 116-131).
6. Di header tabel inbox (baris 318-325) sisipkan `<TableHead className="w-[130px]">Batas Waktu</TableHead>` sebelum kolom Status, dan ubah semua `colSpan={8}` menjadi `colSpan={9}`.
7. Setelah input pencarian (baris 301) tambahkan:

```jsx
                    {activeTab === 'inbox' && (
                        <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={lewatBatas} onChange={(event) => setLewatBatas(event.target.checked)} />
                            Lewat batas waktu
                        </label>
                    )}
```

8. Ganti sel "Nomor Surat", "Perihal", "Instruksi" baris inbox (baris 347-362) dengan:

```jsx
                                            <TableCell data-label="Nomor Surat">
                                                {item.masked ? (
                                                    <Badge variant="outline" className="text-muted-foreground">Dikecualikan</Badge>
                                                ) : (
                                                    <Link to={`/surat/masuk/${item.surat.id}`} className="text-xs font-mono underline-offset-2 hover:underline">
                                                        {item.surat?.nomorSurat || '-'}
                                                    </Link>
                                                )}
                                                {item.rangkaian?.kode && <p className="mt-1 text-[10px] text-muted-foreground">{item.rangkaian.kode}</p>}
                                            </TableCell>
                                            <TableCell data-label="Perihal">
                                                {item.masked ? (
                                                    <span className="text-xs text-muted-foreground">Ajukan akses / hubungi TU</span>
                                                ) : (
                                                    <Link to={`/surat/masuk/${item.surat.id}`} className="font-medium text-sm line-clamp-2 hover:text-primary">
                                                        {item.surat?.perihal || '-'}
                                                    </Link>
                                                )}
                                            </TableCell>
                                            <TableCell data-label="Dari Unit" className="text-sm text-muted-foreground">{item.sourceUnit?.name || '-'}</TableCell>
                                            <TableCell data-label="Instruksi" className="text-sm italic text-orange-600 dark:text-orange-400/90 whitespace-pre-line">
                                                {item.masked ? '-' : (item.instruction || '-')}
                                            </TableCell>
```

dan tambahkan sel batas waktu sebelum sel Status:

```jsx
                                            <TableCell data-label="Batas Waktu" className="text-xs whitespace-nowrap">
                                                {item.batasWaktu ? (
                                                    <span className={item.batasWaktu < hariIniJakarta && ['sent', 'received'].includes(item.status) ? 'font-semibold text-destructive' : ''}>
                                                        {format(new Date(`${item.batasWaktu}T00:00:00`), 'dd MMM yyyy', { locale: localeId })}
                                                    </span>
                                                ) : '-'}
                                            </TableCell>
```

9. Ganti isi sel "Aksi" (baris 368-422) dengan:

```jsx
                                                <div className="flex items-center justify-end gap-1">
                                                    {!item.masked && item.status === 'sent' && (
                                                        <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Terima Surat" title="Terima Surat"
                                                            onClick={() => handleReceive(item.id)} disabled={actionLoading}>
                                                            <Check className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                    {!item.masked && ['sent', 'received'].includes(item.status) && (
                                                        <>
                                                            <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Buat Tindak Lanjut" title="Buat Tindak Lanjut"
                                                                onClick={() => bukaTindakLanjut(item)} disabled={actionLoading}>
                                                                <FilePlus2 className="h-4 w-4" />
                                                            </Button>
                                                            <Button variant="default" size="icon" className="h-8 w-8 bg-emerald-600 hover:bg-emerald-700" aria-label="Penyelesaian" title="Penyelesaian"
                                                                onClick={() => setPenyelesaianTarget(item)} disabled={actionLoading}>
                                                                <ClipboardCheck className="h-4 w-4" />
                                                            </Button>
                                                        </>
                                                    )}
                                                    {['sent', 'received'].includes(item.status) && (
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" aria-label="Tolak & Kembalikan" title="Tolak & Kembalikan"
                                                            onClick={() => openRejectDialog(item)} disabled={actionLoading}>
                                                            <XCircle className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                </div>
```

10. Sebelum `{/* Reject Dialog */}` (baris 503) render:

```jsx
            <PenyelesaianDialog
                open={Boolean(penyelesaianTarget)}
                onOpenChange={(value) => { if (!value) setPenyelesaianTarget(null) }}
                distribusi={penyelesaianTarget}
                unitKerjaId={unitKerjaId}
                onSelesai={loadData}
            />
```

Pada dialog tolak, ganti `{selectedDistribution?.surat?.perihal}` dengan `{selectedDistribution?.masked ? 'Dikecualikan' : selectedDistribution?.surat?.perihal}`. Hapus impor `Tooltip*` bila tidak lagi dipakai di tabel inbox (tetap dipakai tabel outbox? periksa; bila tidak dipakai di mana pun, hapus).

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `cd frontend && npx vitest run src/pages/DistributionInbox.test.jsx`
Expected: PASS (6 test).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/distribusi/PenyelesaianDialog.jsx frontend/src/pages/DistributionInbox.jsx frontend/src/pages/DistributionInbox.test.jsx
git commit -m "feat(frontend): kotak disposisi dengan tautan detail, penyelesaian, batas waktu, dan baris tersamar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


#### Amandemen pra-eksekusi Task 23 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


**`DistributionInbox.jsx`: add these edits**
- **Replace the `filteredInbox` filter** (`:183-186`) [T23-1]:

  ```jsx
  const kueri = searchTerm.trim().toLowerCase()
  const filteredInbox = inboxData.filter(item => !kueri || (!item.masked && (
      item.surat?.perihal?.toLowerCase().includes(kueri) ||
      item.surat?.nomorSurat?.toLowerCase().includes(kueri)
  )))
  ```

  Masked rows have null perihal/nomor, and today's filter always drops them, even with an empty search.
- **`TableSkeleton`:** the inbox tab's `<TableSkeleton rows={5} columns={8} />` (`:332`) becomes `columns={9}`, because this task adds a column. [T23-2]
- **`?penyelesaian=<id>` effect** (plan:8018-8026): when the id does not match a loaded row, show `toast({ title: 'Disposisi tidak ditemukan pada halaman ini', variant: 'destructive' })` and clear the parameter. [T23-3]

**`DistributionInbox.test.jsx`: add**
- With `searchTerm` empty, the masked row is rendered.
- With a search term, the masked row is hidden.

**Step (run): add** `cd frontend && npx eslint src/pages/DistributionInbox.jsx src/components/distribusi/PenyelesaianDialog.jsx`.

---



### Task 24: Registrasi surat masuk — disposisi multi-unit, Nomor Referensi, peringatan duplikat

**Files:**
- Create: `frontend/src/components/surat-masuk/DisposisiRegistrasiSection.jsx`
- Modify: `frontend/src/pages/TambahSuratMasuk.jsx:1-60` (impor), `:126-135` (hapus `DISPOSISI_OPTIONS`), `:143-205` (state), `:320-339` (validasi), `:357-370` (payload), `:572-592` (peringatan nomor), `:695-714` (bagian disposisi), setelah kartu Identitas (kartu Nomor Referensi)
- Modify: `frontend/src/pages/surat-form-behavior.test.jsx:163-170`
- Test: `frontend/src/pages/TambahSuratMasuk.registrasi.test.jsx`

**Interfaces:**
- Consumes: `distributionService.getDistributableUnits/getOpsi` (Task 18); `useLacakSearch` mode `cek` (Task 18); `ReferensiSection` (Task 20); `isSifatTerkendali` (Task 19); `PESAN_TERKENDALI` (Task 22).
- Produces: `<DisposisiRegistrasiSection ... />`, `KABAG_LABELS`, `LEGACY_DISPOSISI_LABELS`; payload create surat masuk: `disposisi` = `{ targets: [{ unitKerjaId, penanggungJawab, batasWaktu? }], instruksi, labelTambahan }` bila ada unit, atau array label bila hanya label; `referensi: { jenis: 'surat_keluar', id }`; konfirmasi "Surat belum didisposisikan. Simpan tanpa disposisi?" bila kosong.

- [ ] **Step 1: Tulis test yang gagal**

```jsx
// frontend/src/pages/TambahSuratMasuk.registrasi.test.jsx
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TambahSuratMasuk from './TambahSuratMasuk'
import { clearOfflineStorage } from '@/lib/offline-storage'

const mocks = vi.hoisted(() => ({
    masuk: { create: vi.fn(), getNextNumber: vi.fn(), getById: vi.fn(), update: vi.fn() },
    dist: { getDistributableUnits: vi.fn(), getOpsi: vi.fn() },
    lacak: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-tu', role: 'admin_unit', unitKerjaId: 'sesditjen' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { fileUploads: false } }) }))
vi.mock('@/services/surat-masuk.service', () => ({ suratMasukService: mocks.masuk }))
vi.mock('@/services/distribution.service', () => ({ default: mocks.dist, distributionService: mocks.dist }))
vi.mock('@/services/rangkaian.service', () => ({ rangkaianService: { lacak: mocks.lacak }, default: { lacak: mocks.lacak } }))
vi.mock('@/components/ui/searchable-select', () => ({
    SearchableSelect: ({ id, ariaLabel, value, onValueChange, options }) => (
        <select id={id} aria-label={ariaLabel} value={value} onChange={event => onValueChange(event.target.value)}>
            <option value="">Pilih</option>
            {options.map(option => {
                const item = typeof option === 'string' ? { value: option, label: option } : option
                return <option key={item.value} value={item.value}>{item.label}</option>
            })}
        </select>
    ),
}))
vi.mock('@/components/ui/multi-select', () => ({
    MultiSelect: ({ id, ariaLabel, selected, onChange, options }) => (
        <select id={id} aria-label={ariaLabel} multiple value={selected}
            onChange={event => onChange(Array.from(event.target.selectedOptions, item => item.value))}>
            {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
    ),
}))

const nodeSk = { anggotaId: null, jenis: 'surat_keluar', id: 'sk-1', nomorSurat: 'B-5/2026', perihal: 'Permintaan data',
    tanggalSurat: '2026-09-01', tahun: 2026, naskah: 'Surat Dinas', unitKerjaId: 'dir_bppt', unitNama: 'Dit. BPPT', relasi: null, masked: false }
const kelompokDasar = { skor: 90, tanggalTerbaru: '2026-09-01', cocok: [], jumlahAnggota: 1, pratinjauTerpotong: false }
let router

beforeEach(async () => {
    vi.clearAllMocks()
    await clearOfflineStorage()
    Element.prototype.scrollIntoView = vi.fn()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    mocks.masuk.create.mockResolvedValue({ data: { id: 'sm-baru' } })
    mocks.masuk.getNextNumber.mockResolvedValue({ nomorSurat: '001/SM/2026' })
    mocks.dist.getDistributableUnits.mockResolvedValue([
        { id: 'dir_bppt', name: 'Dit. BPPT', unitType: 'direktorat' },
        { id: 'dir_ptep', name: 'Dit. PTEP', unitType: 'direktorat' },
        { id: 'bagian_umum', name: 'Bagian Umum', unitType: 'bagian' },
    ])
    mocks.dist.getOpsi.mockResolvedValue({ instruksi: ['Mohon ditindaklanjuti sesuai ketentuan'], jalurAksesTerkendali: false })
    mocks.lacak.mockImplementation(async ({ q, mode }) => ({ q, mode, jenisKueri: 'nomor',
        kelompok: mode === 'cek' && q === 'B-12/2026'
            ? [{ ...kelompokDasar, kunci: 'rs-9', rangkaian: { id: 'rs-9', kode: 'RS-2026-000123', status: 'aktif', judul: 'X', tahun: 2026, asal: 'surat_masuk' }, pratinjau: [] }]
            : mode === 'referensi' ? [{ ...kelompokDasar, kunci: 'surat:sk-1', rangkaian: null, pratinjau: [nodeSk] }] : [] }))
})
afterEach(() => { cleanup(); router?.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })

async function tampilDanIsi() {
    router = createMemoryRouter([
        { path: '/surat/masuk/tambah', element: <TambahSuratMasuk /> },
        { path: '/surat/masuk', element: <h1>Daftar</h1> },
    ], { initialEntries: ['/surat/masuk/tambah'] })
    const view = render(<RouterProvider router={router} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Jenis surat' }), { target: { value: 'Nota Dinas' } })
    fireEvent.change(screen.getByLabelText(/Tanggal Surat/), { target: { value: '2026-09-23' } })
    fireEvent.change(screen.getByLabelText(/^Perihal/), { target: { value: 'Permohonan penetapan lokasi' } })
    fireEvent.change(screen.getByLabelText(/^Dari \(Pengirim\)/), { target: { value: 'Pemda Sintetis' } })
    fireEvent.change(screen.getByLabelText(/^Kepada \(Penerima\)/), { target: { value: 'Direktur Jenderal' } })
    await screen.findByRole('option', { name: 'Dit. BPPT' })
    return view
}

function pilihDisposisi(values) {
    const listbox = screen.getByRole('listbox', { name: 'Penerima disposisi' })
    for (const option of listbox.options) option.selected = values.includes(option.value)
    fireEvent.change(listbox)
}

describe('registrasi surat masuk', () => {
    it('disposisi multi-unit dengan penanggung jawab, instruksi, dan label Kabag saja', async () => {
        const view = await tampilDanIsi()
        expect(screen.queryByRole('option', { name: /Bagian Umum/ })).toBeNull()
        pilihDisposisi(['dir_bppt', 'dir_ptep', 'Kabag Program dan Hukum'])
        fireEvent.click(screen.getByRole('radio', { name: 'Dit. BPPT' }))
        fireEvent.click(screen.getByRole('button', { name: 'Mohon ditindaklanjuti sesuai ketentuan' }))
        fireEvent.submit(view.container.querySelector('form'))
        await waitFor(() => expect(mocks.masuk.create).toHaveBeenCalled())
        const payload = mocks.masuk.create.mock.calls[0][0]
        expect(payload.disposisi).toEqual({
            targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }, { unitKerjaId: 'dir_ptep', penanggungJawab: false }],
            instruksi: 'Mohon ditindaklanjuti sesuai ketentuan',
            labelTambahan: ['Kabag Program dan Hukum'],
        })
        expect(payload).not.toHaveProperty('disposisiPj')
    })

    it('tanpa disposisi meminta konfirmasi; bila dibatalkan tidak menyimpan', async () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
        const view = await tampilDanIsi()
        fireEvent.submit(view.container.querySelector('form'))
        expect(confirm).toHaveBeenCalledWith('Surat belum didisposisikan. Simpan tanpa disposisi?')
        expect(mocks.masuk.create).not.toHaveBeenCalled()
    })

    it('surat terkendali dengan disposisi ditolak di klien selama jalur akses mati', async () => {
        const view = await tampilDanIsi()
        fireEvent.change(document.getElementById('sifat-surat'), { target: { value: 'rahasia' } })
        pilihDisposisi(['dir_bppt'])
        fireEvent.submit(view.container.querySelector('form'))
        expect(await screen.findByRole('alert')).toHaveTextContent('Surat terkendali belum dapat didisposisikan')
        expect(mocks.masuk.create).not.toHaveBeenCalled()
    })

    it('peringatan duplikat nomor memakai Lacak mode cek', async () => {
        await tampilDanIsi()
        vi.useFakeTimers()
        fireEvent.change(document.getElementById('nomor-surat'), { target: { value: 'B-12/2026' } })
        await act(async () => { await vi.advanceTimersByTimeAsync(300) })
        vi.useRealTimers()
        expect(await screen.findByText('Nomor sudah terdaftar / terkait RS-2026-000123')).toBeInTheDocument()
    })

    it('Nomor Referensi (surat kita) menyarankan disposisi ke pemilik surat rujukan', async () => {
        const view = await tampilDanIsi()
        fireEvent.click(screen.getByRole('combobox', { name: 'Nomor Referensi (surat kita)' }))
        vi.useFakeTimers()
        fireEvent.change(screen.getByPlaceholderText('Ketik minimal 3 karakter nomor atau perihal...'), { target: { value: 'B-5/2026' } })
        await act(async () => { await vi.advanceTimersByTimeAsync(300) })
        vi.useRealTimers()
        fireEvent.keyDown(screen.getByPlaceholderText('Ketik minimal 3 karakter nomor atau perihal...'), { key: 'Enter' })
        fireEvent.click(await screen.findByRole('button', { name: 'Disposisikan ke Dit. BPPT' }))
        fireEvent.submit(view.container.querySelector('form'))
        await waitFor(() => expect(mocks.masuk.create).toHaveBeenCalled())
        const payload = mocks.masuk.create.mock.calls[0][0]
        expect(payload.referensi).toEqual({ jenis: 'surat_keluar', id: 'sk-1' })
        expect(payload.disposisi.targets).toEqual([{ unitKerjaId: 'dir_bppt', penanggungJawab: false }])
        expect(mocks.lacak).toHaveBeenCalledWith(expect.objectContaining({ mode: 'referensi', jenis: 'surat_keluar' }), expect.anything())
    })
})
```

Di `frontend/src/pages/surat-form-behavior.test.jsx` test "associates the incoming disposition error" tetap berlaku; tambahkan satu baris sebelum `const trigger = ...`:

```jsx
    expect(window.confirm).toHaveBeenCalledWith('Surat belum didisposisikan. Simpan tanpa disposisi?');
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd frontend && npx vitest run src/pages/TambahSuratMasuk.registrasi.test.jsx`
Expected: FAIL — opsi unit tidak dimuat; payload masih array label.

- [ ] **Step 3: Implementasi `DisposisiRegistrasiSection`**

```jsx
// frontend/src/components/surat-masuk/DisposisiRegistrasiSection.jsx
import { ArrowRight } from 'lucide-react'
import { MultiSelect } from '@/components/ui/multi-select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/** D6: label Kabag hanya chip label, tanpa routing. */
export const KABAG_LABELS = ['Kabag Program dan Hukum', 'Kabag Kepegawaian Keuangan dan Umum']
export const LEGACY_DISPOSISI_LABELS = ['Ditjen', 'SekDitjen', 'Dit. BPPT', 'Dit. PTEP', 'Dit. KTPP', ...KABAG_LABELS]

export function DisposisiRegistrasiSection({
    isEditMode, units, value, onChange, penanggungJawab, onPenanggungJawab, batasWaktu, onBatasWaktu,
    instruksi, onInstruksi, opsiInstruksi = [], disabled, error, errorId = 'disposisi-surat-error',
}) {
    const options = isEditMode
        ? Array.from(new Set([...LEGACY_DISPOSISI_LABELS, ...value])).map((label) => ({ label, value: label }))
        : [
            ...units.map((unit) => ({ label: unit.name, value: unit.id })),
            ...KABAG_LABELS.map((label) => ({ label: `${label} (label saja)`, value: label })),
        ]
    const unitDipilih = isEditMode ? [] : value.filter((item) => units.some((unit) => unit.id === item))
    const tambahInstruksi = (teks) => onInstruksi(instruksi.trim() ? `${instruksi.trim()}\n${teks}` : teks)

    return (
        <div className="space-y-3">
            <Label htmlFor="disposisi-surat" className="text-sm font-medium flex items-center gap-2">
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                Disposisi ke
            </Label>
            <MultiSelect
                id="disposisi-surat"
                ariaLabel="Penerima disposisi"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                disabled={disabled}
                options={options}
                selected={value}
                onChange={onChange}
                placeholder={isEditMode ? 'Label disposisi...' : 'Pilih unit tujuan disposisi...'}
                className="w-full focus-visible:ring-primary"
            />
            {error && <p id={errorId} className="text-sm text-destructive">{error}</p>}
            {unitDipilih.length > 0 && (
                <div className="space-y-3 rounded-lg border border-border/60 p-3">
                    <fieldset className="space-y-1" disabled={disabled}>
                        <legend className="text-sm font-medium">Penanggung jawab (Unit Pengolah)</legend>
                        {unitDipilih.map((id) => (
                            <label key={id} className="flex items-center gap-2 text-sm">
                                <input type="radio" name="penanggung-jawab-registrasi" checked={penanggungJawab === id} onChange={() => onPenanggungJawab(id)} />
                                {units.find((unit) => unit.id === id)?.name || id}
                            </label>
                        ))}
                    </fieldset>
                    <div className="space-y-1">
                        <Label htmlFor="batas-waktu-registrasi">Batas waktu</Label>
                        <Input id="batas-waktu-registrasi" type="date" value={batasWaktu} onChange={(event) => onBatasWaktu(event.target.value)} disabled={disabled} />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="instruksi-registrasi">Instruksi disposisi</Label>
                        {opsiInstruksi.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {opsiInstruksi.map((teks) => (
                                    <Button key={teks} type="button" size="sm" variant="outline" onClick={() => tambahInstruksi(teks)} disabled={disabled}>{teks}</Button>
                                ))}
                            </div>
                        )}
                        <Textarea id="instruksi-registrasi" value={instruksi} onChange={(event) => onInstruksi(event.target.value)} rows={3} disabled={disabled} />
                    </div>
                </div>
            )}
        </div>
    )
}
```

- [ ] **Step 4: Ubah `TambahSuratMasuk.jsx`**

1. Impor: tambahkan

```jsx
import distributionService from '@/services/distribution.service';
import { useLacakSearch } from '@/hooks/use-lacak-search';
import { ReferensiSection } from '@/components/surat-keluar/ReferensiSection';
import { DisposisiRegistrasiSection } from '@/components/surat-masuk/DisposisiRegistrasiSection';
import { PESAN_TERKENDALI } from '@/components/DistributeDialog';
import { isSifatTerkendali } from '@/lib/tindak-lanjut';
```

dan hapus impor `MultiSelect` (kini di dalam komponen baru). Hapus konstanta `DISPOSISI_OPTIONS` (baris 126-135).

2. State (setelah `const [numberPreview, ...]`):

```jsx
    const [units, setUnits] = useState([]);
    const [opsiDisposisi, setOpsiDisposisi] = useState({ instruksi: [], jalurAksesTerkendali: false });
    const [referensi, setReferensi] = useState(null);
```

Tambah pada state awal `formData` (setelah `disposisi: [],`): `disposisiPj: '', disposisiBatasWaktu: '', disposisiInstruksi: '',`.

3. Muat unit & opsi (create saja) — sisipkan setelah efek `getNextNumber`:

```jsx
    useEffect(() => {
        if (isEditMode || !resolvedUnitKerjaId) return undefined;
        let aktif = true;
        Promise.all([
            distributionService.getDistributableUnits(resolvedUnitKerjaId),
            distributionService.getOpsi().catch(() => ({ instruksi: [], jalurAksesTerkendali: false })),
        ]).then(([daftar, opsi]) => {
            if (!aktif) return;
            setUnits(Array.isArray(daftar) ? daftar.filter((unit) => unit.unitType !== 'bagian') : []);
            setOpsiDisposisi(opsi || { instruksi: [], jalurAksesTerkendali: false });
        }).catch(() => { /* Unit gagal dimuat: label saja tetap tersedia. */ });
        return () => { aktif = false; };
    }, [isEditMode, resolvedUnitKerjaId]);

    const cekNomor = useLacakSearch(isEditMode ? '' : formData.nomorSurat, { mode: 'cek' });
    const duplikat = cekNomor.data?.kelompok ?? [];
    const pisahkanDisposisi = (pilihan = []) => ({
        targets: pilihan.filter((value) => units.some((unit) => unit.id === value)),
        labels: pilihan.filter((value) => !units.some((unit) => unit.id === value)),
    });
```

4. Validasi — ganti baris `if (!formData.disposisi || formData.disposisi.length === 0) return ...` (baris 333) dengan:

```jsx
        if (!isEditMode) {
            const { targets } = pisahkanDisposisi(formData.disposisi);
            if (targets.length > 0 && isSifatTerkendali(formData.sifatSurat) && !opsiDisposisi.jalurAksesTerkendali) {
                return { field: 'disposisi', message: PESAN_TERKENDALI };
            }
        }
        if (!formData.disposisi || formData.disposisi.length === 0) {
            if (!window.confirm('Surat belum didisposisikan. Simpan tanpa disposisi?')) {
                return { field: 'disposisi', message: 'Disposisi wajib diisi' };
            }
        }
```

5. Payload — ganti isi blok `if (isEditMode) {...} else {...}` (baris 360-370) dengan:

```jsx
            const { disposisiPj, disposisiBatasWaktu, disposisiInstruksi, disposisi: pilihan, ...dasar } = dataToSubmit;
            if (isEditMode) {
                // Tahun tidak dikirim saat edit agar tahun asli surat tidak tertimpa
                await suratMasukService.update(id, { ...dasar, disposisi: pilihan }, filesEnabled ? selectedFile : null);
            } else {
                const { targets, labels } = pisahkanDisposisi(pilihan);
                const disposisi = targets.length > 0 ? {
                    targets: targets.map((unitKerjaId) => ({
                        unitKerjaId,
                        penanggungJawab: unitKerjaId === disposisiPj,
                        ...(disposisiBatasWaktu ? { batasWaktu: disposisiBatasWaktu } : {}),
                    })),
                    instruksi: disposisiInstruksi?.trim() || null,
                    labelTambahan: labels,
                } : labels;
                await suratMasukService.create({
                    ...dasar,
                    disposisi,
                    ...(referensi ? { referensi: { jenis: 'surat_keluar', id: referensi.suratId } } : {}),
                    tahun: Number(formData.tanggalSurat.slice(0, 4)) || new Date().getFullYear(),
                }, filesEnabled ? selectedFile : null);
            }
```

6. Peringatan duplikat — setelah paragraf "Preview nomor otomatis" (baris 592) tambahkan:

```jsx
                                {duplikat.length > 0 && (
                                    <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                                        {duplikat[0].rangkaian ? `Nomor sudah terdaftar / terkait ${duplikat[0].rangkaian.kode}` : 'Nomor sudah terdaftar'}
                                    </p>
                                )}
```

7. Ganti blok `<div className="space-y-2">` "Disposisi ke" (baris 695-714) dengan:

```jsx
                            <div className="space-y-2 md:col-span-2">
                                <DisposisiRegistrasiSection
                                    isEditMode={isEditMode}
                                    units={units}
                                    value={formData.disposisi}
                                    onChange={(val) => {
                                        handleChange('disposisi', val);
                                        if (!val.includes(formData.disposisiPj)) handleChange('disposisiPj', '');
                                    }}
                                    penanggungJawab={formData.disposisiPj}
                                    onPenanggungJawab={(unitId) => handleChange('disposisiPj', unitId)}
                                    batasWaktu={formData.disposisiBatasWaktu}
                                    onBatasWaktu={(value) => handleChange('disposisiBatasWaktu', value)}
                                    instruksi={formData.disposisiInstruksi}
                                    onInstruksi={(value) => handleChange('disposisiInstruksi', value)}
                                    opsiInstruksi={opsiDisposisi.instruksi}
                                    disabled={saveLocked}
                                    error={fieldErrors.disposisi}
                                />
                                {!isEditMode && referensi?.unitKerjaId && units.some((unit) => unit.id === referensi.unitKerjaId)
                                    && !formData.disposisi.includes(referensi.unitKerjaId) && (
                                    <Button type="button" variant="outline" size="sm"
                                        onClick={() => handleChange('disposisi', [...formData.disposisi, referensi.unitKerjaId])}>
                                        {`Disposisikan ke ${referensi.unitNama}`}
                                    </Button>
                                )}
                            </div>
```

8. Kartu Nomor Referensi — sisipkan sebagai kartu baru tepat setelah kartu "Identitas Surat" (setelah penutup `</Card>` bagian langkah 2), hanya untuk create:

```jsx
                {!isEditMode && (
                    <Card className="overflow-hidden border-border/50 shadow-sm transition-all hover:shadow-md">
                        <CardContent className="p-6 space-y-5">
                            <SectionHeader icon={LinkIcon} title="Nomor Referensi (surat kita)" description="Isi bila surat ini membalas surat keluar kita (opsional)" />
                            <ReferensiSection
                                referensi={referensi}
                                jenisFilter="surat_keluar"
                                label="Nomor Referensi (surat kita)"
                                onPilih={(pilihan) => { setReferensi({ ...pilihan, jenisRelasi: 'merujuk' }); setDirty(); }}
                                onHapus={() => { setReferensi(null); setDirty(); }}
                                onUbahRelasi={() => undefined}
                                disabled={saveLocked || !resolvedUnitKerjaId}
                            />
                        </CardContent>
                    </Card>
                )}
```

(Relasi surat masuk ke surat rujukan selalu `merujuk` di server; pemilih jenis relasi pada chip tidak berpengaruh untuk surat masuk.)

- [ ] **Step 5: Jalankan test, pastikan lulus (termasuk regresi form)**

Run: `cd frontend && npx vitest run src/pages/TambahSuratMasuk.registrasi.test.jsx src/pages/surat-form-behavior.test.jsx src/pages/surat-date-input.test.jsx src/pages/surat-archive-selection.test.jsx src/pages/surat-picker-contract.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/surat-masuk/DisposisiRegistrasiSection.jsx frontend/src/pages/TambahSuratMasuk.jsx frontend/src/pages/TambahSuratMasuk.registrasi.test.jsx frontend/src/pages/surat-form-behavior.test.jsx
git commit -m "feat(frontend): registrasi surat masuk dengan disposisi multi-unit, Nomor Referensi, dan cek duplikat

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


#### Amandemen pra-eksekusi Task 24 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


**Files: add**
- Create `frontend/src/lib/disposisi-labels.js`.
- Modify `frontend/src/services/surat-masuk.service.js:116-118` (delete with body).
- Modify `frontend/src/pages/SuratMasuk.jsx:284-290,805-815` (delete dialog with alasan).
- Modify `frontend/src/components/surat-keluar/ReferensiSection.jsx`: the `relasiTetap` prop exists from Task 20.

**Labels** [T24-1]. Move `export const KABAG_LABELS = [...]` and `export const LEGACY_DISPOSISI_LABELS = [...]` from `DisposisiRegistrasiSection.jsx` into `frontend/src/lib/disposisi-labels.js`, and import them in the component. `react-refresh/only-export-components` otherwise errors at `10:14` and `11:14`.

**`PESAN_TERKENDALI` and helpers** [T24-2]:
- `TambahSuratMasuk.jsx`: `import { PESAN_TERKENDALI, appendInstruksi, isSifatTerkendali } from '@/lib/tindak-lanjut'` and `import { useDisposisiOpsi } from '@/hooks/use-disposisi-opsi'`. Do NOT import from `@/components/DistributeDialog`.
- Replace the duplicated `tambahInstruksi`/unit filter/opsi fallback (plan:8347, 8434-8438) with these helpers.

**`alasan` for correction and delete: mandatory** (backs Task 13) [T24-3]:
- **Edit mode (`TambahSuratMasuk.jsx`):**
  1. Keep the originally loaded `{ nomorSurat, perihal, sifatSurat }` in a ref.
  2. When the loaded record has a non-null `rangkaian` (from the Task 16 detail payload) and any of the three fields differs, render a required `Textarea` labelled "Alasan koreksi" (≥10 characters) with the helper text "Surat ini bagian dari rangkaian; perubahan nomor/perihal/sifat dicatat."
  3. Block submit until the text is at least 10 characters, and send `alasan` in the `suratMasukService.update(id, { ...dasar, disposisi: pilihan, alasan }, file)` payload.
  4. If `rangkaian.status === 'diberkaskan'`, disable the three fields and show "Dikunci karena rangkaian sudah diberkaskan".
- **`surat-masuk.service.js`:** `async delete(id, { alasan } = {}) { await api.delete(\`/api/surat-masuk/${id}\`, alasan ? { alasan } : undefined); }` (`api.delete(endpoint, body)` exists at `frontend/src/services/api.js:426`).
- **`SuratMasuk.jsx` delete `AlertDialog`:**
  - Add a required `Textarea` "Alasan penghapusan" (≥10), held in state and reset when the dialog closes.
  - The action button stays disabled until the text is valid.
  - `handleDelete` calls `suratMasukService.delete(selectedSurat.id, { alasan })`.
  - Show server 400/409 messages in the existing error toast.
- **Tests (`TambahSuratMasuk.registrasi.test.jsx`, or a new `SuratMasuk.delete.test.jsx`):**
  - Editing the perihal of a record with `rangkaian` requires `alasan` and sends it.
  - Delete sends `{ alasan }`.

**Edit-route guard** [T24-4]. In edit mode, after loading, if `Array.isArray(data.aksiDiizinkan) && !data.aksiDiizinkan.includes('edit')`, show a toast and `navigate(\`/surat/masuk/${id}\`, { replace: true })`.

**Nomor Referensi.** Pass `relasiTetap` to `ReferensiSection` (plan:8543-8551). [T24-5]

**Step (run): add** `cd frontend && npx eslint src/components/surat-masuk/DisposisiRegistrasiSection.jsx src/pages/TambahSuratMasuk.jsx src/pages/SuratMasuk.jsx src/lib/disposisi-labels.js`. Expected: 0 errors.

---



### Task 25: Aksi panel Alur Surat — Tandai Selesai, Buka Kembali, Berkaskan (dua langkah), Gabungkan, Tutup Disposisi, Batal Relasi, Ajukan Akses, Tautkan

**Files:**
- Create: `frontend/src/components/surat/AlasanDialog.jsx`
- Create: `frontend/src/components/surat/BerkaskanDialog.jsx`
- Create: `frontend/src/components/surat/AlurSuratActions.jsx` (ekspor `AlurSuratActions`, `TutupDisposisiButton`, `AjukanAksesButton`, `BatalRelasiButton`, `TautkanDialog`)
- Modify: `frontend/src/components/surat/AlurSuratPanel.jsx` (dibuat P2 — sisipkan komponen di tiga titik yang dijelaskan Step 4)
- Modify: `frontend/src/pages/SuratMasukDetail.jsx`, `frontend/src/pages/SuratKeluarDetail.jsx` (wiring `onTautkan`)
- Test: `frontend/src/components/surat/AlurSuratActions.test.jsx`

**Interfaces:**
- Consumes: `RangkaianDetail` P2 `{ rangkaian: { id, kode, status, ... }, aksiDiizinkan, disposisi: DisposisiRangkaian[], relasi: RelasiRangkaian[], anggota: Array<AnggotaTerlihat | AnggotaTersamar> }`; `rangkaianService` (Task 18); `useLacakSearch`; `ReferensiSection`; `KlasifikasiPicker` (hanya diimpor).
- Produces: `<AlurSuratActions detail onChanged />`; `<TutupDisposisiButton distribusi onChanged />`; `<AjukanAksesButton anggotaId onChanged />`; `<BatalRelasiButton relasi onChanged />`; `<TautkanDialog open onOpenChange jenis surat onBerhasil />`; `<BerkaskanDialog open onOpenChange rangkaian onBerhasil />`; `<AlasanDialog open onOpenChange title description label minLength submitLabel onSubmit />`.

- [ ] **Step 1: Tulis test yang gagal**

```jsx
// frontend/src/components/surat/AlurSuratActions.test.jsx
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AjukanAksesButton, AlurSuratActions, TutupDisposisiButton } from './AlurSuratActions'

const mocks = vi.hoisted(() => ({
    svc: { tandaiSelesai: vi.fn(), bukaKembali: vi.fn(), opsiBerkas: vi.fn(), berkaskan: vi.fn(), pratinjauGabung: vi.fn(), gabung: vi.fn(), tutupDisposisi: vi.fn(), ajukanAkses: vi.fn(), batalRelasi: vi.fn(), tautkanKeSurat: vi.fn(), lacak: vi.fn() },
    toast: vi.fn(),
}))
vi.mock('@/services/rangkaian.service', () => ({ rangkaianService: mocks.svc, default: mocks.svc }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/components/KlasifikasiPicker', () => ({
    KlasifikasiPicker: ({ onChange }) => <button type="button" onClick={() => onChange('PT.02', { id: 9, kode: 'PT.02', jenis: 'Pengadaan tanah' }, null)}>Pilih klasifikasi lain</button>,
}))

const detail = (aksi) => ({ rangkaian: { id: 'rs-1', kode: 'RS-2026-000001', status: 'selesai' }, aksiDiizinkan: aksi, disposisi: [], relasi: [] })

beforeEach(() => {
    vi.clearAllMocks()
    for (const fn of Object.values(mocks.svc)) fn.mockResolvedValue({})
    mocks.svc.opsiBerkas.mockResolvedValue({ status: 'selesai', unitPengolahId: 'dir_bppt', klasifikasiIndukId: 7,
        unitDalamJangkauan: [{ id: 'dir_bppt', name: 'Dit. BPPT' }, { id: 'sesditjen', name: 'Sekretariat Direktorat Jenderal' }] })
})
afterEach(cleanup)

describe('AlurSuratActions', () => {
    it('hanya menampilkan aksi yang diizinkan server', () => {
        render(<AlurSuratActions detail={detail(['tandai_selesai'])} onChanged={vi.fn()} />)
        expect(screen.getByRole('button', { name: 'Tandai Selesai' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Berkaskan/ })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Gabungkan Rangkaian' })).toBeNull()
    })

    it('Tandai Selesai wajib catatan ≥10 karakter', async () => {
        const onChanged = vi.fn()
        render(<AlurSuratActions detail={detail(['tandai_selesai'])} onChanged={onChanged} />)
        fireEvent.click(screen.getByRole('button', { name: 'Tandai Selesai' }))
        const dialog = within(await screen.findByRole('dialog'))
        fireEvent.change(dialog.getByLabelText('Catatan penyelesaian'), { target: { value: 'singkat' } })
        expect(dialog.getByRole('button', { name: 'Simpan' })).toBeDisabled()
        fireEvent.change(dialog.getByLabelText('Catatan penyelesaian'), { target: { value: 'Ditangani lewat rapat koordinasi' } })
        fireEvent.click(dialog.getByRole('button', { name: 'Simpan' }))
        await waitFor(() => expect(mocks.svc.tandaiSelesai).toHaveBeenCalledWith('rs-1', 'Ditangani lewat rapat koordinasi'))
        expect(onChanged).toHaveBeenCalled()
    })

    it('Berkaskan memakai konfirmasi dua langkah yang menampilkan ulang unit dan klasifikasi', async () => {
        render(<AlurSuratActions detail={detail(['berkaskan'])} onChanged={vi.fn()} />)
        fireEvent.click(screen.getByRole('button', { name: 'Berkaskan ke Direktorat (Unit Pengolah)' }))
        const dialog = within(await screen.findByRole('dialog'))
        expect(await dialog.findByRole('radio', { name: 'Dit. BPPT' })).toBeChecked()
        fireEvent.click(dialog.getByRole('button', { name: 'Pilih klasifikasi lain' }))
        fireEvent.click(dialog.getByRole('button', { name: 'Lanjut' }))
        expect(dialog.getByText('Dit. BPPT')).toBeInTheDocument()
        expect(dialog.getByText('PT.02 — Pengadaan tanah')).toBeInTheDocument()
        expect(mocks.svc.berkaskan).not.toHaveBeenCalled()
        fireEvent.click(dialog.getByRole('button', { name: 'Ya, berkaskan' }))
        await waitFor(() => expect(mocks.svc.berkaskan).toHaveBeenCalledWith('rs-1', { unitPengolahId: 'dir_bppt', klasifikasiItemId: 9 }))
    })

    it('Tutup Disposisi dan Ajukan Akses memakai alasan/tujuan dengan batas minimal', async () => {
        render(<>
            <TutupDisposisiButton distribusi={{ id: 'd-1' }} onChanged={vi.fn()} />
            <AjukanAksesButton anggotaId="a-1" onChanged={vi.fn()} />
        </>)
        fireEvent.click(screen.getByRole('button', { name: 'Tutup Disposisi' }))
        let dialog = within(await screen.findByRole('dialog'))
        fireEvent.change(dialog.getByLabelText('Alasan'), { target: { value: 'Target tidak dapat memproses' } })
        fireEvent.click(dialog.getByRole('button', { name: 'Tutup Disposisi' }))
        await waitFor(() => expect(mocks.svc.tutupDisposisi).toHaveBeenCalledWith('d-1', 'Target tidak dapat memproses'))
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        fireEvent.click(screen.getByRole('button', { name: 'Ajukan Akses' }))
        dialog = within(await screen.findByRole('dialog'))
        fireEvent.change(dialog.getByLabelText('Tujuan akses'), { target: { value: 'pendek' } })
        expect(dialog.getByRole('button', { name: 'Ajukan' })).toBeDisabled()
    })
})
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd frontend && npx vitest run src/components/surat/AlurSuratActions.test.jsx`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Implementasi dialog dan aksi**

```jsx
// frontend/src/components/surat/AlasanDialog.jsx
import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/** Dialog satu isian teks dengan batas minimal (alasan ≥10 / tujuan ≥20). */
export function AlasanDialog({
    open, onOpenChange, title, description, label = 'Alasan', minLength = 10, submitLabel = 'Simpan', destructive = false, onSubmit, children,
}) {
    const [nilai, setNilai] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    useEffect(() => { if (open) { setNilai(''); setError(null) } }, [open])
    const valid = nilai.trim().length >= minLength
    const kirim = async () => {
        setLoading(true)
        setError(null)
        try {
            await onSubmit(nilai.trim())
            onOpenChange(false)
        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Gagal menyimpan')
        } finally {
            setLoading(false)
        }
    }
    return (
        <Dialog open={open} onOpenChange={(value) => !loading && onOpenChange(value)}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description && <DialogDescription>{description}</DialogDescription>}
                </DialogHeader>
                {children}
                <div className="space-y-2">
                    <Label htmlFor="alasan-dialog-isian">{label}</Label>
                    <Textarea id="alasan-dialog-isian" value={nilai} onChange={(event) => setNilai(event.target.value)} rows={4} />
                    <p className="text-xs text-muted-foreground">Minimal {minLength} karakter.</p>
                    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Batal</Button>
                    <Button variant={destructive ? 'destructive' : 'default'} onClick={kirim} disabled={!valid || loading}>{submitLabel}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
```

```jsx
// frontend/src/components/surat/BerkaskanDialog.jsx
import { useEffect, useState } from 'react'
import { Archive, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { KlasifikasiPicker } from '@/components/KlasifikasiPicker'
import { rangkaianService } from '@/services/rangkaian.service'

/** Berkaskan ke Direktorat (§9): unit hanya dari jangkauan, klasifikasi wajib, konfirmasi dua langkah. */
export function BerkaskanDialog({ open, onOpenChange, rangkaian, onBerhasil }) {
    const [opsi, setOpsi] = useState(null)
    const [unit, setUnit] = useState('')
    const [klasifikasi, setKlasifikasi] = useState(null)
    const [langkah, setLangkah] = useState(1)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    useEffect(() => {
        if (!open) return undefined
        setLangkah(1)
        setError(null)
        let aktif = true
        rangkaianService.opsiBerkas(rangkaian.id).then((data) => {
            if (!aktif) return
            setOpsi(data)
            setUnit(data.unitPengolahId || '')
            setKlasifikasi(data.klasifikasiIndukId ? { id: data.klasifikasiIndukId, kode: null, jenis: `Klasifikasi induk #${data.klasifikasiIndukId}` } : null)
        }).catch((err) => { if (aktif) setError(err.message || 'Gagal memuat opsi berkas') })
        return () => { aktif = false }
    }, [open, rangkaian.id])

    const namaUnit = opsi?.unitDalamJangkauan.find((item) => item.id === unit)?.name || unit
    const teksKlasifikasi = klasifikasi ? (klasifikasi.kode ? `${klasifikasi.kode} — ${klasifikasi.jenis}` : klasifikasi.jenis) : '-'

    const berkaskan = async () => {
        setLoading(true)
        setError(null)
        try {
            await rangkaianService.berkaskan(rangkaian.id, { unitPengolahId: unit, klasifikasiItemId: klasifikasi.id })
            onOpenChange(false)
            onBerhasil?.()
        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Gagal memberkaskan')
            setLangkah(1)
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(value) => !loading && onOpenChange(value)}>
            <DialogContent className="sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><Archive className="h-5 w-5" />Berkaskan ke Direktorat (Unit Pengolah)</DialogTitle>
                    <DialogDescription>Rangkaian {rangkaian.kode} akan menjadi berkas naskah milik Unit Pengolah dan dikunci.</DialogDescription>
                </DialogHeader>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                {langkah === 1 ? (
                    <div className="space-y-4">
                        <fieldset className="space-y-2">
                            <legend className="text-sm font-medium">Unit Pengolah (hanya unit dalam jangkauan)</legend>
                            {(opsi?.unitDalamJangkauan || []).map((item) => (
                                <label key={item.id} className="flex items-center gap-2 text-sm">
                                    <input type="radio" name="unit-pengolah-berkas" checked={unit === item.id} onChange={() => setUnit(item.id)} />
                                    {item.name}
                                </label>
                            ))}
                        </fieldset>
                        <div className="space-y-2">
                            <p className="text-sm font-medium">Klasifikasi berkas <span className="text-destructive">*</span></p>
                            <p className="text-sm text-muted-foreground">{teksKlasifikasi}</p>
                            <KlasifikasiPicker
                                value={klasifikasi?.kode || ''}
                                label="Klasifikasi berkas"
                                onChange={(kode, item) => setKlasifikasi(item ? { id: item.id, kode: item.kode, jenis: item.jenis } : null)}
                            />
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:bg-amber-500/10">
                        <p className="font-medium">Periksa kembali. Unit pengolah dan klasifikasi menentukan retensi berkas dan hanya dapat dikoreksi lewat Koreksi Berkas.</p>
                        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
                            <dt className="text-muted-foreground">Rangkaian</dt><dd>{rangkaian.kode}</dd>
                            <dt className="text-muted-foreground">Unit Pengolah</dt><dd>{namaUnit}</dd>
                            <dt className="text-muted-foreground">Klasifikasi</dt><dd>{teksKlasifikasi}</dd>
                        </dl>
                    </div>
                )}
                <DialogFooter>
                    {langkah === 1 ? (
                        <>
                            <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
                            <Button onClick={() => setLangkah(2)} disabled={!unit || !klasifikasi}>Lanjut</Button>
                        </>
                    ) : (
                        <>
                            <Button variant="outline" onClick={() => setLangkah(1)} disabled={loading}>Kembali</Button>
                            <Button onClick={berkaskan} disabled={loading}>
                                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Ya, berkaskan
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
```

```jsx
// frontend/src/components/surat/AlurSuratActions.jsx
import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useLacakSearch } from '@/hooks/use-lacak-search'
import { rangkaianService } from '@/services/rangkaian.service'
import { ReferensiSection } from '@/components/surat-keluar/ReferensiSection'
import { AlasanDialog } from './AlasanDialog'
import { BerkaskanDialog } from './BerkaskanDialog'

/** Aksi tingkat rangkaian di panel Alur Surat; setiap tombol mengikuti aksiDiizinkan dari server. */
export function AlurSuratActions({ detail, onChanged }) {
    const { toast } = useToast()
    const [dialog, setDialog] = useState(null)
    if (!detail?.rangkaian) return null
    const r = detail.rangkaian
    const aksi = new Set(detail.aksiDiizinkan || [])
    const tutup = (value) => { if (!value) setDialog(null) }
    const berhasil = (pesan) => { toast({ title: 'Berhasil', description: pesan }); onChanged?.() }
    return (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Aksi rangkaian">
            {aksi.has('tandai_selesai') && <Button size="sm" variant="outline" onClick={() => setDialog('selesai')}>Tandai Selesai</Button>}
            {aksi.has('buka_kembali') && <Button size="sm" variant="outline" onClick={() => setDialog('buka')}>Buka Kembali</Button>}
            {aksi.has('berkaskan') && <Button size="sm" onClick={() => setDialog('berkaskan')}>Berkaskan ke Direktorat (Unit Pengolah)</Button>}
            {aksi.has('gabung') && <Button size="sm" variant="outline" onClick={() => setDialog('gabung')}>Gabungkan Rangkaian</Button>}
            <AlasanDialog open={dialog === 'selesai'} onOpenChange={tutup} title="Tandai Selesai" label="Catatan penyelesaian"
                description="Menandai rangkaian selesai secara manual. Tidak boleh ada disposisi terbuka atau surat keluar draft."
                onSubmit={async (catatan) => { await rangkaianService.tandaiSelesai(r.id, catatan); berhasil('Rangkaian ditandai selesai') }} />
            <AlasanDialog open={dialog === 'buka'} onOpenChange={tutup} title="Buka Kembali Rangkaian"
                onSubmit={async (alasan) => { await rangkaianService.bukaKembali(r.id, alasan); berhasil('Rangkaian dibuka kembali') }} />
            {dialog === 'berkaskan' && (
                <BerkaskanDialog open onOpenChange={tutup} rangkaian={r} onBerhasil={() => berhasil(`Rangkaian ${r.kode} diberkaskan`)} />
            )}
            {dialog === 'gabung' && (
                <GabungDialog open onOpenChange={tutup} target={r} onBerhasil={() => berhasil('Rangkaian digabungkan')} />
            )}
        </div>
    )
}

function GabungDialog({ open, onOpenChange, target, onBerhasil }) {
    const [term, setTerm] = useState('')
    const [sumber, setSumber] = useState(null)
    const [pratinjau, setPratinjau] = useState(null)
    const [alasan, setAlasan] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const { data } = useLacakSearch(term, { mode: 'lacak', enabled: open && !sumber })
    const pilihan = (data?.kelompok || []).filter((k) => k.rangkaian && k.rangkaian.id !== target.id && ['aktif', 'selesai'].includes(k.rangkaian.status))
    const pilih = async (rangkaian) => {
        setSumber(rangkaian)
        setPratinjau(await rangkaianService.pratinjauGabung(target.id, rangkaian.id).catch(() => null))
    }
    const gabung = async () => {
        setLoading(true)
        setError(null)
        try {
            await rangkaianService.gabung(target.id, { sumberId: sumber.id, alasan: alasan.trim() })
            onOpenChange(false)
            onBerhasil?.()
        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Gagal menggabungkan')
        } finally {
            setLoading(false)
        }
    }
    const unitBaru = [...(pratinjau?.unitBaruDiTarget || []), ...(pratinjau?.unitBaruDiSumber || [])]
    return (
        <Dialog open={open} onOpenChange={(value) => !loading && onOpenChange(value)}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Gabungkan Rangkaian ke {target.kode}</DialogTitle>
                    <DialogDescription>Rangkaian sumber beserta disposisinya dipindahkan ke rangkaian ini. Tindakan ini diaudit.</DialogDescription>
                </DialogHeader>
                {!sumber ? (
                    <div className="space-y-2">
                        <Label htmlFor="cari-rangkaian-sumber">Cari rangkaian sumber</Label>
                        <Input id="cari-rangkaian-sumber" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Nomor atau perihal surat (min. 3 karakter)" />
                        <ul className="space-y-1">
                            {pilihan.map((k) => (
                                <li key={k.kunci}>
                                    <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => pilih(k.rangkaian)}>
                                        {k.rangkaian.kode} · {k.rangkaian.judul}
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : (
                    <div className="space-y-3 text-sm">
                        <p>Sumber: <strong>{sumber.kode}</strong></p>
                        <p>Unit yang mendapat akses baru: {unitBaru.length > 0 ? unitBaru.join(', ') : 'tidak ada'}</p>
                        <Label htmlFor="alasan-gabung">Alasan</Label>
                        <Textarea id="alasan-gabung" value={alasan} onChange={(event) => setAlasan(event.target.value)} rows={3} />
                        {error && <p role="alert" className="text-destructive">{error}</p>}
                    </div>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Batal</Button>
                    <Button onClick={gabung} disabled={!sumber || alasan.trim().length < 10 || loading}>Gabungkan</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export function TutupDisposisiButton({ distribusi, onChanged }) {
    const [open, setOpen] = useState(false)
    return (
        <>
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Tutup Disposisi</Button>
            <AlasanDialog open={open} onOpenChange={setOpen} title="Tutup Disposisi" submitLabel="Tutup Disposisi" destructive
                description="Menutup disposisi yang tidak dapat diproses unit tujuan agar rangkaian tidak macet."
                onSubmit={async (alasan) => { await rangkaianService.tutupDisposisi(distribusi.id, alasan); onChanged?.() }} />
        </>
    )
}

export function AjukanAksesButton({ anggotaId, onChanged }) {
    const [open, setOpen] = useState(false)
    return (
        <>
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Ajukan Akses</Button>
            <AlasanDialog open={open} onOpenChange={setOpen} title="Ajukan Akses" label="Tujuan akses" minLength={20} submitLabel="Ajukan"
                description="Permohonan akses baca akan ditinjau super admin."
                onSubmit={async (purpose) => { await rangkaianService.ajukanAkses(anggotaId, purpose); onChanged?.() }} />
        </>
    )
}

export function BatalRelasiButton({ relasi, onChanged }) {
    const [open, setOpen] = useState(false)
    return (
        <>
            <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Batalkan Relasi</Button>
            <AlasanDialog open={open} onOpenChange={setOpen} title="Batalkan Relasi" submitLabel="Batalkan" destructive
                onSubmit={async (alasan) => { await rangkaianService.batalRelasi(relasi.id, alasan); onChanged?.() }} />
        </>
    )
}

/** Tautkan ke Rangkaian (§2b.3) dari detail surat: target boleh surat tunggal maupun anggota rangkaian. */
export function TautkanDialog({ open, onOpenChange, jenis, surat, onBerhasil }) {
    const [tujuan, setTujuan] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const simpan = async () => {
        setLoading(true)
        setError(null)
        try {
            await rangkaianService.tautkanKeSurat({ jenis, suratId: surat.id, keJenis: tujuan.jenis, keSuratId: tujuan.suratId, jenisRelasi: tujuan.jenisRelasi })
            onOpenChange(false)
            onBerhasil?.()
        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Gagal menautkan')
        } finally {
            setLoading(false)
        }
    }
    return (
        <Dialog open={open} onOpenChange={(value) => !loading && onOpenChange(value)}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Tautkan ke Rangkaian</DialogTitle>
                    <DialogDescription>Pilih surat yang dirujuk surat ini.</DialogDescription>
                </DialogHeader>
                <ReferensiSection referensi={tujuan} onPilih={setTujuan} onHapus={() => setTujuan(null)}
                    onUbahRelasi={(jenisRelasi) => setTujuan((prev) => (prev ? { ...prev, jenisRelasi } : prev))} label="Surat tujuan" />
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Batal</Button>
                    <Button onClick={simpan} disabled={!tujuan || loading}>Tautkan</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
```

Catatan untuk test "Tutup Disposisi": `AlasanDialog` memakai label default `Alasan`, sehingga `getByLabelText('Alasan')` mengenai textarea.

- [ ] **Step 4: Sisipkan ke panel P2 dan halaman detail**

Di `frontend/src/components/surat/AlurSuratPanel.jsx` (P2):
1. Impor `import { AlurSuratActions, AjukanAksesButton, BatalRelasiButton, TutupDisposisiButton } from './AlurSuratActions'`.
2. Tepat setelah blok ringkasan (kode RS, status, pencatat → pengolah), render `<AlurSuratActions detail={detail} onChanged={muatUlang} />` — `detail` adalah respons `rangkaianService.getBySurat/getById` yang disimpan panel dan `muatUlang` adalah fungsi pemuat ulang panel (bila P2 menamainya lain, pakai nama itu).
3. Pada tiap baris tabel "Status Tindak Lanjut per penerima" berstatus `sent`/`received`, render `{detail.aksiDiizinkan?.includes('tutup_disposisi') && <TutupDisposisiButton distribusi={baris} onChanged={muatUlang} />}` di kolom aksi.
4. Pada node linimasa yang `masked`, render `{node.dapatAjukanAkses && <AjukanAksesButton anggotaId={node.anggotaId} onChanged={muatUlang} />}`; pada item relasi aktif (`detail.relasi`) render `{detail.aksiDiizinkan?.includes('batal_relasi') && <BatalRelasiButton relasi={relasi} onChanged={muatUlang} />}` (pembuat relasi non-pengawas tetap dapat membatalkan lewat API; `RelasiRangkaian` P2 tidak memuat `createdBy`, sehingga tombol hanya ditawarkan kepada pengawas).

Di `SuratMasukDetail.jsx`: impor `TautkanDialog`, state `const [tautkanOpen, setTautkanOpen] = useState(false)`, teruskan `onTautkan={() => setTautkanOpen(true)}` ke `DetailHeader`, dan render `<TautkanDialog open={tautkanOpen} onOpenChange={setTautkanOpen} jenis="surat_masuk" surat={surat} onBerhasil={fetchSurat} />`. Lakukan hal yang sama di `SuratKeluarDetail.jsx` dengan `jenis="surat_keluar"` dan prop `onTautkan` pada `TindakLanjutMenu` (pemuat ulang di halaman itu bernama `fetchSurat` atau fungsi pemuat yang ada).

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `cd frontend && npx vitest run src/components/surat src/pages/SuratKeluarDetail.rules.test.jsx src/pages/surat-archive-dialog.test.jsx && npx vitest run`
Expected: PASS untuk semua test frontend.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/surat/AlasanDialog.jsx frontend/src/components/surat/BerkaskanDialog.jsx frontend/src/components/surat/AlurSuratActions.jsx frontend/src/components/surat/AlurSuratActions.test.jsx frontend/src/components/surat/AlurSuratPanel.jsx frontend/src/pages/SuratMasukDetail.jsx frontend/src/pages/SuratKeluarDetail.jsx
git commit -m "feat(frontend): aksi panel Alur Surat (selesai, berkaskan dua langkah, gabung, tutup, ajukan akses, tautkan)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


#### Amandemen pra-eksekusi Task 25 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


**Files: add**
- Modify `frontend/src/components/surat/TimelineItem.jsx` (optional `aksi` slot).
- Modify `frontend/src/pages/AuditLog.jsx:18-37`.
- Test: `frontend/src/components/surat/__tests__/AlurSuratActions.test.jsx`, not `components/surat/AlurSuratActions.test.jsx` [G-STACK]. `frontend/src/pages/AuditLog.labels.test.jsx`.

**Step 4: replace** the four "sisipkan" instructions (plan:9026-9032) with the following. The real P2 panel keeps its loader as an inner `muat()` inside `useEffect` (`AlurSuratPanel.jsx:51-67`), names the data `d` (`:95`), has a 5-column table (`:143-150`), and its masked mapping drops ids (`:31`). [T25-1]

1. **Reload key.** `export function AlurSuratPanel({ jenis, suratId, aksesMelalui = 'owner', fallback = null, onChanged })`. Add `const [muatKe, setMuatKe] = useState(0)` and include `muatKe` in the effect deps: `[jenis, suratId, muatKe]`. Define `const muatUlang = () => { setMuatKe((n) => n + 1); onChanged?.() }`.
2. **Actions.** After the summary row (`<div className="flex flex-wrap items-center gap-2 text-sm">…</div>`, `:122-125`), render `<AlurSuratActions detail={d} onChanged={muatUlang} />`.
3. **Disposisi table.** When `d.aksiDiizinkan?.includes('tutup_disposisi')`, append `<th className="py-1 font-medium">Aksi</th>` to the header, and to each row `<td className="py-2">{(row.status === 'sent' || row.status === 'received') && <TutupDisposisiButton distribusi={row} onChanged={muatUlang} />}</td>`.
4. **Masked nodes.** In `keItemLinimasa`, the masked branch returns `{ type, masked: true, unitNama: node.unitNama, anggotaId: node.anggotaId, dapatAjukanAkses: node.dapatAjukanAkses === true }`.
   - `TimelineItem` gets an optional `aksi` prop (a React node), rendered at the end of the item. `pages/DosirDetail.jsx` does not pass it, so there is no visual change there.
   - The panel passes `aksi={item.masked && item.dapatAjukanAkses ? <AjukanAksesButton anggotaId={item.anggotaId} onChanged={muatUlang} /> : batalUntuk(item)}`.
5. **Batal relasi.** Define `batalUntuk(item)`. It returns, for each active relasi in `relasiDari.get(item.anggotaId)`, a `<BatalRelasiButton relasi={relasi} onChanged={muatUlang} />`, but only when `d.aksiDiizinkan?.includes('batal_relasi')`.
6. **Existing tests.** `components/surat/__tests__/AlurSuratPanel.test.jsx` and `TimelineItem.test.jsx` must stay green. Add a test: after an action calls `onChanged`, `rangkaianService.getBySurat` is called a second time.

**Banner** (`AlurSuratPanel.jsx:109-119`). Show the read-only wording only when `(d.aksiDiizinkan ?? []).length === 0`. Otherwise:
- for `aksesMelalui === 'pengawas'`: "Anda melihat surat ini sebagai unit pengawas.";
- otherwise: `Dilihat melalui rangkaian ${r.kode} sebagai ${AKSES_LABEL[aksesMelalui] ?? 'peserta rangkaian'}.`

[T25-2]

**Labels in dialogs** [T25-3]:
- `BerkaskanDialog` shows `klasifikasiInduk ? \`${klasifikasiInduk.kode} – ${klasifikasiInduk.jenis}\` : '-'` (the Task 14 payload) instead of `Klasifikasi induk #${id}` (plan:8756).
- `GabungDialog` maps unit ids to names via `new Map(d.peserta.map(p => [p.unitKerjaId, p.nama]))`, falling back to the id.

**Audit labels** [T25-4]. In `frontend/src/pages/AuditLog.jsx`:
- **`ACTION_CONFIG`:** add `merge` (label 'Menggabungkan', icon `GitMerge` or `RefreshCw`), `link` ('Menautkan', `Link`), `cancel` ('Membatalkan', `X`), `distribute` ('Mendisposisikan', `Send`), `receive_distribution` ('Menerima Disposisi'), `process_distribution` ('Menyelesaikan Disposisi') and `reject_distribution` ('Menolak Disposisi'). Use the color pattern of the existing entries and import the icons from `lucide-react`.
- **`ENTITY_CONFIG`:** add `rangkaian_relasi` ('Relasi Rangkaian') and `surat_distribution` ('Disposisi').
- **Test:** each new code renders its label.

**Ubah Unit Pengolah** [T25-5]. In `AlurSuratActions`, when `d.aksiDiizinkan.includes('ubah_unit_pengolah')`, render the button "Ubah Unit Pengolah". It opens a dialog that:
1. loads `rangkaianService.opsiBerkas(r.id)`;
2. lists `unitDalamJangkauan` as radios (pre-selecting the current pengolah);
3. shows "Unit pengolah menentukan retensi berkas";
4. on confirm calls `rangkaianService.ubahUnitPengolah(r.id, unitId)`, then `onChanged()`.

Add a test: the button is visible only with the aksi, and confirming calls the service.

**Step 5: add** `cd frontend && npx eslint src/components/surat src/pages/AuditLog.jsx && npx vitest run src/components/surat src/pages/AuditLog.labels.test.jsx …` (then the full run as planned).

---


**C-7 (critic) — Tasks 11, 16, 25: one predicate for Tutup Disposisi [C-7]**


The amendments anchor Tutup Disposisi on different units:
- T11-1 (amend:567-568) authorizes on the **SM** unit.
- T16-4 (amend:926, 933) offers `tutup_disposisi` from the **rangkaian** tier, which is `dalamCakupanPengawas(unitPencatatId)` (`rangkaian-read.service.ts:290-292`).

After gabung or tautan, an SM from an out-of-scope unit can sit in a rangkaian whose pencatat is in scope, or the reverse. The button then either returns 403, or is hidden while the server would allow the action.

Required changes:
- **Server (T11):** keep the predicate `pengawasUntukUnit(actor, sm.unit_kerja_id)`.
- **404/403 split (F1).** When the predicate is false:
  - return 404 if the actor is neither source nor target and `checkRead(actor,'surat_masuk',sm.id).allowed` is false;
  - otherwise return 403.
- **Offer (T16-4).** Offer `tutup_disposisi` only when `(super_admin || (isFullAdmin && isPengawas))` holds **and** an open disposisi in the rangkaian has its SM unit in scope:

  ```sql
  EXISTS (SELECT 1 FROM surat_distributions d JOIN surat_masuk sm ON sm.id = d.surat_masuk_id
          WHERE d.rangkaian_id = R AND d.status IN ('sent','received') AND <dalamCakupanPengawasSql(sm.unit_kerja_id)>)
  ```

  - `dalamCakupanPengawasSql` is at `visibility-spec.ts:265`; re-export it via deps.
  - For super_admin, drop the scope clause.
- **T25:** keep the per-row button. The server stays authoritative per row.


**Ruling kontroler [CTRL-1] (menimpa G-SA untuk Tutup Disposisi):** Tutup Disposisi hanya untuk admin pengawas sesuai spec:478 (spec mengikat). `super_admin` TIDAK otomatis boleh Tutup Disposisi; ia hanya boleh bila juga memenuhi aturan pengawas biasa (role FULL_ADMIN + unit efektif `is_unit_pengawas` + `dalamCakupanPengawas`). Untuk aksi lain, G-SA (super_admin ⊇ pengawas) tetap berlaku. Konsekuensi: `tutupOlehPengawas` dan `computeRangkaianAksi`/`tutup_disposisi` memakai predikat pengawas tanpa jalan pintas super_admin; butir G-SA di C-12 (gerbang rilis) tidak lagi diperlukan untuk Tutup.



## H. Pengaturan Unit Pengawas

### Task 26: Toggle super_admin `unit_kerja.is_unit_pengawas` (backend + Settings UI "Unit Pengawas (pencatat terpusat)")

> Ditambahkan pada tinjauan konsistensi lintas fase (2026-09-26). Spec §4.2 butir 377 ("hanya super_admin yang bisa mengubahnya lewat `PUT /api/settings/unit-kerja/:id`, diaudit") dan §7 ("Pengaturan Unit Kerja mendapat toggle **Unit Pengawas (pencatat terpusat)**") sebelumnya tidak dimiliki fase mana pun: P1 hanya menambah kolom dan menandai `ditjen`/`sesditjen` di 0046, P2 hanya membacanya. Task ini independen dari Task 1–25 dan boleh dikerjakan kapan saja setelah Task 1.

**Files:**
- Modify: `backend/src/services/settings.service.ts` (`UnitKerjaUpdateData`, `updateUnitKerja`)
- Modify: `backend/src/routes/settings.routes.ts` (handler `router.put('/unit-kerja/:id', ...)`)
- Modify: `frontend/src/pages/Settings.jsx` (state `unitKerjaForm`, `handleSelectUnitKerja`, kartu **Detail Unit Kerja**, badge daftar unit)
- Test: `backend/src/__tests__/settings.service.test.ts` (tambah `describe`), `backend/src/__tests__/settings-unit-pengawas.routes.test.ts` (baru), `frontend/src/pages/Settings.unit-pengawas.test.jsx` (baru)

**Interfaces:**
- Consumes (P1): kolom `unit_kerja.is_unit_pengawas boolean NOT NULL DEFAULT false` (0046) dan Drizzle `unitKerja.isUnitPengawas` (P1 Task 4). `GET /api/settings/unit-kerja` sudah mengembalikan semua kolom (`stripDriveConfig` hanya membuang kolom Drive), jadi `isUnitPengawas` ikut terkirim tanpa perubahan.
- Consumes (repo): `settingsService.updateUnitKerja(id, data, auditContext)` (audit `update`/`unit_kerja` dalam transaksi yang sama, `logActionOrThrow(..., tx)`); frontend `settingsService.updateUnitKerja(id, data)` → `PUT /api/settings/unit-kerja/:id` (allowlist demo sudah mencakup `PUT /settings/unit-kerja/<segmen>`).
- Produces: `PUT /api/settings/unit-kerja/:id` menerima `isUnitPengawas?: boolean` (hanya `super_admin`; nilai non-boolean → 400); audit `changes.pengawas = { before, after }` bila field dikirim; toggle Settings berlabel persis **Unit Pengawas (pencatat terpusat)**. Tidak ada role baru (D5); efeknya dibaca P2 lewat `resolveKonteksBaca` pada panggilan berikutnya (tanpa cache).

- [ ] **Step 1: Tulis test layanan dan route yang gagal**

Tambahkan di akhir `describe('SettingsService', ...)` pada `backend/src/__tests__/settings.service.test.ts`:

```ts
    describe('updateUnitKerja — Unit Pengawas (D5)', () => {
        it('menyimpan penanda unit pengawas dan mengauditnya dalam transaksi yang sama', async () => {
            enqueue(
                [{ id: 'dir_bppt', name: 'Dit. BPPT', isUnitPengawas: false }],
                [{ id: 'dir_bppt', name: 'Dit. BPPT', isUnitPengawas: true }],
            );
            const result = await settingsService.updateUnitKerja('dir_bppt', { isUnitPengawas: true }, {
                userId: '550e8400-e29b-41d4-a716-446655440010', userEmail: 'super@example.test',
            });
            expect(result).toMatchObject({ isUnitPengawas: true });
            expect(auditMocks.logActionOrThrow).toHaveBeenCalledWith(expect.objectContaining({
                action: 'update',
                entityType: 'unit_kerja',
                changes: expect.objectContaining({
                    unitKerjaId: 'dir_bppt',
                    fields: ['isUnitPengawas'],
                    pengawas: { before: false, after: true },
                }),
            }), mockDb);
            expect(transactionCommits).toBe(1);
        });

        it('tidak menambahkan jejak pengawas bila field tidak dikirim', async () => {
            enqueue(
                [{ id: 'dir_bppt', name: 'Dit. BPPT', isUnitPengawas: false }],
                [{ id: 'dir_bppt', name: 'Direktorat BPPT', isUnitPengawas: false }],
            );
            await settingsService.updateUnitKerja('dir_bppt', { name: 'Direktorat BPPT' }, { userId: 'u', userEmail: 'u@example.test' });
            const [entry] = auditMocks.logActionOrThrow.mock.calls[0];
            expect(entry.changes).not.toHaveProperty('pengawas');
        });
    });
```

```ts
// backend/src/__tests__/settings-unit-pengawas.routes.test.ts
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    update: vi.fn(),
    user: {
        id: '550e8400-e29b-41d4-a716-446655440010',
        email: 'super@example.test',
        role: 'super_admin',
        unitKerjaId: null as string | null,
    },
}));
vi.mock('../config/database', () => ({ db: {} }));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => { req.user = { ...mocks.user }; next(); },
}));
vi.mock('../services/settings.service', () => ({ settingsService: { updateUnitKerja: mocks.update } }));

const { settingsRoutes } = await import('../routes/settings.routes');
const app = express();
app.use(express.json());
app.use('/api/settings', settingsRoutes);

describe('PUT /api/settings/unit-kerja/:id — Unit Pengawas (pencatat terpusat)', () => {
    beforeEach(() => {
        mocks.update.mockReset().mockResolvedValue({ id: 'dir_bppt', isUnitPengawas: true });
        mocks.user.role = 'super_admin';
        mocks.user.unitKerjaId = null;
    });

    it('super_admin menyalakan penanda; konteks audit diteruskan ke layanan', async () => {
        const res = await request(app).put('/api/settings/unit-kerja/dir_bppt').send({ isUnitPengawas: true }).expect(200);
        expect(res.body).toMatchObject({ isUnitPengawas: true });
        expect(mocks.update).toHaveBeenCalledWith(
            'dir_bppt',
            expect.objectContaining({ isUnitPengawas: true }),
            expect.objectContaining({ userId: mocks.user.id, userEmail: mocks.user.email }),
        );
    });

    it('menolak nilai non-boolean (400) tanpa memanggil layanan', async () => {
        await request(app).put('/api/settings/unit-kerja/dir_bppt').send({ isUnitPengawas: 'true' }).expect(400);
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('admin_unit (termasuk unit pengawas) tidak dapat mengubah penanda (403)', async () => {
        mocks.user.role = 'admin_unit';
        mocks.user.unitKerjaId = 'sesditjen';
        await request(app).put('/api/settings/unit-kerja/sesditjen').send({ isUnitPengawas: false }).expect(403);
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('tanpa field isUnitPengawas, nilai tersimpan tidak disentuh', async () => {
        await request(app).put('/api/settings/unit-kerja/dir_bppt').send({ name: 'Dit. BPPT' }).expect(200);
        expect(mocks.update.mock.calls[0][1].isUnitPengawas).toBeUndefined();
    });
});
```

- [ ] **Step 2: Jalankan test backend, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/settings.service.test.ts src/__tests__/settings-unit-pengawas.routes.test.ts`
Expected: FAIL — `changes.pengawas` tidak ada; route meneruskan objek tanpa `isUnitPengawas` dan nilai `'true'` diterima (200, bukan 400).

- [ ] **Step 3: Implementasi backend**

Di `backend/src/services/settings.service.ts`, perluas tipe dan audit:

```ts
export interface UnitKerjaUpdateData {
    name?: string;
    description?: string;
    canReceiveDistribution?: boolean;
    /** D5: hanya super_admin (route); menentukan unit pengawas rangkaian. */
    isUnitPengawas?: boolean;
}
```

Ganti blok audit di `updateUnitKerja` menjadi:

```ts
        if (updated && auditContext) {
            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: 'update',
                entityType: 'unit_kerja',
                changes: {
                    unitKerjaId,
                    before,
                    after: updated,
                    fields: Object.keys(data).filter((key) => data[key as keyof UnitKerjaUpdateData] !== undefined),
                    ...(data.isUnitPengawas !== undefined
                        ? { pengawas: { before: before.isUnitPengawas, after: updated.isUnitPengawas } }
                        : {}),
                },
            }, tx);
        }
```

Di `backend/src/routes/settings.routes.ts`, pada handler `router.put('/unit-kerja/:id', ...)`, ganti destrukturisasi body dan panggilan layanan menjadi:

```ts
        const { name, description, canReceiveDistribution, isUnitPengawas } = req.body;
        if (isUnitPengawas !== undefined && typeof isUnitPengawas !== 'boolean') {
            res.status(400).json({ error: 'isUnitPengawas harus bernilai boolean' });
            return;
        }

        const updated = await settingsService.updateUnitKerja(id as string, {
            name,
            description,
            canReceiveDistribution,
            isUnitPengawas,
        }, {
            userId: user?.id, userEmail: user?.email, ipAddress: req.ip,
        });
```

(Pemeriksaan `userRole !== 'super_admin'` → 403 yang sudah ada tetap di atasnya; tidak ada role baru.)

- [ ] **Step 4: Jalankan test backend, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/settings.service.test.ts src/__tests__/settings-unit-pengawas.routes.test.ts src/__tests__/demo-access.middleware.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS; `tsc` bersih.

- [ ] **Step 5: Tulis test UI yang gagal**

```jsx
// frontend/src/pages/Settings.unit-pengawas.test.jsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings'

const mocks = vi.hoisted(() => ({
    getAll: vi.fn(), update: vi.fn(), toast: vi.fn(), setTheme: vi.fn(),
    getTemplates: vi.fn(), getPreferences: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'sa', role: 'super_admin', name: 'Super', email: 'sa@example.test' }, canWrite: () => true }),
}))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/context/theme-context', () => ({ useTheme: () => ({ setTheme: mocks.setTheme }) }))
vi.mock('@/hooks/use-required-unit-kerja-scope', () => ({ useRequiredUnitKerjaScope: () => ({ unitKerjaId: 'sesditjen' }) }))
vi.mock('@/components/RequiredUnitKerjaScope', () => ({ RequiredUnitKerjaScope: () => null }))
vi.mock('@/services/settings.service', () => ({
    settingsService: {
        getAllUnitKerja: mocks.getAll,
        updateUnitKerja: mocks.update,
        getSuratTemplates: mocks.getTemplates,
        getPreferences: mocks.getPreferences,
    },
}))

const bukaTabUnitKerja = () =>
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Unit Kerja' }), { button: 0, ctrlKey: false })

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAll.mockResolvedValue([
        { id: 'sesditjen', name: 'Sekretariat Direktorat Jenderal', unitType: 'sekretariat', isUnitPengawas: true },
        { id: 'dir_bppt', name: 'Dit. BPPT', unitType: 'direktorat', isUnitPengawas: false },
    ])
    mocks.update.mockResolvedValue({})
    mocks.getTemplates.mockResolvedValue({ masukFormat: '{noUrut}/SM/{tahun}', keluarFormat: '{noUrut}/{naskahDinas}/{bulan}/{tahun}' })
    mocks.getPreferences.mockResolvedValue({ theme: 'light', language: 'id', notificationsEnabled: true, emailNotifications: false })
})

describe('Pengaturan Unit Kerja — Unit Pengawas (pencatat terpusat)', () => {
    it('memuat status pengawas unit yang sudah ditandai', async () => {
        render(<Settings />)
        bukaTabUnitKerja()
        fireEvent.click(await screen.findByRole('button', { name: /Sekretariat Direktorat Jenderal/ }))
        expect(screen.getByRole('switch', { name: 'Unit Pengawas (pencatat terpusat)' })).toHaveAttribute('aria-checked', 'true')
    })

    it('menyalakan toggle lalu mengirim isUnitPengawas saat disimpan', async () => {
        render(<Settings />)
        bukaTabUnitKerja()
        fireEvent.click(await screen.findByRole('button', { name: /Dit\. BPPT/ }))
        const toggle = screen.getByRole('switch', { name: 'Unit Pengawas (pencatat terpusat)' })
        expect(toggle).toHaveAttribute('aria-checked', 'false')
        fireEvent.click(toggle)
        expect(toggle).toHaveAttribute('aria-checked', 'true')
        fireEvent.click(screen.getByRole('button', { name: /Simpan Perubahan/ }))
        await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('dir_bppt', expect.objectContaining({ isUnitPengawas: true })))
    })
})
```

- [ ] **Step 6: Jalankan test UI, pastikan gagal**

Run: `cd frontend && npx vitest run src/pages/Settings.unit-pengawas.test.jsx`
Expected: FAIL — `Unable to find an accessible element with the role "switch" and name "Unit Pengawas (pencatat terpusat)"`.

- [ ] **Step 7: Implementasi UI di `frontend/src/pages/Settings.jsx`**

State awal form unit kerja:

```jsx
    const [unitKerjaForm, setUnitKerjaForm] = useState({
        name: '',
        description: '',
        isUnitPengawas: false,
    });
```

`handleSelectUnitKerja`:

```jsx
    const handleSelectUnitKerja = (unit) => {
        setSelectedUnitKerja(unit);
        setUnitKerjaForm({
            name: unit.name || '',
            description: unit.description || '',
            isUnitPengawas: unit.isUnitPengawas === true,
        });
    };
```

Di kartu **Detail Unit Kerja**, sisipkan tepat setelah blok `Deskripsi` (sebelum `<div className="flex justify-end pt-2">`):

```jsx
                                            <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
                                                <div>
                                                    <p className="font-medium text-foreground">Unit Pengawas (pencatat terpusat)</p>
                                                    <p className="text-sm text-muted-foreground">
                                                        Admin unit ini dapat membaca rangkaian surat Ditjen, Sesditjen, dan seluruh direktorat
                                                        (node terkendali tetap disamarkan tanpa izin akses). Perubahan dicatat di audit log.
                                                    </p>
                                                </div>
                                                <Switch
                                                    checked={unitKerjaForm.isUnitPengawas}
                                                    onCheckedChange={(checked) => setUnitKerjaForm(current => ({ ...current, isUnitPengawas: checked }))}
                                                    aria-label="Unit Pengawas (pencatat terpusat)"
                                                />
                                            </div>
```

Di daftar unit (tombol per unit), tambahkan penanda sebelum badge `unit.unitType`:

```jsx
                                                    {unit.isUnitPengawas && (
                                                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 h-auto">Pengawas</Badge>
                                                    )}
```

`handleSaveUnitKerja` sudah mengirim seluruh `unitKerjaForm`, sehingga `isUnitPengawas` ikut terkirim tanpa perubahan lain.

- [ ] **Step 8: Jalankan test UI dan lint, pastikan lulus**

Run: `cd frontend && npx vitest run src/pages/Settings.unit-pengawas.test.jsx src/services/integration-contracts.test.js && npx eslint src/pages/Settings.jsx src/pages/Settings.unit-pengawas.test.jsx`
Expected: PASS (2 test baru + kontrak lama) dan ESLint bersih.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/settings.service.ts backend/src/routes/settings.routes.ts backend/src/__tests__/settings.service.test.ts backend/src/__tests__/settings-unit-pengawas.routes.test.ts frontend/src/pages/Settings.jsx frontend/src/pages/Settings.unit-pengawas.test.jsx
git commit -m "feat(unit-kerja): toggle Unit Pengawas (pencatat terpusat) khusus super_admin dengan audit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


#### Amandemen pra-eksekusi Task 26 (kontroler)

> Mengikat. Disusun kontroler dari pemindaian pra-eksekusi terhadap kode P1/P2 yang nyata (2026-09-27). Bila bertentangan dengan teks rencana di atas, amandemen ini yang berlaku; spec tetap otoritas tertinggi. Ruling lengkap: `.superpowers/sdd/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif/preflight-rulings.md`.


**Backend (`settings.service.ts` `updateUnitKerja`, plan:9196-9205).** Replace the condition `...(data.isUnitPengawas !== undefined ? { pengawas: … } : {})` with `...(data.isUnitPengawas !== undefined && before.isUnitPengawas !== updated.isUnitPengawas ? { pengawas: { before: before.isUnitPengawas, after: updated.isUnitPengawas } } : {})`. [T26-1]

**Frontend (`Settings.jsx` `handleSaveUnitKerja`, `:144-148`).** Build the payload without an unchanged `isUnitPengawas`:

```jsx
const { isUnitPengawas, ...lain } = unitKerjaForm
const payload = isUnitPengawas !== selectedUnitKerja.isUnitPengawas ? { ...lain, isUnitPengawas } : lain
await settingsService.updateUnitKerja(selectedUnitKerja.id, payload)
```

**Tests: add**
- `settings.service.test.ts`: saving with the same `isUnitPengawas` writes no `changes.pengawas`.
- `Settings.unit-pengawas.test.jsx`: renaming a unit without toggling sends no `isUnitPengawas`.

---



## Self-Review

**1. Cakupan spec (§10 baris P3 dan rujukannya)**

| Butir spec | Task |
|---|---|
| Backfill langkah 1 tanpa gerbang; `rangkaian_id IS NULL = 0`; disposisi pra-deploy dapat dibuka penerima (§3, §10) | 2 |
| Semua jalur `distribute()` lewat `ensureForSuratMasuk`, termasuk `POST /api/distributions` (§3, §5) | 7 |
| Backend `/lacak` 3 mode, `lacakLimiter`, `escapeLike`, `normalizeNomor`, `nomorNormSql` (§6) | 3, 4 |
| `createSuratMasukSchema.disposisi/referensi`, `createSuratKeluarSchema.asalNaskah/tindakLanjut`, `processDistributionSchema`, `status` dihapus dari update (§5) | 5 |
| `MULTILINE_FIELDS` (§5) | 5 |
| Disposisi multi-target + batas waktu + penanggung jawab + label kompatibilitas; D6 bagian ditolak (§2a, §2c, §3) | 5, 7, 22, 24 |
| Surat terkendali §4.12 (409 saat flag mati; grant 'disposisi' saat menyala, dicabut di process/reject/tutup) | 6, 7, 10, 11 |
| Ajukan Akses `requestViaRangkaian` + re-check persetujuan dengan predikat yang sama + matriks (§4.11) | 6, 25 |
| Tindak lanjut surat keluar: wewenang, `checkRead`, terima implisit, `balasan_untuk` same-unit (§5) | 8 |
| ND Penjelas (relasi `menjelaskan`) (§2b) | 8, 19, 20 |
| Registrasi surat masuk: disposisi + Nomor Referensi; rangkaian selesai dibuka kembali; lanjutan bila diberkaskan (§2a, §2d) | 9, 24 |
| Kotak disposisi bertopeng, terima eksplisit, penyelesaian dengan `checkRead` dan validasi SK (§5, §7) | 10, 23 |
| Tutup Disposisi pengawas (§2c, §5) | 11, 25 |
| Status turunan monoton + audit; hook approve/reject/update/delete (§8) | 12 (hook di 8) |
| Guard update/delete surat masuk anggota (§5, §9) | 13 |
| Tandai Selesai/Buka Kembali/Berkaskan (dua langkah, unit dalam jangkauan, 422)/Ubah Unit Pengolah (§5, §9); `GET /api/rangkaian` Daftar Berkas Rangkaian dimiliki P4 | 14, 25 |
| Tautan (termasuk induk 1-anggota = gabung), Gabung (pemindahan distribusi, anti-siklus), Batal Relasi (§3, §5) | 15, 25 |
| `aksiDiizinkan[]`, `statusAlur`, tombol edit/hapus/arsip disembunyikan bila bukan pemilik (§7, §8) | 16, 19 |
| Skenario a–e + race auto-selesai di Postgres (§11) | 17 |
| TindakLanjutMenu, split button & route inisiatif, badge, quick action Dashboard (§7) | 19, 20, 21 |
| Allowlist demo untuk semua path baru (§5) | 4, 6, 7, 11, 14, 15 |
| Toggle super_admin `unit_kerja.is_unit_pengawas` via `PUT /api/settings/unit-kerja/:id` (diaudit) + toggle Settings "Unit Pengawas (pencatat terpusat)" (§4.2 butir 377, §7) | 26 |

Sengaja **di luar** P3 (sesuai §10): perubahan `notification.service.ts` (urgensi batas waktu → P5; blok pending otomatis memakai status tersimpan yang kini diturunkan), Koreksi Berkas & tutup massal data lama (P5), UI Lacak/tab Berkas Rangkaian/GlobalSearch (P4), `InfoSection` & normalisasi SQL inbox (P0), `checkRead`/`checkMany`/`visibleSql`/AlurSuratPanel read-only (P2).

**2. Pemindaian placeholder.** Tidak ada "TBD/TODO/implement later". Tiga titik integrasi dengan kode P2 yang belum ada (handler GET detail di Task 16, `AlurSuratPanel` di Task 25, route `rangkaian.routes.ts`) dijelaskan dengan kode yang harus disisipkan dan jangkar yang jelas; perbedaan nama P1/P2 hanya disesuaikan di `deps.ts` (Task 1), dikunci test kontrak.

**3. Konsistensi tipe/nama.** Diperiksa silang: `recomputeRangkaian`/`recomputeSuratMasuk`/`recomputeForSuratKeluar` (deps, Task 1 → isi Task 12); `lockRangkaian` mengembalikan `unitPencatatId/unitPengolahId/kode/status` (dipakai Task 7, 8, 14, 15); `distributionService.process(id, unitScope, audit, penyelesaian, actor)` (backend) vs `distributionService.process(id, unitKerjaId, penyelesaian)` (frontend); `SURAT_TERKENDALI_DISPOSISI_MESSAGE` = `PESAN_TERKENDALI` (teks identik); `suratAksiPayload` → `{ aksiDiizinkan, statusAlur, distribusiUnitSaya, rangkaian }` dipakai `buildTindakLanjutState`; `afterSuratKeluarInsert/afterSuratKeluarChanged/afterSuratMasukInsert/guardSuratMasukMutation/afterSuratMasukMutation` di satu modul hook yang di-mock di test layanan; `rangkaianService.tautkanKeSurat` ↔ `POST /api/rangkaian/tautan` ↔ `rangkaianLinkService.tautanKeSurat`.

**4. Review Focus.** Kelima butir punya test di task pemiliknya (Task 3/4/5/7/8/10). Kondisi lain yang implisit dan sudah tercakup test: surat masuk/keluar terhapus tidak memblokir selesai (Task 12), GET detail tidak mengubah status disposisi (Task 16, 17a), non-peserta mendapat 404 alih-alih 403 (Task 8, 14), siklus gabung (Task 15), lock order rangkaian→distribusi untuk mencegah deadlock (Task 10, 17 race).

**Resolusi ambiguitas spec yang dipakai rencana ini**

1. `createSuratMasukSchema.disposisi` menerima **dua bentuk**: objek routing `{ targets, instruksi, labelTambahan }` (P3) atau label lama string/array (impor & klien lama). Label Kabag dikirim sebagai `labelTambahan` (D6).
2. `normalizeNomor`/`nomorNormSql` dipakai apa adanya dari P1 (P1 sudah membuang non-`[0-9A-Za-z]` lalu lowercase); P3 hanya menambah `escapeLike`, `LIKE_ESCAPE`, `classifyLacakQuery` ke modul yang sama.
3. Mode nomor tetap menilai perihal/pihak (`GREATEST`) sehingga kueri "SK 12 penetapan" tidak kehilangan kecocokan perihal; mode `cek` hanya skor 100/90.
4. Aturan auto-selesai ditambah syarat "tidak ada surat masuk anggota yang belum ditangani" (belum ada disposisi processed dan belum ada balasan/tindak lanjut approved), agar "selesai kembali aktif" pada §2d benar-benar bertahan. `ditutup_pengawas` menutup rangkaian tetapi bukan bukti `sudah_dibalas`.
5. Grant disposisi (§4.12a) dibuat **per admin aktif unit target** (grant bersifat per pengguna), bertanda `purpose` berawalan `[disposisi:<id>]` agar dapat dicabut presisi; pending → `denied`, approved → `revoked`.
6. `buka-kembali` mewajibkan alasan ≥10 (spec hanya menulis `{alasan}`), konsisten dengan aturan alasan lain.
7. Tautan ke surat tunggal (§2b.3) memerlukan endpoint tambahan `POST /api/rangkaian/tautan` (memastikan rangkaian tujuan dulu); `POST /:id/tautan` tetap ada.
8. `GET /api/rangkaian` (Daftar Berkas Rangkaian) beserta `daftarRangkaianQuerySchema` dimiliki P4 (backend + UI); P3 tidak membuatnya. Bentuk respons `/api/rangkaian/lacak` mengikuti kontrak P4 yang dibekukan (`LacakResult`/`LacakKelompok`/`LacakNode`, kunci `uuid` atau `surat:<uuid>`).
9. Penyelesaian dari detail surat menavigasi ke `/distribusi?penyelesaian=<id>` (satu dialog penyelesaian di Kotak Disposisi); "Tindak Lanjut Surat Masuk…" di split button membuka form dengan picker Nomor Referensi terbuka (`?pilih=referensi`).
10. "Tandai Selesai" dan "Berkaskan" adalah aksi tingkat rangkaian (panel Alur Surat), bukan item menu surat, sehingga direktorat yang melihat surat Ditjen hanya mendapat Saya Balas, Buat Nota Dinas, Terima, dan Penyelesaian (§7).
11. Pengawas = FULL_ADMIN + unit efektif `is_unit_pengawas` (D5) dipakai di tindak lanjut, tutup disposisi, gabung, berkaskan, eligibility grant — lewat satu fungsi `isPengawas` di `deps.ts` (berbasis `resolveKonteksBaca` P2).
12. Penggabungan/penautan memakai primitif P1 `attach`/`gabung` (termasuk audit `'link'`/`'merge'` milik P1); P3 hanya menambah aturan wewenang, anti-siklus, dan pemindahan distribusi. Judul rangkaian hasil backfill mengikuti `judulRangkaian` P1.
13. Aturan status turunan P3 **memperluas** `rangkaian-status.ts` P1 (fakta `suratMasukBelumDitangani`, `deriveStatusAlur`) alih-alih membuat modul duplikat; tidak ada nilai aksi audit baru.

---

Plan complete and saved to `docs/superpowers/plans/2026-09-26-integrasi-surat-p3-tindak-lanjut-inisiatif.md`.

## Catatan Konsistensi Lintas Fase (2026-09-26)

Perubahan dari tinjauan konsistensi P0–P5 terhadap berkas ini:

- **Task 26 baru** (bagian H): toggle super_admin `unit_kerja.is_unit_pengawas` di `PUT /api/settings/unit-kerja/:id` (validasi boolean, audit `changes.pengawas`) dan toggle Settings "Unit Pengawas (pencatat terpusat)" — TDD lengkap; File Structure dan Self-Review diperbarui.
- Task 1: kontrak `findActiveGrant` diperbaiki — ekspor bernama `record-access.service.ts` (bukan metode `recordAccessService`); `deps.ts` me-re-export-nya dan test kontrak mengeceknya terpisah.
- Task 14: baris test demo P2 `['POST', /api/rangkaian/${id}/gabung, 'unsupported_route']` wajib dihapus karena gabung kini di-allowlist.
- Task 18 / Kontrak antarfase: `useLacakSearch` ditetapkan sebagai satu-satunya hook Lacak; P4 Task 10 memperluasnya (superset `{ status, loading, data, error, q, retry }`) tanpa memutus pemanggil P3.
- Branch: `feat/integrasi-surat-p3` ditambahkan ke Global Constraints.
- Dikonfirmasi tanpa perubahan: implementasi Lacak di `services/rangkaian/lacak.service.ts` (`skorSql`, CTE `teratas`/`kelompok`, `ekspansi`) adalah titik ubah P4 Task 3–4; `escapeLike`/`LIKE_ESCAPE`/`classifyLacakQuery` di `utils/nomor-surat.ts` (P1 membuat berkas); `isPengawas(user, executor?)` di `deps.ts` adalah satu-satunya pembungkus pengawas yang juga dipakai P5.
