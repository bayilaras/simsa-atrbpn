# Pemeriksaan kesiapan pengguna — 11 September 2026

Target kerja: versi lengkap SIMSA untuk persiapan uji coba internal, berdasarkan
kode awal `c6b660a`. Pilihan cakupan pengguna dan infrastruktur masih menunggu
penetapan pemilik aplikasi. Dokumen ini tidak menyatakan deployment production
sudah dilakukan atau seluruh alur operasional telah disetujui.

## Perbaikan perilaku

- Pembaruan metadata arsip memakai nama kolom yang benar dan mempertahankan
  klasifikasi keamanan ketika kolom itu tidak dikirim. Perubahan JRA/retensi
  tetap melalui workflow terkait, bukan pembaruan metadata biasa.
- Penyuntingan surat masuk, arsip vital, dan arsip terjaga tidak lagi mereset
  status yang tidak dikirim ke nilai bawaan pembuatan.
- Draf lokal dibersihkan ketika sesi berakhir, termasuk logout yang gagal atau
  masih menunggu respons. Antrean autosave tidak boleh memulihkan draf sesi lama.
- Draf pembuatan surat dipisahkan dari draf penyuntingan surat yang sudah ada.
- Perbarui pada daftar arsip memuat data baru meskipun masih di halaman pertama.
- Kegagalan pemuatan daftar tampil sebagai pesan kesalahan dengan tombol coba
  lagi. Respons statistik lama tidak menimpa statistik dari permintaan terbaru.
- Berkas grant SQL dan script database dipertahankan dengan akhir baris LF
  agar checkout Windows menjalankan pengujian migrasi yang sama dengan Linux.

**Kontrak API edit arsip:** gunakan `keterangan` dan `uraianBerkas`. Payload
legacy `catatan`/`deskripsi`, kolom tak dikenal, dan payload kosong kini ditolak
dengan 400; sebelumnya kolom legacy dapat diterima tanpa menyimpan perubahan
yang dimaksud. Field sumber surat, unit pemilik, dan status sistem tetap dibatasi.

