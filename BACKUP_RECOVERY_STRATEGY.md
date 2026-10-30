# Strategi Backup & Recovery SIMSA

Produksi memakai database Neon PostgreSQL dan dokumen privat di Vercel Blob.
Dokumen ini merangkum strategi; prosedur rinci ada di
[cadangan dan pemulihan](docs/OPERATIONS_RECOVERY.md),
[backup Neon manual](docs/BACKUP_NEON.md), dan
[runbook kredensial database](docs/RUNBOOK_KREDENSIAL_DATABASE.md).

## Cakupan dan status

Backup SIMSA terdiri dari dua domain yang harus dapat dipulihkan bersama:

| Domain | Mekanisme | Catatan |
|---|---|---|
| PostgreSQL Neon | Workflow `.github/workflows/operations-recovery.yml` (harian 00:15 UTC, env `production-recovery`): snapshot konsisten dengan role `simsa_backup`, `pg_dump` terenkripsi, lalu pemulihan ke cluster PostgreSQL 18 baru yang diverifikasi. PITR/branch Neon sesuai plan proyek. | Aktif bila repository variable `OPERATIONS_RECOVERY_ENABLED=true`; status terbaru tampil pada panel Super Admin. |
| Dokumen privat (Vercel Blob) | Workflow yang sama mengambil seluruh dokumen yang dirujuk database, mencocokkan hash/ukuran, mengenkripsinya, dan memulihkannya ke penyimpanan recovery terenkripsi. | Batas 1.000 berkas / 200 MiB; peringatan muncul mulai 80%. |
| Backup manual operator | `scripts/neon-backup.mjs` membuat bundle database terenkripsi dan dapat menguji pemulihan. | Tidak mencakup byte dokumen privat. |

Artefak workflow disimpan GitHub selama 14 hari. Salinan jangka panjang wajib
diunduh berkala ke penyimpanan milik kantor beserta commit-nya, dan passphrase
pemulihan disimpan terpisah (lihat `docs/OPERATIONS_RECOVERY.md`).

Retensi PITR/branch bergantung pada plan dan konfigurasi project Neon yang aktif.
Verifikasi nilainya langsung di console dan simpan bukti konfigurasi; jangan
mengandalkan asumsi plan dalam dokumen ini. RPO/RTO baru boleh disahkan dari
hasil drill terukur.

## Evidence database

Bundle database mengikat hash helper dan seluruh jurnal migrasi checkout. Selama
rantai journal di `main` berbeda dengan rantai database produksi, backup
terjadwal gagal; rapatkan jarak antara merge migrasi dan penerapannya, atau ambil
backup manual dengan checkout yang cocok.

Collector `.github/scripts/collect-backup-evidence.sql` mengenal profil migrasi
berikut:

- `pre_migration` harus persis berisi 21 timestamp Drizzle dari `0000` sampai
  `0020_permanent_transfer_lifecycle`;
- `pre_upgrade_0038` tepat sampai `0038_arsip_direct_upload`, untuk cadangan
  sebelum upgrade 0039;
- `post_migration` harus persis berisi seluruh timestamp dan hash migrasi
  dalam journal checkout yang direview; jumlahnya tidak disalin ke dokumen.

Mode `auto` collector hanya menerima salah satu chain yang telah direview
dan mencatat profil hasil resolusinya. Riwayat parsial di antara baseline,
duplikat, timestamp tak dikenal, atau
migrasi di luar profil ditolak. Evidence mencakup profil terpilih, identitas
lengkap riwayat migrasi, fingerprint SHA-256 schema semantik, jumlah persis
setiap tabel, dan fingerprint konten setiap regular/leaf table pada schema
`public` serta `drizzle`.
Fingerprint dibuat sebelum dump pada snapshot yang diimpor oleh `pg_dump`, jadi
aktivitas transaksi yang terjadi selama backup tidak menghasilkan perbandingan
palsu.

Setiap hash riwayat migrasi aktual tetap dibandingkan persis antara sumber dan
restore. Migrasi `0010` dan seterusnya hanya menerima SHA-256 SQL checkout LF.
Untuk `0000`–`0009`, verifier menerima SHA-256 checkout LF atau tepat satu
variant legacy per migrasi yang telah direkonsiliasi terhadap metadata
Production dan riwayat Git; hash lain tetap ditolak. Daftar variant dibatasi di
helper verifier, bukan ambang atau wildcard, dan `.gitattributes` menetapkan LF
untuk migrasi berikutnya.

Fingerprint schema sengaja tidak mencakup owner dan ACL karena dump/restore
memakai `--no-owner --no-privileges`; grant dibangun ulang dan diuji oleh
prosedur pemulihan. Fingerprint tetap mencakup urutan logis kolom,
struktur constraint/index, ekspresi check/index dan predicate, kolom/kunci,
operator exclusion, status validasi, aksi foreign key, sequence beserta
ownership/parameter, dan extension. Normalisasi ekspresi hanya menghapus cast
text/array dan wrapper literal-array yang ekuivalen akibat dump/restore, serta
satu bentuk asosiasi `AND` legacy yang dikenal. Ordered raw single/double-quoted
tokens ikut di-hash, sehingga whitespace/cast-like text di dalam literal atau
quoted identifier tetap sensitif; grouping parentheses lain juga dipertahankan.

## Role sumber least-privilege

Backup membaca sumber dengan login `simsa_backup` yang hanya mewarisi peran
NOLOGIN `simsa_backup_reader` (SELECT pada schema `public` dan `drizzle`), tanpa
keanggotaan global `pg_read_all_data`. Peran dan grant disiapkan oleh
`scripts/neon-backup-role.mjs` serta grant kanonis; rotasi kata sandi mengikuti
runbook kredensial database. Jangan memakai credential akun aplikasi untuk backup.

## Restore

Selalu pulihkan ke database baru/terisolasi terlebih dahulu; jangan mengarahkan
drill ke Production. `scripts/operations-recovery.mjs restore-delivery` memulihkan
artefak workflow yang sudah diunduh, dan `scripts/operations-recovery-extract.mjs`
membukanya menjadi dump serta PDF yang dapat dibaca. Restore database yang
berhasil tetapi bitstream tidak dapat diambil atau hash berbeda tetap merupakan
drill gagal.

## Prosedur pre-migration dan insiden

Sebelum migrasi Production:

1. pastikan backup terjadwal terakhir hijau, atau ambil backup manual dengan
   checkout yang cocok, dan catat artefaknya;
2. buat branch/PITR Neon dari titik yang sama dan catat timestamp;
3. pastikan restore terisolasi terakhir berhasil; lalu
4. jalankan migrasi hanya setelah approval operasional.

Saat insiden, pulihkan ke environment terpisah, bandingkan snapshot dengan
Production, dan salin data kembali hanya melalui prosedur yang diaudit. Jangan
melakukan restore in-place atau menghapus branch/object lama sebelum validasi
bisnis, fixity, audit, serta persetujuan pemilik data selesai.

## Bukti berkala

| Frekuensi | Bukti minimum |
|---|---|
| Harian | Workflow `operations-recovery.yml` hijau dan status backup/restore terbaru pada panel Super Admin |
| Bulanan | Unduh artefak terbaru ke penyimpanan kantor, uji buka dengan `operations-recovery-extract.mjs`, serta ukur RPO/RTO |
| Sebelum deploy/migrasi | Backup database–dokumen terbaru, branch/PITR, restore terisolasi, approval |
