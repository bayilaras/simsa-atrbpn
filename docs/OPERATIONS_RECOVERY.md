# Cadangan dan pemulihan database serta dokumen privat

Alur baru ada di `scripts/operations-recovery.mjs`. Alur ini membaca sumber Neon dengan role `simsa_backup`, membuat arsip terenkripsi, mengambil dokumen privat, lalu benar-benar memulihkan database ke cluster PostgreSQL 18 baru dan dokumen ke penyimpanan recovery terenkripsi. Database produksi tidak ditulis. Cluster recovery hanya menerima koneksi loopback dan dihentikan sesudah verifikasi identitasnya.

## Bukti yang diwajibkan

Database menggunakan snapshot konsisten, autentikasi bundle, hash helper, dan jurnal migrasi persis sesuai checkout. Verifikasi pemulihan membandingkan semua hitungan tabel, hash isi, schema, constraints, indexes, triggers, routines, sequences, extensions, grants, locale, serta jurnal. Role API terbatas juga diuji. Role `simsa_worker` dipulihkan dengan batas izin existing dan password baru dalam RAM. Daftar login target restore (`RESTORE_LOGIN_ROLES` di `scripts/neon-database-policy.mjs`) dipakai bersama oleh pemulihan operasional dan `neon-backup.mjs restore-verify`, sehingga keduanya tidak dapat berbeda lagi.

Dokumen mencakup seluruh `file_attachments` dan sumber privat `regulatory_rule_sets`. Lease unggahan bukan salinan dokumen tambahan; database tetap menyimpan seluruh metadata lease. Hash dan ukuran existing wajib cocok. Dokumen dengan hash null ditolak secara default. Operator dapat memilih `OPERATIONS_RECOVERY_CAPTURE_MISSING_HASHES=true` untuk mencatat hash byte pertama dalam manifest cadangan: ini **tidak mengubah database dan tidak membuktikan integritas historis yang sebelumnya tidak dicatat**. Hash malformed atau berbeda tetap ditolak.

Dokumen dan manifest dienkripsi AES-256-GCM, terikat pada hash arsip database. Pemulihan membaca ulang ciphertext, memeriksa autentikasi dan semua hash, lalu mengenkripsi ulang ke target baru. Gateway recovery loopback menguji unduhan dengan bearer acak, menolak akses anonim, dan dihentikan setelah selesai. Gateway ini tidak mewakili seluruh RBAC atau login Google aplikasi. Pengambilan dokumen melalui API aplikasi, bila dilakukan oleh operator, dicatat terpisah dari verifikasi gateway recovery.

Database sumber pada uji operator 15 September 2026 berasal dari snapshot 14 September 2026 pukul 17:46:45 UTC, jurnal 46 migrasi. Pemulihan PostgreSQL 18.6 di WSL Linux berhasil: 63 hitungan tabel, 63 hash isi, dan keseluruhan 140 baris fingerprint cocok persis; role API dan penghentian target berhasil. Uji ini bukan klaim bahwa scheduler telah aktif.

## Konfigurasi pekerjaan terjadwal

Runtime: Node 24, PostgreSQL 18 di Linux, dijalankan oleh pengguna OS non-root. Cluster sumber memakai locale builtin `C.UTF-8`; uji Windows ditolak oleh PostgreSQL karena locale tidak kompatibel. Jangan menghapus pemeriksaan locale untuk meloloskan pemulihan.

Variabel dan secret berikut disediakan melalui environment privat, tidak sebagai argumen command atau isi repository:

