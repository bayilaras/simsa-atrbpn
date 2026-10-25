# Hasil promosi produksi — 12 September 2026

**Deployment berhasil dipromosikan sesuai instruksi pengguna “lanjutkan deploy”.** Frontend dan backend yang aktif adalah artefak kandidat yang sebelumnya lulus pengujian, tanpa rebuild atau migrasi database baru. Aplikasi: [simsa-frontend.vercel.app](https://simsa-frontend.vercel.app).

## Deployment aktif

| Komponen | Domain produksi | Deployment aktif | Promosi terverifikasi |
| --- | --- | --- | --- |
| Backend | `simsa-backend.vercel.app` | `dpl_4FWzGVK2UgJmsXjMAJ7kzZ7k1vbd` | 12 September 2026, 22:29:40 WIB |
| Frontend | `simsa-frontend.vercel.app` | `dpl_aw3g2Dsrh73KEFCuUKzsCux9ctyy` | 12 September 2026, 22:30:28 WIB |

Promosi memakai `vercel promote` pada ID deployment eksplisit: backend terlebih dahulu, health/readiness diperiksa, lalu frontend. Snapshot sumber serta manifest kedua kandidat diperiksa ulang dan tetap utuh. CLI dijalankan dari direktori promosi tersendiri dengan project ID yang dipastikan benar; metadata CLI pada capture sumber tidak diubah.

Frontend tetap mengarahkan API ke URL immutable backend yang sama dengan kandidat yang diuji. Domain produksi diterima oleh kebijakan origin backend. TTE tersertifikasi serta integrasi SRIKANDI tidak ditambahkan; SRIKANDI tetap nonaktif. Tidak ada commit, push, unggahan PDF baru, atau perubahan surat pada tahap promosi.

## Hasil pengujian

Kandidat telah lulus **2.516 tes backend**, **473 tes frontend**, TypeScript, lint, build, dan 109 assertion smoke kandidat. Rincian serta hash sumber ada pada [laporan kandidat](HASIL_KANDIDAT_DEPLOYMENT_2026-09-12.md).

**Smoke HTTP setelah promosi: 36/36 pemeriksaan lulus**, melalui 25 permintaan aplikasi, selesai pukul 22:31:50 WIB. Ini pemeriksaan langsung pada domain produksi:

- Kedua alias canonical menunjuk deployment kandidat yang benar dan berstatus READY.
- Health, readiness, dan capabilities backend langsung serta proxy frontend mengembalikan HTTP 200; mode full, Better Auth, dan kemampuan berkas privat aktif.
- Shell, deep link, JavaScript, dan service worker tersedia dengan header keamanan yang sesuai. Pemeriksaan service worker mencakup pola NetworkOnly API secara statis, bukan seluruh keadaan cache pengguna.
- Login berhasil, cookie sesi Secure/HttpOnly, unit kerja dan surat sintetis yang sudah ada dapat dibaca.
- Status lampiran tetap `clean`, `verified`, dan `private`. Endpoint inline serta attachment masing-masing mengirim PDF **10.000.000 byte**, SHA-256 `41a4ba02879617ce26a7d8f555e539f2ebfa131645aa860297151595e9389cb0`.
- Permintaan metadata/berkas tanpa login ditolak HTTP 401. Setelah logout, sesi lama ditolak dan endpoint sesi mengembalikan null.

Pengujian ulang memakai surat sintetis kandidat yang sudah ada. Tidak membuat surat atau unggahan kedua dan tidak menjadwalkan ulang scan secara manual. Keberhasilan engine native pada kandidat tetap merujuk bukti pengujian sebelum promosi, bukan diklaim sebagai pemindaian baru setelah promosi.

Pemeriksaan browser pada domain produksi menunjukkan tab yang mula-mula memuat `/assets/index-DeLxUDSZ.js` berhasil beralih setelah reload ke `/assets/index-C5qZwGRl.js`, sesuai aset yang dilayani produksi. Login password membuka dashboard dan detail surat yang sama; sesi tetap aktif setelah reload detail. Logout kembali ke halaman login dan tetap logout setelah reload. Pemeriksaan konsol tidak mengembalikan entri error pada titik yang diamati. Bukti observasi sesi dan konsol disimpan terpisah.

Review runtime terpisah pada jendela 22:29:00–22:35:44 WIB mengamati **50 request unik: 47 HTTP 200 dan 3 HTTP 401**, tanpa HTTP/function 5xx, crash, atau log berlevel error pada sampel. Status 401 merupakan penolakan akses API/berkas terproteksi dan dipisahkan dari kegagalan server. Pembacaan dibatasi 10 halaman dan API masih menyatakan ada halaman lain; hasil ini bukan inventaris seluruh log. Kedua target produksi serta kedua deployment lama untuk rollback diverifikasi READY. Pemeriksaan alias penutup pukul 22:38:37 WIB tetap menunjuk kandidat yang dipromosikan.

## Bukti dan rollback

Artefak tersanitasi berada di workspace operator dan tidak dilacak Git:

- `output/promotion-verification/preflight.json`: pin identitas, kelulusan build, keutuhan capture sumber, serta versi rollback.
- `output/promotion-verification/independent-prepromotion.json`: review terpisah mengenai target, origin, proxy, dan mekanisme promosi.
- `output/promotion-verification/backend-promoted.json` dan `frontend-promoted.json`: alias aktual setelah masing-masing promosi.
- `output/candidate-verification/production-promotion/smoke-*.json`: 36 hasil pemeriksaan HTTP.
- `output/promotion-verification/browser-postpromotion.json`: hasil browser setelah promosi.
- `output/promotion-verification/independent-postpromotion.json`: pemeriksaan terpisah status produksi dan cuplikan log runtime.

Versi sebelumnya dipertahankan: frontend `dpl_Aqd25jwGpT7N3c4tJP1yzEpG4J5s` dan backend `dpl_CWnJz48FByoFLTcQtf62bZTTkX6n`. Jika ditemukan regresi yang memerlukan rollback, jalankan promosi ID frontend sebelumnya lalu backend sebelumnya dengan project/scope yang sesuai, dan ulangi health/readiness serta smoke autentikasi/berkas. Tidak perlu rollback schema untuk rilis ini karena tidak ada migrasi baru. Rollback tidak dijalankan pada tahap ini.

## Batas validasi yang tetap terbuka

Promosi dilakukan setelah pengguna menerima laporan kandidat dan menginstruksikan deployment dilanjutkan. Instruksi itu tidak mengubah batas bukti berikut:

- Tampilan PDF inline belum terverifikasi secara visual; pada pemeriksaan kandidat area iframe kosong dan alat browser menolak membuka tautan Blob. Pengiriman byte PDF serta unduhan sudah lulus, tetapi penyebab visual belum dipastikan dan pembatasan alat tidak dilewati.
- Callback Google sampai sesi aplikasi, semua kombinasi peran/unit, serta impor Google Sheets dari sumber nyata belum diuji end-to-end pada promosi ini.
- Backup Neon terenkripsi belum memiliki bukti restore sumber sebenarnya dan salinan offsite; backup database tidak mencakup byte PDF privat. Lihat [backup Neon](BACKUP_NEON.md).
- Pemeriksaan sesaat setelah promosi bukan pengukuran stabilitas jangka panjang atau uji beban.
