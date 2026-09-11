# Backup Neon terenkripsi dan uji pemulihan

Perintah ini membuat **backup database sesuai permintaan operator**. Tidak ada jadwal otomatis, unggahan ke object storage, secret GitHub, atau perubahan layanan hosting. Komputer cukup hidup selama perintah berjalan; hal ini belum memenuhi kebutuhan backup cloud otomatis tanpa operator.

Backup mencakup database SIMSA, termasuk akun dan hash kata sandi, sesi, audit, serta referensi berkas. **Isi berkas di object storage, rahasia hosting, dan konfigurasi akun provider tidak termasuk.** Simpan bundle dan kunci secara privat dan terpisah. Salinan pada disk yang sama belum melindungi dari kehilangan disk.

## Prasyarat

- Node.js 24, dependency backend sesuai lockfile, dan executable PostgreSQL 18 lengkap (`pg_dump`, `pg_restore`, `psql`, `initdb`, `pg_ctl`, `pg_controldata`).
- Target Neon direct yang telah melalui bootstrap/migrasi SIMSA; 39 migrasi harus cocok dengan checkout. URL pooler ditolak. Tidak ada perubahan skema oleh perintah backup. Bundle terdahulu dengan 38 migrasi harus dipulihkan memakai checkout/helper yang cocok dengan bundle tersebut.
- Direktori output dan kunci yang dipilih operator, sebaiknya di luar repository. CLI membuat subdirektori baru. Pada Windows, ACL hanya untuk pengguna saat ini dipasang dan diperiksa **sebelum** menulis data; SID pemilik juga harus sama dengan pengguna yang menjalankan perintah. Bundle/kunci yang sudah ada dengan pemilik berbeda ditolak, tanpa mengubah kepemilikannya diam-diam. `mode: 0600` saja tidak dipakai sebagai bukti privasi. Pada Linux, direktori harus dimiliki pengguna dan tidak terbuka untuk grup/pengguna lain.
- Pemulihan membutuhkan PostgreSQL 18 dengan dukungan locale/ICU yang cocok dengan sumber. Perbedaan locale atau fingerprint menggagalkan verifikasi; jangan menghapus pemeriksaannya agar hasil terlihat lulus. Untuk sumber Neon Linux, gunakan lingkungan pemulihan yang mendukung locale sumber. Jalankan `initdb` sebagai pengguna biasa, bukan root.

Pemeriksaan target pada 11 September 2026 menemukan locale Neon `datcollate=C.UTF-8`, `datctype=C.UTF-8`, provider `builtin`, dan `datlocale=C.UTF-8`. PostgreSQL 18 Windows pada workstation menolak nama `LC_COLLATE` tersebut. Menggunakan `BUILTIN_LOCALE` dengan `LC_COLLATE=C` bukan replika identik dari konfigurasi sumber. Uji fixture Windows hanya membuktikan mekanisme pada locale fixture; penerimaan pemulihan Neon memerlukan PostgreSQL 18 Linux yang cocok.

Batas awal: archive `pg_dump` terkompresi maksimal **64 MiB** dan bukti fingerprint maksimal **2 MiB**. Archive sementara berada di memori, tidak ditulis sebagai plaintext dump. Database yang melewati batas memerlukan jalur backup berkapasitas lebih besar; batas tidak boleh dilewati dengan menghilangkan tabel.

## 1. Siapkan akun baca khusus, sekali

Gunakan file environment privat yang dipilih eksplisit dengan `--env-file`. Jangan menaruh password atau URL berkredensial di argumen perintah, Git, tiket, atau tangkapan layar.

```dotenv
# Contoh saja; isi secara privat, jangan commit nilai sebenarnya.
NEON_EXPECTED_HOST=ep-replace-me.ap-southeast-1.aws.neon.tech
NEON_EXPECTED_DATABASE=simsa_cloud
NEON_EXPECTED_ADMIN=administrator_dari_neon
NEON_ADMIN_DATABASE_URL=postgresql://administrator_dari_neon:ISI_PRIVAT@ep-replace-me.ap-southeast-1.aws.neon.tech/simsa_cloud?sslmode=verify-full
NEON_BACKUP_DATABASE_URL=postgresql://simsa_backup:ISI_PASSWORD_ACAK_PRIVAT@ep-replace-me.ap-southeast-1.aws.neon.tech/simsa_cloud?sslmode=verify-full
```

Gunakan password acak berbeda dari akun lain, minimal 32 karakter, dengan URL-encoding bila diperlukan. Dari akar repository:

```powershell
$backupNode = (Resolve-Path 'output/local-runtime/node-v24.21.0-win-x64/node.exe').Path
$backupSetup = Join-Path $env:USERPROFILE '.simsa-cloud-private/neon-backup-setup.env'
& $backupNode "--env-file=$backupSetup" scripts/neon-backup.mjs provision --apply
if ($LASTEXITCODE -ne 0) { throw 'Provisioning backup gagal; jangan lanjut' }
```

Perintah memeriksa pemilik database, struktur role, dan pin tujuan, lalu membuat `simsa_backup` dalam transaksi. Akun hanya mewarisi `simsa_backup_reader`, tanpa `ADMIN OPTION`, kemampuan `SET ROLE`, hak menulis/DDL, atau `pg_read_all_data`. Haknya terbatas pada pembacaan tabel/sequence dan penggunaan schema `public`/`drizzle`. Akun yang sudah ada **tidak di-reset**. Perubahan atribut atau membership tidak diperbaiki diam-diam.

