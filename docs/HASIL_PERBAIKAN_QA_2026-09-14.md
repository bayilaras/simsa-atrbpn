# Hasil perbaikan SIMSA — 14 September 2026

Status: **perbaikan source teruji; deployment dan retest live masih diperlukan**. Dibuat 2026-09-14T22:49:41+07:00.

Perbaikan berasal dari hasil UAT dan pemeriksaan silang source. Pengujian lokal tidak mengubah status hasil deployment sebelumnya. Tidak ada migrasi database produksi, promosi Vercel, commit, push, atau perubahan akun Google live pada pekerjaan ini.

## Hasil validasi akhir

| Pemeriksaan | Hasil |
| --- | --- |
| Frontend Vitest, hasil terakhir per file | 747 PASS, 105 file; run penuh + rerun terarah |
| Backend Vitest | 2883 PASS, 202 file |
| Integritas manifest migrasi | 2 PASS |
| Browser Chromium pada build lokal | 5 PASS |
| Build frontend dan backend | PASS |
| ESLint frontend seluruh proyek | PASS |
| TypeScript backend | PASS |

Run frontend terakhir mencatat 744 lulus dan 1 timeout pada satu tes dialog panjang. Kasus tersebut diperbaiki dan diuji ulang; tabel memakai hasil terakhir per file dari seluruh105 file, bukan klaim satu run penuh tanpa kegagalan. Raw failure tetap disimpan. Kasus lama yang diganti tidak dihitung lagi. Rincian sumber hasil ada di frontend-verified-coverage.json.

Tes terarah RED/GREEN disimpan terpisah sebagai bukti reproduksi, tidak ditambahkan lagi ke total suite karena akan menghitung tes yang sama dua kali. Browser lokal menggunakan API sintetis terkontrol, memeriksa akun nonaktif/pending, QR unit sendiri/404, tampilan mobile, serta status jatuh tempo. Ia bukan pengujian OAuth Google nyata atau integrasi live backend.

## Perubahan yang ditangani

| Temuan | Masalah | Perilaku sesudah perbaikan lokal |
| --- | --- | --- |
| BUG-001 | Breadcrumb kelompok Surat | Kelompok menu menjadi label; link anak menuju route yang benar. |
| BUG-002 | Buat dosir pada pilihan semua unit | Kedua tombol memerlukan unit; pesan menjelaskan pilihan unit dan error penyimpanan tetap terlihat. |
| BUG-003 | Rentang tanggal dosir terbalik | Validasi UI, request, update sebagian dengan row lock, serta CHECK database; tanggal kosong dapat dihapus. |
| BUG-004 — keputusan kebijakan | Kode lokasi ganda | Kode dibandingkan tanpa kapital/spasi tepi dan unik di satu unit lintas tingkat; migrasi berhenti jika data lama duplikat. |
| BUG-005 | QR lokasi kosong | Field qrDataUrl sesuai API, error/retry tersedia; route tujuan QR memuat detail lokasi dengan scope unit. |
| BUG-006 | Identitas dan pencarian peminjaman | Nomor/judul arsip atau kode/nama boks tampil; pencarian dilakukan server sebelum pagination dan dapat menjangkau halaman berikutnya. |
| QA-AUTO-001 | Pagination Arsip Vital | Frontend membaca totalPages dari kontrak respons backend. |
| UNIT-BUG-ROOT-001 | Tunjuk silang duplikat menghasilkan 500 | SQLSTATE23505 bertingkat dari Drizzle dipetakan ke409 dengan pesan bisnis aman. |
| UNIT-BUG-ROOT-002 — historis/intermiten | Tanggal retensi hari ini gagal pada awal WIB | Trigger database memakai kalender Asia/Jakarta sama seperti validator API; tanggal masa depan tetap ditolak. |
| QA-AUTH-001 — review source | Akun nonaktif dapat masuk shell UI | isActive tersedia pada sesi Better Auth dan gate menolak akun nonaktif; backend sudah menolak permintaan bisnis sebelumnya. |
| QA-LENDING-CLASS-001 — review perubahan | Klasifikasi metadata peminjaman | Kebijakan role berlaku sebelum list/search/count/overdue/stats/detail/history; akun tidak memperoleh metadata arsip di luar klasifikasinya. |
| QA-LENDING-DATE-001 — review source | Badge terlambat pada hari jatuh tempo | Frontend mengikuti status server; tanggal jatuh tempo hari ini tetap Dipinjam, memakai kalender WIB. |
| QA-DOSIR-RACE-001 — review source | Respons dosir lama menimpa unit/filter baru | Data dan statistik mengikuti actor/unit/filter/revision aktif, respons lama diabaikan, error terbaru dapat dicoba kembali. |

Semua baris di atas berstatus **FIXED_LOCAL / LIVE_RETEST_PENDING**. BUG-004 tetap memiliki asumsi kebijakan bisnis: unik per unit lintas tingkat, case-insensitive dan mengabaikan spasi tepi. Tidak ada klaim bahwa PRD menyebutkan aturan persis tersebut. Temuan klasifikasi peminjaman dicegah selama review perubahan; tidak dihitung sebagai kebocoran deployment yang sudah direproduksi.

## Akses yang disarankan untuk login Google pertama

