# Runbook pemulihan produksi dari backup

Runbook ini menghidupkan kembali SIMSA dari backup terenkripsi harian bila database Neon, store Blob privat, atau keduanya hilang atau rusak dan penyedia tidak dapat memulihkannya. Kondisi produksi yang berlaku ada di [kondisi produksi](KONDISI_PRODUKSI.md); cara membuat dan menguji backup ada di [cadangan dan pemulihan](OPERATIONS_RECOVERY.md).

**Apa yang sudah terbukti dan apa yang belum.** Workflow backup harian membuktikan bahwa artefak dapat dibuka dan dipulihkan ke cluster PostgreSQL terpisah, dengan semua hash dokumen cocok. Bagian 4.2–4.4 sudah dilatih pada cluster PostgreSQL 18 lokal yang baru, tanpa peran SIMSA dan dengan pemilik database yang bukan superuser seperti project Neon baru, memakai data sintetis (14 November 2026; rinciannya di [catatan waktu](#catatan-waktu)). Alat unggah ulang dokumen di bagian 5 diuji terhadap PostgreSQL lokal dan store tiruan. Pemulihan ke project Neon baru dan store Blob baru **belum pernah dilatih dengan layanan sungguhan**. Latih sekali ke lingkungan terpisah, lalu isi [catatan waktu](#catatan-waktu).

## 1. Pilih jalur

| Kejadian | Jalur | Bagian | Yang perlu dicatat ulang oleh staf |
|---|---|---|---|
| Data salah atau terhapus; project Neon masih ada dan kejadiannya masih di dalam jendela pemulihan titik waktu (PITR) | Pemulihan titik waktu Neon, tanpa backup | 2, lalu 7 | Pencatatan sesudah titik waktu yang dipilih |
| Project Neon hilang atau rusak, atau kejadiannya di luar jendela PITR; store Blob utuh | Database dari backup | 3, 4, 6, 7 | Pencatatan sesudah waktu snapshot backup |
| Store Blob hilang atau objeknya terhapus; database utuh | Dokumen dari backup | 3, 5, 6, 7 | PDF yang diunggah sesudah waktu snapshot backup |
| Database dan store Blob hilang | Database dan dokumen dari backup | 3, 4, 5, 6, 7 | Pencatatan dan PDF sesudah waktu snapshot backup |

Jalur yang menghilangkan data diputuskan oleh Kasubbag TU sebagai pemilik data. Jendela PITR Neon dan titik pulih backup (sekitar 24 jam) tercatat di [kondisi produksi](KONDISI_PRODUKSI.md#titik-pulih-dan-jendela-pemulihan).

Nama proyek dan tim Vercel produksi tertanam di kode: alamat frontend dan backend, probe monitor, dan pin host fungsi pemindai. Runbook ini memakai proyek Vercel yang sama. Bila proyek atau tim Vercel juga hilang, kode harus disesuaikan dan dirilis lebih dulu; konfigurasi proyek baru mengikuti [panduan Vercel dan Neon](DEPLOY_VERCEL_NEON.md).

## Persiapan

1. Tetapkan pemimpin pemulihan dan pencatat waktu. Catat jam mulai setiap langkah di [catatan waktu](#catatan-waktu).
2. Umumkan gangguan kepada staf dan minta pencatatan dihentikan sampai layanan dinyatakan pulih. Catatan yang dibuat di sistem lama selama pemulihan tidak ikut pindah.
3. Siapkan:
   - artefak `simsa-recovery-*` hijau terbaru dari GitHub Actions (disimpan 14 hari) atau salinan bulanan di penyimpanan kantor;
   - passphrase backup dari pemegangnya;
   - workstation dengan Node.js 24 dan alat klien PostgreSQL 18 (`pg_restore`), misalnya `C:\Program Files\PostgreSQL\18\bin`;
   - dua checkout kode, masing-masing dengan `npm ci --prefix <folder>\backend --ignore-scripts`:
     - sumber rilis yang journal migrasinya sama dengan backup (lihat [alat rilis](RUNBOOK_KREDENSIAL_DATABASE.md#alat-di-scriptsops)), untuk perintah `neon-database.mjs`, `neon-backup.mjs`, dan `neon-worker.mjs` di bagian 4;
     - checkout `main` terbaru, untuk `operations-recovery-extract.mjs` (bagian 3) dan `operations-recovery-reupload.mjs` (bagian 5). Kedua alat ini tidak terikat pada journal migrasi;
   - folder kerja di media terenkripsi milik kantor, di luar repositori. Isinya akan berupa data dinas dan data pribadi tanpa enkripsi.
4. Pastikan peran berikut dapat dihubungi: pemilik project Neon, pengelola Vercel, admin repositori GitHub, dan pemegang passphrase.

## 2. Jalur cepat: pemulihan titik waktu Neon

Gunakan bila project Neon masih ada dan titik waktu yang dibutuhkan masih di dalam jendela PITR. Backup tidak diperlukan.

1. Di Neon Console, buat branch dari titik waktu sesaat sebelum kejadian, lalu periksa datanya bersama Super Admin sebelum mengubah produksi.
2. Setelah disetujui pemilik data, pulihkan branch produksi ke titik waktu itu dengan fitur restore Neon. Neon menyimpan keadaan sebelumnya sebagai branch `<nama>_old_<waktu>`. Jangan menghapus branch itu sebelum verifikasi di bagian 7 selesai. Batas jumlah branch per project dibahas di [prosedur rilis](RUNBOOK_KREDENSIAL_DATABASE.md#prosedur-rilis).
3. Dokumen di Blob tidak ikut mundur. PDF yang diunggah sesudah titik waktu itu tetap ada di store, tetapi tidak lagi dirujuk database.
4. Lanjutkan ke bagian 7.

## 3. Buka backup

1. Unduh artefak: GitHub → Actions → workflow *Verified database and private document recovery* → run hijau terbaru → Artifacts → `simsa-recovery-<run_id>-<attempt>`.
2. Buka di PowerShell dari checkout `main`. Passphrase diketik sendiri oleh pemegangnya dan tidak tampil di layar:

   ```powershell
   Expand-Archive "$HOME\Downloads\simsa-recovery-<run_id>-1.zip" "$HOME\Downloads\simsa-recovery-<run_id>-1"
   $s = Read-Host "Passphrase backup" -AsSecureString
   $env:BACKUP_ENCRYPTION_PASSPHRASE = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
   node scripts/operations-recovery-extract.mjs --bundle "$HOME\Downloads\simsa-recovery-<run_id>-1" --output "E:\PEMULIHAN-SIMSA-<tanggal>"
   Remove-Item Env:BACKUP_ENCRYPTION_PASSPHRASE
   ```

3. Baca `BACA-SAYA.txt` di folder hasil dan catat: waktu snapshot database, migrasi terakhir, serta jumlah dan ukuran dokumen. Waktu snapshot menentukan sejak kapan data harus dicatat ulang.
4. Untuk bagian 4: pastikan migrasi terakhir di `BACA-SAYA.txt` sama dengan entri terakhir `backend/src/db/migrations/meta/_journal.json` di sumber rilis yang dipakai. Bila berbeda, pakai sumber rilis yang journalnya sama dengan backup.

Folder hasil berisi `database/simsa.dump`, `dokumen/...`, `DAFTAR-DOKUMEN.csv`, dan `MANIFEST.sha256`. Rinciannya ada di [membuka backup](OPERATIONS_RECOVERY.md#membuka-backup-menjadi-file-yang-bisa-dibaca).

## 4. Database baru di Neon

### 4.1 Project dan berkas environment

1. Pemilik project Neon membuat project baru dengan PostgreSQL 18 di region Singapura, lalu database kosong. Namanya boleh sama dengan database lama (variabel GitHub `NEON_BACKUP_EXPECTED_DATABASE`).
2. Salin `deploy/neon/neon-setup.env.example` ke folder privat di luar repositori. Isi untuk project baru: host direct, nama database, administrator `neondb_owner`, dan tiga password acak baru untuk login aplikasi. Tambahkan `NEON_BACKUP_DATABASE_URL` dan `NEON_WORKER_DATABASE_URL` untuk host dan database yang sama, masing-masing dengan password acak baru (minimal 32 karakter, `sslmode=verify-full`). Simpan semua password di password manager.

### 4.2 Peran dan skema kosong

Jalankan perintah `node` di bagian 4 dari folder sumber rilis yang journalnya sama dengan backup.

```powershell
$neonEnv = 'E:\RAHASIA-PEMULIHAN\neon-baru.env'   # berkas dari langkah 4.1
node "--env-file=$neonEnv" scripts/neon-database.mjs preflight-empty
node "--env-file=$neonEnv" scripts/neon-database.mjs bootstrap --apply
```

`bootstrap` membuat peran kebijakan, login `simsa_api`, `simsa_migration`, dan `simsa_operator`, extension `pgcrypto` dan `pg_trgm`, serta skema `public` dan `drizzle` milik `simsa_migrator`. Rincian dan pesan galatnya ada di [penyiapan database Neon](PENYIAPAN_DATABASE_NEON.md#2-bootstrap-dan-migrasi-secara-terpisah).

### 4.3 Isi database dari dump

Dump dipulihkan oleh login migrasi sehingga semua objek langsung dimiliki `simsa_migrator`. Skema `drizzle` dan kedua extension sudah dibuat oleh `bootstrap`, dan login migrasi tidak berhak membuatnya. Karena itu entri tersebut dikeluarkan dari daftar isi dump. Seluruh pemulihan berjalan dalam satu transaksi: bila ada satu kesalahan, tidak ada yang tersimpan.

```powershell
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$kerja = 'E:\PEMULIHAN-SIMSA-<tanggal>'            # folder hasil langkah 3
node -e "require('fs').writeFileSync(process.argv[1], require('tls').getCACertificates('default').join('\n'))" "$kerja\ca-node.pem"
$env:PGHOST = '<host direct project baru>'; $env:PGPORT = '5432'; $env:PGDATABASE = '<nama database>'; $env:PGUSER = 'simsa_migration'
$env:PGSSLMODE = 'verify-full'; $env:PGSSLROOTCERT = "$kerja\ca-node.pem"; $env:PGCHANNELBINDING = 'require'
$s = Read-Host 'Password simsa_migration' -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
& "$pgBin\pg_restore.exe" --list "$kerja\database\simsa.dump" |
  ForEach-Object { if ($_ -match ' SCHEMA - drizzle | EXTENSION - | COMMENT - EXTENSION ') { ";$_" } else { $_ } } |
  Set-Content -Encoding ascii "$kerja\daftar-pulih.txt"
& "$pgBin\pg_restore.exe" --no-owner --no-privileges --exit-on-error --single-transaction --role=simsa_migrator `
  --use-list "$kerja\daftar-pulih.txt" --dbname $env:PGDATABASE "$kerja\database\simsa.dump"
if ($LASTEXITCODE -ne 0) { Write-Warning 'Pemulihan dump gagal; database tetap kosong. Periksa pesan di atas.' }
Remove-Item Env:PGPASSWORD
```

Di `daftar-pulih.txt`, lima baris harus diawali `;`: `SCHEMA - drizzle`, `EXTENSION - pg_trgm`, `EXTENSION - pgcrypto`, dan dua baris `COMMENT - EXTENSION`. Tanpa penyaringan ini, pemulihan berhenti pada `CREATE SCHEMA drizzle` dengan galat izin.

### 4.4 Login layanan, grant, dan pemeriksaan

Jalankan persis dalam urutan ini:

```powershell
node "--env-file=$neonEnv" scripts/neon-database.mjs migrate --apply     # wajib "applied":0; grant dibangun ulang
node "--env-file=$neonEnv" scripts/neon-backup.mjs provision --apply     # login simsa_backup baru
node "--env-file=$neonEnv" scripts/neon-worker.mjs provision --apply     # login simsa_worker baru
node "--env-file=$neonEnv" scripts/neon-database.mjs verify-runtime
```

Dump dipulihkan tanpa grant (`--no-privileges`). `migrate --apply` memeriksa peran dan kepemilikan, mencocokkan journal hasil pemulihan dengan sumber rilis, lalu membangun ulang seluruh grant. Hasil `"applied":0` berarti journal cocok. Kedua perintah `provision` diakhiri pemeriksaan hak login barunya, jadi harus dijalankan **sesudah** `migrate`. Bila dijalankan lebih dulu, perintah itu gagal ("Worker permissions exceed the reviewed worker boundary or required grants are missing" atau "Backup permissions must be complete and read-only…") tanpa membuat login; jalankan `migrate --apply` lalu ulangi. `verify-runtime` membuktikan login `simsa_api` dapat dipakai backend dengan hak terbatas.

Periksa juga beberapa data bersama Super Admin, misalnya surat terakhir yang tercatat sebelum waktu snapshot. Pemeriksaan sidik jari lengkap hanya ada pada uji pulih terisolasi (`operations-recovery.mjs restore-delivery`), bukan pada target Neon.

## 5. Dokumen ke store Blob

Alat `scripts/operations-recovery-reupload.mjs` mengunggah setiap PDF dari folder hasil langkah 3 ke store tujuan dengan **nama objek yang sama**, sehingga lokasi dokumen di database hanya berganti host store. Tanpa `--apply`, alat hanya melakukan uji kering.

1. **Store tujuan.**
   - Store hilang: pengelola Vercel membuat store Blob **privat** baru, lalu mengambil token baca-tulis store tersebut dari halaman store di Vercel.
   - Store masih ada tetapi objeknya terhapus: pakai token store yang sama. Alat hanya mengembalikan objek yang hilang dan database tidak diubah.
2. **Uji kering.** Dari checkout `main`, isi dua nilai rahasia lewat prompt tersembunyi, lalu jalankan:

   ```powershell
   $t = Read-Host 'Token baca-tulis store tujuan' -AsSecureString
   $env:SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($t))
   $d = Read-Host 'Connection string simsa_migration (direct, sslmode=verify-full)' -AsSecureString
   $env:SIMSA_RESTORE_DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($d))
   node scripts/operations-recovery-reupload.mjs --documents "E:\PEMULIHAN-SIMSA-<tanggal>"
   ```

   Pada jalur "dokumen dari backup" (database utuh), connection string menunjuk database produksi. Bila password `simsa_migration` produksi tidak disimpan (alur `rotate-migrate`), tetapkan dulu password baru dengan `rilis-neon.ps1 -Action rotate-role -Role simsa_migration` ([rotasi](RUNBOOK_KREDENSIAL_DATABASE.md#simsa_migration)).
3. **Periksa ringkasannya.** Ringkasan memuat database dan store tujuan, jumlah dokumen di folder backup dan jumlah yang dapat dipulihkan (yang masih punya baris database), jumlah lokasi yang akan diubah per kolom, dan kode rencana. Perhatikan juga baris berikut:
   - *Tanpa salinan di backup ini*: lokasi berkas yang tidak ada di backup, misalnya PDF yang diunggah sesudah snapshot. Lokasinya tidak diubah. Daftar tabel dan ID-nya ada di laporan rinci (`plan.missingCopies`); minta pengunggahnya mengunggah ulang dari berkas asli.
   - *Referensi unggahan yang belum selesai*: lease unggahan langsung, batch unggah massal, dan antrean pembersihan yang menunjuk store lama. Objeknya tidak pernah masuk backup. Baris ini tidak diubah.
   - *Baris DAFTAR-DOKUMEN tanpa baris database*: dokumen di backup yang barisnya sudah tidak ada di database. Dokumen itu dilewati.

   Laporan rinci `LAPORAN-UNGGAH-ULANG-*.json` ditulis ke folder hasil dan memuat lokasi serta nama berkas. Perlakukan laporan itu seperti isi folder: hanya di media terenkripsi kantor.
4. **Terapkan** dengan kode rencana dari uji kering:

   ```powershell
   node scripts/operations-recovery-reupload.mjs --documents "E:\PEMULIHAN-SIMSA-<tanggal>" --apply --confirm <kode rencana>
   Remove-Item Env:SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN, Env:SIMSA_RESTORE_DATABASE_URL
   ```

   Urutan kerja alat:
   1. Semua pemeriksaan uji kering diulang. Bila database, store, atau isi backup berubah, kode rencana tidak cocok dan alat berhenti sebelum mengunggah apa pun.
   2. Setiap PDF diunggah tanpa akhiran acak. Objek yang sudah ada dan identik dipakai ulang; objek lain dengan nama yang sama tidak pernah ditimpa. Setiap objek dibaca ulang dan SHA-256-nya dicocokkan.
   3. Baru setelah semua objek terbukti benar, lokasi di `file_attachments.file_url`, `surat_masuk.file_path`, `surat_keluar.file_path`, `regulatory_rule_sets.source_document_blob_url`, dan `autentikasi.file_lampiran` ditulis ulang dalam **satu transaksi**. Setiap baris yang berubah mendapat satu catatan audit atas nama `system:operations-recovery-reupload`. Catatan itu berisi host store lama dan baru, sidik jari lokasi, dan hash berkas, tanpa nama berkas.
   4. Lima trigger pengaman yang mengunci lokasi berkas bukti (`file_attachments_transfer_identity_guard_trg`, `disposition_evidence_attachment_guard`, `terjaga_reporting_attachment_guard`, `preservation_attachment_guard`, `regulatory_rule_sets_state_guard`) dinonaktifkan hanya di dalam transaksi itu, lalu diaktifkan kembali sebelum commit. Karena itu alat memerlukan login migrasi (pemilik tabel). Trigger dan constraint lain tetap berlaku.

   Bila ada kegagalan, seluruh perubahan database dibatalkan. Objek yang sudah diunggah tetap ada dan dipakai ulang saat alat dijalankan lagi, jadi alat aman diulang mulai dari uji kering.

| Pesan alat | Tindakan |
|---|---|
| kode rencana tidak cocok | Jalankan uji kering lagi dan periksa database serta store yang dipilih |
| store tujuan sudah berisi objek lain dengan nama yang sama | Tidak ada yang ditimpa. Pastikan store yang dipilih benar. Objek yang terbukti rusak hanya dihapus setelah buktinya diamankan dan disetujui |
| dokumen yang diunggah tidak cocok saat dibaca ulang | Ulangi. Bila tetap terjadi, hentikan dan periksa status layanan Vercel Blob |
| login database ini bukan pemilik tabel | Pakai connection string `simsa_migration` |
| database menolak perintah (kode …) | Semua perubahan dibatalkan. Kode `55P03` berarti tabel sedang dipakai; hentikan pencatatan atau coba lagi |
| rencana tidak dapat dibuat: ada baris database yang tidak cocok dengan backup | Database dan backup berasal dari snapshot berbeda. Baca `plan.problems` di laporan, lalu pakai dump dari artefak yang sama |
| ada lokasi dokumen yang berubah sejak uji kering | Ada baris yang berubah atau baris baru yang menunjuk dokumen yang sedang dipindahkan. Semua perubahan dibatalkan; hentikan pencatatan, lalu jalankan uji kering lagi |
| PERHATIAN: perubahan sudah tersimpan, tetapi laporan rinci tidak dapat ditulis | Pemulihan berhasil. Simpan ringkasan di layar; jejak perubahan ada di Audit Log. Periksa ruang kosong dan izin folder dokumen |

## 6. Pindahkan layanan

1. **Vercel, proyek `simsa-backend`, Environment Variables Production.** Ganti nilai koneksi database untuk `simsa_api` dan `simsa_worker` dengan login baru (nama variabelnya ada di [antivirus native](DEPLOY_VERCEL_NEON.md#antivirus-native-sesuai-permintaan)). Bila store Blob baru dipakai, sambungkan store baru ke proyek ini khusus Production dengan prefix `SIMSA_PRIVATE_BLOB`, lalu putuskan sambungan store lama. Environment Variables hanya berlaku untuk deployment baru.
2. **Rilis backend.** Bangun kandidat backend dari sumber rilis yang sama lalu promosikan, lewat workflow rilis atau [jalur manual](RUNBOOK_KREDENSIAL_DATABASE.md#jalur-manual-cadangan-bila-workflow-tidak-tersedia). Frontend tidak perlu dirilis ulang.
3. **GitHub, Settings → Environments.**
   - `production-recovery`: secret `NEON_BACKUP_DATABASE_URL` dan `SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN`; variabel `NEON_BACKUP_EXPECTED_HOST`, `NEON_BACKUP_EXPECTED_DATABASE`, dan `OPERATIONS_RECOVERY_EXPECTED_BLOB_HOSTNAME`.
   - `production-integrity`: secret `NEON_WORKER_DATABASE_URL` dan `SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN`; variabel `NEON_WORKER_EXPECTED_HOST`, `NEON_WORKER_EXPECTED_DATABASE`, dan `OPERATIONS_RECOVERY_EXPECTED_BLOB_HOSTNAME`.
   - `production-monitor` dan `production` tidak berubah selama proyek Vercel tetap sama.
4. **Workstation dan password manager.** Perbarui entri password manager untuk semua login baru, serta `SIMSA_NEON_HOST` dan `SIMSA_NEON_DATABASE` di profil PowerShell operator ([penyiapan manual](RUNBOOK_KREDENSIAL_DATABASE.md#penyiapan-manual-readme)).

## 7. Verifikasi

Lakukan berurutan. Layanan baru dinyatakan pulih setelah semua langkah lulus.

1. `node scripts/ops/release-smoke.mjs backend https://simsa-backend.vercel.app` dan `node scripts/ops/release-smoke.mjs frontend https://simsa-frontend.vercel.app` lulus.
2. Jalankan workflow backup (`operations-recovery.yml`) secara manual dan pastikan hijau. Run ini membuktikan kredensial backup yang baru dan menulis status backup ke store yang berlaku.
3. Jalankan workflow integritas (`operations-fixity.yml`) secara manual dan pastikan hijau.
4. Jalankan Operations Monitor secara manual dan pastikan hijau. Run ini juga meminta backend membangunkan pemindai, yang perlu memperbarui verifikasinya pada deployment baru.
5. Super Admin masuk dan membuka **Administrasi → Monitoring Operasional**. Semua kartu harus **Sehat**.
6. Buka satu PDF dari setiap jenis yang ada: surat masuk, surat keluar, lampiran arsip, dan sumber klasifikasi atau JRA. Pratinjau dan unduhan harus berhasil.
7. Jumlah *Dokumen di folder backup* pada ringkasan alat harus sama dengan jumlah dokumen di `BACA-SAYA.txt`. Selisihnya dengan *Dokumen yang dapat dipulihkan* adalah dokumen yang barisnya sudah tidak ada di database (baris *Baris DAFTAR-DOKUMEN tanpa baris database*). Jumlah catatan audit `system:operations-recovery-reupload` di menu **Audit Log** harus sama dengan jumlah lokasi yang ditulis ulang.
8. Umumkan kepada staf bahwa layanan pulih, sebutkan waktu snapshot, dan minta pencatatan sesudah waktu itu diulang dari berkas fisik atau surel. Serahkan daftar berkas tanpa salinan kepada Super Admin.

## 8. Setelah pulih

- Jangan menghapus project Neon, branch, atau store lama sebelum validasi bisnis, integritas, dan audit selesai dan pemilik data menyetujui.
- Isi [catatan waktu](#catatan-waktu) dan perbarui [kondisi produksi](KONDISI_PRODUKSI.md).
- Rotasi kredensial yang mungkin terpapar selama insiden, mengikuti [runbook kredensial](RUNBOOK_KREDENSIAL_DATABASE.md#rotasi-per-role).
- Simpan laporan insiden. Folder plaintext hasil langkah 3 dihapus sesuai aturan kantor setelah tidak diperlukan.

## Catatan waktu

Kolom "Tercatat" berasal dari catatan di repositori. Kolom "Latihan" diisi pada latihan atau insiden berikutnya.

| Langkah | Tercatat | Latihan (isi) |
|---|---|---|
| Backup harian penuh: snapshot, enkripsi, pengambilan dokumen, uji pulih terisolasi, dan publikasi status | 2 menit 27 detik (29 Oktober 2026) dan 2 menit 38 detik (31 Oktober 2026), menurut [laporan C60/C58](rilis/HASIL_RILIS_C60_C58_2026-10-29.md) dan [laporan C65/C61](rilis/HASIL_RILIS_C65_C61_2026-10-31.md) | |
| Uji pulih database lokal dari arsip 560 KB | 31,6 detik (11 September 2026, [catatan riwayat](riwayat/HASIL_PENGUATAN_BACKEND_2026-09-11.md)) | |
| Bagian 4.2–4.4 pada cluster PostgreSQL 18 lokal yang baru (pemilik database `CREATEROLE`/`CREATEDB`, bukan superuser), data sintetis dari 54 migrasi | 14 November 2026: preflight dan bootstrap 0,2 detik; `pg_restore` dengan daftar tersaring 2,2 detik; `migrate --apply` 0,4 detik (`applied: 0`); `provision` backup dan worker masing-masing 0,1 detik; `verify-runtime` 0,1 detik; login worker dan backup lolos pemeriksaan identitas dan hak; 69 tabel dengan jumlah baris sama dengan sumber. Urutan lama (`provision` sebelum `migrate`) gagal pada pemeriksaan grant tanpa meninggalkan login. Latihan memanggil fungsi yang sama dengan perintah di atas secara langsung, karena perintahnya hanya menerima host Neon. | |
| Membuka backup (bagian 3) | Belum tercatat | |
| Project Neon baru sampai `verify-runtime` (bagian 4) | Belum pernah dilatih | |
| Unggah ulang dokumen (bagian 5) | Belum pernah dilatih dengan layanan sungguhan | |
| Kandidat backend sampai promosi (bagian 6) | Kandidat backend siap dalam sekitar 3 menit (rilis C74, 12 November 2026) | |
| Verifikasi (bagian 7) | Belum tercatat | |
| **Total waktu pemulihan (RTO)** | Belum diukur | |
