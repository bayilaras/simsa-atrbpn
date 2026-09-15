# Pemeriksaan keamanan SIMSA — 12 September 2026

Ada perbaikan yang diperlukan. Audit ini menemukan kelemahan konfigurasi Production dan kelemahan kode yang dapat direproduksi secara lokal. Tidak ada bukti dalam pemeriksaan ini bahwa akun sudah diambil alih atau dokumen telah bocor. Hasil ini bukan jaminan bahwa semua celah sudah ditemukan.

## Lingkup dan metode

- Repositori `bayilaras/simsa-atrbpn`, checkout `b25b418a41c88c4a913b148032f8e3dfa4934a69`.
- Production: `https://simsa-frontend.vercel.app`, Better Auth, PostgreSQL Neon, Vercel Blob privat, worker ClamAV on-demand.
- Tidak ada perbedaan source backend pada checkout terhadap source rilis backend `087c8fef5710dab2a0f9e29253cd7c0afbb2ecf0`; tidak ada perbedaan source frontend terhadap rilis frontend `2b686a9a65a6ddcf5ea9cf6a9906ee33f361564f`.
- Audit dependensi dari kedua lockfile melalui npm registry; pembacaan autentikasi, peran/unit, upload/download, impor, error handling, logging, konfigurasi hosting, cache, dan CI.
- Production hanya menerima 11 permintaan GET terarah tanpa kredensial. Tidak ada brute force, unggah malware, perubahan data, perubahan akun, atau beban massal di Production.
- Reproduksi menggunakan middleware/service/rute sebenarnya di proses uji lokal, dengan identitas dan kegagalan provider sintetis serta database yang dimock. Tidak menggunakan database operasional lokal maupun kredensial Production.
- Strix tidak dijalankan karena CLI belum tersedia. Tidak digunakan layanan pentest berbayar atau pengiriman source/kredensial ke Strix. Ini adalah audit kode, dependensi, uji terarah, dan pemeriksaan HTTP, bukan laporan pentest Strix.

## Temuan dan urutan perbaikan

### SEC-01 — Header keamanan tidak diterapkan pada frontend Production

**Sedang; terkonfirmasi pada HTTP Production.** `GET /login` menghasilkan 200 tanpa `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, dan `Referrer-Policy`. HSTS sudah ada. API mengirim header dari Helmet, tetapi halaman statis frontend dilayani oleh Vercel dan tidak melewati Express. `frontend/vercel.mjs:210` hanya mengembalikan konfigurasi build dan rewrites; `frontend/index.html` tidak menyediakan CSP meta sebagai pengganti.

Dampak: lapisan pembatasan eksekusi skrip dan pembingkaian halaman tidak berlaku pada dokumen HTML yang menjalankan aplikasi. Tidak ditemukan atau dibuktikan XSS dalam audit ini; kehilangan CSP sendiri bukan bukti pencurian sesi.

**Perbaikan:** terapkan header pada frontend Vercel, termasuk CSP yang membatasi sumber sesuai kebutuhan sebenarnya dan `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, dan kebijakan referrer. Uji login Google, unggah Blob langsung, PDF, dan PWA setelah perubahan agar CSP tidak memutus fitur. Jangan menyalin CSP backend tanpa menguji kebutuhan frontend.

