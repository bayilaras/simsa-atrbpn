# Hasil penguatan backend SIMSA — 11 September 2026

Arahan backend diterapkan pada SIMSA internal dengan Express/PostgreSQL yang
sudah ada. Build terbaru berjalan di `http://127.0.0.1:3000`; login akun uji juga
berhasil melalui `http://localhost:3000`. Kesiapan lokal tetap mencakup metadata,
surat, pencarian, dan arsip fisik. Penyimpanan digital dan antivirus belum
dikonfigurasi, sehingga unggahan/OCR belum diaktifkan untuk pengguna lokal.

## Perubahan yang diterapkan

| Area | Perubahan dan hasil yang dilindungi |
| --- | --- |
| Hak akses | Pembuatan surat keluar memeriksa klasifikasi keamanan di server. Perubahan arsip dari HTTP memeriksa ulang pengguna aktif, izin modul, akses rekod, mandat, dan keadaan arsip di dalam transaksi sebelum menyimpan dan mencatat audit. |
| Input pencarian | Parameter pencarian, saran, kata kunci, halaman, limit, tahun, dan ID terkait mempunyai tipe serta batas panjang/jumlah yang diperiksa server. |
| Pelacakan gangguan | Setiap permintaan mendapat `X-Request-ID` dari server. JSON rusak menghasilkan 400, body terlalu besar 413, dan error global tidak mengirim exception mentah atau stack. |
| Log | Log penyelesaian permintaan memakai kelompok API tetap tanpa body, cookie, atau query. Error Pino terstruktur hanya mempertahankan jenis/kode yang dikenali; pesan, stack, cause, dan detail provider tidak disalin otomatis. |
| Metrik | `/api/operations/metrics` hanya tersedia bagi Super Admin, tanpa cache. Tersedia jumlah permintaan, koneksi terputus, kelompok status, histogram waktu respons, memori proses, serta kondisi pool database. |
| Unggahan terputus | Intent batch dicatat sebelum provider menerima berkas. Nama objek dicadangkan tanpa penimpaan; cleanup batch kedaluwarsa dapat menemukan objek dengan respons yang hilang, memeriksa referensi, dan menghapus generation yang tepat. |
| Promosi GCS | Salinan ke bucket akhir dijalankan di child dengan deadline. Hasil yang belum pasti mempertahankan klaim untuk pengulangan deterministik; penghentian child tidak dianggap membatalkan salinan jarak jauh. |
| OCR | Ekstraksi PDF/render/Tesseract dipindahkan ke child dengan input dan hasil terbatas. Parent memegang lease global sampai child tertutup. Watchdog pada thread terpisah menghentikan child ketika parent mati atau deadline tercapai, termasuk saat thread OCR sibuk. |
| Pemulihan | Tersedia backup terenkripsi database aktif, verifikasi artefak dalam proses baru, restore ke cluster baru, pemeriksaan fingerprint/grant, serta status backup melalui `Cek-SIMSA.cmd`. |

## Bukti runtime

- Login akun uji lulus; akses metrik tanpa sesi ditolak 401, Super Admin mendapat
  200 dengan `Cache-Control: no-store`.
- JSON rusak menghasilkan 400, dengan nomor penelusuran yang sama pada header
  dan respons. Teks canary sensitif tidak muncul pada respons maupun log runtime.
- Dashboard, surat masuk, surat keluar, dan arsip mengembalikan data sukses.
- Browser Edge menguji kedua origin lokal: login, pencarian dengan keyboard,
  kegagalan/retry daftar dan statistik, perlindungan formulir yang belum disimpan,
  serta menu/notifikasi pada lebar 320 px lulus.
- Child OCR hasil kompilasi berhasil mengekstrak PDF sintetis dengan lapisan teks.
  Tes proses nyata juga membuktikan timer/HTTP parent tetap responsif saat child
  sibuk, penghentian saat pembatalan/deadline, dan penghentian setelah parent mati.

## Pengukuran API lokal

Pengamatan pada **14:08 WIB**, setelah build dimulai ulang: satu pemanasan per
endpoint, delapan permintaan terukur per endpoint, dua permintaan bersamaan.
Waktu mencakup penerimaan dan pembacaan JSON oleh klien lokal.

