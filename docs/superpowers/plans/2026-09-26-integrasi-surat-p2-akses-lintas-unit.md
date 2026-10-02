# Integrasi Surat — P2 Akses Baca Lintas Unit & Panel Alur Surat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unit peserta rangkaian dan unit pengawas dapat **membaca** (tidak pernah mengubah) surat unit lain dalam rangkaian yang sama melalui `recordAccessService.checkRead/checkMany`. Aksesnya diaudit, node terkendali disamarkan, dan hasilnya ditampilkan di Panel **Alur Surat** yang read-only. `check()` tetap berperilaku identik.

**Architecture:** Predikat visibilitas punya satu sumber, yaitu `backend/src/services/access/visibility-spec.ts`, yang dimulai P0 lalu dilengkapi di sini. Modul ini memuat fungsi TS murni (kelas per role, kecocokan unit rekaman, pengawas, jangkauan) dan fragmen SQL (`jangkauanSql`, `visibleSql`) yang dirakit dari aturan yang sama. `record-access.service.ts` diekstraksi tanpa perubahan perilaku (`findActiveGrant`, `evaluateOwnerAccess`, dijaga snapshot), lalu ditambah `checkMany` (batch, ±4 kueri) dan `checkRead` (delegasi ke `checkMany`). Route detail surat dan stream berkas beralih ke `checkRead` dan memuat rekaman lewat `scopeForAuthorizedRead`. Read model rangkaian (`rangkaian-read.service.ts`) dan route `GET /api/rangkaian/:id` serta `/by-surat/:jenis/:suratId` menyusun respons tersamar. Frontend menambah `rangkaian.service.js`, `TimelineItem` hasil ekstraksi, dan `AlurSuratPanel`.

**Tech Stack:** Express 5 + TypeScript (ESM), Drizzle ORM 0.45 (`sql` template, `PgDialect`), PostgreSQL / PGlite 0.5 untuk test integrasi, Vitest + Supertest; React 19 (JSX), React Router, Vitest + Testing Library (jsdom), shadcn/ui, lucide-react, date-fns.

**Spec:** docs/superpowers/specs/2026-09-26-integrasi-surat-masuk-keluar-design.md

## Global Constraints

- **`check()` dan `inspect()` tidak berubah perilaku.** Di Task 1, `check()` hanya direfaktor (grant diekstrak ke `findActiveGrant`, keputusan ke `evaluateOwnerAccess`). Snapshot karakterisasi yang di-commit **sebelum** refaktor wajib tetap hijau tanpa `-u`. Dilarang menjalankan `vitest -u` pada snapshot itu.
- **`checkRead`/`checkMany` selalu read-only.** Untuk `via !== 'owner'`, `mutable` selalu `false`. Semua jalur mutasi tetap memakai `check()` dan scope pemilik: PUT, DELETE, arsip, archive-full, upload, `/balasan`, `/with-links`, `/source`, `tunjuk-silang`. `tunjuk-silang.routes.ts` (`checkEntityAccessMany`) **tidak disentuh**.
- **Tidak ada role baru (D5).** Pengawas ditentukan oleh role FULL_ADMIN (`super_admin`, `admin_unit`, `admin_dirjen`, `admin_sesditjen`; super_admin dikecualikan karena sudah penuh lewat `check()`) **dan** unit efektif `resolveEffectiveUnitKerjaId(role, user.unitKerjaId)` yang ber-`unit_kerja.is_unit_pengawas = true`. `staff`/`auditor` tidak pernah mendapat jangkauan pengawas maupun peserta.
- **Tabel rangkaian dibaca lewat SQL mentah** dengan nama tabel/kolom persis dari spec §3 (`rangkaian_surat`, `rangkaian_anggota`, `rangkaian_relasi`, `rangkaian_peserta`, `surat_distributions.rangkaian_id`, `unit_kerja.is_unit_pengawas`), sehingga P2 tidak bergantung pada penamaan Drizzle P1. P2 **tidak menulis** ke tabel rangkaian dan tidak pernah memakai DELETE. Satu-satunya tulisan P2 adalah baris `audit_log`.
- **Jangkauan tidak pernah di-cache.** Setiap panggilan menghitung ulang dari pencatat, pengolah, penulis anggota, disposisi non-`rejected`, dan `rangkaian_peserta` aktif (hanya bila `RANGKAIAN_DISPOSISI_LAMA_READ=true`). `lanjutan_dari_id` tidak memberi jangkauan.
- **Grant tanpa jangkauan tidak membuka apa pun.** Grant hanya dipertimbangkan lintas unit bila jalur `pengawas`/`peserta` sudah ada, dan grant itu harus terikat `unit_kerja_id` rekaman **saat ini** serta kelas ternormalisasi.
- **GET bebas efek samping** kecuali audit view. Audit memakai `auditLogService.logActionOrThrow` dan ditulis **sebelum** respons dikirim; kegagalan audit berarti 500 (fail-closed).
- **Flag default mati:** `RANGKAIAN_DISPOSISI_LAMA_READ` dan `RANGKAIAN_AJUKAN_AKSES` hanya aktif bila bernilai string persis `'true'`. `aksiDiizinkan` selalu `[]` di P2; kontraknya dibekukan dan diisi P3.
- **Test backend:** `cd backend && npx vitest run <file>`. Test PGlite menerapkan migrasi `0000`–`0047` lewat helper `src/__tests__/helpers/rangkaian-pglite.ts`. Snapshot hanya boleh dibuat pada run pertama **tanpa** `CI=true`.
- **Test frontend:** `cd frontend && npx vitest run <file>`.
- **Git:** kerjakan di branch `feat/integrasi-surat-p2`: `git fetch origin && git switch -c feat/integrasi-surat-p2 origin/main` setelah PR P1 dimerge. Konvensi lintas fase: satu branch per fase `feat/integrasi-surat-pN`, dibuat dari `origin/main` setelah PR fase sebelumnya dimerge; bila PR itu belum dimerge, branch ditumpuk di ujung `feat/integrasi-surat-p(N-1)` lalu di-rebase ke `origin/main` setelah merge. Satu PR per fase ke `main`. Satu commit per task. Pesan commit diakhiri baris kosong lalu `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Prosa UI dan pesan error dalam Bahasa Indonesia. Kode, identifier API, dan nama test mengikuti gaya file yang disentuh.

## Review Focus

1. **Grant tanpa jangkauan atau grant basi.** Risikonya `checkRead` memakai grant approved sebagai "jalur" (misalnya BPPT memegang grant atas surat terbatas Sesditjen, padahal bukan peserta rangkaiannya), atau memakai grant yang terikat unit lain. Test: Task 3, baris matriks *"BPPT: grant tanpa jangkauan tidak membuka surat"* dan *"admin_sesditjen: grant terikat unit lain tidak berlaku"*.
2. **Kebocoran lewat placeholder dan bidang turunan.** Risikonya: `rangkaian.judul`, `relasi.keterangan`, `instruction`/`catatan_penyelesaian`/`rejection_reason` disposisi, `penyelesaian_surat_keluar_id`, atau judul rangkaian terkait ikut terkirim untuk node tersamar. Test: Task 8, *"tidak membocorkan isi node tersamar di mana pun dalam JSON"* (memindai `JSON.stringify` seluruh respons).
3. **Jangkauan basi.** Risikonya disposisi yang ditolak tetap memberi akses, `rangkaian_peserta` data lama terbaca saat flag mati, atau `lanjutan_dari_id` memberi akses. Test: Task 3, *"penolakan disposisi mencabut jangkauan seketika"* dan *"peserta data lama hanya berlaku saat flag menyala"*; Task 8, *"rangkaian lanjutan tidak mewarisi jangkauan"*.
4. **Drift TS ↔ SQL.** Kasus berisiko: `sifat_surat` kosong, spasi, tanda hubung, atau kapital; `klasifikasi_keamanan` NULL → terbatas; pengguna dengan unit NULL, `''`, atau spasi; role tak dikenal. Test: Task 4, property test 300 kombinasi dengan seed tetap, ditambah test eksplisit `''`.
5. **Pelebaran scope atau mutasi.** Risikonya route lintas unit memuat dengan scope `null` (khusus super_admin), PUT/DELETE ikut memakai `checkRead`, atau `staff`/`auditor` mendapat jangkauan. Test: Task 5, *"tidak pernah mengembalikan null untuk akses non-owner"*; Task 6, *"PUT/DELETE lintas unit tetap 404 dan data tidak berubah"* dan *"staff/auditor lama tanpa jangkauan"*.

---

## File Structure

**Dibuat (backend)**
- `backend/src/__tests__/p2-prasyarat.contract.test.ts` — gerbang kontrak P0/P1.
- `backend/src/__tests__/helpers/rangkaian-pglite.ts` — boot PGlite (migrasi ≤0047), fixture unit/pengguna/surat/rangkaian/disposisi/grant.
- `backend/src/__tests__/record-access-check.snapshot.integration.test.ts` (+ `__snapshots__/…snap`) — karakterisasi `check()` + test `findActiveGrant`.
- `backend/src/services/access/__tests__/visibility-spec.test.ts` — test murni spesifikasi visibilitas.
- `backend/src/__tests__/record-access-read.integration.test.ts` — matriks keamanan tingkat service.
- `backend/src/__tests__/visibility-parity.property.integration.test.ts` — property test `checkRead` ↔ `visibleSql`.
- `backend/src/__tests__/scope-for-authorized-read.test.ts`
- `backend/src/__tests__/rangkaian-akses.routes.integration.test.ts` — matriks tingkat route (PGlite + Supertest).
- `backend/src/services/rangkaian-read.service.ts` — read model rangkaian tersamar.
- `backend/src/__tests__/rangkaian-read.integration.test.ts`
- `backend/src/routes/rangkaian.routes.ts` — `GET /api/rangkaian/:id`, `GET /api/rangkaian/by-surat/:jenis/:suratId`.

**Diubah (backend)**
- `backend/src/services/access/visibility-spec.ts` — lengkapi (P0 hanya berisi normalisasi).
- `backend/src/services/record-access.service.ts` — ekstraksi + `checkMany`/`checkRead`.
- `backend/src/utils/record-unit-scope.ts` — `scopeForAuthorizedRead`.
- `backend/src/services/audit-log.service.ts:11` — aksi `view_via_rangkaian` (entitas `rangkaian_surat` sudah ditambahkan P1 Task 9).
- `backend/src/routes/surat-masuk.routes.ts:181-199`, `backend/src/routes/surat-keluar.routes.ts:150-168` — GET detail.
- `backend/src/routes/file-access.routes.ts:32-48,130-140,179,215` — kedua cabang stream.
- `backend/src/app.ts:50,370`, `backend/src/middlewares/demo-access.middleware.ts:53`.
- Test lama: `backend/src/routes/__tests__/surat-file-security.routes.test.ts`, `backend/src/routes/__tests__/file-access-generation.routes.test.ts`, `backend/src/__tests__/demo-access.middleware.test.ts`.

**Dibuat (frontend)**
- `frontend/src/services/rangkaian.service.js` (+ `rangkaian.service.test.js`).
- `frontend/src/components/surat/TimelineItem.jsx` (+ `__tests__/TimelineItem.test.jsx`).
- `frontend/src/components/surat/AlurSuratPanel.jsx` (+ `__tests__/AlurSuratPanel.test.jsx`).
- `frontend/src/pages/SuratMasukDetail.alur.test.jsx`.

**Diubah (frontend)**
- `frontend/src/pages/DosirDetail.jsx:53-104` — memakai `TimelineItem` hasil ekstraksi.
- `frontend/src/pages/SuratMasukDetail.jsx:26,139`, `frontend/src/pages/SuratKeluarDetail.jsx:48,452-466`.
- `frontend/src/pages/SuratKeluarDetail.rules.test.jsx`.

---

### Task 0: Gerbang prasyarat P0/P1

**Files:**
- Create: `backend/src/__tests__/p2-prasyarat.contract.test.ts`

**Interfaces:**
- Consumes from P0 (persis ekspor P0 Task 2, `backend/src/services/access/visibility-spec.ts`): `SECURITY_CLASSES`, `BIASA_SIFAT_ALIASES`, `JS_WHITESPACE_CODEPOINTS`, `PG_TRIM_PATTERN`, `PG_SEPARATOR_PATTERN`, `normalizeSecurityClassification(classification?: string | null): string`, `klasifikasiNormSql(column: AnyColumn | SQL): SQL<string>` (sudah memetakan `''`/NULL → `'biasa'` lewat `coalesce(nullif(col, ''), 'biasa')`), dan `klasifikasiInSql(column: AnyColumn | SQL, classes): SQL | undefined`; `record-access.service.ts` me-re-export `normalizeSecurityClassification` yang sama.
- Consumes from P1: `backend/src/db/migrations/0046_rangkaian_surat.sql` (tabel `rangkaian_surat`, `rangkaian_anggota`, `rangkaian_relasi`, `rangkaian_peserta`, kolom `surat_distributions.rangkaian_id`/`batas_waktu`/`penanggung_jawab`/`catatan_penyelesaian`/`ditutup_pengawas`/`penyelesaian_surat_keluar_id`, kolom `unit_kerja.is_unit_pengawas`) dan `0047_unit_kerja_direktorat.sql`.
- Produces: tidak ada (gerbang).

Task ini adalah gerbang, bukan TDD. Hasil yang diharapkan adalah **PASS**. Bila FAIL, hentikan eksekusi P2 dan laporkan artefak P0/P1 mana yang belum ada; jangan membuat artefak itu di P2.

- [ ] **Step 1: Tulis test gerbang**

```ts
// backend/src/__tests__/p2-prasyarat.contract.test.ts
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as spec from '../services/access/visibility-spec';
import * as recordAccess from '../services/record-access.service';

const migrationsDir = fileURLToPath(new URL('../db/migrations/', import.meta.url));

describe('prasyarat P2 dari P0/P1', () => {
    it('P0: visibility-spec mengekspor normalisasi TS dan fragmen SQL klasifikasi', () => {
        expect(typeof spec.normalizeSecurityClassification).toBe('function');
        expect(typeof spec.klasifikasiNormSql).toBe('function');
        expect(recordAccess.normalizeSecurityClassification).toBe(spec.normalizeSecurityClassification);
        const rendered = new PgDialect().sqlToQuery(spec.klasifikasiNormSql(sql.raw('x.sifat_surat'))).sql;
        expect(rendered).toContain('x.sifat_surat');
    });

    it('P1: migrasi 0046/0047 memuat tabel rangkaian dan kolom unit pengawas', () => {
        const files = readdirSync(migrationsDir);
        const file0046 = files.find(name => name.startsWith('0046_'));
        expect(file0046).toBeDefined();
        const text = readFileSync(`${migrationsDir}/${file0046}`, 'utf8');
        for (const token of [
            'CREATE TABLE rangkaian_surat',
            'CREATE TABLE rangkaian_anggota',
            'CREATE TABLE rangkaian_relasi',
            'CREATE TABLE rangkaian_peserta',
            'is_unit_pengawas',
            'ADD COLUMN rangkaian_id',
            'ADD COLUMN catatan_penyelesaian',
            'ADD COLUMN ditutup_pengawas',
        ]) {
            expect(text, token).toContain(token);
        }
        expect(files.some(name => name.startsWith('0047_'))).toBe(true);
    });
});
```

- [ ] **Step 2: Jalankan gerbang**

Run: `cd backend && npx vitest run src/__tests__/p2-prasyarat.contract.test.ts`
Expected: PASS (2 test). Bila FAIL, hentikan dan eskalasi.

- [ ] **Step 3: Commit**

```bash
git add backend/src/__tests__/p2-prasyarat.contract.test.ts
git commit -F - <<'EOF'
test(akses): gerbang kontrak prasyarat P0/P1 untuk P2

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 1: Snapshot karakterisasi `check()` lalu ekstraksi `findActiveGrant` & `evaluateOwnerAccess`

**Files:**
- Create: `backend/src/__tests__/helpers/rangkaian-pglite.ts`
- Create: `backend/src/__tests__/record-access-check.snapshot.integration.test.ts` (+ snapshot yang dihasilkan vitest)
- Modify: `backend/src/services/record-access.service.ts:98-264`

**Interfaces:**
- Consumes from P1: skema §3 lewat migrasi 0046/0047.
- Produces for P3–P5:

```ts
export interface ActiveGrant { id: string; purpose: string; accessMode: string; expiresAt: Date | null }
export interface AccessMetadata { unitKerjaId: string; classification: string | null; readable: boolean; mutable: boolean }
export function activeGrantConditions(userId: string, entityType: RecordEntityType, entityId: string, unitKerjaId: string, normalizedClassification: string): SQL;
export async function findActiveGrant(
    executor: Pick<typeof db, 'select'>,
    user: RecordUser | undefined,
    entityType: RecordEntityType,
    entityId: string,
    unitKerjaId: string,
    classification: string | null | undefined,
): Promise<ActiveGrant | null>;
export function grantAccessModeOf(grant: ActiveGrant | null): RecordGrantAccessMode | null;
export function evaluateOwnerAccess(user: RecordUser | undefined, metadata: AccessMetadata | null, grant: ActiveGrant | null): RecordAccessResult;
```

- [ ] **Step 1: Buat helper PGlite + fixture bersama**

```ts
// backend/src/__tests__/helpers/rangkaian-pglite.ts
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { enterTestMigratorRole } from './database-role-fixture';

export async function bootRangkaianDatabase(): Promise<PGlite> {
    const database = new PGlite({ extensions: { pgcrypto } });
    await database.waitReady;
    await enterTestMigratorRole(database);
    const dir = fileURLToPath(new URL('../../db/migrations/', import.meta.url));
    for (const file of readdirSync(dir).filter(name => /^\d{4}.*\.sql$/.test(name) && Number(name.slice(0, 4)) <= 47).sort()) {
        for (const statement of readFileSync(`${dir}/${file}`, 'utf8').split('--> statement-breakpoint').filter(value => value.trim())) {
            await database.exec(statement);
        }
    }
    return database;
}

export const USER_ID = {
    superAdmin: '10000000-0000-4000-8000-000000000001',
    tu: '10000000-0000-4000-8000-000000000002',
    bppt: '10000000-0000-4000-8000-000000000003',
    ptep: '10000000-0000-4000-8000-000000000004',
    staffSes: '10000000-0000-4000-8000-000000000005',
    adminSesNull: '10000000-0000-4000-8000-000000000006',
    plp: '10000000-0000-4000-8000-000000000007',
    auditorSes: '10000000-0000-4000-8000-000000000008',
    approver: '10000000-0000-4000-8000-000000000009',
} as const;

export const PENGGUNA = {
    superAdmin: { id: USER_ID.superAdmin, role: 'super_admin', unitKerjaId: null },
    tu: { id: USER_ID.tu, role: 'admin_unit', unitKerjaId: 'sesditjen' },
    bppt: { id: USER_ID.bppt, role: 'admin_unit', unitKerjaId: 'dir_bppt' },
    ptep: { id: USER_ID.ptep, role: 'admin_unit', unitKerjaId: 'dir_ptep' },
    staffSes: { id: USER_ID.staffSes, role: 'staff', unitKerjaId: 'sesditjen' },
    adminSesNull: { id: USER_ID.adminSesNull, role: 'admin_sesditjen', unitKerjaId: null },
    plp: { id: USER_ID.plp, role: 'admin_unit', unitKerjaId: 'dir_plp' },
    auditorSes: { id: USER_ID.auditorSes, role: 'auditor', unitKerjaId: 'sesditjen' },
} as const;

export const SURAT = {
    smBiasa: '30000000-0000-4000-8000-000000000001',
    smTerbatas: '30000000-0000-4000-8000-000000000002',
    smTunggal: '30000000-0000-4000-8000-000000000003',
    smBagian: '30000000-0000-4000-8000-000000000004',
    skBpptBiasa: '40000000-0000-4000-8000-000000000001',
    skBpptNull: '40000000-0000-4000-8000-000000000002',
    skPtepBiasa: '40000000-0000-4000-8000-000000000003',
    skBpptTunggal: '40000000-0000-4000-8000-000000000004',
} as const;

export const ARSIP_TERBATAS = '60000000-0000-4000-8000-000000000001';

export const RANGKAIAN = {
    rs1: '50000000-0000-4000-8000-000000000001',
    rs2: '50000000-0000-4000-8000-000000000002',
    rs3Digabung: '50000000-0000-4000-8000-000000000003',
    rs4Lanjutan: '50000000-0000-4000-8000-000000000004',
    rsBesar: '50000000-0000-4000-8000-000000000005',
} as const;

export const ANGGOTA = {
    rs1Sm: '51000000-0000-4000-8000-000000000001',
    rs1SkBiasa: '51000000-0000-4000-8000-000000000002',
    rs1SkNull: '51000000-0000-4000-8000-000000000003',
    rs2Sm: '51000000-0000-4000-8000-000000000004',
    rs2SkPtep: '51000000-0000-4000-8000-000000000005',
} as const;

export const DISPOSISI = {
    rs1Bppt: '52000000-0000-4000-8000-000000000001',
    rs1Ptep: '52000000-0000-4000-8000-000000000002',
    rs2Ptep: '52000000-0000-4000-8000-000000000003',
} as const;

export const GRANT = {
    ptepSmTerbatas: '53000000-0000-4000-8000-000000000001',
    bpptSmTerbatas: '53000000-0000-4000-8000-000000000002',
    tuSkBpptNull: '53000000-0000-4000-8000-000000000003',
    adminSesSalahUnit: '53000000-0000-4000-8000-000000000004',
    tuArsip: '53000000-0000-4000-8000-000000000005',
    tuSmTerbatasKadaluarsa: '53000000-0000-4000-8000-000000000006',
} as const;

/** Teks yang TIDAK boleh muncul pada respons untuk pembaca yang node-nya tersamar. */
export const RAHASIA = {
    perihalSmTerbatas: 'Perihal SM rahasia terbatas',
    nomorSmTerbatas: 'SM-2/RHS/2026',
    instruksiRs2: 'Instruksi rahasia untuk PTEP',
    keteranganRs2: 'Tanggapan atas surat terbatas',
    perihalSkNull: 'ND BPPT klasifikasi lama',
    nomorSkNull: 'ND-2/BPPT/2026',
    keteranganSkNull: 'Keterangan relasi rahasia',
} as const;

function grantRow(id: string, user: string, type: string, entity: string, unit: string, purpose: string, mode: string, decidedAt: string, expiresAt: string): string {
    return `('${id}','${user}','${user}','${type}','${entity}','${unit}','terbatas','${purpose}','${mode}','approved','${USER_ID.approver}','${decidedAt}','Kebutuhan kerja terverifikasi','${expiresAt}')`;
}

export async function seedRangkaianFixture(database: PGlite): Promise<void> {
    await database.exec(`
        TRUNCATE rangkaian_relasi, rangkaian_peserta, rangkaian_anggota, surat_distributions, rangkaian_surat,
            record_access_grants, audit_log, arsip, surat_keluar, surat_masuk, users, unit_kerja CASCADE;
        INSERT INTO unit_kerja (id, name, is_unit_pengawas) VALUES
            ('ditjen','Direktorat Jenderal',true), ('sesditjen','Sekretariat Ditjen',true),
            ('dir_bppt','Dit. BPPT',false), ('dir_ptep','Dit. PTEP',false),
            ('dir_plp','Dit. PLP',false), ('bagian_umum','Bagian Umum',false);
        INSERT INTO users (id, email, role, unit_kerja_id) VALUES
            ('${USER_ID.superAdmin}','super@example.test','super_admin',NULL),
            ('${USER_ID.tu}','tu@example.test','admin_unit','sesditjen'),
            ('${USER_ID.bppt}','bppt@example.test','admin_unit','dir_bppt'),
            ('${USER_ID.ptep}','ptep@example.test','admin_unit','dir_ptep'),
            ('${USER_ID.staffSes}','staff@example.test','staff','sesditjen'),
            ('${USER_ID.adminSesNull}','sesditjen@example.test','admin_sesditjen',NULL),
            ('${USER_ID.plp}','plp@example.test','admin_unit','dir_plp'),
            ('${USER_ID.auditorSes}','auditor@example.test','auditor','sesditjen'),
            ('${USER_ID.approver}','approver@example.test','super_admin',NULL);
        INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, sifat_surat, nomor_surat, perihal, dari, tanggal_surat) VALUES
            ('${SURAT.smBiasa}','sesditjen',1,2026,'Sangat Segera','SM-1/2026','Permohonan data pertanahan','Kanwil A','2026-09-01'),
            ('${SURAT.smTerbatas}','sesditjen',2,2026,'Terbatas','${RAHASIA.nomorSmTerbatas}','${RAHASIA.perihalSmTerbatas}','Kanwil B','2026-09-02'),
            ('${SURAT.smTunggal}','sesditjen',3,2026,'biasa','SM-3/2026','Surat tunggal TU','Kanwil C','2026-09-03'),
            ('${SURAT.smBagian}','bagian_umum',1,2026,'biasa','SM-4/2026','Surat bagian umum','Kanwil D','2026-09-04');
        INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, klasifikasi_keamanan, nomor_surat, perihal, kepada, naskah_dinas, tanggal_surat) VALUES
            ('${SURAT.skBpptBiasa}','dir_bppt',1,2026,'biasa','ND-1/BPPT/2026','Tindak lanjut permohonan data','Sesditjen','Nota Dinas','2026-09-05'),
            ('${SURAT.skBpptNull}','dir_bppt',2,2026,NULL,'${RAHASIA.nomorSkNull}','${RAHASIA.perihalSkNull}','Sesditjen','Nota Dinas','2026-09-06'),
            ('${SURAT.skPtepBiasa}','dir_ptep',1,2026,'biasa','ND-1/PTEP/2026','Tanggapan PTEP','Sesditjen','Nota Dinas','2026-09-07'),
            ('${SURAT.skBpptTunggal}','dir_bppt',3,2026,'biasa','ND-3/BPPT/2026','Surat inisiatif BPPT','Kanwil','Nota Dinas','2026-09-08');
        INSERT INTO arsip (id, unit_kerja_id, jenis_arsip, tahun, klasifikasi_keamanan, keterangan)
            VALUES ('${ARSIP_TERBATAS}','sesditjen','masuk',2026,'terbatas','Arsip terbatas TU');
        INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, unit_pengolah_id, judul, tahun) VALUES
            ('${RANGKAIAN.rs1}','RS-2026-000001','surat_masuk','aktif','sesditjen','dir_bppt','Permohonan data pertanahan',2026),
            ('${RANGKAIAN.rs2}','RS-2026-000002','surat_masuk','aktif','sesditjen',NULL,'${RAHASIA.perihalSmTerbatas}',2026);
        INSERT INTO rangkaian_anggota (id, rangkaian_id, surat_masuk_id, surat_keluar_id, unit_kerja_id, peran, sumber, ditambahkan_at) VALUES
            ('${ANGGOTA.rs1Sm}','${RANGKAIAN.rs1}','${SURAT.smBiasa}',NULL,'sesditjen','induk','aplikasi','2026-09-01T01:00:00Z'),
            ('${ANGGOTA.rs1SkBiasa}','${RANGKAIAN.rs1}',NULL,'${SURAT.skBpptBiasa}','dir_bppt','anggota','aplikasi','2026-09-05T01:00:00Z'),
            ('${ANGGOTA.rs1SkNull}','${RANGKAIAN.rs1}',NULL,'${SURAT.skBpptNull}','dir_bppt','anggota','aplikasi','2026-09-06T01:00:00Z'),
            ('${ANGGOTA.rs2Sm}','${RANGKAIAN.rs2}','${SURAT.smTerbatas}',NULL,'sesditjen','induk','aplikasi','2026-09-02T01:00:00Z'),
            ('${ANGGOTA.rs2SkPtep}','${RANGKAIAN.rs2}',NULL,'${SURAT.skPtepBiasa}','dir_ptep','anggota','aplikasi','2026-09-07T01:00:00Z');
        INSERT INTO rangkaian_relasi (rangkaian_id, dari_anggota_id, ke_anggota_id, jenis_relasi, keterangan) VALUES
            ('${RANGKAIAN.rs1}','${ANGGOTA.rs1SkBiasa}','${ANGGOTA.rs1Sm}','tindak_lanjut','Menindaklanjuti permohonan'),
            ('${RANGKAIAN.rs1}','${ANGGOTA.rs1SkNull}','${ANGGOTA.rs1Sm}','menjelaskan','${RAHASIA.keteranganSkNull}'),
            ('${RANGKAIAN.rs2}','${ANGGOTA.rs2SkPtep}','${ANGGOTA.rs2Sm}','tindak_lanjut','${RAHASIA.keteranganRs2}');
        INSERT INTO surat_distributions (id, surat_masuk_id, source_unit_id, target_unit_id, instruction, status, rejection_reason, rangkaian_id, penanggung_jawab, batas_waktu) VALUES
            ('${DISPOSISI.rs1Bppt}','${SURAT.smBiasa}','sesditjen','dir_bppt','Mohon ditindaklanjuti','received',NULL,'${RANGKAIAN.rs1}',true,'2026-09-30'),
            ('${DISPOSISI.rs1Ptep}','${SURAT.smBiasa}','sesditjen','dir_ptep','Untuk diketahui','rejected','Bukan kewenangan PTEP','${RANGKAIAN.rs1}',false,NULL),
            ('${DISPOSISI.rs2Ptep}','${SURAT.smTerbatas}','sesditjen','dir_ptep','${RAHASIA.instruksiRs2}','sent',NULL,'${RANGKAIAN.rs2}',true,'2026-10-01');
        INSERT INTO record_access_grants (id, requester_id, target_user_id, entity_type, entity_id, unit_kerja_id, required_classification, purpose, access_mode, status, decided_by, decided_at, decision_reason, expires_at) VALUES
            ${grantRow(GRANT.ptepSmTerbatas, USER_ID.ptep, 'surat_masuk', SURAT.smTerbatas, 'sesditjen', 'Tindak lanjut disposisi surat terbatas', 'view', '2026-09-01T00:00:00Z', '2099-01-01T00:00:00Z')},
            ${grantRow(GRANT.bpptSmTerbatas, USER_ID.bppt, 'surat_masuk', SURAT.smTerbatas, 'sesditjen', 'Permintaan baca tanpa jangkauan rangkaian', 'view', '2026-09-01T00:00:00Z', '2099-01-01T00:00:00Z')},
            ${grantRow(GRANT.tuSkBpptNull, USER_ID.tu, 'surat_keluar', SURAT.skBpptNull, 'dir_bppt', 'Pengawasan tindak lanjut direktorat BPPT', 'manage', '2026-09-01T00:00:00Z', '2099-01-01T00:00:00Z')},
            ${grantRow(GRANT.adminSesSalahUnit, USER_ID.adminSesNull, 'surat_keluar', SURAT.skBpptNull, 'dir_ptep', 'Grant terikat unit lama yang sudah pindah', 'view', '2026-09-01T00:00:00Z', '2099-01-01T00:00:00Z')},
            ${grantRow(GRANT.tuSmTerbatasKadaluarsa, USER_ID.tu, 'surat_masuk', SURAT.smTerbatas, 'sesditjen', 'Grant lama yang sudah kedaluwarsa', 'view', '2025-12-01T00:00:00Z', '2026-01-01T00:00:00Z')};
        INSERT INTO record_access_grants (id, requester_id, target_user_id, entity_type, entity_id, unit_kerja_id, required_classification, purpose, access_mode, status, decided_by, decided_at, decision_reason, expires_at) VALUES
            ('${GRANT.tuArsip}','${USER_ID.tu}','${USER_ID.tu}','arsip','${ARSIP_TERBATAS}','sesditjen','terbatas','Koreksi metadata arsip terbatas TU','manage','approved','${USER_ID.approver}','2026-09-01T00:00:00Z','Kebutuhan kerja terverifikasi','2099-01-01T00:00:00Z');
    `);
}
```

