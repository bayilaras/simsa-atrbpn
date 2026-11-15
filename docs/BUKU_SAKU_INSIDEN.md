# Buku saku insiden

Pegangan singkat saat SIMSA terganggu: gejala, cara memeriksa, tindakan, dan peran yang dihubungi. Gambaran layanan dan jadwal ada di [kondisi produksi](KONDISI_PRODUKSI.md). Daftar nama dan nomor kontak untuk setiap peran disimpan di dokumen internal kantor, bukan di repositori.

## Langkah pertama untuk setiap gangguan

1. Catat waktu mulai, apa yang dilakukan pengguna, dan pesan yang tampil. Bila ada, catat juga nomor `X-Request-ID` dari respons yang gagal. Jangan mencatat kata sandi, token, atau isi dokumen.
2. Buka **Administrasi → Monitoring Operasional** sebagai Super Admin dan lihat kartu mana yang tidak **Sehat**.
3. Buka https://simsa-frontend.vercel.app/ready. Jawaban 200 (`ready` atau `degraded`) berarti API dan ketergantungan utamanya siap; 503 berarti ada ketergantungan yang belum siap.
4. Lihat run terakhir di tab Actions repositori dan isu **Pemeriksaan operasional gagal**, bila ada.
5. Jangan mengubah status berkas, hash, atau data langsung di database, dan jangan memulihkan database di tempat (*in-place*) tanpa persetujuan pemilik data.

## Database