| Nama | Jenis dan tujuan |
|---|---|
| `NEON_BACKUP_DATABASE_URL` | Secret koneksi langsung role read-only `simsa_backup`, TLS/channel binding diwajibkan oleh helper |
| `NEON_EXPECTED_HOST`, `NEON_EXPECTED_DATABASE` | Pin target sumber; URL harus cocok persis |
| `SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN` | Alias secret store privat, bukan token Blob legacy |
| `OPERATIONS_RECOVERY_EXPECTED_BLOB_HOSTNAME` | Opsional, pin hostname privat yang independen; setiap URL GET tetap harus cocok dengan hostname token |
| `BACKUP_ENCRYPTION_PASSPHRASE` | Secret sekurangnya 32 karakter untuk membungkus kunci recovery |
| `OPERATIONS_RECOVERY_PG_BIN` | Direktori absolut binary PostgreSQL 18 |
| `OPERATIONS_RECOVERY_PRIVATE_ROOT` | Direktori privat untuk workspace baru; cluster existing tidak dipakai ulang |
| `OPERATIONS_RECOVERY_DELIVERY` | Direktori baru untuk artefak terenkripsi dan laporan tersanitasi |
| `OPERATIONS_RECOVERY_CAPTURE_MISSING_HASHES` | Opsional, tepat `true` untuk kebijakan pencatatan hash null di atas |
| `OPERATIONS_RECOVERY_PUBLISH_STATUS` | Opsional, tepat `true` untuk publikasi bukti ke Blob privat |

Jalankan `node scripts/operations-recovery.mjs run`. Keluaran standar hanya laporan tersanitasi. Batas pengambilan adalah 1.000 referensi, 100 objek tersimpan unik, 50 MiB per objek, dan total 160 MiB objek unik. Objek dihitung setelah deduplikasi URL, sama dengan yang benar-benar diunduh: beberapa referensi ke berkas yang sama hanya diunduh dan dihitung sekali. Batas ini tidak dilewati otomatis. Semua GET menolak redirect dan memakai deadline serta batas ukuran.

### Batas dokumen dan kuota Blob

Batas di atas menjaga kuota Blob paket Vercel Hobby. Setiap run, terjadwal maupun manual, mengunduh ulang semua objek unik dengan `cache=0`; tiap unduhan dihitung sebagai satu *simple operation* ditambah transfer data Blob. Hobby menyediakan 10 GB transfer Blob dan 10.000 *simple operations* per 30 hari. Bila terlampaui, akses Blob diblokir 30 hari, sehingga unggah, unduh, pemindaian, dan backup produksi ikut berhenti. Dengan backup penuh harian (ditambah run manual seperti pada Oktober 2026), 160 MiB objek unik memakai sekitar 6–7 GB transfer per bulan, dan 100 objek memakai sekitar 7.800–8.500 operasi termasuk pemakaian aplikasi lain.

Sisa ruang saat ini lebih kecil dari satu batch unggah massal. Pada 31 Oktober 2026 terdapat 19 objek unik berukuran sekitar 74,1 MiB, jadi sisanya sekitar 85,9 MiB, sedangkan satu batch unggah massal yang diizinkan aplikasi bisa mencapai 50 berkas / 100 MiB. Satu unggahan massal penuh sudah cukup membuat backup harian berikutnya gagal, padahal rasio pemakaian baru 46%. Karena itu peringatan sisa ruang sudah aktif pada setiap run sampai pemilik memutuskan langkah di bawah.

Bila batas terlampaui, run gagal pada tahap `document_inventory` (`DOCUMENT_BYTES_OUTSIDE_BUDGET`, `DOCUMENT_OBJECTS_OUTSIDE_BUDGET`, atau `DOCUMENT_COUNT_OUTSIDE_BUDGET`) sebelum GET dokumen pertama. Database terenkripsi dan kunci terbungkus sudah tersimpan di artefak, tetapi status backup merah. Artefak itu tidak berisi manifest dokumen, sehingga `operations-recovery-extract.mjs` dan `restore-delivery` gagal pada bagian dokumen; pakai artefak hijau terakhir sampai batas ditinjau.

Menaikkan batas memerlukan keputusan pemilik: pindah ke paket Pro (misalnya 1 GiB dan 1.000 objek, dengan `timeout-minutes` 60), atau mengubah desain menjadi backup dokumen penuh mingguan ditambah inkremental harian. Selama masih Hobby, batasi run manual `workflow_dispatch` karena tiap run adalah pengunduhan penuh.

Kunci arsip database dan dokumen dibungkus menggunakan scrypt (N=32768, r=8, p=1) dan AES-GCM dengan salt baru. Artefak delivery hanya berisi ciphertext, manifest, parameter KDF, dan laporan. **Jangan mengunggah workspace privat atau direktori kunci mentah.** Database terenkripsi dan kunci terbungkus disimpan sebelum fase berikutnya supaya kegagalan pengambilan dokumen/pemulihan tidak menghilangkan cadangan database yang sudah valid.

