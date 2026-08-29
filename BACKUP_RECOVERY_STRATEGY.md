# Strategi Backup & Recovery SIMSA

## Cakupan dan status

Backup SIMSA terdiri dari dua domain yang harus dapat dipulihkan bersama:

| Domain | Mekanisme | Status bukti |
|---|---|---|
| PostgreSQL Neon | PITR/branch Neon dan `pg_dump` custom-format terenkripsi harian | Workflow tersedia; run dengan secret baru dan drill independen masih wajib dibuktikan |
| Private Blob | Salinan bitstream ke penyimpanan privat independen, manifest hash, retensi, dan drill restore | **Blocker eksternal — belum tersedia di repositori ini** |

`pg_dump` hanya mencadangkan metadata, locator, dan hash objek yang tersimpan di
PostgreSQL. Byte PDF/lampiran di private Blob tidak masuk ke archive database.
Karena itu workflow database hijau tidak boleh dianggap sebagai backup SIMSA
lengkap dan tidak menghapus blocker private Blob.

Retensi PITR/branch bergantung pada plan dan konfigurasi project Neon yang aktif.
Verifikasi nilainya langsung di console dan simpan bukti konfigurasi; jangan
mengandalkan asumsi plan dalam dokumen ini. RPO/RTO baru boleh disahkan dari
hasil drill terukur.

## Backup database harian

Workflow `.github/workflows/backup-neon.yml` berjalan terjadwal pukul 00:00 UTC
dan dapat dipicu manual. Alurnya:

1. hanya berjalan dari ref branch default dan mengambil dua secret serta dua
   variabel identitas target dari GitHub Environment terlindungi
   `production-backup`;
2. menolak endpoint pooled/non-Neon dan database maintenance, mewajibkan tepat
   satu `sslmode=verify-full`, `channel_binding=require`, serta
   `sslrootcert=system`, membuktikan TLS/protokol/cipher dari sisi libpq,
   lalu memvalidasi role sumber efektif hanya-baca pada seluruh relasi/sekuens
   schema `public` dan `drizzle`;
3. membuka transaksi `SERIALIZABLE READ ONLY DEFERRABLE`, mengekspor satu
   snapshot, dan pada snapshot yang sama membuat evidence sumber serta
   menjalankan `pg_dump --format=custom`;
4. mengalirkan dump terkompresi langsung ke enkripsi simetris AES-256 tanpa file
   dump plaintext; manifest evidence yang hanya berisi count/hash juga
   dienkripsi;
5. mengunggah kedua file terenkripsi sebagai artifact immutable per-run selama
   30 hari;
6. pada job/runner baru, mengunduh artifact, merekam digest artifact dari job
   upload serta memvalidasi keras SHA-256 masing-masing file, membaca TOC melalui stream dekripsi, lalu
   mengalirkan dekripsi ke `pg_restore --create` PostgreSQL 18 yang terisolasi
   agar nama database dan properti locale sumber ikut dibangun ulang; dan
7. menghitung ulang evidence pada hasil restore serta mewajibkan kecocokan byte
   dengan evidence sumber sebelum keseluruhan workflow dinyatakan hijau.

Run manual wajib memilih profil migrasi yang tepat:

- `pre_migration` harus persis berisi 21 timestamp Drizzle dari `0000` sampai
  `0020_permanent_transfer_lifecycle`; inilah profil backup wajib sebelum
  migrasi `0021`–`0029`;
- `post_migration` harus persis berisi 30 timestamp Drizzle dari `0000` sampai
  `0029_outgoing_security_classification`.

Run terjadwal memakai mode `auto` yang hanya menerima tepat salah satu dari dua
profil tersebut, lalu mencatat profil hasil resolusinya; karena itu backup harian
tetap berjalan sebelum dan sesudah maintenance window tanpa menerima keadaan
transisi. Riwayat parsial (22–29 migrasi), duplikat, timestamp tak dikenal, atau
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
memakai `--no-owner --no-privileges`; grant harus dibangun ulang dan diuji oleh
prosedur provisioning target. Fingerprint tetap mencakup urutan logis kolom,
struktur constraint/index, ekspresi check/index dan predicate, kolom/kunci,
operator exclusion, status validasi, aksi foreign key, sequence beserta
ownership/parameter, dan extension. Normalisasi ekspresi hanya menghapus cast
text/array dan wrapper literal-array yang ekuivalen akibat dump/restore, serta
satu bentuk asosiasi `AND` legacy yang dikenal. Ordered raw single/double-quoted
tokens ikut di-hash, sehingga whitespace/cast-like text di dalam literal atau
quoted identifier tetap sensitif; grouping parentheses lain juga dipertahankan.
Archive terenkripsi, checksum member, restore `--exit-on-error`, serta evidence
seluruh row menjadi lapisan integritas pelengkap. Nilai berjalan sequence tidak
di-hash dari snapshot karena sequence bersifat non-MVCC; workflow mewajibkan
jumlah `SEQUENCE SET` pada TOC sama dengan jumlah sequence hasil restore dan
seluruh perintah itu berhasil di `pg_restore`.