| | |
|---|---|
| **Gejala** | Halaman gagal memuat atau menyimpan data. `/ready` menjawab 503. Kartu **Database** berstatus **Gagal**. |
| **Cara memeriksa** | Kartu **Database** di panel. Neon Console: status project, compute, dan pemakaian. Log Vercel proyek `simsa-backend`, dicari dengan `X-Request-ID`. |
| **Tindakan** | Gangguan penyedia: pantau status Neon, umumkan kepada staf, lalu periksa ulang setelah pulih. Login ditolak (kode `28P01`) setelah rotasi password: kembalikan password lama ([rollback kredensial](RUNBOOK_KREDENSIAL_DATABASE.md#rollback)). Data salah atau terhapus: jangan menimpa; buat branch Neon dari titik waktu sebelum kejadian untuk diperiksa, lalu ikuti [runbook pemulihan produksi](RUNBOOK_PEMULIHAN_PRODUKSI.md#1-pilih-jalur). |
| **Hubungi** | Pemilik project Neon; Kasubbag TU bila ada data yang mungkin hilang |
| **Rincian** | [Runbook kredensial](RUNBOOK_KREDENSIAL_DATABASE.md), [penyiapan database Neon](PENYIAPAN_DATABASE_NEON.md), [pemeriksaan backend](OPERASIONAL_BACKEND.md#menangani-gangguan) |

## Penyimpanan dokumen

| | |
|---|---|
| **Gejala** | PDF yang sudah lolos pemeriksaan tidak dapat dibuka atau diunduh. Unggahan gagal. Kartu **Penyimpanan dokumen** berstatus **Gagal**. |
| **Cara memeriksa** | Kartu di panel. Hasil probe yang lulus dipakai ulang paling lama 10 menit, sehingga gangguan baru bisa terlambat tampil sampai 10 menit; probe yang gagal selalu diulang. Vercel → Storage → store Blob privat: status dan pemakaian. Log Vercel proyek `simsa-backend`. |
| **Tindakan** | Gangguan sementara: tunggu, lalu periksa ulang. Sambungan store atau token berubah: pulihkan sambungan store pada proyek `simsa-backend` (khusus Production, prefix `SIMSA_PRIVATE_BLOB`), lalu rilis ulang backend karena Environment Variables hanya berlaku untuk deployment baru. Store atau objek hilang: ikuti [runbook pemulihan produksi](RUNBOOK_PEMULIHAN_PRODUKSI.md#5-dokumen-ke-store-blob). Berkas yang ditandai rusak oleh pemeriksaan integritas tidak dipulihkan otomatis; lihat [pemeriksaan integritas](OPERASI_PEMERIKSAAN_INTEGRITAS.md#hasil-dan-respons-petugas). |
| **Hubungi** | Pengelola Vercel |
| **Rincian** | [Kondisi produksi](KONDISI_PRODUKSI.md), [rekonsiliasi unggahan](BLOB_UPLOAD_RECONCILIATION.md) |

## Pemindai antivirus

| | |
|---|---|
| **Gejala** | Berkas baru lama tertahan dengan pesan "Dokumen tersimpan dan menunggu pemeriksaan." Berkas lain menampilkan "Dokumen belum dapat digunakan. Hubungi pengelola untuk memeriksa atau mengganti berkas." Kartu **Pemindai keamanan dokumen** atau **Antrean pemindaian** tidak **Sehat**. |
| **Cara memeriksa** | Kedua kartu di panel. Kartu antrean memisahkan **Gagal** dari **Terdeteksi berbahaya**. Log Vercel fungsi `api/internal-malware-scan.js`. |
| **Tindakan** | Jalankan Operations Monitor secara manual (tab Actions → *SIMSA Operations Monitor* → *Run workflow*). Run itu meminta backend membangunkan pemindai bila perlu, lalu memeriksa ulang. Pengguna yang berhak menulis dapat menekan **Lanjutkan pemeriksaan** pada berkas yang menunggu. Berkas gagal dipindai: Super Admin menekan **Antre ulang**, atau **Antre ulang semua yang gagal dipindai**, setelah penyebabnya diperiksa. Berkas terdeteksi berbahaya tetap dikunci; minta pengunggah mengganti berkasnya. Jangan mengubah status berkas secara manual. |
| **Hubungi** | Super Admin; pengelola Vercel bila pemindai tetap gagal |
| **Rincian** | [Operasi antivirus](OPERASI_ANTIVIRUS_BITSTREAM.md), [monitoring operasional](OPERASI_MONITORING.md#tindak-lanjut) |

## Backup

| | |
|---|---|
| **Gejala** | Isu **Pemeriksaan operasional gagal** dari workflow backup. Kartu **Backup database dan dokumen** atau **Uji pemulihan backup** berstatus **Gagal**, **Perlu perhatian** (bukti lebih tua dari 36 jam), atau **Belum terverifikasi**. |
| **Cara memeriksa** | Halaman run *Verified database and private document recovery*: langkah yang gagal, anotasi, serta `failureStage` dan `failureCode` di laporan artefak. |
| **Tindakan** | Anotasi "SIMSA backup melewati batas dokumen": naikkan batas sesuai [batas dokumen](OPERATIONS_RECOVERY.md#batas-dokumen-dan-kuota-blob). Login backup ditolak (`28P01`): [rotasi `simsa_backup`](RUNBOOK_KREDENSIAL_DATABASE.md#simsa_backup). Gangguan GitHub atau penyedia: jalankan ulang workflow secara manual. Selama backup belum hijau, artefak hijau terakhir tetap berlaku sampai 14 hari; unduh salinannya ke penyimpanan kantor. Tutup isu setelah penyebabnya ditangani. |
| **Hubungi** | Admin repositori GitHub; pemilik project Neon untuk kredensial |
| **Rincian** | [Cadangan dan pemulihan](OPERATIONS_RECOVERY.md) |

## Login

| | |
|---|---|
| **Gejala** | Pengguna tidak dapat masuk. |
| **Cara memeriksa** | Pesan di halaman login. Bila semua pengguna gagal, periksa `/ready` dan kartu **Database** di panel. |
| **Tindakan** | "Email atau kata sandi salah.": Super Admin memakai **Atur Ulang Kata Sandi** di Manajemen Pengguna. "Akun tidak aktif atau sesi tidak dapat dibuat. Hubungi administrator.": Super Admin memeriksa status akun. "Terlalu banyak percobaan masuk. Tunggu hingga 15 menit, lalu coba lagi.": tunggu 15 menit. Akun Google baru menunggu persetujuan Super Admin di Manajemen Pengguna, filter **Menunggu persetujuan**. Semua pengguna gagal: tangani sebagai gangguan database atau deployment. |
| **Hubungi** | Super Admin; pengelola Vercel bila semua pengguna terdampak |
| **Rincian** | [Login Google](akses-simsa/login-google.md), [manajemen pengguna](administrasi/user-management.md), [konfigurasi login produksi](DEPLOY_VERCEL_NEON.md#antivirus-native-sesuai-permintaan), [verifikasi akses](VERIFIKASI_AKSES_CLOUD.md) |

## Deployment dan rilis

| | |
|---|---|
| **Gejala** | Sesudah rilis, halaman kosong atau galat, `/ready` 503, smoke gagal, atau run *Release SIMSA to Vercel* gagal. |
| **Cara memeriksa** | `node scripts/ops/release-smoke.mjs backend https://simsa-backend.vercel.app` dan `node scripts/ops/release-smoke.mjs frontend https://simsa-frontend.vercel.app`. Ringkasan run rilis dan `rollback.md`. Vercel → Deployments. |
| **Tindakan** | Workflow rilis melakukan rollback otomatis bila promosi atau smoke gagal; hasil `INCOMPLETE` perlu tindakan manual. Rollback manual: promosikan kembali deployment sebelumnya, frontend dulu lalu backend, kemudian ulangi smoke. Tidak ada migrasi turun: bila rilis memuat migrasi, rollback backend hanya ke versi yang cocok dengan skema. |
| **Hubungi** | Pengelola Vercel; peninjau rilis |
| **Rincian** | [Prosedur rilis dan rollback](RUNBOOK_KREDENSIAL_DATABASE.md#rollback) |

## Setelah gangguan selesai

- Tutup isu GitHub yang terkait. Kegagalan berikutnya akan membuka isu baru.
- Catat kronologi, penyebab, tindakan, dan data yang perlu dicatat ulang, lalu sampaikan kepada Kasubbag TU.
- Perbarui [kondisi produksi](KONDISI_PRODUKSI.md) dan buku saku ini bila ada langkah yang berubah.