## Masa simpan artefak

Artefak `simsa-recovery-<run_id>-<attempt>` disimpan GitHub selama **14 hari** (sebelumnya 90 hari). Repositori bersifat publik, sehingga artefak terenkripsi dapat diunduh pengguna GitHub mana pun selama masa simpan; masa simpan pendek membatasi paparan itu dan menjaga penyimpanan artefak tetap kecil bila repositori kelak dijadikan privat (kuota penyimpanan paket gratis 500 MB, satu artefak ±79 MB). Artefak yang sudah ada tetap mengikuti tanggal kedaluwarsa lamanya.

Konsekuensinya, salinan jangka panjang **wajib** disimpan di luar GitHub: unduh artefak terbaru setidaknya sebulan sekali ke penyimpanan milik kantor beserta kode commit-nya, dan simpan passphrase pemulihan di media terpisah.

## Membuka backup menjadi file yang bisa dibaca

`scripts/operations-recovery-extract.mjs` membuka artefak `simsa-recovery-*` yang sudah diunduh menjadi:

| Hasil | Isi |
|---|---|
| `database/simsa.dump` | Arsip `pg_dump` format custom, siap `pg_restore` ke PostgreSQL 18 kosong |
| `dokumen/<entity_type>/<entity_id>/<nama file>` | Semua PDF asli; ukuran dan SHA-256 dicocokkan dengan manifest terautentikasi |
| `DAFTAR-DOKUMEN.csv` | Pemetaan PDF ke surat/arsip (`entity_type`, `entity_id`, nama file, hash, lokasi) |
| `BACA-SAYA.txt`, `MANIFEST.sha256` | Ringkasan snapshot dan hash setiap file |

Alat ini hanya memakai modul bawaan Node (tanpa `npm install`, tanpa PostgreSQL) sehingga bisa dijalankan di laptop Windows operator. Seluruh database dan manifest dokumen diautentikasi sebelum file pertama ditulis. Berbeda dengan `restore-delivery`, alat ini **tidak** mensyaratkan hash helper sama dengan checkout saat ini, sehingga artefak dari versi kode lama juga bisa dibuka; keaslian tetap dijamin HMAC manifest dan AES-GCM. Nama file asli tersedia untuk artefak yang dibuat setelah perubahan ini; artefak lama memakai nama objek penyimpanan.

Hasilnya **plaintext** (data dinas dan data pribadi). Folder tujuan wajib baru dan berada di luar repositori; simpan hanya di media terenkripsi milik kantor.

Langkah di PowerShell (passphrase diketik sendiri oleh pemegangnya, tidak tampil di layar):

```powershell
Expand-Archive "$HOME\Downloads\simsa-recovery-<run_id>-1.zip" "$HOME\Downloads\simsa-recovery-<run_id>-1"
$s = Read-Host "Passphrase backup" -AsSecureString
$env:BACKUP_ENCRYPTION_PASSPHRASE = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
node scripts/operations-recovery-extract.mjs --bundle "$HOME\Downloads\simsa-recovery-<run_id>-1" --output "E:\PEMULIHAN-SIMSA-<tanggal>"
Remove-Item Env:BACKUP_ENCRYPTION_PASSPHRASE
```