SIMSA merupakan aplikasi arsip internal. Pertahankan akun yang sudah didaftarkan admin sebelum login Google: identitas Google yang cocok dan terverifikasi hanya membuka hak SIMSA yang telah ditetapkan.

| Keadaan | Akses yang disarankan |
| --- | --- |
| Email Google belum didaftarkan admin | Tetap tolak pendaftaran otomatis seperti implementasi sekarang; sediakan arahan menghubungi admin pada alur masuk. |
| Akun terautentikasi tetapi belum diberi role/unit | Status akses, periksa ulang akses, dan keluar. Tidak ada data bisnis. |
| Akun aktif dengan role dan unit sah | Menu, data, unduhan, dan tindakan sesuai izin role/unit/klasifikasi yang sudah disetujui. Admin Unit tidak diberikan otomatis. |
| Akun nonaktif | Pesan akun dinonaktifkan, periksa ulang, dan keluar; API bisnis menolak akses. |
| Jika onboarding publik kelak diperlukan | Usulan terpisah: profil sendiri terbatas, bantuan, permohonan unit, status persetujuan, keluar. Role dan unit otoritatif hanya ditetapkan admin. Alur ini belum dibuat. |

Jangan menentukan hak admin dari alamat email atau domain saja. Identitas dan kewenangan merupakan pemeriksaan terpisah. Rujukan: [Google: verifikasi ID token](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token) dan [OWASP: Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html). Detail source dan regresi autentikasi ada di [catatan akses Google](AKSES_GOOGLE_DAN_PERBAIKAN_QA_2026-09-14.md).

## Migrasi dan batas rilis

1. Pertahankan snapshot rilis produksi dan helper backup yang cocok dengan journal database aktual. Helper kandidat dengan46 entri tidak cocok untuk backup sumber yang masih memakai journal lama.
2. Jalankan preflight baca-saja untuk kode lokasi duplikat dan tanggal dosir terbalik. Data lama tidak dihapus/diganti nama otomatis. Migrasi0044 berhenti dengan rincian konflik apabila duplikasi ada; rekonsiliasi membutuhkan keputusan pemilik data.
3. Jalankan runner migrasi resmi dengan identitas migrator, berurutan0043–0045. 0043 memperbaiki kalender WIB;0044 menegakkan kode lokasi;0045 menambah CHECK tanggal dosir NOT VALID agar baris lama dipertahankan. Setiap update baris dosir lama yang salah tetap harus menghasilkan tanggal valid.
4. Deploy hanya delta rilis yang telah direview di atas snapshot produksi yang diketahui. Repositori kerja memiliki perubahan lain yang belum dikirim; jangan otomatis mempromosikan seluruh salinan kerja.
5. Ulangi UAT pada build deployment memakai tiga role/unit yang telah tersedia, termasuk QR, pencarian lebih dari50 data, batas klasifikasi, tanggal WIB, konflik lokasi, duplikasi tunjuk silang, dan alur dosir.

Tes PGlite memverifikasi SQL/migrasi terisolasi, bukan bukti locking dua koneksi PostgreSQL produksi. Dokumen sumber menyebut60 FR, tetapi255 skenario workbook lengkap belum tersedia pada UAT sebelumnya. Integrasi eksternal dan alur yang sebelumnya EXCLUDED tidak otomatis berubah menjadi lulus.

Catatan teknis migrasi: [QA backend](../backend/QA-BACKEND-REMEDIATION.md). Baseline live historis: [laporan UAT](../../simsa-qa/QA_REPORT.md).

## Reproduksi dan bukti

Jalankan dari folder proyek yang dependensinya sudah terpasang:

```powershell
# folder frontend
npm test -- --maxWorkers=2
npm run lint
npm run build

# folder backend
npm test -- --maxWorkers=2
npx tsc --noEmit
npm run build

# root repo
node --test scripts/migration-manifest.test.mjs
```

Pengaturan Vitest frontend memakai jsdom Web Storage di worker Node24. Dua ekspektasi lama untuk induk JRA disesuaikan agar memverifikasi terlihat namun disabled dan tidak dapat dipilih; leaf valid tetap dapat dipilih. Tes route opsional memakai shell ringan sementara route/guard produk tetap nyata. Run awal mencatat timeout dan kegagalan startup worker saat backend/build berjalan bersamaan. Kasus terdampak diuji ulang, interaksi dialog menunggu state yang tepat, dan budget test UI dibatasi15 detik karena alur banyak langkah dapat melebihi default5 detik pada worker sibuk. Run penuh berikutnya tidak memiliki worker error, tetapi masih mempunyai satu timeout dialog. Tes panjang tersebut dipisahkan menjadi kasus perilaku tersendiri dan diuji ulang; assertion bisnis dipertahankan. Tidak ada perubahan produk akibat pemisahan tes itu.

Folder bukti [simsa-remediation-evidence-20260914](../../simsa-remediation-evidence-20260914) berisi full-suite JSON/log, bukti RED/GREEN, hasil browser, screenshot, hash source, patch review, dan backup file sebelum integrasi. `integration-result.json` merupakan sumber status integrasi yang sebenarnya; `verification-final.json` mengikat hasil validasi ke hash kandidat. Password dan sesi live tidak ditulis dalam paket perbaikan.