- [ ] **Step 2: Tulis snapshot karakterisasi `check()` (sebelum menyentuh service)**

```ts
// backend/src/__tests__/record-access-check.snapshot.integration.test.ts
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import {
    ARSIP_TERBATAS, PENGGUNA, SURAT,
    bootRangkaianDatabase, seedRangkaianFixture,
} from './helpers/rangkaian-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let access: typeof import('../services/record-access.service');

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    access = await import('../services/record-access.service');
    await seedRangkaianFixture(database);
}, 60_000);
afterAll(async () => { await database?.close(); });

const PENGGUNA_UJI: Array<[string, any]> = [
    ...Object.entries(PENGGUNA),
    ['roleTakDikenal', { id: PENGGUNA.tu.id, role: 'user', unitKerjaId: 'sesditjen' }],
    ['tanpaPengguna', undefined],
];
const REKAMAN: Array<[string, 'surat_masuk' | 'surat_keluar' | 'arsip', string]> = [
    ...Object.entries(SURAT).map(([nama, id]) => [nama, nama.startsWith('sm') ? 'surat_masuk' : 'surat_keluar', id] as [string, 'surat_masuk' | 'surat_keluar', string]),
    ['arsipTerbatas', 'arsip', ARSIP_TERBATAS],
];

describe('karakterisasi check() sebelum dan sesudah P2', () => {
    it('menghasilkan keputusan yang identik dengan snapshot pra-refaktor', async () => {
        const hasil: Record<string, unknown> = {};
        for (const [namaPengguna, user] of PENGGUNA_UJI) {
            for (const [namaRekaman, type, id] of REKAMAN) {
                hasil[`${namaPengguna}:${namaRekaman}`] = JSON.parse(JSON.stringify(
                    await access.recordAccessService.check(user, type, id),
                ));
            }
        }
        expect(hasil).toMatchSnapshot();
    });
});
```

- [ ] **Step 3: Jalankan untuk membuat snapshot (tanpa `CI=true`)**

Run: `cd backend && npx vitest run src/__tests__/record-access-check.snapshot.integration.test.ts`
Expected: PASS, "1 snapshot written". File `backend/src/__tests__/__snapshots__/record-access-check.snapshot.integration.test.ts.snap` terbentuk. Periksa isinya: `tu:skBpptNull.allowed` harus `false` (TU bukan pemilik), `tu:arsipTerbatas.mutable` harus `true`, dan `ptep:smTerbatas.grantId` harus `null`.

- [ ] **Step 4: Commit snapshot sebelum refaktor**

```bash
git add backend/src/__tests__/helpers/rangkaian-pglite.ts backend/src/__tests__/record-access-check.snapshot.integration.test.ts backend/src/__tests__/__snapshots__/record-access-check.snapshot.integration.test.ts.snap
git commit -F - <<'EOF'
test(akses): snapshot karakterisasi check() sebelum refaktor P2

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 5: Tambahkan test yang gagal untuk `findActiveGrant` dan `evaluateOwnerAccess`**

Tambahkan ke `describe` yang sama di `record-access-check.snapshot.integration.test.ts`, lalu tambahkan `GRANT` pada impor `./helpers/rangkaian-pglite`:

```ts
    it('findActiveGrant mencari grant terikat unit dan kelas tanpa syarat unitAllowed', async () => {
        const grant = await access.findActiveGrant(holder.db, PENGGUNA.ptep, 'surat_masuk', SURAT.smTerbatas, 'sesditjen', 'Terbatas');
        expect(grant?.id).toBe(GRANT.ptepSmTerbatas);
        expect(await access.findActiveGrant(holder.db, PENGGUNA.ptep, 'surat_masuk', SURAT.smTerbatas, 'dir_ptep', 'Terbatas')).toBeNull();
        expect(await access.findActiveGrant(holder.db, PENGGUNA.ptep, 'surat_masuk', SURAT.smBiasa, 'sesditjen', 'Sangat Segera')).toBeNull();
        expect(await access.findActiveGrant(holder.db, { ...PENGGUNA.ptep, id: null }, 'surat_masuk', SURAT.smTerbatas, 'sesditjen', 'Terbatas')).toBeNull();
        expect(await access.findActiveGrant(holder.db, PENGGUNA.tu, 'surat_masuk', SURAT.smTerbatas, 'sesditjen', 'Terbatas')).toBeNull();
        // check() tetap tidak memakai grant milik non-pemilik.
        expect((await access.recordAccessService.check(PENGGUNA.ptep, 'surat_masuk', SURAT.smTerbatas)).grantId).toBeNull();
    });

    it('evaluateOwnerAccess mengabaikan grant bila unit tidak diizinkan', () => {
        const metadata = { unitKerjaId: 'sesditjen', classification: 'terbatas', readable: true, mutable: true };
        const grant = { id: GRANT.ptepSmTerbatas, purpose: 'x', accessMode: 'manage', expiresAt: new Date('2099-01-01T00:00:00Z') };
        const result = access.evaluateOwnerAccess(PENGGUNA.ptep, metadata, grant);
        expect(result).toMatchObject({ exists: true, allowed: false, mutable: false, grantId: null, grantAccessMode: null });
        expect(access.evaluateOwnerAccess(PENGGUNA.tu, metadata, grant)).toMatchObject({ allowed: true, mutable: true, grantAccessMode: 'manage' });
        expect(access.grantAccessModeOf({ ...grant, accessMode: 'aneh' })).toBe('view');
        expect(access.grantAccessModeOf(null)).toBeNull();
    });
```

- [ ] **Step 6: Jalankan, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/record-access-check.snapshot.integration.test.ts`
Expected: FAIL. Dua test baru gagal dengan `access.findActiveGrant is not a function` / `access.evaluateOwnerAccess is not a function`; snapshot tetap PASS.

- [ ] **Step 7: Refaktor minimal `record-access.service.ts`**

Tambahkan `SQL` ke impor drizzle (baris 3 menjadi `import { and, desc, eq, gt, type SQL } from 'drizzle-orm';`). Ganti blok `findAccessMetadata` sampai akhir `check()` (baris 98–264) sehingga bentuknya sebagai berikut. Isi `findAccessMetadata` tidak berubah; hanya tipe kembaliannya yang diberi nama.

```ts
export interface AccessMetadata {
    unitKerjaId: string;
    classification: string | null;
    readable: boolean;
    mutable: boolean;
}

export interface ActiveGrant {
    id: string;
    purpose: string;
    accessMode: string;
    expiresAt: Date | null;
}

async function findAccessMetadata(
    entityType: RecordEntityType,
    entityId: string,
    executor: Pick<typeof db, 'select'> = db,
): Promise<AccessMetadata | null> {
    // (badan fungsi baris 108-163 dipertahankan apa adanya)
}

export function activeGrantConditions(
    userId: string,
    entityType: RecordEntityType,
    entityId: string,
    unitKerjaId: string,
    normalizedClassification: string,
): SQL {
    return and(
        eq(recordAccessGrants.targetUserId, userId),
        eq(recordAccessGrants.entityType, entityType),
        eq(recordAccessGrants.entityId, entityId),
        // A grant follows the record scope captured at approval time. Moving a
        // record to another unit must invalidate the old authorization.
        eq(recordAccessGrants.unitKerjaId, unitKerjaId),
        eq(recordAccessGrants.requiredClassification, normalizedClassification),
        eq(recordAccessGrants.status, 'approved'),
        gt(recordAccessGrants.expiresAt, new Date()),
    )!;
}

/**
 * Grant aktif untuk satu rekaman. Tidak memeriksa kewenangan unit: pemanggil
 * (check() untuk pemilik, checkMany() untuk jangkauan rangkaian) yang
 * menentukan apakah grant boleh dipertimbangkan.
 */
export async function findActiveGrant(
    executor: Pick<typeof db, 'select'>,
    user: RecordUser | undefined,
    entityType: RecordEntityType,
    entityId: string,
    unitKerjaId: string,
    classification: string | null | undefined,
): Promise<ActiveGrant | null> {
    const normalized = normalizeSecurityClassification(classification);
    if (!user?.id || !requiresExplicitAccessGrant(normalized)) return null;
    const [activeGrant] = await executor
        .select({
            id: recordAccessGrants.id,
            purpose: recordAccessGrants.purpose,
            accessMode: recordAccessGrants.accessMode,
            expiresAt: recordAccessGrants.expiresAt,
        })
        .from(recordAccessGrants)
        .where(activeGrantConditions(user.id, entityType, entityId, unitKerjaId, normalized))
        .orderBy(desc(recordAccessGrants.decidedAt))
        .limit(1);
    return activeGrant || null;
}

export function grantAccessModeOf(grant: ActiveGrant | null): RecordGrantAccessMode | null {
    if (!grant) return null;
    return grant.accessMode === 'download' || grant.accessMode === 'manage' ? grant.accessMode : 'view';
}

/** Keputusan pemilik yang identik dengan check() sebelum P2 (dijaga snapshot). */
export function evaluateOwnerAccess(
    user: RecordUser | undefined,
    metadata: AccessMetadata | null,
    grant: ActiveGrant | null,
): RecordAccessResult {
    const unitKerjaId = metadata?.unitKerjaId || null;
    const normalizedClassification = normalizeSecurityClassification(metadata?.classification);
    const unitAllowed = Boolean(unitKerjaId) && metadata?.readable === true &&
        isAllowedForRecordUnit(user, unitKerjaId!);
    const controlled = requiresExplicitAccessGrant(normalizedClassification);
    const ownerGrant = unitAllowed && user?.id && controlled ? grant : null;
    const classificationAllowed = controlled
        ? Boolean(ownerGrant)
        : isAllowedForClassification(user, normalizedClassification);
    const grantAccessMode = grantAccessModeOf(ownerGrant);

    return {
        exists: Boolean(unitKerjaId),
        allowed: unitAllowed && classificationAllowed,
        mutable: unitAllowed && classificationAllowed &&
            metadata?.mutable === true &&
            user?.role !== 'auditor' &&
            (!controlled || grantAccessMode === 'manage'),
        unitKerjaId,
        classification: metadata?.classification || null,
        grantId: ownerGrant?.id || null,
        accessPurpose: ownerGrant?.purpose || null,
        grantAccessMode,
        grantExpiresAt: ownerGrant?.expiresAt || null,
    };
}
```

Lalu ganti badan `check()` (tetap di dalam `recordAccessService`) menjadi:

```ts
    async check(
        user: RecordUser | undefined,
        entityType: RecordEntityType,
        entityId: string,
        executor: Pick<typeof db, 'select'> = db,
    ): Promise<RecordAccessResult> {
        const metadata = await findAccessMetadata(entityType, entityId, executor);
        const unitAllowed = Boolean(metadata?.unitKerjaId) && metadata?.readable === true &&
            isAllowedForRecordUnit(user, metadata!.unitKerjaId);
        const grant = unitAllowed
            ? await findActiveGrant(executor, user, entityType, entityId, metadata!.unitKerjaId, metadata!.classification)
            : null;
        return evaluateOwnerAccess(user, metadata, grant);
    },
```

`inspect()` dan `markGrantUsed()` tidak diubah.

- [ ] **Step 8: Jalankan, pastikan lulus dan snapshot identik**

Run: `cd backend && CI=true npx vitest run src/__tests__/record-access-check.snapshot.integration.test.ts src/__tests__/arsip-update-authorization.integration.test.ts`
Expected: PASS semua. Snapshot "1 passed" tanpa "written"/"updated". Dengan `CI=true`, perbedaan snapshot membuat test gagal alih-alih menulis ulang snapshot.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/record-access.service.ts backend/src/__tests__/record-access-check.snapshot.integration.test.ts
git commit -F - <<'EOF'
refactor(akses): ekstrak findActiveGrant dan evaluateOwnerAccess dari check()

check() tetap identik (snapshot karakterisasi hijau).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Lengkapi `visibility-spec.ts` (aturan murni + fragmen SQL)

**Files:**
- Create: `backend/src/services/access/__tests__/visibility-spec.test.ts`
- Modify: `backend/src/services/access/visibility-spec.ts` (tambahan di akhir file; ekspor P0 tidak diubah)
- Modify: `backend/src/services/record-access.service.ts:30-43,69-78` (delegasi ke spec)

**Interfaces:**
- Consumes from P0: `SECURITY_CLASSES`, `normalizeSecurityClassification`, `klasifikasiNormSql(column: AnyColumn | SQL): SQL<string>` (menerima `SQL` hasil `klasifikasiRekamanSql`).
- Consumes from P1 (berkas yang sama): `jangkauanUnitsSql(rangkaianId: SQLWrapper | string, options?: { disposisiLama?: boolean }): SQL` — satu-satunya definisi himpunan jangkauan §4.5. `jangkauanSql` di bawah **wajib** dirakit darinya, bukan menyalin cabang-cabangnya.
- Produces for P3–P5 (semua dari `backend/src/services/access/visibility-spec.ts`):

```ts
export type JenisRekamanRangkaian = 'surat_masuk' | 'surat_keluar';
export const KELAS_DIKENAL: readonly ['biasa', 'terbatas', 'rahasia', 'sangat_rahasia'];
export const KELAS_TERKENDALI: readonly ['terbatas', 'rahasia', 'sangat_rahasia'];
export const PERAN_FULL_ADMIN: readonly ['super_admin', 'admin_unit', 'admin_dirjen', 'admin_sesditjen'];
export interface PenggunaVisibilitas { id?: string | null; role?: string | null; unitKerjaId?: string | null }
export type KecocokanUnitRekaman = { kind: 'semua' } | { kind: 'tidak_ada' } | { kind: 'sama_dengan'; unitKerjaId: string };
export interface KonteksBaca { user: PenggunaVisibilitas | undefined; unitJangkauan: string | null; pengawas: boolean; disposisiLamaRead: boolean }
export interface TargetVisibilitas { type: JenisRekamanRangkaian; alias: string }
export type PelaksanaSql = { execute: (query: SQL) => PromiseLike<unknown> };
export function kelasUntukRole(role: string | null | undefined): string[];
export function kecocokanUnitRekaman(user: PenggunaVisibilitas | undefined): KecocokanUnitRekaman;
export function cocokUnitRekaman(match: KecocokanUnitRekaman, unitKerjaId: string): boolean;
export function cocokUnitRekamanSql(match: KecocokanUnitRekaman, unitCol: SQLWrapper): SQL;
export function dalamCakupanPengawas(unitKerjaId: string | null | undefined): boolean;
export function dalamCakupanPengawasSql(unitCol: SQLWrapper): SQL;
export function unitJangkauan(user: PenggunaVisibilitas | undefined): string | null;
export function isDisposisiLamaReadEnabled(env?: NodeJS.ProcessEnv): boolean;
export function isAjukanAksesEnabled(env?: NodeJS.ProcessEnv): boolean;
export function jalurJangkauan(ctx: KonteksBaca, unitRekaman: string, peserta: boolean): 'pengawas' | 'peserta' | null;
export function kelasBolehDibacaLintasUnit(user: PenggunaVisibilitas | undefined, kelasNorm: string, adaGrant: boolean): boolean;
export function klasifikasiRekamanSql(type: JenisRekamanRangkaian, alias: string): SQL;
export function jangkauanSql(rangkaianId: SQLWrapper, unitKerjaId: string, disposisiLamaRead: boolean): SQL;
export function jangkauanRekamanSql(ctx: KonteksBaca, type: JenisRekamanRangkaian, alias: string): SQL;
export function grantAktifSql(ctx: KonteksBaca, type: JenisRekamanRangkaian, idCol: SQLWrapper, unitCol: SQLWrapper, kelasNorm: SQLWrapper): SQL;
export function visibleSql(ctx: KonteksBaca, target: TargetVisibilitas, mode?: 'read' | 'list'): SQL;
export async function resolveKonteksBaca(user: PenggunaVisibilitas | undefined, executor: PelaksanaSql, env?: NodeJS.ProcessEnv): Promise<KonteksBaca>;
export function barisDari<T>(result: unknown): T[];
```

- [ ] **Step 1: Tulis test murni yang gagal**

```ts
// backend/src/services/access/__tests__/visibility-spec.test.ts
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
    allowedSecurityClassifications,
    isAllowedForRecordUnit,
} from '../../record-access.service';
import {
    cocokUnitRekaman,
    dalamCakupanPengawas,
    isAjukanAksesEnabled,
    isDisposisiLamaReadEnabled,
    jalurJangkauan,
    kecocokanUnitRekaman,
    kelasBolehDibacaLintasUnit,
    kelasUntukRole,
    unitJangkauan,
    visibleSql,
    type KonteksBaca,
} from '../visibility-spec';

const dialect = new PgDialect();
const render = (query: ReturnType<typeof visibleSql>) => dialect.sqlToQuery(query).sql;
const ctx = (patch: Partial<KonteksBaca> = {}): KonteksBaca => ({
    user: { id: '10000000-0000-4000-8000-000000000002', role: 'admin_unit', unitKerjaId: 'sesditjen' },
    unitJangkauan: 'sesditjen',
    pengawas: true,
    disposisiLamaRead: false,
    ...patch,
});

describe('kelas per role', () => {
    it.each(['super_admin', 'admin_unit', 'admin_dirjen', 'admin_sesditjen', 'staff', 'auditor', 'user', '', null, undefined])(
        'allowedSecurityClassifications mendelegasikan ke kelasUntukRole untuk %s',
        role => {
            expect(allowedSecurityClassifications({ role } as any)).toEqual(kelasUntukRole(role));
        },
    );
    it('menetapkan kelas yang sama dengan kebijakan pra-P2', () => {
        expect(kelasUntukRole('super_admin')).toEqual(['biasa', 'terbatas', 'rahasia', 'sangat_rahasia']);
        expect(kelasUntukRole('admin_unit')).toEqual(['biasa', 'terbatas']);
        expect(kelasUntukRole('staff')).toEqual(['biasa']);
        expect(kelasUntukRole('user')).toEqual([]);
    });
});

describe('kecocokan unit rekaman (sumber tunggal isAllowedForRecordUnit)', () => {
    it.each([
        [{ role: 'admin_unit', unitKerjaId: 'dir_bppt' }, 'dir_bppt', true],
        [{ role: 'admin_unit', unitKerjaId: ' ' }, ' ', false],
        [{ role: 'admin_unit', unitKerjaId: ' dir_bppt' }, 'dir_bppt', false],
        [{ role: 'admin_unit', unitKerjaId: null }, 'dir_bppt', false],
        [{ role: 'staff', unitKerjaId: '' }, '', false],
        [{ role: 'staff', unitKerjaId: 'sesditjen' }, 'sesditjen', true],
        [{ role: 'auditor', unitKerjaId: 'sesditjen' }, 'ditjen', false],
        [{ role: 'admin_dirjen', unitKerjaId: null }, 'ditjen', true],
        [{ role: 'admin_sesditjen', unitKerjaId: 'dir_bppt' }, 'sesditjen', true],
        [{ role: 'admin_sesditjen', unitKerjaId: 'dir_bppt' }, 'dir_bppt', false],
        [{ role: 'super_admin', unitKerjaId: null }, 'bagian_umum', true],
        [{ role: 'user', unitKerjaId: 'dir_bppt' }, 'dir_bppt', false],
        [undefined, 'dir_bppt', false],
    ])('%j terhadap unit %s → %s', (user, unit, expected) => {
        expect(isAllowedForRecordUnit(user as any, unit)).toBe(expected);
        expect(cocokUnitRekaman(kecocokanUnitRekaman(user as any), unit)).toBe(expected);
    });
});

describe('pengawas dan jangkauan', () => {
    it.each([
        ['ditjen', true], ['sesditjen', true], ['dir_bppt', true], ['dir_plp', true],
        ['direktorat-bppt', false], ['bagian_umum', false], ['', false], [null, false],
    ])('cakupan rekaman pengawas %s → %s', (unit, expected) => {
        expect(dalamCakupanPengawas(unit as any)).toBe(expected);
    });
    it.each([
        [{ role: 'super_admin', unitKerjaId: 'sesditjen' }, null],
        [{ role: 'admin_sesditjen', unitKerjaId: null }, 'sesditjen'],
        [{ role: 'admin_dirjen', unitKerjaId: 'dir_bppt' }, 'ditjen'],
        [{ role: 'admin_unit', unitKerjaId: ' dir_bppt ' }, 'dir_bppt'],
        [{ role: 'admin_unit', unitKerjaId: '' }, null],
        [{ role: 'staff', unitKerjaId: 'sesditjen' }, null],
        [{ role: 'auditor', unitKerjaId: 'sesditjen' }, null],
        [{ role: 'user', unitKerjaId: 'sesditjen' }, null],
        [undefined, null],
    ])('unit jangkauan %j → %s', (user, expected) => {
        expect(unitJangkauan(user as any)).toBe(expected);
    });
    it('memilih pengawas lebih dulu, lalu peserta, dan tidak pernah tanpa unit jangkauan', () => {
        expect(jalurJangkauan(ctx(), 'dir_bppt', true)).toBe('pengawas');
        expect(jalurJangkauan(ctx(), 'bagian_umum', true)).toBe('peserta');
        expect(jalurJangkauan(ctx({ pengawas: false }), 'dir_bppt', false)).toBeNull();
        expect(jalurJangkauan(ctx({ pengawas: false, unitJangkauan: null }), 'dir_bppt', true)).toBeNull();
    });
    it('kelas lintas unit: biasa sesuai role, terkendali wajib grant, tak dikenal selalu ditolak', () => {
        expect(kelasBolehDibacaLintasUnit({ role: 'admin_unit' }, 'biasa', false)).toBe(true);
        expect(kelasBolehDibacaLintasUnit({ role: 'user' }, 'biasa', false)).toBe(false);
        expect(kelasBolehDibacaLintasUnit({ role: 'admin_unit' }, 'terbatas', false)).toBe(false);
        expect(kelasBolehDibacaLintasUnit({ role: 'admin_unit' }, 'terbatas', true)).toBe(true);
        expect(kelasBolehDibacaLintasUnit({ role: 'admin_unit' }, 'rahasia_negara', true)).toBe(false);
    });
    it('flag hanya menyala untuk string persis true', () => {
        expect(isDisposisiLamaReadEnabled({ RANGKAIAN_DISPOSISI_LAMA_READ: 'true' })).toBe(true);
        expect(isDisposisiLamaReadEnabled({ RANGKAIAN_DISPOSISI_LAMA_READ: '1' })).toBe(false);
        expect(isDisposisiLamaReadEnabled({})).toBe(false);
        expect(isAjukanAksesEnabled({ RANGKAIAN_AJUKAN_AKSES: 'true' })).toBe(true);
        expect(isAjukanAksesEnabled({ RANGKAIAN_AJUKAN_AKSES: 'TRUE' })).toBe(false);
    });
});

describe('visibleSql', () => {
    it('memperlakukan klasifikasi surat keluar NULL sebagai terbatas', () => {
        expect(render(visibleSql(ctx(), { type: 'surat_keluar', alias: 'r' }))).toContain("coalesce(r.klasifikasi_keamanan, 'terbatas')");
    });
    it('hanya menyertakan cakupan pengawas bila konteks pengawas', () => {
        expect(render(visibleSql(ctx(), { type: 'surat_masuk', alias: 'r' }))).toContain("left(r.unit_kerja_id, 4) = 'dir_'");
        expect(render(visibleSql(ctx({ pengawas: false }), { type: 'surat_masuk', alias: 'r' }))).not.toContain("left(r.unit_kerja_id, 4)");
    });
    it('hanya membaca rangkaian_peserta saat flag data lama menyala', () => {
        expect(render(visibleSql(ctx(), { type: 'surat_masuk', alias: 'r' }))).not.toContain('rangkaian_peserta');
        expect(render(visibleSql(ctx({ disposisiLamaRead: true }), { type: 'surat_masuk', alias: 'r' }))).toContain('rangkaian_peserta');
    });
    it('tidak menjangkau rangkaian tanpa unit jangkauan dan tidak memeriksa grant tanpa id pengguna', () => {
        const text = render(visibleSql(ctx({ unitJangkauan: null, pengawas: false, user: { role: 'staff', unitKerjaId: 'sesditjen' } }), { type: 'surat_masuk', alias: 'r' }));
        expect(text).not.toContain('rangkaian_anggota');
        expect(text).not.toContain('record_access_grants');
    });
    it('menolak alias yang bukan identifier sederhana', () => {
        expect(() => visibleSql(ctx(), { type: 'surat_masuk', alias: 'r; DROP TABLE x' })).toThrow(/alias/i);
    });
    it('menerima SQLWrapper sebagai id rangkaian dan mengikat unit sebagai parameter', () => {
        // pengawas: false agar literal konstanta cakupan pengawas tidak ikut dirender.
        const query = dialect.sqlToQuery(visibleSql(ctx({ pengawas: false }), { type: 'surat_masuk', alias: 'sm' }));
        expect(query.params).toContain('sesditjen');
        expect(query.sql).not.toContain("'sesditjen'");
        expect(query.sql).toContain('sm.sifat_surat');
        expect(sql`x`).toBeDefined();
    });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && npx vitest run src/services/access/__tests__/visibility-spec.test.ts`
