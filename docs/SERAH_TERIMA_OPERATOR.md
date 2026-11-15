# Serah terima operator kedua

Operasi, rilis, dan pembukaan backup SIMSA tidak boleh bergantung pada satu orang. Halaman ini mendaftar apa yang dibutuhkan operator kedua dan cara membuktikan bahwa ia dapat bekerja hanya dari dokumen. Halaman ini tidak mengubah akses apa pun: akses diberikan oleh pemilik akun masing-masing layanan.

Repositori bersifat publik. Nama orang, tanggal serah terima per orang, dan lokasi salinan tersegel dicatat di register internal kantor, bukan di sini. Rahasia hanya diketik di prompt tersembunyi atau kolom secret, tidak pernah di chat, tiket, isu, atau tangkapan layar ([aturan dasar](RUNBOOK_KREDENSIAL_DATABASE.md)).

## Akses yang diperlukan

| Layanan | Akses | Dipakai untuk | Bukti bahwa akses berfungsi |
|---|---|---|---|
| GitHub, repositori SIMSA | Peran **Admin**. Peran **Write** hanya cukup untuk menjalankan workflow, mengunduh artefak, dan menutup isu; secret, variabel, dan environment hanya dapat diubah Admin. Aktifkan autentikasi dua faktor. | Mengganti secret saat rotasi atau pemulihan, menjalankan workflow, membaca run | Membuka *Settings → Environments* dan menjalankan Operations Monitor secara manual |
| GitHub, environment `production` | Terdaftar sebagai *required reviewer* | Menyetujui atau menolak promosi rilis | Tombol *Review deployments* muncul pada run rilis |
| GitHub, notifikasi | *Watch → Custom → Issues* (atau *All Activity*) pada repositori | Menerima email isu **Pemeriksaan operasional gagal** | Email isu berikutnya diterima |
| Vercel, tim SIMSA | Keanggotaan tim dengan hak mengubah Environment Variables Production, membuat dan mempromosikan deployment, membaca log, serta mengelola store Blob. Minimal satu Owner kedua, agar penagihan dan keanggotaan tidak bergantung pada satu akun. | Rilis, rollback, pergantian kredensial, pemulihan store | Membuka *Environment Variables* proyek `simsa-backend` dan daftar Deployments |
| Vercel CLI | Login dengan akun sendiri di workstation (`vercel login`) | Jalur rilis manual dan rollback manual | `vercel whoami` menampilkan akun yang benar |
| Neon | Akses ke project produksi dengan hak mengelola branch, pemulihan, serta peran dan database | Pemulihan titik waktu, branch sebelum migrasi, reset password `neondb_owner` | Membuka project dan halaman Branches di Neon Console |
| Password manager | Akses ke entri `SIMSA Neon neondb_owner`, `SIMSA Neon simsa_backup`, `SIMSA Neon simsa_api` (bila ada), `SIMSA Neon simsa_migration` (bila dipakai), dan `SIMSA Vercel token rilis GitHub` | Migrasi, rotasi, backup manual, verifikasi | Membuka setiap entri tanpa menyalinnya ke tempat lain |
| Passphrase backup | Salinan tersegel `BACKUP_ENCRYPTION_PASSPHRASE` (lihat di bawah) | Membuka artefak backup | Uji buka backup berhasil |
| Aplikasi SIMSA | Akun Super Admin atas nama sendiri | Panel monitoring, antre ulang pemindaian, pengelolaan akun | Membuka **Administrasi → Monitoring Operasional** |
| Workstation | Node.js 24, Git, npm, alat klien PostgreSQL 18, Vercel CLI | Rilis, migrasi, pembukaan backup, pemulihan | Perintah di bawah dapat dijalankan |

Catatan:

