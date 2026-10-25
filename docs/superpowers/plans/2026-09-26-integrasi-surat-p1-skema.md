# Integrasi Surat — P1 Skema & Layanan Inti Rangkaian Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menyediakan fondasi basis data dan layanan inti Rangkaian Surat (migrasi 0046 + 0047, skema Drizzle, grant append-only, runbook deploy, `rangkaianService` inti, dan `distribute(data, auditContext?, tx?)`) sehingga P2–P5 dapat dibangun tanpa mengubah skema lagi.

**Architecture:** Keanggotaan rangkaian disimpan di tabel terpisah (`rangkaian_surat`, `rangkaian_anggota`, `rangkaian_relasi`, `rangkaian_peserta`, `rangkaian_koreksi_berkas`); `surat_masuk` hanya mendapat index ekspresi, `surat_keluar` satu kolom `asal_naskah`, `surat_distributions` kolom disposisi baru, dan `unit_kerja` kolom `is_unit_pengawas` (D5). Integritas berkas dijaga trigger DB (penutupan atas anggota/relasi/disposisi, status berkas terminal, anti-siklus gabung, koreksi berkas via GUC). Layanan `rangkaian.service.ts` selalu menerima `tx` dari pemanggil, mengunci baris dengan urutan surat → rangkaian (id menaik) → distribusi, dan mengaudit setiap mutasi dengan `logActionOrThrow(tx)`. Fungsi turunan status yang murni dipisah di `rangkaian-status.ts` agar dapat diuji tanpa DB.

**Tech Stack:** Node 24, Express 5, TypeScript 5.9 (strict), Drizzle ORM 0.45 (node-postgres; PGlite di test), PostgreSQL 16+/Neon PG18, Vitest 4.1, PGlite 0.5 (+pgcrypto).

**Spec:** docs/superpowers/specs/2026-09-26-integrasi-surat-masuk-keluar-design.md

## Global Constraints

- **Cabang kerja:** mulai setelah P0 dimerge. `git fetch origin && git switch -c feat/integrasi-surat-p1 origin/main`. Konvensi lintas fase: satu branch per fase `feat/integrasi-surat-pN`, dibuat dari `origin/main` setelah PR fase sebelumnya dimerge; bila PR itu belum dimerge, branch ditumpuk di ujung `feat/integrasi-surat-p(N-1)` lalu di-rebase ke `origin/main` setelah merge. Satu PR per fase ke `main`. Semua perintah test dijalankan dari `backend/` kecuali disebut lain.
- **Aturan runner migrasi** (`backend/scripts/migrate-database.mjs:15-53`): journal `idx` harus sama dengan posisi, `when` naik ketat, tag cocok `^NNNN_[a-z0-9_]+$`, file UTF-8, akhir baris LF (dijaga `.gitattributes`: `backend/src/db/migrations/*.sql text eol=lf`), tidak ada baris diawali `\`, pemisah `--> statement-breakpoint`, seluruh rantai dijalankan dalam **satu transaksi** sebagai `simsa_migrator` yang **tidak** privileged: dilarang `CREATE EXTENSION`, `CONCURRENTLY`, `CREATE ROLE`, `ALTER SYSTEM`.
- **Jangan** menjalankan `drizzle-kit` (`db:generate`). Skema Drizzle ditulis tangan dan diverifikasi oleh `migration-chain.integration.test.ts`.
- **Jangan** mengubah migrasi 0000–0045, `deployment-unit-seed.sql`, `SuratMasukService.getStats`, `arsip.service`, `dosir.service`, producer SRIKANDI, `record-access.service.ts` `check()`.
- **D5:** tidak ada role baru. Pengawas = unit dengan `unit_kerja.is_unit_pengawas = true` (diputuskan: kolom ini masuk **0046**, bukan 0047). **D6:** `bagian_*` tidak dibuat/diubah dan tidak menjadi target disposisi.
- **0046 belum final sampai Task 2 di-commit.** Jangan pernah menerapkan 0046 ke database bersama (preview/prod) di antara Task 1 dan Task 2; hash migrasi berubah saat trigger ditambahkan.
- Kode aplikasi **tidak pernah** memakai `DELETE` pada tabel `rangkaian_*`. Semua mutasi rangkaian diaudit dengan `auditLogService.logActionOrThrow(entry, tx)`; entityType `rangkaian_surat`/`rangkaian_relasi`, disposisi tetap `surat_distribution`, status surat masuk `surat_masuk`.
- Layanan rangkaian **tidak** membuka transaksi sendiri; urutan kunci: baris surat → baris `rangkaian_surat` (ORDER BY id) → distribusi. P1 tidak menambah route dan tidak memanggil layanan rangkaian dari `surat-masuk.service`, `surat-keluar.service`, atau `approval.service` (itu P3).
- Prosa Bahasa Indonesia; identifier kode mengikuti gaya file yang disentuh.
- Setiap commit diakhiri baris kosong lalu `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Lima mode gagal yang paling mungkin lolos review, masing-masing dengan test di task pemiliknya:

1. **Konvergensi grant pada skema lama/Neon patah.** Menambah `REVOKE ... ON public.rangkaian_*` secara langsung di `grants/0002` membuat profil CI "0038 exact manifest restore grant convergence" (`.github/scripts/test-backup-upgrade-profile.mjs:88-100`) gagal karena tabel belum ada, dan adapter Neon menolak file karena hash tersemat (`scripts/neon-database-policy.mjs:124`). → Task 5: REVOKE dibungkus `to_regclass`, hash pin diperbarui; test statis di `database-role-policy.test.ts` + cek `loadNeonGrantPolicy()` + assertion hak di `database-role-grants.postgres.test.ts`.
2. **Instalasi baru tanpa pengawas.** Pada DB baru, `ditjen`/`sesditjen` baru dibuat oleh `seed:deployment` **setelah** migrasi, sehingga `UPDATE ... is_unit_pengawas = true` di 0046 tidak mengenai apa pun. → Task 1: trigger `BEFORE INSERT` `unit_kerja_default_pengawas`; test "0046 ... instalasi baru" memeriksa baris yang di-insert sesudah migrasi.
3. **Disposisi lama menembus berkas tertutup.** `POST /api/distributions` pra-P3 tidak mengisi `rangkaian_id`, sehingga trigger yang hanya melihat `NEW.rangkaian_id` bisa dilewati; juga race dengan pemberkasan bersamaan. → Task 2: trigger juga mencari rangkaian lewat `rangkaian_anggota.surat_masuk_id` dan mengunci `FOR SHARE` sebelum membaca status; test insert distribusi `rangkaian_id NULL` ditolak. Task 13 mengulangnya lewat `distributionService.distribute`.
4. **Paritas normalisasi nomor TS/SQL.** Spesifikasi menulis `q.toLowerCase().replace(/[^0-9a-z]+/g,'')`, sedangkan SQL membuang karakter dulu lalu `lower()`. Untuk `K` (Kelvin, U+212A) dan `İ` (U+0130) hasilnya berbeda sehingga pencarian P3/P4 diam-diam meleset. → Task 7: TS membuang dulu lalu lowercase; test paritas terhadap SQL yang dihasilkan `nomorNormSql` + EXPLAIN memakai `surat_masuk_nomor_norm_idx`.
5. **Pemetaan unique-violation gagal karena Drizzle membungkus error.** Drizzle 0.45 melempar `DrizzleQueryError` dengan error pg di `.cause`, jadi cek `error.code === '23505'` tidak pernah cocok dan race menghasilkan 500. → Task 13 (distribusi, index `surat_distributions_active_target_uidx`) dan Task 12 (`rangkaian_relasi_active_uidx`) memakai `hasPostgresErrorCode` (`utils/postgres-errors.ts:2`); test Proxy melempar error ber-`cause`.

---

## File Structure

| File | Aksi | Tanggung jawab |
|---|---|---|
| `backend/src/db/migrations/0046_rangkaian_surat.sql` | Create (Task 1, lengkapi Task 2) | Precheck, tabel rangkaian, kolom baru, index, `is_unit_pengawas`, trigger, REVOKE DELETE |
| `backend/src/db/migrations/0047_unit_kerja_direktorat.sql` | Create (Task 3) | Unit `dir_*` kanonik, fail-closed `direktorat-*` |
| `backend/src/db/migrations/meta/_journal.json` | Modify (Task 1, 3) | Entri idx 46 dan 47 |
| `backend/src/__tests__/migration-chain.integration.test.ts` | Modify (Task 1–4) | Test PGlite 0000–0047 |
| `backend/src/db/schema/rangkaian-surat.ts` | Create (Task 4) | Tabel Drizzle + tipe literal rangkaian |
| `backend/src/db/schema/surat-distribution.ts` | Modify (Task 4) | Kolom disposisi baru |
| `backend/src/db/schema/surat-keluar.ts` | Modify (Task 4) | `asalNaskah` |
| `backend/src/db/schema/unit-kerja.ts` | Modify (Task 4) | `isUnitPengawas` |
| `backend/src/db/schema/index.ts` | Modify (Task 4) | Ekspor skema rangkaian |
| `backend/src/db/grants/0002_converge_application_grants.sql` | Modify (Task 5) | REVOKE DELETE kondisional |
| `scripts/neon-database-policy.mjs` | Modify (Task 5) | Hash pin kebijakan grant |
| `backend/src/__tests__/database-role-policy.test.ts` | Modify (Task 5) | Test statis REVOKE |
| `backend/integration/database-role-grants.postgres.test.ts` | Modify (Task 5) | Hak API nyata di Postgres |
| `backend/src/services/readiness.service.ts` | Modify (Task 6) | Gerbang readiness skema 0046 |
| `backend/src/__tests__/readiness.service.test.ts` | Modify (Task 6) | Test isi readiness SQL |
| `backend/src/utils/nomor-surat.ts` | Create (Task 7) | `normalizeNomor`, `nomorNormSql` |
| `backend/src/__tests__/nomor-surat.test.ts` | Create (Task 7) | Paritas TS/SQL + penggunaan index |
| `backend/src/services/rangkaian-status.ts` | Create (Task 8) | Fungsi murni status & judul |
| `backend/src/__tests__/rangkaian-status.test.ts` | Create (Task 8) | Test table-driven |
| `backend/src/db/transaction.ts` | Create (Task 9) | Tipe `DbTransaction` |
| `backend/src/services/audit-log.service.ts` | Modify (Task 9) | Union action/entityType baru |
| `backend/src/services/access/visibility-spec.ts` | Modify (Task 10) | `jangkauanUnitsSql` + `JangkauanOptions` (sumber tunggal himpunan jangkauan; berkas dibuat P0, dilengkapi P2) |
| `backend/src/services/rangkaian.service.ts` | Create (Task 9–12) | Layanan inti rangkaian |
| `backend/src/__tests__/rangkaian.service.integration.test.ts` | Create (Task 9, lanjut 10–13) | Test PGlite layanan |
| `backend/src/services/distribution.service.ts` | Modify (Task 13) | `distribute(data, auditContext?, tx?)` |
| `backend/src/__tests__/distribution.service.test.ts` | Modify (Task 13) | Test Proxy tx/409/23505 |
| `docs/RUNBOOK_INTEGRASI_SURAT_P1.md` | Create (Task 14) | Runbook deploy P1 |

---

### Task 1: Migrasi 0046 — tabel, kolom, index, pengawas, dan REVOKE

**Files:**
- Create: `backend/src/db/migrations/0046_rangkaian_surat.sql`
- Modify: `backend/src/db/migrations/meta/_journal.json` (tambah entri setelah entri idx 45 yang berakhir sebelum `]` penutup)
- Test: `backend/src/__tests__/migration-chain.integration.test.ts` (tambah dua `it` sebelum `});` penutup `describe` di baris 807)

**Interfaces:**
- Consumes: tabel `unit_kerja`, `users`, `surat_masuk`, `surat_keluar`, `surat_distributions`, `klasifikasi_arsip`; role `simsa_api_runtime` (dibuat bootstrap/fixture).
- Produces (dipakai P2–P5):
  - `unit_kerja.is_unit_pengawas boolean NOT NULL DEFAULT false`; trigger `unit_kerja_default_pengawas` (BEFORE INSERT, set `true` untuk `ditjen`/`sesditjen`).
  - Sequence `rangkaian_surat_kode_seq`.
  - `rangkaian_surat(id, kode, asal, status, unit_pencatat_id, unit_pengolah_id, judul, tahun, klasifikasi_item_id, lanjutan_dari_id, digabung_ke_id, selesai_at, selesai_by, catatan_selesai, selesai_manual, diberkaskan_at, diberkaskan_by, created_by, created_at, updated_at)`; constraint `rangkaian_surat_kode_key`, `rangkaian_surat_asal_check`, `rangkaian_surat_status_check`, `rangkaian_berkas_check`, `rangkaian_gabung_check`, `rangkaian_selesai_manual_check`; index `rangkaian_surat_pengolah_status_idx`.
  - `rangkaian_anggota(id, rangkaian_id, surat_masuk_id, surat_keluar_id, unit_kerja_id, peran, sumber, ditambahkan_by, ditambahkan_at)`; `rangkaian_anggota_rangkaian_member_key UNIQUE(rangkaian_id,id)`, `rangkaian_anggota_satu_surat_check`, index `rangkaian_anggota_sm_uidx`, `rangkaian_anggota_sk_uidx`, `rangkaian_anggota_induk_uidx`, `rangkaian_anggota_unit_idx`.
  - `rangkaian_relasi(id, rangkaian_id, dari_anggota_id, ke_anggota_id, jenis_relasi, keterangan, created_by, created_at, cancelled_at, cancelled_by, cancellation_reason)`; FK komposit `rangkaian_relasi_dari_fk`/`rangkaian_relasi_ke_fk` `ON UPDATE CASCADE`; `rangkaian_relasi_pembatalan_check`; index `rangkaian_relasi_active_uidx`, `rangkaian_relasi_ke_idx`, `rangkaian_relasi_rangkaian_idx`.
  - `rangkaian_peserta(id, rangkaian_id, unit_kerja_id, peran, label_asal, created_by, created_at, berakhir_at, berakhir_by, alasan_berakhir)`; `rangkaian_peserta_berakhir_check`; `rangkaian_peserta_active_uidx`.
  - `rangkaian_koreksi_berkas(id, rangkaian_id, unit_pengolah_lama, unit_pengolah_baru, klasifikasi_lama, klasifikasi_baru, alasan, status, diajukan_by, diajukan_at, diputuskan_by, diputuskan_at)`; `rangkaian_koreksi_alasan_check`, `rangkaian_koreksi_status_check`, `rangkaian_koreksi_maker_checker_check`.
  - `disposisi_label_unit(label_norm, unit_kerja_id, perlu_verifikasi, catatan)`.
  - `surat_distributions` + `rangkaian_id uuid`, `batas_waktu date`, `penanggung_jawab boolean NOT NULL DEFAULT false`, `processed_by uuid`, `penyelesaian_surat_keluar_id uuid`, `catatan_penyelesaian text`, `ditutup_pengawas boolean NOT NULL DEFAULT false`; `surat_distributions_status_check`; `surat_distributions_active_target_uidx`, `surat_distributions_target_status_idx`, `surat_distributions_rangkaian_idx`.
  - `surat_keluar.asal_naskah varchar(15)` + `surat_keluar_asal_naskah_check`; `idx_surat_keluar_balasan`; `surat_masuk_nomor_norm_idx`, `surat_keluar_nomor_norm_idx`.
  - `simsa_api_runtime` tidak punya `DELETE` atas kelima tabel `rangkaian_*` sejak migrasi (jendela sebelum converge tertutup).

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan dua test berikut ke `migration-chain.integration.test.ts`, tepat sebelum `});` terakhir (baris 807):

```ts
    it('0046 menolak distribusi yang belum direkonsiliasi lalu meng-upgrade data lama tanpa memicu guard 0021', async () => {
        const database = await createDatabase();
        const index0046 = journal.entries.findIndex(({ tag }) => tag === '0046_rangkaian_surat');
        expect(index0046).toBeGreaterThan(0);
        for (const entry of journal.entries.slice(0, index0046)) {
            await applyMigration(database, entry);
        }

        const smLama = '46000000-0000-4000-8000-000000000001';
        const skBalasan = '46000000-0000-4000-8000-000000000002';
        const skArsip = '46000000-0000-4000-8000-000000000003';
        // Fixture meniru data lama: perihal NULL, balasan_untuk terisi, satu
        // surat keluar terarsip sehingga trigger 0021 aktif saat 0046 meng-UPDATE.
        await database.exec(`
            INSERT INTO unit_kerja (id, name) VALUES
                ('ditjen', 'Direktorat Jenderal'),
                ('sesditjen', 'Sekretariat Direktorat Jenderal'),
                ('unit-46-target', 'Unit Target 0046');
            INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal)
            VALUES ('${smLama}', 'sesditjen', 1, 2025, 'B-12/PTPP.1/IX/2024', NULL);
            INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal, balasan_untuk)
            VALUES
                ('${skBalasan}', 'sesditjen', 1, 2025, 'ND-1/2025', 'Balasan lama', '${smLama}'),
                ('${skArsip}', 'sesditjen', 2, 2025, 'ND-2/2025', 'Balasan terarsip', '${smLama}');
            INSERT INTO arsip (
                unit_kerja_id, jenis_arsip, source_surat_id, tahun,
                nomor_surat_original, perihal_original
            ) VALUES ('sesditjen', 'keluar', '${skArsip}', 2025, 'ND-2/2025', 'Balasan terarsip');
            INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status)
            VALUES ('${smLama}', 'sesditjen', 'unit-46-target', 'diarsipkan');
        `);

        await expect(applyMigration(database, journal.entries[index0046]))
            .rejects.toThrow(/0046: status surat_distributions tidak dikenal/);

        await database.exec(`
            UPDATE surat_distributions SET status = 'sent' WHERE surat_masuk_id = '${smLama}';
            INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status)
            VALUES ('${smLama}', 'sesditjen', 'unit-46-target', 'received');
        `);
        await expect(applyMigration(database, journal.entries[index0046]))
            .rejects.toThrow(/0046: distribusi aktif ganda/);
        const untouched = await database.query<{ relation: string | null }>(
            `SELECT to_regclass('public.rangkaian_surat')::text AS relation`,
        );
        expect(untouched.rows).toEqual([{ relation: null }]);

        await database.exec(`
            UPDATE surat_distributions
            SET status = 'rejected', rejection_reason = 'Salah alamat unit tujuan'
            WHERE surat_masuk_id = '${smLama}' AND status = 'received';
        `);
        await applyMigration(database, journal.entries[index0046]);

        const upgraded = await database.query<{
            id: string;
            asal_naskah: string | null;
            is_archived: boolean;
        }>(`SELECT id, asal_naskah, is_archived FROM surat_keluar ORDER BY id`);
        expect(upgraded.rows).toEqual([
            { id: skBalasan, asal_naskah: 'tindak_lanjut', is_archived: false },
            { id: skArsip, asal_naskah: 'tindak_lanjut', is_archived: true },
        ]);

        const pengawas = await database.query<{ id: string; is_unit_pengawas: boolean }>(`
            SELECT id, is_unit_pengawas FROM unit_kerja ORDER BY id COLLATE "C"
        `);
        expect(pengawas.rows).toEqual([
            { id: 'ditjen', is_unit_pengawas: true },
            { id: 'sesditjen', is_unit_pengawas: true },
            { id: 'unit-46-target', is_unit_pengawas: false },
        ]);

        const distribusi = await database.query(`
            SELECT status, rangkaian_id, penanggung_jawab, ditutup_pengawas
            FROM surat_distributions ORDER BY status
        `);
        expect(distribusi.rows).toEqual([
            { status: 'rejected', rangkaian_id: null, penanggung_jawab: false, ditutup_pengawas: false },
            { status: 'sent', rangkaian_id: null, penanggung_jawab: false, ditutup_pengawas: false },
        ]);

        // Baris rejected boleh berulang; distribusi aktif ganda ditolak index parsial.
        await database.exec(`
            INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status)
            VALUES ('${smLama}', 'sesditjen', 'unit-46-target', 'rejected')
        `);
        await expect(database.exec(`
            INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status)
            VALUES ('${smLama}', 'sesditjen', 'unit-46-target', 'sent')
        `)).rejects.toThrow(/surat_distributions_active_target_uidx|duplicate key/i);
        await expect(database.exec(`
            UPDATE surat_distributions SET status = 'arsip' WHERE status = 'sent'
        `)).rejects.toThrow(/surat_distributions_status_check|check constraint/i);
    }, PGLITE_MIGRATION_TIMEOUT_MS);

    it('0046 menegakkan jejak alasan, index anggota, hak append-only, dan flag pengawas pada instalasi baru', async () => {
        const database = await createDatabase();
        for (const entry of journal.entries) {
            await applyMigration(database, entry);
        }

        const userId = '46000000-0000-4000-8000-0000000000a1';
        const sm = '46000000-0000-4000-8000-0000000000a2';
        const sk = '46000000-0000-4000-8000-0000000000a3';
        await database.exec(`
            INSERT INTO unit_kerja (id, name) VALUES
                ('ditjen', 'Ditjen'), ('sesditjen', 'Sesditjen'), ('unit-46-a', 'Unit A');
            INSERT INTO users (id, email, role)
            VALUES ('${userId}', 'rangkaian-0046@example.test', 'super_admin');
            INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal)
            VALUES ('${sm}', 'sesditjen', 1, 2026, 'SM-1/2026', 'Surat induk');
            INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal)
            VALUES ('${sk}', 'unit-46-a', 1, 2026, 'ND-1/2026', 'Tindak lanjut');
        `);

        // Seed deployment berjalan SESUDAH migrasi; trigger insert memberi nilai awal.
        const pengawas = await database.query<{ id: string; is_unit_pengawas: boolean }>(`
            SELECT id, is_unit_pengawas FROM unit_kerja
            WHERE id IN ('ditjen', 'sesditjen', 'unit-46-a') ORDER BY id COLLATE "C"
        `);
        expect(pengawas.rows).toEqual([
            { id: 'ditjen', is_unit_pengawas: true },
            { id: 'sesditjen', is_unit_pengawas: true },
            { id: 'unit-46-a', is_unit_pengawas: false },
        ]);

        const rangkaianId = (await database.query<{ id: string }>(`
            INSERT INTO rangkaian_surat (kode, asal, unit_pencatat_id, judul, tahun)
            VALUES ('RS-2026-000001', 'surat_masuk', 'sesditjen', 'Surat induk', 2026)
            RETURNING id
        `)).rows[0].id;

        await expect(database.exec(`
            UPDATE rangkaian_surat
            SET status = 'selesai', selesai_manual = true, selesai_by = '${userId}'
            WHERE id = '${rangkaianId}'
        `)).rejects.toThrow(/rangkaian_selesai_manual_check/);
        await expect(database.exec(`
            UPDATE rangkaian_surat
            SET status = 'selesai', selesai_manual = true, selesai_by = '${userId}',
                catatan_selesai = '   pendek  '
            WHERE id = '${rangkaianId}'
        `)).rejects.toThrow(/rangkaian_selesai_manual_check/);
        await expect(database.exec(`
            UPDATE rangkaian_surat SET status = 'digabung' WHERE id = '${rangkaianId}'
        `)).rejects.toThrow(/rangkaian_gabung_check/);

        const indukId = (await database.query<{ id: string }>(`
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran)
            VALUES ('${rangkaianId}', '${sm}', 'sesditjen', 'induk') RETURNING id
        `)).rows[0].id;
        const anggotaId = (await database.query<{ id: string }>(`
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_keluar_id, unit_kerja_id)
            VALUES ('${rangkaianId}', '${sk}', 'unit-46-a') RETURNING id
        `)).rows[0].id;
        await expect(database.exec(`
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, surat_keluar_id, unit_kerja_id)
            VALUES ('${rangkaianId}', '${sm}', '${sk}', 'sesditjen')
        `)).rejects.toThrow(/rangkaian_anggota_satu_surat_check/);
        await expect(database.exec(`
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id)
            VALUES ('${rangkaianId}', '${sm}', 'sesditjen')
        `)).rejects.toThrow(/rangkaian_anggota_sm_uidx|duplicate key/i);

        const relasiId = (await database.query<{ id: string }>(`
            INSERT INTO rangkaian_relasi (rangkaian_id, dari_anggota_id, ke_anggota_id, jenis_relasi)
            VALUES ('${rangkaianId}', '${anggotaId}', '${indukId}', 'tindak_lanjut') RETURNING id
        `)).rows[0].id;
        await expect(database.exec(`
            UPDATE rangkaian_relasi SET cancelled_at = now(), cancelled_by = '${userId}'
            WHERE id = '${relasiId}'
        `)).rejects.toThrow(/rangkaian_relasi_pembatalan_check/);
        await expect(database.exec(`
            INSERT INTO rangkaian_relasi (rangkaian_id, dari_anggota_id, ke_anggota_id, jenis_relasi)
            VALUES ('${rangkaianId}', '${anggotaId}', '${indukId}', 'tindak_lanjut')
        `)).rejects.toThrow(/rangkaian_relasi_active_uidx|duplicate key/i);

        await expect(database.exec(`
            INSERT INTO rangkaian_peserta (
                rangkaian_id, unit_kerja_id, peran, berakhir_at, berakhir_by
            ) VALUES ('${rangkaianId}', 'unit-46-a', 'disposisi_lama', now(), '${userId}')
        `)).rejects.toThrow(/rangkaian_peserta_berakhir_check/);
        await expect(database.exec(`
            INSERT INTO rangkaian_koreksi_berkas (
                rangkaian_id, unit_pengolah_lama, unit_pengolah_baru,
                klasifikasi_lama, klasifikasi_baru, alasan, diajukan_by
            ) VALUES ('${rangkaianId}', 'unit-46-a', 'sesditjen', 1, 1, '   ', '${userId}')
        `)).rejects.toThrow(/rangkaian_koreksi_alasan_check/);

        const privileges = await database.query<Record<string, boolean>>(`
            SELECT
                has_table_privilege('simsa_api_runtime', 'public.rangkaian_surat', 'DELETE') AS delete_surat,
                has_table_privilege('simsa_api_runtime', 'public.rangkaian_anggota', 'DELETE') AS delete_anggota,
                has_table_privilege('simsa_api_runtime', 'public.rangkaian_relasi', 'DELETE') AS delete_relasi,
                has_table_privilege('simsa_api_runtime', 'public.rangkaian_peserta', 'DELETE') AS delete_peserta,
                has_table_privilege('simsa_api_runtime', 'public.rangkaian_koreksi_berkas', 'DELETE') AS delete_koreksi,
                has_table_privilege('simsa_api_runtime', 'public.rangkaian_surat', 'INSERT,UPDATE') AS write_surat,
                has_sequence_privilege('simsa_api_runtime', 'public.rangkaian_surat_kode_seq', 'USAGE') AS kode_seq
        `);
        expect(privileges.rows).toEqual([{
            delete_surat: false,
            delete_anggota: false,
            delete_relasi: false,
            delete_peserta: false,
            delete_koreksi: false,
            write_surat: true,
            kode_seq: true,
        }]);
    }, PGLITE_MIGRATION_TIMEOUT_MS);
```

