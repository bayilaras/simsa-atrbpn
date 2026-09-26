# Integrasi Surat — P4 Halaman Lacak Surat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menyediakan halaman **Lacak Surat** (`/surat/lacak`) dengan satu input besar, kartu rangkaian berpratinjau node, ekspansi di tempat, sinkronisasi URL (`?q=`, `?rangkaian=`), tab **Berkas Rangkaian**, aksi "Lihat rangkaian" di GlobalSearch tanpa request tambahan, dan penyempurnaan peringkat `/lacak` beserta bukti kinerja (EXPLAIN 50 ribu baris) serta uji probing penyamaran.

**Architecture:** Backend `/api/rangkaian/lacak` (3 mode) sudah dibangun P3. P4 hanya (a) mengekstrak skor ke modul murni `lacak-skor.ts` (dipasang di `skorSql` pada `services/rangkaian/lacak.service.ts` P3) lalu menambah tingkat *prefix mentah berbatas*, urutan seed sebelum `LIMIT 200`, dan tie-break deterministik; (b) menambah endpoint daftar `GET /api/rangkaian` untuk tab Berkas Rangkaian, dengan predikat jangkauan §4.5 yang dijaga uji paritas terhadap `checkRead`; (c) membangun UI React: memperluas hook tunggal P3 `useLacakSearch` (debounce 300 ms, minimal 3 karakter, AbortController, penjaga urutan basi, cache LRU 20), halaman `LacakSurat.jsx` yang merender `AlurSuratPanel` (P2) di dalam kartu, tab Berkas Rangkaian, route, sidebar, breadcrumbs, dan hook GlobalSearch. Tidak ada migrasi baru, role baru, atau perubahan pada `check()`/`visibleSql`.

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

## Review Focus

1. **Respons basi menimpa hasil terbaru / abort tidak sampai ke `fetch`.** Kueri lama yang lambat (atau layanan yang mengabaikan sinyal) datang setelah kueri baru lalu mengganti kartu. Diuji di **Task 10** (`penjaga urutan: respons basi yang tidak menghormati abort tidak menimpa hasil terbaru`, `membatalkan permintaan lama begitu kueri berubah`) dan **Task 13** (`membatalkan permintaan sebelumnya ketika kueri berubah dan mengabaikan hasil basi`).
2. **Node tersamar menjadi oracle pencarian.** Perihal/nomor/dari node Terbatas cocok lewat mode `cek`/`referensi`, lewat nomor ternormalisasi, lewat token yang digabung lintas anggota, atau bocor lewat `rangkaian.judul`. Diuji di **Task 4** (`lacak-probing.integration.test.ts`: tiga mode × empat probe, token lintas anggota, placeholder paling konservatif, serta kontrol super_admin dan grant).
3. **`LIMIT 200` pada seed memotong kecocokan persis, dan seri skor tidak deterministik.** Seed yang dibatasi sebelum diurutkan skor akan membuang nomor persis yang lebih tua, dan urutan kartu bisa berubah antar-permintaan. Diuji di **Task 3** (`LIMIT 200 seed diterapkan setelah urut skor…` dan `seri penuh … diurutkan kunci naik secara deterministik`).
4. **Loop sinkronisasi URL.** Gejalanya: setiap ketikan membuat entri history baru, Back/tautan GlobalSearch tidak memperbarui input, atau auto-open kartu tunggal menulis `?rangkaian=` sehingga penutupan kartu gagal. Diuji di **Task 13** (`menunda pencarian 300 ms, menyinkronkan ?q= dengan replace…`, `mengikuti navigasi luar…`, `membuka langsung bila hanya satu kelompok…`).
5. **Daftar Berkas Rangkaian menyimpang dari `checkRead`.** Contohnya: disposisi `rejected` masih memberi jangkauan, `staff` mendapat jangkauan peserta, pengawas tidak melihat `dir_*`, atau rangkaian `digabung`/`data_lama` ikut tampil. Diuji di **Task 5** (uji paritas pengguna × rangkaian terhadap `recordAccessService.checkRead`, ditambah kasus eksplisit).

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

**Backend (diubah):**
- `backend/src/services/rangkaian/lacak.service.ts` (P3; `rangkaianService.lacak` di `rangkaian.service.ts` hanya mendelegasikan ke `lacakService.search`) mengubah `skorSql`: skor diganti `skorLacakSql` (predikat `cocok` P3 tetap), urutan seed sebelum `LIMIT 200` dan tie-break kelompok diverifikasi, dan `judul` di `ekspansi` disamarkan lewat `judulRangkaianTampil`.
- `backend/src/validators/schemas.ts` mendapat `daftarRangkaianQuerySchema`.
- `backend/src/app.ts` memasang `rangkaianDaftarRoutes` tepat sebelum `app.use('/api/rangkaian', rangkaianRoutes)` milik P2/P3.
- `backend/src/middlewares/demo-access.middleware.ts` mendapat allowlist `GET /rangkaian`.