Expected: FAIL. Impor `kelasUntukRole`, `visibleSql`, dan lainnya bernilai `undefined` (`TypeError: ... is not a function`).

- [ ] **Step 3: Implementasi di `visibility-spec.ts`**

Tambahkan blok berikut di **akhir** `backend/src/services/access/visibility-spec.ts`. Aturan impor: bila file sudah mengimpor dari `'drizzle-orm'`, gabungkan `sql`, `SQL`, dan `SQLWrapper` ke pernyataan impor yang sudah ada; jangan membuat impor kedua dari modul yang sama. Dua impor lainnya ditambahkan di bagian atas file.

```ts
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { Role } from '../../config/permissions.js';
import { resolveEffectiveUnitKerjaId } from '../../utils/resolve-unit-kerja.js';

// ─── P2: spesifikasi visibilitas lintas unit (satu sumber TS + SQL) ─────────

export type JenisRekamanRangkaian = 'surat_masuk' | 'surat_keluar';
/** Alias ekspor P0 `SECURITY_CLASSES` (satu sumber daftar kelas). */
export const KELAS_DIKENAL = SECURITY_CLASSES;
export const KELAS_TERKENDALI = ['terbatas', 'rahasia', 'sangat_rahasia'] as const;
export const PERAN_FULL_ADMIN = ['super_admin', 'admin_unit', 'admin_dirjen', 'admin_sesditjen'] as const;
/** Unit rekaman yang dijangkau pengawas: ditjen, sesditjen, dan semua dir_*. */
export const UNIT_REKAMAN_PENGAWAS_TETAP = ['ditjen', 'sesditjen'] as const;
export const AWALAN_UNIT_DIREKTORAT = 'dir_';

export interface PenggunaVisibilitas {
    id?: string | null;
    role?: string | null;
    unitKerjaId?: string | null;
}

export type KecocokanUnitRekaman =
    | { kind: 'semua' }
    | { kind: 'tidak_ada' }
    | { kind: 'sama_dengan'; unitKerjaId: string };

export interface KonteksBaca {
    user: PenggunaVisibilitas | undefined;
    /** Unit efektif untuk jangkauan lintas unit; null berarti tidak punya jangkauan. */
    unitJangkauan: string | null;
    pengawas: boolean;
    disposisiLamaRead: boolean;
}

export interface TargetVisibilitas {
    type: JenisRekamanRangkaian;
    /** Alias tabel surat_masuk/surat_keluar di kueri pemanggil. */
    alias: string;
}

export type PelaksanaSql = { execute: (query: SQL) => PromiseLike<unknown> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALIAS_RE = /^[a-z_][a-z0-9_]*$/;

function aliasAman(alias: string): string {
    if (!ALIAS_RE.test(alias)) throw new Error(`Alias SQL tidak valid: ${alias}`);
    return alias;
}

export function barisDari<T>(result: unknown): T[] {
    const value = result as { rows?: unknown[] } | unknown[] | null | undefined;
    if (Array.isArray(value)) return value as T[];
    return (value?.rows ?? []) as T[];
}

export function kelasUntukRole(role: string | null | undefined): string[] {
    // Super administrator pun dibatasi pada kelas yang dikenali kebijakan
    // rekod; mengembalikan null dulu mematikan filter SQL di hilir.
    if (role === 'super_admin') return [...KELAS_DIKENAL];
    if (role === 'admin_unit' || role === 'admin_dirjen' || role === 'admin_sesditjen') return ['biasa', 'terbatas'];
    if (role === 'staff' || role === 'auditor') return ['biasa'];
    return [];
}

export function kecocokanUnitRekaman(user: PenggunaVisibilitas | undefined): KecocokanUnitRekaman {
    const role = user?.role;
    if (!role) return { kind: 'tidak_ada' };
    if (role === 'super_admin') return { kind: 'semua' };
    if (role === 'admin_unit') {
        return user?.unitKerjaId?.trim()
            ? { kind: 'sama_dengan', unitKerjaId: user.unitKerjaId }
            : { kind: 'tidak_ada' };
    }
    if (role === 'admin_dirjen') return { kind: 'sama_dengan', unitKerjaId: 'ditjen' };
    if (role === 'admin_sesditjen') return { kind: 'sama_dengan', unitKerjaId: 'sesditjen' };
    if (role === 'staff' || role === 'auditor') {
        return user?.unitKerjaId
            ? { kind: 'sama_dengan', unitKerjaId: user.unitKerjaId }
            : { kind: 'tidak_ada' };
    }
    return { kind: 'tidak_ada' };
}

export function cocokUnitRekaman(match: KecocokanUnitRekaman, unitKerjaId: string): boolean {
    if (match.kind === 'semua') return true;
    if (match.kind === 'tidak_ada') return false;
    return match.unitKerjaId === unitKerjaId;
}

export function cocokUnitRekamanSql(match: KecocokanUnitRekaman, unitCol: SQLWrapper): SQL {
    if (match.kind === 'semua') return sql`true`;
    if (match.kind === 'tidak_ada') return sql`false`;
    return sql`${unitCol} = ${match.unitKerjaId}`;
}

export function dalamCakupanPengawas(unitKerjaId: string | null | undefined): boolean {
    if (!unitKerjaId) return false;
    return (UNIT_REKAMAN_PENGAWAS_TETAP as readonly string[]).includes(unitKerjaId)
        || unitKerjaId.startsWith(AWALAN_UNIT_DIREKTORAT);
}

export function dalamCakupanPengawasSql(unitCol: SQLWrapper): SQL {
    return sql`(${unitCol} IN ('ditjen', 'sesditjen') OR left(${unitCol}, 4) = 'dir_')`;
}

/** Unit efektif untuk jangkauan pengawas/peserta. Hanya FULL_ADMIN non-super_admin (D5). */
export function unitJangkauan(user: PenggunaVisibilitas | undefined): string | null {
    const role = user?.role;
    if (!role || role === 'super_admin') return null;
    if (!(PERAN_FULL_ADMIN as readonly string[]).includes(role)) return null;
    return resolveEffectiveUnitKerjaId(role as Role, user?.unitKerjaId ?? null);
}

export function isDisposisiLamaReadEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.RANGKAIAN_DISPOSISI_LAMA_READ === 'true';
}

export function isAjukanAksesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.RANGKAIAN_AJUKAN_AKSES === 'true';
}

export function jalurJangkauan(
    ctx: KonteksBaca,
    unitRekaman: string,
    peserta: boolean,
): 'pengawas' | 'peserta' | null {
    if (ctx.pengawas && dalamCakupanPengawas(unitRekaman)) return 'pengawas';
    if (ctx.unitJangkauan && peserta) return 'peserta';
    return null;
}

export function kelasBolehDibacaLintasUnit(
    user: PenggunaVisibilitas | undefined,
    kelasNorm: string,
    adaGrant: boolean,
): boolean {
    if (kelasNorm === 'biasa') return kelasUntukRole(user?.role).includes('biasa');
    if ((KELAS_TERKENDALI as readonly string[]).includes(kelasNorm)) return adaGrant;
    return false;
}

/** Nilai klasifikasi mentah rekaman; surat keluar lama (NULL) = terbatas. */
export function klasifikasiRekamanSql(type: JenisRekamanRangkaian, alias: string): SQL {
    const a = aliasAman(alias);
    return type === 'surat_masuk'
        ? sql.raw(`${a}.sifat_surat`)
        : sql.raw(`coalesce(${a}.klasifikasi_keamanan, 'terbatas')`);
}

/**
 * Predikat "unit ∈ jangkauan(R)" (spec §4.5). Dirakit dari jangkauanUnitsSql
 * (P1, berkas ini) sehingga himpunan jangkauan hanya punya satu definisi;
 * cabang rangkaian_peserta hanya ikut bila disposisiLamaRead (flag P5) true.
 */
export function jangkauanSql(rangkaianId: SQLWrapper, unitKerjaId: string, disposisiLamaRead: boolean): SQL {
    return sql`(${unitKerjaId} IN (SELECT j.unit_kerja_id FROM ${jangkauanUnitsSql(rangkaianId, { disposisiLama: disposisiLamaRead })} AS j))`;
}

export function jangkauanRekamanSql(ctx: KonteksBaca, type: JenisRekamanRangkaian, alias: string): SQL {
    const a = aliasAman(alias);
    const parts: SQL[] = [];
    if (ctx.pengawas) parts.push(dalamCakupanPengawasSql(sql.raw(`${a}.unit_kerja_id`)));
    if (ctx.unitJangkauan) {
        const fk = type === 'surat_masuk' ? 'surat_masuk_id' : 'surat_keluar_id';
        parts.push(sql`EXISTS (SELECT 1 FROM rangkaian_anggota ra WHERE ra.${sql.raw(fk)} = ${sql.raw(`${a}.id`)} AND ${jangkauanSql(sql.raw('ra.rangkaian_id'), ctx.unitJangkauan, ctx.disposisiLamaRead)})`);
    }
    return parts.length ? sql`(${sql.join(parts, sql` OR `)})` : sql`false`;
}

export function grantAktifSql(
    ctx: KonteksBaca,
    type: JenisRekamanRangkaian,
    idCol: SQLWrapper,
    unitCol: SQLWrapper,
    kelasNorm: SQLWrapper,
): SQL {
    const userId = ctx.user?.id;
    if (!userId || !UUID_RE.test(userId)) return sql`false`;
    return sql`EXISTS (
        SELECT 1 FROM record_access_grants g
        WHERE g.target_user_id = ${userId}::uuid
          AND g.entity_type = ${type}
          AND g.entity_id = ${idCol}
          AND g.unit_kerja_id = ${unitCol}
          AND g.required_classification = ${kelasNorm}
          AND g.status = 'approved'
          AND g.expires_at > now()
    )`;
}

/**
 * Predikat visibilitas SQL. Mode 'read' identik dengan checkRead (property
 * test). Mode 'list' melonggarkan hanya unit sendiri ke kebijakan list lama
 * (kelasUntukRole); bagian lintas unit sama dengan mode 'read'.
 */
export function visibleSql(ctx: KonteksBaca, target: TargetVisibilitas, mode: 'read' | 'list' = 'read'): SQL {
    const a = aliasAman(target.alias);
    const id = sql.raw(`${a}.id`);
    const unit = sql.raw(`${a}.unit_kerja_id`);
    const kelas = klasifikasiNormSql(klasifikasiRekamanSql(target.type, a));
    const kelasRole = kelasUntukRole(ctx.user?.role);
    const terkendali = sql`${kelas} IN ('terbatas', 'rahasia', 'sangat_rahasia')`;
    const grant = grantAktifSql(ctx, target.type, id, unit, kelas);
    const kelasBaca = sql`((${kelas} = 'biasa' AND ${kelasRole.includes('biasa') ? sql`true` : sql`false`}) OR (${terkendali} AND ${grant}))`;
    const kelasList = kelasRole.length
        ? sql`${kelas} IN (${sql.join(kelasRole.map(k => sql`${k}`), sql`, `)})`
        : sql`false`;
    const unitSendiri = cocokUnitRekamanSql(kecocokanUnitRekaman(ctx.user), unit);
    const pemilik = mode === 'read'
        ? sql`(${unitSendiri} AND ${kelasBaca})`
        : sql`(${unitSendiri} AND ${kelasList})`;
    const lintas = sql`(${jangkauanRekamanSql(ctx, target.type, a)} AND ${kelasBaca})`;
    return sql`(${sql.raw(`${a}.is_deleted IS NOT TRUE`)} AND (${pemilik} OR ${lintas}))`;
}

export async function resolveKonteksBaca(
    user: PenggunaVisibilitas | undefined,
    executor: PelaksanaSql,
    env: NodeJS.ProcessEnv = process.env,
): Promise<KonteksBaca> {
    const unit = unitJangkauan(user);
    let pengawas = false;
    if (unit) {
        const [row] = barisDari<{ pengawas: boolean }>(await executor.execute(
            sql`SELECT is_unit_pengawas AS "pengawas" FROM unit_kerja WHERE id = ${unit} LIMIT 1`,
        ));
        pengawas = row?.pengawas === true;
    }
    return { user, unitJangkauan: unit, pengawas, disposisiLamaRead: isDisposisiLamaReadEnabled(env) };
}
```

Lalu, di `record-access.service.ts`, ganti badan dua fungsi berikut (tanda tangannya tetap) dan tambahkan `cocokUnitRekaman`, `kecocokanUnitRekaman`, `kelasUntukRole` ke impor dari `'./access/visibility-spec'`:

```ts
export function allowedSecurityClassifications(
    user: RecordUser | undefined,
): string[] {
    return kelasUntukRole(user?.role);
}

export function isAllowedForRecordUnit(user: RecordUser | undefined, unitKerjaId: string): boolean {
    return cocokUnitRekaman(kecocokanUnitRekaman(user), unitKerjaId);
}
```

- [ ] **Step 4: Jalankan, pastikan lulus (termasuk snapshot)**

Run: `cd backend && CI=true npx vitest run src/services/access/__tests__/visibility-spec.test.ts src/__tests__/record-access-check.snapshot.integration.test.ts`
Expected: PASS semua. Snapshot tidak berubah.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/access/visibility-spec.ts backend/src/services/access/__tests__/visibility-spec.test.ts backend/src/services/record-access.service.ts
git commit -F - <<'EOF'
feat(akses): lengkapi visibility-spec dengan aturan pengawas, jangkauan, dan visibleSql

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: `checkMany` / `checkRead` + matriks keamanan tingkat service

**Files:**
- Create: `backend/src/__tests__/record-access-read.integration.test.ts`
- Modify: `backend/src/services/record-access.service.ts` (tambahan tipe + dua method di `recordAccessService`)

**Interfaces:**
- Consumes: Task 1 (`evaluateOwnerAccess`, `activeGrantConditions`, `grantAccessModeOf`), Task 2 (`resolveKonteksBaca`, `jangkauanSql`, `klasifikasiRekamanSql`, `jalurJangkauan`, `kelasBolehDibacaLintasUnit`, `barisDari`, `JenisRekamanRangkaian`).
- Produces for P3–P5:

```ts
export type ReadVia = 'owner' | 'pengawas' | 'peserta';
export interface ReadRef { type: JenisRekamanRangkaian; id: string }
export interface ReadAccessResult extends RecordAccessResult {
    via: ReadVia | null;          // null = tidak ada jalur baca
    rangkaianId: string | null;   // diisi bila via ≠ null
    masked: boolean;              // true = terjangkau tetapi kelas tidak boleh dibaca → placeholder
}
export type ReadExecutor = Pick<typeof db, 'select' | 'execute'>;
export function readRefKey(ref: ReadRef): string; // `${type}:${id}`
recordAccessService.checkMany(user: RecordUser | undefined, refs: ReadRef[], executor?: ReadExecutor): Promise<Map<string, ReadAccessResult>>;
recordAccessService.checkRead(user: RecordUser | undefined, entityType: JenisRekamanRangkaian, entityId: string, executor?: ReadExecutor): Promise<ReadAccessResult>;
```

- [ ] **Step 1: Tulis matriks yang gagal**

```ts
// backend/src/__tests__/record-access-read.integration.test.ts
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import {
    PENGGUNA, RANGKAIAN, SURAT, GRANT,
    bootRangkaianDatabase, seedRangkaianFixture,
} from './helpers/rangkaian-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let mod: typeof import('../services/record-access.service');

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    mod = await import('../services/record-access.service');
}, 60_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => { await seedRangkaianFixture(database); });
afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.RANGKAIAN_DISPOSISI_LAMA_READ;
});

type Harapan = { allowed: boolean; via: 'owner' | 'pengawas' | 'peserta' | null; masked: boolean };
const ya = (via: Harapan['via']): Harapan => ({ allowed: true, via, masked: false });
const tidak: Harapan = { allowed: false, via: null, masked: false };
const samar = (via: Harapan['via']): Harapan => ({ allowed: false, via, masked: true });

const matriks: Array<[string, any, 'surat_masuk' | 'surat_keluar', string, Harapan]> = [
    ['TU membaca surat masuk miliknya', PENGGUNA.tu, 'surat_masuk', SURAT.smBiasa, ya('owner')],
    ['admin_unit@sesditjen adalah pengawas: ND biasa BPPT', PENGGUNA.tu, 'surat_keluar', SURAT.skBpptBiasa, ya('pengawas')],
    ['pengawas + grant terikat unit BPPT: ND terkendali terbaca', PENGGUNA.tu, 'surat_keluar', SURAT.skBpptNull, ya('pengawas')],
    ['pengawas menjangkau surat tunggal dir_* di luar rangkaian', PENGGUNA.tu, 'surat_keluar', SURAT.skBpptTunggal, ya('pengawas')],
    ['pengawas tidak menjangkau unit bagian', PENGGUNA.tu, 'surat_masuk', SURAT.smBagian, tidak],
    ['grant kedaluwarsa: surat terbatas milik TU tersamar', PENGGUNA.tu, 'surat_masuk', SURAT.smTerbatas, samar('pengawas')],
    ['admin_sesditjen dengan unit NULL tetap pengawas', PENGGUNA.adminSesNull, 'surat_keluar', SURAT.skBpptBiasa, ya('pengawas')],
    ['admin_sesditjen: grant terikat unit lain tidak berlaku', PENGGUNA.adminSesNull, 'surat_keluar', SURAT.skBpptNull, samar('pengawas')],
    ['BPPT peserta membaca induk surat masuk', PENGGUNA.bppt, 'surat_masuk', SURAT.smBiasa, ya('peserta')],
    ['BPPT: grant tanpa jangkauan tidak membuka surat', PENGGUNA.bppt, 'surat_masuk', SURAT.smTerbatas, tidak],
    ['admin_unit@dir_bppt bukan pengawas: surat tunggal TU tertutup', PENGGUNA.bppt, 'surat_masuk', SURAT.smTunggal, tidak],
    ['BPPT tidak menjangkau rangkaian lain', PENGGUNA.bppt, 'surat_keluar', SURAT.skPtepBiasa, tidak],
    ['BPPT tanpa grant atas ND terkendalinya: tersamar via peserta', PENGGUNA.bppt, 'surat_keluar', SURAT.skBpptNull, samar('peserta')],
    ['PTEP dengan disposisi ditolak tidak punya jangkauan', PENGGUNA.ptep, 'surat_masuk', SURAT.smBiasa, tidak],
    ['PTEP peserta + grant membaca surat terbatas', PENGGUNA.ptep, 'surat_masuk', SURAT.smTerbatas, ya('peserta')],
    ['PLP bukan peserta', PENGGUNA.plp, 'surat_masuk', SURAT.smBiasa, tidak],
    ['staff lama tanpa jangkauan lintas unit', PENGGUNA.staffSes, 'surat_keluar', SURAT.skBpptBiasa, tidak],
    ['staff lama tetap membaca surat biasa unitnya', PENGGUNA.staffSes, 'surat_masuk', SURAT.smBiasa, ya('owner')],
    ['auditor lama tanpa jangkauan lintas unit', PENGGUNA.auditorSes, 'surat_keluar', SURAT.skBpptBiasa, tidak],
    ['super_admin tetap wajib grant untuk kelas terkendali', PENGGUNA.superAdmin, 'surat_keluar', SURAT.skBpptNull, tidak],
    ['super_admin membaca surat biasa unit mana pun', PENGGUNA.superAdmin, 'surat_keluar', SURAT.skBpptBiasa, ya('owner')],
];

describe('checkRead: matriks unit × role × kelas × grant × jangkauan', () => {
    it.each(matriks)('%s', async (_nama, user, type, id, harapan) => {
        const read = await mod.recordAccessService.checkRead(user, type, id);
        expect({ allowed: read.allowed, via: read.via, masked: read.masked }).toEqual(harapan);
        const owner = await mod.recordAccessService.check(user, type, id);
        if (harapan.via === 'owner') {
            expect(read).toEqual({ ...owner, via: 'owner', rangkaianId: read.rangkaianId, masked: false });
        } else {
            expect(owner.allowed).toBe(false);
            expect(read.mutable).toBe(false);
        }
        if (harapan.via === 'pengawas' || harapan.via === 'peserta') {
            expect(read.unitKerjaId).not.toBeNull();
        }
    });

    it('grant manage lintas unit tetap read-only', async () => {
        const read = await mod.recordAccessService.checkRead(PENGGUNA.tu, 'surat_keluar', SURAT.skBpptNull);
        expect(read).toMatchObject({ allowed: true, via: 'pengawas', mutable: false, grantId: GRANT.tuSkBpptNull, grantAccessMode: 'manage', rangkaianId: RANGKAIAN.rs1 });
    });

    it('status pengawas mengikuti is_unit_pengawas unit efektif', async () => {
        await database.exec(`UPDATE unit_kerja SET is_unit_pengawas = false WHERE id = 'sesditjen'`);
        const read = await mod.recordAccessService.checkRead(PENGGUNA.tu, 'surat_keluar', SURAT.skBpptTunggal);
        expect(read).toMatchObject({ allowed: false, via: null });
        // Sebagai pencatat RS1, TU tetap peserta atas anggota RS1.
        expect((await mod.recordAccessService.checkRead(PENGGUNA.tu, 'surat_keluar', SURAT.skBpptBiasa)).via).toBe('peserta');
    });

    it('penolakan disposisi mencabut jangkauan seketika', async () => {
        await database.exec(`INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status, rangkaian_id)
            VALUES ('${SURAT.smBiasa}','sesditjen','dir_plp','sent','${RANGKAIAN.rs1}')`);
        expect((await mod.recordAccessService.checkRead(PENGGUNA.plp, 'surat_masuk', SURAT.smBiasa)).via).toBe('peserta');
        await database.exec(`UPDATE surat_distributions SET status = 'rejected', rejection_reason = 'Bukan kewenangan PLP' WHERE target_unit_id = 'dir_plp'`);
        expect(await mod.recordAccessService.checkRead(PENGGUNA.plp, 'surat_masuk', SURAT.smBiasa)).toMatchObject({ allowed: false, via: null });
    });

    it('peserta data lama hanya berlaku saat flag menyala', async () => {
        await database.exec(`INSERT INTO rangkaian_peserta (rangkaian_id, unit_kerja_id, peran, label_asal) VALUES ('${RANGKAIAN.rs1}','dir_plp','disposisi_lama','PLP')`);
        expect((await mod.recordAccessService.checkRead(PENGGUNA.plp, 'surat_masuk', SURAT.smBiasa)).allowed).toBe(false);
        process.env.RANGKAIAN_DISPOSISI_LAMA_READ = 'true';
        expect((await mod.recordAccessService.checkRead(PENGGUNA.plp, 'surat_masuk', SURAT.smBiasa)).via).toBe('peserta');
    });

    it('rekaman terhapus tidak terbaca lintas unit', async () => {
        await database.exec(`UPDATE surat_keluar SET is_deleted = true WHERE id = '${SURAT.skBpptBiasa}'`);
        expect(await mod.recordAccessService.checkRead(PENGGUNA.tu, 'surat_keluar', SURAT.skBpptBiasa)).toMatchObject({ allowed: false, via: null, masked: false });
    });

    it('rekaman tidak ada → exists false', async () => {
        expect(await mod.recordAccessService.checkRead(PENGGUNA.tu, 'surat_masuk', '39999999-0000-4000-8000-000000000000'))
            .toMatchObject({ exists: false, allowed: false, via: null });
    });

    it('checkMany memproses batch dengan jumlah kueri tetap (tanpa N+1)', async () => {
        const refs = Object.entries(SURAT).map(([nama, id]) => ({ type: (nama.startsWith('sm') ? 'surat_masuk' : 'surat_keluar') as 'surat_masuk' | 'surat_keluar', id }));
        const execute = vi.spyOn(holder.db, 'execute');
        const select = vi.spyOn(holder.db, 'select');
        const batch = await mod.recordAccessService.checkMany(PENGGUNA.tu, [...refs, ...refs]);
        expect(batch.size).toBe(refs.length);
        expect(execute.mock.calls.length).toBeLessThanOrEqual(3);
        expect(select.mock.calls.length).toBeLessThanOrEqual(1);
        execute.mockRestore();
        select.mockRestore();
        for (const ref of refs) {
            expect(batch.get(mod.readRefKey(ref))).toEqual(await mod.recordAccessService.checkRead(PENGGUNA.tu, ref.type, ref.id));
        }
    });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/record-access-read.integration.test.ts`
