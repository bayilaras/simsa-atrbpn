# Backup database lokal dan verifikasi pemulihan

Prosedur ini membuat backup **database yang sedang dipakai** oleh runtime internal Windows, kemudian menguji pemulihan dari artefak tersebut pada cluster PostgreSQL baru. Ini berbeda dari [drill data sintetis](LOCAL_BACKUP_RESTORE_DRILL.md). Database sumber tetap berjalan; skrip tidak menjalankan seed, migrasi, restore, drop, perubahan grant, atau penghentian pada sumber.

## Ruang lingkup dan prasyarat

Sumber sengaja dikunci pada `127.0.0.1:55432/simsa_local`, PostgreSQL 18, system identifier `7684074739617773232`, dan direktori `output/local-runtime/postgres-data` milik checkout ini. Skrip menolak identitas berbeda. Untuk mesin/cluster lain diperlukan peninjauan pin dan prosedur tersendiri, bukan mengubah target lewat argumen CLI.

Gunakan Node 24 yang sudah disiapkan di `output/local-runtime/node-v24.21.0-win-x64/node.exe`, PostgreSQL 18 native, Python 3 yang sudah terpasang, serta dependency backend yang sudah tersedia. Lokasi executable PostgreSQL diambil dari `output/local-runtime/local-launcher.json`. Skrip tidak memasang dependency atau memerlukan Docker/cloud. Jangan memindahkan/mengubah `backend.env`, `credentials.json`, atau direktori database sumber untuk menjalankan prosedur ini.

Tes logika portabel dijalankan dengan `npm run test:local-current-backup` dan
disertakan dalam `npm test`. Pada Windows, jalankan
`npm run test:local-current-backup:windows` untuk turut menguji PowerShell dan
tampilan status launcher. Pemisahan ini mempertahankan pengujian Windows tanpa
membuat pemeriksaan inti bergantung pada tersedianya PowerShell di CI Linux.

Backup memakai **akun backup read-only yang sudah ada**, bukan admin. Bila kredensial tidak cocok, closure role berbeda, atau izin kurang, operasi gagal tanpa menambahkan grant. Bukti sumber memeriksa identitas fisik/proses, waktu hidup server, database/user/port, PostgreSQL major, dan sesi read-only. Dump dan fingerprint dibaca dari satu exported snapshot.

Backup mencakup tabel akun, data autentikasi/sesi, arsip, surat, audit, skema, dan metadata database. Isinya sensitif. Arsip dan fingerprint dienkripsi AES-256-GCM; manifest dilindungi HMAC-SHA256, dengan kunci per backup. Role server dan password PostgreSQL bukan bagian dump database; pemulihan membuat principal baru dan menerapkan grant yang ditinjau hanya pada target baru.

**Objek berkas eksternal, dokumen sumber klasifikasi/JRA di object storage, konfigurasi layanan, dan rahasia deployment tidak dicadangkan oleh prosedur ini.** Database dapat berisi referensi berkas tanpa membawa isi objeknya. Verifikasi database belum membuktikan login lewat aplikasi, pemulihan penyimpanan berkas, atau kesiapan produksi. Pemulihan objek berkas membutuhkan prosedur penyimpanan yang terpisah.

## Membuat backup

Dari PowerShell di akar repo, jalankan:

```powershell
& './output/local-runtime/node-v24.21.0-win-x64/node.exe' `
  scripts/local-current-backup.mjs backup `
  --python 'C:\Users\BPNSA\AppData\Local\Programs\Python\Python312\python.exe'
```

Sesuaikan hanya lokasi Python jika instalasi yang disiapkan berbeda. Baca `result.json` pada lokasi yang dicetak. `status: passed` berarti artefak backup selesai, **belum** berarti artefak telah diuji restore. Laporan menunjukkan `bundle`, `key_file`, `snapshot_at`, ukuran arsip dan durasi. Nilai kunci/password tidak dicetak.

- Bundle: direktori baru di `output/local-backups/`, berisi `database.dump.aesgcm`, `source.evidence.aesgcm`, `manifest.json`, dan laporan.
- Kunci: `recovery-key.json` dalam direktori lain di `output/local-backup-keys/`. Kunci tidak berada dalam bundle.
- Direktori bundle, kunci, dan setiap target verifikasi mempunyai ACL privat untuk SID pengguna Windows yang menjalankan skrip. Kunci, dump terbuka, atau data hasil restore tidak masuk Git. Tidak ada dump plaintext sementara pada disk; stream dump langsung dienkripsi.

Simpan salinan bundle dan kunci secara terpisah di lokasi privat yang disetujui pengelola. Skrip tidak mengunggah atau menyalin ke jaringan. Direktori `output` pada disk yang sama belum melindungi dari kehilangan seluruh disk; kemampuan memulihkan di luar workstation baru terbukti setelah salinan dan kuncinya benar-benar tersedia serta diuji di lingkungan yang dituju. Jangan membagikan direktori `private` atau recovery key dalam tiket/log publik.

## Menguji artefak dengan proses baru

Gunakan `bundle` dan `key_file` dari laporan backup yang berhasil. Jalankan **perintah kedua**, sehingga proses tidak bergantung pada kunci, snapshot, atau koneksi sumber dalam memori proses backup:

```powershell
& './output/local-runtime/node-v24.21.0-win-x64/node.exe' `
  scripts/local-current-backup.mjs restore-verify `
  --python 'C:\Users\BPNSA\AppData\Local\Programs\Python\Python312\python.exe' `
  --bundle 'D:\Projects\New folder\simsa-atrbpn\output\local-backups\DIREKTORI-DARI-LAPORAN' `
  --key-file 'D:\Projects\New folder\simsa-atrbpn\output\local-backup-keys\DIREKTORI-DARI-LAPORAN\recovery-key.json'
```

