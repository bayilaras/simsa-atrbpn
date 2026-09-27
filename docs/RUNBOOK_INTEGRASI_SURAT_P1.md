# Runbook Deploy Integrasi Surat — P1 (Skema 0046–0047)

Berlaku untuk rilis yang memuat migrasi `0046_rangkaian_surat` dan `0047_unit_kerja_direktorat`. Produksi memakai Vercel + Neon; jalur Cloud SQL/psql dicantumkan untuk lingkungan lain.

**Prasyarat:** Pre-flight P0 (`docs/PREFLIGHT_INTEGRASI_SURAT_P0.md`) harus sudah **selesai dan disahkan** (blok Pengesahan terisi, laporan `docs/HASIL_PREFLIGHT_INTEGRASI_SURAT_P0_<tanggal>.md` sudah ter-commit) sebelum langkah apa pun di runbook ini dijalankan. Jangan mulai P1 di atas pre-flight yang belum ditinjau.

**Keamanan koneksi (berlaku untuk semua kueri manual di runbook ini):** jangan pernah menaruh connection string di argumen baris perintah atau berkas yang tersimpan di riwayat shell — connection string yang lolos ke argv juga umumnya terlihat oleh proses lain di mesin yang sama (`ps`/Task Manager). Masukkan lewat prompt tersembunyi ke variabel lingkungan sesi, gunakan, lalu hapus variabelnya, mengikuti pola yang sama dengan `docs/PREFLIGHT_INTEGRASI_SURAT_P0.md`:

```bash
read -rs NEON_QUERY_DATABASE_URL && export NEON_QUERY_DATABASE_URL
psql "$NEON_QUERY_DATABASE_URL" -f query.sql
unset NEON_QUERY_DATABASE_URL
```

```powershell
$secure = Read-Host -AsSecureString 'NEON_QUERY_DATABASE_URL'
$ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($secure)
try {
    $env:NEON_QUERY_DATABASE_URL = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($ptr)
} finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($ptr)
}
psql $env:NEON_QUERY_DATABASE_URL -f query.sql
Remove-Item Env:\NEON_QUERY_DATABASE_URL
```

Alternatif yang sama-sama aman: tempelkan kueri langsung ke konsol SQL Neon (Neon Console → SQL Editor) memakai role yang disebutkan di setiap langkah — konsol tidak pernah menaruh credential di argv/riwayat shell mesin operator.

## Urutan wajib

1. **Backup** Neon dengan helper versi yang sedang berjalan di produksi (sebelum checkout rilis ini), sesuai `docs/BACKUP_NEON.md`. Gunakan helper sumber yang cocok dengan manifest migrasi checkout tersebut; jangan memakai helper versi lama untuk database yang sudah lebih baru (lihat status backup terakhir di `docs/BACKUP_NEON.md`).
2. **Preflight read-only.** Gunakan role Neon **read-only** yang terpisah dari role runtime/migrator (role yang sama dengan yang disiapkan untuk P0 — lihat `docs/PREFLIGHT_INTEGRASI_SURAT_P0.md` langkah 1), dikoneksikan lewat pola aman di atas (`NEON_QUERY_DATABASE_URL` diisi dengan connection string role read-only ini):

   ```sql
   SELECT status, count(*) FROM surat_distributions
   WHERE status NOT IN ('sent','received','processed','rejected') GROUP BY status;
   SELECT surat_masuk_id, target_unit_id, count(*) FROM surat_distributions
   WHERE status <> 'rejected' GROUP BY 1, 2 HAVING count(*) > 1;
   SELECT id FROM unit_kerja WHERE id ~ '^direktorat-';
   SELECT id, parent_id, unit_type FROM unit_kerja WHERE id IN ('ditjen','sesditjen','dir_bppt','dir_ptep','dir_ktpp','dir_plp');
   ```

   Ketiga kueri pertama harus kosong. Bila tidak, **hentikan**: rekonsiliasi dengan pemilik data (ubah status/tolak baris ganda dengan alasan tertulis) lalu ulangi. Migrasi 0046/0047 menolak (RAISE, `ERRCODE 23514`/`23505`) data ini dan tidak mengubahnya — lihat blok `DO $$ ... RAISE EXCEPTION` di awal `backend/src/db/migrations/0046_rangkaian_surat.sql` dan di `0047_unit_kerja_direktorat.sql` (pola `id ~ '^direktorat-'`). Kueri keempat hanya informatif (melihat kondisi sebelum 0047 mengisi `parent_id`/`unit_type` bila masih NULL).