Catatan: CHECK dievaluasi sebelum trigger FK (AFTER), sehingga `klasifikasi_baru = 1` yang belum tentu ada tidak memengaruhi hasil; alur koreksi lengkap diuji di Task 2.

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/migration-chain.integration.test.ts -t "0046"`
Expected: FAIL — `expect(index0046).toBeGreaterThan(0)` gagal (`-1`) dan test kedua gagal karena `relation "rangkaian_surat" does not exist`.

- [ ] **Step 3: Tulis migrasi 0046 (bagian struktur)**

Buat `backend/src/db/migrations/0046_rangkaian_surat.sql` (LF):

```sql
-- 0046: Rangkaian Surat. Keanggotaan disimpan di tabel terpisah sehingga
-- surat_masuk hanya mendapat index ekspresi dan surat_keluar satu kolom
-- opsional asal_naskah (bukan kolom yang dijaga trigger 0021).
-- Precheck fail-closed (pola 0012/0021): data harus direkonsiliasi operator,
-- migrasi tidak pernah mengubahnya diam-diam.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM surat_distributions
        WHERE status IS NULL OR status NOT IN ('sent', 'received', 'processed', 'rejected')
    ) THEN
        RAISE EXCEPTION '0046: status surat_distributions tidak dikenal, rekonsiliasi dulu'
            USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
        SELECT 1 FROM surat_distributions
        WHERE status <> 'rejected'
        GROUP BY surat_masuk_id, target_unit_id
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION '0046: distribusi aktif ganda (surat,target), rekonsiliasi dulu'
            USING ERRCODE = '23505';
    END IF;
END $$;
--> statement-breakpoint
-- D5: pengawas ditentukan unit, bukan role. Hanya super_admin yang mengubahnya.
ALTER TABLE unit_kerja ADD COLUMN is_unit_pengawas boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE unit_kerja
SET is_unit_pengawas = true, updated_at = now()
WHERE id IN ('ditjen', 'sesditjen') AND is_unit_pengawas IS DISTINCT FROM true;
--> statement-breakpoint
-- Instalasi baru: seed deployment membuat ditjen/sesditjen SESUDAH migrasi.
-- Trigger ini hanya memberi nilai awal saat baris dibuat; perubahan
-- berikutnya tetap lewat pengaturan unit kerja oleh super_admin.
CREATE OR REPLACE FUNCTION unit_kerja_default_pengawas()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.id IN ('ditjen', 'sesditjen') THEN
        NEW.is_unit_pengawas := true;
    END IF;
    RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION unit_kerja_default_pengawas() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS unit_kerja_default_pengawas ON unit_kerja;
--> statement-breakpoint
CREATE TRIGGER unit_kerja_default_pengawas
BEFORE INSERT ON unit_kerja
FOR EACH ROW EXECUTE FUNCTION unit_kerja_default_pengawas();
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS rangkaian_surat_kode_seq;
--> statement-breakpoint
CREATE TABLE rangkaian_surat (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kode varchar(30) NOT NULL CONSTRAINT rangkaian_surat_kode_key UNIQUE,
    asal varchar(20) NOT NULL CONSTRAINT rangkaian_surat_asal_check
        CHECK (asal IN ('surat_masuk', 'inisiatif', 'data_lama')),
    status varchar(20) NOT NULL DEFAULT 'aktif' CONSTRAINT rangkaian_surat_status_check
        CHECK (status IN ('aktif', 'selesai', 'diberkaskan', 'digabung')),
    unit_pencatat_id varchar(50) NOT NULL REFERENCES unit_kerja(id),
    unit_pengolah_id varchar(50) REFERENCES unit_kerja(id),
    judul text NOT NULL,
    tahun integer NOT NULL,
    klasifikasi_item_id integer REFERENCES klasifikasi_arsip(id) ON DELETE RESTRICT,
    lanjutan_dari_id uuid REFERENCES rangkaian_surat(id),
    digabung_ke_id uuid REFERENCES rangkaian_surat(id),
    selesai_at timestamptz,
    selesai_by uuid REFERENCES users(id),
    catatan_selesai text,
    selesai_manual boolean NOT NULL DEFAULT false,
    diberkaskan_at timestamptz,
    diberkaskan_by uuid REFERENCES users(id),
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT rangkaian_berkas_check CHECK (
        status <> 'diberkaskan' OR (
            unit_pengolah_id IS NOT NULL
            AND klasifikasi_item_id IS NOT NULL
            AND diberkaskan_at IS NOT NULL
            AND diberkaskan_by IS NOT NULL
        )
    ),
    CONSTRAINT rangkaian_gabung_check CHECK (
        (status = 'digabung') = (digabung_ke_id IS NOT NULL)
        AND digabung_ke_id IS DISTINCT FROM id
    ),
    CONSTRAINT rangkaian_selesai_manual_check CHECK (
        NOT selesai_manual
        OR (selesai_by IS NOT NULL AND coalesce(length(trim(catatan_selesai)), 0) >= 10)
    )
);
--> statement-breakpoint
CREATE INDEX rangkaian_surat_pengolah_status_idx ON rangkaian_surat (unit_pengolah_id, status);
--> statement-breakpoint
CREATE TABLE rangkaian_anggota (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rangkaian_id uuid NOT NULL REFERENCES rangkaian_surat(id),
    surat_masuk_id uuid REFERENCES surat_masuk(id),
    surat_keluar_id uuid REFERENCES surat_keluar(id),
    -- Snapshot pemilik rekaman; tidak pernah berubah (dijaga trigger 0046).
    unit_kerja_id varchar(50) NOT NULL REFERENCES unit_kerja(id),
    peran varchar(10) NOT NULL DEFAULT 'anggota' CONSTRAINT rangkaian_anggota_peran_check
        CHECK (peran IN ('induk', 'anggota')),
    sumber varchar(15) NOT NULL DEFAULT 'aplikasi' CONSTRAINT rangkaian_anggota_sumber_check
        CHECK (sumber IN ('aplikasi', 'tautan', 'gabung', 'data_lama')),
    ditambahkan_by uuid REFERENCES users(id),
    ditambahkan_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT rangkaian_anggota_satu_surat_check
        CHECK (num_nonnulls(surat_masuk_id, surat_keluar_id) = 1),
    CONSTRAINT rangkaian_anggota_rangkaian_member_key UNIQUE (rangkaian_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX rangkaian_anggota_sm_uidx ON rangkaian_anggota (surat_masuk_id) WHERE surat_masuk_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX rangkaian_anggota_sk_uidx ON rangkaian_anggota (surat_keluar_id) WHERE surat_keluar_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX rangkaian_anggota_induk_uidx ON rangkaian_anggota (rangkaian_id) WHERE peran = 'induk';
--> statement-breakpoint
CREATE INDEX rangkaian_anggota_unit_idx ON rangkaian_anggota (unit_kerja_id, rangkaian_id);
--> statement-breakpoint
CREATE TABLE rangkaian_relasi (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rangkaian_id uuid NOT NULL,
    dari_anggota_id uuid NOT NULL,
    ke_anggota_id uuid NOT NULL,
    jenis_relasi varchar(20) NOT NULL CONSTRAINT rangkaian_relasi_jenis_check
        CHECK (jenis_relasi IN ('balasan', 'tindak_lanjut', 'menjelaskan', 'merujuk')),
    keterangan text,
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    cancelled_at timestamptz,
    cancelled_by uuid REFERENCES users(id),
    cancellation_reason text,
    CONSTRAINT rangkaian_relasi_dari_fk FOREIGN KEY (rangkaian_id, dari_anggota_id)
        REFERENCES rangkaian_anggota (rangkaian_id, id) ON UPDATE CASCADE,
    CONSTRAINT rangkaian_relasi_ke_fk FOREIGN KEY (rangkaian_id, ke_anggota_id)
        REFERENCES rangkaian_anggota (rangkaian_id, id) ON UPDATE CASCADE,
    CONSTRAINT rangkaian_relasi_bukan_diri_check CHECK (dari_anggota_id <> ke_anggota_id),
    -- Pola 0012:22: alasan NULL ditolak karena coalesce(...) = 0.
    CONSTRAINT rangkaian_relasi_pembatalan_check CHECK (
        (cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason IS NULL)
        OR (
            cancelled_at IS NOT NULL
            AND cancelled_by IS NOT NULL
            AND coalesce(length(trim(cancellation_reason)), 0) >= 10
        )
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX rangkaian_relasi_active_uidx ON rangkaian_relasi (dari_anggota_id, ke_anggota_id, jenis_relasi) WHERE cancelled_at IS NULL;
--> statement-breakpoint
CREATE INDEX rangkaian_relasi_ke_idx ON rangkaian_relasi (ke_anggota_id) WHERE cancelled_at IS NULL;
--> statement-breakpoint
CREATE INDEX rangkaian_relasi_rangkaian_idx ON rangkaian_relasi (rangkaian_id);
--> statement-breakpoint
-- Peserta eksplisit HANYA untuk data lama (P5); dapat dicabut dengan jejak.
CREATE TABLE rangkaian_peserta (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rangkaian_id uuid NOT NULL REFERENCES rangkaian_surat(id),
    unit_kerja_id varchar(50) NOT NULL REFERENCES unit_kerja(id),
    peran varchar(20) NOT NULL CONSTRAINT rangkaian_peserta_peran_check
        CHECK (peran IN ('disposisi_lama')),
    label_asal text,
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    berakhir_at timestamptz,
    berakhir_by uuid REFERENCES users(id),
    alasan_berakhir text,
    CONSTRAINT rangkaian_peserta_berakhir_check CHECK (
        berakhir_at IS NULL OR (
            berakhir_by IS NOT NULL
            AND coalesce(length(trim(alasan_berakhir)), 0) >= 10
        )
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX rangkaian_peserta_active_uidx ON rangkaian_peserta (rangkaian_id, unit_kerja_id, peran) WHERE berakhir_at IS NULL;
--> statement-breakpoint
-- Koreksi berkas yang sudah diberkaskan (maker-checker, spesifikasi §9).
CREATE TABLE rangkaian_koreksi_berkas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rangkaian_id uuid NOT NULL REFERENCES rangkaian_surat(id),
    unit_pengolah_lama varchar(50) NOT NULL,
    unit_pengolah_baru varchar(50) NOT NULL REFERENCES unit_kerja(id),
    klasifikasi_lama integer NOT NULL,
    klasifikasi_baru integer NOT NULL REFERENCES klasifikasi_arsip(id),
    alasan text NOT NULL CONSTRAINT rangkaian_koreksi_alasan_check
        CHECK (coalesce(length(trim(alasan)), 0) >= 10),
    status varchar(15) NOT NULL DEFAULT 'pending' CONSTRAINT rangkaian_koreksi_status_check
        CHECK (status IN ('pending', 'approved', 'denied', 'applied')),
    diajukan_by uuid NOT NULL REFERENCES users(id),
    diajukan_at timestamptz NOT NULL DEFAULT now(),
    diputuskan_by uuid REFERENCES users(id),
    diputuskan_at timestamptz,
    CONSTRAINT rangkaian_koreksi_maker_checker_check
        CHECK (diputuskan_by IS NULL OR diputuskan_by <> diajukan_by)
);
--> statement-breakpoint
CREATE TABLE disposisi_label_unit (
    label_norm varchar(100) PRIMARY KEY,
    unit_kerja_id varchar(50) REFERENCES unit_kerja(id),
    perlu_verifikasi boolean NOT NULL DEFAULT false,
    catatan text
);
--> statement-breakpoint
ALTER TABLE surat_distributions
    ADD COLUMN rangkaian_id uuid REFERENCES rangkaian_surat(id),
    ADD COLUMN batas_waktu date,
    ADD COLUMN penanggung_jawab boolean NOT NULL DEFAULT false,
    ADD COLUMN processed_by uuid REFERENCES users(id),
    ADD COLUMN penyelesaian_surat_keluar_id uuid REFERENCES surat_keluar(id),
    ADD COLUMN catatan_penyelesaian text,
    ADD COLUMN ditutup_pengawas boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE surat_distributions ADD CONSTRAINT surat_distributions_status_check
    CHECK (status IN ('sent', 'received', 'processed', 'rejected'));
--> statement-breakpoint
CREATE UNIQUE INDEX surat_distributions_active_target_uidx ON surat_distributions (surat_masuk_id, target_unit_id) WHERE status <> 'rejected';
--> statement-breakpoint
CREATE INDEX surat_distributions_target_status_idx ON surat_distributions (target_unit_id, status);
--> statement-breakpoint
CREATE INDEX surat_distributions_rangkaian_idx ON surat_distributions (rangkaian_id, target_unit_id) WHERE rangkaian_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE surat_keluar ADD COLUMN asal_naskah varchar(15)
    CONSTRAINT surat_keluar_asal_naskah_check
    CHECK (asal_naskah IS NULL OR asal_naskah IN ('inisiatif', 'tindak_lanjut'));
--> statement-breakpoint
-- Hanya menyentuh kolom yang tidak dijaga 0021; baris terarsip tetap konsisten.
UPDATE surat_keluar SET asal_naskah = 'tindak_lanjut'
WHERE balasan_untuk IS NOT NULL AND asal_naskah IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_surat_keluar_balasan ON surat_keluar (balasan_untuk) WHERE balasan_untuk IS NOT NULL;
--> statement-breakpoint
-- Ekspresi HARUS identik dengan nomorNormSql() di backend/src/utils/nomor-surat.ts.
CREATE INDEX surat_masuk_nomor_norm_idx ON surat_masuk ((lower(regexp_replace(coalesce(nomor_surat, ''), '[^0-9A-Za-z]+', '', 'g'))) text_pattern_ops);
--> statement-breakpoint
CREATE INDEX surat_keluar_nomor_norm_idx ON surat_keluar ((lower(regexp_replace(coalesce(nomor_surat, ''), '[^0-9A-Za-z]+', '', 'g'))) text_pattern_ops);
--> statement-breakpoint
-- Default privileges memberi DELETE ke runtime; tabel berkas ini append-only
-- bagi aplikasi sejak migrasi (grants/0002 mengulanginya saat konvergensi).
REVOKE DELETE ON TABLE
    rangkaian_surat,
    rangkaian_anggota,
    rangkaian_relasi,
    rangkaian_peserta,
    rangkaian_koreksi_berkas
    FROM simsa_api_runtime;
```

- [ ] **Step 4: Tambah entri journal**

Di `backend/src/db/migrations/meta/_journal.json`, ganti blok penutup entri idx 45:

```json
    {
      "idx": 45,
      "version": "7",
      "when": 1789397416667,
      "tag": "0045_dosir_date_order",
      "breakpoints": true
    }
  ]
}
```

menjadi:

```json
    {
      "idx": 45,
      "version": "7",
      "when": 1789397416667,
      "tag": "0045_dosir_date_order",
      "breakpoints": true
    },
    {
      "idx": 46,
      "version": "7",
      "when": 1789397417667,
      "tag": "0046_rangkaian_surat",
      "breakpoints": true
    }
  ]
}
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/migration-chain.integration.test.ts src/__tests__/migration-runner.test.ts`
Expected: PASS semua test (termasuk dua test 0046 baru dan `has a contiguous, chronological journal`).

- [ ] **Step 6: Pastikan akhir baris LF**

Run: `git add -N backend/src/db/migrations/0046_rangkaian_surat.sql && git ls-files --eol backend/src/db/migrations/0046_rangkaian_surat.sql`
Expected: output memuat `i/lf` dan `w/lf` (bukan `crlf`).

- [ ] **Step 7: Commit**

```bash
git add backend/src/db/migrations/0046_rangkaian_surat.sql backend/src/db/migrations/meta/_journal.json backend/src/__tests__/migration-chain.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(db): tambah skema rangkaian surat 0046 (tabel, kolom, index, pengawas)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Migrasi 0046 — trigger penutupan berkas, status terminal, anti-siklus, koreksi GUC

**Files:**
- Modify: `backend/src/db/migrations/0046_rangkaian_surat.sql` (tambahkan di akhir file, setelah statement `REVOKE DELETE ...`)
- Test: `backend/src/__tests__/migration-chain.integration.test.ts` (tambah satu `it` setelah test Task 1)

**Interfaces:**
- Consumes: tabel Task 1.
- Produces:
  - Fungsi `rangkaian_guard_closed()`; trigger `rangkaian_anggota_closed_guard`, `rangkaian_relasi_closed_guard`, `surat_distributions_closed_guard` (BEFORE INSERT OR UPDATE OR DELETE). Menolak (SQLSTATE `23514`, pesan memuat `sudah diberkaskan`) bila rangkaian lama/baru — atau, untuk `surat_distributions`, rangkaian tempat `surat_masuk_id` menjadi anggota — berstatus `diberkaskan`. Mengunci `rangkaian_surat` `FOR SHARE` sebelum membaca status. Juga menolak perubahan `surat_masuk_id`/`surat_keluar_id`/`unit_kerja_id` anggota (`Identitas anggota rangkaian`).
  - Fungsi `rangkaian_guard_status()`; trigger `rangkaian_surat_status_guard` (BEFORE INSERT OR UPDATE): `diberkaskan` terminal; `diberkaskan_at/by` tetap; `unit_pengolah_id`/`klasifikasi_item_id` hanya berubah bila `current_setting('simsa.berkas_koreksi', true)` = id baris `rangkaian_koreksi_berkas` `approved` (dengan `diputuskan_by`/`diputuskan_at` terisi) untuk rangkaian itu dan nilai lama/baru sama persis; `digabung` terminal; `digabung_ke_id` tidak boleh menunjuk rangkaian `digabung`/`diberkaskan` (anti-siklus).
  - Kontrak untuk P3/P5: layanan wajib mengunci `rangkaian_surat ... FOR UPDATE` sebelum menulis anggota/relasi/disposisi agar `FOR SHARE` di trigger tidak menjadi lock-upgrade deadlock. Penerapan koreksi (P5) memanggil `SELECT set_config('simsa.berkas_koreksi', <id>, true)` dalam transaksi yang sama.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan setelah test Task 1:

```ts
    it('0046 mengunci rangkaian yang diberkaskan, mencegah siklus gabung, dan hanya menerima koreksi berkas yang disetujui', async () => {
        const database = await createDatabase();
        for (const entry of journal.entries) {
            await applyMigration(database, entry);
        }

        const maker = '46000000-0000-4000-8000-0000000000b1';
        const checker = '46000000-0000-4000-8000-0000000000b2';
        const sm = '46000000-0000-4000-8000-0000000000b3';
        const smLain = '46000000-0000-4000-8000-0000000000b4';
        const sk = '46000000-0000-4000-8000-0000000000b5';
        await database.exec(`
            INSERT INTO unit_kerja (id, name) VALUES
                ('unit-46-tu', 'TU'), ('unit-46-dir', 'Direktorat'), ('unit-46-dir2', 'Direktorat 2');
            INSERT INTO users (id, email, role) VALUES
                ('${maker}', 'maker-0046@example.test', 'super_admin'),
                ('${checker}', 'checker-0046@example.test', 'super_admin');
            INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal) VALUES
                ('${sm}', 'unit-46-tu', 1, 2026, 'SM-46/2026', 'Surat induk'),
                ('${smLain}', 'unit-46-tu', 2, 2026, 'SM-47/2026', 'Surat lain');
            INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal, approval_status)
            VALUES ('${sk}', 'unit-46-dir', 1, 2026, 'ND-46/2026', 'Tindak lanjut terarsip', 'approved');
            INSERT INTO arsip (
                unit_kerja_id, jenis_arsip, source_surat_id, tahun,
                nomor_surat_original, perihal_original
            ) VALUES ('unit-46-dir', 'keluar', '${sk}', 2026, 'ND-46/2026', 'Tindak lanjut terarsip');
        `);
        const klasifikasi = async (kode: string, key: string) => (await database.query<{ id: number }>(`
            INSERT INTO klasifikasi_arsip (kode, source_record_key, jenis, tipe)
            VALUES ('${kode}', '${key}', 'Uji rangkaian', 'substantif') RETURNING id
        `)).rows[0].id;
        const klasLama = await klasifikasi('PT.01.01', 'test:0046:0001');
        const klasBaru = await klasifikasi('PT.01.02', 'test:0046:0002');
        const rangkaian = async (kode: string) => (await database.query<{ id: string }>(`
            INSERT INTO rangkaian_surat (kode, asal, unit_pencatat_id, judul, tahun)
            VALUES ('${kode}', 'surat_masuk', 'unit-46-tu', 'Uji ${kode}', 2026) RETURNING id
        `)).rows[0].id;
        const berkasA = await rangkaian('RS-2026-900001');
        const b = await rangkaian('RS-2026-900002');
        const c = await rangkaian('RS-2026-900003');

        const induk = (await database.query<{ id: string }>(`
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran)
            VALUES ('${berkasA}', '${sm}', 'unit-46-tu', 'induk') RETURNING id
        `)).rows[0].id;
        // Surat keluar terarsip dapat menjadi anggota: tidak ada UPDATE atas
        // baris surat_keluar sehingga guard 0021 tidak terpicu.
        const tindakLanjut = (await database.query<{ id: string }>(`
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_keluar_id, unit_kerja_id)
            VALUES ('${berkasA}', '${sk}', 'unit-46-dir') RETURNING id
        `)).rows[0].id;
        await database.exec(`
            INSERT INTO rangkaian_relasi (rangkaian_id, dari_anggota_id, ke_anggota_id, jenis_relasi)
            VALUES ('${berkasA}', '${tindakLanjut}', '${induk}', 'tindak_lanjut');
            INSERT INTO surat_distributions (
                surat_masuk_id, source_unit_id, target_unit_id, status, rangkaian_id
            ) VALUES ('${sm}', 'unit-46-tu', 'unit-46-dir', 'processed', '${berkasA}');
            UPDATE rangkaian_surat
            SET status = 'diberkaskan', unit_pengolah_id = 'unit-46-dir',
                klasifikasi_item_id = ${klasLama}, diberkaskan_at = now(), diberkaskan_by = '${maker}'
            WHERE id = '${berkasA}';
        `);

        await expect(database.exec(`
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id)
            VALUES ('${berkasA}', '${smLain}', 'unit-46-tu')
        `)).rejects.toThrow(/sudah diberkaskan/);
        await expect(database.exec(`
            UPDATE rangkaian_relasi SET keterangan = 'ubah setelah ditutup' WHERE rangkaian_id = '${berkasA}'
        `)).rejects.toThrow(/sudah diberkaskan/);
        // Jalur distribusi lama tanpa rangkaian_id tetap tertahan lewat keanggotaan surat.
        await expect(database.exec(`
            INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status)
            VALUES ('${sm}', 'unit-46-tu', 'unit-46-dir2', 'sent')
        `)).rejects.toThrow(/sudah diberkaskan/);
        await expect(database.exec(`
            UPDATE surat_distributions SET status = 'received' WHERE rangkaian_id = '${berkasA}'
        `)).rejects.toThrow(/sudah diberkaskan/);
        await expect(database.exec(`
            DELETE FROM surat_distributions WHERE rangkaian_id = '${berkasA}'
        `)).rejects.toThrow(/sudah diberkaskan/);
        await expect(database.exec(`
            UPDATE rangkaian_surat SET status = 'selesai' WHERE id = '${berkasA}'
        `)).rejects.toThrow(/tidak dapat dibuka kembali/);
        await expect(database.exec(`
            UPDATE rangkaian_surat SET unit_pengolah_id = 'unit-46-tu' WHERE id = '${berkasA}'
        `)).rejects.toThrow(/Koreksi Berkas/);
        await expect(database.exec(`
            UPDATE rangkaian_anggota SET unit_kerja_id = 'unit-46-dir2' WHERE id = '${induk}'
        `)).rejects.toThrow(/Identitas anggota rangkaian/);

        const koreksi = (await database.query<{ id: string }>(`
            INSERT INTO rangkaian_koreksi_berkas (
                rangkaian_id, unit_pengolah_lama, unit_pengolah_baru,
                klasifikasi_lama, klasifikasi_baru, alasan, diajukan_by
            ) VALUES (
                '${berkasA}', 'unit-46-dir', 'unit-46-tu', ${klasLama}, ${klasBaru},
                'Salah memilih unit pengolah saat pemberkasan', '${maker}'
            ) RETURNING id
        `)).rows[0].id;
        const denganKoreksi = async (setClause: string) => {
            try {
                await database.exec(`
                    BEGIN;
                    SELECT set_config('simsa.berkas_koreksi', '${koreksi}', true);
                    UPDATE rangkaian_surat SET ${setClause} WHERE id = '${berkasA}';
                    COMMIT;
                `);
            } catch (error) {
                await database.exec('ROLLBACK');
                throw error;
            }
        };
        // Masih pending: GUC saja tidak cukup.
        await expect(denganKoreksi(`unit_pengolah_id = 'unit-46-tu', klasifikasi_item_id = ${klasBaru}`))
            .rejects.toThrow(/tidak sesuai Koreksi Berkas/);
        await expect(database.exec(`
            UPDATE rangkaian_koreksi_berkas
            SET status = 'approved', diputuskan_by = '${maker}', diputuskan_at = now()
            WHERE id = '${koreksi}'
        `)).rejects.toThrow(/rangkaian_koreksi_maker_checker_check/);
        await database.exec(`
            UPDATE rangkaian_koreksi_berkas
            SET status = 'approved', diputuskan_by = '${checker}', diputuskan_at = now()
            WHERE id = '${koreksi}'
        `);
        // Nilai harus sama persis dengan baris koreksi.
        await expect(denganKoreksi(`unit_pengolah_id = 'unit-46-tu'`))
            .rejects.toThrow(/tidak sesuai Koreksi Berkas/);
        await denganKoreksi(`unit_pengolah_id = 'unit-46-tu', klasifikasi_item_id = ${klasBaru}`);
        const dikoreksi = await database.query(`
            SELECT status, unit_pengolah_id, klasifikasi_item_id FROM rangkaian_surat WHERE id = '${berkasA}'
        `);
        expect(dikoreksi.rows).toEqual([{
            status: 'diberkaskan', unit_pengolah_id: 'unit-46-tu', klasifikasi_item_id: klasBaru,
        }]);

        await expect(database.exec(`
            UPDATE rangkaian_surat SET status = 'digabung', digabung_ke_id = '${berkasA}' WHERE id = '${b}'
        `)).rejects.toThrow(/tidak dapat menjadi tujuan/);
        await database.exec(`
            UPDATE rangkaian_surat SET status = 'digabung', digabung_ke_id = '${c}' WHERE id = '${b}'
        `);
        // Siklus B→C→B mustahil: B sudah digabung.
        await expect(database.exec(`
            UPDATE rangkaian_surat SET status = 'digabung', digabung_ke_id = '${b}' WHERE id = '${c}'
        `)).rejects.toThrow(/tidak dapat menjadi tujuan/);
        await expect(database.exec(`
            UPDATE rangkaian_surat SET status = 'aktif', digabung_ke_id = NULL WHERE id = '${b}'
        `)).rejects.toThrow(/sudah digabung/);
    }, PGLITE_MIGRATION_TIMEOUT_MS);
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/migration-chain.integration.test.ts -t "mengunci rangkaian"`
Expected: FAIL — `INSERT INTO rangkaian_anggota ... smLain` berhasil sehingga `rejects.toThrow(/sudah diberkaskan/)` gagal ("promise resolved instead of rejecting").

