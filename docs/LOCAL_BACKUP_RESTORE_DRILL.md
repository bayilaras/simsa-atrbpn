# Drill backup/restore lokal yang dapat diulang

Perintah ini ditujukan untuk **data sintetis pada dua cluster PostgreSQL lokal
baru**, bukan untuk mencadangkan database pengguna atau mengakses Cloud SQL.
Tidak ada parameter connection string atau target database yang sudah berjalan.
Project Firebase, IAM, billing, deployment, serta database lokal lain tidak
boleh diubah oleh drill ini.

Hasil lokal tidak menggantikan required checks pada merge commit, backup cloud,
restore pada lingkungan recovery terpisah, atau E2E Firebase/App Check live.
Workflow Production tetap mengikuti [runbook Cloud SQL](../CLOUD_SQL_BACKUP_RECOVERY.md).

## Prasyarat

- Node.js 24 dan dependency backend yang sudah terpasang melalui `npm ci`.
- Instalasi native PostgreSQL 18 yang menyediakan `initdb`, `pg_ctl`, `psql`,
  `pg_dump`, dan `pg_restore`; menjalankan drill tidak mengubah instalasi/service.
- Python 3 untuk helper manifest migrasi dan alias role yang sudah direview.
- Git dan working tree yang bersih: commit perubahan sebelum menjalankan drill.
  HEAD dan status diperiksa lagi sebelum hasil dinyatakan sukses.
- Path absolut ke executable Git, `npm-cli.js`, dan direktori output lokal. Jangan gunakan
  direktori yang disinkronkan atau dibagikan untuk menyimpan kunci recovery.

Periksa opsi aktual dengan:

```text
npm run backup:drill:local -- --help
```

Contoh PowerShell, sesuaikan path executable dengan instalasi Anda:

```powershell
npm run backup:drill:local -- `
  --pg-bin "C:\Program Files\PostgreSQL\18\bin" `
  --python "C:\Python313\python.exe" `
  --npm-cli "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" `
  --git "C:\Program Files\Git\cmd\git.exe" `
  --output-parent "C:\SIMSA-Local-Drills"
```

Gunakan direktori induk lokal yang sudah Anda siapkan. Setiap eksekusi membuat
direktori run unik; jangan mengubah helper agar melanjutkan cluster atau artifact
dari percobaan sebelumnya. Password uji dan kunci dibuat khusus untuk run itu,
bukan diambil dari `.env`, secret cloud, atau database lama.

## Bukti yang wajib diperiksa

Drill harus menghasilkan bukti tahapan berikut, bukan sekadar `pg_dump` exit 0:

1. Dua cluster baru memakai port loopback yang berbeda. Identitas server dan
   direktori datanya diperiksa sebelum perubahan dilakukan.
2. Sumber dibuat dari migrasi checkout aktual dan `seed:all`, memakai pembagian
   role yang sama dengan bootstrap SIMSA. Tidak menggunakan `db:push`.
3. Evidence dan custom-format dump berasal dari snapshot read-only yang sama;
   dump dienkripsi tanpa menulis plaintext custom-format dump ke disk.
4. Hash artifact dan autentikasi enkripsi diperiksa. Kunci yang salah dan
   ciphertext yang dimodifikasi harus ditolak sebelum restore.
5. Server sumber dimatikan sebelum pemulihan. Target memakai cluster baru,
   principal berbeda, full archive `--create`, dan helper alias role yang sama
   dengan workflow cloud; tidak menghapus `DATABASE PROPERTIES` agar lolos.
6. Evidence data, migrasi, skema semantik, properti database, serta ACL policy
   dibandingkan menggunakan collector yang sama. Perbedaan tidak boleh diabaikan.
7. Server milik run dihentikan, termasuk pada kegagalan. Status sukses tidak
   boleh diberikan bila penghentian atau verifikasi akhir gagal.

Artifact, ringkasan, dan log dipertahankan untuk diagnosis. Jangan menganggap
direktori output yang ada sebagai tanda sukses; baca status dan seluruh bukti
run. Pada kegagalan, pertahankan bukti dan mulai run baru setelah penyebabnya
diperbaiki. Tidak ada penghapusan rekursif otomatis atau pembersihan database
pengguna.

## Batas enkripsi dan independensi

Drill lokal memakai AES-256-GCM untuk transport artifact sintetis. Ini **bukan
format `age`** dari workflow cloud, tidak membuktikan WIF atau Cloud SQL Auth
Proxy, dan tidak memberikan akses recovery cloud. Kunci recovery lokal harus
tetap privat serta terpisah dari direktori artifact yang akan disalin. Jangan
mengunggah seluruh direktori run: cluster lokal dan folder kunci bukan artifact
publik.

Restore memakai cluster dan proses terpisah pada mesin yang sama, dengan sumber
sudah offline. Ini membuktikan pemulihan lokal tanpa koneksi kembali ke sumber,
tetapi bukan independensi operator/host dan bukan simulasi kehilangan seluruh
mesin. Backup cloud dan restore oleh operator/host terpisah tetap diperlukan
sebelum penggunaan Production.

## Regression tests

```text
npm run test:backup-drill
```

Unit tests ini juga berjalan melalui `npm test` dan required CI yang sudah ada.
Unit tests tidak menjalankan database dan tidak boleh disebut sebagai hasil
drill integrasi. Jalankan perintah drill di atas untuk mendapatkan bukti aktual.