**Frontend (baru):**
- `frontend/src/lib/lacak-cache.js` berisi `LACAK_MIN_CHARS`, `LACAK_MAX_CHARS`, `LACAK_CACHE_SIZE`, `lacakCacheKey`, dan `createLacakCache`.
- `frontend/src/lib/lacak-link.js` berisi `lacakHref` dan `lacakQueryForResult`.
- `frontend/src/lib/lacak-labels.js` berisi `LABEL_RELASI`, `LABEL_STATUS_RANGKAIAN`, dan `LABEL_JENIS_SURAT`.
- `frontend/src/components/lacak/LacakKelompokCard.jsx` dan `frontend/src/components/lacak/BerkasRangkaianTab.jsx`.
- `frontend/src/pages/LacakSurat.jsx`.
- Tes: `lib/lacak-cache.test.js`, `lib/lacak-link.test.js`, `services/rangkaian.service.lacak.test.js`, `components/surat/__tests__/AlurSuratPanel.rangkaian-id.test.jsx`, `hooks/use-lacak-search.p4.test.jsx`, `components/lacak/LacakKelompokCard.test.jsx`, `components/lacak/BerkasRangkaianTab.test.jsx`, `pages/LacakSurat.test.jsx`, `App.lacak-route.test.jsx`, `components/GlobalSearch.lacak.test.jsx`.

**Frontend (diubah):**
- `frontend/src/hooks/use-lacak-search.js` (P3 Task 18) diperluas menjadi satu-satunya hook Lacak: `status`, batas 100, `retry`, `LACAK_DEBOUNCE_MS`, dan cache `lacak-cache.js` (Task 10).
- `frontend/src/services/rangkaian.service.js` (P2/P3) mendapat `list` dan `unitKerjaOpsi`; `lacak` milik P3 (sudah meneruskan `{ signal }`) dipakai apa adanya. (`tutupMassalDataLama`/`getRingkasanDataLama` dan UI Tutup massal dimiliki **P5** Task 9–10.)
- `frontend/src/components/surat/AlurSuratPanel.jsx` (P2) mendapat prop opsional `rangkaianId` yang memuat lewat `getById`.
- `frontend/src/App.jsx` mendapat lazy `LacakSurat` dan route `/surat/lacak`.
- `frontend/src/components/app-sidebar.jsx` mendapat sub-item "Lacak Surat" di grup Surat (`:84-85`).
- `frontend/src/components/app-sidebar.groups.test.jsx`, `frontend/src/components/breadcrumbs.jsx`, `frontend/src/components/breadcrumbs.test.jsx`.
- `frontend/src/components/GlobalSearch.jsx` mendapat aksi "Lihat rangkaian", Shift+Enter, dan item "Lacak rangkaian “q”".

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

- Produces: branch `feat/integrasi-surat-p4` dan catatan baseline (jumlah tes lulus) untuk Task 16.

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
```

Expected: setiap perintah mengembalikan minimal satu baris. Dari grep `lacak.service.ts`, catat baris `export function skorSql` (titik ubah Task 3), CTE `teratas` (`ORDER BY skor DESC, tanggal_surat DESC NULLS LAST, surat_id LIMIT ${SEED_LIMIT}`), dan `ORDER BY` kelompok (`skor DESC, tanggal_terbaru DESC NULLS LAST, kunci ASC`).

- [ ] **Step 3: Verifikasi nama frontend P2/P3**

```bash
cd "D:/Projects/New folder/simsa-atrbpn"
grep -n "export const rangkaianService\|export default\|lacak\|getById\|getBySurat" frontend/src/services/rangkaian.service.js
grep -n "export function AlurSuratPanel\|export default AlurSuratPanel\|rangkaianService.getBySurat" frontend/src/components/surat/AlurSuratPanel.jsx
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

Expected: kedua suite hijau. Catat jumlah file/tes sebagai baseline Task 16. Tidak ada commit pada task ini.

---

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

Urutan final setelah P5 (P5 Task 8 menyisipkan router berkas di antara keduanya):

