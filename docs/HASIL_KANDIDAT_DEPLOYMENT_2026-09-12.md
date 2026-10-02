# Hasil kandidat deployment SIMSA — 12 September 2026

> Pembaruan: kandidat pada laporan ini telah dipromosikan atas instruksi pengguna pada 12 September 2026 pukul 22:29–22:30 WIB. [Hasil promosi dan pengujian produksi](HASIL_PROMOSI_PRODUKSI_2026-09-12.md). Status “belum dipromosikan” di bawah merupakan keadaan saat pengujian kandidat selesai, bukan status produksi terkini.

**Tujuh temuan P2 diperbaiki; gate source/build cloud dan smoke HTTP kandidat lulus. Belum dipromosikan.** Pemeriksaan browser untuk login, daftar, balasan, edit, dan navigasi selesai; tampilan PDF inline masih belum terverifikasi. Karena itu laporan ini belum memberi persetujuan promosi tanpa syarat. Laporan menindaklanjuti [review prarilis](REVIEW_PRARILIS_2026-09-12.md). SIMSA tetap berdiri sendiri; integrasi SRIKANDI dan TTE tersertifikasi tidak ditambahkan.

## Perbaikan tujuh temuan

| Area | Perilaku setelah perbaikan dan bukti source |
| --- | --- |
| Login serentak dari IP bersama | Penolakan karena kuota tidak menetap sebagai kegagalan autentikasi selama 15 menit. Refund hanya mengurangi window asal; counter tetap atomik, kegagalan store tetap menolak akses, dan lifecycle Vercel menjaga pekerjaan refund. Kuota burst Better Auth tetap berlaku. [Middleware autentikasi](../backend/src/middlewares/auth-attempt-limiter.middleware.ts), [store PostgreSQL](../backend/src/services/postgres-rate-limit.store.ts). |
| Halaman daftar yang hilang | Surat Masuk dan Surat Keluar mengoreksi posisi setelah total halaman berkurang, lalu mengambil ulang halaman yang valid. Respons lama tidak menggantikan hasil permintaan terbaru. [Surat Masuk](../frontend/src/pages/SuratMasuk.jsx), [Surat Keluar](../frontend/src/pages/SuratKeluar.jsx). |
| Pencarian surat yang dibalas | Pencarian dan pagination dilakukan di server sehingga tidak berhenti pada 100 surat pertama. Pilihan yang sudah tertaut tetap tampil saat edit; tersedia retry dan pemilihan melalui keyboard. [Form surat keluar](../frontend/src/pages/TambahSuratKeluar.jsx), [service surat masuk](../frontend/src/services/surat-masuk.service.js). |
| Pemulihan kapabilitas | Maksimum tiga pemeriksaan per siklus, tombol retry, serta pemulihan ketika koneksi/fokus kembali dengan jeda 30 detik. Fitur menunggu respons yang valid. Pemeriksaan ulang tidak mereset isian edit; gangguan health konektor opsional tidak mematikan kapabilitas inti yang sudah diverifikasi. [Provider](../frontend/src/context/AppConfigContext.jsx), [gate konfigurasi](../frontend/src/components/RuntimeConfigurationGate.jsx). |
| Pemetaan kolom Sheets | Nama kolom dicocokkan tepat setelah normalisasi. Header wajib yang hilang atau ambigu ditolak sebelum penulisan. Preview mengembalikan jenis impor dan mapping yang ditampilkan UI; perubahan sumber, unit, atau jenis membuang preview lama. [Pemetaan](../backend/src/services/google-sheets-import-mapping.ts), [dialog impor](../frontend/src/components/ImportFromGDrive.jsx). |
| Duplikasi impor serentak | Pemeriksaan identitas impor dilakukan bersama pembuatan surat dalam transaksi canonical, termasuk jalur CSV agar impor CSV dan Sheets yang bersamaan tidak berlomba. Identitas memakai tanggal valid dan kebijakan yang juga mengenali surat terhapus; impor ulang tidak memulihkannya. UI membedakan hasil tanpa perubahan karena semua data sudah ada dari kegagalan. [Impor Sheets](../backend/src/services/google-drive-import.service.ts), [surat masuk](../backend/src/services/surat-masuk.service.ts), [surat keluar](../backend/src/services/surat-keluar.service.ts). |
| Kuota wizard Sheets | Discovery, preview, dan impor mempunyai kuota masing-masing tiga permintaan per menit per pengguna. Respons 429 menyertakan waktu tunggu; UI menunggu per langkah dan tidak mengulang penulisan otomatis. [Routes Sheets](../backend/src/routes/google-drive-import.routes.ts), [limiter](../backend/src/middlewares/rate-limiter.middleware.ts), [dialog impor](../frontend/src/components/ImportFromGDrive.jsx). |