Setiap run terjadwal juga mencatat `documentBudget` di laporan run: jumlah referensi, objek unik, dan ukuran objek unik terhadap batas 1.000 / 100 / 160 MiB, beserta sisa ruang masing-masing. GitHub Actions menampilkan peringatan "SIMSA backup mendekati batas" bila pemakaian mencapai 75% dari salah satu batas (`ratioWarning`) **atau** sisa ruang lebih kecil dari satu batch unggah massal, yaitu 50 berkas / 100 MiB (`headroomWarning`). Peringatan ini bukan jaminan bahwa backup tidak akan langsung gagal: beberapa batch dalam satu hari tetap bisa melewati batas sebelum run berikutnya. Run yang gagal karena batas tetap mencatat `documentBudget` dan menampilkan anotasi error "SIMSA backup melewati batas dokumen" berisi angka pemakaiannya. Tinjau kuota Blob (lihat [Batas dokumen dan kuota Blob](#batas-dokumen-dan-kuota-blob)) sebelum menaikkan batas.

## Memulihkan artefak delivery yang sudah diunduh

Gunakan checkout yang hash helper dan jurnal migrasinya cocok dengan manifest autentik, runtime Linux PostgreSQL 18 yang kompatibel, dan direktori artefak privat milik operator (0700, tanpa symlink). Isi `OPERATIONS_RECOVERY_BUNDLE` dengan direktori delivery, serta `BACKUP_ENCRYPTION_PASSPHRASE`, `OPERATIONS_RECOVERY_PG_BIN`, dan `OPERATIONS_RECOVERY_PRIVATE_ROOT`. Jalankan `node scripts/operations-recovery.mjs restore-delivery`.

Mode tersebut tidak membaca credential sumber Neon/Blob, tidak terhubung ke produksi, tidak membutuhkan password login pengguna aplikasi, serta selalu memakai target baru. Kunci dibuka di RAM. Salah passphrase, perubahan hash helper/jurnal, ciphertext rusak, locale berbeda, dan izin tidak cocok akan menggagalkan proses. Jangan memulihkan ke cluster produksi memakai helper ini.

## Status panel dan aktivasi CI

`operations/recovery-status-v1.json` di Blob privat menyimpan `schemaVersion:1` dan objek `backup` serta `restore`, masing-masing dengan `status`, `completedAt`, `evidenceSha256`, `databaseVerified`, dan `documentsVerified`. Bukti setiap percobaan lebih dahulu ditulis ke `operations/recovery-runs/<runId>.json` tanpa overwrite. Status terbaru boleh berubah menjadi gagal; kegagalan publikasi juga menghasilkan exit nonzero. Status berhasil tidak diberikan untuk dokumen parsial atau target yang belum terbukti berhenti. Panel menganggap umur backup lebih dari 36 jam dan restore lebih dari 90 hari perlu perhatian.

`SIMSA_PRIVATE_BLOB_STORE_ID` milik control plane Vercel berbentuk `store_<id>`. Nilai ini bukan awalan hostname dalam token dan tidak dibandingkan dengannya. Token alias privat, hostname yang diturunkan SDK dari token, dan URL dokumen dalam snapshot adalah batas pemilihan store; pin hostname tambahan di atas direkomendasikan untuk publikasi status.

Workflow `.github/workflows/operations-recovery.yml` berjalan pada default branch yang terlindungi dan environment khusus `production-recovery`, satu-satunya environment backup. Environment lama `production-backup` dan `gcp-production-backup` sudah dihapus pada 31 Oktober 2026. Konfigurasi harus memverifikasi pin database dan store privat, menyediakan credential recovery terpisah, serta menyimpan passphrase pemulihan secara privat. Aktivasi memerlukan repository variable `OPERATIONS_RECOVERY_ENABLED=true`, secret/variable environment di tabel, dan pembatasan deployment branch environment. Workflow lama `backup-neon.yml` sudah dihapus dari repository; alur ini satu-satunya backup terjadwal. Waktu selesai backup pada status menggunakan waktu snapshot database; waktu pengambilan byte dicatat terpisah agar umur backup tidak diperpanjang oleh proses restore.

File workflow telah disiapkan, tetapi merge ke protected default branch, aktivasi, dan run GitHub pertama harus diverifikasi tersendiri. Tidak ada public PR dibuat oleh pekerjaan recovery ini. Uji lokal, bukti restore aktual, dan kesiapan konfigurasi tidak boleh dilaporkan sebagai jadwal CI yang sudah berjalan.

## Bukti database dalam bundle

Bundle database mengikat hash helper dan seluruh jurnal migrasi checkout. Selama rantai jurnal di `main` berbeda dengan rantai database produksi, backup terjadwal gagal; rapatkan jarak antara merge migrasi dan penerapannya, atau ambil backup manual dengan checkout yang cocok.

Collector `.github/scripts/collect-backup-evidence.sql` mengenal profil migrasi berikut:

- `pre_migration` harus persis berisi 21 timestamp Drizzle dari `0000` sampai `0020_permanent_transfer_lifecycle`;
- `pre_upgrade_0038` tepat sampai `0038_arsip_direct_upload`, untuk cadangan sebelum upgrade 0039;
- `post_migration` harus persis berisi seluruh timestamp dan hash migrasi dalam jurnal checkout yang direview; jumlahnya tidak disalin ke dokumen.

Mode `auto` collector hanya menerima salah satu rantai yang telah direview dan mencatat profil hasil resolusinya. Riwayat parsial di antara baseline, duplikat, timestamp tak dikenal, atau migrasi di luar profil ditolak. Bukti mencakup profil terpilih, identitas lengkap riwayat migrasi, fingerprint SHA-256 schema semantik, jumlah persis setiap tabel, dan fingerprint konten setiap regular/leaf table pada schema `public` serta `drizzle`. Fingerprint dibuat sebelum dump pada snapshot yang diimpor oleh `pg_dump`, jadi aktivitas transaksi selama backup tidak menghasilkan perbandingan palsu.

Setiap hash riwayat migrasi aktual dibandingkan persis antara sumber dan hasil pemulihan. Migrasi `0010` dan seterusnya hanya menerima SHA-256 SQL checkout LF. Untuk `0000`–`0009`, verifier menerima SHA-256 checkout LF atau tepat satu varian lama per migrasi yang telah direkonsiliasi terhadap metadata produksi dan riwayat Git; hash lain ditolak. Daftar varian dibatasi di helper verifier, bukan ambang atau wildcard, dan `.gitattributes` menetapkan LF untuk migrasi berikutnya.

Fingerprint schema sengaja tidak mencakup owner dan ACL karena dump/restore memakai `--no-owner --no-privileges`; grant dibangun ulang dan diuji oleh prosedur pemulihan. Fingerprint tetap mencakup urutan logis kolom, struktur constraint/index, ekspresi check/index dan predicate, kolom/kunci, operator exclusion, status validasi, aksi foreign key, sequence beserta ownership/parameter, dan extension. Normalisasi ekspresi hanya menghapus cast text/array dan wrapper literal-array yang ekuivalen akibat dump/restore, serta satu bentuk asosiasi `AND` lama yang dikenal. Token raw single/double-quoted yang berurutan ikut di-hash, sehingga whitespace atau teks mirip cast di dalam literal atau quoted identifier tetap sensitif; tanda kurung pengelompokan lain juga dipertahankan.

## Sebelum migrasi produksi dan saat insiden

Retensi PITR/branch bergantung pada plan dan konfigurasi project Neon yang aktif. Verifikasi nilainya langsung di console dan simpan bukti konfigurasinya; RPO/RTO baru boleh disahkan dari hasil drill terukur.

Sebelum migrasi produksi:

1. pastikan backup terjadwal terakhir hijau, atau ambil backup manual ([backup Neon](BACKUP_NEON.md)) dengan checkout yang cocok, dan catat artefaknya;
2. buat branch/PITR Neon dari titik yang sama dan catat timestamp;
3. pastikan pemulihan terisolasi terakhir berhasil; lalu
4. jalankan migrasi hanya setelah approval operasional.

Saat insiden, pulihkan ke environment terpisah, bandingkan snapshot dengan produksi, dan salin data kembali hanya melalui prosedur yang diaudit. Jangan melakukan restore in-place atau menghapus branch/objek lama sebelum validasi bisnis, fixity, audit, serta persetujuan pemilik data selesai. Pemulihan database yang berhasil tetapi dokumennya tidak dapat diambil atau hash-nya berbeda tetap dihitung sebagai drill gagal.

## Bukti berkala

| Frekuensi | Bukti minimum |
|---|---|
| Harian | Workflow `operations-recovery.yml` hijau dan status backup/restore terbaru pada panel Super Admin |
| Bulanan | Unduh artefak terbaru ke penyimpanan kantor, uji buka dengan `operations-recovery-extract.mjs`, serta ukur RPO/RTO |
| Sebelum deploy/migrasi | Backup database dan dokumen terbaru, branch/PITR, pemulihan terisolasi, approval |