- [ ] **Step 3: Tambahkan trigger di akhir 0046**

Tambahkan di akhir `0046_rangkaian_surat.sql` (setelah statement `REVOKE DELETE ...;`):

```sql
--> statement-breakpoint
-- Penutupan berkas (pola 0021): anggota, relasi, dan disposisi rangkaian
-- yang diberkaskan tidak dapat berubah. Disposisi tanpa rangkaian_id (jalur
-- lama) ditahan lewat keanggotaan surat masuknya.
CREATE OR REPLACE FUNCTION rangkaian_guard_closed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    candidate_ids uuid[] := ARRAY[]::uuid[];
    closed_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'rangkaian_anggota' AND TG_OP = 'UPDATE' THEN
        IF NEW.surat_masuk_id IS DISTINCT FROM OLD.surat_masuk_id
           OR NEW.surat_keluar_id IS DISTINCT FROM OLD.surat_keluar_id
           OR NEW.unit_kerja_id IS DISTINCT FROM OLD.unit_kerja_id THEN
            RAISE EXCEPTION 'Identitas anggota rangkaian % tidak dapat diubah', OLD.id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        candidate_ids := candidate_ids || NEW.rangkaian_id;
        IF TG_TABLE_NAME = 'surat_distributions' THEN
            candidate_ids := candidate_ids || ARRAY(
                SELECT a.rangkaian_id FROM rangkaian_anggota a
                WHERE a.surat_masuk_id = NEW.surat_masuk_id
            );
        END IF;
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        candidate_ids := candidate_ids || OLD.rangkaian_id;
        IF TG_TABLE_NAME = 'surat_distributions' THEN
            candidate_ids := candidate_ids || ARRAY(
                SELECT a.rangkaian_id FROM rangkaian_anggota a
                WHERE a.surat_masuk_id = OLD.surat_masuk_id
            );
        END IF;
    END IF;

    -- Kunci dulu: pemberkasan yang sedang berjalan harus selesai sebelum
    -- status dibaca (READ COMMITTED mengambil snapshot baru per statement).
    PERFORM 1 FROM rangkaian_surat r
    WHERE r.id = ANY (candidate_ids)
    ORDER BY r.id
    FOR SHARE;

    SELECT r.id INTO closed_id
    FROM rangkaian_surat r
    WHERE r.id = ANY (candidate_ids)
      AND r.status = 'diberkaskan'
    LIMIT 1;

    IF closed_id IS NOT NULL THEN
        RAISE EXCEPTION 'Rangkaian % sudah diberkaskan; anggota, relasi, dan disposisinya terkunci', closed_id
            USING ERRCODE = '23514';
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION rangkaian_guard_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    koreksi_setting text;
    koreksi rangkaian_koreksi_berkas%ROWTYPE;
    tujuan_status text;
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.status = 'digabung' AND (
        NEW.status IS DISTINCT FROM OLD.status
        OR NEW.digabung_ke_id IS DISTINCT FROM OLD.digabung_ke_id
    ) THEN
        RAISE EXCEPTION 'Rangkaian % sudah digabung; status dan tujuannya tidak dapat diubah', OLD.id
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.status = 'diberkaskan' THEN
        IF NEW.status IS DISTINCT FROM 'diberkaskan' THEN
            RAISE EXCEPTION 'Rangkaian % sudah diberkaskan; status tidak dapat dibuka kembali', OLD.id
                USING ERRCODE = '23514';
        END IF;
        IF NEW.diberkaskan_at IS DISTINCT FROM OLD.diberkaskan_at
           OR NEW.diberkaskan_by IS DISTINCT FROM OLD.diberkaskan_by THEN
            RAISE EXCEPTION 'Bukti pemberkasan rangkaian % tidak dapat diubah', OLD.id
                USING ERRCODE = '23514';
        END IF;
        IF NEW.unit_pengolah_id IS DISTINCT FROM OLD.unit_pengolah_id
           OR NEW.klasifikasi_item_id IS DISTINCT FROM OLD.klasifikasi_item_id THEN
            koreksi_setting := nullif(current_setting('simsa.berkas_koreksi', true), '');
            IF koreksi_setting IS NULL
               OR koreksi_setting !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
                RAISE EXCEPTION 'Unit pengolah/klasifikasi rangkaian % yang diberkaskan hanya dapat diubah lewat Koreksi Berkas yang disetujui', OLD.id
                    USING ERRCODE = '23514';
            END IF;
            SELECT * INTO koreksi
            FROM rangkaian_koreksi_berkas k
            WHERE k.id = koreksi_setting::uuid
              AND k.rangkaian_id = OLD.id
              AND k.status = 'approved'
              AND k.diputuskan_by IS NOT NULL
              AND k.diputuskan_at IS NOT NULL
            FOR UPDATE;
            IF NOT FOUND
               OR OLD.unit_pengolah_id IS DISTINCT FROM koreksi.unit_pengolah_lama
               OR OLD.klasifikasi_item_id IS DISTINCT FROM koreksi.klasifikasi_lama
               OR NEW.unit_pengolah_id IS DISTINCT FROM koreksi.unit_pengolah_baru
               OR NEW.klasifikasi_item_id IS DISTINCT FROM koreksi.klasifikasi_baru THEN
                RAISE EXCEPTION 'Perubahan rangkaian % tidak sesuai Koreksi Berkas yang disetujui', OLD.id
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;

    IF NEW.digabung_ke_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.digabung_ke_id IS DISTINCT FROM OLD.digabung_ke_id) THEN
        SELECT r.status INTO tujuan_status
        FROM rangkaian_surat r
        WHERE r.id = NEW.digabung_ke_id
        FOR SHARE;
        IF tujuan_status IS NULL OR tujuan_status IN ('digabung', 'diberkaskan') THEN
            RAISE EXCEPTION 'Rangkaian % berstatus % dan tidak dapat menjadi tujuan penggabungan',
                NEW.digabung_ke_id, coalesce(tujuan_status, 'tidak ada')
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION rangkaian_guard_closed() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION rangkaian_guard_status() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER rangkaian_anggota_closed_guard
BEFORE INSERT OR UPDATE OR DELETE ON rangkaian_anggota
FOR EACH ROW EXECUTE FUNCTION rangkaian_guard_closed();
--> statement-breakpoint
CREATE TRIGGER rangkaian_relasi_closed_guard
BEFORE INSERT OR UPDATE OR DELETE ON rangkaian_relasi
FOR EACH ROW EXECUTE FUNCTION rangkaian_guard_closed();
--> statement-breakpoint
CREATE TRIGGER surat_distributions_closed_guard
BEFORE INSERT OR UPDATE OR DELETE ON surat_distributions
FOR EACH ROW EXECUTE FUNCTION rangkaian_guard_closed();
--> statement-breakpoint
CREATE TRIGGER rangkaian_surat_status_guard
BEFORE INSERT OR UPDATE ON rangkaian_surat
FOR EACH ROW EXECUTE FUNCTION rangkaian_guard_status();
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/migration-chain.integration.test.ts src/__tests__/migration-runner.test.ts`
Expected: PASS semua, termasuk tiga test 0046.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/migrations/0046_rangkaian_surat.sql backend/src/__tests__/migration-chain.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(db): kunci berkas rangkaian dan cegah siklus gabung di 0046

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Migrasi 0047 — unit direktorat kanonik

**Files:**
- Create: `backend/src/db/migrations/0047_unit_kerja_direktorat.sql`
- Modify: `backend/src/db/migrations/meta/_journal.json` (tambah entri idx 47 setelah entri idx 46)
- Test: `backend/src/__tests__/migration-chain.integration.test.ts` (tambah satu `it` setelah test Task 2)

**Interfaces:**
- Consumes: `unit_kerja(id, name, description, parent_id, unit_type, can_receive_distribution, is_unit_pengawas)`.
- Produces: baris `dir_bppt`, `dir_ptep`, `dir_ktpp`, `dir_plp` (`parent_id='ditjen'`, `unit_type='direktorat'`, `can_receive_distribution=true`, `is_unit_pengawas=false`) bila belum ada; `parent_id`/`unit_type` `sesditjen` dan `dir_*` hanya diisi bila NULL. `bagian_*` tidak disentuh (D6). P3 memakai id ini sebagai target disposisi.

- [ ] **Step 1: Tulis test yang gagal**

```ts
    it('0047 fail-closed pada id direktorat-* lalu melengkapi unit direktorat tanpa menimpa pengaturan admin', async () => {
        const database = await createDatabase();
        const index0047 = journal.entries.findIndex(({ tag }) => tag === '0047_unit_kerja_direktorat');
        expect(index0047).toBeGreaterThan(0);
        for (const entry of journal.entries.slice(0, index0047)) {
            await applyMigration(database, entry);
        }

        await database.exec(`
            INSERT INTO unit_kerja (id, name, parent_id, unit_type, can_receive_distribution) VALUES
                ('ditjen', 'Ditjen', NULL, NULL, true),
                ('sesditjen', 'Sekretariat Ditjen', NULL, NULL, true),
                ('dir_bppt', 'Nama BPPT dari admin', NULL, NULL, false),
                ('direktorat-bppt', 'Duplikat lama', NULL, NULL, true);
        `);
        await expect(applyMigration(database, journal.entries[index0047]))
            .rejects.toThrow(/0047: unit_kerja berpola direktorat-\*/);

        await database.exec(`DELETE FROM unit_kerja WHERE id = 'direktorat-bppt'`);
        await applyMigration(database, journal.entries[index0047]);
        // Idempoten untuk latihan pemulihan.
        await applyMigration(database, journal.entries[index0047]);

        const units = await database.query(`
            SELECT id, name, parent_id, unit_type, can_receive_distribution, is_unit_pengawas
            FROM unit_kerja ORDER BY id COLLATE "C"
        `);
        expect(units.rows).toEqual([
            { id: 'dir_bppt', name: 'Nama BPPT dari admin', parent_id: 'ditjen', unit_type: 'direktorat', can_receive_distribution: false, is_unit_pengawas: false },
            { id: 'dir_ktpp', name: 'Direktorat KTPP', parent_id: 'ditjen', unit_type: 'direktorat', can_receive_distribution: true, is_unit_pengawas: false },
            { id: 'dir_plp', name: 'Direktorat PLP', parent_id: 'ditjen', unit_type: 'direktorat', can_receive_distribution: true, is_unit_pengawas: false },
            { id: 'dir_ptep', name: 'Direktorat PTEP', parent_id: 'ditjen', unit_type: 'direktorat', can_receive_distribution: true, is_unit_pengawas: false },
            { id: 'ditjen', name: 'Ditjen', parent_id: null, unit_type: null, can_receive_distribution: true, is_unit_pengawas: true },
            { id: 'sesditjen', name: 'Sekretariat Ditjen', parent_id: 'ditjen', unit_type: 'sesditjen', can_receive_distribution: true, is_unit_pengawas: true },
        ]);
    }, PGLITE_MIGRATION_TIMEOUT_MS);
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/migration-chain.integration.test.ts -t "0047"`
Expected: FAIL — `expect(index0047).toBeGreaterThan(0)` menerima `-1`.

- [ ] **Step 3: Tulis migrasi 0047 dan entri journal**

`backend/src/db/migrations/0047_unit_kerja_direktorat.sql` (LF):

```sql
-- 0047: unit direktorat kanonik (dir_*) sebagai tujuan disposisi. Fail-closed
-- bila ada id lama berpola direktorat-* (rekonsiliasi operator). Nama resmi
-- dikoreksi lewat PUT /api/settings/unit-kerja/:id; parent_id/unit_type hanya
-- diisi bila masih NULL. deployment-unit-seed.sql dan bagian_* tidak diubah.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM unit_kerja WHERE id ~ '^direktorat-') THEN
        RAISE EXCEPTION '0047: unit_kerja berpola direktorat-* ditemukan; rekonsiliasi ke dir_* sebelum migrasi'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO unit_kerja (id, name, description, parent_id, unit_type, can_receive_distribution)
    VALUES
        ('dir_bppt', 'Direktorat BPPT', 'Direktorat Bina Pengembangan dan Pemanfaatan Tanah', 'ditjen', 'direktorat', true),
        ('dir_ptep', 'Direktorat PTEP', 'Direktorat Pengadaan Tanah untuk Kepentingan Pembangunan', 'ditjen', 'direktorat', true),
        ('dir_ktpp', 'Direktorat KTPP', 'Direktorat Konsolidasi Tanah dan Pengembangan Pertanahan', 'ditjen', 'direktorat', true),
        ('dir_plp', 'Direktorat PLP', 'Direktorat Pengendalian dan Penggunaan Tanah', 'ditjen', 'direktorat', true)
    ON CONFLICT (id) DO NOTHING;

    UPDATE unit_kerja
    SET parent_id = 'ditjen', updated_at = now()
    WHERE id IN ('sesditjen', 'dir_bppt', 'dir_ptep', 'dir_ktpp', 'dir_plp')
      AND parent_id IS NULL;

    UPDATE unit_kerja
    SET unit_type = CASE WHEN id = 'sesditjen' THEN 'sesditjen' ELSE 'direktorat' END,
        updated_at = now()
    WHERE id IN ('sesditjen', 'dir_bppt', 'dir_ptep', 'dir_ktpp', 'dir_plp')
      AND unit_type IS NULL;
END $$;
```

Tambahkan di `_journal.json` setelah entri idx 46 (tambahkan koma setelah `}` entri 46):

```json
    {
      "idx": 47,
      "version": "7",
      "when": 1789397418667,
      "tag": "0047_unit_kerja_direktorat",
      "breakpoints": true
    }
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/migration-chain.integration.test.ts src/__tests__/migration-runner.test.ts src/__tests__/deployment-regulatory-evidence.test.ts`
Expected: PASS (termasuk `deployment-regulatory-evidence` tanpa perubahan seed).

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/migrations/0047_unit_kerja_direktorat.sql backend/src/db/migrations/meta/_journal.json backend/src/__tests__/migration-chain.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(db): tambah unit direktorat kanonik 0047

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Skema Drizzle rangkaian

**Files:**
- Create: `backend/src/db/schema/rangkaian-surat.ts`
- Modify: `backend/src/db/schema/surat-distribution.ts:1-5` (import) dan `:22-23` (kolom baru setelah `receivedBy`, sebelum `createdAt`)
- Modify: `backend/src/db/schema/surat-keluar.ts:21` (setelah `balasanUntuk`)
- Modify: `backend/src/db/schema/unit-kerja.ts:11` (setelah `canReceiveDistribution`)
- Modify: `backend/src/db/schema/index.ts:20` (setelah ekspor `surat-distribution.js`)
- Modify: `backend/src/__tests__/helpers/surat-inbox-pglite.ts:24-30` (`SCHEMA_SQL`, tabel `surat_distributions`)
- Test: `backend/src/__tests__/migration-chain.integration.test.ts`
- Test (regresi P0, harus tetap lulus): `backend/src/__tests__/distribution-inbox-classification.test.ts`, `backend/src/__tests__/notification-deleted-classification.test.ts`

**Interfaces:**
- Produces (TS, diekspor dari `backend/src/db/schema/index.ts`):
  - `rangkaianSurat`, `rangkaianAnggota`, `rangkaianRelasi`, `rangkaianPeserta`, `rangkaianKoreksiBerkas`, `disposisiLabelUnit` (PgTable).
  - `RANGKAIAN_ASAL`, `RANGKAIAN_STATUS`, `JENIS_RELASI`, `SUMBER_ANGGOTA` (readonly tuple) dan tipe `RangkaianAsal = 'surat_masuk'|'inisiatif'|'data_lama'`, `RangkaianStatus = 'aktif'|'selesai'|'diberkaskan'|'digabung'`, `JenisRelasi = 'balasan'|'tindak_lanjut'|'menjelaskan'|'merujuk'`, `SumberAnggota = 'aplikasi'|'tautan'|'gabung'|'data_lama'`, `PeranAnggota = 'induk'|'anggota'`; `RangkaianSurat`, `RangkaianAnggota`, `RangkaianRelasi` (`$inferSelect`).
  - `suratDistributions.rangkaianId|batasWaktu|penanggungJawab|processedBy|penyelesaianSuratKeluarId|catatanPenyelesaian|ditutupPengawas`; `suratKeluar.asalNaskah: 'inisiatif'|'tindak_lanjut'|null`; `unitKerja.isUnitPengawas: boolean`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan setelah test Task 3:

```ts
    it('memodelkan setiap kolom integrasi rangkaian di skema Drizzle', async () => {
        const database = await createDatabase();
        for (const entry of journal.entries) {
            await applyMigration(database, entry);
        }
        const actual = await database.query<{ table_name: string; column_name: string }>(`
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND (
                  table_name IN (
                      'rangkaian_surat', 'rangkaian_anggota', 'rangkaian_relasi',
                      'rangkaian_peserta', 'rangkaian_koreksi_berkas', 'disposisi_label_unit'
                  )
                  OR (table_name, column_name) IN (
                      ('unit_kerja', 'is_unit_pengawas'),
                      ('surat_keluar', 'asal_naskah'),
                      ('surat_distributions', 'rangkaian_id'),
                      ('surat_distributions', 'batas_waktu'),
                      ('surat_distributions', 'penanggung_jawab'),
                      ('surat_distributions', 'processed_by'),
                      ('surat_distributions', 'penyelesaian_surat_keluar_id'),
                      ('surat_distributions', 'catatan_penyelesaian'),
                      ('surat_distributions', 'ditutup_pengawas')
                  )
              )
        `);
        expect(actual.rows).toHaveLength(75);
        const modeled = new Set(
            expectedSchemaColumns().map(({ tableName, columnName }) => `${tableName}.${columnName}`),
        );
        const unmodeled = actual.rows
            .map(({ table_name, column_name }) => `${table_name}.${column_name}`)
            .filter((name) => !modeled.has(name))
            .sort();
        expect(unmodeled).toEqual([]);
    }, PGLITE_MIGRATION_TIMEOUT_MS);
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/migration-chain.integration.test.ts -t "memodelkan"`
Expected: FAIL — `unmodeled` berisi 75 nama kolom (mis. `disposisi_label_unit.catatan`, `rangkaian_surat.kode`, `unit_kerja.is_unit_pengawas`).

- [ ] **Step 3: Tulis skema**

`backend/src/db/schema/rangkaian-surat.ts`:

```ts
import {
    pgTable,
    uuid,
    varchar,
    text,
    integer,
    boolean,
    timestamp,
    type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { unitKerja } from './unit-kerja';
import { users } from './users';
import { suratMasuk } from './surat-masuk';
import { suratKeluar } from './surat-keluar';
import { klasifikasiArsip } from './master-data';

// Nilai literal harus sama dengan CHECK di migrasi 0046.
export const RANGKAIAN_ASAL = ['surat_masuk', 'inisiatif', 'data_lama'] as const;
export type RangkaianAsal = (typeof RANGKAIAN_ASAL)[number];
export const RANGKAIAN_STATUS = ['aktif', 'selesai', 'diberkaskan', 'digabung'] as const;
export type RangkaianStatus = (typeof RANGKAIAN_STATUS)[number];
export const JENIS_RELASI = ['balasan', 'tindak_lanjut', 'menjelaskan', 'merujuk'] as const;
export type JenisRelasi = (typeof JENIS_RELASI)[number];
export const SUMBER_ANGGOTA = ['aplikasi', 'tautan', 'gabung', 'data_lama'] as const;
export type SumberAnggota = (typeof SUMBER_ANGGOTA)[number];
export type PeranAnggota = 'induk' | 'anggota';

/**
 * Rangkaian Surat: satu berkas naskah (surat masuk -> disposisi -> tindak
 * lanjut -> surat keluar). Index, CHECK, dan trigger hanya didefinisikan di
 * migrasi SQL 0046; jangan jalankan drizzle-kit.
 */
export const rangkaianSurat = pgTable('rangkaian_surat', {
    id: uuid('id').primaryKey().defaultRandom(),
    kode: varchar('kode', { length: 30 }).notNull(),
    asal: varchar('asal', { length: 20 }).$type<RangkaianAsal>().notNull(),
    status: varchar('status', { length: 20 }).$type<RangkaianStatus>().notNull().default('aktif'),
    unitPencatatId: varchar('unit_pencatat_id', { length: 50 }).notNull().references(() => unitKerja.id),
    unitPengolahId: varchar('unit_pengolah_id', { length: 50 }).references(() => unitKerja.id),
    judul: text('judul').notNull(),
    tahun: integer('tahun').notNull(),
    klasifikasiItemId: integer('klasifikasi_item_id').references(() => klasifikasiArsip.id, { onDelete: 'restrict' }),
    lanjutanDariId: uuid('lanjutan_dari_id').references((): AnyPgColumn => rangkaianSurat.id),
    digabungKeId: uuid('digabung_ke_id').references((): AnyPgColumn => rangkaianSurat.id),
    selesaiAt: timestamp('selesai_at', { withTimezone: true }),
    selesaiBy: uuid('selesai_by').references(() => users.id),
    catatanSelesai: text('catatan_selesai'),
    selesaiManual: boolean('selesai_manual').notNull().default(false),
    diberkaskanAt: timestamp('diberkaskan_at', { withTimezone: true }),
    diberkaskanBy: uuid('diberkaskan_by').references(() => users.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rangkaianAnggota = pgTable('rangkaian_anggota', {
    id: uuid('id').primaryKey().defaultRandom(),
    rangkaianId: uuid('rangkaian_id').notNull().references(() => rangkaianSurat.id),
    suratMasukId: uuid('surat_masuk_id').references(() => suratMasuk.id),
    suratKeluarId: uuid('surat_keluar_id').references(() => suratKeluar.id),
    unitKerjaId: varchar('unit_kerja_id', { length: 50 }).notNull().references(() => unitKerja.id),
    peran: varchar('peran', { length: 10 }).$type<PeranAnggota>().notNull().default('anggota'),
    sumber: varchar('sumber', { length: 15 }).$type<SumberAnggota>().notNull().default('aplikasi'),
    ditambahkanBy: uuid('ditambahkan_by').references(() => users.id),
    ditambahkanAt: timestamp('ditambahkan_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rangkaianRelasi = pgTable('rangkaian_relasi', {
    id: uuid('id').primaryKey().defaultRandom(),
    // FK komposit (rangkaian_id, *_anggota_id) ON UPDATE CASCADE ada di SQL 0046.
    rangkaianId: uuid('rangkaian_id').notNull(),
    dariAnggotaId: uuid('dari_anggota_id').notNull(),
    keAnggotaId: uuid('ke_anggota_id').notNull(),
    jenisRelasi: varchar('jenis_relasi', { length: 20 }).$type<JenisRelasi>().notNull(),
    keterangan: text('keterangan'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by').references(() => users.id),
    cancellationReason: text('cancellation_reason'),
});

export const rangkaianPeserta = pgTable('rangkaian_peserta', {
    id: uuid('id').primaryKey().defaultRandom(),
    rangkaianId: uuid('rangkaian_id').notNull().references(() => rangkaianSurat.id),
    unitKerjaId: varchar('unit_kerja_id', { length: 50 }).notNull().references(() => unitKerja.id),
    peran: varchar('peran', { length: 20 }).$type<'disposisi_lama'>().notNull(),
    labelAsal: text('label_asal'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    berakhirAt: timestamp('berakhir_at', { withTimezone: true }),
    berakhirBy: uuid('berakhir_by').references(() => users.id),
    alasanBerakhir: text('alasan_berakhir'),
});

export const rangkaianKoreksiBerkas = pgTable('rangkaian_koreksi_berkas', {
    id: uuid('id').primaryKey().defaultRandom(),
    rangkaianId: uuid('rangkaian_id').notNull().references(() => rangkaianSurat.id),
    unitPengolahLama: varchar('unit_pengolah_lama', { length: 50 }).notNull(),
    unitPengolahBaru: varchar('unit_pengolah_baru', { length: 50 }).notNull().references(() => unitKerja.id),
    klasifikasiLama: integer('klasifikasi_lama').notNull(),
    klasifikasiBaru: integer('klasifikasi_baru').notNull().references(() => klasifikasiArsip.id),
    alasan: text('alasan').notNull(),
    status: varchar('status', { length: 15 })
        .$type<'pending' | 'approved' | 'denied' | 'applied'>()
        .notNull()
        .default('pending'),
    diajukanBy: uuid('diajukan_by').notNull().references(() => users.id),
    diajukanAt: timestamp('diajukan_at', { withTimezone: true }).notNull().defaultNow(),
    diputuskanBy: uuid('diputuskan_by').references(() => users.id),
    diputuskanAt: timestamp('diputuskan_at', { withTimezone: true }),
});

export const disposisiLabelUnit = pgTable('disposisi_label_unit', {
    labelNorm: varchar('label_norm', { length: 100 }).primaryKey(),
    unitKerjaId: varchar('unit_kerja_id', { length: 50 }).references(() => unitKerja.id),
    perluVerifikasi: boolean('perlu_verifikasi').notNull().default(false),
    catatan: text('catatan'),
});

export type RangkaianSurat = typeof rangkaianSurat.$inferSelect;
export type RangkaianAnggota = typeof rangkaianAnggota.$inferSelect;
export type RangkaianRelasi = typeof rangkaianRelasi.$inferSelect;
```

`backend/src/db/schema/surat-distribution.ts` — ganti baris 1:

```ts
import { pgTable, uuid, varchar, text, timestamp, date, boolean } from 'drizzle-orm/pg-core';
```

tambahkan setelah baris 4 (`import { users } from './users';`):

```ts
import { suratKeluar } from './surat-keluar';
import { rangkaianSurat } from './rangkaian-surat';
```

dan sisipkan setelah baris `receivedBy: uuid('received_by').references(() => users.id),`:

```ts
    // Integrasi rangkaian (0046). rangkaian_id menjadi wajib setelah backfill P3/P5.
    rangkaianId: uuid('rangkaian_id').references(() => rangkaianSurat.id),
    batasWaktu: date('batas_waktu'),
    penanggungJawab: boolean('penanggung_jawab').notNull().default(false),
    processedBy: uuid('processed_by').references(() => users.id),
    penyelesaianSuratKeluarId: uuid('penyelesaian_surat_keluar_id').references(() => suratKeluar.id),
    catatanPenyelesaian: text('catatan_penyelesaian'),
    ditutupPengawas: boolean('ditutup_pengawas').notNull().default(false),
```

`backend/src/db/schema/surat-keluar.ts` — sisipkan setelah baris 21 (`balasanUntuk: ...`):

```ts
    // 0046: null = data lama; tidak dijaga trigger 0021.
    asalNaskah: varchar('asal_naskah', { length: 15 }).$type<'inisiatif' | 'tindak_lanjut'>(),
```

`backend/src/db/schema/unit-kerja.ts` — sisipkan setelah baris 11 (`canReceiveDistribution: ...`):

```ts
    // D5 (0046): unit pengawas rangkaian (ditjen, sesditjen). Diubah hanya oleh super_admin.
    isUnitPengawas: boolean('is_unit_pengawas').notNull().default(false),
```

`backend/src/db/schema/index.ts` — sisipkan setelah baris 20 (`export * from './surat-distribution.js';`):

```ts
export * from './rangkaian-surat.js';
```

- [ ] **Step 4: Jalankan test dan typecheck, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/migration-chain.integration.test.ts src/__tests__/distribution.service.test.ts && npx tsc --noEmit`
Expected: PASS; `tsc` tanpa error.

- [ ] **Step 4b: Samakan helper PGlite P0 dengan kolom baru, pastikan test klasifikasi P0 tetap lulus**

`distributionService.findInbox` men-select seluruh tabel Drizzle `suratDistributions` (`select().from(suratDistributions)`), sedangkan `backend/src/__tests__/helpers/surat-inbox-pglite.ts` (dipakai oleh `distribution-inbox-classification.test.ts` dan `notification-deleted-classification.test.ts`, keduanya P0) membuat `surat_distributions` lewat SQL tangan yang belum punya tujuh kolom di atas. Setelah Task 4 menambah kolom itu ke skema Drizzle, kedua test P0 akan gagal dengan `column "rangkaian_id" does not exist` (atau kolom baru lain) begitu Drizzle mem-generate `SELECT` dengan kolom itu — perbaiki helper-nya, jangan skema Drizzle-nya.

Di `backend/src/__tests__/helpers/surat-inbox-pglite.ts`, pada `CREATE TABLE surat_distributions (...)` (SCHEMA_SQL, sekitar baris 24-30), tambahkan tujuh kolom ini sebelum tanda kurung penutup `)` yang mengakhiri statement (setelah baris `created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());`), persis padanan tipe kolom 0046 di atas (tanpa FK — helper ini tidak membuat tabel `rangkaian_surat`/`surat_keluar`/`users`, dan test P0 tidak butuh integritas referensial):

```sql
    rangkaian_id uuid,
    batas_waktu date,
    penanggung_jawab boolean NOT NULL DEFAULT false,
    processed_by uuid,
    penyelesaian_surat_keluar_id uuid,
    catatan_penyelesaian text,
    ditutup_pengawas boolean NOT NULL DEFAULT false);
```

dan hapus `);` yang sebelumnya menutup statement `CREATE TABLE surat_distributions` (ganti `updated_at timestamp NOT NULL DEFAULT now());` menjadi `updated_at timestamp NOT NULL DEFAULT now(),` agar tujuh kolom baru menyambung sebagai kolom tambahan, bukan statement baru).

Run: `cd backend && npx vitest run src/__tests__/distribution-inbox-classification.test.ts src/__tests__/notification-deleted-classification.test.ts`
Expected: PASS (kedua file, tanpa error "column does not exist").

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/schema/rangkaian-surat.ts backend/src/db/schema/surat-distribution.ts backend/src/db/schema/surat-keluar.ts backend/src/db/schema/unit-kerja.ts backend/src/db/schema/index.ts backend/src/__tests__/migration-chain.integration.test.ts backend/src/__tests__/helpers/surat-inbox-pglite.ts
git commit -m "$(cat <<'EOF'
feat(db): modelkan tabel rangkaian surat di skema Drizzle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Grant append-only di konvergensi 0002 dan pin Neon

**Files:**
- Modify: `backend/src/db/grants/0002_converge_application_grants.sql:532` (sisipkan setelah `REVOKE UPDATE, DELETE ON TABLE public.preservasi_track FROM simsa_api_runtime;`)
- Modify: `scripts/neon-database-policy.mjs:124` (hash)
- Test: `backend/src/__tests__/database-role-policy.test.ts` (tambah `it` sebelum `});` penutup di baris 183)
- Test: `backend/integration/database-role-grants.postgres.test.ts:269` (tambah assertion setelah `expect(schema.can_create).toBe(false);`)

**Interfaces:**
- Consumes: tabel `rangkaian_*` (Task 1).
- Produces: `simsa_api_runtime` tanpa `DELETE` atas `rangkaian_surat`, `rangkaian_anggota`, `rangkaian_relasi`, `rangkaian_peserta`, `rangkaian_koreksi_berkas` setelah setiap konvergensi; tetap berlaku pada restore skema lama (tabel tidak ada → dilewati).

- [ ] **Step 1: Tulis test yang gagal**

Di `database-role-policy.test.ts`, tambahkan sebelum `});` terakhir:

```ts
    it('keeps rangkaian berkas tables append-only for the API across convergence', () => {
        for (const table of [
            'rangkaian_surat',
            'rangkaian_anggota',
            'rangkaian_relasi',
            'rangkaian_peserta',
            'rangkaian_koreksi_berkas',
        ]) {
            expect(convergenceSql).toContain(`'${table}'`);
        }
        expect(convergenceSql).toContain(
            "EXECUTE pg_catalog.format('REVOKE DELETE ON TABLE public.%I FROM simsa_api_runtime', relation_name)",
        );
        // Restore/upgrade drill memakai skema lama (0038): tabel yang belum ada dilewati.
        expect(convergenceSql).toContain("pg_catalog.to_regclass(pg_catalog.format('public.%I', relation_name))");
        const grantIndex = convergenceSql.indexOf('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public');
        const revokeIndex = convergenceSql.indexOf('$rangkaian_append_only$');
        expect(grantIndex).toBeGreaterThan(0);
        expect(revokeIndex).toBeGreaterThan(grantIndex);
    });
```

Di `database-role-grants.postgres.test.ts`, setelah baris 269 (`expect(schema.can_create).toBe(false);`) di dalam `it('gives the API data access but not DDL or mutable audit evidence'`:

```ts
        for (const table of [
            'rangkaian_surat',
            'rangkaian_anggota',
            'rangkaian_relasi',
            'rangkaian_peserta',
            'rangkaian_koreksi_berkas',
        ]) {
            await expect(tablePrivilege(principals.api, table, 'INSERT')).resolves.toBe(true);
            await expect(tablePrivilege(principals.api, table, 'UPDATE')).resolves.toBe(true);
            await expect(tablePrivilege(principals.api, table, 'DELETE')).resolves.toBe(false);
        }
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/database-role-policy.test.ts`
Expected: FAIL — `expected ... to contain "'rangkaian_surat'"`.

- [ ] **Step 3: Tambahkan REVOKE kondisional di 0002**

Sisipkan setelah baris 532 `REVOKE UPDATE, DELETE ON TABLE public.preservasi_track FROM simsa_api_runtime;`:

```sql
-- Berkas rangkaian (0046) append-only bagi API. Kondisional agar konvergensi
-- tetap berjalan pada restore/upgrade skema sebelum 0046.
DO $rangkaian_append_only$
DECLARE
    relation_name text;
BEGIN
    FOREACH relation_name IN ARRAY ARRAY[
        'rangkaian_surat',
        'rangkaian_anggota',
        'rangkaian_relasi',
        'rangkaian_peserta',
        'rangkaian_koreksi_berkas'
    ] LOOP
        IF pg_catalog.to_regclass(pg_catalog.format('public.%I', relation_name)) IS NOT NULL THEN
            EXECUTE pg_catalog.format('REVOKE DELETE ON TABLE public.%I FROM simsa_api_runtime', relation_name);
        END IF;
    END LOOP;
END
$rangkaian_append_only$;
```

- [ ] **Step 4: Jalankan test statis, pastikan lulus; pastikan pin Neon kini gagal**

Run: `cd backend && npx vitest run src/__tests__/database-role-policy.test.ts`
Expected: PASS.

Run (dari root repo): `node --input-type=module -e "import('./scripts/neon-database-policy.mjs').then(m => m.loadNeonGrantPolicy()).then(() => console.log('grant policy pin OK'))"`
Expected: FAIL dengan `Versioned grant policy changed; review and update the Neon adapter before deployment`.

- [ ] **Step 5: Perbarui hash pin Neon**

Run (dari root repo, Git Bash):

```bash
NEW_HASH=$(node -e "const c=require('node:crypto'),f=require('node:fs');process.stdout.write(c.createHash('sha256').update(f.readFileSync('backend/src/db/grants/0002_converge_application_grants.sql','utf8').replaceAll('\r\n','\n')).digest('hex'))")
sed -i "s/b31cc300339509f5b1228d97bb23ea7151045d351484abf8f91c7abb741c73ad/$NEW_HASH/" scripts/neon-database-policy.mjs
grep -n "$NEW_HASH" scripts/neon-database-policy.mjs
```

Expected: `grep` menampilkan baris 124 dengan hash baru.

- [ ] **Step 6: Verifikasi**

Run (root): `node --input-type=module -e "import('./scripts/neon-database-policy.mjs').then(m => m.loadNeonGrantPolicy()).then(() => console.log('grant policy pin OK'))"`
Expected: `grant policy pin OK`.

Run (root): `npm run test:cloud-metadata && npm run test:neon-backup`
Expected: PASS (test yang memerlukan Postgres nyata di-skip atau lulus sesuai konfigurasi lingkungan).

Run (bila `TEST_POSTGRES_URL` tersedia): `cd backend && npm run test:postgres-locks`
Expected: PASS termasuk assertion `rangkaian_*` DELETE = false. Tanpa Postgres lokal, langkah ini wajib lulus di job CI "postgres" (`.github/workflows/ci.yml:809`) sebelum merge, bersama profil konvergensi 0038 (`.github/scripts/test-backup-upgrade-profile.mjs`).

- [ ] **Step 7: Commit**

```bash
git add backend/src/db/grants/0002_converge_application_grants.sql scripts/neon-database-policy.mjs backend/src/__tests__/database-role-policy.test.ts backend/integration/database-role-grants.postgres.test.ts
git commit -m "$(cat <<'EOF'
feat(db): jadikan tabel rangkaian append-only pada konvergensi grant

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Gerbang readiness skema 0046

**Files:**
- Modify: `backend/src/services/readiness.service.ts:115` (setelah `('final_object_orphans', 'attempts')`), `:169` (setelah `('final_object_orphans', 'final_object_orphans_attempts_check')`), `:197` (setelah `('arsip_terjaga_reports', 'arsip_terjaga_reports_immutable')`)
- Test: `backend/src/__tests__/readiness.service.test.ts` (tambah `describe` di akhir file, setelah baris 439)

**Interfaces:**
- Produces: `DATABASE_SCHEMA_READINESS_SQL` mensyaratkan kolom/constraint/trigger 0046 sehingga kode P1+ tidak melayani trafik pada DB yang belum dimigrasi (`/ready` → 503).

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `readiness.service.test.ts`:

```ts
describe('schema readiness for rangkaian surat (0046)', () => {
    it('requires the rangkaian columns, constraints, and closure triggers', async () => {
        const { DATABASE_SCHEMA_READINESS_SQL } = await import('../services/readiness.service.js');
        for (const fragment of [
            "('unit_kerja', 'is_unit_pengawas')",
            "('surat_keluar', 'asal_naskah')",
            "('surat_distributions', 'rangkaian_id')",
            "('surat_distributions', 'ditutup_pengawas')",
            "('rangkaian_surat', 'kode')",
            "('rangkaian_relasi', 'cancelled_at')",
            "('surat_distributions', 'surat_distributions_status_check')",
            "('rangkaian_surat', 'rangkaian_berkas_check')",
            "('rangkaian_relasi', 'rangkaian_relasi_pembatalan_check')",
            "('surat_distributions', 'surat_distributions_closed_guard')",
            "('rangkaian_surat', 'rangkaian_surat_status_guard')",
        ]) {
            expect(DATABASE_SCHEMA_READINESS_SQL).toContain(fragment);
        }
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/readiness.service.test.ts -t "rangkaian"`
Expected: FAIL — tidak memuat `('unit_kerja', 'is_unit_pengawas')`.

- [ ] **Step 3: Tambahkan entri readiness**

Ganti baris 115 `            ('final_object_orphans', 'attempts')` menjadi:

```sql
            ('final_object_orphans', 'attempts'),
            ('unit_kerja', 'is_unit_pengawas'),
            ('surat_keluar', 'asal_naskah'),
            ('surat_distributions', 'rangkaian_id'),
            ('surat_distributions', 'batas_waktu'),
            ('surat_distributions', 'penanggung_jawab'),
            ('surat_distributions', 'processed_by'),
            ('surat_distributions', 'penyelesaian_surat_keluar_id'),
            ('surat_distributions', 'catatan_penyelesaian'),
            ('surat_distributions', 'ditutup_pengawas'),
            ('rangkaian_surat', 'kode'),
            ('rangkaian_surat', 'status'),
            ('rangkaian_anggota', 'rangkaian_id'),
            ('rangkaian_relasi', 'cancelled_at'),
            ('rangkaian_peserta', 'berakhir_at'),
            ('rangkaian_koreksi_berkas', 'status')
```

Ganti baris 169 `            ('final_object_orphans', 'final_object_orphans_attempts_check')` menjadi:

```sql
            ('final_object_orphans', 'final_object_orphans_attempts_check'),
            ('surat_distributions', 'surat_distributions_status_check'),
            ('rangkaian_surat', 'rangkaian_berkas_check'),
            ('rangkaian_surat', 'rangkaian_gabung_check'),
            ('rangkaian_surat', 'rangkaian_selesai_manual_check'),
            ('rangkaian_relasi', 'rangkaian_relasi_pembatalan_check'),
            ('rangkaian_peserta', 'rangkaian_peserta_berakhir_check')
```

Ganti baris 197 `                ('arsip_terjaga_reports', 'arsip_terjaga_reports_immutable')` menjadi:

```sql
                ('arsip_terjaga_reports', 'arsip_terjaga_reports_immutable'),
                ('rangkaian_anggota', 'rangkaian_anggota_closed_guard'),
                ('rangkaian_relasi', 'rangkaian_relasi_closed_guard'),
                ('surat_distributions', 'surat_distributions_closed_guard'),
                ('rangkaian_surat', 'rangkaian_surat_status_guard')
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/readiness.service.test.ts src/__tests__/database-role-policy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/readiness.service.ts backend/src/__tests__/readiness.service.test.ts
git commit -m "$(cat <<'EOF'
feat(readiness): syaratkan skema rangkaian 0046 sebelum melayani trafik

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Normalisasi nomor surat dengan paritas TS/SQL

**Files:**
- Create: `backend/src/utils/nomor-surat.ts`
- Test: `backend/src/__tests__/nomor-surat.test.ts`

**Interfaces:**
- Produces (dipakai P3 `/lacak`, P4):
  - `normalizeNomor(value: string | null | undefined): string` — buang `[^0-9A-Za-z]` lalu lowercase (urutan sama dengan SQL).
  - `nomorNormSql(column: AnyColumn | SQL): SQL<string>` — `lower(regexp_replace(coalesce(<col>, ''), '[^0-9A-Za-z]+', '', 'g'))`, identik dengan `surat_masuk_nomor_norm_idx`/`surat_keluar_nomor_norm_idx`.
  - `escapeLike` **tidak** dibuat di P1 (P3).

- [ ] **Step 1: Tulis test yang gagal**

`backend/src/__tests__/nomor-surat.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeNomor, nomorNormSql } from '../utils/nomor-surat';

const dialect = new PgDialect();
const samples: Array<string | null> = [
    'B-12/PTPP.1/IX/2024',
    'b 12 ptpp 1 ix 2024',
    ' 1/23 ',
    '12/3',
    'ND.01/SET/2026',
    'Kelvin-K-01', // K (Kelvin) → 'k' bila di-lowercase lebih dulu
    'İstanbul-7', // İ → 'i̇' bila di-lowercase lebih dulu
    'ÄÖÜ/9',
    'ǅ-2',
    '',
    '   ',
    null,
];
let database: PGlite;

beforeAll(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec('CREATE TABLE surat_masuk (id serial PRIMARY KEY, nomor_surat varchar(255))');
    const migration = readFileSync(
        fileURLToPath(new URL('../db/migrations/0046_rangkaian_surat.sql', import.meta.url)),
        'utf8',
    );
    const indexStatement = migration.match(/CREATE INDEX surat_masuk_nomor_norm_idx[^;]+;/)?.[0];
    expect(indexStatement).toBeDefined();
    await database.exec(indexStatement!);
}, 30_000);

afterAll(async () => { await database?.close(); });

