# Optimasi aplikasi — 13 September 2026

> Catatan 26 September 2026: yang digabung ke repositori hanya optimasi statistik surat, toast, refresh dashboard, polling notifikasi, dan pembersihan log. Pemuatan dinamis tata letak (`App.jsx`, `AppLayout`, `PageLoader`, `RouteFocusManager`, `vite.config.js`) belum di-QA dan tetap disimpan terpisah; bagian ukuran JavaScript awal di bawah tidak berlaku untuk kode yang digabung.

Perubahan dilakukan pada kode lokal, tanpa commit, push, migrasi database, atau deployment. Perbaikan klasifikasi/JRA dan pekerjaan yang sudah ada di working tree dipertahankan.

## Perubahan dan pengukuran

| Bagian | Sebelum | Sesudah | Metode |
| --- | ---: | ---: | --- |
| JavaScript awal | 625.548 byte | 441.143 byte | Graf import ESM statis dari entry build produksi; turun 29,5% |
| JavaScript awal, gzip | 196.941 byte | 142.329 byte | Kompresi lokal setiap berkas pada graf yang sama; turun 27,7% |
| Kueri statistik surat masuk | 4/request | 1/request | Delapan kasus SQL nyata pada PGlite; turun 75% |
| Refresh dashboard dari pasangan event focus/visible | 10 panggilan endpoint | 5 panggilan endpoint | Reproduksi komponen dengan satu request masih berjalan |
| Timer pada burst 100 toast | 100 | 3 | Fake timer; sesuai maksimal tiga toast yang terlihat |
| Polling otomatis selama satu jam tab tersembunyi | 60 request tambahan | 0 request tambahan | Fake timer setelah initial fetch; durasi nyata mengikuti kebijakan timer browser |

Sidebar, header, pencarian, dan tata letak pengguna terautentikasi dimuat secara dinamis setelah autentikasi serta provisioning lolos. Pemisahan chunk Radix yang memaksa seluruh menu/dialog dimuat pada login dihapus. Tampilan, pembatasan peran, halaman panduan publik, dan fallback pemuatan tetap dipertahankan. Boundary di luar modul dinamis menyediakan pemulihan dengan reload penuh bila chunk gagal diunduh; reset state saja tidak cukup untuk mengulang promise React.lazy yang sudah ditolak.

Refresh dashboard hanya berbagi request yang masih berjalan untuk pengguna, unit, dan generasi yang sama. Refresh setelah request selesai tetap mengambil data terbaru. Respons dari unit/pengguna sebelumnya tidak boleh mengganti tampilan atau menghapus penanda request yang baru.

Interval notifikasi dihentikan saat halaman tersembunyi atau perangkat offline. Saat kembali tersedia, data diperbarui dan interval dipasang kembali. Request otomatis yang masih berjalan digabungkan; refresh manual dan sinkronisasi setelah menandai notifikasi dibaca tetap bisa mengambil data terbaru. Initial fetch, preferensi pengguna, pembersihan saat unmount, serta perlindungan pergantian unit tetap dipertahankan.

Statistik surat masuk memakai satu agregasi kondisional. Filter unit kerja, tahun, klasifikasi keamanan, serta arsip yang dihapus tetap diterapkan bersama pada seluruh penghitung. Tidak ada cache baru untuk data surat atau keputusan akses.

Enam lokasi logging frontend yang sudah tidak diperlukan dibuang: dua callback keberhasilan service worker dan empat fallback logging toast. Sepuluh lokasi debug backend untuk hasil statistik, langkah edit surat, dan pemuatan modul dibuang. Log error, audit, telemetry HTTP, serta diagnostik pengembangan yang memang dibatasi ke mode pengembangan tetap tersedia. Log keberhasilan unggahan mempertahankan MIME/ukuran tanpa nama dokumen atau lokasi objek privat.

## Batas pengukuran dan keputusan

Ukuran awal menghitung import JavaScript statis transitif, bukan seluruh trafik instalasi PWA. Precache offline, font lokal, serta aturan NetworkOnly untuk API/autentikasi tetap dipertahankan. Pemisahan chunk meningkatkan total JavaScript seluruh fitur dari 2.652.266 menjadi 2.668.246 byte pada build akhir (+0,60%), tetapi mengurangi JavaScript yang harus dievaluasi pada pembukaan awal. Tidak ada klaim peningkatan Core Web Vitals atau latensi produksi tanpa pengukuran browser produksi.

Alternatif mengurangi subset font atau menghapus precache semua halaman tidak diterapkan karena dapat mengurangi dukungan karakter dan kemampuan offline. Audit juga menemukan evaluasi bukti arsip yang berulang di beberapa endpoint dashboard; penggabungan evaluator lintas endpoint ditunda karena memerlukan desain agregasi yang mempertahankan verifikasi bukti serta otorisasi. Pengurangan request ganda sudah mengurangi frekuensi pekerjaan ini.

Pengukuran sebelum/sesudah dan skrip lokal tersedia di `output/performance-20260913/` (diabaikan Git). Verifikasi UI browser otomatis dicoba, tetapi adapter browser gagal memasang webview; preview lokal juga tidak memiliki backend aktif pada port 3001. Karena itu hasil validasi UI didasarkan pada pengujian komponen, bukan klaim pengujian browser end-to-end.

## Validasi

- Alur pemuatan aplikasi, provisioning, serta pemulihan kegagalan chunk: 14 tes lulus.
- Manifest build dan batas navigasi service worker: 37 tes lulus.
- Toast: 4 tes lulus, termasuk durasi normal/error/persisten, batas timer, dan dismiss idempoten.
- Dashboard: 12 tes lulus, termasuk pembaruan data terbaru dan isolasi pengguna/unit.
- Notifikasi: 12 tes lulus untuk perilaku sebelumnya dan polling baru.
- Backend: 137 tes terarah pada delapan berkas lulus untuk statistik incoming/outgoing, service surat, keamanan unggahan, katalog, privasi logger, dan telemetry HTTP. Fixture PGlite outgoing semula timeout saat inisialisasi; budget startup disesuaikan dari 20 ke 60 detik dan lima assertion SQL yang sama lulus. Tidak ada pelonggaran assertion hasil atau jumlah kueri.
- Total 216 tes terarah lulus. ESLint seluruh berkas frontend yang diubah/ditambahkan untuk optimasi lulus. `tsc --noEmit` dan build backend lulus. `git diff --check` lulus dengan konfigurasi line ending repository.
- Build akhir frontend lulus: 4.111 modul ditransformasi, service worker berhasil dibuat dengan 127 entri precache. Pengukuran tabel memakai build akhir, termasuk boundary pemulihan unduhan yang gagal. Log pengemasan tersimpan di `output/performance-20260913/frontend-build.log`.