- Password `neondb_owner` dapat di-reset oleh siapa pun yang berhak mengelola project Neon ([cara reset](RUNBOOK_KREDENSIAL_DATABASE.md#neondb_owner)). Akses Neon untuk orang kedua karena itu lebih penting daripada menitipkan password pemilik database.
- Token Vercel untuk GitHub (`VERCEL_TOKEN`) dibuat dari akun pribadi pembuatnya dan berlaku 90 hari. Bila akun pembuatnya keluar dari tim atau tokennya kedaluwarsa, orang kedua membuat token baru di akunnya sendiri lalu mengganti secret `VERCEL_TOKEN` di environment `production-candidate` dan `production` ([penyiapan](RUNBOOK_KREDENSIAL_DATABASE.md#penyiapan-manual-readme), langkah 3 dan 4).

## Salinan tersegel passphrase backup

Tanpa `BACKUP_ENCRYPTION_PASSPHRASE`, tidak satu pun artefak backup dapat dibuka, termasuk salinan bulanan di kantor. GitHub tidak dapat menampilkan kembali nilai secret yang sudah disimpan.

1. Pemegang passphrase menuliskannya beserta tanggal berlakunya pada media yang disepakati kantor: kertas di amplop bersegel, atau entri bersama di password manager kantor yang dapat dibuka pejabat kedua.
2. Amplop disegel dan diparaf oleh pemegang dan penerima, lalu disimpan di lemari besi kantor. Register internal mencatat tanggal, peran kedua pihak, dan nomor segel; passphrase tidak ditulis di register.
3. Setiap kali passphrase diganti di environment `production-recovery`, buat salinan tersegel baru. Simpan passphrase lama selama masih ada backup yang dienkripsi dengannya: artefak GitHub 14 hari, dan salinan bulanan di kantor selama salinan itu disimpan.
4. Uji salinan tersegel sekali setahun, atau setiap kali pemegangnya berganti, dengan uji buka backup di bawah. Setelah dibuka untuk uji, segel ulang dan catat di register.

## Uji buka backup

Dilakukan oleh orang kedua sendiri, hanya dengan mengikuti dokumen.

1. Unduh artefak hijau terbaru: tab Actions → *Verified database and private document recovery* → run terbaru → Artifacts → `simsa-recovery-<run_id>-<attempt>`.
2. Buka dengan `scripts/operations-recovery-extract.mjs` mengikuti [membuka backup](OPERATIONS_RECOVERY.md#membuka-backup-menjadi-file-yang-bisa-dibaca). Pilih folder tujuan baru di media terenkripsi, di luar repositori.
3. Pastikan perintah mencetak `Berhasil.` dan `BACA-SAYA.txt` menunjukkan waktu snapshot kurang dari sekitar 24 jam sebelum run itu.
4. Hapus folder hasil sesuai aturan kantor. Isinya data dinas dan data pribadi tanpa enkripsi.

## Menjalankan rilis uji kering

Uji kering membuktikan gerbang rilis, manifest, Vercel CLI di runner GitHub, dan pemeriksaan kandidat **tanpa** mengubah alias produksi. Workflow `release-vercel.yml` belum pernah dijalankan ([celah 5](RUNBOOK_KREDENSIAL_DATABASE.md#celah-yang-diketahui)), jadi uji kering pertama sekaligus menguji konfigurasinya. Bila gagal, produksi tidak berubah.

Prasyarat sekali saja, oleh Admin repositori: environment `production-candidate` dan `production` beserta secret dan reviewernya, variabel `VERCEL_ORG_ID`, `VERCEL_BACKEND_PROJECT_ID`, dan `VERCEL_FRONTEND_PROJECT_ID`, lalu `RELEASE_VERCEL_ENABLED` = `true` ([penyiapan](RUNBOOK_KREDENSIAL_DATABASE.md#penyiapan-manual-readme), langkah 3 sampai 5).

1. Tab Actions → *Release SIMSA to Vercel (manual, approved)* → *Run workflow*, dari cabang `main`.
2. Isi:
   - `commit_sha`: SHA lengkap 40 karakter dari `main` HEAD, yang harus berupa commit merge PR;
   - `release_label`: misalnya `UJI KERING <tanggal>`;
   - `components`: `both`;
   - `database_migrations`: jumlah migrasi yang sudah diterapkan di produksi (lihat [kondisi produksi](KONDISI_PRODUKSI.md)). Bila `main` memuat migrasi yang belum diterapkan, job pertama berhenti dengan pesan agar migrasi diterapkan dulu. Itu perilaku yang benar.
3. Tunggu job *Validate request and freeze release source*, *Deploy backend candidate (no domain)*, dan *Deploy frontend candidate (no domain)* hijau. Ringkasan run menampilkan kandidat dan deployment yang akan diganti.
4. Saat job *Promote after approval* menunggu persetujuan, pilih *Review deployments* → **Reject**, atau batalkan run.
5. Pastikan produksi tidak berubah: `node scripts/ops/release-smoke.mjs backend https://simsa-backend.vercel.app` dan `node scripts/ops/release-smoke.mjs frontend https://simsa-frontend.vercel.app` lulus, dan Vercel → Deployments masih menunjukkan deployment produksi yang sama.
6. Catat alamat run dan hasilnya di register internal. Kandidat yang tidak dipromosikan boleh dibiarkan atau dihapus dari Vercel.

Rilis sungguhan memakai prosedur yang sama tanpa menolak persetujuan, setelah migrasi diterapkan ([prosedur rilis](RUNBOOK_KREDENSIAL_DATABASE.md#prosedur-rilis)). Sebagai latihan serah terima, orang kedua sebaiknya menjalankan satu rilis sungguhan dengan operator pertama sebagai peninjau.

## Daftar periksa serah terima

Salin daftar ini ke register internal dan isi tanggal serta peran pencatatnya.

| Butir | Selesai |
|---|---|
| Admin kedua di repositori GitHub, dengan autentikasi dua faktor | [ ] |
| Reviewer kedua di environment `production` | [ ] |
| Notifikasi isu repositori aktif untuk orang kedua | [ ] |
| Keanggotaan tim Vercel dengan hak yang tercantum di atas, dan Owner kedua | [ ] |
| Vercel CLI login di workstation orang kedua | [ ] |
| Akses project Neon produksi | [ ] |
| Akses entri password manager | [ ] |
| Salinan tersegel passphrase backup tersimpan dan tercatat | [ ] |
| Akun Super Admin atas nama sendiri | [ ] |
| Uji buka backup berhasil, dilakukan sendiri dari dokumen | [ ] |
| Rilis uji kering berhasil sampai tahap persetujuan, lalu ditolak | [ ] |
| Membaca [kondisi produksi](KONDISI_PRODUKSI.md), [buku saku insiden](BUKU_SAKU_INSIDEN.md), dan [runbook pemulihan produksi](RUNBOOK_PEMULIHAN_PRODUKSI.md) | [ ] |
