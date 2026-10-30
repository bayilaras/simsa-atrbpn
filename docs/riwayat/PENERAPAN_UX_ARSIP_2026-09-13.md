# Penerapan rekomendasi UX arsip — 13 September 2026

Penerapan awal berfokus pada halaman Manajemen Arsip. SIMSA sudah memiliki modul
retensi, izin per dokumen, OCR, peminjaman, dosir, versi dokumen elektronik,
dan backup. Perubahan ini memperbaiki penelusuran arsip dengan memakai layanan
yang sudah ada. Dokumen rekomendasi pengguna belum seluruhnya diterapkan.

## Perilaku yang tersedia

- Pencarian nomor berkas, nomor surat, dan perihal memakai API metadata yang sama.
  Pencarian, tahun, unit, nomor halaman, dan jumlah baris tercatat dalam URL.
  Kembali dari detail mempertahankan kueri tersebut.
- Filter aktif dapat dihapus satu per satu atau sekaligus. Pilihan tahun mengikuti
  rentang API 2000–2100. Daftar menampilkan jumlah hasil serta 10, 25, atau 50 baris.
  Halaman yang sudah tidak tersedia dialihkan ke halaman terakhir yang valid.
- **Simpan filter** menyimpan paling banyak 20 konfigurasi bernama per akun pada
  browser ini. Nama yang sama memperbarui konfigurasi. Filter dapat diterapkan
  dan dihapus; kegagalan penyimpanan ditampilkan tanpa mengaku berhasil.
- Pilih uraian berkas untuk membuka pratinjau di samping tabel pada layar lebar.
  Pada layar kecil panel berada di atas daftar. Tombol tutup atau Escape
  mengembalikan fokus ke uraian berkas yang dipilih.
- Panel menampilkan dokumen digital, identitas, lokasi fisik, retensi, penyusutan,
  keamanan, dan peminjaman. **Muat dokumen** memakai layanan berkas privat yang
  sudah ada. Izin surat sumber diperiksa terpisah dari izin arsip. Panel
  menampilkan keterangan ketika berkas belum tersedia, penyimpanan nonaktif,
  atau sumber tidak dapat diakses, serta menyediakan percobaan ulang bila sesuai.
- Kolom yang sebelumnya bernama **Status** menjadi **Nasib Akhir**, sesuai data
  yang ditampilkan. Tanggal dan unit pengolah ditambahkan untuk membantu
  membedakan dokumen yang perihalnya mirip.
- Menu arsip memakai label ringkas pada ponsel. Lebar minimum dasar halaman
  menyesuaikan ruang setelah scrollbar, sehingga layar 320 piksel tidak
  memerlukan gulir mendatar pada keseluruhan halaman.

Respons pencarian lama tidak menggantikan kueri yang baru. Perubahan akun/unit,
filter, halaman, atau pembaruan daftar menutup pratinjau sebelumnya. Parameter
unit dari URL maupun filter tersimpan tetap tunduk pada lingkup pengguna;
otorisasi server tidak berubah.

## Cakupan pemeriksaan

Hasil akhir pengujian terarah: **42 pengujian lulus dalam 5 berkas**. ESLint
pada seluruh JavaScript/JSX yang ditambahkan atau diubah lulus. Pengujian
terarah ini bukan pengganti seluruh suite backend atau UAT lingkungan tujuan.

Pengujian memakai Node 24.19.0 yang sesuai dengan kebutuhan proyek. Skenario
mencakup penyegaran daftar, pemulihan setelah gangguan, respons terlambat,
kembali dari detail, halaman di luar jangkauan, perubahan jumlah baris,
pemisahan unit, simpan/terapkan/hapus filter, pergantian akun, storage rusak atau
penuh, izin surat sumber, pembatalan permintaan, dan pelepasan object URL.

Browser diperiksa dengan data sintetis pada lebar 320, 768, 1024, dan 1440 piksel.
Pencarian, simpan dan penerapan filter, perpindahan halaman, pratinjau, serta
kembali dari detail dicoba melalui antarmuka. Pemeriksaan ini tidak menggunakan
data produksi dan tidak membuktikan kesiapan object storage/OCR di deployment.

Build frontend dan PWA lulus. Build pemeriksaan dibuat terpisah dalam
`output/archive-build-review`; tidak ada
migrasi, perubahan database, atau deployment produksi dalam pekerjaan ini.

## Hasil perbandingan dan pekerjaan lanjutan

| Area | Kondisi kode saat diperiksa | Tindak lanjut |
| --- | --- | --- |
| Pencarian isi dokumen | API full-text/OCR sudah ada; daftar memakai pencarian metadata. | Hubungkan pencarian isi dengan pilihan unit dan bentuk respons yang tepat. |
| Filter lanjutan | API daftar menerapkan jenis, tahun, unit, dan teks. | Tambahkan pemrosesan server untuk filter klasifikasi/pengirim/status sebelum menampilkan kontrolnya. |
| Dashboard pekerjaan | Tindakan sesuai peran, surat terbaru, retensi, dan peminjaman tersedia di beberapa bagian. | Satukan antrean verifikasi, persetujuan, dan tindak lanjut pribadi di bagian atas. |
| Formulir arsip | Pencatatan dari surat tersedia melalui ArchiveDialog. | Tambahkan tahap periksa/simpan dan draf identitas. |
| Unggah massal | Unggah, pemrosesan OCR, review, dan konfirmasi sudah ada. | Simpan koreksi metadata agar tetap ada saat batch dipulihkan; dukung penerapan metadata bersama. |
| Detail arsip | Identifikasi, item, retensi/lokasi, jejak aturan, keamanan, surat asli tersedia. | Bawa pratinjau ke halaman detail penuh dan tampilkan konteks izin tindakan dengan lebih jelas. |
| Retensi/penyusutan | Aturan berversi, pemicu, verifikasi, legal hold, penilaian, dan bukti tindakan tersedia. | Tingkatkan penyajian antrean dan status; tetap gunakan proses persetujuan yang ada. |
| Backup/ekspor | Skrip backup dan verifikasi restore tersedia. | Uji pemulihan pada lingkungan tujuan; validasi ekspor dokumen beserta metadata secara terpisah. |

## Berkas utama

- `frontend/src/pages/Arsip.jsx`
- `frontend/src/hooks/use-archive-list.js`
- `frontend/src/lib/archive-list-query.js`
- `frontend/src/components/archives/ArchivePreviewPanel.jsx`
- `frontend/src/components/archives/SavedArchiveFilters.jsx`
- `frontend/src/index.css`