3. **Migrasi + konvergensi grant (satu perintah di Neon):**

   ```powershell
   & $cloudNode "--env-file=$cloudEnv" scripts/neon-database.mjs migrate --apply
   & $cloudNode "--env-file=$cloudEnv" scripts/neon-database.mjs verify-runtime
   ```

   Adapter Neon menjalankan migrasi dalam satu transaksi lalu langsung menerapkan `grants/0002` (hash tersemat di `scripts/neon-database-policy.mjs`). Jalur Cloud SQL/psql: `npm --prefix backend run db:migrate`, lalu **segera** `EXPECTED_MIGRATIONS_JSON="$(python3 .github/scripts/build-migration-manifest.py)" npm --prefix backend run db:grants:converge`.
4. **Verifikasi hak dan skema.** `scripts/neon-database.mjs verify-runtime` (dijalankan sebagai bagian langkah 3 di atas) sudah menyambungkan sebagai role runtime `simsa_api` dan memverifikasi batas role serta privilege pada tabel inti (`users`, `surat_masuk`, `arsip`, `shared_rate_limits`, `audit_log`, `file_fixity_jobs`) lewat `verifyNeonRuntime()` di `scripts/neon-database-policy.mjs`; **`verify-runtime` tidak memeriksa privilege `rangkaian_surat` maupun isi `unit_kerja`**, jadi kueri di bawah tetap wajib dijalankan terpisah, dengan koneksi sebagai role runtime yang sama (`simsa_api`/`NEON_RUNTIME_DATABASE_URL`, mengikuti pola aman di atas — bukan role admin/migrator):

   ```sql
   SELECT has_table_privilege(current_user, 'public.rangkaian_surat', 'DELETE') AS boleh_hapus,      -- false
          has_table_privilege(current_user, 'public.rangkaian_surat', 'INSERT') AS boleh_tambah;     -- true
   SELECT id, is_unit_pengawas FROM unit_kerja WHERE id IN ('ditjen','sesditjen');                 -- keduanya true
   SELECT count(*) FROM unit_kerja WHERE id IN ('dir_bppt','dir_ptep','dir_ktpp','dir_plp');       -- 4
   ```

   Bila operator tidak punya akses langsung ke `NEON_RUNTIME_DATABASE_URL`, jalankan ketiga kueri ini lewat konsol SQL Neon dengan role `simsa_api` dipilih secara eksplisit di sesi tersebut.

5. **Backfill langkah 1** (`backend/scripts/backfill-rangkaian-disposisi.mjs`): **belum ada di P1**. Kode P1 tidak mewajibkan `rangkaian_id`, sehingga langkah ini dilewati pada rilis P1 dan wajib dijalankan pada rilis P3 **sebelum** kode P3 aktif, dengan kriteria keluar `SELECT count(*) FROM surat_distributions WHERE rangkaian_id IS NULL` = 0.
6. **Deploy kode** backend. `/ready` menolak (503) bila skema belum lengkap: `DATABASE_SCHEMA_READINESS_SQL` (`backend/src/services/readiness.service.ts`) memeriksa, di antara syarat lain yang sudah ada sejak migrasi sebelumnya, seluruh berikut yang ditambahkan 0046/0047:
   - Kolom: `unit_kerja.is_unit_pengawas`, `surat_keluar.asal_naskah`, `surat_distributions.{rangkaian_id, batas_waktu, penanggung_jawab, processed_by, penyelesaian_surat_keluar_id, catatan_penyelesaian, ditutup_pengawas}`, `rangkaian_surat.{kode, status}`, `rangkaian_anggota.rangkaian_id`, `rangkaian_relasi.cancelled_at`, `rangkaian_peserta.berakhir_at`, `rangkaian_koreksi_berkas.status`.
   - Constraint: `surat_distributions_status_check`, `rangkaian_berkas_check`, `rangkaian_gabung_check`, `rangkaian_selesai_manual_check`, `rangkaian_relasi_pembatalan_check`, `rangkaian_peserta_berakhir_check`.
   - Trigger (lima, semuanya wajib `tgenabled`): `rangkaian_anggota_closed_guard`, `rangkaian_relasi_closed_guard`, `surat_distributions_closed_guard` (ketiganya fungsi `rangkaian_guard_closed()`), `rangkaian_surat_status_guard` (fungsi `rangkaian_guard_status()`), dan `rangkaian_koreksi_lifecycle_guard` (fungsi `rangkaian_koreksi_guard()`).

   Trigger `unit_kerja_default_pengawas` (BEFORE INSERT, mengisi `is_unit_pengawas` untuk baris `ditjen`/`sesditjen` yang baru dibuat) **tidak** termasuk dalam daftar yang diperiksa `/ready` — ia hanya perlu ada untuk instalasi baru (lihat Catatan) dan bukan bagian kontrak readiness.

