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

1. menolak endpoint pooled/TLS opsional dan memvalidasi role sumber efektif
   hanya-baca;
2. mengalirkan output `pg_dump --format=custom` terkompresi langsung ke enkripsi
   simetris AES-256, tanpa file dump plaintext;
3. membaca TOC archive dari stream dekripsi;
4. mengalirkan dekripsi langsung ke `pg_restore` PostgreSQL 18 yang terisolasi,
   memakai satu transaksi dan berhenti pada error pertama;
5. memverifikasi tabel, kolom operasional/readiness, primary key, constraint
   mandat unit dan klasifikasi keamanan surat keluar, riwayat migrasi minimal
   `0029_outgoing_security_classification`, serta
   keberadaan user produksi minimum; dan
6. baru mengunggah archive terenkripsi sebagai artifact immutable per-run selama
   30 hari, disertai checksum archive/artifact dan ringkasan restore.

PostgreSQL image dan action upload dipatok ke digest/commit. Tidak ada langkah
yang membuat branch Neon, mengubah deployment, atau membaca/menyalin private
Blob.

### Role sumber least-privilege

Buat credential terpisah dari akun aplikasi, misalnya `simsa_backup`. Role itu
harus `LOGIN`, `INHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`,
`NOREPLICATION`, dan `NOBYPASSRLS`, menjadi anggota `pg_read_all_data`, serta
tidak menjadi anggota `pg_write_all_data`. Role tidak boleh memiliki hak efektif
`CREATE` pada database atau schema `public`, maupun `INSERT`, `UPDATE`, `DELETE`,
atau `TRUNCATE` pada tabel kritis. Workflow juga memeriksa sesi sumber benar-benar
menggunakan TLS, bukan sekadar mempercayai teks URI.

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

Gunakan direct endpoint Neon dan `sslmode=require` atau `sslmode=verify-full`.
Simpan URI itu sebagai `NEON_BACKUP_DATABASE_URL`, bukan `NEON_DATABASE_URL`
akun aplikasi.

### Secret enkripsi

Tambahkan dua Actions secrets:

- `NEON_BACKUP_DATABASE_URL`: URI direct endpoint untuk role hanya-baca;
- `BACKUP_ENCRYPTION_PASSPHRASE`: nilai acak satu baris, minimal 32 karakter.

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
export BACKUP_FILE='simsa-db-YYYY-MM-DD-RUN-ATTEMPT.dump.gpg'
export BACKUP_PASSPHRASE='ambil-dari-secret-manager'
export RESTORE_DATABASE_URL='postgresql://.../simsa_restore?sslmode=require'

gpg --batch --yes --pinentry-mode loopback \
  --no-symkey-cache --passphrase-fd 3 \
  --decrypt "$BACKUP_FILE" 3<<<"$BACKUP_PASSPHRASE" \
| docker run --rm --interactive \
    --env RESTORE_DATABASE_URL \
    postgres:18-alpine@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2 \
    sh -eu -c 'exec pg_restore \
      --dbname "$RESTORE_DATABASE_URL" \
      --exit-on-error --single-transaction \
      --clean --if-exists --no-owner --no-privileges'
```

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