Expected: FAIL dengan `mod.recordAccessService.checkRead is not a function`.

- [ ] **Step 3: Implementasi di `record-access.service.ts`**

Tambahkan ke impor drizzle: `or`, `sql` (sehingga menjadi `import { and, desc, eq, gt, or, sql, type SQL } from 'drizzle-orm';`). Tambahkan ke impor `'./access/visibility-spec'`: `barisDari`, `jalurJangkauan`, `jangkauanSql`, `kelasBolehDibacaLintasUnit`, `klasifikasiRekamanSql`, `resolveKonteksBaca`, `type JenisRekamanRangkaian`. Letakkan kode berikut setelah `evaluateOwnerAccess`:

```ts
export type ReadVia = 'owner' | 'pengawas' | 'peserta';
export interface ReadRef { type: JenisRekamanRangkaian; id: string }
export interface ReadAccessResult extends RecordAccessResult {
    via: ReadVia | null;
    rangkaianId: string | null;
    masked: boolean;
}
export type ReadExecutor = Pick<typeof db, 'select' | 'execute'>;

export function readRefKey(ref: ReadRef): string {
    return `${ref.type}:${ref.id}`;
}

function inaccessibleReadResult(): ReadAccessResult {
    return {
        exists: false, allowed: false, mutable: false, unitKerjaId: null, classification: null,
        grantId: null, accessPurpose: null, grantAccessMode: null, grantExpiresAt: null,
        via: null, rangkaianId: null, masked: false,
    };
}

interface ReadMetadataRow extends AccessMetadata {
    id: string;
    rangkaianId: string | null;
    peserta: boolean;
}

async function findReadMetadata(
    executor: ReadExecutor,
    ctx: Awaited<ReturnType<typeof resolveKonteksBaca>>,
    type: JenisRekamanRangkaian,
    ids: string[],
): Promise<ReadMetadataRow[]> {
    if (ids.length === 0) return [];
    const table = type === 'surat_masuk' ? 'surat_masuk' : 'surat_keluar';
    const fk = type === 'surat_masuk' ? 'surat_masuk_id' : 'surat_keluar_id';
    const peserta = ctx.unitJangkauan
        ? jangkauanSql(sql.raw('ra.rangkaian_id'), ctx.unitJangkauan, ctx.disposisiLamaRead)
        : sql`false`;
    return barisDari<ReadMetadataRow>(await executor.execute(sql`
        SELECT r.id::text AS "id",
               r.unit_kerja_id AS "unitKerjaId",
               ${klasifikasiRekamanSql(type, 'r')} AS "classification",
               (r.is_deleted IS NOT TRUE) AS "readable",
               (r.is_deleted IS NOT TRUE AND r.is_archived IS NOT TRUE) AS "mutable",
               ra.rangkaian_id::text AS "rangkaianId",
               coalesce(${peserta}, false) AS "peserta"
        FROM ${sql.raw(table)} r
        LEFT JOIN rangkaian_anggota ra ON ra.${sql.raw(fk)} = r.id
        WHERE r.id IN (${sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)})
    `));
}

async function findActiveGrantsMany(
    executor: ReadExecutor,
    user: RecordUser | undefined,
    items: Array<{ type: JenisRekamanRangkaian; id: string; unitKerjaId: string; classification: string | null }>,
): Promise<Map<string, ActiveGrant>> {
    const grants = new Map<string, ActiveGrant>();
    if (!user?.id) return grants;
    const controlled = items
        .map(item => ({ ...item, normalized: normalizeSecurityClassification(item.classification) }))
        .filter(item => requiresExplicitAccessGrant(item.normalized));
    if (controlled.length === 0) return grants;
    const rows = await executor
        .select({
            id: recordAccessGrants.id,
            purpose: recordAccessGrants.purpose,
            accessMode: recordAccessGrants.accessMode,
            expiresAt: recordAccessGrants.expiresAt,
            entityType: recordAccessGrants.entityType,
            entityId: recordAccessGrants.entityId,
        })
        .from(recordAccessGrants)
        .where(or(...controlled.map(item =>
            activeGrantConditions(user.id!, item.type, item.id, item.unitKerjaId, item.normalized))))
        .orderBy(desc(recordAccessGrants.decidedAt));
    for (const row of rows) {
        const key = `${row.entityType}:${row.entityId}`;
        if (!grants.has(key)) {
            grants.set(key, { id: row.id, purpose: row.purpose, accessMode: row.accessMode, expiresAt: row.expiresAt });
        }
    }
    return grants;
}
```

Tambahkan dua method di dalam `recordAccessService`, setelah `check()`:

```ts
    /**
     * Keputusan baca batch (read-only). Pemilik dinilai persis seperti check();
     * bila gagal, jangkauan pengawas/peserta dihitung ulang setiap panggilan.
     * Kueri: konteks (≤1) + metadata per tipe (≤2) + grant (≤1).
     */
    async checkMany(
        user: RecordUser | undefined,
        refs: ReadRef[],
        executor: ReadExecutor = db,
    ): Promise<Map<string, ReadAccessResult>> {
        const unique = [...new Map(refs.map(ref => [readRefKey(ref), ref])).values()];
        const results = new Map<string, ReadAccessResult>();
        if (unique.length === 0) return results;

        const ctx = await resolveKonteksBaca(user, executor);
        const metadata = new Map<string, ReadMetadataRow>();
        for (const type of ['surat_masuk', 'surat_keluar'] as const) {
            const ids = unique.filter(ref => ref.type === type).map(ref => ref.id);
            for (const row of await findReadMetadata(executor, ctx, type, ids)) {
                metadata.set(readRefKey({ type, id: row.id }), row);
            }
        }
        const grants = await findActiveGrantsMany(executor, user, unique.flatMap(ref => {
            const row = metadata.get(readRefKey(ref));
            return row ? [{ type: ref.type, id: ref.id, unitKerjaId: row.unitKerjaId, classification: row.classification }] : [];
        }));

        for (const ref of unique) {
            const key = readRefKey(ref);
            const row = metadata.get(key);
            if (!row) {
                results.set(key, inaccessibleReadResult());
                continue;
            }
            const grant = grants.get(key) ?? null;
            const owner = evaluateOwnerAccess(user, row, grant);
            if (owner.allowed) {
                results.set(key, { ...owner, via: 'owner', rangkaianId: row.rangkaianId, masked: false });
                continue;
            }
            const jalur = row.readable ? jalurJangkauan(ctx, row.unitKerjaId, row.peserta === true) : null;
            if (!jalur) {
                results.set(key, { ...owner, via: null, rangkaianId: null, masked: false });
                continue;
            }
            const kelas = normalizeSecurityClassification(row.classification);
            const allowed = kelasBolehDibacaLintasUnit(user, kelas, Boolean(grant));
            const crossGrant = allowed && requiresExplicitAccessGrant(kelas) ? grant : null;
            results.set(key, {
                exists: true,
                allowed,
                mutable: false,
                unitKerjaId: row.unitKerjaId,
                classification: row.classification || null,
                grantId: crossGrant?.id || null,
                accessPurpose: crossGrant?.purpose || null,
                grantAccessMode: grantAccessModeOf(crossGrant),
                grantExpiresAt: crossGrant?.expiresAt || null,
                via: jalur,
                rangkaianId: row.rangkaianId,
                masked: !allowed,
            });
        }
        return results;
    },

    async checkRead(
        user: RecordUser | undefined,
        entityType: JenisRekamanRangkaian,
        entityId: string,
        executor: ReadExecutor = db,
    ): Promise<ReadAccessResult> {
        const ref = { type: entityType, id: entityId };
        const results = await recordAccessService.checkMany(user, [ref], executor);
        return results.get(readRefKey(ref)) ?? inaccessibleReadResult();
    },
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `cd backend && CI=true npx vitest run src/__tests__/record-access-read.integration.test.ts src/__tests__/record-access-check.snapshot.integration.test.ts`
Expected: PASS (21 baris matriks + 7 test tambahan; snapshot tidak berubah).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/record-access.service.ts backend/src/__tests__/record-access-read.integration.test.ts
git commit -F - <<'EOF'
feat(akses): checkRead/checkMany read-only dengan jangkauan pengawas dan peserta

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Property test paritas `checkRead` ↔ `visibleSql`

**Files:**
- Create: `backend/src/__tests__/visibility-parity.property.integration.test.ts`
- (Tidak ada perubahan `visibility-spec.ts`: `klasifikasiNormSql` P0 sudah memakai `coalesce(nullif(col, ''), 'biasa')`.)

**Interfaces:**
- Consumes: `recordAccessService.checkMany`, `readRefKey`, `visibleSql`, `resolveKonteksBaca`, `klasifikasiNormSql`, `normalizeSecurityClassification`, `kecocokanUnitRekaman`, `cocokUnitRekaman`, `kelasUntukRole`, `barisDari`.
- Produces: jaminan paritas yang dipakai P3 (kotak disposisi) dan P4 (seed Lacak).

- [ ] **Step 1: Tulis property test**

```ts
// backend/src/__tests__/visibility-parity.property.integration.test.ts
import type { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { RANGKAIAN, USER_ID, bootRangkaianDatabase, seedRangkaianFixture } from './helpers/rangkaian-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let access: typeof import('../services/record-access.service');
let spec: typeof import('../services/access/visibility-spec');

function mulberry32(seed: number) {
    let state = seed;
    return () => {
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const SIFAT = ['', ' ', 'Sangat Segera', 'sangat-segera', ' SANGAT  SEGERA ', 'Rahasia', 'sangat rahasia',
    'Sangat_Rahasia', 'Biasa/Terbuka', 'Penting', 'Undangan', 'rahasia negara', null, 'TERBATAS', 'segera'];
const KELAS_SK = [null, 'biasa', 'terbatas', 'rahasia', 'sangat_rahasia'];
const UNIT_REKAMAN = ['ditjen', 'sesditjen', 'dir_bppt', 'dir_ptep', 'bagian_umum'];
const ROLES = ['super_admin', 'admin_unit', 'admin_dirjen', 'admin_sesditjen', 'staff', 'auditor', 'user', null];
const UNIT_PENGGUNA = ['ditjen', 'sesditjen', 'dir_bppt', 'dir_ptep', 'dir_plp', 'bagian_umum', null, '', '  '];
const ID_PENGGUNA = [...Object.values(USER_ID).filter(id => id !== USER_ID.approver), null];

const literal = (value: string | null) => value === null ? 'NULL' : `'${value.replace(/'/g, "''")}'`;

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    access = await import('../services/record-access.service');
    spec = await import('../services/access/visibility-spec');
    await seedRangkaianFixture(database);
    const sm: string[] = []; const sk: string[] = [];
    for (let g = 1; g <= 45; g += 1) {
        const id = `31000000-0000-4000-8000-${String(g).padStart(12, '0')}`;
        sm.push(`('${id}','${UNIT_REKAMAN[g % 5]}',${100 + g},2026,${literal(SIFAT[g % SIFAT.length])},'Varian masuk ${g}')`);
    }
    for (let g = 1; g <= 25; g += 1) {
        const id = `41000000-0000-4000-8000-${String(g).padStart(12, '0')}`;
        sk.push(`('${id}','${UNIT_REKAMAN[g % 5]}',${100 + g},2026,${literal(KELAS_SK[g % KELAS_SK.length])},'Varian keluar ${g}')`);
    }
    await database.exec(`
        INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, sifat_surat, perihal) VALUES ${sm.join(',')};
        INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, klasifikasi_keamanan, perihal) VALUES ${sk.join(',')};
        UPDATE surat_masuk SET is_deleted = true WHERE no_urut IN (107, 121);
        INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber)
            SELECT CASE WHEN no_urut % 2 = 0 THEN '${RANGKAIAN.rs1}'::uuid ELSE '${RANGKAIAN.rs2}'::uuid END, id, unit_kerja_id, 'anggota', 'aplikasi'
            FROM surat_masuk WHERE id::text LIKE '31000000%' AND no_urut % 3 = 0;
        INSERT INTO rangkaian_anggota (rangkaian_id, surat_keluar_id, unit_kerja_id, peran, sumber)
            SELECT '${RANGKAIAN.rs2}'::uuid, id, unit_kerja_id, 'anggota', 'aplikasi'
            FROM surat_keluar WHERE id::text LIKE '41000000%' AND no_urut % 4 = 0;
        INSERT INTO rangkaian_peserta (rangkaian_id, unit_kerja_id, peran, label_asal) VALUES ('${RANGKAIAN.rs2}','dir_bppt','disposisi_lama','BPPT');
        INSERT INTO record_access_grants (requester_id, target_user_id, entity_type, entity_id, unit_kerja_id, required_classification, purpose, access_mode, status, decided_by, decided_at, decision_reason, expires_at)
            SELECT u.id, u.id, 'surat_masuk', s.id, s.unit_kerja_id, 'terbatas', 'Uji properti paritas visibilitas', 'view', 'approved', '${USER_ID.approver}', '2026-09-01T00:00:00Z', 'Uji properti terverifikasi', '2099-01-01T00:00:00Z'
            FROM users u JOIN surat_masuk s ON (s.no_urut + ascii(right(u.id::text, 1))) % 4 = 0
            WHERE s.id::text LIKE '31000000%' AND u.id <> '${USER_ID.approver}';
        INSERT INTO record_access_grants (requester_id, target_user_id, entity_type, entity_id, unit_kerja_id, required_classification, purpose, access_mode, status, decided_by, decided_at, decision_reason, expires_at)
            SELECT u.id, u.id, 'surat_keluar', s.id, s.unit_kerja_id, 'rahasia', 'Uji properti paritas visibilitas', 'view', 'approved', '${USER_ID.approver}', '2026-09-01T00:00:00Z', 'Uji properti terverifikasi', '2099-01-01T00:00:00Z'
            FROM users u JOIN surat_keluar s ON (s.no_urut + ascii(right(u.id::text, 1))) % 3 = 1
            WHERE s.id::text LIKE '41000000%' AND u.id <> '${USER_ID.approver}';
    `);
}, 90_000);
afterAll(async () => { await database?.close(); });
afterEach(() => { delete process.env.RANGKAIAN_DISPOSISI_LAMA_READ; });

async function semuaRef() {
    const rows = spec.barisDari<{ type: 'surat_masuk' | 'surat_keluar'; id: string }>(await holder.db.execute(sql`
        SELECT 'surat_masuk' AS "type", id::text AS "id" FROM surat_masuk
        UNION ALL SELECT 'surat_keluar', id::text FROM surat_keluar`));
    return rows;
}

async function kunciTerlihat(ctx: any, mode: 'read' | 'list') {
    const rows = spec.barisDari<{ key: string }>(await holder.db.execute(sql`
        SELECT 'surat_masuk:' || r.id::text AS "key" FROM surat_masuk r WHERE ${spec.visibleSql(ctx, { type: 'surat_masuk', alias: 'r' }, mode)}
        UNION ALL
        SELECT 'surat_keluar:' || r.id::text FROM surat_keluar r WHERE ${spec.visibleSql(ctx, { type: 'surat_keluar', alias: 'r' }, mode)}`));
    return new Set(rows.map(row => row.key));
}

describe('paritas TS ↔ SQL', () => {
    it.each(SIFAT)('normalisasi sifat %j identik di TS dan SQL', async value => {
        const [row] = spec.barisDari<{ kelas: string }>(await holder.db.execute(
            sql`SELECT ${spec.klasifikasiNormSql(sql`${value}::text`)} AS "kelas"`,
        ));
        expect(row.kelas).toBe(spec.normalizeSecurityClassification(value));
    });

    it('checkRead dan visibleSql(read) identik untuk 300 kombinasi acak', async () => {
        const random = mulberry32(20260926);
        const pick = <T,>(values: readonly T[]) => values[Math.floor(random() * values.length)];
        const refs = await semuaRef();
        for (let i = 0; i < 300; i += 1) {
            const user = i === 0 ? undefined : { id: pick(ID_PENGGUNA), role: pick(ROLES), unitKerjaId: pick(UNIT_PENGGUNA) };
            process.env.RANGKAIAN_DISPOSISI_LAMA_READ = pick(['true', 'false']);
            const hasil = await access.recordAccessService.checkMany(user as any, refs);
            const terlihat = await kunciTerlihat(await spec.resolveKonteksBaca(user as any, holder.db), 'read');
            for (const ref of refs) {
                const key = access.readRefKey(ref);
                expect(terlihat.has(key), JSON.stringify({ i, user, ref, flag: process.env.RANGKAIAN_DISPOSISI_LAMA_READ })).toBe(hasil.get(key)!.allowed);
            }
        }
    }, 180_000);

    it('mode list hanya melonggarkan rekaman unit sendiri sesuai kelasUntukRole', async () => {
        const random = mulberry32(7);
        const pick = <T,>(values: readonly T[]) => values[Math.floor(random() * values.length)];
        const meta = new Map(spec.barisDari<{ key: string; unit: string; raw: string | null; deleted: boolean }>(await holder.db.execute(sql`
            SELECT 'surat_masuk:' || id::text AS "key", unit_kerja_id AS "unit", sifat_surat AS "raw", coalesce(is_deleted, false) AS "deleted" FROM surat_masuk
            UNION ALL SELECT 'surat_keluar:' || id::text, unit_kerja_id, coalesce(klasifikasi_keamanan, 'terbatas'), coalesce(is_deleted, false) FROM surat_keluar`)).map(row => [row.key, row]));
        for (let i = 0; i < 100; i += 1) {
            const user = { id: pick(ID_PENGGUNA), role: pick(ROLES), unitKerjaId: pick(UNIT_PENGGUNA) };
            const ctx = await spec.resolveKonteksBaca(user as any, holder.db);
            const baca = await kunciTerlihat(ctx, 'read');
            const list = await kunciTerlihat(ctx, 'list');
            for (const key of baca) expect(list.has(key), JSON.stringify({ i, user, key })).toBe(true);
            for (const key of list) {
                if (baca.has(key)) continue;
                const row = meta.get(key)!;
                expect(row.deleted).toBe(false);
                expect(spec.cocokUnitRekaman(spec.kecocokanUnitRekaman(user as any), row.unit), JSON.stringify({ i, user, key })).toBe(true);
                expect(spec.kelasUntukRole(user.role)).toContain(spec.normalizeSecurityClassification(row.raw));
            }
        }
    }, 120_000);
});
```

- [ ] **Step 2: Jalankan**

Run: `cd backend && npx vitest run src/__tests__/visibility-parity.property.integration.test.ts`
Expected: PASS. Kasus `sifat_surat = ''` sudah setara karena P0 `klasifikasiNormSql` memakai `coalesce(nullif(col, ''), 'biasa')` (sama dengan `'' || 'biasa'` di TS). Kegagalan apa pun adalah bug `visibleSql`/`checkMany`: perbaiki dengan superpowers:systematic-debugging, bukan dengan melonggarkan test. Jalankan juga test paritas P0: `cd backend && npx vitest run src/__tests__/visibility-spec.parity.test.ts` (Expected: PASS).

- [ ] **Step 3: Commit**

```bash
git add backend/src/__tests__/visibility-parity.property.integration.test.ts
git commit -F - <<'EOF'
test(akses): property test paritas checkRead dan visibleSql

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: `scopeForAuthorizedRead` + tipe audit

**Files:**
- Create: `backend/src/__tests__/scope-for-authorized-read.test.ts`
- Modify: `backend/src/utils/record-unit-scope.ts` (tambahan setelah baris 47)
- Modify: `backend/src/services/audit-log.service.ts:11-12`

**Interfaces:**
- Consumes: `ReadAccessResult` (tipe saja).
- Produces for P3–P5:

```ts
export function scopeForAuthorizedRead(
    req: AuthRequest,
    access: Pick<ReadAccessResult, 'allowed' | 'via' | 'unitKerjaId'>,
): RecordUnitScope;
// LogActionData.action ∪= 'view_via_rangkaian'  (entityType 'rangkaian_surat'/'rangkaian_relasi' dan action 'merge'/'link' milik P1 Task 9)
```

- [ ] **Step 1: Tulis test yang gagal**

```ts
// backend/src/__tests__/scope-for-authorized-read.test.ts
import { describe, expect, it } from 'vitest';
import { NO_RECORD_UNIT_ACCESS, scopeForAuthorizedRead } from '../utils/record-unit-scope';

const req = (user: any) => ({ user, query: {} }) as any;

describe('scopeForAuthorizedRead', () => {
    it('memakai scope pemilik untuk akses owner', () => {
        expect(scopeForAuthorizedRead(req({ role: 'admin_unit', unitKerjaId: 'dir_bppt' }), { allowed: true, via: 'owner', unitKerjaId: 'dir_bppt' })).toBe('dir_bppt');
        expect(scopeForAuthorizedRead(req({ role: 'super_admin', unitKerjaId: null }), { allowed: true, via: 'owner', unitKerjaId: 'dir_bppt' })).toBeNull();
    });
    it.each(['pengawas', 'peserta'] as const)('memuat tepat di unit rekaman untuk via %s', via => {
        expect(scopeForAuthorizedRead(req({ role: 'admin_unit', unitKerjaId: 'sesditjen' }), { allowed: true, via, unitKerjaId: 'dir_bppt' })).toBe('dir_bppt');
    });
    it('tidak pernah mengembalikan null untuk akses non-owner', () => {
        expect(scopeForAuthorizedRead(req({ role: 'super_admin' }), { allowed: true, via: 'peserta', unitKerjaId: null })).toBe(NO_RECORD_UNIT_ACCESS);
        expect(scopeForAuthorizedRead(req({ role: 'admin_unit', unitKerjaId: 'x' }), { allowed: true, via: 'pengawas', unitKerjaId: '  ' })).toBe(NO_RECORD_UNIT_ACCESS);
    });
    it('gagal tertutup bila tidak diizinkan', () => {
        expect(scopeForAuthorizedRead(req({ role: 'super_admin' }), { allowed: false, via: 'owner', unitKerjaId: 'dir_bppt' })).toBe(NO_RECORD_UNIT_ACCESS);
        expect(scopeForAuthorizedRead(req({ role: 'admin_unit', unitKerjaId: 'x' }), { allowed: true, via: null, unitKerjaId: 'x' })).toBe(NO_RECORD_UNIT_ACCESS);
    });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/scope-for-authorized-read.test.ts`
Expected: FAIL dengan `scopeForAuthorizedRead is not a function`.

- [ ] **Step 3: Implementasi**

Di `backend/src/utils/record-unit-scope.ts`, tambahkan impor tipe di bagian atas dan fungsi di akhir file:

```ts
import type { ReadAccessResult } from '../services/record-access.service.js';

/**
 * Scope pemuatan setelah checkRead lolos. Pemilik memakai scope biasanya;
 * akses lintas unit (pengawas/peserta) dimuat tepat di unit rekaman. `null`
 * tidak pernah dipakai di jalur lintas unit karena dicadangkan untuk super_admin.
 */
export function scopeForAuthorizedRead(
    req: AuthRequest,
    access: Pick<ReadAccessResult, 'allowed' | 'via' | 'unitKerjaId'>,
): RecordUnitScope {
    if (!access.allowed || !access.via) return NO_RECORD_UNIT_ACCESS;
    if (access.via === 'owner') return resolveRecordUnitScope(req);
    return access.unitKerjaId?.trim() || NO_RECORD_UNIT_ACCESS;
}
```

Di `backend/src/services/audit-log.service.ts`, tambahkan `| 'view_via_rangkaian'` di akhir union `action` (baris 11). Union `entityType` **tidak** diubah: `'rangkaian_surat' | 'rangkaian_relasi'` sudah ditambahkan P1 Task 9 (gerbang Task 0 mensyaratkan P1). Verifikasi dengan `grep -n "'rangkaian_surat'" backend/src/services/audit-log.service.ts` (harus satu hit); bila tidak ada, hentikan — P1 belum dimerge.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/scope-for-authorized-read.test.ts`
Expected: PASS (6 test).

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/record-unit-scope.ts backend/src/services/audit-log.service.ts backend/src/__tests__/scope-for-authorized-read.test.ts
git commit -F - <<'EOF'
feat(akses): scopeForAuthorizedRead dan aksi audit view_via_rangkaian

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: GET detail surat masuk/keluar memakai `checkRead` + matriks route

**Files:**
- Create: `backend/src/__tests__/rangkaian-akses.routes.integration.test.ts`
- Modify: `backend/src/routes/surat-masuk.routes.ts:20,181-199`
- Modify: `backend/src/routes/surat-keluar.routes.ts:20,150-168`
- Modify: `backend/src/routes/__tests__/surat-file-security.routes.test.ts:51-53,109-111,176-189`

**Interfaces:**
- Consumes: `checkRead`, `scopeForAuthorizedRead`, `auditLogService.logActionOrThrow`.
- Produces for P3–P5 (kontrak respons `GET /api/surat-masuk/:id` dan `GET /api/surat-keluar/:id`):

```ts
{ success: true, data: SuratRecord & { aksesMelalui: 'owner' | 'pengawas' | 'peserta'; aksiDiizinkan: string[] /* [] di P2 */ } }
```

- [ ] **Step 1: Tulis matriks route yang gagal**

```ts
// backend/src/__tests__/rangkaian-akses.routes.integration.test.ts
import type { PGlite } from '@electric-sql/pglite';
import express from 'express';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { PENGGUNA, SURAT, bootRangkaianDatabase, seedRangkaianFixture } from './helpers/rangkaian-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({
    get db() { return holder.db; },
    pool: { query: async () => { throw new Error('pool tidak dipakai dalam uji ini'); } },
}));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        const raw = req.headers['x-uji-pengguna'];
        req.user = raw ? { email: 'uji@example.test', ...JSON.parse(String(raw)) } : undefined;
        next();
    },
}));
vi.mock('../services/blob-storage.service', () => ({
    blobStorageService: { downloadFile: vi.fn(), uploadFile: vi.fn(), uploadUntrustedFile: vi.fn(), deleteFile: vi.fn(), deleteFileGeneration: vi.fn() },
}));
vi.mock('../services/malware-scan-dispatch.service.js', () => ({ scheduleMalwareScanWake: vi.fn() }));

let database: PGlite;
let app: express.Express;
const sebagai = (user: object) => ({ 'x-uji-pengguna': JSON.stringify(user) });