## Bukti pengujian yang tersedia

Angka berikut dilaporkan per kelompok. **Jangan menjumlahkannya sebagai total tes unik:** suite backend, tes CSV, dan gate cloud mempunyai cakupan yang beririsan.

| Pemeriksaan | Hasil |
| --- | --- |
| Frontend terarah | **55 tes unik / 10 berkas lulus**: pagination 2, picker 3, formulir 19, tanggal 5, UI Sheets 11, payload Sheets 1, provider/recovery/optional health 8, gate konfigurasi 6. |
| Lint perubahan frontend | 17 berkas diperiksa; exit 0. `git diff --check` bersih. |
| Konfigurasi/routing Vercel | 32 tes frontend lulus; 14 tes kebijakan deployment di root, 15 tes lifecycle build, dan 2 tes Node interop lulus. Dicatat terpisah dari 55 tes frontend terarah. |
| Autentikasi backend | 27 tes terarah lulus; 9 tes PostgreSQL native lulus. |
| Sheets backend | 113 tes terarah lulus; 7 tes konkurensi PostgreSQL native lulus. Tes CSV 27 lulus, dengan cakupan beririsan; bukan tambahan total unik. |
| Perbaikan oracle proses lintas platform | 19 tes terarah lulus. Tes proses nyata juga lulus dalam full suite Linux. Oracle membedakan proses Linux zombie/mati dari proses yang masih hidup; kode guard produksi dan deadline tidak dilonggarkan. |
| Backend penuh di kandidat Vercel/Linux | **TypeScript lulus; 185 berkas / 2.516 tes lulus**, 227,46 detik untuk suite. Build deployment selesai dalam 303,457 detik. |
| Frontend penuh di kandidat Vercel/Linux | **Lint lulus; 74 berkas / 473 tes lulus**, 97,56 detik untuk suite; build Vite dan PWA lulus. Build deployment selesai dalam 155,171 detik. |

Tes frontend Windows memakai Node 24, satu worker, dan batas waktu tes 20 detik. Pool threads digunakan setelah fork worker gagal startup. Kegagalan awal tiga fixture cooldown berasal dari pengembalian clock ke waktu nyata sebelum retry; fixture diperbaiki dan seluruh 11 tes UI Sheets kemudian lulus. Batas waktu layanan produksi tidak dilonggarkan. Bukti regresi berada pada [tes recovery](../frontend/src/context/AppConfigContext.recovery.test.jsx), [optional health](../frontend/src/context/AppConfigContext.optional-health.test.jsx), dan [alur Sheets](../frontend/src/components/ImportFromGDrive.flow.test.jsx).

## Identitas kandidat yang diuji

Deploy memakai lingkungan Production Vercel dengan `--skip-domain`. Ini menyediakan runtime native dan layanan yang sudah dikonfigurasi tanpa memindahkan dua domain canonical. Kandidat berbagi database dan penyimpanan produksi; ini bukan staging dengan data terisolasi. Tidak ada migrasi database baru pada pekerjaan kandidat ini.