Adapter migrasi Neon memberikan kembali hak baca yang tepat setelah konvergensi grant. Jalankan migrasi berikutnya dengan checkout yang sudah mendukung akun backup opsional ini. Canonical SQL GCP tidak diubah. Pembuatan role tidak berarti backup telah dibuat atau diuji pulih.

Untuk backup berikutnya gunakan file environment privat terpisah yang hanya berisi `NEON_EXPECTED_HOST`, `NEON_EXPECTED_DATABASE`, dan `NEON_BACKUP_DATABASE_URL`. Jangan memberikan kredensial administrator kepada proses backup rutin atau layanan web.

## 2. Buat bundle terenkripsi

Pilih path executable dan direktori privat absolut sesuai mesin:

```powershell
$backupRuntime = Join-Path $env:USERPROFILE '.simsa-cloud-private/neon-backup.env'
$backupPgBin = 'C:\Program Files\PostgreSQL\18\bin'
$backupBundles = Join-Path $env:USERPROFILE '.simsa-cloud-private/database-backups'
$backupKeys = Join-Path $env:USERPROFILE '.simsa-recovery-private/keys'
& $backupNode "--env-file=$backupRuntime" scripts/neon-backup.mjs create --pg-bin $backupPgBin --output $backupBundles --key-directory $backupKeys
if ($LASTEXITCODE -ne 0) { throw 'Backup gagal; jangan menganggap direktori parsial sebagai backup' }
```

Koneksi sumber menggunakan verifikasi sertifikat dan hostname, serta channel binding. `pg_dump` memperoleh CA dari daftar trust Node pada workstation, bukan dari sertifikat tidak terverifikasi. Transaksi sumber bersifat read-only. Dump dan fingerprint memakai snapshot PostgreSQL yang sama; kehilangan koneksi snapshot membatalkan pekerjaan child.

Bundle berisi `database.dump.aesgcm`, `source.evidence.aesgcm`, dan `manifest.json`. Enkripsi AES-256-GCM memakai kunci acak per backup serta nonce terpisah; manifest terautentikasi mengikat sumber, waktu snapshot, hash artefak, helper, dan rantai migrasi. `manifest.json` ditulis terakhir sebagai penanda selesai. Kunci berada di direktori terpisah yang dicetak sebagai `key_file`; nilainya tidak dicetak.

`status: passed` pada operasi `create` berarti bundle selesai dibuat, **bukan** bukti restore. Field `restore_verified` tetap `false`. Backup gagal dapat meninggalkan direktori/kunci parsial privat untuk pemeriksaan operator; tidak ada penghapusan rekursif otomatis.

## 3. Uji pemulihan pada proses terpisah

Jalankan tanpa file environment sumber. Isi path bundle dan kunci dari hasil operasi sebelumnya:

```powershell
$verifyOutput = Join-Path $env:USERPROFILE '.simsa-recovery-private/verification'
& $backupNode scripts/neon-backup.mjs restore-verify --pg-bin $backupPgBin --output $verifyOutput --bundle 'C:\PATH_PRIVAT\BUNDLE' --key-file 'C:\PATH_PRIVAT_TERPISAH\recovery-key.json'
if ($LASTEXITCODE -ne 0) { throw 'Pemulihan belum terbukti; jangan gunakan hasil ini sebagai bukti kesiapan' }
```

Perintah memeriksa ACL, autentikasi manifest, hash, tag GCM **seluruh** payload, dan kecocokan helper/migrasi sebelum menjalankan cluster target. Ia tidak membaca URL/credential sumber maupun menghubungi Neon.

Target selalu direktori baru, PostgreSQL loopback pada port acak 40000–59999 selain 55432. Identitas direktori, port, database administrasi, user, versi, serta system identifier diperiksa sebelum mutasi/penghentian. Tidak menerima argumen untuk menimpa database yang sudah berjalan.

Dump dipulihkan lengkap; kepemilikan dan grant aplikasi ditetapkan kembali pada target. Verifikasi membandingkan fingerprint struktur, locale, migrasi, grant ternormalisasi, jumlah baris dan data, kemudian memeriksa role API tetap terbatas. Hasil baru disebut lulus setelah cluster target berhenti dan port tertutup. Direktori target dan log tetap privat untuk pemeriksaan. Tidak ada penghapusan data sumber atau target otomatis.

Jika proses terputus atau target gagal dihentikan, jangan menghapus PID/direktori secara acak. Periksa hanya direktori target dari operasi tersebut; database lokal aktif di 55432 bukan target. Pertahankan bundle, kunci, dan checkout/helper yang cocok agar verifikasi dapat diulang.

## Batas kesiapan

Tes unit/PGlite atau restore database disposable tidak membuktikan backup data Neon sebenarnya. Catat penerimaan nyata secara terpisah: waktu snapshot, commit/helper, hash bundle, kecocokan fingerprint, dan target sudah berhenti. Jangan menyalin isi baris, session, password, atau kunci ke laporan.

Setelah backup dan restore nyata berhasil, operator tetap perlu memilih lokasi salinan di luar workstation, penanggung jawab, frekuensi backup, masa simpan dan pengujian berkala. Jadwal cloud dan unggahan privat belum dipasang oleh CLI ini. Netlify Scheduled Functions memiliki batas 30 detik sehingga bukan janji bahwa dump dan restore penuh akan selesai. GitHub Actions tidak digunakan sebagai runtime aplikasi atau jalur akses arsip. [Batas fungsi Netlify](https://docs.netlify.com/build/functions/configuration/), [ketentuan Actions](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#actions).

Tes lokal terarah:

```powershell
& $backupNode --test --test-concurrency=1 scripts/neon-backup.test.mjs scripts/neon-backup-policy.test.mjs scripts/neon-database-policy.test.mjs
```