Verifikasi ini membuktikan konsistensi database sumber–restore, bukan
konsistensi byte private Blob dan bukan smoke test perilaku aplikasi. Keduanya
tetap wajib dalam drill rilis terpisah.

PostgreSQL image serta action checkout/upload/download dipatok ke digest/commit. Tidak ada langkah
yang membuat branch Neon, mengubah deployment, atau membaca/menyalin private
Blob.

### Role sumber least-privilege

Buat credential terpisah dari akun aplikasi, misalnya `simsa_backup`. Role itu
harus `LOGIN`, `INHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`,
`NOREPLICATION`, dan `NOBYPASSRLS`, menjadi anggota `pg_read_all_data`, serta
tidak menjadi anggota `pg_write_all_data`. Role tidak boleh memiliki hak efektif
`CREATE` pada database atau schema `public`/`drizzle`, maupun `INSERT`, `UPDATE`,
`DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, atau `MAINTAIN` pada relasi apa
pun di kedua schema, maupun grant `INSERT`/`UPDATE`/`REFERENCES` tingkat kolom,
maupun `USAGE`/`UPDATE` pada sekuens.
Role tidak boleh mempunyai `ADMIN OPTION` dan
tidak boleh dapat `SET ROLE` ke role lain selain `pg_read_all_data`; ini menutup
jalur eskalasi dari membership `NOINHERIT`. Workflow juga memeriksa sesi sumber
benar-benar menggunakan TLS 1.2+ dengan cipher dari sisi libpq. Pemeriksaan tidak memakai
`pg_stat_ssl`, karena endpoint Neon dapat mengakhiri TLS di proxy sebelum sesi
PostgreSQL sehingga view server itu dapat melaporkan `ssl=false` walau socket
klien terenkripsi dan sertifikatnya sah.

Contoh dijalankan oleh administrator database melalui sesi aman; tetapkan
password secara interaktif/secret manager, jangan menaruhnya di history shell:

```sql
CREATE ROLE simsa_backup
  LOGIN INHERIT
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE simsa TO simsa_backup;
GRANT pg_read_all_data TO simsa_backup;
REVOKE CREATE ON DATABASE simsa FROM simsa_backup;
REVOKE CREATE ON SCHEMA public FROM simsa_backup;
```

Periksa juga grant melalui `PUBLIC` atau role lain karena PostgreSQL tidak
memiliki grant “deny”. Workflow memeriksa hak efektif dan gagal tertutup bila
credential masih dapat menulis. Jika Row-Level Security diperkenalkan, jangan
memberi `BYPASSRLS` diam-diam; desain ulang role/prosedur backup dan buktikan
bahwa dump lengkap tanpa memperluas hak lebih dari yang disetujui.

Gunakan direct endpoint Neon aplikasi (bukan database `postgres`/template)
dengan masing-masing parameter muncul tepat sekali:
`sslmode=verify-full`, `channel_binding=require`, dan `sslrootcert=system`.
Parameter query yang dapat menimpa host, port, database, user, password, atau
service ditolak. Host dan nama database authority juga harus sama persis dengan
dua variabel target yang dilindungi pada Environment.
Simpan URI itu sebagai `NEON_BACKUP_DATABASE_URL`, bukan `NEON_DATABASE_URL`
akun aplikasi.

### Secret enkripsi

Tambahkan dua Actions secrets pada Environment `production-backup` yang dibatasi
hanya ke deployment branch default:

- `NEON_BACKUP_DATABASE_URL`: URI direct endpoint untuk role hanya-baca;
- `BACKUP_ENCRYPTION_PASSPHRASE`: nilai acak satu baris, minimal 32 karakter.

Tambahkan pula dua Actions variables non-secret pada Environment yang sama:

- `NEON_BACKUP_EXPECTED_HOST`: hostname direct endpoint Production yang
  disetujui, tanpa scheme/port;
- `NEON_BACKUP_EXPECTED_DATABASE`: nama database aplikasi Production yang
  disetujui.

Simpan salinan passphrase di secret manager terpisah dengan dual control. Jika
passphrase hanya ada di GitHub lalu hilang/dirotasi, artifact lama tidak dapat
dipulihkan. Rotasi wajib mempertahankan key lama selama seluruh artifact yang
dienkripsi dengannya masih berada dalam masa retensi.

## Restore database

Selalu pulihkan ke database baru/terisolasi terlebih dahulu. Jangan mengarahkan
drill ke Production. Archive adalah custom-format sehingga dipulihkan dengan
`pg_restore`, bukan `psql`.

Contoh streaming manual tanpa dump terdekripsi di disk:

```bash
set -euo pipefail
export BACKUP_FILE='simsa-db-YYYY-MM-DD-RUN-ATTEMPT.dump.gpg'
export BACKUP_PASSPHRASE='ambil-dari-secret-manager'
export RESTORE_MAINTENANCE_URL='postgresql://.../postgres?sslmode=verify-full&channel_binding=require&sslrootcert=system'