```ts
app.use('/api/rangkaian', rangkaianDaftarRoutes);  // P4 Task 6: hanya GET / (auth per-route)
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

### Task 16: Verifikasi akhir P4

**Files:** tidak ada perubahan kode. Commit hanya dibuat bila ada perbaikan dari langkah ini.

**Interfaces:**
- Consumes: seluruh keluaran Task 2–15 dan baseline Task 1 Step 5
- Produces: bukti kriteria selesai §10-P4, yaitu fixture ranking, probing, EXPLAIN 50 ribu baris, dan RTL debounce/abort

- [ ] **Step 1: Suite backend penuh**

Run: `(cd backend && npx vitest run)`
Expected: PASS. Jumlah file uji = baseline + 6 (`lacak-skor`, `lacak-ranking.integration`, `lacak-probing.integration`, `rangkaian-judul`, `rangkaian-daftar.integration`, `rangkaian-daftar.routes`).

- [ ] **Step 2: Typecheck backend**

Run: `(cd backend && npx tsc --noEmit -p tsconfig.json)`
Expected: tidak ada galat baru di file P4. Bandingkan dengan keluaran pada commit baseline Task 1 bila baseline sudah punya galat.

- [ ] **Step 3: Suite frontend penuh, lint, dan build**

```bash
cd "D:/Projects/New folder/simsa-atrbpn/frontend"
npx vitest run
npx eslint src/pages/LacakSurat.jsx src/components/lacak src/hooks/use-lacak-search.js src/lib/lacak-cache.js src/lib/lacak-link.js src/lib/lacak-labels.js src/components/GlobalSearch.jsx src/components/app-sidebar.jsx src/components/breadcrumbs.jsx src/App.jsx src/services/rangkaian.service.js
npm run build
```

Expected: vitest PASS (baseline + 9 file uji baru), ESLint tanpa galat, dan build Vite sukses dengan chunk terpisah untuk `LacakSurat`.

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

**Pemindaian placeholder:** setiap langkah kode memuat kode lengkap. Dua titik ubah bergantung pada kode P3 yang belum tertulis saat rencana ini disusun: ekspresi skor/ORDER BY di Task 3 Step 4 dan pemetaan `judul` di Task 4 Step 4. Keduanya diberi fragmen kode persis beserta perintah `grep` penemu lokasinya (Task 1 Step 2). Task 1 menghentikan eksekusi bila nama P2/P3 berbeda.

**Konsistensi tipe dan nama:**
- `LacakResult`/`LacakKelompok`/`LacakNode`/`LacakNodeTersamar` (Task 1) dipakai sama di fixture backend (Task 3–4) dan frontend (Task 10–13).
- `kunci` rangkaian = uuid mentah dan surat tunggal = `surat:<uuid>`, persis ekspresi P3 `CASE WHEN rs.id IS NULL THEN 'surat:' || t.surat_id::text ELSE coalesce(rs.digabung_ke_id, rs.id)::text END`.
- `rangkaianService.lacak(params, { signal })` (Task 9) cocok dengan pemanggil di Task 10 dan mock di Task 13/15.
- `list` mengembalikan respons utuh sesuai kebutuhan `usePaginatedResource` (`response.data`, `response.pagination.total`, `response.meta`).
- `meta.aksiDiizinkan` selalu `[]` di Task 5 dan 6; Task 12 tidak membacanya (Tutup massal milik P5 via `GET /api/rangkaian/data-lama/ringkasan`).
- `judulRangkaianTampil` konsisten di Task 4 dan 5.
- `LACAK_MIN_CHARS`/`LACAK_MAX_CHARS` konsisten di Task 8, 10, 13, dan 15.

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

## Catatan Konsistensi Lintas Fase (2026-09-26)

Perubahan dari tinjauan konsistensi P0–P5 terhadap berkas ini:

- Task 1/3/4 diarahkan ulang ke kode P3 yang sebenarnya: `backend/src/services/rangkaian/lacak.service.ts` (`skorSql`, `ekspansi`), bukan `rangkaian.service.ts` (yang hanya mendelegasikan). Anchor Task 3 kini blok `return` persis dari `skorSql` P3; urutan seed/kelompok diverifikasi (sudah ditulis P3). Anchor Task 4 kini baris `judul` persis dari `ekspansi` P3.
- Typedef `LacakResult` disamakan dengan `lacak.types.ts` P3 (`LacakNode.unitKerjaId`, status `digabung`, `kunci` = `coalesce(rs.digabung_ke_id, rs.id)` / `'surat:'||surat_id`); deskripsi `normalizeNomor` dikoreksi (buang dulu, baru lowercase).
- Task 2: `bentukKueriLacak` tidak lagi mengklasifikasi sendiri — memetakan `classifyLacakQuery` P3 (satu klasifikasi kueri).
- Task 8/9/10/13: hook `useLacakSurat`/`use-lacak-surat.js` dihapus; Task 10 kini memperluas hook P3 `useLacakSearch` (`use-lacak-search.js`) dengan test baru `use-lacak-search.p4.test.jsx`; `lacakCacheKey` ikut memuat `jenis`; Task 9 tidak lagi mengganti `rangkaianService.lacak` P3 (mempertahankan `jenis` dan `limit = 8`).
- Task 9/12 dan Self-Review: "Tutup massal data lama" (service klien, tombol, dialog `{ unitPengolahId, alasan }` → `{ jumlah }`) dihapus dari P4; endpoint **dan** UI dimiliki P5 dengan kontrak tunggal pratinjau + `expectedCount`. `meta.aksiDiizinkan` tetap `[]`.
- Task 6: urutan mount final `/api/rangkaian` dicantumkan; Branch diganti `feat/integrasi-surat-p4` dari `origin/main` (sebelumnya `feat/integrasi-surat-p4-lacak`).