## Catatan

- Seed `seed:deployment` yang dijalankan sesudah migrasi pada instalasi baru tetap menghasilkan `ditjen`/`sesditjen` sebagai pengawas melalui trigger `unit_kerja_default_pengawas`.
- Nama resmi unit `dir_*` dikoreksi lewat `PUT /api/settings/unit-kerja/:id` (super_admin). `parent_id`/`unit_type` hanya diatur 0047 (dan hanya bila masih NULL; 0047 tidak menimpa nilai yang sudah diisi manual).
- Jangan jalankan helper backup/migrator versi lama terhadap database yang sudah dimigrasikan ke 0046/0047.
- **Rangkaian yang sudah `diberkaskan` bersifat imut**, kecuali satu pasangan kolom: `unit_pengolah_id`/`klasifikasi_item_id`, dan hanya lewat baris Koreksi Berkas (`rangkaian_koreksi_berkas`) berstatus `approved` yang diacu lewat GUC `simsa.berkas_koreksi` (isi GUC = `id` baris koreksi tersebut; trigger `rangkaian_surat_status_guard` mencocokkan `unit_pengolah_lama`/`klasifikasi_lama`/`unit_pengolah_baru`/`klasifikasi_baru` baris itu terhadap nilai OLD/NEW rangkaian sebelum mengizinkan UPDATE). Kolom lain (judul, kode, tahun, `selesai_*`, `created_*`, dst.) tidak dapat berubah sama sekali setelah `diberkaskan`, dan status `diberkaskan`/`digabung` tidak dapat dibuka kembali.
- Siklus hidup baris `rangkaian_koreksi_berkas` (dijaga trigger `rangkaian_koreksi_lifecycle_guard`): `pending` → `approved` atau `denied` (keduanya wajib mengisi `diputuskan_by`/`diputuskan_at` sekaligus, dan keputusan yang sudah terisi tidak dapat diubah) → `applied` (hanya dari `approved`). `denied` dan `applied` bersifat terminal.
- Sejak 0046, `grants/0002_converge_application_grants.sql` menambahkan `REVOKE DELETE ON TABLE rangkaian_surat, rangkaian_anggota, rangkaian_relasi, rangkaian_peserta, rangkaian_koreksi_berkas FROM simsa_api_runtime`, dibungkus per-tabel dengan `pg_catalog.to_regclass(...) IS NOT NULL` supaya konvergensi grant tidak gagal saat dijalankan terhadap skema sebelum 0046 (restore/upgrade lama). Perubahan ini mengubah hash SHA-256 file yang disematkan di `scripts/neon-database-policy.mjs`: adapter Neon **menolak** menjalankan `grants/0002` versi lama (hash tidak cocok) dan sebaliknya menolak file `grants/0002` bila database belum mempunyai chain migrasi yang diharapkan — jangan mencampur helper/adapter dari checkout yang berbeda dengan migrasi yang sudah diterapkan.
- Gate CI berikut wajib hijau pada PR sebelum deploy (tidak dijalankan manual di runbook ini): `backend` `npm run test:postgres-locks` (mensyaratkan `TEST_POSTGRES_URL`; lihat job di `.github/workflows/ci.yml`) dan profil backup-upgrade `.github/scripts/test-backup-upgrade-profile.mjs` (dijalankan lewat job yang sama menyediakan `TEST_POSTGRES_URL`/`TEST_POSTGRES_IMAGE`/`TEST_POSTGRES_CONTAINER_ID`).

## Catatan untuk P3

Kontrak layanan berikut dari P1 wajib dipatuhi P3 saat menyambungkan rute/servis ke rangkaian:

- **Urutan kunci:** baris surat → baris `rangkaian_surat` (`ORDER BY id`) → baris distribusi. Helper pra-kunci `lockSuratMasukRows` (diekspor dari `backend/src/services/rangkaian.service.ts`) mengunci baris surat masuk; layanan rangkaian **tidak** membuka transaksi sendiri, sehingga pemanggil (surat-masuk.service/surat-keluar.service/approval.service di P3) bertanggung jawab mengunci surat lebih dulu sebelum memanggil layanan rangkaian, yang pada gilirannya mengunci `rangkaian_surat` (`ORDER BY id`) sebelum menyentuh distribusi.
  **Koreksi penting (review final P1):** urutan ini TIDAK otomatis "mencegah deadlock dengan trigger 0046" seperti klaim versi sebelumnya catatan ini — pada UPDATE/DELETE baris `surat_distributions`, trigger `rangkaian_guard_closed()` berjalan SETELAH baris distribusi itu sendiri sudah terkunci secara implisit oleh statement UPDATE/DELETE, lalu baru mengambil `FOR SHARE` pada `rangkaian_surat` — urutan trigger pada jalur ini adalah **distribusi → rangkaian**, kebalikan dari urutan layanan (surat → rangkaian → distribusi). Bila satu sesi mengunci baris distribusi lebih dulu (mis. `receive`/`process`/`reject` yang meng-UPDATE baris `surat_distributions` tanpa mengunci `rangkaian_surat` lebih dulu) sementara sesi lain sedang memegang `FOR UPDATE` pada `rangkaian_surat` yang sama (mis. `recomputeStatus`/`gabung`) dan berikutnya butuh baris distribusi itu, kedua sesi bisa saling menunggu (deadlock PostgreSQL, `40P01`).
  **Aturan wajib:** SETIAP penulisan `surat_distributions` (insert/distribute, receive, process, reject, tutup pengawas, penyelesaian, dan gabung yang memindahkan baris distribusi) WAJIB mengunci dulu baris surat (`lockSurat`/`lockSuratMasukRows`), lalu `rangkaian_surat` `FOR UPDATE` (`ORDER BY id`, via `lockRangkaian`) — SEBELUM menyentuh (INSERT/UPDATE/DELETE) baris `surat_distributions` mana pun, termasuk jalur yang hanya mengubah satu baris distribusi (receive/process/reject/tutup/penyelesaian), tidak hanya jalur yang membuat rangkaian baru. Ini yang sebenarnya menyelaraskan urutan kunci layanan dengan urutan kunci trigger, bukan urutan "surat → rangkaian → distribusi" semata.
- **Retry pada deadlock:** ulangi transaksi bila error ber-kode `40P01` (deadlock terdeteksi oleh PostgreSQL akibat urutan kunci yang tumpang tindih antar sesi) — ini tetap wajib bahkan setelah aturan wajib di atas dipatuhi, karena PostgreSQL bisa tetap mendeteksi deadlock akibat urutan ORDER BY id yang berbeda antar transaksi yang menyentuh rangkaian berbeda secara bersamaan.
- **Jangan memakai transaksi setelah menangkap `23505`/`23514`:** begitu Postgres melempar unique-violation (`23505`) atau check-violation (`23514`, termasuk seluruh RAISE EXCEPTION trigger 0046), transaksi itu sudah *aborted* — statement berikutnya di `tx` yang sama akan gagal. Gunakan `hasPostgresErrorCode(error, code, constraintName?)` (`backend/src/utils/postgres-errors.ts`) untuk memeriksa kode melalui `error.cause` (Drizzle 0.45 membungkus error pg di `.cause`), lalu keluar dari `tx` dan mulai transaksi baru bila perlu mencoba ulang.
- **Setiap jalur distribusi harus lewat `ensureForSuratMasuk` atau pre-check layanan setingkat**, supaya trigger penutupan berkas 0046 (`surat_distributions_closed_guard`, dkk.) tidak pernah tampil ke pemanggil sebagai 500 mentah. `rangkaianService.ensureForSuratMasuk` (`backend/src/services/rangkaian.service.ts`) dan pemeriksaan status rangkaian di `distributionService.distribute` (`backend/src/services/distribution.service.ts`, memeriksa `rangkaian.status IN ('diberkaskan','digabung')` sebelum INSERT) adalah dua contoh pola ini; P3 mengulang pola yang sama untuk rute baru.
- **Backfill langkah 1 wajib mengisi `rangkaian_id` pada seluruh baris `surat_distributions` yang ada** sebelum kode P3 (yang mewajibkan kolom ini pada jalur baru) diaktifkan — lihat kriteria keluar pada langkah 5 di atas.

## Rollback

Pemulihan yang disarankan adalah **deploy ulang versi aplikasi sebelumnya dengan skema 47 tetap terpasang**. Aplikasi lama kompatibel: kolom baru nullable/berdefault, index parsial lebih longgar daripada cek duplikat lama, dan tabel `rangkaian_*` tidak dipakai. Jangan menghapus tabel atau membalik migrasi secara manual; bila skema harus dibatalkan, pulihkan dari backup langkah 1.