describe('normalisasi nomor surat', () => {
    it('TS identik dengan SQL yang dihasilkan nomorNormSql untuk semua sampel', async () => {
        const query = dialect.sqlToQuery(sql`SELECT ${nomorNormSql(sql.raw('$1::varchar'))} AS n`);
        for (const sample of samples) {
            const { rows } = await database.query<{ n: string }>(query.sql, [sample]);
            expect(rows[0].n, JSON.stringify(sample)).toBe(normalizeNomor(sample));
        }
    });

    it('menyamakan varian ejaan nomor dan tidak membedakan 1/23 dengan 12/3', () => {
        expect(normalizeNomor('B-12/PTPP.1/IX/2024')).toBe('b12ptpp1ix2024');
        expect(normalizeNomor('b 12 ptpp 1 ix 2024')).toBe('b12ptpp1ix2024');
        expect(normalizeNomor('1/23')).toBe(normalizeNomor('12/3'));
        expect(normalizeNomor(null)).toBe('');
    });

    it('kueri prefix dari nomorNormSql memakai index ekspresi 0046', async () => {
        await database.exec(`
            INSERT INTO surat_masuk (nomor_surat)
            SELECT 'B-' || g || '/PTPP.1/IX/2024' FROM generate_series(1, 2000) g;
            ANALYZE surat_masuk;
            SET enable_seqscan = off;
        `);
        const query = dialect.sqlToQuery(
            sql`EXPLAIN SELECT id FROM surat_masuk WHERE ${nomorNormSql(sql.raw('nomor_surat'))} LIKE 'b12ptpp%'`,
        );
        const { rows } = await database.query<Record<string, string>>(query.sql);
        expect(rows.map((row) => Object.values(row).join(' ')).join('\n')).toMatch(/surat_masuk_nomor_norm_idx/);
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/nomor-surat.test.ts`
Expected: FAIL — `Failed to resolve import "../utils/nomor-surat"`.

- [ ] **Step 3: Implementasi**

`backend/src/utils/nomor-surat.ts`:

```ts
import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * Normalisasi nomor surat untuk pencocokan. Urutan WAJIB sama dengan SQL:
 * buang semua selain [0-9A-Za-z] lebih dulu, baru lowercase. Lowercase lebih
 * dulu mengubah K (Kelvin, U+212A) dan İ (U+0130) menjadi huruf ASCII sehingga
 * hasil TS dan index ekspresi 0046 berbeda.
 */
export function normalizeNomor(value: string | null | undefined): string {
    return (value ?? '').replace(/[^0-9A-Za-z]+/g, '').toLowerCase();
}

/**
 * Ekspresi SQL yang identik dengan index surat_masuk_nomor_norm_idx dan
 * surat_keluar_nomor_norm_idx (migrasi 0046). Jangan ubah tanpa migrasi baru.
 */
export function nomorNormSql(column: AnyColumn | SQL): SQL<string> {
    return sql<string>`lower(regexp_replace(coalesce(${column}, ''), '[^0-9A-Za-z]+', '', 'g'))`;
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/nomor-surat.test.ts && npx tsc --noEmit`
Expected: PASS; tanpa error tipe.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/nomor-surat.ts backend/src/__tests__/nomor-surat.test.ts
git commit -m "$(cat <<'EOF'
feat(surat): normalisasi nomor surat berparitas dengan index 0046

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Fungsi murni status rangkaian dan status surat masuk

**Files:**
- Create: `backend/src/services/rangkaian-status.ts`
- Test: `backend/src/__tests__/rangkaian-status.test.ts`

**Interfaces:**
- Consumes: tipe `RangkaianAsal`, `RangkaianStatus` dari `backend/src/db/schema/rangkaian-surat.ts` (type-only).
- Produces:
  - `const BLOCKING_APPROVAL_STATUSES = ['draft','pending','rejected'] as const`; `const OPEN_DISPOSISI_STATUSES = ['sent','received'] as const`.
  - `type RangkaianStatusFacts = { current: RangkaianStatus; asal: RangkaianAsal; selesaiManual: boolean; openDisposisi: number; processedDisposisi: number; blockingAnggota: number; approvedTindakLanjut: number }`
  - `deriveRangkaianStatus(facts: RangkaianStatusFacts): RangkaianStatus`
  - `type SuratMasukStatusFacts = { current: string | null; approvedReply: boolean; penyelesaian: boolean; selesaiManualNonLegacy: boolean; hasRangkaianEvidence: boolean }`
  - `deriveSuratMasukStatus(facts: SuratMasukStatusFacts): string` (`'sudah_dibalas' | 'belum_dibalas'` atau nilai lama bila monoton)
  - `isRangkaianTerbuka(status: RangkaianStatus): boolean` (`aktif|selesai`)
  - `judulRangkaian(surat: { perihal: string | null; nomorSurat: string | null }): string`

- [ ] **Step 1: Tulis test yang gagal**

`backend/src/__tests__/rangkaian-status.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
    deriveRangkaianStatus,
    deriveSuratMasukStatus,
    isRangkaianTerbuka,
    judulRangkaian,
    type RangkaianStatusFacts,
    type SuratMasukStatusFacts,
} from '../services/rangkaian-status';

const base: RangkaianStatusFacts = {
    current: 'aktif',
    asal: 'surat_masuk',
    selesaiManual: false,
    openDisposisi: 0,
    processedDisposisi: 0,
    blockingAnggota: 0,
    approvedTindakLanjut: 0,
};

describe('deriveRangkaianStatus', () => {
    it.each<[string, Partial<RangkaianStatusFacts>, string]>([
        ['diberkaskan terminal', { current: 'diberkaskan', openDisposisi: 3 }, 'diberkaskan'],
        ['digabung terminal', { current: 'digabung', processedDisposisi: 1 }, 'digabung'],
        ['disposisi terbuka membuka kembali selesai manual', { current: 'selesai', selesaiManual: true, openDisposisi: 1 }, 'aktif'],
        ['anggota draft/pending/rejected memblokir', { processedDisposisi: 1, blockingAnggota: 1 }, 'aktif'],
        ['selesai manual tanpa pemblokir', { current: 'selesai', selesaiManual: true }, 'selesai'],
        ['semua disposisi diproses', { processedDisposisi: 2 }, 'selesai'],
        ['tindak lanjut disetujui', { approvedTindakLanjut: 1 }, 'selesai'],
        ['inisiatif tanpa pemblokir', { asal: 'inisiatif' }, 'selesai'],
        ['surat masuk tanpa bukti tetap aktif', {}, 'aktif'],
        ['bukti dibatalkan menurunkan selesai otomatis', { current: 'selesai' }, 'aktif'],
        ['data lama selesai tanpa bukti tetap selesai', { asal: 'data_lama', current: 'selesai' }, 'selesai'],
    ])('%s', (_label, override, expected) => {
        expect(deriveRangkaianStatus({ ...base, ...override })).toBe(expected);
    });
});

describe('deriveSuratMasukStatus', () => {
    const none: SuratMasukStatusFacts = {
        current: 'belum_dibalas',
        approvedReply: false,
        penyelesaian: false,
        selesaiManualNonLegacy: false,
        hasRangkaianEvidence: false,
    };
    it.each<[string, Partial<SuratMasukStatusFacts>, string]>([
        ['balasan/tindak lanjut disetujui', { approvedReply: true, hasRangkaianEvidence: true }, 'sudah_dibalas'],
        ['penyelesaian disposisi', { penyelesaian: true, hasRangkaianEvidence: true }, 'sudah_dibalas'],
        ['selesai manual non data lama', { selesaiManualNonLegacy: true }, 'sudah_dibalas'],
        ['bukti rangkaian dicabut menurunkan status', { current: 'sudah_dibalas', hasRangkaianEvidence: true }, 'belum_dibalas'],
        ['monoton: status impor tanpa bukti rangkaian tidak turun', { current: 'sudah_dibalas' }, 'sudah_dibalas'],
        ['null diperlakukan belum dibalas', { current: null }, 'belum_dibalas'],
        ['data lama selesai tidak memicu sudah dibalas', { selesaiManualNonLegacy: false }, 'belum_dibalas'],
    ])('%s', (_label, override, expected) => {
        expect(deriveSuratMasukStatus({ ...none, ...override })).toBe(expected);
    });
});

describe('isRangkaianTerbuka & judulRangkaian', () => {
    it('hanya aktif dan selesai yang terbuka', () => {
        expect(['aktif', 'selesai', 'diberkaskan', 'digabung'].map((s) => isRangkaianTerbuka(s as never)))
            .toEqual([true, true, false, false]);
    });
    it('memakai perihal, lalu nomor, lalu placeholder (perihal nullable)', () => {
        expect(judulRangkaian({ perihal: '  Undangan rapat  ', nomorSurat: 'B-1' })).toBe('Undangan rapat');
        expect(judulRangkaian({ perihal: null, nomorSurat: 'B-12/PTPP.1/IX/2024' })).toBe('B-12/PTPP.1/IX/2024');
        expect(judulRangkaian({ perihal: '   ', nomorSurat: null })).toBe('(tanpa perihal)');
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/rangkaian-status.test.ts`
Expected: FAIL — `Failed to resolve import "../services/rangkaian-status"`.

- [ ] **Step 3: Implementasi**

`backend/src/services/rangkaian-status.ts`:

```ts
import type { RangkaianAsal, RangkaianStatus } from '../db/schema/rangkaian-surat';

/** Himpunan tunggal (spesifikasi §8) untuk auto-selesai DAN syarat berkaskan. */
export const BLOCKING_APPROVAL_STATUSES = ['draft', 'pending', 'rejected'] as const;
export const OPEN_DISPOSISI_STATUSES = ['sent', 'received'] as const;

export type RangkaianStatusFacts = {
    current: RangkaianStatus;
    asal: RangkaianAsal;
    selesaiManual: boolean;
    openDisposisi: number;
    processedDisposisi: number;
    blockingAnggota: number;
    approvedTindakLanjut: number;
};

export type SuratMasukStatusFacts = {
    current: string | null;
    approvedReply: boolean;
    penyelesaian: boolean;
    selesaiManualNonLegacy: boolean;
    hasRangkaianEvidence: boolean;
};

export function isRangkaianTerbuka(status: RangkaianStatus): boolean {
    return status === 'aktif' || status === 'selesai';
}

/**
 * Status rangkaian turunan. `diberkaskan`/`digabung` terminal. Pekerjaan
 * terbuka (disposisi sent/received atau anggota keluar hidup yang belum
 * disetujui) selalu `aktif`, termasuk membuka kembali Tandai Selesai manual.
 */
export function deriveRangkaianStatus(facts: RangkaianStatusFacts): RangkaianStatus {
    if (!isRangkaianTerbuka(facts.current)) return facts.current;
    if (facts.openDisposisi > 0 || facts.blockingAnggota > 0) return 'aktif';
    if (facts.selesaiManual) return 'selesai';
    if (facts.processedDisposisi > 0 || facts.approvedTindakLanjut > 0 || facts.asal === 'inisiatif') {
        return 'selesai';
    }
    // Data lama dibuat `selesai` tanpa bukti; hanya tautan baru yang membukanya.
    if (facts.asal === 'data_lama') return facts.current;
    return 'aktif';
}

/**
 * Status kompatibilitas surat_masuk. Monoton untuk baris tanpa bukti
 * rangkaian: nilai manual/impor Excel tidak pernah diturunkan.
 */
export function deriveSuratMasukStatus(facts: SuratMasukStatusFacts): string {
    const current = facts.current ?? 'belum_dibalas';
    if (facts.approvedReply || facts.penyelesaian || facts.selesaiManualNonLegacy) return 'sudah_dibalas';
    if (!facts.hasRangkaianEvidence) return current;
    return 'belum_dibalas';
}

/** Pola COALESCE(NULLIF(trim(perihal),''), nomor_surat, '(tanpa perihal)'). */
export function judulRangkaian(surat: { perihal: string | null; nomorSurat: string | null }): string {
    const perihal = surat.perihal?.trim();
    if (perihal) return perihal;
    const nomor = surat.nomorSurat?.trim();
    return nomor ? nomor : '(tanpa perihal)';
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/rangkaian-status.test.ts`
Expected: PASS (20 kasus).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/rangkaian-status.ts backend/src/__tests__/rangkaian-status.test.ts
git commit -m "$(cat <<'EOF'
feat(rangkaian): fungsi murni status rangkaian dan surat masuk

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `rangkaianService.ensureForSurat` / `ensureForSuratMasuk` + harness PGlite

**Files:**
- Create: `backend/src/db/transaction.ts`
- Modify: `backend/src/services/audit-log.service.ts:11-12` (union `action`/`entityType`)
- Create: `backend/src/services/rangkaian.service.ts`
- Test: `backend/src/__tests__/rangkaian.service.integration.test.ts`

**Interfaces:**
- Produces:
  - `backend/src/db/transaction.ts`: `export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];`
  - `LogActionData.action` + `'merge' | 'link'`; `LogActionData.entityType` + `'rangkaian_surat' | 'rangkaian_relasi'`.
  - `backend/src/services/rangkaian.service.ts`:
    ```ts
    export type JenisSurat = 'surat_masuk' | 'surat_keluar';
    export interface SuratRef { jenis: JenisSurat; id: string }
    export type RangkaianActor = CriticalAuditContext & { userId: string };
    export interface EnsureOptions { unitPengolahId?: string | null }
    export interface EnsureRangkaianResult { rangkaianId: string; kode: string; anggotaId: string; status: RangkaianStatus; created: boolean }
    rangkaianService.ensureForSurat(tx: DbTransaction, ref: SuratRef, actor: RangkaianActor, options?: EnsureOptions): Promise<EnsureRangkaianResult>
    rangkaianService.ensureForSuratMasuk(tx: DbTransaction, suratMasukId: string, actor: RangkaianActor, options?: EnsureOptions): Promise<EnsureRangkaianResult>
    ```
  - Semantik: mengunci baris surat `FOR UPDATE`; bila surat sudah anggota, mengunci rangkaiannya dan mengembalikan `created:false`. Bila belum, membuat rangkaian (`kode = RS-<tahun surat>-<nextval 6 digit>`, `asal` = `surat_masuk` untuk surat masuk atau `inisiatif` untuk surat keluar, `unit_pencatat_id` = pemilik surat, `unit_pengolah_id` = `options.unitPengolahId` atau—khusus surat keluar—pemilik surat, `judul = judulRangkaian`, `klasifikasi_item_id` dari surat) + anggota `induk` `sumber='aplikasi'` + audit `create/rangkaian_surat`. `ensureForSuratMasuk` melempar `ConflictError` (409) bila rangkaian `diberkaskan`/`digabung`, dan mengisi `unit_pengolah_id` rangkaian yang masih NULL bila `options.unitPengolahId` diberikan (audit `update`). Validasi bahwa unit pengolah ada di jangkauan dilakukan pemanggil P3.

- [ ] **Step 1: Tulis harness dan test yang gagal**

`backend/src/__tests__/rangkaian.service.integration.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { enterTestMigratorRole } from './helpers/database-role-fixture';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

const migrationsDir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const journal = JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
) as { entries: Array<{ tag: string }> };

let database: PGlite;
let rangkaianService: typeof import('../services/rangkaian.service').rangkaianService;
let auditLogService: typeof import('../services/audit-log.service').default;
let klasifikasiId: number;

const actorId = '10000000-0000-4000-8000-00000000a001';
const actor = { userId: actorId, userEmail: 'tu-sesditjen@example.test' };
let seq = 0;
const uuidOf = (prefix: string, n: number) => `${prefix}000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const inTx = <T>(fn: (tx: any) => Promise<T>): Promise<T> => holder.db.transaction(fn);

async function suratMasuk(unit = 'sesditjen', extra: { perihal?: string | null; nomor?: string | null; status?: string } = {}) {
    seq += 1;
    const id = uuidOf('20', seq);
    await database.query(
        `INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal, status, klasifikasi_item_id)
         VALUES ($1, $2, $3, 2026, $4, $5, $6, $7)`,
        [
            id, unit, seq,
            extra.nomor === undefined ? `SM-${seq}/2026` : extra.nomor,
            extra.perihal === undefined ? `Perihal surat masuk ${seq}` : extra.perihal,
            extra.status ?? 'belum_dibalas',
            klasifikasiId,
        ],
    );
    return id;
}

async function suratKeluar(unit = 'dir_bppt', approvalStatus = 'draft') {
    seq += 1;
    const id = uuidOf('30', seq);
    await database.query(
        `INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal, approval_status)
         VALUES ($1, $2, $3, 2026, $4, $5, $6)`,
        [id, unit, seq, `ND-${seq}/2026`, `Tindak lanjut ${seq}`, approvalStatus],
    );
    return id;
}

async function arsipkan(jenis: 'masuk' | 'keluar', id: string) {
    const table = jenis === 'masuk' ? 'surat_masuk' : 'surat_keluar';
    await database.query(
        `INSERT INTO arsip (unit_kerja_id, jenis_arsip, source_surat_id, tahun,
                            nomor_surat_original, tanggal_surat_original, perihal_original)
         SELECT unit_kerja_id, $2, id, tahun, nomor_surat, tanggal_surat, perihal FROM ${table} WHERE id = $1`,
        [id, jenis],
    );
}

async function disposisi(suratMasukId: string, target: string, status = 'sent', rangkaianId: string | null = null) {
    const { rows } = await database.query<{ id: string }>(
        `INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status, rangkaian_id)
         SELECT $1, unit_kerja_id, $2, $3, $4 FROM surat_masuk WHERE id = $1 RETURNING id`,
        [suratMasukId, target, status, rangkaianId],
    );
    return rows[0].id;
}

async function anggotaKeluar(rangkaianId: string, suratKeluarId: string) {
    const { rows } = await database.query<{ id: string }>(
        `INSERT INTO rangkaian_anggota (rangkaian_id, surat_keluar_id, unit_kerja_id)
         SELECT $1, id, unit_kerja_id FROM surat_keluar WHERE id = $2 RETURNING id`,
        [rangkaianId, suratKeluarId],
    );
    return rows[0].id;
}

async function relasi(rangkaianId: string, dari: string, ke: string, jenis = 'tindak_lanjut') {
    const { rows } = await database.query<{ id: string }>(
        `INSERT INTO rangkaian_relasi (rangkaian_id, dari_anggota_id, ke_anggota_id, jenis_relasi)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [rangkaianId, dari, ke, jenis],
    );
    return rows[0].id;
}

async function berkaskan(rangkaianId: string) {
    await database.query(
        `UPDATE rangkaian_surat
         SET status = 'diberkaskan', unit_pengolah_id = 'dir_bppt', klasifikasi_item_id = $2,
             diberkaskan_at = now(), diberkaskan_by = $3
         WHERE id = $1`,
        [rangkaianId, klasifikasiId, actorId],
    );
}

async function rangkaianRow(id: string) {
    const { rows } = await database.query<Record<string, unknown>>(
        `SELECT id, kode, asal, status, unit_pencatat_id, unit_pengolah_id, judul, tahun,
                selesai_manual, selesai_at IS NOT NULL AS ada_selesai_at, digabung_ke_id
         FROM rangkaian_surat WHERE id = $1`,
        [id],
    );
    return rows[0];
}

async function auditRows(entityId: string) {
    const { rows } = await database.query<{ action: string; entity_type: string }>(
        `SELECT action, entity_type FROM audit_log WHERE entity_id = $1 ORDER BY created_at, id`,
        [entityId],
    );
    return rows;
}

async function rejectsWith(promise: Promise<unknown>, pattern: RegExp) {
    const error = await promise.then(() => null, (caught: unknown) => caught);
    expect(error, 'operasi seharusnya ditolak').not.toBeNull();
    const messages = [(error as any)?.message, (error as any)?.cause?.message].filter(Boolean).join('\n');
    expect(messages).toMatch(pattern);
}

beforeAll(async () => {
    database = new PGlite({ extensions: { pgcrypto } });
    await database.waitReady;
    await enterTestMigratorRole(database);
    for (const { tag } of journal.entries) {
        const statements = readFileSync(join(migrationsDir, `${tag}.sql`), 'utf8')
            .split('--> statement-breakpoint')
            .map((statement) => statement.trim())
            .filter(Boolean);
        for (const statement of statements) await database.exec(statement);
    }
    await database.exec(`
        INSERT INTO unit_kerja (id, name) VALUES ('ditjen', 'Ditjen'), ('sesditjen', 'Sesditjen');
        INSERT INTO users (id, email, role) VALUES ('${actorId}', 'tu-sesditjen@example.test', 'super_admin');
    `);
    klasifikasiId = (await database.query<{ id: number }>(`
        INSERT INTO klasifikasi_arsip (kode, source_record_key, jenis, tipe)
        VALUES ('PT.01.01', 'test:rangkaian:0001', 'Uji rangkaian', 'substantif') RETURNING id
    `)).rows[0].id;
    holder.db = drizzle(database, { schema });
    ({ rangkaianService } = await import('../services/rangkaian.service'));
    ({ default: auditLogService } = await import('../services/audit-log.service'));
}, 180_000);

afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await database?.close(); });

describe('rangkaianService.ensureForSurat / ensureForSuratMasuk', () => {
    it('membuat rangkaian + anggota induk sekali saja dan mengauditnya', async () => {
        const sm = await suratMasuk('sesditjen');
        const first = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor, { unitPengolahId: 'dir_bppt' }));
        const second = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor));

        expect(first).toMatchObject({ status: 'aktif', created: true });
        expect(first.kode).toMatch(/^RS-2026-\d{6}$/);
        expect(second).toEqual({ ...first, created: false });
        expect(await rangkaianRow(first.rangkaianId)).toMatchObject({
            asal: 'surat_masuk', status: 'aktif', unit_pencatat_id: 'sesditjen',
            unit_pengolah_id: 'dir_bppt', tahun: 2026,
        });
        const anggota = await database.query(
            `SELECT peran, sumber, unit_kerja_id FROM rangkaian_anggota WHERE surat_masuk_id = $1`, [sm]);
        expect(anggota.rows).toEqual([{ peran: 'induk', sumber: 'aplikasi', unit_kerja_id: 'sesditjen' }]);
        expect(await auditRows(first.rangkaianId)).toEqual([{ action: 'create', entity_type: 'rangkaian_surat' }]);
    });

    it('memakai nomor bila perihal NULL dan placeholder bila keduanya kosong', async () => {
        const tanpaPerihal = await suratMasuk('sesditjen', { perihal: null, nomor: 'B-12/PTPP.1/IX/2024' });
        const kosong = await suratMasuk('sesditjen', { perihal: '  ', nomor: null });
        const a = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, tanpaPerihal, actor));
        const b = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, kosong, actor));
        expect((await rangkaianRow(a.rangkaianId)).judul).toBe('B-12/PTPP.1/IX/2024');
        expect((await rangkaianRow(b.rangkaianId)).judul).toBe('(tanpa perihal)');
    });

    it('menjadikan surat keluar induk rangkaian inisiatif dengan pengolah = pemilik', async () => {
        const sk = await suratKeluar('dir_bppt');
        const result = await inTx((tx) => rangkaianService.ensureForSurat(tx, { jenis: 'surat_keluar', id: sk }, actor));
        expect(await rangkaianRow(result.rangkaianId)).toMatchObject({
            asal: 'inisiatif', unit_pencatat_id: 'dir_bppt', unit_pengolah_id: 'dir_bppt',
        });
    });

    it('mengisi unit pengolah yang masih kosong pada pemanggilan berikutnya', async () => {
        const sm = await suratMasuk('sesditjen');
        const first = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor));
        await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor, { unitPengolahId: 'dir_ptep' }));
        await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor, { unitPengolahId: 'dir_ktpp' }));
        expect((await rangkaianRow(first.rangkaianId)).unit_pengolah_id).toBe('dir_ptep');
        expect(await auditRows(first.rangkaianId)).toEqual([
            { action: 'create', entity_type: 'rangkaian_surat' },
            { action: 'update', entity_type: 'rangkaian_surat' },
        ]);
    });

    it('menolak 409 bila rangkaian surat masuk sudah diberkaskan', async () => {
        const sm = await suratMasuk('sesditjen');
        const { rangkaianId } = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor));
        await berkaskan(rangkaianId);
        await expect(inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor)))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    it('404 untuk surat yang dihapus dan rollback penuh bila audit gagal', async () => {
        const deleted = await suratMasuk('sesditjen');
        await database.query(`UPDATE surat_masuk SET is_deleted = true WHERE id = $1`, [deleted]);
        await expect(inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, deleted, actor)))
            .rejects.toMatchObject({ statusCode: 404 });

        const sm = await suratMasuk('sesditjen');
        vi.spyOn(auditLogService, 'logActionOrThrow').mockRejectedValueOnce(new Error('audit unavailable'));
        await expect(inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor))).rejects.toThrow('audit unavailable');
        const leftovers = await database.query(`SELECT 1 FROM rangkaian_anggota WHERE surat_masuk_id = $1`, [sm]);
        expect(leftovers.rows).toEqual([]);
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/rangkaian.service.integration.test.ts`
Expected: FAIL — `Failed to load url ../services/rangkaian.service` (modul belum ada).

- [ ] **Step 3: Implementasi**

`backend/src/db/transaction.ts`:

```ts
import type { db } from '../config/database';

/** Transaksi Drizzle aplikasi; untuk layanan yang menerima `tx` dari pemanggil. */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
```

`backend/src/services/audit-log.service.ts` — ganti baris 11–12:

```ts
    action: 'create' | 'update' | 'delete' | 'cancel' | 'archive' | 'restore' | 'status_change' | 'distribute' | 'receive_distribution' | 'process_distribution' | 'reject_distribution' | 'view' | 'download' | 'verify_integrity' | 'hold' | 'release_hold' | 'request_access' | 'approve_access' | 'deny_access' | 'revoke_access' | 'merge' | 'link';
    entityType: 'surat_masuk' | 'surat_keluar' | 'arsip' | 'arsip_rule_assignment' | 'user' | 'unit_kerja' | 'surat_template' | 'user_preferences' | 'storage_location' | 'archive_lending' | 'surat_distribution' | 'autentikasi' | 'layanan_arsip' | 'dosir' | 'penyusutan' | 'file_attachment' | 'arsip_elektronik' | 'tunjuk_silang' | 'record_access_grant' | 'regulatory_rule_set' | 'rangkaian_surat' | 'rangkaian_relasi';
```

`backend/src/services/rangkaian.service.ts` (versi Task 9; Task 10–12 menambah fungsi ke objek yang sama):

```ts
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
    rangkaianAnggota,
    rangkaianSurat,
    suratKeluar,
    suratMasuk,
    type RangkaianAsal,
    type RangkaianStatus,
} from '../db/schema';
import type { DbTransaction } from '../db/transaction';
import auditLogService, { type CriticalAuditContext, type LogActionData } from './audit-log.service.js';
import { isRangkaianTerbuka, judulRangkaian } from './rangkaian-status.js';
import { ConflictError, NotFoundError } from '../utils/errors.js';

export type { JenisRelasi, RangkaianStatus } from '../db/schema';
export type JenisSurat = 'surat_masuk' | 'surat_keluar';
export interface SuratRef { jenis: JenisSurat; id: string }
export type RangkaianActor = CriticalAuditContext & { userId: string };
export interface EnsureOptions { unitPengolahId?: string | null }
export interface EnsureRangkaianResult {
    rangkaianId: string;
    kode: string;
    anggotaId: string;
    status: RangkaianStatus;
    created: boolean;
}

type AuditEntry = Omit<LogActionData, 'userId' | 'userEmail' | 'ipAddress'>;

function catatAudit(tx: DbTransaction, actor: RangkaianActor, entry: AuditEntry): Promise<void> {
    return auditLogService.logActionOrThrow({ ...actor, ...entry }, tx);
}

interface SuratTerkunci {
    id: string;
    unitKerjaId: string;
    tahun: number;
    perihal: string | null;
    nomorSurat: string | null;
    klasifikasiItemId: number | null;
    isDeleted: boolean | null;
}

/** Urutan kunci global: baris surat → rangkaian (id menaik) → distribusi. */
async function lockSurat(tx: DbTransaction, ref: SuratRef): Promise<SuratTerkunci> {
    const rows: SuratTerkunci[] = ref.jenis === 'surat_masuk'
        ? await tx.select({
            id: suratMasuk.id,
            unitKerjaId: suratMasuk.unitKerjaId,
            tahun: suratMasuk.tahun,
            perihal: suratMasuk.perihal,
            nomorSurat: suratMasuk.nomorSurat,
            klasifikasiItemId: suratMasuk.klasifikasiItemId,
            isDeleted: suratMasuk.isDeleted,
        }).from(suratMasuk).where(eq(suratMasuk.id, ref.id)).for('update')
        : await tx.select({
            id: suratKeluar.id,
            unitKerjaId: suratKeluar.unitKerjaId,
            tahun: suratKeluar.tahun,
            perihal: suratKeluar.perihal,
            nomorSurat: suratKeluar.nomorSurat,
            klasifikasiItemId: suratKeluar.klasifikasiItemId,
            isDeleted: suratKeluar.isDeleted,
        }).from(suratKeluar).where(eq(suratKeluar.id, ref.id)).for('update');
    const [row] = rows;
    if (!row || row.isDeleted === true) {
        throw new NotFoundError(ref.jenis === 'surat_masuk' ? 'Surat masuk' : 'Surat keluar');
    }
    return row;
}