| Endpoint | Median (ms) | p95 / maksimum (ms) |
| --- | ---: | ---: |
| Dashboard | 31,30 | 48,58 |
| Surat masuk | 18,79 | 19,03 |
| Surat keluar | 13,11 | 14,26 |
| Arsip | 24,21 | 24,57 |

Dengan delapan sampel, p95 bertepatan dengan maksimum. Ini pengamatan kecil pada
database lokal, bukan uji kapasitas atau jaminan performa produksi. Pool pada
akhir pengamatan mempunyai 10 koneksi menganggur dan 0 permintaan menunggu.
Pengukuran beban pengguna nyata, OCR gambar, dan object storage masih diperlukan
pada lingkungan tujuan.

## Backup dan restore nyata

Snapshot sumber diambil pada **13:45:59 WIB**, tanpa mengubah database aktif.
Backup memakai principal read-only yang sudah tersedia, dengan satu snapshot
untuk dump dan bukti fingerprint. Arsip custom **560.312 byte** menghasilkan
ciphertext **560.352 byte**; durasi backup **32,121 detik**.

Proses Node baru mengautentikasi bundle/kunci sebelum membuat cluster verifikasi.
Restore berlangsung **31,626 detik** pada port **59225**, dengan system identifier
berbeda dari sumber **55432**. Seluruh **138 baris bukti** cocok. Query role API
lulus tanpa hak superuser/CREATE schema. Cluster verifikasi dihentikan setelah
pemeriksaan; database sumber tetap berjalan.

Backup hanya mencakup database, termasuk data akun/sesi yang sensitif. Objek
storage eksternal dan rahasia konfigurasi tidak tercakup. Bundle dan kunci
disimpan terpisah dengan ACL privat pada komputer ini. Salinan di media lain,
retensi, frekuensi backup, RPO/RTO, dan uji pemulihan layanan penuh belum ditetapkan
oleh pekerjaan ini. Ikuti [prosedur backup lokal](BACKUP_LOKAL.md).

## Verifikasi kode

Seluruh **2.006 tes backend dalam 160 berkas lulus** pada pengujian serial.
Pemeriksaan tipe TypeScript, build backend, dan 16 tes backup/status juga lulus.
Pemeriksaan dependency backend/frontend terhadap advisory npm melaporkan **0
kerentanan yang diketahui** pada lockfile saat diperiksa. Ini tidak menyatakan
aplikasi bebas dari semua celah keamanan.

Pengujian backend gabungan pertama menyelesaikan 1.979 tes, dengan 20 tes belum
berjalan karena inisialisasi PGlite melewati hook 10 detik. Pengulangan seluruh
suite, termasuk tujuh tes pengawas child yang ditambahkan kemudian, lulus secara
serial dalam 694,68 detik. Tidak ada batas waktu yang dinaikkan, assertion yang
dihapus, atau tes yang dilewati untuk mendapatkan hasil ini.

Bukti lokal disimpan di `output/backend-final-serial-suite.log`,
`output/backend-final-typecheck.log`, `output/backend-build-final.log`,
`output/backend-runtime-check.json`, `output/backend-browser-check.log`, dan
`output/backend-compiled-child-check.json`. Output, kredensial, bundle, serta kunci
tidak dilacak Git.

## Batas operasional

Kontrak bulk OCR masih memproses satu item melalui POST yang menunggu hasil dan
mengembalikan HTTP 200; GET hanya membaca status. Pemisahan CPU sudah diterapkan,
tetapi belum ada daemon OCR dengan kontrak enqueue HTTP 202. Lingkungan yang
memerlukan pekerjaan berlanjut setelah request berakhir perlu alur tersebut.

Metrik berlaku per proses sejak startup, tanpa agregasi lintas instance atau
alarm otomatis. Isolasi environment child bukan sandbox OS. GCS/ClamAV nyata
belum diuji di workstation ini, karena fasilitas berkas belum dikonfigurasi.
Pengaktifan SRIKANDI dan pengesahan instrumen instansi tidak dilakukan atau
dinyatakan selesai oleh perubahan teknis ini.

Panduan: [operasional backend](OPERASIONAL_BACKEND.md),
[antivirus bitstream](OPERASI_ANTIVIRUS_BITSTREAM.md), dan
[operasional lokal](OPERASIONAL_LOKAL_2026-09-11.md).
