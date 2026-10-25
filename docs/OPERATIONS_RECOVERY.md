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

Jalankan `node scripts/operations-recovery.mjs run`. Keluaran standar hanya laporan tersanitasi. Batas pengambilan adalah 1.000 referensi, 50 MiB per objek, dan total 200 MiB; batas ini harus ditinjau bila data bertambah, tidak dilewati otomatis. Semua GET menolak redirect dan memakai deadline serta batas ukuran.

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

Setiap run terjadwal juga mencatat `documentBudget` (jumlah dan ukuran dokumen terhadap batas 1.000 file / 200 MiB). Mulai 80% dari salah satu batas, GitHub Actions menampilkan peringatan "SIMSA backup mendekati batas" agar batas dinaikkan sebelum backup gagal.

## Memulihkan artefak delivery yang sudah diunduh

Gunakan checkout yang hash helper dan jurnal migrasinya cocok dengan manifest autentik, runtime Linux PostgreSQL 18 yang kompatibel, dan direktori artefak privat milik operator (0700, tanpa symlink). Isi `OPERATIONS_RECOVERY_BUNDLE` dengan direktori delivery, serta `BACKUP_ENCRYPTION_PASSPHRASE`, `OPERATIONS_RECOVERY_PG_BIN`, dan `OPERATIONS_RECOVERY_PRIVATE_ROOT`. Jalankan `node scripts/operations-recovery.mjs restore-delivery`.

Mode tersebut tidak membaca credential sumber Neon/Blob, tidak terhubung ke produksi, tidak membutuhkan password login pengguna aplikasi, serta selalu memakai target baru. Kunci dibuka di RAM. Salah passphrase, perubahan hash helper/jurnal, ciphertext rusak, locale berbeda, dan izin tidak cocok akan menggagalkan proses. Jangan memulihkan ke cluster produksi memakai helper ini.

## Status panel dan aktivasi CI

`operations/recovery-status-v1.json` di Blob privat menyimpan `schemaVersion:1` dan objek `backup` serta `restore`, masing-masing dengan `status`, `completedAt`, `evidenceSha256`, `databaseVerified`, dan `documentsVerified`. Bukti setiap percobaan lebih dahulu ditulis ke `operations/recovery-runs/<runId>.json` tanpa overwrite. Status terbaru boleh berubah menjadi gagal; kegagalan publikasi juga menghasilkan exit nonzero. Status berhasil tidak diberikan untuk dokumen parsial atau target yang belum terbukti berhenti. Panel menganggap umur backup lebih dari 36 jam dan restore lebih dari 90 hari perlu perhatian.

`SIMSA_PRIVATE_BLOB_STORE_ID` milik control plane Vercel berbentuk `store_<id>`. Nilai ini bukan awalan hostname dalam token dan tidak dibandingkan dengannya. Token alias privat, hostname yang diturunkan SDK dari token, dan URL dokumen dalam snapshot adalah batas pemilihan store; pin hostname tambahan di atas direkomendasikan untuk publikasi status.

Workflow `.github/workflows/operations-recovery.yml` berjalan pada default branch yang terlindungi dan environment khusus `production-recovery`. Environment lama `production-backup` menunjuk target database berbeda dan dipertahankan tanpa perubahan. Konfigurasi baru harus memverifikasi pin database dan store privat, menyediakan credential recovery terpisah, serta menyimpan passphrase pemulihan secara privat; jangan mengganti atau memakai ulang target lama secara otomatis. Aktivasi memerlukan repository variable `OPERATIONS_RECOVERY_ENABLED=true`, secret/variable environment di tabel, dan pembatasan deployment branch environment. Workflow lama `backup-neon.yml` yang memakai profil schema historis tidak menggantikan alur ini. Waktu selesai backup pada status menggunakan waktu snapshot database; waktu pengambilan byte dicatat terpisah agar umur backup tidak diperpanjang oleh proses restore.

File workflow telah disiapkan, tetapi merge ke protected default branch, aktivasi, dan run GitHub pertama harus diverifikasi tersendiri. Tidak ada public PR dibuat oleh pekerjaan recovery ini. Uji lokal, bukti restore aktual, dan kesiapan konfigurasi tidak boleh dilaporkan sebagai jadwal CI yang sudah berjalan.