async function auditRows() {
    return (await database.query<any>(`SELECT action, entity_type, entity_id, changes FROM audit_log ORDER BY created_at`)).rows;
}

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    const { default: suratMasukRouter } = await import('../routes/surat-masuk.routes');
    const { default: suratKeluarRouter } = await import('../routes/surat-keluar.routes');
    app = express();
    app.use(express.json());
    app.use('/api/surat-masuk', suratMasukRouter);
    app.use('/api/surat-keluar', suratKeluarRouter);
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error?.statusCode || 500).json({ error: error?.message }));
}, 90_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => { await seedRangkaianFixture(database); });

describe('GET detail surat lintas unit', () => {
    it('pengawas (admin_unit@sesditjen) membaca ND BPPT dan tercatat view_via_rangkaian', async () => {
        const response = await request(app).get(`/api/surat-keluar/${SURAT.skBpptBiasa}`).set(sebagai(PENGGUNA.tu)).expect(200);
        expect(response.body.data).toMatchObject({ id: SURAT.skBpptBiasa, unitKerjaId: 'dir_bppt', aksesMelalui: 'pengawas', aksiDiizinkan: [] });
        const [audit] = await auditRows();
        expect(audit).toMatchObject({ action: 'view_via_rangkaian', entity_type: 'surat_keluar', entity_id: SURAT.skBpptBiasa });
        expect(audit.changes).toMatchObject({ via: 'pengawas' });
    });

    it('peserta membaca induk surat masuk tanpa mengubah status disposisi', async () => {
        const response = await request(app).get(`/api/surat-masuk/${SURAT.smBiasa}`).set(sebagai(PENGGUNA.bppt)).expect(200);
        expect(response.body.data.aksesMelalui).toBe('peserta');
        const statuses = (await database.query<any>(`SELECT target_unit_id, status FROM surat_distributions ORDER BY id`)).rows;
        expect(statuses).toEqual([
            { target_unit_id: 'dir_bppt', status: 'received' },
            { target_unit_id: 'dir_ptep', status: 'rejected' },
            { target_unit_id: 'dir_ptep', status: 'sent' },
        ]);
    });

    it('pemilik membaca tanpa audit lintas unit', async () => {
        const response = await request(app).get(`/api/surat-masuk/${SURAT.smBiasa}`).set(sebagai(PENGGUNA.tu)).expect(200);
        expect(response.body.data.aksesMelalui).toBe('owner');
        expect(await auditRows()).toHaveLength(0);
    });

    it('admin_sesditjen dengan unit NULL membaca sebagai pengawas', async () => {
        const response = await request(app).get(`/api/surat-keluar/${SURAT.skBpptBiasa}`).set(sebagai(PENGGUNA.adminSesNull)).expect(200);
        expect(response.body.data.aksesMelalui).toBe('pengawas');
    });

    it.each([
        ['non-peserta', PENGGUNA.plp, 'surat-masuk', SURAT.smBiasa],
        ['disposisi ditolak', PENGGUNA.ptep, 'surat-masuk', SURAT.smBiasa],
        ['grant tanpa jangkauan', PENGGUNA.bppt, 'surat-masuk', SURAT.smTerbatas],
        ['admin_unit@dir_bppt bukan pengawas', PENGGUNA.bppt, 'surat-masuk', SURAT.smTunggal],
        ['staff lama tanpa jangkauan', PENGGUNA.staffSes, 'surat-keluar', SURAT.skBpptBiasa],
        ['auditor lama tanpa jangkauan', PENGGUNA.auditorSes, 'surat-keluar', SURAT.skBpptBiasa],
        ['node terkendali tanpa grant', PENGGUNA.bppt, 'surat-keluar', SURAT.skBpptNull],
    ])('%s tetap 404 tanpa audit', async (_nama, user, path, id) => {
        await request(app).get(`/api/${path}/${id}`).set(sebagai(user)).expect(404);
        expect(await auditRows()).toHaveLength(0);
    });

    it('PUT/DELETE lintas unit tetap 404 dan data tidak berubah', async () => {
        await request(app).put(`/api/surat-keluar/${SURAT.skBpptBiasa}`).set(sebagai(PENGGUNA.tu)).send({ perihal: 'Diubah pengawas' }).expect(404);
        await request(app).delete(`/api/surat-keluar/${SURAT.skBpptBiasa}`).set(sebagai(PENGGUNA.tu)).expect(404);
        await request(app).put(`/api/surat-masuk/${SURAT.smBiasa}`).set(sebagai(PENGGUNA.bppt)).send({ perihal: 'Diubah peserta' }).expect(404);
        await request(app).delete(`/api/surat-masuk/${SURAT.smBiasa}`).set(sebagai(PENGGUNA.bppt)).expect(404);
        const sk = (await database.query<any>(`SELECT perihal, is_deleted FROM surat_keluar WHERE id = '${SURAT.skBpptBiasa}'`)).rows[0];
        const sm = (await database.query<any>(`SELECT perihal, is_deleted FROM surat_masuk WHERE id = '${SURAT.smBiasa}'`)).rows[0];
        expect(sk).toEqual({ perihal: 'Tindak lanjut permohonan data', is_deleted: false });
        expect(sm).toEqual({ perihal: 'Permohonan data pertanahan', is_deleted: false });
    });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/rangkaian-akses.routes.integration.test.ts`
Expected: FAIL. Test pengawas/peserta/adminSesNull mendapat 404 karena route masih memakai `check()`; test owner gagal karena `aksesMelalui` undefined. Test 404 dan PUT/DELETE sudah PASS.

- [ ] **Step 3: Ubah route detail**

Di `surat-masuk.routes.ts`, ubah impor baris 20 menjadi `import { resolveRecordUnitScope, scopeForAuthorizedRead } from '../utils/record-unit-scope.js';` dan tambahkan `import auditLogService from '../services/audit-log.service.js';` setelah impor `record-access.service.js`. Ganti blok baris 181–199 dengan:

```ts
// GET /api/surat-masuk/:id - pemilik, atau lintas unit via rangkaian (selalu read-only)
router.get('/:id', validateIdParam(), async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const access = await recordAccessService.checkRead(req.user, 'surat_masuk', id);
        if (!access.exists || !access.allowed) {
            return res.status(404).json({ error: 'Surat masuk not found' });
        }
        const result = await suratMasukService.findById(id, scopeForAuthorizedRead(req, access));
        if (!result) {
            return res.status(404).json({ error: 'Surat masuk not found' });
        }
        if (access.via !== 'owner') {
            await auditLogService.logActionOrThrow({
                userId: req.user?.id,
                userEmail: req.user?.email,
                action: 'view_via_rangkaian',
                entityType: 'surat_masuk',
                entityId: id,
                changes: { via: access.via, rangkaianId: access.rangkaianId, grantId: access.grantId },
                ipAddress: req.ip,
            });
        }

        res.json({
            success: true,
            data: { ...sanitizeSuratRecord(result, 'surat_masuk'), aksesMelalui: access.via, aksiDiizinkan: [] },
        });
    } catch (error) {
        next(error);
    }
});
```

Di `surat-keluar.routes.ts`, lakukan perubahan yang sama: impor baris 20, impor `auditLogService`, dan blok baris 150–168. Gunakan `'surat_keluar'`, `suratKeluarService.findById`, pesan `'Surat keluar not found'`, dan komentar `// GET /api/surat-keluar/:id - pemilik, atau lintas unit via rangkaian (selalu read-only)`.

- [ ] **Step 4: Sesuaikan test keamanan lama dan tambahkan kasus 404 non-peserta**

Di `backend/src/routes/__tests__/surat-file-security.routes.test.ts`:
- Pada `recordAccess` di `vi.hoisted` (baris 51–53), jadikan `recordAccess: { check: vi.fn(), checkRead: vi.fn() },`.
- Pada mock audit (baris 109–111), jadikan `default: { logAction: mocks.audit, logActionOrThrow: mocks.audit },`.
- Di akhir `beforeEach` (setelah baris 188), tambahkan:

```ts
        mocks.recordAccess.checkRead.mockResolvedValue({
            exists: true, allowed: true, mutable: true, unitKerjaId: 'sesditjen',
            classification: 'biasa', grantId: null, via: 'owner', rangkaianId: null, masked: false,
        });
```

- Tambahkan test berikut di dalam `describe` yang sama:

```ts
    it('returns 404 for a non-participant detail read without loading the record', async () => {
        mocks.recordAccess.checkRead.mockResolvedValue({ exists: true, allowed: false, via: null, unitKerjaId: 'sesditjen', rangkaianId: null, masked: false });
        await request(app).get('/api/surat-masuk/550e8400-e29b-41d4-a716-446655440030').expect(404);
        await request(app).get('/api/surat-keluar/550e8400-e29b-41d4-a716-446655440031').expect(404);
        expect(mocks.suratMasuk.findById).not.toHaveBeenCalled();
        expect(mocks.suratKeluar.findById).not.toHaveBeenCalled();
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it('loads a participant detail in the record unit scope and audits the cross-unit view', async () => {
        mocks.recordAccess.checkRead.mockResolvedValue({
            exists: true, allowed: true, mutable: false, unitKerjaId: 'sesditjen', grantId: null,
            via: 'peserta', rangkaianId: '550e8400-e29b-41d4-a716-446655440077', masked: false,
        });
        mocks.suratMasuk.findById.mockResolvedValue({ id: '550e8400-e29b-41d4-a716-446655440030', unitKerjaId: 'sesditjen', perihal: 'Permohonan', filePath: null });
        const response = await request(app).get('/api/surat-masuk/550e8400-e29b-41d4-a716-446655440030').expect(200);
        expect(mocks.suratMasuk.findById).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440030', 'sesditjen');
        expect(response.body.data).toMatchObject({ aksesMelalui: 'peserta', aksiDiizinkan: [] });
        expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'view_via_rangkaian',
            entityType: 'surat_masuk',
            changes: expect.objectContaining({ via: 'peserta', rangkaianId: '550e8400-e29b-41d4-a716-446655440077' }),
        }));
    });
```

- [ ] **Step 5: Jalankan, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/rangkaian-akses.routes.integration.test.ts src/routes/__tests__/surat-file-security.routes.test.ts src/routes/__tests__/surat-masuk.routes.test.ts`
Expected: PASS semua.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/surat-masuk.routes.ts backend/src/routes/surat-keluar.routes.ts backend/src/__tests__/rangkaian-akses.routes.integration.test.ts backend/src/routes/__tests__/surat-file-security.routes.test.ts
git commit -F - <<'EOF'
feat(akses): detail surat masuk/keluar dapat dibaca lintas unit via rangkaian

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Stream berkas (kedua cabang) memakai `checkRead` + audit `via`

**Files:**
- Modify: `backend/src/routes/file-access.routes.ts:32-48,130-140,179,215`
- Modify: `backend/src/routes/__tests__/file-access-generation.routes.test.ts:9-15,37-42,114-127` (+ test baru)

**Interfaces:**
- Consumes: `recordAccessService.checkRead`, `recordAccessService.check` (khusus induk `arsip`).
- Produces: audit stream `changes` ditambah `{ via, rangkaianId }` bila `via ∈ {pengawas, peserta}`. Payload untuk pemilik tidak berubah.

- [ ] **Step 1: Tulis test yang gagal**

Di `file-access-generation.routes.test.ts`:
- Tambahkan `accessCheckRead: vi.fn(),` pada `vi.hoisted` (setelah `accessCheck`).
- Pada mock `record-access.service.js`, tambahkan `checkRead: mocks.accessCheckRead,`.
- Di akhir `beforeEach` (setelah `mocks.downloadFile.mockResolvedValue(...)`), tambahkan `mocks.accessCheckRead.mockImplementation((...args: unknown[]) => mocks.accessCheck(...args));`.
- Tambahkan test berikut di `describe('authorized GCS file access')`:

```ts
    it('records the rangkaian path when a participant streams a letter attachment', async () => {
        mocks.select.mockReturnValueOnce(limitedRows([attachment]));
        mocks.accessCheckRead.mockResolvedValueOnce({ exists: true, allowed: true, grantId: null, via: 'peserta', rangkaianId: '50000000-0000-4000-8000-000000000001' });
        await request(app).get(`/api/files/attachment/${attachment.id}`).expect(200);
        expect(mocks.accessCheckRead).toHaveBeenCalledWith(expect.anything(), 'surat_masuk', attachment.entityId);
        expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
            entityId: attachment.id,
            changes: expect.objectContaining({ via: 'peserta', rangkaianId: '50000000-0000-4000-8000-000000000001' }),
        }));
    });

    it('records the rangkaian path for a direct supervised letter stream', async () => {
        mocks.select
            .mockReturnValueOnce(limitedRows([{ filePath: `blob:${locator}`, fileName: 'final.pdf' }]))
            .mockReturnValueOnce(unrestrictedRows([attachment]));
        mocks.accessCheckRead.mockResolvedValueOnce({ exists: true, allowed: true, grantId: null, via: 'pengawas', rangkaianId: null });
        await request(app).get(`/api/files/surat_masuk/${attachment.entityId}`).expect(200);
        expect(mocks.accessCheck).not.toHaveBeenCalled();
        expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
            changes: expect.objectContaining({ via: 'pengawas', rangkaianId: null }),
        }));
    });

    it('keeps archive attachments on the owner-only check', async () => {
        mocks.select.mockReturnValueOnce(limitedRows([{ ...attachment, entityType: 'arsip' }]));
        await request(app).get(`/api/files/attachment/${attachment.id}`).expect(200);
        expect(mocks.accessCheck).toHaveBeenCalledWith(expect.anything(), 'arsip', attachment.entityId);
        expect(mocks.accessCheckRead).not.toHaveBeenCalled();
    });

    it('keeps owner audit payloads free of rangkaian fields', async () => {
        mocks.select.mockReturnValueOnce(limitedRows([attachment]));
        await request(app).get(`/api/files/attachment/${attachment.id}`).expect(200);
        expect(mocks.audit.mock.calls[0][0].changes).not.toHaveProperty('via');
    });
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && npx vitest run src/routes/__tests__/file-access-generation.routes.test.ts`
Expected: FAIL. Test baru gagal karena `accessCheckRead` tidak dipanggil dan `changes` tidak memuat `via`.

- [ ] **Step 3: Implementasi di `file-access.routes.ts`**

1. Tipe `details` pada `streamAuthorizedFile` (baris 36–47): tambahkan dua properti opsional:

```ts
        via?: 'owner' | 'pengawas' | 'peserta' | null;
        rangkaianId?: string | null;
```

2. Pada objek `changes` audit (setelah spread `details.grantId`, sekitar baris 139), tambahkan:

```ts
                ...(details.via && details.via !== 'owner'
                    ? { via: details.via, rangkaianId: details.rangkaianId ?? null }
                    : {}),
```

3. Cabang lampiran (baris 179): ganti `const access = await recordAccessService.check(req.user, parentType, attachment.entityId);` dengan:

```ts
            const access = parentType === 'arsip'
                ? { ...(await recordAccessService.check(req.user, parentType, attachment.entityId)), via: 'owner' as const, rangkaianId: null }
                : await recordAccessService.checkRead(req.user, parentType, attachment.entityId);
```

   Tambahkan `via: access.via, rangkaianId: access.rangkaianId,` pada argumen `streamAuthorizedFile` cabang ini (setelah `classification: access.classification,`).

4. Cabang langsung (baris 215): ganti menjadi `const access = await recordAccessService.checkRead(req.user, entityType as 'surat_masuk' | 'surat_keluar', entityId);`, lalu tambahkan `via: access.via, rangkaianId: access.rangkaianId,` pada argumen `streamAuthorizedFile` cabang itu.

Pemuatan `record` di cabang langsung sudah memakai id tanpa scope unit dan hanya berjalan setelah akses lolos, jadi tidak ada perubahan lain.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `cd backend && npx vitest run src/routes/__tests__/file-access-generation.routes.test.ts`
Expected: PASS semua (lama + 4 baru).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/file-access.routes.ts backend/src/routes/__tests__/file-access-generation.routes.test.ts
git commit -F - <<'EOF'
feat(akses): stream berkas surat memakai checkRead dan mengaudit jalur rangkaian

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Read model rangkaian tersamar (`rangkaian-read.service.ts`)

**Files:**
- Create: `backend/src/services/rangkaian-read.service.ts`
- Create: `backend/src/__tests__/rangkaian-read.integration.test.ts`

**Interfaces:**
- Consumes: `recordAccessService.checkMany`, `readRefKey`, `ReadVia`, `resolveKonteksBaca`, `jangkauanSql`, `dalamCakupanPengawas`, `isAjukanAksesEnabled`, `barisDari`.
- Produces for P3–P5 (bentuk respons `GET /api/rangkaian/:id` dan `/by-surat`):

```ts
export type AksesRangkaian = 'owner' | 'pengawas' | 'peserta';
export interface AnggotaTerlihat {
    anggotaId: string; jenis: 'surat_masuk' | 'surat_keluar'; suratId: string; peran: 'induk' | 'anggota';
    unitKerjaId: string; unitNama: string; nomorSurat: string | null; perihal: string | null;
    tanggalSurat: string | null; dari: string | null; kepada: string | null;
    naskahDinas: string | null; approvalStatus: string | null; ditambahkanAt: string;
    masked: false; aksesMelalui: ReadVia;
}
export interface AnggotaTersamar {
    anggotaId: string; jenis: 'surat_masuk' | 'surat_keluar'; unitNama: string;
    label: 'Dikecualikan'; masked: true; dapatAjukanAkses: boolean;
}
export interface RelasiRangkaian { id: string; dariAnggotaId: string; keAnggotaId: string; jenisRelasi: 'balasan' | 'tindak_lanjut' | 'menjelaskan' | 'merujuk'; keterangan: string | null; createdAt: string }
export interface DisposisiRangkaian {
    id: string; suratMasukAnggotaId: string | null; targetUnit: { id: string; nama: string };
    status: 'sent' | 'received' | 'processed' | 'rejected'; sentAt: string; receivedAt: string | null; processedAt: string | null;
    batasWaktu: string | null; penanggungJawab: boolean; ditutupPengawas: boolean;
    instruction: string | null; catatanPenyelesaian: string | null; rejectionReason: string | null;
    penyelesaianAnggotaId: string | null; masked: boolean;
}
export interface PesertaRangkaian { unitKerjaId: string; nama: string; sumber: 'pencatat' | 'pengolah' | 'penulis' | 'disposisi' | 'disposisi_lama' }
export interface RangkaianTerkait { id: string; kode: string; status: string; hubungan: 'lanjutan_dari' | 'dilanjutkan_oleh' }
export interface RangkaianDetail {
    rangkaian: {
        id: string; kode: string; status: 'aktif' | 'selesai' | 'diberkaskan' | 'digabung'; asal: string;
        judul: string; tahun: number; unitPencatat: { id: string; nama: string }; unitPengolah: { id: string; nama: string } | null;
        klasifikasiItemId: number | null; lanjutanDariId: string | null; selesaiAt: string | null; selesaiManual: boolean;
        diberkaskanAt: string | null; createdAt: string;
    };
    dialihkanDari: { id: string; kode: string } | null;
    aksesMelalui: AksesRangkaian;
    peserta: PesertaRangkaian[];
    anggota: Array<AnggotaTerlihat | AnggotaTersamar>;
    relasi: RelasiRangkaian[];
    disposisi: DisposisiRangkaian[];
    rangkaianTerkait: RangkaianTerkait[];
    aksiDiizinkan: string[];   // [] di P2
    truncated: boolean;        // > 300 node
}
export const rangkaianReadService: {
    findRangkaianIdBySurat(jenis: JenisRekamanRangkaian, suratId: string, executor?: ReadExecutor): Promise<string | null>;
    getDetail(user: RecordUser | undefined, rangkaianId: string, executor?: ReadExecutor): Promise<RangkaianDetail | null>;
};
export function samarkanAnggota(row: { anggotaId: string; jenis: JenisRekamanRangkaian; unitNama: string }, dapatAjukanAkses: boolean): AnggotaTersamar;
export function judulTersamar(kode: string): string;
```

- [ ] **Step 1: Tulis test yang gagal**

```ts
// backend/src/__tests__/rangkaian-read.integration.test.ts
import type { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import {
    ANGGOTA, DISPOSISI, PENGGUNA, RAHASIA, RANGKAIAN, SURAT,
    bootRangkaianDatabase, seedRangkaianFixture,
} from './helpers/rangkaian-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let svc: typeof import('../services/rangkaian-read.service');
let access: typeof import('../services/record-access.service');
let spec: typeof import('../services/access/visibility-spec');

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    svc = await import('../services/rangkaian-read.service');
    access = await import('../services/record-access.service');
    spec = await import('../services/access/visibility-spec');
}, 60_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => { await seedRangkaianFixture(database); });
afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.RANGKAIAN_AJUKAN_AKSES;
    delete process.env.RANGKAIAN_DISPOSISI_LAMA_READ;
});

describe('placeholder murni', () => {
    it('hanya memuat bidang yang diizinkan spec §4.8', () => {
        expect(svc.samarkanAnggota({ anggotaId: 'a', jenis: 'surat_masuk', unitNama: 'Sekretariat Ditjen', suratId: 'rahasia', perihal: 'x' } as any, false))
            .toEqual({ anggotaId: 'a', jenis: 'surat_masuk', unitNama: 'Sekretariat Ditjen', label: 'Dikecualikan', masked: true, dapatAjukanAkses: false });
        expect(svc.judulTersamar('RS-2026-000002')).toBe('Rangkaian RS-2026-000002 (Dikecualikan)');
    });
});