interface Keanggotaan {
    anggotaId: string;
    peran: string;
    rangkaianId: string;
    kode: string;
    status: RangkaianStatus;
}

async function findMembership(tx: DbTransaction, ref: SuratRef): Promise<Keanggotaan | null> {
    const column = ref.jenis === 'surat_masuk' ? rangkaianAnggota.suratMasukId : rangkaianAnggota.suratKeluarId;
    const [row] = await tx.select({
        anggotaId: rangkaianAnggota.id,
        peran: rangkaianAnggota.peran,
        rangkaianId: rangkaianSurat.id,
        kode: rangkaianSurat.kode,
        status: rangkaianSurat.status,
    })
        .from(rangkaianAnggota)
        .innerJoin(rangkaianSurat, eq(rangkaianSurat.id, rangkaianAnggota.rangkaianId))
        .where(eq(column, ref.id))
        .limit(1);
    return row ?? null;
}

export interface RangkaianTerkunci {
    id: string;
    kode: string;
    status: RangkaianStatus;
    asal: RangkaianAsal;
    selesaiManual: boolean;
    unitPengolahId: string | null;
}

async function lockRangkaian(tx: DbTransaction, ids: string[]): Promise<RangkaianTerkunci[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    return tx.select({
        id: rangkaianSurat.id,
        kode: rangkaianSurat.kode,
        status: rangkaianSurat.status,
        asal: rangkaianSurat.asal,
        selesaiManual: rangkaianSurat.selesaiManual,
        unitPengolahId: rangkaianSurat.unitPengolahId,
    })
        .from(rangkaianSurat)
        .where(inArray(rangkaianSurat.id, unique))
        .orderBy(asc(rangkaianSurat.id))
        .for('update');
}

async function nextKode(tx: DbTransaction, tahun: number): Promise<string> {
    const { rows } = await tx.execute<{ n: string }>(
        sql`SELECT nextval('rangkaian_surat_kode_seq')::text AS n`,
    );
    return `RS-${tahun}-${rows[0].n.padStart(6, '0')}`;
}

export const rangkaianService = {
    async ensureForSurat(
        tx: DbTransaction,
        ref: SuratRef,
        actor: RangkaianActor,
        options: EnsureOptions = {},
    ): Promise<EnsureRangkaianResult> {
        const surat = await lockSurat(tx, ref);
        const existing = await findMembership(tx, ref);
        if (existing) {
            const [locked] = await lockRangkaian(tx, [existing.rangkaianId]);
            return {
                rangkaianId: locked.id,
                kode: locked.kode,
                anggotaId: existing.anggotaId,
                status: locked.status,
                created: false,
            };
        }

        const asal: RangkaianAsal = ref.jenis === 'surat_masuk' ? 'surat_masuk' : 'inisiatif';
        const unitPengolahId = options.unitPengolahId !== undefined
            ? options.unitPengolahId
            : (ref.jenis === 'surat_keluar' ? surat.unitKerjaId : null);
        const kode = await nextKode(tx, surat.tahun);
        const [rangkaian] = await tx.insert(rangkaianSurat).values({
            kode,
            asal,
            status: 'aktif',
            unitPencatatId: surat.unitKerjaId,
            unitPengolahId,
            judul: judulRangkaian(surat),
            tahun: surat.tahun,
            klasifikasiItemId: surat.klasifikasiItemId ?? null,
            createdBy: actor.userId,
        }).returning({ id: rangkaianSurat.id });
        const [anggota] = await tx.insert(rangkaianAnggota).values({
            rangkaianId: rangkaian.id,
            suratMasukId: ref.jenis === 'surat_masuk' ? ref.id : null,
            suratKeluarId: ref.jenis === 'surat_keluar' ? ref.id : null,
            unitKerjaId: surat.unitKerjaId,
            peran: 'induk',
            sumber: 'aplikasi',
            ditambahkanBy: actor.userId,
        }).returning({ id: rangkaianAnggota.id });

        await catatAudit(tx, actor, {
            action: 'create',
            entityType: 'rangkaian_surat',
            entityId: rangkaian.id,
            changes: {
                after: {
                    kode, asal, status: 'aktif',
                    unitPencatatId: surat.unitKerjaId, unitPengolahId,
                    induk: ref, anggotaId: anggota.id,
                },
            },
        });
        return { rangkaianId: rangkaian.id, kode, anggotaId: anggota.id, status: 'aktif', created: true };
    },

    async ensureForSuratMasuk(
        tx: DbTransaction,
        suratMasukId: string,
        actor: RangkaianActor,
        options: EnsureOptions = {},
    ): Promise<EnsureRangkaianResult> {
        const result = await rangkaianService.ensureForSurat(
            tx, { jenis: 'surat_masuk', id: suratMasukId }, actor, options,
        );
        if (!isRangkaianTerbuka(result.status)) {
            throw new ConflictError(
                `Rangkaian ${result.kode} sudah ${result.status}; disposisi baru tidak dapat ditambahkan. `
                + 'Gunakan Koreksi Berkas atau surat lanjutan.',
            );
        }
        if (!result.created && options.unitPengolahId) {
            const [updated] = await tx.update(rangkaianSurat)
                .set({ unitPengolahId: options.unitPengolahId, updatedAt: new Date() })
                .where(and(eq(rangkaianSurat.id, result.rangkaianId), isNull(rangkaianSurat.unitPengolahId)))
                .returning({ id: rangkaianSurat.id });
            if (updated) {
                await catatAudit(tx, actor, {
                    action: 'update',
                    entityType: 'rangkaian_surat',
                    entityId: result.rangkaianId,
                    changes: { before: { unitPengolahId: null }, after: { unitPengolahId: options.unitPengolahId } },
                });
            }
        }
        return result;
    },
};

export default rangkaianService;
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/rangkaian.service.integration.test.ts src/__tests__/mutation-audit-policy.test.ts && npx tsc --noEmit`
Expected: PASS (6 test ensure); `tsc` tanpa error.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/transaction.ts backend/src/services/audit-log.service.ts backend/src/services/rangkaian.service.ts backend/src/__tests__/rangkaian.service.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(rangkaian): ensureForSurat dan ensureForSuratMasuk transaksional

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Jangkauan, `recomputeStatus`, dan `recomputeSuratMasukStatus`

**Files:**
- Modify: `backend/src/services/access/visibility-spec.ts` (dibuat P0; tambahkan `JangkauanOptions` + `jangkauanUnitsSql` di akhir file — **satu-satunya** definisi himpunan jangkauan §4.5)
- Modify: `backend/src/services/rangkaian.service.ts` (tambah impor, lalu tiga method di objek `rangkaianService`)
- Test: `backend/src/__tests__/rangkaian.service.integration.test.ts` (tambah `describe` di akhir)

**Interfaces:**
- Produces:
  ```ts
  // backend/src/services/access/visibility-spec.ts (sumber tunggal; P2 membangun jangkauanSql di atasnya)
  export interface JangkauanOptions { disposisiLama?: boolean }
  export function jangkauanUnitsSql(rangkaianId: SQLWrapper | string, options?: JangkauanOptions): SQL  // subquery ber-kurung, satu kolom unit_kerja_id
  // backend/src/services/rangkaian.service.ts
  rangkaianService.jangkauanUnitIds(executor: Pick<DbTransaction, 'execute'>, rangkaianId: string, options?: JangkauanOptions): Promise<string[]>  // terurut
  export interface StatusChange<T extends string> { id: string; before: T; after: T; changed: boolean }
  rangkaianService.recomputeStatus(tx: DbTransaction, rangkaianIds: string[], actor: RangkaianActor): Promise<StatusChange<RangkaianStatus>[]>
  rangkaianService.recomputeSuratMasukStatus(tx: DbTransaction, suratMasukIds: string[], actor: RangkaianActor): Promise<StatusChange<string>[]>
  ```
- Semantik jangkauan (spesifikasi §4.5, dipakai P2 `checkRead`/`checkMany`/`visibleSql`): `unit_pencatat_id` ∪ `unit_pengolah_id` ∪ `rangkaian_anggota.unit_kerja_id` ∪ target `surat_distributions` (`rangkaian_id = R AND status <> 'rejected'`) ∪ (`rangkaian_peserta` aktif **hanya** bila `disposisiLama: true`, yaitu flag `RANGKAIAN_DISPOSISI_LAMA_READ` di P5). `lanjutan_dari_id`/`digabung_ke_id` tidak memberi jangkauan.
- `recomputeStatus`: kunci `FOR UPDATE`, lewati `diberkaskan`/`digabung`; fakta = disposisi `sent/received`, disposisi `processed`, anggota keluar hidup `draft/pending/rejected` (induk, atau punya relasi keluar aktif), relasi aktif `balasan/tindak_lanjut` dari surat keluar hidup `approved`; ke `selesai` mengisi `selesai_at`; ke `aktif` mengosongkan `selesai_*` dan `selesai_manual`; audit `status_change/rangkaian_surat`.
- `recomputeSuratMasukStatus`: kunci `surat_masuk FOR UPDATE`, lewati yang terhapus; audit `status_change/surat_masuk` hanya bila nilai berubah; monoton (lihat Task 8). UPDATE hanya `status` + `updated_at` sehingga guard 0021 lolos pada surat terarsip.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir file integrasi:

```ts
describe('rangkaianService jangkauan & recompute', () => {
    it('menurunkan jangkauan secara langsung; disposisi ditolak dan peserta lama (tanpa flag) tidak memberi akses', async () => {
        const sm = await suratMasuk('sesditjen');
        const { rangkaianId } = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor, { unitPengolahId: 'dir_bppt' }));
        await disposisi(sm, 'dir_ptep', 'sent', rangkaianId);
        await disposisi(sm, 'dir_ktpp', 'rejected', rangkaianId);
        await anggotaKeluar(rangkaianId, await suratKeluar('dir_plp'));
        await database.query(
            `INSERT INTO rangkaian_peserta (rangkaian_id, unit_kerja_id, peran, label_asal) VALUES ($1, 'ditjen', 'disposisi_lama', 'Dirjen')`,
            [rangkaianId],
        );
        await expect(rangkaianService.jangkauanUnitIds(holder.db, rangkaianId))
            .resolves.toEqual(['dir_bppt', 'dir_plp', 'dir_ptep', 'sesditjen']);
        await expect(rangkaianService.jangkauanUnitIds(holder.db, rangkaianId, { disposisiLama: true }))
            .resolves.toEqual(['dir_bppt', 'dir_plp', 'dir_ptep', 'ditjen', 'sesditjen']);
    });

    it('surat masuk tetap aktif selama disposisi terbuka lalu selesai otomatis setelah diproses', async () => {
        const sm = await suratMasuk('sesditjen');
        const { rangkaianId } = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor));
        const dist = await disposisi(sm, 'dir_bppt', 'sent', rangkaianId);
        const first = await inTx((tx) => rangkaianService.recomputeStatus(tx, [rangkaianId], actor));
        expect(first).toEqual([{ id: rangkaianId, before: 'aktif', after: 'aktif', changed: false }]);

        await database.query(`UPDATE surat_distributions SET status = 'processed' WHERE id = $1`, [dist]);
        const second = await inTx((tx) => rangkaianService.recomputeStatus(tx, [rangkaianId], actor));
        expect(second).toEqual([{ id: rangkaianId, before: 'aktif', after: 'selesai', changed: true }]);
        expect(await rangkaianRow(rangkaianId)).toMatchObject({ status: 'selesai', selesai_manual: false, ada_selesai_at: true });
        expect(await auditRows(rangkaianId)).toContainEqual({ action: 'status_change', entity_type: 'rangkaian_surat' });
    });

    it('inisiatif selesai saat induk disetujui; draft yang dihapus tidak memblokir', async () => {
        const induk = await suratKeluar('dir_bppt', 'draft');
        const { rangkaianId, anggotaId } = await inTx((tx) => rangkaianService.ensureForSurat(tx, { jenis: 'surat_keluar', id: induk }, actor));
        expect((await inTx((tx) => rangkaianService.recomputeStatus(tx, [rangkaianId], actor)))[0].after).toBe('aktif');

        const penjelas = await suratKeluar('dir_bppt', 'draft');
        await relasi(rangkaianId, await anggotaKeluar(rangkaianId, penjelas), anggotaId, 'menjelaskan');
        await database.query(`UPDATE surat_keluar SET approval_status = 'approved' WHERE id = $1`, [induk]);
        expect((await inTx((tx) => rangkaianService.recomputeStatus(tx, [rangkaianId], actor)))[0].after).toBe('aktif');

        await database.query(`UPDATE surat_keluar SET is_deleted = true, deleted_at = now() WHERE id = $1`, [penjelas]);
        expect((await inTx((tx) => rangkaianService.recomputeStatus(tx, [rangkaianId], actor)))[0].after).toBe('selesai');
    });

    it('Tandai Selesai manual dibuka kembali oleh disposisi baru', async () => {
        const sm = await suratMasuk('sesditjen');
        const { rangkaianId } = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor));
        await database.query(
            `UPDATE rangkaian_surat SET status = 'selesai', selesai_manual = true, selesai_by = $2,
                    selesai_at = now(), catatan_selesai = 'Selesai lewat rapat koordinasi' WHERE id = $1`,
            [rangkaianId, actorId],
        );
        await disposisi(sm, 'dir_bppt', 'sent', rangkaianId);
        await inTx((tx) => rangkaianService.recomputeStatus(tx, [rangkaianId], actor));
        const row = await database.query(
            `SELECT status, selesai_manual, catatan_selesai, selesai_by FROM rangkaian_surat WHERE id = $1`, [rangkaianId]);
        expect(row.rows).toEqual([{ status: 'aktif', selesai_manual: false, catatan_selesai: null, selesai_by: null }]);
    });

    it('status surat masuk diturunkan dari balasan disetujui, turun bila relasi dibatalkan, dan monoton untuk impor', async () => {
        const sm = await suratMasuk('sesditjen');
        await arsipkan('masuk', sm); // guard 0021 tidak boleh terpicu oleh UPDATE status
        const { rangkaianId, anggotaId } = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor));
        const nd = await suratKeluar('dir_bppt', 'draft');
        const relasiId = await relasi(rangkaianId, await anggotaKeluar(rangkaianId, nd), anggotaId, 'tindak_lanjut');

        expect(await inTx((tx) => rangkaianService.recomputeSuratMasukStatus(tx, [sm], actor)))
            .toEqual([{ id: sm, before: 'belum_dibalas', after: 'belum_dibalas', changed: false }]);
        await database.query(`UPDATE surat_keluar SET approval_status = 'approved' WHERE id = $1`, [nd]);
        expect(await inTx((tx) => rangkaianService.recomputeSuratMasukStatus(tx, [sm], actor)))
            .toEqual([{ id: sm, before: 'belum_dibalas', after: 'sudah_dibalas', changed: true }]);
        expect(await auditRows(sm)).toContainEqual({ action: 'status_change', entity_type: 'surat_masuk' });

        await database.query(
            `UPDATE rangkaian_relasi SET cancelled_at = now(), cancelled_by = $2,
                    cancellation_reason = 'Relasi salah pilih surat induk' WHERE id = $1`,
            [relasiId, actorId],
        );
        expect((await inTx((tx) => rangkaianService.recomputeSuratMasukStatus(tx, [sm], actor)))[0])
            .toMatchObject({ after: 'belum_dibalas', changed: true });

        const impor = await suratMasuk('sesditjen', { status: 'sudah_dibalas' });
        expect(await inTx((tx) => rangkaianService.recomputeSuratMasukStatus(tx, [impor], actor)))
            .toEqual([{ id: impor, before: 'sudah_dibalas', after: 'sudah_dibalas', changed: false }]);
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/rangkaian.service.integration.test.ts -t "jangkauan & recompute"`
Expected: FAIL — `rangkaianService.jangkauanUnitIds is not a function`.

- [ ] **Step 3: Implementasi**

Di `rangkaian.service.ts`:

Ganti impor baris pertama menjadi:

```ts
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
```

(Tipe `SQL`/`SQLWrapper` untuk `jangkauanUnitsSql` kini diimpor di `visibility-spec.ts`, bukan di sini.)

ganti impor `rangkaian-status.js` menjadi:

```ts
import {
    deriveRangkaianStatus,
    deriveSuratMasukStatus,
    isRangkaianTerbuka,
    judulRangkaian,
} from './rangkaian-status.js';
```

Di **akhir** `backend/src/services/access/visibility-spec.ts` (berkas P0), tambahkan blok berikut. Bila berkas sudah mengimpor dari `'drizzle-orm'`, gabungkan `sql`, `SQL`, `SQLWrapper` ke impor yang ada (jangan membuat impor kedua):

```ts
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

// ─── P1: jangkauan rangkaian (spec §4.5) — satu-satunya definisi ─────────────
export interface JangkauanOptions {
    /** true hanya bila flag RANGKAIAN_DISPOSISI_LAMA_READ menyala (P2: isDisposisiLamaReadEnabled). */
    disposisiLama?: boolean;
}

/**
 * Jangkauan baca rangkaian (spesifikasi §4.5), diturunkan langsung tanpa
 * salinan. Satu-satunya definisi himpunan unit: P1 (jangkauanUnitIds, gabung),
 * P2 (jangkauanSql → checkRead/checkMany/visibleSql), P3 (deps), P4 (daftar),
 * dan P5 (flag data lama) semuanya melewati fungsi ini.
 */
export function jangkauanUnitsSql(rangkaianId: SQLWrapper | string, options: JangkauanOptions = {}): SQL {
    const id = typeof rangkaianId === 'string' ? sql`${rangkaianId}::uuid` : rangkaianId;
    const peserta = options.disposisiLama
        ? sql`UNION SELECT p.unit_kerja_id FROM rangkaian_peserta p
              WHERE p.rangkaian_id = ${id} AND p.berakhir_at IS NULL`
        : sql``;
    return sql`(
        SELECT r.unit_pencatat_id AS unit_kerja_id FROM rangkaian_surat r WHERE r.id = ${id}
        UNION SELECT r.unit_pengolah_id FROM rangkaian_surat r
              WHERE r.id = ${id} AND r.unit_pengolah_id IS NOT NULL
        UNION SELECT a.unit_kerja_id FROM rangkaian_anggota a WHERE a.rangkaian_id = ${id}
        UNION SELECT d.target_unit_id FROM surat_distributions d
              WHERE d.rangkaian_id = ${id} AND d.status <> 'rejected'
        ${peserta}
    )`;
}
```

Di `rangkaian.service.ts`, tambahkan impor `import { jangkauanUnitsSql, type JangkauanOptions } from './access/visibility-spec.js';` lalu tambahkan sebelum `export const rangkaianService`:

```ts
export interface StatusChange<T extends string> { id: string; before: T; after: T; changed: boolean }

type RangkaianFacts = {
    open_disposisi: number;
    processed_disposisi: number;
    blocking_anggota: number;
    approved_tindak_lanjut: number;
};