Penyebab reset default dikonfirmasi terhadap perilaku
[default pada optional field Zod 4](https://zod.dev/v4/changelog#defaults-applied-within-optional-fields).
Tidak ada perubahan versi Zod atau pelonggaran hak akses dalam perbaikan ini.

## Dependensi

Pembaruan dipisahkan dan diuji menggunakan Node 24:

| Paket | Sebelum | Sesudah | Dasar |
| --- | --- | --- | --- |
| multer | 2.2.0 | 2.3.0 | [Rilis perbaikan multipart](https://github.com/expressjs/multer/releases/tag/v2.3.0) |
| nodemailer | 9.0.5 | 9.1.1 | [Rilis perbaikan mailer](https://github.com/nodemailer/nodemailer/releases/tag/v9.1.1) |
| js-yaml (transitif) | 4.3.1 | 4.3.2 | [Rilis parser](https://github.com/nodeca/js-yaml/releases/tag/4.3.2) |
| qs (transitif) | 6.15.3 | 6.16.0 | [Changelog parser](https://github.com/ljharb/qs/blob/main/CHANGELOG.md) |

Audit backend sesudah pembaruan: **0 high/critical**, 3 moderate (`csv-parse`,
`vitest`, `@vitest/mocker`). Ketiganya membutuhkan evaluasi upgrade mayor;
Vitest digunakan untuk pengujian, sedangkan jalur impor CSV perlu ditinjau
sebelum diaktifkan untuk pengguna. Audit dependency frontend yang dijalankan
pada tahap awal menghasilkan 0 temuan. Audit ini tidak menggantikan pengujian
keamanan aplikasi dan perlu diulang pada kandidat rilis.

## Verifikasi lokal

Lingkungan: Windows, Node **24.21.0**, PostgreSQL **18.1** pada cluster baru
yang hanya mendengarkan loopback. Tidak memakai data atau kredensial production.

| Pemeriksaan | Hasil |
| --- | --- |
| Seluruh tes backend | 126 berkas, **1.622 tes lulus**. |
| Seluruh tes frontend | 43 berkas, **235 tes lulus**, maksimal 2 worker. |
| Tes root launcher/hosting/manifest/backup helpers | **109 tes lulus**; 63 di antaranya juga termasuk suite backend/frontend. |
| TypeScript backend | `tsc --noEmit` lulus. |
| ESLint frontend | `npm run lint` lulus. |
| Build backend dan frontend | Keduanya lulus. |
| Database | Bootstrap/grant convergence berhasil; 34 migrasi terverifikasi, ulang 0 applied. |
| Seed ulang | Isi tabel tetap sama; sequence mapping dapat bertambah akibat upsert, tanpa duplikasi baris. |
| Probe API | `/health` dan `/ready` HTTP 200 dalam profil development; storage tetap dilaporkan belum dikonfigurasi. |
| Browser | Login, tambah surat, pencarian nomor, edit perihal, muat daftar arsip, dan Perbarui halaman pertama berhasil. Permintaan baru daftar/statistik arsip HTTP 200, tanpa console error pada alur final. |
| HTTP + PostgreSQL nyata | **32 langkah lulus**: surat → arsip Terbatas → persetujuan akses oleh akun berbeda → pembaruan metadata → pencarian → audit → logout. |

Acceptance HTTP mempertahankan **14 field** keamanan/JRA/retensi setelah edit.
SELECT database membuktikan metadata baru, snapshot aturan terverifikasi, dan
audit pembaruan tersimpan. Akses sebelum grant ditolak (404), persetujuan
sendiri ditolak (403), dan payload kosong/legacy/legal hold/retensi langsung
ditolak (400). Akun checker dibuat melalui administrasi pengguna normal.
Surat browser menggunakan tautan sintetis pada `example.test`; ini hanya
menguji metadata, bukan ketersediaan atau preservasi berkas.

Tes frontend mencakup logout tertunda/gagal, antrean draf dari sesi atau kunci
formulir lama, retry setelah error, dan respons statistik yang datang terlambat.
Temuan review independen pada antrean draf dan respons statistik telah ditutup.
Kegagalan awal dua suite backend Windows akibat CRLF sudah direproduksi dan
diperbaiki melalui `.gitattributes`; tidak ada assertion/test yang dilemahkan.

Evidence mesin ada dalam `output/backend-tests-final.log`,
`output/frontend-tests-final.log`, `output/root-tests.log`,
`output/local-runtime/verification.json`, dan
`output/local-runtime/archive-acceptance-evidence.json`. Direktori `output/`
diabaikan Git; kredensial uji tidak disertakan dalam repositori.

## Kriteria sebelum dipakai pengguna

| Kriteria | Bukti yang diperlukan |
| --- | --- |
| Cakupan pilot | Unit kerja, jumlah pengguna, admin dan petugas verifikasi yang ditetapkan. |
| Akun dan akses | Login/logout, pencabutan akun, pembatasan lintas unit, dan persetujuan oleh pengguna berbeda pada target. |
| Penyimpanan berkas | Unggah → karantina → pemeriksaan antivirus → berkas final → unduh berizin, termasuk penolakan file bermasalah. |
| Keandalan data | Backup metadata serta berkas, pemulihan ke lingkungan terpisah, dan pembandingan hasil. |
| Lingkungan rilis | Domain HTTPS, konfigurasi sesi/proxy, pemantauan, dan prosedur rollback yang sudah diuji. |
| Penerimaan pengguna | Petugas menjalankan pencatatan surat, pengarsipan, pencarian, koreksi metadata, peminjaman/pengembalian, dan ekspor sesuai cakupan. |

Gunakan runbook deployment yang dirujuk README setelah lingkungan tujuan
ditetapkan. Database lokal sintetis bukan salinan database pengguna dan tidak
menjadi bukti bahwa storage, antivirus, email, Google login, atau backup cloud
telah berfungsi.