| Identitas | Backend | Frontend |
| --- | --- | --- |
| Deployment | `dpl_4FWzGVK2UgJmsXjMAJ7kzZ7k1vbd` | `dpl_aw3g2Dsrh73KEFCuUKzsCux9ctyy` |
| Status platform | READY | READY |
| URL immutable | [Backend kandidat](https://simsa-backend-lnrv7m5wm-bayilaras-projects.vercel.app) | [Frontend kandidat](https://simsa-frontend-p60hcg6h1-bayilaras-projects.vercel.app) |
| SHA-256 manifest source | `5a0bf6dc709ba91ffa791712a1f3545342f245542f65cd3b9641f05a72be21c9` | `46180ee3b7e6fe63d364ee5f22a6260d430d83e8449bb31a0483732ae6065ede` |
| SHA-256 log build | `8ff762e5c1d99ada1def6b88e9e12ecb48acaeaed0e04fe7c0f6b84d139295e2` | `0b6c4d1029f91dee461943f42fe914275f2e53902b4602bd6c4aee307a51862b` |

Alias untuk menguji aplikasi: **[simsa-prarilis-20260912.vercel.app](https://simsa-prarilis-20260912.vercel.app)**. Frontend mengikat proxy API ke backend immutable di atas. Berkas runtime backend pada capture frontend sama dengan capture backend yang lulus. Perbedaan tes konfigurasi repository dicatat dalam binding; laporan ini diselesaikan setelah capture sehingga perubahan dokumentasinya bukan perubahan runtime.

Gate [verify-candidate-source.mjs](../scripts/verify-candidate-source.mjs) dijalankan melalui entrypoint build canonical, dengan `SIMSA_VERIFY_CANDIDATE_SOURCE=1`. Proses tes memakai environment terbatas tanpa kredensial produksi. Kegagalan lint, TypeScript, atau tes menghentikan build sebelum publikasi artefak. Bukti tersanitasi berada di `output/candidate-verification/`, terutama `backend-build-verification.json`, `frontend-build-verification.json`, manifest source, dan log build.

Riwayat percobaan tetap dicatat: backend pertama READY tetapi belum menjalankan gate, sehingga tidak dipakai; percobaan kedua gagal 2 dari 2.504 tes pada oracle proses Linux. Frontend pertama gagal 1 dari 476 tes karena Vercel membuat ulang root `vercel.json`. Tiga pemeriksaan berkas konfigurasi repository kemudian dipindahkan ke suite root yang memakai lokasi modul; tes factory konfigurasi tetap berjalan di frontend. Tidak ada tes dilewati atau pengecualian untuk menutupi kegagalan. Hasil kandidat pengganti pada tabel di atas semuanya lulus.

## Smoke HTTP dan pemindaian native

Lima fase dijalankan pada 12 September 2026 pukul 21:07–21:13 WIB. Jumlah berikut mencakup pemeriksaan berulang seperti health dan login; **109 assertion bukan 109 skenario unik**.

| Fase | Hasil | Bukti utama |
| --- | --- | --- |
| Access | 22/22 lulus | Shell, deep link, service worker, header keamanan, health/readiness langsung dan proxy, capabilities, penolakan anonim, login serta pembatalan sesi. |
| Upload | 18/18 lulus | Satu unggahan multipart PDF privat **10.000.000 byte** menggunakan SDK Blob resmi. |
| Register | 20/20 lulus | Pencatatan Surat Masuk HTTP 201, nomor `002/SM/2026`, hasil pencarian unik. |
| Poll | 22/22 lulus | Status berubah `scanning` → `clean`; integritas, ukuran, dan status privat sesuai. |
| Download | 27/27 lulus | Endpoint inline dan attachment masing-masing HTTP 200, byte dan SHA-256 identik; akses berkas anonim 401 dan Blob privat anonim 403; sesi lama ditolak setelah logout. |

PDF sintetis memakai SHA-256 `41a4ba02879617ce26a7d8f555e539f2ebfa131645aa860297151595e9389cb0`. Satu surat uji berpenanda `SIMSA-CANDIDATE-20260912T140724943Z-5100bf7b0085`, ID `add36799-aede-4b3a-a5d9-aa5382cff259`, beserta PDF dan audit trail dipertahankan agar hasil dapat diperiksa. Tidak ada penghapusan atau perubahan data surat pengguna. Laporan fase tersanitasi tersimpan di `output/candidate-verification/http-smoke/`; credential dan locator Blob privat tidak dicantumkan.

ClamAV native **1.5.4** dikemas dengan tanda tangan rilis/database yang diverifikasi (main 63, daily 28121, bytecode 339). Bukti build hanya membuktikan pengemasan, bukan keberhasilan scan runtime. Bukti runtime terpisah menunjukkan kandidat backend final menerima `POST /api/internal-malware-scan` pukul **21:12:14 WIB**, HTTP 200, tanpa crash. Durasi fungsi 41,618 detik, Node.js 24, wilayah iad1, pemakaian memori maksimum yang dilaporkan 1.299 dari 2.048 MB. Kode mensyaratkan bukti engine native yang valid sebelum respons sukses.

**Batas atribusi scan:** callback penyelesaian Blob memakai override yang masih menunjuk backend canonical lama, untuk mencatat unggahan selesai. Setelah surat dibuat, kandidat menjadwalkan worker pada deployment immutable-nya. Log membuktikan invocation worker kandidat sukses pada jendela smoke, tetapi tidak menyertakan ID lampiran/hash; hubungan dengan PDF sintetis didukung waktu dan perubahan status berkas, bukan log per berkas. Database/antrean tetap digunakan bersama. Bukti: `worker-invocation-verification.json`.

## Pemeriksaan browser

| Alur | Hasil observasi pada alias kandidat |
| --- | --- |
| Login dan sesi | Login password berhasil, dashboard terbuka, sesi bertahan setelah reload; logout kembali ke halaman login. |
| Daftar dan pencarian | Surat sintetis tampil sekali; pencarian yang tidak cocok menampilkan empty state; filter unit menampilkan kontrol impor yang sesuai. |
| Balas Surat | Nomor referensi, perihal balasan, dan penerima terisi; setelah referensi dilepas, pencarian server menemukan kembali surat uji. ArrowDown dan Enter memilih hasil. Draf dibatalkan tanpa membuat surat keluar. |
| Edit | Data surat terisi sesuai. Pembatalan perubahan memunculkan konfirmasi; menolak meninggalkan halaman mempertahankan draf. Setelah draf dibuang, perihal asli tetap tampil pada daftar. Tidak ada update disimpan. |
| Google Sheets | Dialog terbuka untuk unit konkret; tombol mengambil lembar nonaktif ketika URL kosong; dialog dapat ditutup. Tidak menjalankan impor sumber nyata. |
| Layar ponsel | Viewport 360 × 800, lebar konten 345 px setelah scrollbar dan tanpa overflow horizontal halaman; menu navigasi dapat dibuka/ditutup. |
| Konsol | Tidak ada entri error yang dikembalikan pada pemeriksaan setelah rangkaian alur. Ini bukan bukti semua rute bebas error. |
| PDF inline | Fetch berhasil dan iframe dipasang, tetapi area pratinjau terlihat kosong. **BELUM TERVERIFIKASI secara visual.** |

Alat BrowserUse menolak navigasi melalui tautan Blob “Buka di Tab Baru” berdasarkan kebijakan keamanan alat. Pembatasan tidak dilewati. Source dan pemeriksaan HTTP belum menunjukkan penyebab pasti area kosong; tidak ada pelonggaran CSP atau pergantian viewer tanpa bukti. Pengujian komponen/jsdom membuktikan pengambilan berkas dan iframe, bukan rendering PDF asli. Pemeriksaan manual visual PDF pada browser pengguna masih diperlukan sebelum menyatakan gate ini lulus.

## Keputusan promosi dan batas validasi

**Belum dipromosikan.** Domain `simsa-backend.vercel.app` tetap mengarah ke `dpl_CWnJz48FByoFLTcQtf62bZTTkX6n`; `simsa-frontend.vercel.app` tetap ke `dpl_Aqd25jwGpT7N3c4tJP1yzEpG4J5s`. Alias kandidat terpisah mengarah ke deployment frontend final. Bukti pemeriksaan penutup: `output/candidate-verification/aliases-after.json`. Tidak ada commit atau push pada tahap ini.

Pemeriksaan yang belum dibuktikan harus tetap dibaca terpisah dari gate yang lulus:

- Visual PDF inline masih perlu verifikasi manual; penyebab area kosong belum dipastikan.
- Data live hanya dua surat masuk setelah smoke. Kasus lebih dari 100 surat, perpindahan halaman setelah penghapusan, pemulihan capabilities, dan race impor dibuktikan oleh fixture/tes native, bukan simulasi massal pada data produksi.
- Callback Google OAuth pada domain canonical, seluruh kombinasi peran/unit, dan impor Google Sheets nyata belum diuji end-to-end pada kandidat. Smoke live menggunakan akun Super Admin yang tersedia serta permintaan anonim.
- Pembaruan service worker dari cache aplikasi produksi lama dan smoke domain canonical perlu dilakukan pada tahap promosi; pengujian sekarang memakai origin kandidat.
- Backup terenkripsi yang ada belum mempunyai bukti restore aktual dan salinan offsite; backup database juga tidak mencakup byte PDF privat. Tindak lanjut operasional tetap mengikuti [backup Neon](BACKUP_NEON.md) dan [review prarilis](REVIEW_PRARILIS_2026-09-12.md).

Perbaikan tujuh temuan serta pengujian kandidat telah menghasilkan bukti yang dapat direview. Kelulusan tersebut tidak menghapus pemeriksaan visual dan operasional yang masih terbuka di atas.