Verifikasi hanya membaca bundle, kunci terpisah, metadata launcher dan helper checkout yang cocok. Ia **tidak membaca kredensial sumber atau membuka koneksi ke database sumber**. Manifest, hash kedua artefak, tag autentikasi seluruh ciphertext, format arsip, dan fingerprint diverifikasi sebelum cluster target dibuat. Hash helper restore/grant/collector dan manifest 38 migrasi harus sama dengan yang direkam; simpan checkout/helper yang cocok bersama prosedur recovery. Jangan mengubah manifest agar pemeriksaan lewat.

Target selalu merupakan direktori baru dalam `output/backup-verification/<operasi>/private/restore-data`, dengan port acak `40000–59999` selain `55432`, binding **hanya `127.0.0.1`**, password baru dan system identifier berbeda. Nama database hasil restore tetap `simsa_local`, tetapi berada pada cluster fisik berbeda. CLI tidak menyediakan opsi port, database, overwrite, atau target sumber.

Setiap langkah mutasi target diperiksa terhadap direktori, identitas server, database administrasi, user, dan port target yang telah dipin. Sesudah full archive restore, skrip menerapkan grant target, membandingkan seluruh bukti collector secara persis—skema, migrasi, grant ternormalisasi, jumlah baris dan fingerprint isi tabel—serta menguji SELECT tabel utama sebagai role API tanpa hak superuser/CREATE schema. Cluster **target verifikasi** dihentikan dan socketnya harus tertutup sebelum hasil dinyatakan lulus. Direktori data hasil restore tetap privat dan dipertahankan untuk pemeriksaan; tidak ada penghapusan rekursif otomatis.

Periksa `result.json` dengan `status: passed`, `target_stopped: true`, `exact-fingerprints-match`, dan `api-role-read-probe`. Laporan memuat system identifier/port target sehingga perbedaan dengan sumber dapat diperiksa. Sumber tetap utuh dan runtime dapat terus dipakai.

## Status, batas, dan kegagalan

`Cek-SIMSA.cmd` menampilkan waktu/usia snapshot backup terakhir, apakah **bundle terbaru yang sama** telah lulus restore terpisah, dan apakah operasi terakhir gagal. Status hanya ringkasan lokal; bukti rinci berada pada laporan privat. Keberhasilan restore bundle lama tidak menandai backup lebih baru sebagai terverifikasi.

Tidak ada jadwal backup otomatis atau SLA/RPO/RTO yang ditetapkan skrip. Usia snapshot menunjukkan rentang perubahan yang tidak ada di backup itu; kehilangan data nyata bergantung pada saat insiden dan aktivitas sesudah snapshot. Durasi restore yang dicatat adalah waktu uji database di mesin ini, bukan waktu pemulihan layanan penuh. Pengelola perlu menentukan frekuensi backup, retensi, salinan di media lain, penjaga kunci, dan jadwal uji ulang sesuai kebutuhan kantor.

Batas implementasi saat ini adalah arsip custom terkompresi maksimum **64 MiB** dan fingerprint maksimum **2 MiB**. Jika batas terlampaui, operasi gagal jelas; jangan menonaktifkan pemeriksaan atau menganggap file parsial sebagai backup. Siapkan alur backup terkelola yang mendukung ukuran aktual. Error koneksi snapshot menghentikan child command dan menghasilkan kegagalan terkontrol; proses tidak boleh menyatakan backup sukses setelah snapshot hilang.

Lock `output/local-runtime/local-backup.lock` mencegah operasi backup/verifikasi bersamaan. Kegagalan penulisan laporan/status tetap melepaskan lock milik operasi melalui cleanup tersendiri. Bila mesin mati atau proses dipaksa berhenti, pengelola harus memeriksa PID/command line dan identitas operasi yang tercatat sebelum menangani lock yang tertinggal. Jangan menghapus lock operasi yang masih hidup. Jika penghentian target gagal, laporan mencantumkan `shutdown_failure`; tangani hanya direktori/port/system identifier target dalam laporan, **jangan** cluster sumber `55432`. Skrip tidak mengadopsi atau menghentikan proses yang identitasnya berbeda.

## Bukti uji 11 September 2026

Backup sumber aktif pada snapshot **13:45:59 WIB** berhasil dalam **32,121 detik**. Arsip custom berukuran **560.312 byte**, ciphertext **560.352 byte**, dengan **138 baris bukti**. Bundle: `output/local-backups/c70330b0220ecb1d518986efe87d7a7e-db1WPG/`.

Invocation verifikasi baru berhasil dalam **31,626 detik** pada `127.0.0.1:59225`, system identifier **7684166441830765796**, kemudian target dihentikan. Semua 138 baris bukti cocok; query role API membaca tabel pengguna/surat/arsip/audit dengan `superuser: false` dan `schema_create: false`. Usia snapshot saat bukti cocok **275 detik**. Laporan: `output/backup-verification/c08a4174a044f6cd2f610942cd689967-p1ATzf/result.json`. Pemeriksaan launcher sesudahnya menunjukkan sumber aktif pada `55432` dan aplikasi siap pada `3000`.

Dua percobaan awal berhenti sebelum target dibuat (penanganan PATHEXT PowerShell dan tipe input normalizer fingerprint); perbaikannya dilindungi tes regresi. Ukuran/durasi di atas merupakan observasi satu snapshot lokal, bukan janji SLA atau bukti pemulihan objek eksternal.