gpg --batch --yes --pinentry-mode loopback \
  --no-symkey-cache --passphrase-fd 3 \
  --decrypt "$BACKUP_FILE" 3<<<"$BACKUP_PASSPHRASE" \
| docker run --rm --interactive \
    --env RESTORE_MAINTENANCE_URL \
    postgres:18-alpine@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2 \
    sh -eu -c 'exec pg_restore \
      --dbname "$RESTORE_MAINTENANCE_URL" \
      --create --exit-on-error \
      --clean --if-exists --no-owner --no-privileges'
```

Mode `--create` sengaja tidak digabung dengan `--single-transaction` karena
`CREATE/DROP DATABASE` tidak legal di dalam transaction block. Drill berlangsung
pada runner/database disposable dan setiap error tetap menghentikan restore;
evidence hanya hijau setelah database hasil create selesai diverifikasi.

Sesudah restore, jalankan smoke test autentikasi, query arsip/surat, audit,
relasi klasifikasi/JRA, dan rekonsiliasi locator–hash Blob. Restore database yang
berhasil tetapi bitstream tidak dapat diambil atau hash berbeda tetap merupakan
drill gagal.

## Backup private Blob — blocker eksternal

Sebelum Production dinyatakan siap, pemilik infrastruktur wajib menyediakan dan
membuktikan proses di luar workflow database ini yang:

1. menghasilkan inventory objek privat dengan locator internal, ukuran, hash
   SHA-256, status malware, dan referensi database;
2. menyalin byte ke penyimpanan privat independen dengan encryption-at-rest,
   least privilege, lifecycle, dan retensi yang disahkan;
3. tidak mengubah objek menjadi publik dan tidak mencatat token/URL privat ke
   log atau artifact;
4. memverifikasi checksum setiap salinan serta mendeteksi objek DB tanpa byte dan
   byte tanpa referensi DB; dan
5. melakukan restore drill sampel dan penuh bersama snapshot database yang
   se-zaman, termasuk pemeriksaan fixity dan akses terautentikasi.

Sampai bukti tersebut ada, status backup keseluruhan adalah **belum lengkap**.

## Prosedur pre-migration dan insiden

Sebelum migrasi Production:

1. pastikan workflow database manual hijau dan artifact/checksum tercatat;
2. pastikan backup private Blob serta manifest pasangannya selesai;
3. buat branch/PITR Neon dari titik yang sama dan catat timestamp;
4. lakukan restore drill terisolasi; lalu
5. jalankan `npm run db:migrate` hanya setelah approval operasional.

Saat insiden, pulihkan ke environment terpisah, bandingkan snapshot dengan
Production, dan salin data kembali hanya melalui prosedur yang diaudit. Jangan
melakukan restore in-place atau menghapus branch/object lama sebelum validasi
bisnis, fixity, audit, serta persetujuan pemilik data selesai.

## Bukti berkala

| Frekuensi | Bukti minimum |
|---|---|
| Harian | Workflow database hijau, checksum artifact, ringkasan schema/migrasi restore |
| Mingguan | Unduh artifact dan uji dekripsi/TOC dari runner independen |
| Bulanan | Drill database + private Blob, fixity, serta pengukuran RPO/RTO |
| Sebelum deploy/migrasi | Backup pasangan database–Blob, branch/PITR, restore terisolasi, approval |
