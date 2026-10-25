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
2. Jalankan dari mesin operator. Jangan menaruh connection string di argumen baris perintah (tersimpan di histori shell) — masukkan lewat prompt tersembunyi, lalu tulis output ke berkas `.tmp` dan pindahkan ke tempat aslinya hanya bila perintah keluar dengan status 0, agar `sifat-surat-produksi.json` (berkas yang di-commit) tidak pernah tertimpa separuh jalan oleh kegagalan koneksi/izin.

   Bash/WSL/Git Bash:

   ```bash
   cd backend
   read -rs PREFLIGHT_DATABASE_URL && export PREFLIGHT_DATABASE_URL

   npm run db:preflight:integrasi-surat > ../preflight-p0.md.tmp \
     && mv ../preflight-p0.md.tmp ../preflight-p0.md
   node scripts/preflight-integrasi-surat.mjs --format=sifat-json \
     > src/__tests__/fixtures/sifat-surat-produksi.json.tmp \
     && mv src/__tests__/fixtures/sifat-surat-produksi.json.tmp src/__tests__/fixtures/sifat-surat-produksi.json

   unset PREFLIGHT_DATABASE_URL
   ```

   PowerShell (mesin operator Windows):

   ```powershell
   cd backend
   $secure = Read-Host -AsSecureString 'PREFLIGHT_DATABASE_URL'
   $ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($secure)
   try {
       $env:PREFLIGHT_DATABASE_URL = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($ptr)
   } finally {
       [System.Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($ptr)
   }

   npm run db:preflight:integrasi-surat > ..\preflight-p0.md.tmp
   if ($LASTEXITCODE -eq 0) { Move-Item ..\preflight-p0.md.tmp ..\preflight-p0.md -Force }

   node scripts/preflight-integrasi-surat.mjs --format=sifat-json `
     > src\__tests__\fixtures\sifat-surat-produksi.json.tmp
   if ($LASTEXITCODE -eq 0) {
       Move-Item src\__tests__\fixtures\sifat-surat-produksi.json.tmp src\__tests__\fixtures\sifat-surat-produksi.json -Force
   }

   Remove-Item Env:\PREFLIGHT_DATABASE_URL
   ```

   Exit code 1 berarti ada pemeriksaan yang gagal (bagian **GAGAL** di laporan) atau koneksi/izin bermasalah; berkas `.tmp` yang bersangkutan tetap ada untuk diperiksa (laporan markdown tetap memuat bagian **GAGAL** meski exit-nya 1) dan berkas asli (termasuk fixture yang sudah ter-commit) tidak tersentuh. Perbaiki izin atau koneksi, lalu ulangi seluruh blok sampai kedua perintah keluar dengan status 0 sebelum menghapus sisa `.tmp`.
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
| `index_dan_objek_bentrok` | Hanya `idx_surat_keluar_balasan` yang boleh `true`; ini juga mencakup dua trigger 0046 (`unit_kerja_default_pengawas` pada `unit_kerja`, `surat_distributions_closed_guard` pada `surat_distributions`) | Objek lain yang sudah ada membuat 0046 gagal; selidiki asalnya. Kedua trigger dibuat tanpa `IF NOT EXISTS`/`OR REPLACE`, jadi trigger dengan nama sama yang sudah ada (dari deployment/migrasi manual lain) memblokir 0046 — hapus atau ganti nama trigger lama dulu |
| `kolom_bentrok` | 0 baris | Selidiki perubahan skema manual |
| `ekstensi` | Informasi | `pg_trgm` wajib terpasang sebelum migrasi `0049_lacak_trgm` (P5 Task 14); pasang lewat `backend/src/db/grants/0003_optional_pg_trgm.sql` (runbook P5 §5.1) |
| `data_lama_ringkasan`, `data_lama_per_unit_tahun` | Informasi | Menentukan apakah backfill langkah 2 (P5) diperlukan |
| `label_disposisi`, `balasan_lintas_unit` | Informasi | Masukan untuk seed `disposisi_label_unit` dan tinjauan TU |
| `sifat_surat_distinct`, `sifat_surat_kelas` | Test paritas PASS | Jangan lanjut; laporkan nilai yang tidak cocok |
| `distribusi_terbuka_per_kelas` | Informasi | Umumkan jumlah disposisi yang baru tampil setelah P0 |
| `pengguna_per_role_unit` | Informasi | Daftar calon pengawas untuk sign-off keamanan |

## Pengesahan

Pengesahan diisi pada blok **Pengesahan** di laporan hasil. Pengisinya adalah operator yang menjalankan, lalu pemilik keamanan yang meninjau.
