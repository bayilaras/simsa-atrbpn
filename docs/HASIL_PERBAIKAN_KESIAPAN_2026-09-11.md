# Hasil perbaikan kesiapan SIMSA

Tanggal: 11 September 2026. Branch: `fix/user-readiness`. Implementasi yang diuji sampai commit `18680a6`; perubahan sesudahnya pada laporan ini adalah dokumentasi hasil. Lingkup: aplikasi lengkap `backend/` dan `frontend/`, sebagai tindak lanjut [asesmen awal](ASESMEN_ANRI_SRIKANDI_2026-09-11.md).

**Perbaikan kode atas rekomendasi asesmen selesai dan pengujian lokal lulus. Aplikasi dapat dilanjutkan ke uji penerimaan pengguna dengan data uji.** Penggunaan arsip resmi tetap memerlukan layanan produksi, pengesahan instrumen dan kewenangan instansi, serta penerimaan petugas. Hasil ini bukan pengesahan ANRI atau bukti integrasi resmi SRIKANDI.

## Perbaikan yang tersedia

| Area | Perilaku sekarang |
|---|---|
| Login lokal | Akun uji berhasil masuk dan keluar melalui `localhost:3000` maupun `127.0.0.1:3000`; asal permintaan tetap diperiksa terhadap konfigurasi yang diizinkan. |
| Pemindahan dan retensi | Pemindahan selesai menyimpan riwayat inaktif tanpa memutus kemungkinan penyusutan berikutnya. Pemindahan ulang ditolak; data lama memiliki alur pemulihan beralasan dengan pemeriksa berbeda. |
| Pemusnahan | Finalisasi memerlukan BA final, keputusan, bukti pelaksanaan, sedikitnya dua saksi berbeda beserta bukti kewenangan, dan audit. Byte bukti dibaca ulang; kewenangan dan masa berlaku akses diperiksa dalam transaksi. |
| Arsip terjaga | Draf, pengiriman, penerimaan dan verifikasi bukti dipisahkan. Nomor/tanggal tidak menetapkan kepatuhan. Pemeriksa independen wajib; klaim lama dipertahankan sebagai riwayat yang perlu ditinjau. Pilihan kategori baru mengikuti instrumen ATR/BPN yang dirujuk asesmen. |
| Impor CSV | Tanggal kosong/tidak sah ditolak tanpa diganti tanggal hari ini. Pratinjau tidak menyimpan data, perubahan berkas membatalkan pratinjau, dan impor ulang diperiksa untuk duplikasi. Nomor surat keluar `-` diperlakukan sebagai belum bernomor. Isi dialog tidak meluber pada layar ponsel. |
| Ekspor | Filter diteruskan ke ekspor. Permintaan di atas 10.000 baris ditolak dengan penjelasan, bukan menghasilkan file terpotong. Perubahan jumlah data ketika mengekspor juga ditolak. |
| Preservasi | Pemeriksaan integritas membaca byte; pencatatan kegiatan eksternal memerlukan sumber, hasil, bukti, alat/versi dan waktu. Catatan lama diberi status belum diverifikasi. Bukti dan catatan final dilindungi dari pengubahan/penghapusan. |
| Integritas berkala | Worker terjadwal memeriksa hash **dan ukuran** dengan batas jumlah, ukuran dan waktu. Hasil lama tidak menimpa baseline baru; mismatch dikarantina. Status dan audit disimpan bersama; antrean memiliki lease dan jeda pengulangan. |
| Instrumen dan deployment | Bootstrap instrumen otomatis dibatasi untuk lingkungan lokal pengembangan/pengujian. Jalur produksi memeriksa bukti instrumen yang disahkan serta pemisahan pelaku; tidak mengesahkan instrumen melalui seed. |
| Ketahanan dan pemeliharaan | Pemeriksaan skema/grant mencakup seluruh migrasi baru dan trigger bukti. Dependensi yang bermasalah diperbarui. File service worker hasil pengembangan dikeluarkan dari indeks Git dan diabaikan agar pemeriksaan sumber bersih dapat berjalan. |

Perbaikan tambahan dari review independen mencakup perubahan peran/unit saat permintaan berjalan, akses yang kedaluwarsa selama pembacaan berkas, penyimpanan karantina saat bukti tidak cocok, pembatalan saat audit gagal, hash bukti JSONB kanonis, dan tanggal proses sesuai kalender Asia/Jakarta.

## Hasil verifikasi