type SuratMasukFacts = {
    approved_reply: boolean;
    penyelesaian: boolean;
    selesai_manual: boolean;
    evidence: boolean;
};
```

Tambahkan method berikut ke dalam objek `rangkaianService` (setelah `ensureForSuratMasuk`):

```ts
    async jangkauanUnitIds(
        executor: Pick<DbTransaction, 'execute'>,
        rangkaianId: string,
        options: JangkauanOptions = {},
    ): Promise<string[]> {
        const { rows } = await executor.execute<{ unit_kerja_id: string }>(
            sql`SELECT j.unit_kerja_id FROM ${jangkauanUnitsSql(rangkaianId, options)} AS j`,
        );
        return rows.map((row) => row.unit_kerja_id).sort();
    },

    async recomputeStatus(
        tx: DbTransaction,
        rangkaianIds: string[],
        actor: RangkaianActor,
    ): Promise<StatusChange<RangkaianStatus>[]> {
        const changes: StatusChange<RangkaianStatus>[] = [];
        for (const rangkaian of await lockRangkaian(tx, rangkaianIds)) {
            if (!isRangkaianTerbuka(rangkaian.status)) {
                changes.push({ id: rangkaian.id, before: rangkaian.status, after: rangkaian.status, changed: false });
                continue;
            }
            const { rows: [facts] } = await tx.execute<RangkaianFacts>(sql`
                SELECT
                    (SELECT count(*)::int FROM surat_distributions d
                      WHERE d.rangkaian_id = ${rangkaian.id} AND d.status IN ('sent', 'received')) AS open_disposisi,
                    (SELECT count(*)::int FROM surat_distributions d
                      WHERE d.rangkaian_id = ${rangkaian.id} AND d.status = 'processed') AS processed_disposisi,
                    (SELECT count(*)::int FROM rangkaian_anggota a
                      JOIN surat_keluar k ON k.id = a.surat_keluar_id
                      WHERE a.rangkaian_id = ${rangkaian.id}
                        AND k.is_deleted IS NOT TRUE
                        AND k.approval_status IN ('draft', 'pending', 'rejected')
                        AND (a.peran = 'induk' OR EXISTS (
                            SELECT 1 FROM rangkaian_relasi r
                            WHERE r.dari_anggota_id = a.id AND r.cancelled_at IS NULL
                        ))) AS blocking_anggota,
                    (SELECT count(*)::int FROM rangkaian_relasi r
                      JOIN rangkaian_anggota a ON a.id = r.dari_anggota_id
                      JOIN surat_keluar k ON k.id = a.surat_keluar_id
                      WHERE r.rangkaian_id = ${rangkaian.id}
                        AND r.cancelled_at IS NULL
                        AND r.jenis_relasi IN ('balasan', 'tindak_lanjut')
                        AND k.is_deleted IS NOT TRUE
                        AND k.approval_status = 'approved') AS approved_tindak_lanjut
            `);
            const after = deriveRangkaianStatus({
                current: rangkaian.status,
                asal: rangkaian.asal,
                selesaiManual: rangkaian.selesaiManual,
                openDisposisi: facts.open_disposisi,
                processedDisposisi: facts.processed_disposisi,
                blockingAnggota: facts.blocking_anggota,
                approvedTindakLanjut: facts.approved_tindak_lanjut,
            });
            const changed = after !== rangkaian.status;
            if (changed) {
                await tx.update(rangkaianSurat)
                    .set(after === 'selesai'
                        ? { status: 'selesai', selesaiAt: new Date(), updatedAt: new Date() }
                        : {
                            status: 'aktif', selesaiAt: null, selesaiBy: null,
                            catatanSelesai: null, selesaiManual: false, updatedAt: new Date(),
                        })
                    .where(eq(rangkaianSurat.id, rangkaian.id));
                await catatAudit(tx, actor, {
                    action: 'status_change',
                    entityType: 'rangkaian_surat',
                    entityId: rangkaian.id,
                    changes: { before: { status: rangkaian.status }, after: { status: after }, otomatis: true, fakta: facts },
                });
            }
            changes.push({ id: rangkaian.id, before: rangkaian.status, after, changed });
        }
        return changes;
    },

    async recomputeSuratMasukStatus(
        tx: DbTransaction,
        suratMasukIds: string[],
        actor: RangkaianActor,
    ): Promise<StatusChange<string>[]> {
        const ids = [...new Set(suratMasukIds)];
        if (ids.length === 0) return [];
        const rows = await tx.select({ id: suratMasuk.id, status: suratMasuk.status, isDeleted: suratMasuk.isDeleted })
            .from(suratMasuk)
            .where(inArray(suratMasuk.id, ids))
            .orderBy(asc(suratMasuk.id))
            .for('update');
        const changes: StatusChange<string>[] = [];
        for (const row of rows) {
            if (row.isDeleted === true) continue;
            const { rows: [facts] } = await tx.execute<SuratMasukFacts>(sql`
                WITH m AS (
                    SELECT a.id AS anggota_id, a.rangkaian_id
                    FROM rangkaian_anggota a WHERE a.surat_masuk_id = ${row.id}
                )
                SELECT
                    EXISTS (
                        SELECT 1 FROM rangkaian_relasi r
                        JOIN m ON r.ke_anggota_id = m.anggota_id
                        JOIN rangkaian_anggota d ON d.id = r.dari_anggota_id
                        JOIN surat_keluar k ON k.id = d.surat_keluar_id
                        WHERE r.cancelled_at IS NULL
                          AND r.jenis_relasi IN ('balasan', 'tindak_lanjut')
                          AND k.is_deleted IS NOT TRUE
                          AND k.approval_status = 'approved'
                    ) AS approved_reply,
                    EXISTS (
                        SELECT 1 FROM surat_distributions sd
                        WHERE sd.surat_masuk_id = ${row.id}
                          AND sd.status = 'processed'
                          AND NOT sd.ditutup_pengawas
                          AND (sd.penyelesaian_surat_keluar_id IS NOT NULL
                               OR coalesce(length(trim(sd.catatan_penyelesaian)), 0) >= 10)
                    ) AS penyelesaian,
                    EXISTS (
                        SELECT 1 FROM m JOIN rangkaian_surat rs ON rs.id = m.rangkaian_id
                        WHERE rs.selesai_manual AND rs.asal <> 'data_lama'
                    ) AS selesai_manual,
                    (
                        EXISTS (
                            SELECT 1 FROM rangkaian_relasi r
                            JOIN m ON m.anggota_id IN (r.ke_anggota_id, r.dari_anggota_id)
                        )
                        OR EXISTS (
                            SELECT 1 FROM surat_distributions sd
                            JOIN m ON sd.rangkaian_id = m.rangkaian_id
                            WHERE sd.status = 'processed'
                        )
                    ) AS evidence
            `);
            const before = row.status ?? 'belum_dibalas';
            const after = deriveSuratMasukStatus({
                current: row.status,
                approvedReply: facts.approved_reply,
                penyelesaian: facts.penyelesaian,
                selesaiManualNonLegacy: facts.selesai_manual,
                hasRangkaianEvidence: facts.evidence,
            });
            const changed = after !== before;
            if (changed) {
                // Hanya status + updated_at: guard 0021 tetap lolos untuk surat terarsip.
                await tx.update(suratMasuk).set({ status: after, updatedAt: new Date() }).where(eq(suratMasuk.id, row.id));
                await catatAudit(tx, actor, {
                    action: 'status_change',
                    entityType: 'surat_masuk',
                    entityId: row.id,
                    changes: { before: { status: before }, after: { status: after }, sumber: 'rangkaian', fakta: facts },
                });
            }
            changes.push({ id: row.id, before, after, changed });
        }
        return changes;
    },
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/rangkaian.service.integration.test.ts && npx tsc --noEmit`
Expected: PASS (11 test); `tsc` bersih.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/access/visibility-spec.ts backend/src/services/rangkaian.service.ts backend/src/__tests__/rangkaian.service.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(rangkaian): jangkauan turunan dan recompute status yang diaudit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: `rangkaianService.gabung`

**Files:**
- Modify: `backend/src/services/rangkaian.service.ts` (impor `suratDistributions`, `ValidationError`; tipe `GabungInput`/`GabungResult`; method `gabung`)
- Test: `backend/src/__tests__/rangkaian.service.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface GabungInput { targetId: string; sumberId: string; alasan: string }
  export interface GabungResult { targetId: string; sumberId: string; anggotaDipindah: number; distribusiDipindah: number; unitAksesBaru: string[]; targetStatus: RangkaianStatus }
  rangkaianService.gabung(tx: DbTransaction, input: GabungInput, actor: RangkaianActor): Promise<GabungResult>
  ```
- Semantik (spesifikasi §3 Catatan gabung): alasan trim ≥10 (400), `targetId ≠ sumberId` (400); kunci kedua baris `FOR UPDATE` id menaik; keduanya harus `aktif|selesai` (409); `UPDATE rangkaian_anggota SET rangkaian_id=target, peran='anggota', sumber = CASE sumber WHEN 'data_lama' THEN 'data_lama' ELSE 'gabung' END` (relasi ikut lewat `ON UPDATE CASCADE`); `UPDATE surat_distributions SET rangkaian_id=target`; peserta aktif yang tidak bentrok ikut dipindah; sumber → `digabung` + `digabung_ke_id`; `recomputeStatus(target)`; audit `merge/rangkaian_surat` pada sumber berisi alasan dan delta akses `unitAksesBaru` (jangkauan target sesudah − sebelum, tanpa peserta lama). Otorisasi (pengawas/super_admin) di route P3.

- [ ] **Step 1: Tulis test yang gagal**

```ts
describe('rangkaianService.gabung', () => {
    it('memindahkan anggota, relasi, dan disposisi; target tidak selesai selama sumber punya disposisi terbuka', async () => {
        const smA = await suratMasuk('sesditjen');
        const a = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, smA, actor, { unitPengolahId: 'dir_bppt' }));
        await disposisi(smA, 'dir_bppt', 'processed', a.rangkaianId);
        await inTx((tx) => rangkaianService.recomputeStatus(tx, [a.rangkaianId], actor));
        expect((await rangkaianRow(a.rangkaianId)).status).toBe('selesai');

        const smB = await suratMasuk('sesditjen');
        const b = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, smB, actor));
        const nd = await suratKeluar('dir_plp', 'approved');
        const relasiB = await relasi(b.rangkaianId, await anggotaKeluar(b.rangkaianId, nd), b.anggotaId, 'balasan');
        const distB = await disposisi(smB, 'dir_ptep', 'sent', b.rangkaianId);

        const result = await inTx((tx) => rangkaianService.gabung(tx, {
            targetId: a.rangkaianId, sumberId: b.rangkaianId, alasan: 'TU lupa mengisi Nomor Referensi',
        }, actor));

        expect(result).toEqual({
            targetId: a.rangkaianId,
            sumberId: b.rangkaianId,
            anggotaDipindah: 2,
            distribusiDipindah: 1,
            unitAksesBaru: ['dir_plp', 'dir_ptep'],
            targetStatus: 'aktif',
        });
        const anggota = await database.query<{ peran: string; sumber: string }>(
            `SELECT peran, sumber FROM rangkaian_anggota WHERE rangkaian_id = $1 ORDER BY peran, sumber`, [a.rangkaianId]);
        expect(anggota.rows).toEqual([
            { peran: 'anggota', sumber: 'gabung' },
            { peran: 'anggota', sumber: 'gabung' },
            { peran: 'induk', sumber: 'aplikasi' },
        ]);
        const pindah = await database.query(
            `SELECT (SELECT rangkaian_id FROM rangkaian_relasi WHERE id = $1) AS relasi,
                    (SELECT rangkaian_id FROM surat_distributions WHERE id = $2) AS distribusi`,
            [relasiB, distB]);
        expect(pindah.rows).toEqual([{ relasi: a.rangkaianId, distribusi: a.rangkaianId }]);
        expect(await rangkaianRow(b.rangkaianId)).toMatchObject({ status: 'digabung', digabung_ke_id: a.rangkaianId });
        expect(await auditRows(b.rangkaianId)).toContainEqual({ action: 'merge', entity_type: 'rangkaian_surat' });
    });

    it('menolak alasan pendek, sumber = target, dan rangkaian tertutup', async () => {
        const t = await inTx(async (tx) => rangkaianService.ensureForSuratMasuk(tx, await suratMasuk('sesditjen'), actor));
        const s = await inTx(async (tx) => rangkaianService.ensureForSuratMasuk(tx, await suratMasuk('sesditjen'), actor));
        await expect(inTx((tx) => rangkaianService.gabung(tx, { targetId: t.rangkaianId, sumberId: s.rangkaianId, alasan: ' pendek ' }, actor)))
            .rejects.toMatchObject({ statusCode: 400 });
        await expect(inTx((tx) => rangkaianService.gabung(tx, { targetId: t.rangkaianId, sumberId: t.rangkaianId, alasan: 'Alasan cukup panjang' }, actor)))
            .rejects.toMatchObject({ statusCode: 400 });
        await berkaskan(s.rangkaianId);
        await expect(inTx((tx) => rangkaianService.gabung(tx, { targetId: t.rangkaianId, sumberId: s.rangkaianId, alasan: 'Alasan cukup panjang' }, actor)))
            .rejects.toMatchObject({ statusCode: 409 });
        await expect(inTx((tx) => rangkaianService.gabung(tx, { targetId: s.rangkaianId, sumberId: t.rangkaianId, alasan: 'Alasan cukup panjang' }, actor)))
            .rejects.toMatchObject({ statusCode: 409 });
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/rangkaian.service.integration.test.ts -t "gabung"`
Expected: FAIL — `rangkaianService.gabung is not a function`.

- [ ] **Step 3: Implementasi**

Ubah impor skema dan error di `rangkaian.service.ts`:

```ts
import {
    rangkaianAnggota,
    rangkaianSurat,
    suratDistributions,
    suratKeluar,
    suratMasuk,
    type RangkaianAsal,
    type RangkaianStatus,
    type SumberAnggota,
} from '../db/schema';
```

```ts
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';
```

Tambahkan sebelum `export const rangkaianService`:

```ts
export interface GabungInput { targetId: string; sumberId: string; alasan: string }
export interface GabungResult {
    targetId: string;
    sumberId: string;
    anggotaDipindah: number;
    distribusiDipindah: number;
    unitAksesBaru: string[];
    targetStatus: RangkaianStatus;
}
```

Tambahkan method di objek `rangkaianService` (setelah `recomputeSuratMasukStatus`):

```ts
    async gabung(tx: DbTransaction, input: GabungInput, actor: RangkaianActor): Promise<GabungResult> {
        const alasan = input.alasan?.trim() ?? '';
        if (alasan.length < 10) throw new ValidationError('Alasan penggabungan minimal 10 karakter');
        if (input.targetId === input.sumberId) {
            throw new ValidationError('Rangkaian sumber dan tujuan harus berbeda');
        }
        const locked = await lockRangkaian(tx, [input.targetId, input.sumberId]);
        const target = locked.find((row) => row.id === input.targetId);
        const sumber = locked.find((row) => row.id === input.sumberId);
        if (!target || !sumber) throw new NotFoundError('Rangkaian surat');
        for (const row of [target, sumber]) {
            if (!isRangkaianTerbuka(row.status)) {
                throw new ConflictError(`Rangkaian ${row.kode} berstatus ${row.status} dan tidak dapat digabung`);
            }
        }

        const aksesSebelum = new Set(await rangkaianService.jangkauanUnitIds(tx, target.id));
        const anggota = await tx.update(rangkaianAnggota)
            .set({
                rangkaianId: target.id,
                peran: 'anggota',
                sumber: sql<SumberAnggota>`CASE WHEN ${rangkaianAnggota.sumber} = 'data_lama' THEN 'data_lama' ELSE 'gabung' END`,
            })
            .where(eq(rangkaianAnggota.rangkaianId, sumber.id))
            .returning({ id: rangkaianAnggota.id });
        const distribusi = await tx.update(suratDistributions)
            .set({ rangkaianId: target.id, updatedAt: new Date() })
            .where(eq(suratDistributions.rangkaianId, sumber.id))
            .returning({ id: suratDistributions.id });
        await tx.execute(sql`
            UPDATE rangkaian_peserta p SET rangkaian_id = ${target.id}
            WHERE p.rangkaian_id = ${sumber.id}
              AND p.berakhir_at IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM rangkaian_peserta t
                  WHERE t.rangkaian_id = ${target.id}
                    AND t.unit_kerja_id = p.unit_kerja_id
                    AND t.peran = p.peran
                    AND t.berakhir_at IS NULL
              )
        `);
        await tx.update(rangkaianSurat)
            .set({ status: 'digabung', digabungKeId: target.id, updatedAt: new Date() })
            .where(eq(rangkaianSurat.id, sumber.id));

        const unitAksesBaru = (await rangkaianService.jangkauanUnitIds(tx, target.id))
            .filter((unit) => !aksesSebelum.has(unit));
        await catatAudit(tx, actor, {
            action: 'merge',
            entityType: 'rangkaian_surat',
            entityId: sumber.id,
            changes: {
                before: { status: sumber.status },
                after: { status: 'digabung', digabungKeId: target.id },
                alasan,
                targetKode: target.kode,
                anggotaDipindah: anggota.length,
                distribusiDipindah: distribusi.length,
                unitAksesBaru,
            },
        });
        const [statusTarget] = await rangkaianService.recomputeStatus(tx, [target.id], actor);
        return {
            targetId: target.id,
            sumberId: sumber.id,
            anggotaDipindah: anggota.length,
            distribusiDipindah: distribusi.length,
            unitAksesBaru,
            targetStatus: statusTarget?.after ?? target.status,
        };
    },
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/rangkaian.service.integration.test.ts && npx tsc --noEmit`
Expected: PASS (13 test).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/rangkaian.service.ts backend/src/__tests__/rangkaian.service.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(rangkaian): gabung rangkaian dengan pemindahan disposisi dan delta akses

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: `rangkaianService.attach`

**Files:**
- Modify: `backend/src/services/rangkaian.service.ts` (impor `rangkaianRelasi`, `hasPostgresErrorCode`; tipe `AttachInput`/`AttachResult`; helper `bukaKembaliOtomatis`; method `attach`)
- Test: `backend/src/__tests__/rangkaian.service.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface AttachInput { rangkaianId: string; surat: SuratRef; keAnggotaId: string; jenisRelasi: JenisRelasi; keterangan?: string | null; sumber?: 'aplikasi' | 'tautan' }
  export interface AttachResult { rangkaianId: string; anggotaId: string; relasiId: string; anggotaBaru: boolean; digabungDari: string | null; reopened: boolean }
  rangkaianService.attach(tx: DbTransaction, input: AttachInput, actor: RangkaianActor): Promise<AttachResult>
  ```
- Semantik: primitif keanggotaan + relasi **tanpa** pemeriksaan wewenang (P3 `attachTindakLanjut`/route tautan membungkusnya dengan `checkRead` + aturan pemilik/target/pengawas). Kunci surat → rangkaian. Surat yang menjadi induk rangkaian 1-anggota `aktif|selesai` lain diproses sebagai `gabung` (sumber → `digabung`); anggota rangkaian lain yang lebih besar → 409. Rangkaian tujuan harus `aktif|selesai` (409). `keAnggotaId` harus anggota rangkaian tujuan (400). Relasi aktif ganda → 409 (`rangkaian_relasi_active_uidx`, dipetakan lewat `hasPostgresErrorCode`). Anggota baru pada rangkaian `selesai` membuka kembali ke `aktif` (audit `status_change`). Audit `link/rangkaian_relasi`. Tidak meng-UPDATE baris surat (aman untuk surat terarsip/0021).

- [ ] **Step 1: Tulis test yang gagal**

```ts
describe('rangkaianService.attach', () => {
    it('menautkan tindak lanjut, membuka kembali rangkaian selesai, dan menolak relasi ganda', async () => {
        const sm = await suratMasuk('sesditjen');
        const r = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor, { unitPengolahId: 'dir_bppt' }));
        await disposisi(sm, 'dir_bppt', 'processed', r.rangkaianId);
        await inTx((tx) => rangkaianService.recomputeStatus(tx, [r.rangkaianId], actor));
        const nd = await suratKeluar('dir_bppt', 'draft');

        const result = await inTx((tx) => rangkaianService.attach(tx, {
            rangkaianId: r.rangkaianId, surat: { jenis: 'surat_keluar', id: nd },
            keAnggotaId: r.anggotaId, jenisRelasi: 'tindak_lanjut', keterangan: '  ND tindak lanjut  ',
        }, actor));
        expect(result).toMatchObject({ rangkaianId: r.rangkaianId, anggotaBaru: true, digabungDari: null, reopened: true });
        expect((await rangkaianRow(r.rangkaianId)).status).toBe('aktif');
        const rel = await database.query(`SELECT jenis_relasi, keterangan, created_by FROM rangkaian_relasi WHERE id = $1`, [result.relasiId]);
        expect(rel.rows).toEqual([{ jenis_relasi: 'tindak_lanjut', keterangan: 'ND tindak lanjut', created_by: actorId }]);
        expect(await auditRows(result.relasiId)).toEqual([{ action: 'link', entity_type: 'rangkaian_relasi' }]);

        await expect(inTx((tx) => rangkaianService.attach(tx, {
            rangkaianId: r.rangkaianId, surat: { jenis: 'surat_keluar', id: nd },
            keAnggotaId: r.anggotaId, jenisRelasi: 'tindak_lanjut',
        }, actor))).rejects.toMatchObject({ statusCode: 409 });

        const lain = await inTx(async (tx) => rangkaianService.ensureForSuratMasuk(tx, await suratMasuk('sesditjen'), actor));
        await expect(inTx(async (tx) => rangkaianService.attach(tx, {
            rangkaianId: r.rangkaianId, surat: { jenis: 'surat_keluar', id: await suratKeluar('dir_bppt') },
            keAnggotaId: lain.anggotaId, jenisRelasi: 'merujuk',
        }, actor))).rejects.toMatchObject({ statusCode: 400 });
    });

    it('memproses induk rangkaian 1-anggota sebagai gabung dan menolak anggota rangkaian besar', async () => {
        const sk = await suratKeluar('dir_bppt', 'approved');
        const tunggal = await inTx((tx) => rangkaianService.ensureForSurat(tx, { jenis: 'surat_keluar', id: sk }, actor));
        const sm = await suratMasuk('sesditjen');
        const tujuan = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor));

        const result = await inTx((tx) => rangkaianService.attach(tx, {
            rangkaianId: tujuan.rangkaianId, surat: { jenis: 'surat_keluar', id: sk },
            keAnggotaId: tujuan.anggotaId, jenisRelasi: 'merujuk', sumber: 'tautan',
        }, actor));
        expect(result).toMatchObject({ digabungDari: tunggal.rangkaianId, anggotaBaru: false, anggotaId: tunggal.anggotaId });
        expect(await rangkaianRow(tunggal.rangkaianId)).toMatchObject({ status: 'digabung', digabung_ke_id: tujuan.rangkaianId });

        const besar = await inTx(async (tx) => rangkaianService.ensureForSuratMasuk(tx, await suratMasuk('sesditjen'), actor));
        await expect(inTx((tx) => rangkaianService.attach(tx, {
            rangkaianId: besar.rangkaianId, surat: { jenis: 'surat_keluar', id: sk },
            keAnggotaId: besar.anggotaId, jenisRelasi: 'merujuk',
        }, actor))).rejects.toMatchObject({ statusCode: 409 });
    });

    it('menautkan surat keluar terarsip tanpa memicu guard 0021 dan menolak rangkaian diberkaskan', async () => {
        const sm = await suratMasuk('sesditjen');
        const r = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor));
        const nd = await suratKeluar('dir_bppt', 'approved');
        await arsipkan('keluar', nd);
        await inTx((tx) => rangkaianService.attach(tx, {
            rangkaianId: r.rangkaianId, surat: { jenis: 'surat_keluar', id: nd },
            keAnggotaId: r.anggotaId, jenisRelasi: 'balasan',
        }, actor));
        expect((await inTx((tx) => rangkaianService.recomputeSuratMasukStatus(tx, [sm], actor)))[0].after).toBe('sudah_dibalas');

        await berkaskan(r.rangkaianId);
        await expect(inTx(async (tx) => rangkaianService.attach(tx, {
            rangkaianId: r.rangkaianId, surat: { jenis: 'surat_keluar', id: await suratKeluar('dir_bppt') },
            keAnggotaId: r.anggotaId, jenisRelasi: 'merujuk',
        }, actor))).rejects.toMatchObject({ statusCode: 409 });
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/rangkaian.service.integration.test.ts -t "attach"`
Expected: FAIL — `rangkaianService.attach is not a function`.

- [ ] **Step 3: Implementasi**

Tambahkan `rangkaianRelasi` ke impor skema dan `type JenisRelasi`:

```ts
import {
    rangkaianAnggota,
    rangkaianRelasi,
    rangkaianSurat,
    suratDistributions,
    suratKeluar,
    suratMasuk,
    type JenisRelasi,
    type RangkaianAsal,
    type RangkaianStatus,
    type SumberAnggota,
} from '../db/schema';
```

Tambahkan impor:

```ts
import { hasPostgresErrorCode } from '../utils/postgres-errors.js';
```

Tambahkan sebelum `export const rangkaianService`:

```ts
export interface AttachInput {
    rangkaianId: string;
    surat: SuratRef;
    keAnggotaId: string;
    jenisRelasi: JenisRelasi;
    keterangan?: string | null;
    sumber?: 'aplikasi' | 'tautan';
}
export interface AttachResult {
    rangkaianId: string;
    anggotaId: string;
    relasiId: string;
    anggotaBaru: boolean;
    digabungDari: string | null;
    reopened: boolean;
}

async function bukaKembaliOtomatis(
    tx: DbTransaction,
    rangkaian: RangkaianTerkunci,
    actor: RangkaianActor,
    alasan: string,
): Promise<void> {
    await tx.update(rangkaianSurat)
        .set({
            status: 'aktif', selesaiAt: null, selesaiBy: null,
            catatanSelesai: null, selesaiManual: false, updatedAt: new Date(),
        })
        .where(eq(rangkaianSurat.id, rangkaian.id));
    await catatAudit(tx, actor, {
        action: 'status_change',
        entityType: 'rangkaian_surat',
        entityId: rangkaian.id,
        changes: { before: { status: rangkaian.status }, after: { status: 'aktif' }, otomatis: true, alasan },
    });
}
```

Tambahkan method di objek `rangkaianService` (setelah `gabung`):

```ts
    async attach(tx: DbTransaction, input: AttachInput, actor: RangkaianActor): Promise<AttachResult> {
        const surat = await lockSurat(tx, input.surat);
        let member = await findMembership(tx, input.surat);
        let digabungDari: string | null = null;

        if (member && member.rangkaianId !== input.rangkaianId) {
            const [{ jumlah }] = await tx.select({ jumlah: sql<number>`count(*)::int` })
                .from(rangkaianAnggota)
                .where(eq(rangkaianAnggota.rangkaianId, member.rangkaianId));
            if (member.peran !== 'induk' || jumlah !== 1 || !isRangkaianTerbuka(member.status)) {
                throw new ConflictError('Surat sudah menjadi anggota rangkaian lain; gunakan Gabungkan Rangkaian');
            }
            const [tujuan] = await tx.select({ kode: rangkaianSurat.kode })
                .from(rangkaianSurat).where(eq(rangkaianSurat.id, input.rangkaianId)).limit(1);
            if (!tujuan) throw new NotFoundError('Rangkaian surat');
            // Tautan induk rangkaian 1-anggota = gabung (tidak menyisakan rangkaian kosong aktif).
            await rangkaianService.gabung(tx, {
                targetId: input.rangkaianId,
                sumberId: member.rangkaianId,
                alasan: `Tautan surat tunggal ${member.kode} ke rangkaian ${tujuan.kode}`,
            }, actor);
            digabungDari = member.rangkaianId;
            member = await findMembership(tx, input.surat);
        }

        const [rangkaian] = await lockRangkaian(tx, [input.rangkaianId]);
        if (!rangkaian) throw new NotFoundError('Rangkaian surat');
        if (!isRangkaianTerbuka(rangkaian.status)) {
            throw new ConflictError(`Rangkaian ${rangkaian.kode} berstatus ${rangkaian.status}; anggota baru tidak dapat ditambahkan`);
        }
        const [ke] = await tx.select({ id: rangkaianAnggota.id })
            .from(rangkaianAnggota)
            .where(and(eq(rangkaianAnggota.id, input.keAnggotaId), eq(rangkaianAnggota.rangkaianId, rangkaian.id)))
            .limit(1);
        if (!ke) throw new ValidationError('Surat rujukan bukan anggota rangkaian ini');

        let anggotaId = member?.anggotaId;
        let anggotaBaru = false;
        if (!anggotaId) {
            const [inserted] = await tx.insert(rangkaianAnggota).values({
                rangkaianId: rangkaian.id,
                suratMasukId: input.surat.jenis === 'surat_masuk' ? input.surat.id : null,
                suratKeluarId: input.surat.jenis === 'surat_keluar' ? input.surat.id : null,
                unitKerjaId: surat.unitKerjaId,
                peran: 'anggota',
                sumber: input.sumber ?? 'aplikasi',
                ditambahkanBy: actor.userId,
            }).returning({ id: rangkaianAnggota.id });
            anggotaId = inserted.id;
            anggotaBaru = true;
        }
        if (anggotaId === ke.id) throw new ValidationError('Surat tidak dapat merujuk dirinya sendiri');

        let relasiId: string;
        try {
            const [created] = await tx.insert(rangkaianRelasi).values({
                rangkaianId: rangkaian.id,
                dariAnggotaId: anggotaId,
                keAnggotaId: ke.id,
                jenisRelasi: input.jenisRelasi,
                keterangan: input.keterangan?.trim() || null,
                createdBy: actor.userId,
            }).returning({ id: rangkaianRelasi.id });
            relasiId = created.id;
        } catch (error) {
            if (hasPostgresErrorCode(error, '23505', 'rangkaian_relasi_active_uidx')) {
                throw new ConflictError('Relasi yang sama sudah tercatat di rangkaian ini');
            }
            throw error;
        }

        const reopened = anggotaBaru && rangkaian.status === 'selesai';
        if (reopened) await bukaKembaliOtomatis(tx, rangkaian, actor, 'Anggota baru ditambahkan ke rangkaian');

        await catatAudit(tx, actor, {
            action: 'link',
            entityType: 'rangkaian_relasi',
            entityId: relasiId,
            changes: {
                after: {
                    rangkaianId: rangkaian.id, dariAnggotaId: anggotaId, keAnggotaId: ke.id,
                    jenisRelasi: input.jenisRelasi, surat: input.surat, anggotaBaru, digabungDari,
                },
            },
        });
        return { rangkaianId: rangkaian.id, anggotaId, relasiId, anggotaBaru, digabungDari, reopened };
    },
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/rangkaian.service.integration.test.ts && npx tsc --noEmit`
Expected: PASS (16 test).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/rangkaian.service.ts backend/src/__tests__/rangkaian.service.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(rangkaian): attach anggota dan relasi dengan tautan 1-anggota sebagai gabung

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: `distribute(data, auditContext?, tx?)`

**Files:**
- Modify: `backend/src/services/distribution.service.ts:1-6` (impor) dan `:31-102` (`distribute`)
- Modify: `backend/src/__tests__/distribution.service.test.ts:11-19` (Proxy mendukung reject) dan tambah test setelah baris 105
- Test: `backend/src/__tests__/rangkaian.service.integration.test.ts` (describe baru)

**Interfaces:**
- Consumes: `DbTransaction`, `rangkaianSurat`, `hasPostgresErrorCode`, `ConflictError`.
- Produces:
  ```ts
  export interface DistributeInput {
      suratMasukId: string; sourceUnitId: string; targetUnitId: string;
      instruction?: string | null; ccUnits?: string[]; sentBy?: string;
      rangkaianId?: string | null; batasWaktu?: string | null /* 'YYYY-MM-DD' */; penanggungJawab?: boolean;
  }
  DistributionService.distribute(data: DistributeInput, auditContext?: CriticalAuditContext, tx?: DbTransaction): Promise<SuratDistribution>
  ```
- Semantik: tanpa `tx` membuka `db.transaction` sendiri (perilaku lama, route `distribution.routes.ts:206` tidak berubah); dengan `tx` memakai transaksi pemanggil dan audit ditulis ke `tx`. Bila `rangkaianId` diberikan: kunci `rangkaian_surat FOR UPDATE` (urutan surat → rangkaian → distribusi), 409 bila `diberkaskan|digabung`, 400 bila tidak ada. Menulis `rangkaian_id`, `batas_waktu`, `penanggung_jawab`. Pelanggaran `surat_distributions_active_target_uidx` (race) → 400 "Surat sudah didistribusikan ke unit ini". Audit tetap `entityType: 'surat_distribution'`. Cek duplikat yang mengabaikan `rejected`, validasi `can_receive_distribution`, aturan surat terkendali, dan pemanggilan `ensureForSuratMasuk` di semua jalur tetap **P3**.

- [ ] **Step 1: Tulis test yang gagal**

`distribution.service.test.ts` — ganti blok Proxy baris 11–19:

```ts
const mockChain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') {
            const val = resultQueue.shift() ?? [];
            return (resolve: any, reject: any) => (val instanceof Error ? reject(val) : resolve(val));
        }
        return (..._args: any[]) => mockChain;
    },
});
```

Tambahkan setelah test `should fail closed when the source unit does not own the letter` (setelah baris 105):

```ts
        it('reuses the caller transaction and audits inside it', async () => {
            enqueue([{ id: 'sm-1' }], [], [{ id: 'dist-1', status: 'sent' }]);
            const outerTx = { ...mockDb, transaction: vi.fn() };
            const res = await svc.distribute({
                suratMasukId: 'sm-1',
                sourceUnitId: 'sesditjen',
                targetUnitId: 'dir_bppt',
            }, { userId: 'user-1' }, outerTx as any);
            expect(res.id).toBe('dist-1');
            expect(outerTx.transaction).not.toHaveBeenCalled();
            expect(transactionCommits).toBe(0);
            expect(auditMocks.logActionOrThrow).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'distribute', entityType: 'surat_distribution' }),
                outerTx,
            );
        });

        it('rejects a distribution into a closed rangkaian with 409', async () => {
            enqueue([{ id: 'sm-1' }], [{ id: 'rs-1', status: 'diberkaskan' }]);
            await expect(svc.distribute({
                suratMasukId: 'sm-1',
                sourceUnitId: 'sesditjen',
                targetUnitId: 'dir_bppt',
                rangkaianId: 'rs-1',
            })).rejects.toMatchObject({ statusCode: 409 });
            expect(transactionRollbacks).toBe(1);
        });

        it('maps a Drizzle-wrapped active-target unique violation to the duplicate message', async () => {
            const pgError = Object.assign(new Error('duplicate key value violates unique constraint'), {
                code: '23505',
                constraint: 'surat_distributions_active_target_uidx',
            });
            enqueue([{ id: 'sm-1' }], [], Object.assign(new Error('Failed query: insert into "surat_distributions"'), { cause: pgError }));
            await expect(svc.distribute({
                suratMasukId: 'sm-1',
                sourceUnitId: 'sesditjen',
                targetUnitId: 'dir_bppt',
            })).rejects.toMatchObject({ statusCode: 400, message: 'Surat sudah didistribusikan ke unit ini' });
        });