Kriteria selesai: respons HTML pada `/login` dan rute SPA memuat kebijakan tersebut; alur Google dan PDF tetap bekerja. [Dokumentasi Vercel](https://vercel.com/docs/cdn-security/security-headers).

### SEC-02 — Pembatasan percobaan login tidak dibagi antar-instance

**Sedang; perilaku direproduksi lokal, relevan dengan konfigurasi serverless Production.** `backend/src/middlewares/rate-limiter.middleware.ts:26` tidak memilih store bersama; implementasi express-rate-limit menggunakan MemoryStore. Better Auth juga tidak dikonfigurasi menggunakan database/secondary storage, sehingga menggunakan memori.

Reproduksi: permintaan lokal mencapai HTTP 429 pada instance pertama, tetapi instance middleware baru dengan IP yang sama kembali menerima permintaan. Ambang test 50 dan ambang Production 5 memakai mekanisme penyimpanan yang sama. Tidak dilakukan brute force atau pemaksaan cold start di Production.

Dampak: batas percobaan tidak konsisten ketika fungsi serverless berganti instance atau dimulai ulang. Ini melemahkan proteksi login kata sandi yang masih tersedia; bukan bypass autentikasi Google.

**Perbaikan:** gunakan penghitung bersama yang atomik dengan TTL, misalnya melalui PostgreSQL yang sudah tersedia, untuk limiter autentikasi dan operasi mahal. Verifikasi identitas IP di balik proxy, perilaku konkurensi, pembersihan data kadaluarsa, serta penanganan kegagalan store. Hindari pola baca-lalu-tulis yang dapat dilangkahi permintaan bersamaan.

Kriteria selesai: batas tetap berlaku pada dua instance dan setelah proses aplikasi dimulai ulang. [express-rate-limit](https://express-rate-limit.mintlify.app/reference/stores), [Better Auth](https://better-auth.com/docs/concepts/rate-limit).

### SEC-03 — Pesan kesalahan internal diteruskan ke klien

**Sedang; reproduksi HTTP lokal pada rute sebenarnya dengan fault injection.** `backend/src/routes/google-drive-import.routes.ts:105` mengirim `error.message` tanpa klasifikasi error. Rute listing sheets pada baris 70 dan rute lampiran `backend/src/routes/upload.routes.ts:201` juga meneruskan pesan mentah. Beberapa operasi arsip elektronik memiliki pola serupa, tetapi modul lanjutnya saat audit nonaktif di Production.

Reproduksi: service preview diberi kegagalan sintetis dengan marker internal; respons HTTP 500 kepada identitas uji berisi marker yang sama. Pengujian membuktikan penerusan pesan, bukan bahwa kredensial nyata telah bocor. Dampak nyata bergantung pada isi exception yang dilempar database/provider.

**Perbaikan:** pisahkan error validasi/domain yang boleh ditampilkan dari exception internal. Gunakan pesan umum, kode error stabil, dan request ID; simpan hanya metadata operasional yang aman di logger. Audit pula array `errors` pada hasil impor agar pesan exception per baris tidak lolos.

Kriteria selesai: marker rahasia sintetis pada error database/provider tidak muncul pada respons atau log; pesan validasi yang aman tetap membantu pengguna.

### SEC-04 — Impor Google Sheets tidak mempunyai batas pengambilan dan preview yang memadai

**Sedang; perilaku service direproduksi lokal, kehabisan sumber daya Production tidak diuji.** `backend/src/services/google-drive-import.service.ts:103` memanggil fetch tanpa deadline dan mengonsumsi seluruh respons dengan `response.text()` pada baris 108. `listSheets` juga membaca seluruh HTML dan dapat mencoba beberapa fetch lanjutan. `previewData` mem-parsing seluruh CSV sebelum memotong hasil; `maxRows` dari klien tidak dibatasi di rute.

Reproduksi: fetch service tidak menerima AbortSignal; preview dengan batas besar mengembalikan seluruh 1.200 baris data sintetis. Tidak dikirim spreadsheet besar atau lambat ke Production. URL aktual direkonstruksi pada host Google dari ID yang diekstrak; audit ini tidak membuktikan SSRF ke host arbitrer.

**Perbaikan:** batasi waktu total, byte respons, baris/kolom/panjang field, dan rentang `maxRows`; gunakan pembacaan stream dengan penghentian saat batas tercapai. Batasi redirect ke host yang memang dibutuhkan, tambahkan kuota impor bersama per pengguna, dan batalkan fetch ketika klien terputus. Batas unggah PDF 10 MiB tidak otomatis melindungi unduhan CSV ini.

Kriteria selesai: sumber lambat, response terlalu besar, dan permintaan preview berlebihan ditolak secara terukur tanpa menghabiskan memori atau melakukan sebagian impor secara tidak jelas.

### SEC-05 — Input CSRF multibyte menghasilkan exception

**Rendah; direproduksi lokal.** `backend/src/middlewares/csrf.middleware.ts:118` membandingkan jumlah karakter, lalu baris 126 membandingkan buffer dengan `timingSafeEqual`. Token 64 karakter ASCII dan header 64 karakter multibyte lolos pemeriksaan panjang karakter, tetapi menghasilkan buffer berbeda panjang dan melempar RangeError.

Dampak yang dibuktikan: input token malformed menjadi exception, bukan penolakan CSRF normal. Ini bukan bypass CSRF dan bukan bukti proses server berhenti.

**Perbaikan:** validasi tipe dan format token, bandingkan panjang buffer, kemudian gunakan perbandingan konstan waktu. Kembalikan 403 untuk semua token malformed.

## Verifikasi yang sudah lulus

- `npm audit` backend: **0 advisory** pada lockfile yang diperiksa, termasuk development dependencies.
- `npm audit` frontend: **0 advisory** pada lockfile yang diperiksa, termasuk development dependencies. Tidak ada dasar dari hasil ini untuk upgrade paksa; hasil nol tidak meniadakan bug logika atau advisory yang belum dipublikasikan.
- Enam file tes frontend: **34/34 assertion lulus** menurut laporan Vitest. Wrapper PowerShell melaporkan exit 1 meskipun JSON `success=true`; karena itu ini bukan klaim bahwa keseluruhan command/CI hijau. Log juga mencatat keterbatasan navigasi jsdom.
- Lima reproduksi audit: **5/5 lulus mendemonstrasikan kelemahan**, bukan lima perbaikan yang sudah selesai. Percobaan awal harness gagal saat resolusi mock dan saat import pertama melewati deadline; harness disesuaikan tanpa mengubah source aplikasi.
- Pemindaian pola kredensial terpilih pada **1.235 file teks tracked**: tidak ada kecocokan. Sembilan file binary/besar dilewati. Nilai rahasia tidak direkam. Ini bukan pemindaian seluruh riwayat Git atau semua jenis secret.
- HTTP Production: `/api/users`, `/api/arsip`, `/api/audit-log`, `/api/unit-kerja`, dan endpoint lampiran uji menolak anonim dengan 401; origin tak dipercaya ditolak 403; bearer sintetis tidak valid ditolak 401; GET ke worker internal ditolak 405.
- Konfigurasi Google di kode menutup pendaftaran publik, mempertahankan CSRF/state, dan tidak menerima input role/unit melalui Better Auth. Middleware memeriksa pengguna aktif dan mandat unit. Download berkas memakai pemeriksaan akses, status karantina, serta audit. Temuan positif ini tidak menggantikan pentest lintas akun pada staging.

## Hasil tes backend dan kualitas rilis

Putaran awal terarah mencatat 281 tes: **277 lulus, 1 assertion gagal, 3 tidak dijalankan**, serta satu suite rute gagal di tahap import sehingga tidak menyumbang assertion. Pemeriksaan ulang tiga suite terkait mencatat **28/29 assertion lulus**, satu assertion tetap gagal, dan suite rute tetap gagal saat import. Ketiga tes `google-oauth-provider` lulus pada pemeriksaan ulang; kegagalan awal suite itu tidak menjadi temuan kerentanan Google. Dua masalah tes yang konsisten tersisa dijelaskan berikut. Angka pemeriksaan ulang tidak ditambahkan ke putaran pertama karena sebagian besar tes sama.

Dua masalah suite sudah dapat ditelusuri ke source:

1. `backend/src/routes/__tests__/surat-file-security.routes.test.ts:71` memock `uploadLimiter` tetapi tidak menyediakan `sensitiveLimiter` yang kini diimpor rute pemulihan scan. Akibatnya suite keamanan rute tidak dapat dimuat.
2. `backend/src/__tests__/malware-scanner.config.test.ts:114` masih mengharapkan kebijakan Vercel hanya `external`, sementara kode sekarang mendukung `external` atau `on-demand`. Tes perlu diselaraskan sambil tetap membuktikan mode embedded ditolak dan mode on-demand divalidasi secara ketat.

Perbaikan suite ini penting sebelum rilis berikutnya; kegagalan tes tidak dengan sendirinya membuktikan malware bisa lolos. Jangan menghapus tes atau melemahkan assertion hanya untuk mendapatkan status hijau.

## Risiko operasional dan cakupan yang belum terbukti

Menurut `docs/STATUS_PRODUKSI.md:24`, bukti cadangan terakhir yang tercatat masih mempunyai `restore_verified=false` dan belum memiliki salinan di luar workstation. Jadwalkan salinan terenkripsi di lokasi terpisah serta uji pemulihan database dan berkas, dengan kunci terpisah. Keberhasilan backup terbaru di akun cloud belum diverifikasi ulang dalam audit ini. Ini risiko pemulihan/kehilangan data, bukan exploit yang telah dibuktikan.

Belum dilakukan: pentest staging end-to-end dengan dua akun lintas unit, stress/load testing, penyuntikan malware di Production, audit IAM/dashboard cloud lengkap, pemeriksaan seluruh riwayat Git, pemeriksaan semua isi PDF, inspeksi objek pada storage publik lama, uji pemulihan backup nyata, maupun audit seluruh jalur Firebase/GCP/Spark yang tidak dipakai deployment ini. Status 2FA akun Google pengguna juga belum diperiksa.

Dokumentasi API terdaftar publik di source; GET `/api/docs` hanya diperiksa sampai redirect 301. Pertimbangkan pembatasan dokumentasi internal, tetapi keberadaan dokumentasi bukan bukti akses ke data arsip.

Urutan kerja yang disarankan: header frontend dan error handling; limiter bersama dan batas impor; perbaikan CSRF serta suite gagal; uji lintas unit di staging dan verifikasi pemulihan backup. Tidak ada source aplikasi, akun, konfigurasi Production, atau deployment yang diubah oleh audit ini.

## Artefak lokal

Artefak berada pada direktori `output/` yang diabaikan Git:

- `security-audit-public-20260912.json` — status/header HTTP tanpa isi dokumen.
- `security-audit-backend-20260912.json`, `security-audit-frontend-20260912.json` — laporan npm audit.
- `security-audit-tests-backend-20260912.json`, `security-audit-tests-frontend-20260912.json` — hasil suite terarah.
- `security-audit-recheck-backend-20260912.json` — pemeriksaan ulang suite backend bermasalah.
- `security-audit-repro-20260912.test.ts`, `security-audit-repro-20260912.json` — reproduksi lokal dan hasilnya.
- `security-audit-secret-scan-20260912.json` — hasil pola secret tanpa nilai sensitif.

Menjalankan harness reproduksi dari root repo memerlukan Node 24 dan dependencies backend yang sudah terpasang: `node backend/node_modules/vitest/vitest.mjs run --config output/security-audit-vitest.config.mjs`. Harness sengaja memverifikasi perilaku rentan saat ini dan harus dibalik menjadi assertion penolakan setelah perbaikan; jangan menjadikannya gate penerimaan Production apa adanya.