| Pemeriksaan | Hasil |
|---|---|
| Backend lengkap | **1.860 tes lulus**, 144 berkas, Vitest 4.1.11 dengan dua worker. |
| Frontend lengkap | **255 tes lulus**, 47 berkas, Vitest 4.1.11 dengan dua worker. |
| Skrip/kontrak repository | **109 tes lulus**, meliputi manifest migrasi, hosting, launcher, image dan backup drill. |
| Build dan pemeriksaan statis | TypeScript dan build backend lulus; lint dan build frontend lulus. |
| Audit dependensi | `npm audit` backend dan frontend melaporkan **0 kerentanan** pada dependensi yang diperiksa. Ini bukan hasil pentest. |
| API aplikasi lokal | **32 langkah lulus**: login dua akun, pemisahan pemohon/pemberi akses, arsip terbatas, pembaruan metadata, penolakan payload, pencarian, serta bukti audit pada PostgreSQL. |
| API pelaporan terjaga lokal | **15 langkah lulus**: penetapan dan draf tersimpan; injeksi klaim patuh, pengiriman tanpa bukti, bukti tidak ada, dan verifikasi prematur ditolak tanpa memajukan draf. |
| Browser nyata | **11 langkah per origin lulus** di Edge melalui Playwright: login, CSV tidak valid/valid, bukti pratinjau tidak menambah data, duplikasi, ekspor Excel berfilter, pembukaan halaman, logout dan ketiadaan uncaught error. Layar laptop 1365×671 dan ponsel 390×844 diperiksa. |
| Migrasi database lokal | Cadangan sebelum perubahan dibuat; empat migrasi baru diterapkan. Rantai **38 migrasi (0000–0037)** terverifikasi; pengulangan tidak menerapkan migrasi lagi. Konvergensi grant dan endpoint readiness lulus. |
| Pemulihan database sintetis | **13 tahap lulus** pada dua cluster PostgreSQL 18 yang terpisah. Backup AES-256-GCM dipulihkan setelah sumber dihentikan; data/izin dicocokkan. Kunci salah, tag rusak dan hash tidak cocok ditolak. Kedua cluster drill dihentikan setelah selesai. |

Log dan hasil terperinci lokal tersedia di `output/` dan `output/local-runtime/` (diabaikan Git), termasuk `backend-release-clean-full.log`, `frontend-release-clean-full.log`, `archive-acceptance-summary.json`, `terjaga-live-smoke-evidence.json`, serta `browser-readiness-127.0.0.1.json` dan `browser-readiness-localhost.json`. Data yang dibuat untuk pengujian diberi penanda sintetis; kredensial tidak dimasukkan ke laporan atau commit.

Bukti restore drill: `D:\SIMSA-Local-Drills\simsa-local-drill-RItH4r\result.json`, terikat pada commit `18680a6`, dengan sumber bersih terverifikasi ulang. Simulasi ini memakai database sintetis dan bukan pengujian pemulihan bucket dokumen, Cloud SQL, atau layanan produksi. Backup sebelum migrasi database aplikasi berada di `output/local-runtime/schema-backup-20260911-094856/`.

## Kebutuhan sebelum operasional resmi

1. **Lingkungan tujuan:** tentukan server/domain/HTTPS, penyimpanan privat, antivirus dan worker, jadwal pemeriksaan integritas, pemantauan, serta petugas penanganan kegagalan. Profil lokal saat ini belum mempunyai layanan storage/scanner produksi; kelulusan `/ready` lokal tidak membuktikan layanan tersebut tersedia.
2. **Pemulihan menyeluruh:** tetapkan backup database **bersama byte dokumen**, inventaris generation/hash/ukuran, retensi salinan dan sasaran waktu pemulihan. Buktikan restore dan unduh berizin pada lingkungan tujuan.
3. **Pengesahan proses:** Unit Kearsipan/arsiparis memeriksa dan mengesahkan instrumen, JRA, klasifikasi, tata naskah, mandat pejabat/saksi, hak akses dan SOP. Tinjau data lama yang ditandai belum diverifikasi; jangan mengesahkannya secara massal hanya untuk membuka workflow.
4. **SRIKANDI/TTE:** penggunaan dan integrasi resmi mengikuti keputusan instansi, kontrak/akses layanan, sandbox dan bukti penerimaan. Konektor tidak diaktifkan tanpa konfigurasi tersebut; verifikasi bukti internal SIMSA bukan verifikasi oleh ANRI.
5. **UAT:** jalankan [uji penerimaan pengguna](UAT_PENGGUNA.md) dengan petugas yang ditunjuk. Rekam hasil pada server tujuan sebelum memasukkan arsip resmi.

Pencatatan pelaksanaan pemusnahan tidak menghapus otomatis objek storage, replika atau backup. Penanganan salinan tetap bagian dari pelaksanaan dan bukti petugas. Uji integritas/bukti otomatis memakai storage tiruan; ketersediaan storage dan scanner sungguhan masih memerlukan pengujian lingkungan tujuan.

Panduan: [akun](administrasi/user-management.md), [penyusutan](PENYUSUTAN_TERKENDALI.md), [pelaporan terjaga](PELAPORAN_TERJAGA_BERBUKTI.md), [integritas berkala](OPERASI_PEMERIKSAAN_INTEGRITAS.md), dan [rencana pekerjaan](PLAN_PERBAIKAN_KESIAPAN.md).