```

`rangkaian.service.integration.test.ts` — tambahkan di akhir:

```ts
describe('distributionService.distribute dalam transaksi rangkaian', () => {
    it('menulis disposisi berangkaian bersama ensureForSuratMasuk dalam satu transaksi', async () => {
        const { distributionService } = await import('../services/distribution.service');
        const sm = await suratMasuk('sesditjen');
        const { r, d } = await inTx(async (tx) => {
            const r = await rangkaianService.ensureForSuratMasuk(tx, sm, actor, { unitPengolahId: 'dir_bppt' });
            const d = await distributionService.distribute({
                suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt',
                rangkaianId: r.rangkaianId, batasWaktu: '2026-10-01', penanggungJawab: true, sentBy: actorId,
            }, actor, tx);
            return { r, d };
        });
        const row = await database.query(
            `SELECT rangkaian_id, batas_waktu::text AS batas_waktu, penanggung_jawab, status FROM surat_distributions WHERE id = $1`,
            [d.id]);
        expect(row.rows).toEqual([{ rangkaian_id: r.rangkaianId, batas_waktu: '2026-10-01', penanggung_jawab: true, status: 'sent' }]);
        expect(await auditRows(d.id)).toEqual([{ action: 'distribute', entity_type: 'surat_distribution' }]);
    });

    it('membatalkan ensure + distribusi bersama bila transaksi pemanggil gagal', async () => {
        const { distributionService } = await import('../services/distribution.service');
        const sm = await suratMasuk('sesditjen');
        await expect(inTx(async (tx) => {
            const r = await rangkaianService.ensureForSuratMasuk(tx, sm, actor);
            await distributionService.distribute({
                suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ptep', rangkaianId: r.rangkaianId,
            }, actor, tx);
            throw new Error('langkah berikutnya gagal');
        })).rejects.toThrow('langkah berikutnya gagal');
        const left = await database.query(
            `SELECT (SELECT count(*)::int FROM surat_distributions WHERE surat_masuk_id = $1) AS d,
                    (SELECT count(*)::int FROM rangkaian_anggota WHERE surat_masuk_id = $1) AS a`, [sm]);
        expect(left.rows).toEqual([{ d: 0, a: 0 }]);
    });

    it('menolak disposisi atas berkas tertutup: 409 dari layanan, trigger untuk jalur lama tanpa rangkaian_id', async () => {
        const { distributionService } = await import('../services/distribution.service');
        const sm = await suratMasuk('sesditjen');
        const { rangkaianId } = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor));
        await berkaskan(rangkaianId);
        await expect(distributionService.distribute({
            suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ptep', rangkaianId,
        }, actor)).rejects.toMatchObject({ statusCode: 409 });
        await rejectsWith(distributionService.distribute({
            suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ptep',
        }, actor), /sudah diberkaskan/);
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && npx vitest run src/__tests__/distribution.service.test.ts src/__tests__/rangkaian.service.integration.test.ts -t "transaction|transaksi|closed rangkaian|Drizzle-wrapped"`
Expected: FAIL — `outerTx.transaction` tidak dipanggil tetapi `transactionCommits` = 1 (distribute masih membuka transaksi sendiri), test 409 resolve, dan test integrasi gagal karena `rangkaian_id` NULL.

- [ ] **Step 3: Implementasi**

`distribution.service.ts` — ganti baris 1–6:

```ts
import { db } from '../config/database';
import { suratDistributions, NewSuratDistribution, SuratDistribution, suratMasuk, unitKerja, users, rangkaianSurat } from '../db/schema';
import { eq, and, desc, sql, or, notInArray, inArray } from 'drizzle-orm';
import { NO_RECORD_UNIT_ACCESS, type RecordUnitScope } from '../utils/record-unit-scope';
import auditLogService, { type CriticalAuditContext } from './audit-log.service.js';
import { AppError, ConflictError, ValidationError } from '../utils/errors.js';
import { hasPostgresErrorCode } from '../utils/postgres-errors.js';
import type { DbTransaction } from '../db/transaction';

export interface DistributeInput {
    suratMasukId: string;
    sourceUnitId: string;
    targetUnitId: string;
    instruction?: string | null;
    ccUnits?: string[];
    sentBy?: string;
    /** Wajib diisi semua jalur mulai P3 (lewat rangkaianService.ensureForSuratMasuk). */
    rangkaianId?: string | null;
    /** Tanggal 'YYYY-MM-DD'. */
    batasWaktu?: string | null;
    penanggungJawab?: boolean;
}
```

Ganti seluruh method `distribute` (baris 31–102) dengan:

```ts
    async distribute(
        data: DistributeInput,
        auditContext?: CriticalAuditContext,
        tx?: DbTransaction,
    ): Promise<SuratDistribution> {
        if (tx) return this.distributeInTransaction(tx, data, auditContext);
        return db.transaction((ownTx) => this.distributeInTransaction(ownTx, data, auditContext));
    }

    private async distributeInTransaction(
        tx: DbTransaction,
        data: DistributeInput,
        auditContext?: CriticalAuditContext,
    ): Promise<SuratDistribution> {
        // The source unit supplied by the client must own the source letter. This
        // prevents an authorised unit from distributing another unit's letter by ID.
        const [sourceSurat] = await tx
            .select({ id: suratMasuk.id })
            .from(suratMasuk)
            .where(and(
                eq(suratMasuk.id, data.suratMasukId),
                eq(suratMasuk.unitKerjaId, data.sourceUnitId),
            ))
            .limit(1);
        if (!sourceSurat) {
            throw new AppError('Data not found', 404);
        }

        if (data.rangkaianId) {
            // Urutan kunci: surat -> rangkaian -> distribusi (trigger 0046 hanya FOR SHARE).
            const [rangkaian] = await tx
                .select({ id: rangkaianSurat.id, status: rangkaianSurat.status })
                .from(rangkaianSurat)
                .where(eq(rangkaianSurat.id, data.rangkaianId))
                .for('update');
            if (!rangkaian) throw new ValidationError('Rangkaian surat tidak ditemukan');
            if (rangkaian.status === 'diberkaskan' || rangkaian.status === 'digabung') {
                throw new ConflictError('Rangkaian surat sudah ditutup; disposisi baru tidak dapat ditambahkan');
            }
        }

        // Check if already distributed to this target
        const [existing] = await tx
            .select()
            .from(suratDistributions)
            .where(and(
                eq(suratDistributions.suratMasukId, data.suratMasukId),
                eq(suratDistributions.targetUnitId, data.targetUnitId)
            ))
            .limit(1);

        if (existing) {
            throw new ValidationError('Surat sudah didistribusikan ke unit ini');
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
                    rangkaianId: data.rangkaianId ?? null,
                    batasWaktu: data.batasWaktu ?? null,
                    penanggungJawab: data.penanggungJawab ?? false,
                })
                .returning();
        } catch (error) {
            // Race dengan index parsial 0046; Drizzle membungkus error pg di `.cause`.
            if (hasPostgresErrorCode(error, '23505', 'surat_distributions_active_target_uidx')) {
                throw new ValidationError('Surat sudah didistribusikan ke unit ini');
            }
            throw error;
        }

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
                        rangkaianId: data.rangkaianId ?? null,
                        batasWaktu: data.batasWaktu ?? null,
                        penanggungJawab: data.penanggungJawab ?? false,
                    },
                },
            }, tx);
        }

        return result;
    }
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `cd backend && npx vitest run src/__tests__/distribution.service.test.ts src/__tests__/distribution-layanan.routes.test.ts src/__tests__/mutation-audit-policy.test.ts src/__tests__/rangkaian.service.integration.test.ts && npx tsc --noEmit`
Expected: PASS semua (test lama distribusi tetap hijau; `mutation-audit-policy` tetap menemukan `db.transaction` dan `logActionOrThrow`).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/distribution.service.ts backend/src/__tests__/distribution.service.test.ts backend/src/__tests__/rangkaian.service.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(distribusi): distribute menerima transaksi pemanggil dan kolom rangkaian

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Runbook deploy P1

**Files:**
- Create: `docs/RUNBOOK_INTEGRASI_SURAT_P1.md`
- Test: pemeriksaan manual isi + `git diff --check`

**Interfaces:**
- Produces: urutan deploy yang mengikat P1–P3: **migrate → konvergensi grant (segera) → backfill langkah 1 (slot; skrip dibuat di P3) → deploy kode**, beserta preflight, verifikasi, dan rollback.

- [ ] **Step 1: Tulis runbook**

````markdown
# Runbook Deploy Integrasi Surat — P1 (Skema 0046–0047)

Berlaku untuk rilis yang memuat migrasi `0046_rangkaian_surat` dan `0047_unit_kerja_direktorat`. Produksi memakai Vercel + Neon; jalur Cloud SQL/psql dicantumkan untuk lingkungan lain.

## Urutan wajib

1. **Backup** Neon dengan helper versi yang sedang berjalan di produksi (sebelum checkout rilis ini), sesuai `docs/BACKUP_NEON.md`.
2. **Preflight read-only** (akun runtime/operator, tanpa menulis):

   ```sql
   SELECT status, count(*) FROM surat_distributions
   WHERE status NOT IN ('sent','received','processed','rejected') GROUP BY status;
   SELECT surat_masuk_id, target_unit_id, count(*) FROM surat_distributions
   WHERE status <> 'rejected' GROUP BY 1, 2 HAVING count(*) > 1;
   SELECT id FROM unit_kerja WHERE id ~ '^direktorat-';
   SELECT id, parent_id, unit_type FROM unit_kerja WHERE id IN ('ditjen','sesditjen','dir_bppt','dir_ptep','dir_ktpp','dir_plp');
   ```

   Ketiga kueri pertama harus kosong. Bila tidak, **hentikan**: rekonsiliasi dengan pemilik data (ubah status/tolak baris ganda dengan alasan tertulis) lalu ulangi. Migrasi 0046/0047 menolak (RAISE) data ini dan tidak mengubahnya.
3. **Migrasi + konvergensi grant (satu perintah di Neon):**

   ```powershell
   & $cloudNode "--env-file=$cloudEnv" scripts/neon-database.mjs migrate --apply
   & $cloudNode "--env-file=$cloudEnv" scripts/neon-database.mjs verify-runtime
   ```

   Adapter Neon menjalankan migrasi dalam satu transaksi lalu langsung menerapkan `grants/0002` (hash tersemat di `scripts/neon-database-policy.mjs`). Jalur Cloud SQL/psql: `npm --prefix backend run db:migrate`, lalu **segera** `EXPECTED_MIGRATIONS_JSON="$(python3 .github/scripts/build-migration-manifest.py)" npm --prefix backend run db:grants:converge`.
4. **Verifikasi hak dan skema** (akun runtime):

   ```sql
   SELECT has_table_privilege(current_user, 'public.rangkaian_surat', 'DELETE') AS boleh_hapus,      -- false
          has_table_privilege(current_user, 'public.rangkaian_surat', 'INSERT') AS boleh_tambah;     -- true
   SELECT id, is_unit_pengawas FROM unit_kerja WHERE id IN ('ditjen','sesditjen');                 -- keduanya true
   SELECT count(*) FROM unit_kerja WHERE id IN ('dir_bppt','dir_ptep','dir_ktpp','dir_plp');       -- 4
   ```

5. **Backfill langkah 1** (`backend/scripts/backfill-rangkaian-disposisi.mjs`): **belum ada di P1**. Kode P1 tidak mewajibkan `rangkaian_id`, sehingga langkah ini dilewati pada rilis P1 dan wajib dijalankan pada rilis P3 **sebelum** kode P3 aktif, dengan kriteria keluar `SELECT count(*) FROM surat_distributions WHERE rangkaian_id IS NULL` = 0.
6. **Deploy kode** backend. `/ready` menolak (503) bila skema 0046 belum lengkap karena `DATABASE_SCHEMA_READINESS_SQL` kini mensyaratkan kolom, constraint, dan trigger rangkaian.

## Catatan

- Seed `seed:deployment` yang dijalankan sesudah migrasi pada instalasi baru tetap menghasilkan `ditjen`/`sesditjen` sebagai pengawas melalui trigger `unit_kerja_default_pengawas`.
- Nama resmi unit `dir_*` dikoreksi lewat `PUT /api/settings/unit-kerja/:id` (super_admin). `parent_id`/`unit_type` hanya diatur 0047.
- Jangan jalankan helper backup/migrator versi 45 terhadap database 47.

## Rollback

Pemulihan yang disarankan adalah **deploy ulang versi aplikasi sebelumnya dengan skema 47 tetap terpasang**. Aplikasi lama kompatibel: kolom baru nullable/berdefault, index parsial lebih longgar daripada cek duplikat lama, dan tabel `rangkaian_*` tidak dipakai. Jangan menghapus tabel atau membalik migrasi secara manual; bila skema harus dibatalkan, pulihkan dari backup langkah 1.
````

- [ ] **Step 2: Verifikasi**

Run: `git add -N docs/RUNBOOK_INTEGRASI_SURAT_P1.md && git diff --check -- docs/RUNBOOK_INTEGRASI_SURAT_P1.md`
Expected: tanpa output (tidak ada trailing whitespace/konflik).

- [ ] **Step 3: Commit**

```bash
git add docs/RUNBOOK_INTEGRASI_SURAT_P1.md
git commit -m "$(cat <<'EOF'
docs: runbook deploy integrasi surat P1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Verifikasi menyeluruh

**Files:** tidak ada perubahan (kecuali perbaikan bila ada regresi).

**Interfaces:** —

- [ ] **Step 1: Suite backend lengkap**

Run: `cd backend && npx vitest run`
Expected: PASS seluruhnya. Perhatikan khusus: `migration-chain.integration.test.ts`, `migration-runner.test.ts`, `bulk-upload.service.integration.test.ts`, `retention-governance.migration.test.ts`, `regulatory-governance.migration.test.ts` (menjalankan rantai penuh; `dir_*` kini sudah ada setelah 0047), `deployment-regulatory-evidence.test.ts`, `database-role-policy.test.ts`, `distribution*.test.ts`, `tunjuk-silang.routes.test.ts`, test outbox SRIKANDI.

- [ ] **Step 2: Typecheck dan build**

Run: `cd backend && npx tsc --noEmit && npm run build`
Expected: tanpa error.

- [ ] **Step 3: Test root (manifest migrasi, Neon, backup)**

Run (root): `npm run test:migration-manifest && npm run test:cloud-metadata && npm run test:neon-backup`
Expected: PASS.

- [ ] **Step 4: Postgres nyata (CI atau lokal)**

Run: `cd backend && TEST_POSTGRES_URL=<url-db-uji-terisolasi> npm run test:postgres-locks`
Expected: PASS. Bila tidak ada Postgres lokal, pastikan job CI `postgres` dan profil `test-backup-upgrade-profile.mjs` hijau pada PR sebelum merge.

- [ ] **Step 5: Commit perbaikan (hanya bila ada)**

```bash
git status --short
git add -u
git commit -m "$(cat <<'EOF'
fix(rangkaian): perbaiki regresi verifikasi P1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

(Lewati step ini bila `git status --short` kosong.)

---

## Self-review terhadap spesifikasi

| Butir spesifikasi (§3, §10 P1, §11) | Task |
|---|---|
| 0046: precheck status tak dikenal & distribusi aktif ganda (RAISE) | 1 |
| Tabel `rangkaian_surat`, `rangkaian_anggota`, `rangkaian_relasi`, `rangkaian_peserta`, `rangkaian_koreksi_berkas`, `disposisi_label_unit`, sequence kode | 1 |
| `surat_distributions` + `rangkaian_id`, `batas_waktu`, `penanggung_jawab`, `processed_by`, `penyelesaian_surat_keluar_id`, `catatan_penyelesaian`, `ditutup_pengawas`; status CHECK; index aktif/target/rangkaian | 1 |
| `surat_keluar.asal_naskah` + UPDATE `tindak_lanjut`; `idx_surat_keluar_balasan`; index ekspresi nomor | 1 |
| D5 `unit_kerja.is_unit_pengawas` (dipilih di **0046**) + UPDATE idempoten | 1 |
| Trigger penutupan atas anggota, relasi, **dan** `surat_distributions` | 2 |
| Trigger status: `diberkaskan` terminal, koreksi via GUC + baris `approved`, anti-siklus `digabung_ke_id` | 2 |
| 0047: fail-closed `direktorat-*`, insert `dir_*`, isi `parent_id`/`unit_type` bila NULL, tanpa `bagian_*` (D6), seed deployment tidak diubah | 3 |
| Journal idx 46 `when` 1789397417667, idx 47 `when` 1789397418667 | 1, 3 |
| Drizzle `schema/rangkaian-surat.ts` + kolom di `surat-distribution.ts`/`surat-keluar.ts`; tanpa drizzle-kit | 4 |
| `REVOKE DELETE ... FROM simsa_api_runtime` di 0002 | 5 (plus di 0046 sendiri) |
| Runbook migrate → converge → backfill 1 → kode | 14 |
| `rangkaianService` inti: ensure/attach/recompute/gabung | 9–12 |
| `distribute(data, auditContext?, tx?)`, audit tetap `surat_distribution` | 13 |
| Test: rantai PGlite 0000–0047 + fixture perihal NULL | 1, 9 |
| CHECK menolak pembatalan/berakhir/selesai manual dengan alasan NULL | 1 |
| Trigger 0021 tidak terpicu saat menautkan surat terarsip | 1 (UPDATE `asal_naskah`), 2, 10, 12 |
| Trigger penutupan menolak insert anggota/relasi/disposisi | 2, 13 |
| Trigger menolak `digabung_ke_id` ke rangkaian `digabung` | 2 |
| Paritas normalisasi TS/SQL | 7 |
| Precheck 0046 RAISE pada data ganda | 1 |
| Konvergensi grants lulus | 5, 15 |
| §11 unit: `deriveRangkaianStatus`/`deriveSuratMasukStatus` (monoton, data lama), `normalizeNomor`, rollback bila `logActionOrThrow` gagal | 7, 8, 9 |
| §11 integrasi: gabung dengan `ON UPDATE CASCADE` + pemindahan distribusi, target tidak selesai selama sumber punya disposisi terbuka, tautan induk 1-anggota = gabung, anggota draft terhapus tidak memblokir | 10–12 |

Yang sengaja **tidak** di P1 (sesuai §10): predikat baca `visibility-spec.ts` selain `jangkauanUnitsSql` (yaitu `jangkauanSql`, `visibleSql`, `resolveKonteksBaca` — P2), `checkRead`, `checkMany`, `attachTindakLanjut` dengan wewenang, route `/api/rangkaian`, `escapeLike`, cek duplikat distribusi yang mengabaikan `rejected`, validasi `can_receive_distribution`, aturan surat terkendali §4.12, pemanggilan `ensureForSuratMasuk` dari `POST /api/distributions`, toggle `is_unit_pengawas` di `PUT /api/settings/unit-kerja/:id` (dimiliki **P3 Task 26**, backend + UI Settings), skrip backfill.

Pemeriksaan placeholder: tidak ada "TBD"/"sesuaikan"; hash Neon dihitung oleh perintah di Task 5 Step 5. Konsistensi tipe: `RangkaianStatus`/`RangkaianAsal`/`JenisRelasi`/`SumberAnggota` hanya didefinisikan di `schema/rangkaian-surat.ts` dan dipakai ulang di `rangkaian-status.ts`, `rangkaian.service.ts`, dan `distribution.service.ts`.

## Catatan Konsistensi Lintas Fase (2026-09-26)

Perubahan dari tinjauan konsistensi P0–P5 terhadap berkas ini:

- Task 10: `JangkauanOptions` + `jangkauanUnitsSql(rangkaianId: SQLWrapper | string, options?)` dipindah dari `rangkaian.service.ts` ke `backend/src/services/access/visibility-spec.ts` (berkas P0) sebagai **satu-satunya** definisi himpunan jangkauan §4.5; `rangkaianService.jangkauanUnitIds` tetap di `rangkaian.service.ts` dan mendelegasikan. File Structure, impor, dan `git add` Task 10 disesuaikan.
- Self-review: toggle `is_unit_pengawas` di `PUT /api/settings/unit-kerja/:id` kini dimiliki P3 Task 26; `visibility-spec.ts` di P1 terbatas pada `jangkauanUnitsSql`.
- Branch: konvensi `feat/integrasi-surat-pN` dicantumkan di Global Constraints.
- Dikonfirmasi tanpa perubahan: 0046 `when` 1789397417667, 0047 `when` 1789397418667; audit `merge`/`link` dan entitas `rangkaian_surat`/`rangkaian_relasi` dimiliki P1 Task 9.

### 2026-09-27

- Tinjauan whole-branch P0 (final review) menemukan bahwa Task 4 menambah tujuh kolom ke `suratDistributions` tanpa menyentuh `backend/src/__tests__/helpers/surat-inbox-pglite.ts`, yang men-hardcode `CREATE TABLE surat_distributions` terpisah dari migrasi/skema Drizzle untuk dua test P0 (`distribution-inbox-classification.test.ts`, `notification-deleted-classification.test.ts`). Ditambahkan **Step 4b** ke Task 4 (SQL kolom persis, tanpa FK) dan kedua test itu ke Files list Task 4 sebagai regresi yang wajib tetap lulus setelah Step 4b. Tidak ada perubahan kode di P0; helper hanya diedit saat Task 4 P1 berjalan.