describe('rangkaianReadService.getDetail', () => {
    it('pengawas melihat struktur lengkap dengan induk terkendali tersamar', async () => {
        const detail = (await svc.rangkaianReadService.getDetail(PENGGUNA.tu, RANGKAIAN.rs2))!;
        expect(detail.aksesMelalui).toBe('pengawas');
        expect(detail.rangkaian.judul).toBe('Rangkaian RS-2026-000002 (Dikecualikan)');
        expect(detail.anggota).toEqual([
            { anggotaId: ANGGOTA.rs2Sm, jenis: 'surat_masuk', unitNama: 'Sekretariat Ditjen', label: 'Dikecualikan', masked: true, dapatAjukanAkses: false },
            expect.objectContaining({ anggotaId: ANGGOTA.rs2SkPtep, suratId: SURAT.skPtepBiasa, masked: false, aksesMelalui: 'pengawas', perihal: 'Tanggapan PTEP' }),
        ]);
        expect(detail.relasi).toEqual([expect.objectContaining({ dariAnggotaId: ANGGOTA.rs2SkPtep, keAnggotaId: ANGGOTA.rs2Sm, keterangan: null })]);
        expect(detail.disposisi).toEqual([expect.objectContaining({
            id: DISPOSISI.rs2Ptep, targetUnit: { id: 'dir_ptep', nama: 'Dit. PTEP' }, status: 'sent', batasWaktu: '2026-10-01',
            penanggungJawab: true, instruction: null, catatanPenyelesaian: null, rejectionReason: null, masked: true,
        })]);
        expect(detail.aksiDiizinkan).toEqual([]);
        expect(detail.truncated).toBe(false);
    });

    it('tidak membocorkan isi node tersamar di mana pun dalam JSON', async () => {
        const pengawas = JSON.stringify(await svc.rangkaianReadService.getDetail(PENGGUNA.tu, RANGKAIAN.rs2));
        for (const text of [RAHASIA.perihalSmTerbatas, RAHASIA.nomorSmTerbatas, RAHASIA.instruksiRs2, RAHASIA.keteranganRs2, SURAT.smTerbatas, 'Kanwil B']) {
            expect(pengawas).not.toContain(text);
        }
        const peserta = JSON.stringify(await svc.rangkaianReadService.getDetail(PENGGUNA.bppt, RANGKAIAN.rs1));
        for (const text of [RAHASIA.perihalSkNull, RAHASIA.nomorSkNull, RAHASIA.keteranganSkNull, SURAT.skBpptNull]) {
            expect(peserta).not.toContain(text);
        }
    });

    it('peserta dengan grant melihat induk terkendali dan instruksinya', async () => {
        const detail = (await svc.rangkaianReadService.getDetail(PENGGUNA.ptep, RANGKAIAN.rs2))!;
        expect(detail.aksesMelalui).toBe('peserta');
        expect(detail.rangkaian.judul).toBe(RAHASIA.perihalSmTerbatas);
        expect(detail.disposisi[0]).toMatchObject({ instruction: RAHASIA.instruksiRs2, masked: false, suratMasukAnggotaId: ANGGOTA.rs2Sm });
    });

    it('dapatAjukanAkses hanya menyala bila flag aktif dan node terjangkau tetapi tersamar', async () => {
        process.env.RANGKAIAN_AJUKAN_AKSES = 'true';
        const detail = (await svc.rangkaianReadService.getDetail(PENGGUNA.bppt, RANGKAIAN.rs1))!;
        expect(detail.anggota.find(node => node.anggotaId === ANGGOTA.rs1SkNull)).toMatchObject({ masked: true, dapatAjukanAkses: true });
    });

    it('non-peserta dan disposisi ditolak tidak mendapat rangkaian', async () => {
        expect(await svc.rangkaianReadService.getDetail(PENGGUNA.plp, RANGKAIAN.rs1)).toBeNull();
        expect(await svc.rangkaianReadService.getDetail(PENGGUNA.ptep, RANGKAIAN.rs1)).toBeNull();
    });

    it('pembaca tanpa jangkauan (staff lama) hanya melihat node yang dapat dibacanya', async () => {
        const detail = (await svc.rangkaianReadService.getDetail(PENGGUNA.staffSes, RANGKAIAN.rs1))!;
        expect(detail.aksesMelalui).toBe('owner');
        expect(detail.anggota.map(node => node.anggotaId)).toEqual([ANGGOTA.rs1Sm]);
        expect(detail.relasi).toEqual([]);
        expect(detail.peserta).toEqual([]);
        expect(detail.rangkaianTerkait).toEqual([]);
        expect(detail.disposisi.every(row => row.masked === false)).toBe(true);
    });

    it('rangkaian digabung dialihkan satu hop ke target', async () => {
        await database.exec(`INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, judul, tahun, digabung_ke_id)
            VALUES ('${RANGKAIAN.rs3Digabung}','RS-2026-000003','surat_masuk','digabung','sesditjen','Sumber gabung',2026,'${RANGKAIAN.rs1}')`);
        const detail = (await svc.rangkaianReadService.getDetail(PENGGUNA.tu, RANGKAIAN.rs3Digabung))!;
        expect(detail.rangkaian.id).toBe(RANGKAIAN.rs1);
        expect(detail.dialihkanDari).toEqual({ id: RANGKAIAN.rs3Digabung, kode: 'RS-2026-000003' });
    });

    it('rangkaian lanjutan tampil sebagai terkait tanpa judul dan tidak mewarisi jangkauan', async () => {
        await database.exec(`INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, judul, tahun, lanjutan_dari_id)
            VALUES ('${RANGKAIAN.rs4Lanjutan}','RS-2026-000004','surat_masuk','aktif','sesditjen','Judul lanjutan rahasia',2026,'${RANGKAIAN.rs1}')`);
        const detail = (await svc.rangkaianReadService.getDetail(PENGGUNA.bppt, RANGKAIAN.rs1))!;
        expect(detail.rangkaianTerkait).toEqual([{ id: RANGKAIAN.rs4Lanjutan, kode: 'RS-2026-000004', status: 'aktif', hubungan: 'dilanjutkan_oleh' }]);
        expect(JSON.stringify(detail)).not.toContain('Judul lanjutan rahasia');
        expect(await svc.rangkaianReadService.getDetail(PENGGUNA.bppt, RANGKAIAN.rs4Lanjutan)).toBeNull();
    });

    it('memotong di 300 node dan menandai truncated', async () => {
        await database.exec(`
            INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, judul, tahun)
                VALUES ('${RANGKAIAN.rsBesar}','RS-2026-000005','inisiatif','aktif','sesditjen','Rangkaian besar',2026);
            INSERT INTO surat_keluar (unit_kerja_id, no_urut, tahun, klasifikasi_keamanan, perihal)
                SELECT 'dir_plp', g, 2026, 'biasa', 'Massal ' || g FROM generate_series(1, 301) g;
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_keluar_id, unit_kerja_id, peran, sumber)
                SELECT '${RANGKAIAN.rsBesar}', id, 'dir_plp', 'anggota', 'aplikasi' FROM surat_keluar WHERE unit_kerja_id = 'dir_plp';`);
        const detail = (await svc.rangkaianReadService.getDetail(PENGGUNA.tu, RANGKAIAN.rsBesar))!;
        expect(detail.anggota).toHaveLength(300);
        expect(detail.truncated).toBe(true);
    });

    it('memanggil checkMany sekali, tidak pernah checkRead per node', async () => {
        const many = vi.spyOn(access.recordAccessService, 'checkMany');
        const single = vi.spyOn(access.recordAccessService, 'checkRead');
        await svc.rangkaianReadService.getDetail(PENGGUNA.tu, RANGKAIAN.rs1);
        expect(many).toHaveBeenCalledTimes(1);
        expect(single).not.toHaveBeenCalled();
    });

    it.each([false, true])('daftar peserta sama dengan jangkauanSql (flag data lama %s)', async flag => {
        process.env.RANGKAIAN_DISPOSISI_LAMA_READ = String(flag);
        await database.exec(`INSERT INTO rangkaian_peserta (rangkaian_id, unit_kerja_id, peran, label_asal) VALUES ('${RANGKAIAN.rs1}','dir_plp','disposisi_lama','PLP')`);
        const detail = (await svc.rangkaianReadService.getDetail(PENGGUNA.tu, RANGKAIAN.rs1))!;
        const units = new Set(detail.peserta.map(row => row.unitKerjaId));
        for (const unit of ['ditjen', 'sesditjen', 'dir_bppt', 'dir_ptep', 'dir_plp', 'bagian_umum']) {
            const [row] = spec.barisDari<{ ok: boolean }>(await holder.db.execute(sql`SELECT ${spec.jangkauanSql(sql`${RANGKAIAN.rs1}::uuid`, unit, flag)} AS "ok"`));
            expect(units.has(unit), unit).toBe(row.ok);
        }
    });

    it('menemukan rangkaian dari surat anggota dan null untuk surat tunggal', async () => {
        expect(await svc.rangkaianReadService.findRangkaianIdBySurat('surat_masuk', SURAT.smBiasa)).toBe(RANGKAIAN.rs1);
        expect(await svc.rangkaianReadService.findRangkaianIdBySurat('surat_keluar', SURAT.skBpptTunggal)).toBeNull();
    });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/rangkaian-read.integration.test.ts`
Expected: FAIL dengan `Failed to load url ../services/rangkaian-read.service` (modul belum ada).

- [ ] **Step 3: Implementasi `backend/src/services/rangkaian-read.service.ts`**

```ts
import { sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
    readRefKey,
    recordAccessService,
    type ReadAccessResult,
    type ReadExecutor,
    type ReadVia,
    type RecordUser,
} from './record-access.service';
import {
    barisDari,
    dalamCakupanPengawas,
    isAjukanAksesEnabled,
    jangkauanSql,
    resolveKonteksBaca,
    type JenisRekamanRangkaian,
    type KonteksBaca,
} from './access/visibility-spec';

export const BATAS_NODE_DETAIL = 300;
export const BATAS_RANGKAIAN_TERKAIT = 5;
export const LABEL_DIKECUALIKAN = 'Dikecualikan' as const;

export type AksesRangkaian = 'owner' | 'pengawas' | 'peserta';

export interface AnggotaTerlihat {
    anggotaId: string;
    jenis: JenisRekamanRangkaian;
    suratId: string;
    peran: 'induk' | 'anggota';
    unitKerjaId: string;
    unitNama: string;
    nomorSurat: string | null;
    perihal: string | null;
    tanggalSurat: string | null;
    dari: string | null;
    kepada: string | null;
    naskahDinas: string | null;
    approvalStatus: string | null;
    ditambahkanAt: string;
    masked: false;
    aksesMelalui: ReadVia;
}

export interface AnggotaTersamar {
    anggotaId: string;
    jenis: JenisRekamanRangkaian;
    unitNama: string;
    label: typeof LABEL_DIKECUALIKAN;
    masked: true;
    dapatAjukanAkses: boolean;
}

export interface RelasiRangkaian {
    id: string;
    dariAnggotaId: string;
    keAnggotaId: string;
    jenisRelasi: 'balasan' | 'tindak_lanjut' | 'menjelaskan' | 'merujuk';
    keterangan: string | null;
    createdAt: string;
}

export interface DisposisiRangkaian {
    id: string;
    suratMasukAnggotaId: string | null;
    targetUnit: { id: string; nama: string };
    status: 'sent' | 'received' | 'processed' | 'rejected';
    sentAt: string;
    receivedAt: string | null;
    processedAt: string | null;
    batasWaktu: string | null;
    penanggungJawab: boolean;
    ditutupPengawas: boolean;
    instruction: string | null;
    catatanPenyelesaian: string | null;
    rejectionReason: string | null;
    penyelesaianAnggotaId: string | null;
    masked: boolean;
}

export interface PesertaRangkaian {
    unitKerjaId: string;
    nama: string;
    sumber: 'pencatat' | 'pengolah' | 'penulis' | 'disposisi' | 'disposisi_lama';
}

export interface RangkaianTerkait {
    id: string;
    kode: string;
    status: string;
    hubungan: 'lanjutan_dari' | 'dilanjutkan_oleh';
}

export interface RangkaianDetail {
    rangkaian: {
        id: string;
        kode: string;
        status: 'aktif' | 'selesai' | 'diberkaskan' | 'digabung';
        asal: string;
        judul: string;
        tahun: number;
        unitPencatat: { id: string; nama: string };
        unitPengolah: { id: string; nama: string } | null;
        klasifikasiItemId: number | null;
        lanjutanDariId: string | null;
        selesaiAt: string | null;
        selesaiManual: boolean;
        diberkaskanAt: string | null;
        createdAt: string;
    };
    dialihkanDari: { id: string; kode: string } | null;
    aksesMelalui: AksesRangkaian;
    peserta: PesertaRangkaian[];
    anggota: Array<AnggotaTerlihat | AnggotaTersamar>;
    relasi: RelasiRangkaian[];
    disposisi: DisposisiRangkaian[];
    rangkaianTerkait: RangkaianTerkait[];
    aksiDiizinkan: string[];
    truncated: boolean;
}

interface BarisRangkaian {
    id: string; kode: string; asal: string; status: RangkaianDetail['rangkaian']['status'];
    judul: string; tahun: number;
    unitPencatatId: string; unitPencatatNama: string;
    unitPengolahId: string | null; unitPengolahNama: string | null;
    klasifikasiItemId: number | null; lanjutanDariId: string | null; digabungKeId: string | null;
    selesaiAt: unknown; selesaiManual: boolean; diberkaskanAt: unknown; createdAt: unknown;
}

interface BarisAnggota {
    anggotaId: string; peran: 'induk' | 'anggota'; unitKerjaId: string; unitNama: string;
    ditambahkanAt: unknown; jenis: JenisRekamanRangkaian; suratId: string;
    nomorSurat: string | null; perihal: string | null; tanggalSurat: string | null;
    dari: string | null; kepada: string | null; naskahDinas: string | null; approvalStatus: string | null;
}

interface BarisRelasi {
    id: string; dariAnggotaId: string; keAnggotaId: string;
    jenisRelasi: RelasiRangkaian['jenisRelasi']; keterangan: string | null; createdAt: unknown;
}

interface BarisDisposisi {
    id: string; suratMasukId: string; targetUnitId: string; targetUnitNama: string;
    status: DisposisiRangkaian['status']; instruction: string | null; rejectionReason: string | null;
    catatanPenyelesaian: string | null; batasWaktu: string | null; penanggungJawab: boolean;
    ditutupPengawas: boolean; penyelesaianSuratKeluarId: string | null;
    sentAt: unknown; receivedAt: unknown; processedAt: unknown;
}

function iso(value: unknown): string | null {
    if (value == null) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
}

export function samarkanAnggota(
    row: { anggotaId: string; jenis: JenisRekamanRangkaian; unitNama: string },
    dapatAjukanAkses: boolean,
): AnggotaTersamar {
    return {
        anggotaId: row.anggotaId,
        jenis: row.jenis,
        unitNama: row.unitNama,
        label: LABEL_DIKECUALIKAN,
        masked: true,
        dapatAjukanAkses,
    };
}

export function judulTersamar(kode: string): string {
    return `Rangkaian ${kode} (${LABEL_DIKECUALIKAN})`;
}

async function muatRangkaian(executor: ReadExecutor, id: string): Promise<BarisRangkaian | null> {
    const [row] = barisDari<BarisRangkaian>(await executor.execute(sql`
        SELECT rs.id::text AS "id", rs.kode AS "kode", rs.asal AS "asal", rs.status AS "status",
               rs.judul AS "judul", rs.tahun AS "tahun",
               rs.unit_pencatat_id AS "unitPencatatId", up.name AS "unitPencatatNama",
               rs.unit_pengolah_id AS "unitPengolahId", uo.name AS "unitPengolahNama",
               rs.klasifikasi_item_id AS "klasifikasiItemId",
               rs.lanjutan_dari_id::text AS "lanjutanDariId", rs.digabung_ke_id::text AS "digabungKeId",
               rs.selesai_at AS "selesaiAt", rs.selesai_manual AS "selesaiManual",
               rs.diberkaskan_at AS "diberkaskanAt", rs.created_at AS "createdAt"
        FROM rangkaian_surat rs
        JOIN unit_kerja up ON up.id = rs.unit_pencatat_id
        LEFT JOIN unit_kerja uo ON uo.id = rs.unit_pengolah_id
        WHERE rs.id = ${id}::uuid
        LIMIT 1
    `));
    return row ?? null;
}

async function muatAnggota(executor: ReadExecutor, rangkaianId: string): Promise<BarisAnggota[]> {
    return barisDari<BarisAnggota>(await executor.execute(sql`
        SELECT a.id::text AS "anggotaId", a.peran AS "peran", a.unit_kerja_id AS "unitKerjaId", u.name AS "unitNama",
               a.ditambahkan_at AS "ditambahkanAt",
               CASE WHEN a.surat_masuk_id IS NOT NULL THEN 'surat_masuk' ELSE 'surat_keluar' END AS "jenis",
               coalesce(a.surat_masuk_id, a.surat_keluar_id)::text AS "suratId",
               coalesce(sm.nomor_surat, sk.nomor_surat) AS "nomorSurat",
               coalesce(sm.perihal, sk.perihal) AS "perihal",
               to_char(coalesce(sm.tanggal_surat, sk.tanggal_surat), 'YYYY-MM-DD') AS "tanggalSurat",
               sm.dari AS "dari", sk.kepada AS "kepada",
               sk.naskah_dinas AS "naskahDinas", sk.approval_status AS "approvalStatus"
        FROM rangkaian_anggota a
        JOIN unit_kerja u ON u.id = a.unit_kerja_id
        LEFT JOIN surat_masuk sm ON sm.id = a.surat_masuk_id
        LEFT JOIN surat_keluar sk ON sk.id = a.surat_keluar_id
        WHERE a.rangkaian_id = ${rangkaianId}::uuid
          AND coalesce(sm.is_deleted, sk.is_deleted) IS NOT TRUE
        ORDER BY a.ditambahkan_at, a.id
        LIMIT ${BATAS_NODE_DETAIL + 1}
    `));
}

async function muatRelasi(executor: ReadExecutor, rangkaianId: string): Promise<BarisRelasi[]> {
    return barisDari<BarisRelasi>(await executor.execute(sql`
        SELECT r.id::text AS "id", r.dari_anggota_id::text AS "dariAnggotaId", r.ke_anggota_id::text AS "keAnggotaId",
               r.jenis_relasi AS "jenisRelasi", r.keterangan AS "keterangan", r.created_at AS "createdAt"
        FROM rangkaian_relasi r
        WHERE r.rangkaian_id = ${rangkaianId}::uuid AND r.cancelled_at IS NULL
        ORDER BY r.created_at, r.id
    `));
}

async function muatDisposisi(executor: ReadExecutor, rangkaianId: string): Promise<BarisDisposisi[]> {
    return barisDari<BarisDisposisi>(await executor.execute(sql`
        SELECT d.id::text AS "id", d.surat_masuk_id::text AS "suratMasukId",
               d.target_unit_id AS "targetUnitId", u.name AS "targetUnitNama",
               d.status AS "status", d.instruction AS "instruction", d.rejection_reason AS "rejectionReason",
               d.catatan_penyelesaian AS "catatanPenyelesaian", to_char(d.batas_waktu, 'YYYY-MM-DD') AS "batasWaktu",
               d.penanggung_jawab AS "penanggungJawab", d.ditutup_pengawas AS "ditutupPengawas",
               d.penyelesaian_surat_keluar_id::text AS "penyelesaianSuratKeluarId",
               d.sent_at AS "sentAt", d.received_at AS "receivedAt", d.processed_at AS "processedAt"
        FROM surat_distributions d
        JOIN unit_kerja u ON u.id = d.target_unit_id
        WHERE d.rangkaian_id = ${rangkaianId}::uuid
        ORDER BY d.sent_at, d.id
    `));
}

async function muatPeserta(executor: ReadExecutor, rangkaianId: string, disposisiLamaRead: boolean): Promise<PesertaRangkaian[]> {
    const lama = disposisiLamaRead
        ? sql`UNION ALL SELECT p.unit_kerja_id, 'disposisi_lama', 5 FROM rangkaian_peserta p WHERE p.rangkaian_id = ${rangkaianId}::uuid AND p.berakhir_at IS NULL`
        : sql.empty();
    return barisDari<PesertaRangkaian>(await executor.execute(sql`
        SELECT DISTINCT ON (j.unit_kerja_id) j.unit_kerja_id AS "unitKerjaId", u.name AS "nama", j.sumber AS "sumber"
        FROM (
            SELECT rs.unit_pencatat_id AS unit_kerja_id, 'pencatat' AS sumber, 1 AS urutan FROM rangkaian_surat rs WHERE rs.id = ${rangkaianId}::uuid
            UNION ALL SELECT rs.unit_pengolah_id, 'pengolah', 2 FROM rangkaian_surat rs WHERE rs.id = ${rangkaianId}::uuid AND rs.unit_pengolah_id IS NOT NULL
            UNION ALL SELECT a.unit_kerja_id, 'penulis', 3 FROM rangkaian_anggota a WHERE a.rangkaian_id = ${rangkaianId}::uuid
            UNION ALL SELECT d.target_unit_id, 'disposisi', 4 FROM surat_distributions d WHERE d.rangkaian_id = ${rangkaianId}::uuid AND d.status <> 'rejected'
            ${lama}
        ) j
        JOIN unit_kerja u ON u.id = j.unit_kerja_id
        ORDER BY j.unit_kerja_id, j.urutan
    `));
}

async function muatTerkait(executor: ReadExecutor, rangkaianId: string): Promise<RangkaianTerkait[]> {
    return barisDari<RangkaianTerkait>(await executor.execute(sql`
        SELECT t.id::text AS "id", t.kode AS "kode", t.status AS "status", t.hubungan AS "hubungan"
        FROM (
            SELECT r.id, r.kode, r.status, 'lanjutan_dari' AS hubungan, r.created_at
            FROM rangkaian_surat r
            WHERE r.id = (SELECT lanjutan_dari_id FROM rangkaian_surat WHERE id = ${rangkaianId}::uuid)
            UNION ALL
            SELECT r.id, r.kode, r.status, 'dilanjutkan_oleh', r.created_at
            FROM rangkaian_surat r
            WHERE r.lanjutan_dari_id = ${rangkaianId}::uuid
        ) t
        ORDER BY t.created_at, t.id
        LIMIT ${BATAS_RANGKAIAN_TERKAIT}
    `));
}

async function tingkatRangkaian(
    executor: ReadExecutor,
    ctx: KonteksBaca,
    rs: BarisRangkaian,
): Promise<AksesRangkaian | null> {
    if (ctx.user?.role === 'super_admin') return 'owner';
    if (ctx.pengawas && dalamCakupanPengawas(rs.unitPencatatId)) return 'pengawas';
    if (ctx.unitJangkauan) {
        const [row] = barisDari<{ peserta: boolean }>(await executor.execute(
            sql`SELECT ${jangkauanSql(sql`${rs.id}::uuid`, ctx.unitJangkauan, ctx.disposisiLamaRead)} AS "peserta"`,
        ));
        if (row?.peserta === true) return 'peserta';
    }
    return null;
}

export const rangkaianReadService = {
    async findRangkaianIdBySurat(
        jenis: JenisRekamanRangkaian,
        suratId: string,
        executor: ReadExecutor = db,
    ): Promise<string | null> {
        const kolom = sql.raw(jenis === 'surat_masuk' ? 'surat_masuk_id' : 'surat_keluar_id');
        const [row] = barisDari<{ rangkaianId: string }>(await executor.execute(
            sql`SELECT rangkaian_id::text AS "rangkaianId" FROM rangkaian_anggota WHERE ${kolom} = ${suratId}::uuid LIMIT 1`,
        ));
        return row?.rangkaianId ?? null;
    },

    /**
     * Rangkaian tersamar untuk pembaca. null → 404 (tidak ada jalur baca).
     * Pembaca "penuh" (super_admin, pengawas, peserta) mendapat placeholder
     * untuk node yang tidak boleh dibaca; pembaca tanpa jangkauan hanya
     * menerima node yang dapat dibacanya.
     */
    async getDetail(
        user: RecordUser | undefined,
        rangkaianId: string,
        executor: ReadExecutor = db,
    ): Promise<RangkaianDetail | null> {
        let rs = await muatRangkaian(executor, rangkaianId);
        if (!rs) return null;
        let dialihkanDari: RangkaianDetail['dialihkanDari'] = null;
        if (rs.status === 'digabung' && rs.digabungKeId) {
            const target = await muatRangkaian(executor, rs.digabungKeId);
            if (!target) return null;
            dialihkanDari = { id: rs.id, kode: rs.kode };
            rs = target;
        }

        const ctx = await resolveKonteksBaca(user, executor);
        const barisAnggota = await muatAnggota(executor, rs.id);
        const truncated = barisAnggota.length > BATAS_NODE_DETAIL;
        const dipakai = barisAnggota.slice(0, BATAS_NODE_DETAIL);
        const akses = await recordAccessService.checkMany(
            user,
            dipakai.map(row => ({ type: row.jenis, id: row.suratId })),
            executor,
        );
        const aksesAnggota = (row: BarisAnggota): ReadAccessResult | undefined =>
            akses.get(readRefKey({ type: row.jenis, id: row.suratId }));
        const tingkat = await tingkatRangkaian(executor, ctx, rs);
        const penuh = tingkat !== null;
        if (!penuh && !dipakai.some(row => aksesAnggota(row)?.allowed === true)) return null;

        const dapatAjukan = isAjukanAksesEnabled();
        const terlihat = new Set<string>();
        const tersamar = new Set<string>();
        const anggota: Array<AnggotaTerlihat | AnggotaTersamar> = [];
        for (const row of dipakai) {
            const a = aksesAnggota(row);
            if (a?.allowed && a.via) {
                terlihat.add(row.anggotaId);
                anggota.push({
                    anggotaId: row.anggotaId,
                    jenis: row.jenis,
                    suratId: row.suratId,
                    peran: row.peran,
                    unitKerjaId: row.unitKerjaId,
                    unitNama: row.unitNama,
                    nomorSurat: row.nomorSurat,
                    perihal: row.perihal,
                    tanggalSurat: row.tanggalSurat,
                    dari: row.jenis === 'surat_masuk' ? row.dari : null,
                    kepada: row.jenis === 'surat_keluar' ? row.kepada : null,
                    naskahDinas: row.naskahDinas,
                    approvalStatus: row.approvalStatus,
                    ditambahkanAt: iso(row.ditambahkanAt)!,
                    masked: false,
                    aksesMelalui: a.via,
                });
            } else if (penuh) {
                tersamar.add(row.anggotaId);
                anggota.push(samarkanAnggota(row, dapatAjukan && a?.masked === true));
            }
        }
        const tampil = (id: string) => terlihat.has(id) || tersamar.has(id);
        const induk = dipakai.find(row => row.peran === 'induk');
        const judul = induk && terlihat.has(induk.anggotaId) ? rs.judul : judulTersamar(rs.kode);

        const relasi: RelasiRangkaian[] = (await muatRelasi(executor, rs.id))
            .filter(row => tampil(row.dariAnggotaId) && tampil(row.keAnggotaId))
            .map(row => ({
                id: row.id,
                dariAnggotaId: row.dariAnggotaId,
                keAnggotaId: row.keAnggotaId,
                jenisRelasi: row.jenisRelasi,
                keterangan: terlihat.has(row.dariAnggotaId) && terlihat.has(row.keAnggotaId) ? row.keterangan : null,
                createdAt: iso(row.createdAt)!,
            }));

        const anggotaSm = new Map(dipakai.filter(row => row.jenis === 'surat_masuk').map(row => [row.suratId, row]));
        const anggotaSk = new Map(dipakai.filter(row => row.jenis === 'surat_keluar').map(row => [row.suratId, row]));
        const disposisi: DisposisiRangkaian[] = [];
        for (const row of await muatDisposisi(executor, rs.id)) {
            const sm = anggotaSm.get(row.suratMasukId);
            const smTerlihat = Boolean(sm && terlihat.has(sm.anggotaId));
            if (!penuh && !smTerlihat) continue;
            const sk = row.penyelesaianSuratKeluarId ? anggotaSk.get(row.penyelesaianSuratKeluarId) : undefined;
            disposisi.push({
                id: row.id,
                suratMasukAnggotaId: sm && tampil(sm.anggotaId) ? sm.anggotaId : null,
                targetUnit: { id: row.targetUnitId, nama: row.targetUnitNama },
                status: row.status,
                sentAt: iso(row.sentAt)!,
                receivedAt: iso(row.receivedAt),
                processedAt: iso(row.processedAt),
                batasWaktu: row.batasWaktu,
                penanggungJawab: row.penanggungJawab === true,
                ditutupPengawas: row.ditutupPengawas === true,
                instruction: smTerlihat ? row.instruction : null,
                catatanPenyelesaian: smTerlihat ? row.catatanPenyelesaian : null,
                rejectionReason: smTerlihat ? row.rejectionReason : null,
                penyelesaianAnggotaId: sk && terlihat.has(sk.anggotaId) ? sk.anggotaId : null,
                masked: !smTerlihat,
            });
        }

        return {
            rangkaian: {
                id: rs.id,
                kode: rs.kode,
                status: rs.status,
                asal: rs.asal,
                judul,
                tahun: Number(rs.tahun),
                unitPencatat: { id: rs.unitPencatatId, nama: rs.unitPencatatNama },
                unitPengolah: rs.unitPengolahId ? { id: rs.unitPengolahId, nama: rs.unitPengolahNama ?? rs.unitPengolahId } : null,
                klasifikasiItemId: rs.klasifikasiItemId,
                lanjutanDariId: rs.lanjutanDariId,
                selesaiAt: iso(rs.selesaiAt),
                selesaiManual: rs.selesaiManual === true,
                diberkaskanAt: iso(rs.diberkaskanAt),
                createdAt: iso(rs.createdAt)!,
            },
            dialihkanDari,
            aksesMelalui: tingkat ?? 'owner',
            peserta: penuh ? await muatPeserta(executor, rs.id, ctx.disposisiLamaRead) : [],
            anggota,
            relasi,
            disposisi,
            rangkaianTerkait: penuh ? await muatTerkait(executor, rs.id) : [],
            aksiDiizinkan: [],
            truncated,
        };
    },
};

export default rangkaianReadService;
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/rangkaian-read.integration.test.ts`
Expected: PASS (14 test).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/rangkaian-read.service.ts backend/src/__tests__/rangkaian-read.integration.test.ts
git commit -F - <<'EOF'
feat(rangkaian): read model rangkaian tersamar untuk pengawas, peserta, dan pemilik

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Route `GET /api/rangkaian/:id` & `/by-surat/:jenis/:suratId`

**Files:**
- Create: `backend/src/routes/rangkaian.routes.ts`
- Modify: `backend/src/app.ts:50,370`
- Modify: `backend/src/middlewares/demo-access.middleware.ts:53`
- Modify: `backend/src/__tests__/demo-access.middleware.test.ts:60,98`
- Modify: `backend/src/__tests__/rangkaian-akses.routes.integration.test.ts` (tambah describe)

**Interfaces:**
- Consumes: `rangkaianReadService`, `recordAccessService.checkRead`, `auditLogService.logActionOrThrow`.
- Produces for P3–P5:
  - `GET /api/rangkaian/:id` → `200 { success: true, data: RangkaianDetail }` | `404` | `400` (id bukan UUID).
  - `GET /api/rangkaian/by-surat/:jenis/:suratId` (`jenis ∈ {surat_masuk, surat_keluar}`) → `200 { success: true, data: RangkaianDetail | null }` (`null` = surat tunggal) | `404` (surat tidak dapat dibaca) | `400`.
  - Audit `view_via_rangkaian` dengan entitas `rangkaian_surat` bila `aksesMelalui ≠ 'owner'`.
  - File router ini menjadi tempat P3 menambah endpoint tulis (`router` default export). P3 menyisipkan route berpath literal (`/lacak`, `/tautan`, `/relasi/:relasiId/batal`, `/disposisi/:distribusiId/tutup`, `/anggota/:anggotaId/ajukan-akses`) **sebelum** `router.get('/:id', ...)`.
  - Urutan mount final di `app.ts` (baris P2 ini selalu **terakhir**; P4 dan P5 menyisipkan router ber-auth per-route tepat di atasnya, tanpa `router.use(authMiddleware)` agar tidak ada autentikasi ganda):

```ts
app.use('/api/rangkaian', rangkaianDaftarRoutes);  // P4 Task 6: hanya GET / (auth per-route)
app.use('/api/rangkaian', rangkaianBerkasRoutes);  // P5 Task 8: /data-lama/*, /:id/koreksi-berkas, /koreksi-berkas/:koreksiId/putuskan (auth per-route)
app.use('/api/rangkaian', rangkaianRoutes);        // P2 Task 9 (+P3): router.use(authMiddleware); /lacak, /tautan, ... sebelum /:id dan /by-surat
```

- [ ] **Step 1: Tulis test route yang gagal**

Di `backend/src/__tests__/rangkaian-akses.routes.integration.test.ts`:
- Tambahkan `RANGKAIAN, ANGGOTA, RAHASIA` pada impor helper.
- Di `beforeAll`, setelah dua impor router, tambahkan `const { default: rangkaianRouter } = await import('../routes/rangkaian.routes');` dan `app.use('/api/rangkaian', rangkaianRouter);` sebelum error handler.
- Tambahkan describe berikut:

```ts
describe('GET /api/rangkaian', () => {
    it('pengawas mendapat rangkaian tersamar dan tercatat di audit', async () => {
        const response = await request(app).get(`/api/rangkaian/${RANGKAIAN.rs2}`).set(sebagai(PENGGUNA.tu)).expect(200);
        expect(response.body.data.aksesMelalui).toBe('pengawas');
        expect(response.body.data.anggota[0]).toEqual({ anggotaId: ANGGOTA.rs2Sm, jenis: 'surat_masuk', unitNama: 'Sekretariat Ditjen', label: 'Dikecualikan', masked: true, dapatAjukanAkses: false });
        expect(JSON.stringify(response.body)).not.toContain(RAHASIA.perihalSmTerbatas);
        const [audit] = await auditRows();
        expect(audit).toMatchObject({ action: 'view_via_rangkaian', entity_type: 'rangkaian_surat', entity_id: RANGKAIAN.rs2 });
    });

    it('non-peserta mendapat 404 tanpa audit', async () => {
        await request(app).get(`/api/rangkaian/${RANGKAIAN.rs1}`).set(sebagai(PENGGUNA.plp)).expect(404);
        expect(await auditRows()).toHaveLength(0);
    });

    it('pemilik tanpa jangkauan (staff lama) tidak diaudit sebagai lintas unit', async () => {
        const response = await request(app).get(`/api/rangkaian/${RANGKAIAN.rs1}`).set(sebagai(PENGGUNA.staffSes)).expect(200);
        expect(response.body.data.aksesMelalui).toBe('owner');
        expect(await auditRows()).toHaveLength(0);
    });

    it('by-surat mengembalikan rangkaian anggota, null untuk surat tunggal, 404 bila surat tak terbaca', async () => {
        const anggota = await request(app).get(`/api/rangkaian/by-surat/surat_masuk/${SURAT.smBiasa}`).set(sebagai(PENGGUNA.bppt)).expect(200);
        expect(anggota.body.data.rangkaian.id).toBe(RANGKAIAN.rs1);
        const tunggal = await request(app).get(`/api/rangkaian/by-surat/surat_keluar/${SURAT.skBpptTunggal}`).set(sebagai(PENGGUNA.bppt)).expect(200);
        expect(tunggal.body).toEqual({ success: true, data: null });
        await request(app).get(`/api/rangkaian/by-surat/surat_masuk/${SURAT.smBiasa}`).set(sebagai(PENGGUNA.plp)).expect(404);
    });

    it('memvalidasi parameter', async () => {
        await request(app).get('/api/rangkaian/bukan-uuid').set(sebagai(PENGGUNA.tu)).expect(400);
        await request(app).get(`/api/rangkaian/by-surat/arsip/${SURAT.smBiasa}`).set(sebagai(PENGGUNA.tu)).expect(400);
        await request(app).get('/api/rangkaian/by-surat/surat_masuk/bukan-uuid').set(sebagai(PENGGUNA.tu)).expect(400);
    });
});
```

Di `backend/src/__tests__/demo-access.middleware.test.ts`, tambahkan dua baris setelah `['POST', \`/api/surat-keluar/${id}/archive-full\`],` (baris 60):

```ts
        ['GET', `/api/rangkaian/${id}`],
        ['GET', `/api/rangkaian/by-surat/surat_masuk/${id}`],
```

Tambahkan satu baris sebelum `['GET', '/api/docs', 'unsupported_route'],` (baris 98):

```ts
        ['POST', `/api/rangkaian/${id}/gabung`, 'unsupported_route'],
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/rangkaian-akses.routes.integration.test.ts src/__tests__/demo-access.middleware.test.ts`
Expected: FAIL. Impor `../routes/rangkaian.routes` gagal (modul belum ada), dan dua baris demo "allows reviewed metadata route GET /api/rangkaian/…" mendapat 403.

- [ ] **Step 3: Implementasi route, mount, dan allowlist demo**

```ts
// backend/src/routes/rangkaian.routes.ts
import { Router, type Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middlewares/auth.middleware';
import { validateIdParam } from '../middlewares/validate.middleware';
import auditLogService from '../services/audit-log.service.js';
import { recordAccessService } from '../services/record-access.service.js';
import { rangkaianReadService, type RangkaianDetail } from '../services/rangkaian-read.service.js';
import type { JenisRekamanRangkaian } from '../services/access/visibility-spec.js';

const router = Router();
router.use(authMiddleware);

const JENIS_SURAT = new Set<JenisRekamanRangkaian>(['surat_masuk', 'surat_keluar']);

function tidakDitemukan(res: Response) {
    return res.status(404).json({ success: false, error: 'Rangkaian tidak ditemukan' });
}

async function auditLintasUnit(req: AuthRequest, detail: RangkaianDetail) {
    if (detail.aksesMelalui === 'owner') return;
    await auditLogService.logActionOrThrow({
        userId: req.user?.id,
        userEmail: req.user?.email,
        action: 'view_via_rangkaian',
        entityType: 'rangkaian_surat',
        entityId: detail.rangkaian.id,
        changes: { via: detail.aksesMelalui, rangkaianId: detail.rangkaian.id, dialihkanDari: detail.dialihkanDari?.id ?? null },
        ipAddress: req.ip,
    });
}

// GET /api/rangkaian/by-surat/:jenis/:suratId — rangkaian dari surat yang dapat dibaca (null = surat tunggal)
router.get('/by-surat/:jenis/:suratId', validateIdParam('suratId'), async (req: AuthRequest, res, next) => {
    try {
        const jenis = String(req.params.jenis) as JenisRekamanRangkaian;
        if (!JENIS_SURAT.has(jenis)) {
            return res.status(400).json({ success: false, error: 'Jenis surat tidak dikenal' });
        }
        const suratId = String(req.params.suratId);
        const access = await recordAccessService.checkRead(req.user, jenis, suratId);
        if (!access.exists || !access.allowed) {
            return res.status(404).json({ success: false, error: 'Surat tidak ditemukan' });
        }
        const rangkaianId = await rangkaianReadService.findRangkaianIdBySurat(jenis, suratId);
        if (!rangkaianId) return res.json({ success: true, data: null });
        const detail = await rangkaianReadService.getDetail(req.user, rangkaianId);
        if (!detail) return tidakDitemukan(res);
        await auditLintasUnit(req, detail);
        res.json({ success: true, data: detail });
    } catch (error) {
        next(error);
    }
});

// GET /api/rangkaian/:id — rangkaian lengkap, tersamar sesuai hak baca
router.get('/:id', validateIdParam(), async (req: AuthRequest, res, next) => {
    try {
        const detail = await rangkaianReadService.getDetail(req.user, String(req.params.id));
        if (!detail) return tidakDitemukan(res);
        await auditLintasUnit(req, detail);
        res.json({ success: true, data: detail });
    } catch (error) {
        next(error);
    }
});

export default router;
```

Di `backend/src/app.ts`, tambahkan setelah baris 50 (`import distributionRoutes …`):

```ts
import rangkaianRoutes from './routes/rangkaian.routes';
```

Tambahkan setelah baris 370 (`app.use('/api/distributions', distributionRoutes);`):

```ts
app.use('/api/rangkaian', rangkaianRoutes);
```

Di `backend/src/middlewares/demo-access.middleware.ts`, tambahkan setelah baris 53 (`{ methods: DELETE, path: exact(\`/surat-keluar/${UUID}\`) },`):

```ts

    { methods: GET, path: exact(`/rangkaian/(?:${UUID}|by-surat/(?:surat_masuk|surat_keluar)/${UUID})`) },
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/rangkaian-akses.routes.integration.test.ts src/__tests__/demo-access.middleware.test.ts`
Expected: PASS semua.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/rangkaian.routes.ts backend/src/app.ts backend/src/middlewares/demo-access.middleware.ts backend/src/__tests__/demo-access.middleware.test.ts backend/src/__tests__/rangkaian-akses.routes.integration.test.ts
git commit -F - <<'EOF'
feat(rangkaian): endpoint baca GET /api/rangkaian/:id dan /by-surat

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: Frontend — `rangkaian.service.js` + ekstraksi `TimelineItem`

**Files:**
- Create: `frontend/src/services/rangkaian.service.js`, `frontend/src/services/rangkaian.service.test.js`
- Create: `frontend/src/components/surat/TimelineItem.jsx`, `frontend/src/components/surat/__tests__/TimelineItem.test.jsx`
- Modify: `frontend/src/pages/DosirDetail.jsx:1-27,53-104`

**Interfaces:**
- Consumes: kontrak `GET /api/rangkaian/:id` dan `/by-surat` dari Task 9.
- Produces for P3–P5:

```js
// frontend/src/services/rangkaian.service.js
rangkaianService.getById(id: string): Promise<RangkaianDetail>
rangkaianService.getBySurat(jenis: 'surat_masuk' | 'surat_keluar', suratId: string): Promise<RangkaianDetail | null>
// frontend/src/components/surat/TimelineItem.jsx
<TimelineItem item={{ type: 'masuk'|'keluar', id?, tanggal?, perihal?, nomorSurat?, dari?, kepada?, unitNama?, relasiLabel?, masked? }} isLast={boolean} />
```

- [ ] **Step 1: Tulis test yang gagal**

```js
// frontend/src/services/rangkaian.service.test.js
import { beforeEach, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('./api', () => ({ default: apiMock }))

import rangkaianService from './rangkaian.service'

beforeEach(() => vi.clearAllMocks())

it('memuat rangkaian dari endpoint baca', async () => {
    apiMock.get.mockResolvedValue({ success: true, data: { rangkaian: { id: 'r1' } } })
    await expect(rangkaianService.getById('r1')).resolves.toEqual({ rangkaian: { id: 'r1' } })
    expect(apiMock.get).toHaveBeenCalledWith('/api/rangkaian/r1')
})

it('memuat rangkaian per surat dan meneruskan null untuk surat tunggal', async () => {
    apiMock.get.mockResolvedValue({ success: true, data: null })
    await expect(rangkaianService.getBySurat('surat_keluar', 's1')).resolves.toBeNull()
    expect(apiMock.get).toHaveBeenCalledWith('/api/rangkaian/by-surat/surat_keluar/s1')
})

it('menolak jenis surat tak dikenal sebelum memanggil API', async () => {
    await expect(rangkaianService.getBySurat('arsip', 'x')).rejects.toThrow(/jenis surat/i)
    expect(apiMock.get).not.toHaveBeenCalled()
})
```

```jsx
// frontend/src/components/surat/__tests__/TimelineItem.test.jsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { TimelineItem } from '../TimelineItem'

afterEach(cleanup)

function renderItem(item) {
    return render(
        <MemoryRouter initialEntries={['/']}>
            <Routes>
                <Route path="/" element={<TimelineItem item={item} isLast />} />
                <Route path="/surat/:type/:id" element={<p>Halaman detail</p>} />
            </Routes>
        </MemoryRouter>,
    )
}

it('menampilkan surat terlihat dan menavigasi ke detail', () => {
    renderItem({ type: 'keluar', id: 's2', tanggal: '2026-09-07', perihal: 'Tanggapan PTEP', nomorSurat: 'ND-1/PTEP/2026', kepada: 'Sesditjen', unitNama: 'Dit. PTEP', relasiLabel: 'Tindak lanjut' })
    expect(screen.getByText('Tanggapan PTEP')).toBeInTheDocument()
    expect(screen.getByText('ND-1/PTEP/2026')).toBeInTheDocument()
    expect(screen.getByText('Tindak lanjut')).toBeInTheDocument()
    expect(screen.getByText(/Dit\. PTEP/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /detail/i }))
    expect(screen.getByText('Halaman detail')).toBeInTheDocument()
})

it('menampilkan node tersamar tanpa isi dan tanpa tombol detail', () => {
    const { container } = renderItem({ type: 'masuk', masked: true, unitNama: 'Sekretariat Ditjen' })
    expect(screen.getByText('Dikecualikan')).toBeInTheDocument()
    expect(screen.getByText('Sekretariat Ditjen')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /detail/i })).toBeNull()
    expect(container.querySelector('[data-masked="true"]')).not.toBeNull()
})

it('tidak gagal saat tanggal tidak tersedia', () => {
    renderItem({ type: 'masuk', id: 's1', tanggal: null, perihal: 'Tanpa tanggal', nomorSurat: 'SM-9', dari: 'Kanwil' })
    expect(screen.getByText('Tanpa tanggal')).toBeInTheDocument()
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd frontend && npx vitest run src/services/rangkaian.service.test.js src/components/surat/__tests__/TimelineItem.test.jsx`
Expected: FAIL. Kedua modul belum ada ("Failed to resolve import").

- [ ] **Step 3: Implementasi service dan komponen; alihkan DosirDetail**

```js
// frontend/src/services/rangkaian.service.js
import api from './api'

const JENIS_SURAT = new Set(['surat_masuk', 'surat_keluar'])

export const rangkaianService = {
    async getById(id) {
        const response = await api.get(`/api/rangkaian/${encodeURIComponent(id)}`)
        return response.data
    },

    async getBySurat(jenis, suratId) {
        if (!JENIS_SURAT.has(jenis)) throw new Error(`Jenis surat tidak dikenal: ${jenis}`)
        const response = await api.get(`/api/rangkaian/by-surat/${jenis}/${encodeURIComponent(suratId)}`)
        return response.data ?? null
    },
}

export default rangkaianService
```

```jsx
// frontend/src/components/surat/TimelineItem.jsx
import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Clock, ExternalLink, Lock, MailMinus, MailPlus } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { id as idLocale } from 'date-fns/locale'

export function TimelineItem({ item, isLast }) {
    const isMasuk = item.type === 'masuk'
    const navigate = useNavigate()

    if (item.masked) {
        return (
            <div className="relative pl-8 pb-8 last:pb-0" data-masked="true">
                {!isLast && (
                    <div className="absolute left-[11px] top-8 bottom-0 w-0.5 bg-muted" />
                )}
                <div className="absolute left-0 top-1 p-1.5 rounded-full ring-4 ring-white bg-muted text-muted-foreground">
                    <Lock className="h-4 w-4" aria-hidden="true" />
                </div>
                <Card className="border-dashed bg-muted/60">
                    <CardContent className="p-4 space-y-1">
                        <Badge variant="outline">{isMasuk ? 'Surat Masuk' : 'Surat Keluar'}</Badge>
                        <p className="font-semibold text-muted-foreground">Dikecualikan</p>
                        {item.unitNama && <p className="text-sm text-muted-foreground">{item.unitNama}</p>}
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="relative pl-8 pb-8 last:pb-0">
            {/* Connector line */}
            {!isLast && (
                <div className="absolute left-[11px] top-8 bottom-0 w-0.5 bg-muted" />
            )}

            {/* Icon */}
            <div className={`absolute left-0 top-1 p-1.5 rounded-full ring-4 ring-white ${isMasuk ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600' : 'bg-blue-100 dark:bg-blue-500/15 text-blue-600'
                }`}>
                {isMasuk ? <MailPlus className="h-4 w-4" /> : <MailMinus className="h-4 w-4" />}
            </div>

            <Card className="hover:shadow-md transition-shadow duration-200">
                <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row gap-4 justify-between items-start">
                        <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                <Badge variant={isMasuk ? 'default' : 'secondary'} className={isMasuk ? 'bg-emerald-600' : 'bg-primary text-white'}>
                                    {isMasuk ? 'Surat Masuk' : 'Surat Keluar'}
                                </Badge>
                                {item.relasiLabel && <Badge variant="outline">{item.relasiLabel}</Badge>}
                                {item.tanggal && (
                                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                                        <Clock className="h-3 w-3" />
                                        {format(parseISO(item.tanggal), 'dd MMMM yyyy, HH:mm', { locale: idLocale })}
                                    </span>
                                )}
                            </div>
                            <h4 className="font-semibold text-base">{item.perihal || 'Tanpa Perihal'}</h4>
                            <p className="text-sm text-muted-foreground font-mono bg-muted/50 px-2 py-0.5 rounded inline-block">
                                {item.nomorSurat || 'Tanpa Nomor'}
                            </p>
                            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground mt-1">
                                <span className={isMasuk ? 'text-emerald-700 dark:text-emerald-300' : 'text-blue-700 dark:text-blue-300'}>
                                    {isMasuk ? `Dari: ${item.dari}` : `Kepada: ${item.kepada}`}
                                </span>
                                {item.unitNama && <span className="text-xs">· {item.unitNama}</span>}
                            </div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                            <Button variant="outline" size="sm" onClick={() => navigate(`/surat/${item.type}/${item.id}`)}>
                                <ExternalLink className="mr-2 h-3.5 w-3.5" />
                                Detail
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

export default TimelineItem
```

Di `frontend/src/pages/DosirDetail.jsx`, hapus fungsi lokal `TimelineItem` (baris 53–104) dan tambahkan impor setelah baris 25 (`import dosirService …`):

```jsx
import { TimelineItem } from '@/components/surat/TimelineItem'
```

Lalu jalankan `cd frontend && npx eslint src/pages/DosirDetail.jsx`. Hapus dari impor `lucide-react` (baris 19–24) dan `date-fns` (baris 26) setiap nama yang dilaporkan `no-unused-vars`. Kandidatnya `MailPlus`, `MailMinus`, dan `ExternalLink`; hapus hanya yang benar-benar dilaporkan.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `cd frontend && npx vitest run src/services/rangkaian.service.test.js src/components/surat/__tests__/TimelineItem.test.jsx src/pages/Dosir.requests.test.jsx src/pages/Dosir.validation.test.jsx && npx eslint src/pages/DosirDetail.jsx src/components/surat/TimelineItem.jsx src/services/rangkaian.service.js`
Expected: PASS semua dan eslint tanpa error.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/rangkaian.service.js frontend/src/services/rangkaian.service.test.js frontend/src/components/surat/TimelineItem.jsx frontend/src/components/surat/__tests__/TimelineItem.test.jsx frontend/src/pages/DosirDetail.jsx
git commit -F - <<'EOF'
feat(frontend): service rangkaian dan ekstraksi TimelineItem dengan varian tersamar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 11: Frontend — `AlurSuratPanel` (read-only)

**Files:**
- Create: `frontend/src/components/surat/AlurSuratPanel.jsx`
- Create: `frontend/src/components/surat/__tests__/AlurSuratPanel.test.jsx`

**Interfaces:**
- Consumes: `rangkaianService.getBySurat`, `TimelineItem`.
- Produces for P3–P5:

```jsx
<AlurSuratPanel
    jenis="surat_masuk" | "surat_keluar"
    suratId={string}
    aksesMelalui="owner" | "pengawas" | "peserta"   // default 'owner'; selain owner → banner read-only
    fallback={ReactNode | null}                       // dirender bila surat tunggal (data null)
/>
export const STATUS_RANGKAIAN_LABEL, STATUS_DISPOSISI_LABEL, JENIS_RELASI_LABEL
```

P3 menambahkan tombol aksi (Berkaskan, Gabungkan, Tutup Disposisi, Ajukan Akses) di panel ini berdasarkan `aksiDiizinkan`.

- [ ] **Step 1: Tulis test yang gagal**

```jsx
// frontend/src/components/surat/__tests__/AlurSuratPanel.test.jsx
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ getBySurat: vi.fn() }))
vi.mock('@/services/rangkaian.service', () => ({ default: { getBySurat: mocks.getBySurat } }))

import { AlurSuratPanel } from '../AlurSuratPanel'

const detail = {
    rangkaian: {
        id: 'r1', kode: 'RS-2026-000002', status: 'aktif', asal: 'surat_masuk',
        judul: 'Rangkaian RS-2026-000002 (Dikecualikan)', tahun: 2026,
        unitPencatat: { id: 'sesditjen', nama: 'Sekretariat Ditjen' }, unitPengolah: { id: 'dir_bppt', nama: 'Dit. BPPT' },
        klasifikasiItemId: null, lanjutanDariId: null, selesaiAt: null, selesaiManual: false,
        diberkaskanAt: null, createdAt: '2026-09-01T00:00:00.000Z',
    },
    dialihkanDari: null,
    aksesMelalui: 'pengawas',
    peserta: [
        { unitKerjaId: 'sesditjen', nama: 'Sekretariat Ditjen', sumber: 'pencatat' },
        { unitKerjaId: 'dir_ptep', nama: 'Dit. PTEP', sumber: 'disposisi' },
    ],
    anggota: [
        { anggotaId: 'a1', jenis: 'surat_masuk', unitNama: 'Sekretariat Ditjen', label: 'Dikecualikan', masked: true, dapatAjukanAkses: false },
        {
            anggotaId: 'a2', jenis: 'surat_keluar', suratId: 's2', peran: 'anggota', unitKerjaId: 'dir_ptep', unitNama: 'Dit. PTEP',
            nomorSurat: 'ND-1/PTEP/2026', perihal: 'Tanggapan PTEP', tanggalSurat: '2026-09-07', dari: null, kepada: 'Sesditjen',
            naskahDinas: 'Nota Dinas', approvalStatus: 'draft', ditambahkanAt: '2026-09-07T01:00:00.000Z', masked: false, aksesMelalui: 'pengawas',
        },
    ],
    relasi: [{ id: 'x1', dariAnggotaId: 'a2', keAnggotaId: 'a1', jenisRelasi: 'tindak_lanjut', keterangan: null, createdAt: '2026-09-07T01:00:00.000Z' }],
    disposisi: [{
        id: 'd1', suratMasukAnggotaId: 'a1', targetUnit: { id: 'dir_ptep', nama: 'Dit. PTEP' }, status: 'sent',
        sentAt: '2026-09-02T00:00:00.000Z', receivedAt: null, processedAt: null, batasWaktu: '2026-10-01',
        penanggungJawab: true, ditutupPengawas: false, instruction: null, catatanPenyelesaian: null,
        rejectionReason: null, penyelesaianAnggotaId: null, masked: true,
    }],
    rangkaianTerkait: [{ id: 'r9', kode: 'RS-2026-000009', status: 'aktif', hubungan: 'dilanjutkan_oleh' }],
    aksiDiizinkan: [],
    truncated: true,
}

const renderPanel = (props) => render(
    <MemoryRouter>
        <AlurSuratPanel jenis="surat_masuk" suratId="s1" {...props} />
    </MemoryRouter>,
)

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

it('menampilkan kode, status, alur unit, peserta, dan banner baca lintas unit', async () => {
    mocks.getBySurat.mockResolvedValue(detail)
    renderPanel({ aksesMelalui: 'pengawas' })
    expect(await screen.findByText('Alur Surat')).toBeInTheDocument()
    expect(mocks.getBySurat).toHaveBeenCalledWith('surat_masuk', 's1')
    expect(screen.getByRole('note')).toHaveTextContent('Dilihat melalui rangkaian RS-2026-000002')
    expect(screen.getByText('Aktif')).toBeInTheDocument()
    expect(screen.getByText('Sekretariat Ditjen → Dit. BPPT')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Peserta rangkaian' })).getByText('Dit. PTEP')).toBeInTheDocument()
})

it('menampilkan status tindak lanjut per penerima dengan instruksi tersamar', async () => {
    mocks.getBySurat.mockResolvedValue(detail)
    renderPanel({ aksesMelalui: 'pengawas' })
    const tabel = within(await screen.findByRole('region', { name: 'Status tindak lanjut per penerima' }))
    expect(tabel.getByText('Dit. PTEP')).toBeInTheDocument()
    expect(tabel.getByText('Penanggung jawab')).toBeInTheDocument()
    expect(tabel.getByText('Terkirim')).toBeInTheDocument()
    expect(tabel.getByText('2026-10-01')).toBeInTheDocument()
    expect(tabel.getAllByText('Dikecualikan')).toHaveLength(2)
})

it('menampilkan linimasa dengan node tersamar, label relasi, rangkaian terkait, dan pemotongan', async () => {
    mocks.getBySurat.mockResolvedValue(detail)
    const { container } = renderPanel({ aksesMelalui: 'pengawas' })
    const linimasa = within(await screen.findByRole('region', { name: 'Linimasa rangkaian' }))
    expect(linimasa.getByText('Tanggapan PTEP')).toBeInTheDocument()
    expect(linimasa.getByText('Tindak lanjut')).toBeInTheDocument()
    expect(linimasa.getByText('Dikecualikan')).toBeInTheDocument()
    expect(container.querySelector('[data-masked="true"]')).not.toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('lebih dari 300')
    expect(screen.getByText(/RS-2026-000009/)).toBeInTheDocument()
})

it('tidak menampilkan aksi tulis di P2', async () => {
    mocks.getBySurat.mockResolvedValue(detail)
    renderPanel({ aksesMelalui: 'pengawas' })
    await screen.findByText('Alur Surat')
    expect(screen.queryByRole('button', { name: /berkaskan|gabungkan|tutup disposisi|ajukan akses|tandai selesai/i })).toBeNull()
})

it('tidak menampilkan banner untuk pemilik', async () => {
    mocks.getBySurat.mockResolvedValue({ ...detail, aksesMelalui: 'owner' })
    renderPanel({ aksesMelalui: 'owner' })
    await screen.findByText('Alur Surat')
    expect(screen.queryByRole('note')).toBeNull()
})

it('merender fallback untuk surat tunggal', async () => {
    mocks.getBySurat.mockResolvedValue(null)
    renderPanel({ fallback: <a href="/surat/masuk/x">Lihat Surat Masuk</a> })
    expect(await screen.findByText('Lihat Surat Masuk')).toBeInTheDocument()
    expect(screen.queryByText('Alur Surat')).toBeNull()
})

it('menampilkan pesan bila gagal dimuat', async () => {
    mocks.getBySurat.mockRejectedValue(new Error('boom'))
    renderPanel({})
    expect(await screen.findByText('Alur surat tidak dapat dimuat.')).toBeInTheDocument()
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd frontend && npx vitest run src/components/surat/__tests__/AlurSuratPanel.test.jsx`
Expected: FAIL dengan "Failed to resolve import ../AlurSuratPanel".

- [ ] **Step 3: Implementasi `AlurSuratPanel.jsx`**

```jsx
// frontend/src/components/surat/AlurSuratPanel.jsx
import { useEffect, useState } from 'react'
import { GitBranch, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import rangkaianService from '@/services/rangkaian.service'
import { TimelineItem } from '@/components/surat/TimelineItem'

export const STATUS_RANGKAIAN_LABEL = { aktif: 'Aktif', selesai: 'Selesai', diberkaskan: 'Diberkaskan', digabung: 'Digabung' }
export const STATUS_DISPOSISI_LABEL = { sent: 'Terkirim', received: 'Diterima', processed: 'Selesai', rejected: 'Ditolak' }
export const JENIS_RELASI_LABEL = { balasan: 'Balasan', tindak_lanjut: 'Tindak lanjut', menjelaskan: 'Menjelaskan', merujuk: 'Merujuk' }
const AKSES_LABEL = { pengawas: 'unit pengawas', peserta: 'peserta rangkaian' }
const DIKECUALIKAN = 'Dikecualikan'

function keItemLinimasa(node, relasiDari) {
    const type = node.jenis === 'surat_masuk' ? 'masuk' : 'keluar'
    if (node.masked) return { type, masked: true, unitNama: node.unitNama }
    const relasi = relasiDari.get(node.anggotaId)
    return {
        type,
        id: node.suratId,
        tanggal: node.tanggalSurat,
        perihal: node.perihal,
        nomorSurat: node.nomorSurat,
        dari: node.dari ?? '-',
        kepada: node.kepada ?? '-',
        unitNama: node.unitNama,
        relasiLabel: relasi ? JENIS_RELASI_LABEL[relasi.jenisRelasi] ?? relasi.jenisRelasi : null,
    }
}

export function AlurSuratPanel({ jenis, suratId, aksesMelalui = 'owner', fallback = null }) {
    const [state, setState] = useState({ loading: true, data: null, error: false })

    useEffect(() => {
        let aktif = true
        setState({ loading: true, data: null, error: false })
        rangkaianService.getBySurat(jenis, suratId)
            .then((data) => { if (aktif) setState({ loading: false, data, error: false }) })
            .catch(() => { if (aktif) setState({ loading: false, data: null, error: true }) })
        return () => { aktif = false }
    }, [jenis, suratId])

    if (state.loading) {
        return (
            <Card aria-busy="true">
                <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Memuat alur surat…
                </CardContent>
            </Card>
        )
    }
    if (state.error) {
        return (
            <Card>
                <CardContent className="p-4 text-sm text-destructive">Alur surat tidak dapat dimuat.</CardContent>
            </Card>
        )
    }
    if (!state.data) return fallback

    const d = state.data
    const r = d.rangkaian
    const relasiDari = new Map(d.relasi.map((relasi) => [relasi.dariAnggotaId, relasi]))

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <GitBranch className="h-5 w-5" aria-hidden="true" />
                    Alur Surat
                </CardTitle>
                <CardDescription>
                    <span className="font-mono">{r.kode}</span> · {r.judul}
                </CardDescription>
                {aksesMelalui !== 'owner' && (
                    <p role="note" className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                        Dilihat melalui rangkaian {r.kode} sebagai {AKSES_LABEL[aksesMelalui] ?? 'peserta rangkaian'}. Akses baca saja.
                    </p>
                )}
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="outline">{STATUS_RANGKAIAN_LABEL[r.status] ?? r.status}</Badge>
                    <span>{r.unitPencatat.nama} → {r.unitPengolah?.nama ?? 'Unit pengolah belum ditetapkan'}</span>
                </div>

                {d.peserta.length > 0 && (
                    <div className="space-y-2">
                        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Peserta</h4>
                        <ul aria-label="Peserta rangkaian" className="flex flex-wrap gap-2">
                            {d.peserta.map((peserta) => (
                                <li key={peserta.unitKerjaId}><Badge variant="secondary">{peserta.nama}</Badge></li>
                            ))}
                        </ul>
                    </div>
                )}

                {d.disposisi.length > 0 && (
                    <section aria-label="Status tindak lanjut per penerima" className="space-y-2">
                        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status Tindak Lanjut per Penerima</h4>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-muted-foreground">
                                        <th className="py-1 pr-3 font-medium">Unit</th>
                                        <th className="py-1 pr-3 font-medium">Instruksi</th>
                                        <th className="py-1 pr-3 font-medium">Batas waktu</th>
                                        <th className="py-1 pr-3 font-medium">Status</th>
                                        <th className="py-1 font-medium">Penyelesaian</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {d.disposisi.map((row) => (
                                        <tr key={row.id} className="border-t align-top">
                                            <td className="py-2 pr-3">
                                                <span>{row.targetUnit.nama}</span>
                                                {row.penanggungJawab && <Badge variant="outline" className="ml-2">Penanggung jawab</Badge>}
                                            </td>
                                            <td className="py-2 pr-3 whitespace-pre-line">{row.masked ? DIKECUALIKAN : (row.instruction || '-')}</td>
                                            <td className="py-2 pr-3">{row.batasWaktu ?? '-'}</td>
                                            <td className="py-2 pr-3">
                                                {STATUS_DISPOSISI_LABEL[row.status] ?? row.status}
                                                {row.ditutupPengawas ? ' (ditutup pengawas)' : ''}
                                            </td>
                                            <td className="py-2 whitespace-pre-line">
                                                {row.masked
                                                    ? DIKECUALIKAN
                                                    : (row.catatanPenyelesaian || row.rejectionReason || (row.penyelesaianAnggotaId ? 'Surat penyelesaian' : '-'))}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                )}

                <section aria-label="Linimasa rangkaian" className="space-y-2">
                    <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Linimasa</h4>
                    <div>
                        {d.anggota.map((node, index) => (
                            <TimelineItem key={node.anggotaId} item={keItemLinimasa(node, relasiDari)} isLast={index === d.anggota.length - 1} />
                        ))}
                    </div>
                    {d.truncated && (
                        <p role="status" className="text-sm text-muted-foreground">
                            Rangkaian ini memuat lebih dari 300 surat; hanya 300 pertama yang ditampilkan.
                        </p>
                    )}
                </section>

                {d.rangkaianTerkait.length > 0 && (
                    <section aria-label="Rangkaian terkait" className="space-y-2">
                        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rangkaian terkait</h4>
                        <ul className="space-y-1 text-sm">
                            {d.rangkaianTerkait.map((terkait) => (
                                <li key={terkait.id}>
                                    <span className="font-mono">{terkait.kode}</span>
                                    {' · '}{terkait.hubungan === 'lanjutan_dari' ? 'Lanjutan dari' : 'Dilanjutkan oleh'}
                                    {' · '}{STATUS_RANGKAIAN_LABEL[terkait.status] ?? terkait.status}
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {r.diberkaskanAt && (
                    <p className="text-sm text-muted-foreground">
                        Bukti penutupan berkas: {r.kode}, tgl {r.diberkaskanAt.slice(0, 10)}
                    </p>
                )}
            </CardContent>
        </Card>
    )
}

export default AlurSuratPanel
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `cd frontend && npx vitest run src/components/surat/__tests__/AlurSuratPanel.test.jsx && npx eslint src/components/surat/AlurSuratPanel.jsx`
Expected: PASS (7 test) dan eslint tanpa error.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/surat/AlurSuratPanel.jsx frontend/src/components/surat/__tests__/AlurSuratPanel.test.jsx
git commit -F - <<'EOF'
feat(frontend): panel Alur Surat read-only dengan node tersamar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 12: Frontend — pasang panel di detail surat, sembunyikan aksi pemilik untuk akses lintas unit

**Files:**
- Create: `frontend/src/pages/SuratMasukDetail.alur.test.jsx`
- Modify: `frontend/src/pages/SuratMasukDetail.jsx:17,26,139`
- Modify: `frontend/src/pages/SuratKeluarDetail.jsx:38,48,452-466`
- Modify: `frontend/src/pages/SuratKeluarDetail.rules.test.jsx`

**Interfaces:**
- Consumes: `data.aksesMelalui` dari GET detail (Task 6) dan `AlurSuratPanel` (Task 11).
- Produces: aturan UI untuk P3, yaitu `isAdmin = canWrite(unit) && (surat.aksesMelalui ?? 'owner') === 'owner'`. P3 mengganti gating menu dengan `aksiDiizinkan`.

- [ ] **Step 1: Tulis test yang gagal**

```jsx
// frontend/src/pages/SuratMasukDetail.alur.test.jsx
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ getById: vi.fn(), toast: vi.fn() }))
vi.mock('@/services/surat-masuk.service', () => ({ default: { getById: mocks.getById, archive: vi.fn() } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ canWrite: () => true, user: { id: 'user-a', role: 'admin_unit', unitKerjaId: 'dir_bppt' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: false } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/components/ArchiveDialog', () => ({ ArchiveDialog: () => null }))
vi.mock('@/components/DistributeDialog', () => ({ DistributeDialog: () => null }))
vi.mock('@/components/surat-masuk/FilePreviewSection', () => ({ FilePreviewSection: () => null }))
vi.mock('@/components/surat/AlurSuratPanel', () => ({
    AlurSuratPanel: ({ jenis, suratId, aksesMelalui }) => <output aria-label="Panel alur surat">{`${jenis}|${suratId}|${aksesMelalui}`}</output>,
}))

import SuratMasukDetail from './SuratMasukDetail'

const surat = {
    id: 'sm-1', nomorSurat: 'SM-1/2026', perihal: 'Permohonan data pertanahan', unitKerjaId: 'sesditjen',
    dari: 'Kanwil A', tanggalSurat: '2026-09-01', status: 'belum_dibalas', sifatSurat: 'biasa', isArchived: false,
}

const renderDetail = () => render(
    <MemoryRouter initialEntries={['/surat/masuk/sm-1']}>
        <Routes><Route path="/surat/masuk/:id" element={<SuratMasukDetail />} /></Routes>
    </MemoryRouter>,
)

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

it('menyembunyikan aksi pemilik saat surat dibaca melalui rangkaian', async () => {
    mocks.getById.mockResolvedValue({ ...surat, aksesMelalui: 'peserta' })
    renderDetail()
    expect(await screen.findByLabelText('Panel alur surat')).toHaveTextContent('surat_masuk|sm-1|peserta')
    expect(screen.queryAllByRole('button', { name: /^edit$/i })).toHaveLength(0)
})

it('tetap menampilkan aksi pemilik untuk akses owner', async () => {
    mocks.getById.mockResolvedValue({ ...surat, aksesMelalui: 'owner' })
    renderDetail()
    expect(await screen.findByLabelText('Panel alur surat')).toHaveTextContent('surat_masuk|sm-1|owner')
    expect(screen.queryAllByRole('button', { name: /^edit$/i }).length).toBeGreaterThan(0)
})
```

Di `frontend/src/pages/SuratKeluarDetail.rules.test.jsx`:
- Ganti baris `mocks` menjadi `const mocks = vi.hoisted(() => ({ getById: vi.fn(), toast: vi.fn(), canWrite: false, getBySurat: vi.fn(), getHistory: vi.fn(), getEligibleApprovers: vi.fn() }))`.
- Ganti mock AuthContext menjadi `vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ canWrite: () => mocks.canWrite, user: { id: 'user-a' } }) }))`.
- Tambahkan dua mock berikut:

```jsx
vi.mock('@/services/rangkaian.service', () => ({ default: { getBySurat: mocks.getBySurat } }))
vi.mock('@/services/approval.service', () => ({ default: { getHistory: mocks.getHistory, getEligibleApprovers: mocks.getEligibleApprovers } }))
```

- Ubah `afterEach(cleanup)` menjadi `afterEach(() => { cleanup(); mocks.canWrite = false; vi.clearAllMocks() })`, lalu tambahkan `beforeEach(() => { mocks.getBySurat.mockResolvedValue(null); mocks.getHistory.mockResolvedValue([]); mocks.getEligibleApprovers.mockResolvedValue([]) })`. Tambahkan `beforeEach` ke impor `vitest`.
- Tambahkan test berikut:

```jsx
it('hides owner mutations and approval loading when read through a rangkaian', async () => {
    mocks.canWrite = true
    mocks.getById.mockResolvedValue({ id: 'surat-id', nomorSurat: '002/2026', perihal: 'ND BPPT', unitKerjaId: 'dir_bppt', approvalStatus: 'draft', aksesMelalui: 'pengawas' })
    render(<MemoryRouter initialEntries={['/surat/keluar/surat-id']}><Routes><Route path="/surat/keluar/:id" element={<SuratKeluarDetail />} /></Routes></MemoryRouter>)
    expect((await screen.findAllByText('ND BPPT')).length).toBeGreaterThan(0)
    expect(screen.queryAllByRole('button', { name: /^edit$/i })).toHaveLength(0)
    expect(mocks.getHistory).not.toHaveBeenCalled()
    expect(mocks.getBySurat).toHaveBeenCalledWith('surat_keluar', 'surat-id')
})

it('keeps the legacy reply link when the letter is not in a rangkaian', async () => {
    mocks.getById.mockResolvedValue({ id: 'surat-id', nomorSurat: '003/2026', perihal: 'Balasan lama', unitKerjaId: 'unit-a', balasanUntuk: 'sm-9', aksesMelalui: 'owner' })
    render(<MemoryRouter initialEntries={['/surat/keluar/surat-id']}><Routes><Route path="/surat/keluar/:id" element={<SuratKeluarDetail />} /></Routes></MemoryRouter>)
    expect(await screen.findByRole('link', { name: /lihat surat masuk/i })).toHaveAttribute('href', '/surat/masuk/sm-9')
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd frontend && npx vitest run src/pages/SuratMasukDetail.alur.test.jsx src/pages/SuratKeluarDetail.rules.test.jsx`
Expected: FAIL. Panel belum dirender (`Unable to find a label with the text of: Panel alur surat`), tombol Edit masih tampil untuk `peserta`, `getBySurat` belum dipanggil, dan `getHistory` dipanggil untuk pengawas.

- [ ] **Step 3: Implementasi**

`frontend/src/pages/SuratMasukDetail.jsx`:
- Tambahkan setelah baris 17: `import { AlurSuratPanel } from '@/components/surat/AlurSuratPanel'`
- Ganti baris 26 menjadi:

```jsx
    const aksesMelalui = surat?.aksesMelalui ?? 'owner'
    const isAdmin = Boolean(surat && aksesMelalui === 'owner' && canWrite(surat.unitKerjaId))
```

- Ganti baris 139 (`<InfoSection surat={surat} />`) menjadi:

```jsx
                    <InfoSection surat={surat} />
                    <AlurSuratPanel jenis="surat_masuk" suratId={surat.id} aksesMelalui={aksesMelalui} />
```

`frontend/src/pages/SuratKeluarDetail.jsx`:
- Tambahkan setelah baris 38: `import { AlurSuratPanel } from '@/components/surat/AlurSuratPanel'`
- Ganti baris 48 menjadi:

```jsx
    const aksesMelalui = surat?.aksesMelalui ?? 'owner'
    const isAdmin = Boolean(surat && aksesMelalui === 'owner' && canWrite(surat.unitKerjaId))
```

- Ganti blok baris 452–466 (`{/* Balasan dari Surat Masuk */}` sampai penutup `)}`) dengan:

```jsx
                            {/* Alur Surat (fallback: tautan balasan lama untuk surat tunggal) */}
                            <AlurSuratPanel
                                jenis="surat_keluar"
                                suratId={surat.id}
                                aksesMelalui={aksesMelalui}
                                fallback={surat.balasanUntuk ? (
                                    <>
                                        <Separator />
                                        <div className="space-y-2">
                                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Balasan dari Surat Masuk</label>
                                            <Button variant="outline" size="sm" asChild className="group">
                                                <Link to={`/surat/masuk/${surat.balasanUntuk}`}>
                                                    <MailOpen className="mr-2 h-4 w-4 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors" />
                                                    Lihat Surat Masuk
                                                </Link>
                                            </Button>
                                        </div>
                                    </>
                                ) : null}
                            />
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `cd frontend && npx vitest run src/pages/SuratMasukDetail.alur.test.jsx src/pages/SuratKeluarDetail.rules.test.jsx src/components/surat-masuk && npx eslint src/pages/SuratMasukDetail.jsx src/pages/SuratKeluarDetail.jsx`
Expected: PASS semua dan eslint tanpa error.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SuratMasukDetail.jsx frontend/src/pages/SuratKeluarDetail.jsx frontend/src/pages/SuratMasukDetail.alur.test.jsx frontend/src/pages/SuratKeluarDetail.rules.test.jsx
git commit -F - <<'EOF'
feat(frontend): pasang panel Alur Surat di detail surat dan kunci aksi untuk akses lintas unit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 13: Verifikasi regresi menyeluruh

**Files:**
- Tidak ada file baru. Perbaikan hanya dilakukan bila langkah di bawah menemukan regresi, dan setiap perbaikan mengikuti superpowers:systematic-debugging.

**Interfaces:**
- Consumes: seluruh keluaran Task 0–12.
- Produces: bukti hijau untuk kriteria selesai P2 (spec §10).

- [ ] **Step 1: Suite backend penuh**

Run: `cd backend && CI=true npx vitest run`
Expected: PASS semua, termasuk `tunjuk-silang`, `distribution`, `notification`, `srikandi-outbox`, `surat-masuk.routes`, `surat-file-security.routes`, `file-access-generation.routes`, `demo-access.middleware`, `migration-chain.integration`, dan snapshot `check()` tanpa "updated".

- [ ] **Step 2: Typecheck backend (tanpa error baru di file P2)**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "record-access|visibility-spec|record-unit-scope|rangkaian|surat-masuk.routes|surat-keluar.routes|file-access.routes|audit-log.service|app.ts|demo-access" ; echo "exit:$?"`
Expected: tidak ada baris error yang cocok (`grep` keluar dengan status 1, jadi output berakhir dengan `exit:1`).

- [ ] **Step 3: Suite frontend penuh + lint file P2**

Run: `cd frontend && npx vitest run && npx eslint src/components/surat src/services/rangkaian.service.js src/pages/SuratMasukDetail.jsx src/pages/SuratKeluarDetail.jsx src/pages/DosirDetail.jsx`
Expected: PASS semua, termasuk `integration-contracts.test.js`, `app-sidebar.groups.test.jsx`, `SuratKeluarDetail.rules.test.jsx`, test Dosir, dan test InfoSection. Eslint tanpa error.

- [ ] **Step 4: Periksa kriteria selesai spec §10 P2**

Pastikan setiap kriteria ditunjukkan oleh test yang hijau:
- matriks unit × role × kelas × grant × jangkauan: `record-access-read.integration.test.ts` dan `rangkaian-akses.routes.integration.test.ts`
- `admin_sesditjen` dengan unit NULL, `admin_unit@sesditjen` (pengawas via `is_unit_pengawas`), `admin_unit@dir_bppt` (bukan pengawas), `staff@sesditjen` (tanpa jangkauan): baris-baris matriks bernama sesuai
- property test paritas: `visibility-parity.property.integration.test.ts`
- non-peserta 404 dan `surat-file-security.routes.test.ts` hijau
- PUT/DELETE lintas unit 404
- disposisi ditolak mencabut jangkauan
- judul/instruksi tersamar
- `check()` identik (snapshot)

Tidak ada commit untuk langkah ini.

---

## Self-Review

**Cakupan spec**
- §4.1 `check()` tidak berubah: Task 1 (snapshot sebelum refaktor, `CI=true` di setiap run berikutnya).
- §4.2 pengawas = FULL_ADMIN + unit efektif `is_unit_pengawas`: Task 2 (`unitJangkauan`, `resolveKonteksBaca`), Task 3 (matriks, toggle `is_unit_pengawas`).
- §4.3 satu sumber predikat: Task 2 (`visibleSql`, `jangkauanSql`, `kelasUntukRole`, dan `kecocokanUnitRekaman` yang juga dipakai `isAllowedForRecordUnit`/`allowedSecurityClassifications`), Task 4 (paritas).
- §4.4 `findActiveGrant`/`checkRead`/`checkMany`: Task 1 dan 3. `mutable` selalu false untuk non-owner; surat keluar NULL diperlakukan terbatas lewat `klasifikasiRekamanSql`; kebijakan list admin tidak berlaku lintas unit.
- §4.5 jangkauan diturunkan langsung: `jangkauanSql` (Task 2) dan test pencabutan (Task 3, Task 8).
- §4.6 staff/auditor tanpa jangkauan: Task 3 dan Task 6.
- §4.7 `scopeForAuthorizedRead`: Task 5 dan Task 6.
- §4.8 penyamaran: Task 8, termasuk judul, instruksi, catatan, alasan tolak, dan metadata routing yang tetap tampil.
- §4.9 tanpa oracle: `visibleSql` diekspor untuk seed Lacak P3/P4; property test di Task 4.
- §4.10 audit: Task 6 (detail), Task 7 (kedua cabang stream), Task 9 (rangkaian).
- §5 GET `/api/rangkaian/:id` dan `/by-surat`: Task 9, dengan `validateIdParam`, allowlist demo, dan GET bebas efek samping (Task 6 menguji status disposisi tidak berubah).
- §7 Panel Alur Surat: Task 10–12. §10 P2 dan §11: Task 13.

**Pemindaian placeholder:** tidak ada "TBD", "TODO", atau "tangani error sesuai kebutuhan". Ada dua langkah bersyarat yang tindakannya tetap konkret: Task 4 Step 3 (`nullif`) dan Task 5 Step 3 (tambah `'rangkaian_surat'` bila P1 belum menambahkannya, dengan perintah `grep` untuk memeriksa). Instruksi "pertahankan badan fungsi baris 108–163" di Task 1 Step 7 merujuk ke kode yang sudah ada dan tidak berubah.

**Konsistensi tipe:** `ReadVia`, `ReadRef`, `ReadAccessResult`, `ReadExecutor`, dan `readRefKey` didefinisikan di Task 3, lalu dipakai persis sama di Task 5, 8, dan 9. `JenisRekamanRangkaian` didefinisikan di Task 2 dan dipakai di Task 3, 8, dan 9. `KonteksBaca.unitJangkauan`/`pengawas`/`disposisiLamaRead` konsisten di Task 2, 3, dan 8. Bentuk `RangkaianDetail` di Task 8 cocok dengan fixture frontend di Task 11. Properti audit `via`/`rangkaianId` sama di Task 6, 7, dan 9.

**Ambiguitas spec yang diputuskan di rencana ini**
1. `checkRead` mendelegasikan ke `checkMany`. Cabang pemilik memakai `evaluateOwnerAccess`, yaitu keputusan `check()` yang diekstrak, dan dibuktikan identik lewat test yang membandingkan hasilnya dengan `check()`.
2. Grant tanpa jalur pengawas/peserta tidak membuka akses lintas unit.
3. Cakupan rekaman pengawas adalah konstanta kode: `ditjen`, `sesditjen`, `dir_*`. Pengawas tingkat rangkaian mensyaratkan unit pencatat berada dalam cakupan itu.
4. `visibleSql` punya dua mode. `read` identik dengan `checkRead`. `list` hanya melonggarkan rekaman unit sendiri ke kebijakan list lama, sesuai §6 "unit sendiri memakai kebijakan list".
5. Pembaca tanpa jangkauan (misalnya staff lama pemilik induk) hanya menerima node yang dapat dibacanya, tanpa placeholder, peserta, atau rangkaian terkait. super_admin mendapat tampilan penuh berlabel `owner`, dan node terkendali tetap tersamar tanpa grant.
6. Relasi dengan salah satu ujung tersamar tetap tampil tanpa `keterangan`. Penyelesaian diekspos sebagai `penyelesaianAnggotaId`, bukan id surat. Rangkaian terkait tanpa judul.
7. Rangkaian `digabung` dialihkan satu hop dengan `dialihkanDari`. Anggota yang di-soft-delete tidak ditampilkan.
8. `aksiDiizinkan` selalu `[]` di P2. `dapatAjukanAkses` dihitung dari flag `RANGKAIAN_AJUKAN_AKSES` (mati → false) dan tombolnya dibangun di P3.
9. Audit stream menambah `via`/`rangkaianId` hanya untuk akses non-owner, sehingga payload pemilik tidak berubah. Lampiran dengan induk `arsip` tetap memakai `check()`.
10. Read model ditempatkan di `rangkaian-read.service.ts` terpisah agar tidak bentrok dengan `rangkaian.service.ts` milik P1 (mutasi). File route `rangkaian.routes.ts` dibuat di P2 dan diperluas P3.
11. Mount route dilakukan setelah `app.ts:370` (spec menyebut :378; nomor baris sudah bergeser).
12. `tunjuk-silang` (`checkEntityAccessMany`) tidak dipindah ke `checkMany`, karena relasi tunjuk silang tetap berlaku same-unit.
13. Parity string kosong: sudah ditangani P0 (`coalesce(nullif(col, ''), 'biasa')`); P2 hanya mengujinya (Task 4).

## Catatan Konsistensi Lintas Fase (2026-09-26)

Perubahan dari tinjauan konsistensi P0–P5 terhadap berkas ini:

- Task 2: `jangkauanSql(rangkaianId, unitKerjaId, disposisiLamaRead)` kini dirakit dari `jangkauanUnitsSql` P1 (`unit IN (SELECT … FROM jangkauanUnitsSql(id, { disposisiLama }))`) — tidak ada salinan cabang jangkauan; `KELAS_DIKENAL = SECURITY_CLASSES` (P0).
- Task 0/2 "Consumes from P0" disamakan persis dengan ekspor P0 (`klasifikasiNormSql(column: AnyColumn | SQL)`, dst.); Task 4 Step 3 bersyarat (nullif string kosong) dihapus karena P0 sudah menanganinya; perintah test paritas P0 diperbaiki ke `src/__tests__/visibility-spec.parity.test.ts`.
- Task 5: union `entityType` tidak lagi ditambah `rangkaian_surat` (milik P1 Task 9); P2 hanya menambah aksi `view_via_rangkaian`.
- Task 9: urutan mount final `/api/rangkaian` dicantumkan (P4 `rangkaianDaftarRoutes` → P5 `rangkaianBerkasRoutes` → P2 `rangkaianRoutes` terakhir), plus aturan route literal P3 sebelum `/:id`.
- Branch: `feat/integrasi-surat-p2` dari `origin/main` setelah PR P1 dimerge (sebelumnya: dari branch P1).
- Catatan: helper `helpers/rangkaian-pglite.ts` (P2) tetap milik P2; P5 memakai helper terpisah `helpers/rangkaian-p5-pglite.ts`. `muatPeserta` (Task 8) masih memiliki union bertanda `sumber` sendiri, dijaga test paritas terhadap `jangkauanSql`.
