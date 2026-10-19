# Impor CSV dan ekspor lengkap

Pada daftar Surat Masuk, Surat Keluar, atau Arsip, petugas yang memiliki hak
tulis dapat memilih satu unit tujuan lalu membuka **Impor CSV**. Fitur ini tidak
ditampilkan pada demo metadata.

1. Pilih CSV dengan header unik, maksimal 1.000 rekod dan 10 MiB. Parser membatasi
   ukuran satu rekod menjadi 64 KiB. Pecah sumber yang lebih besar menjadi batch.
2. Tekan **Pratinjau**. Tidak ada penulisan rekod, alokasi nomor surat, atau
   pencatatan audit mutasi pada tahap ini.
3. Periksa tanggal sumber, tanggal hasil, duplikasi, dan pesan setiap baris.
   Nomor baris menghitung record header sebagai 1; newline di dalam nilai CSV
   bertanda kutip tetap termasuk record yang sama.
4. Koreksi sumber jika ada kesalahan. Tanggal kosong, tanggal yang tidak ada
   dalam kalender, atau format tidak dikenal ditolak. Format yang diterima:
   `YYYY-MM-DD`, `DD/MM/YYYY`, dan `DD/MM/YYYY HH:mm:ss`. Tanggal tidak pernah
   diganti dengan tanggal hari impor.
5. Setelah pratinjau berhasil, tekan **Impor data valid**. Mengganti berkas,
   jenis rekod, atau unit tujuan membatalkan pratinjau sebelumnya.

Pratinjau memeriksa tanggal, identitas, dan duplikasi saat dibaca. Hak akses serta
aturan bisnis tetap diperiksa oleh layanan penyimpanan saat impor. Pratinjau
bukan reservasi data: impor yang terjadi bersamaan dapat mengubah hasil.
Penyimpanan dan audit setiap rekod tetap dalam transaksi kanoniknya. Bila satu
baris gagal, baris yang telah berhasil tidak dibatalkan. Periksa ringkasan dan
hasil baris sebelum mengulang; pemeriksaan duplikasi menggunakan identitas
nomor/tahun/unit, atau tanggal/uraian/pihak untuk sumber tanpa nomor.

Kode klasifikasi arsip lama tetap menjadi catatan sumber yang belum diverifikasi;
impor tidak menetapkan JRA atau mengesahkan aturan retensi.

Untuk CSV surat keluar, kolom opsional `Sifat Surat` (Biasa, Penting, Segera,
Sangat Segera) disimpan sebagai sifat surat; teks lain disimpan apa adanya.

## Kontrak API

Ketiga endpoint `POST /api/migration/surat-masuk`, `/surat-keluar`, dan `/arsip`
tetap menerima multipart `file` dan `unitKerjaId`. Tambahkan `dryRun=true` untuk
pratinjau. `dryRun=false` atau tidak disertakan tetap menjalankan impor;
nilai selain string `true`/`false` ditolak dengan 400. Endpoint memeriksa izin
dan menyelesaikan unit efektif sendiri.

Respons mempertahankan `success`, `imported`, `skipped`, `duplicates`, dan
`errors`; ditambah `dryRun`, `valid` (lulus pemeriksaan awal), serta `rows` dengan
`row`, `status`, `sourceDate`, `normalizedDate` bila valid, dan `message` bila ada.
Status baris adalah `valid`, `imported`, `duplicate`, atau `invalid`.
Hasil parsial tetap dikembalikan dalam respons 200 dengan `success=false` dan
jumlah rekod yang benar-benar tersimpan. Diagnostic tersedia pada respons;
sumber CSV dan seluruh diagnostic tidak disimpan sebagai batch permanen.

## Impor Google Sheets

Tombol **Impor dari Google Sheets** membaca spreadsheet yang dibagikan dengan
akses "Siapa saja yang memiliki link".

1. Tempel tautan spreadsheet. Bila tautan disalin saat tab tertentu terbuka
   (berisi `gid=`), tab itu langsung terpilih.
2. Pilih lembar. Lembar dikenali dari `gid`, bukan nama. Bila daftar lembar
   tidak terbaca, hanya lembar dari tautan yang ditawarkan; buka tab yang
   dimaksud di Google Sheets lalu salin tautannya.
3. Periksa pemetaan kolom pada pratinjau sebelum mengimpor.

Kolom dikenali dari judulnya pada lima baris pertama, tidak pernah dari posisi.

| Data | Judul kolom yang dikenali | Wajib |
|---|---|---|
| Nomor surat | Nomor Surat, No Surat, Nomor | Ya |
| Tanggal surat | Tanggal Surat, Tgl Surat, Tanggal, Tgl | Ya |
| Perihal | Perihal, Hal, Subject | Ya |
| Pengirim (surat masuk) | Dari, Asal, Pengirim, From | Ya, surat masuk |
| Kepada | Kepada, Tujuan, Penerima, To | Tidak |
| Sifat surat | Sifat Surat, Sifat | Tidak |
| Tautan dokumen (surat keluar) | Link Dokumen, Link, URL, Get link | Tidak |

Bila dua kolom tautan berjudul sama (misalnya label "file" dan URL), dipakai
satu-satunya kolom yang berisi alamat web; hanya nilai `http(s)://` yang
disimpan. Baris tanpa nomor surat (kosong atau "-") memerlukan Pengirim (surat
masuk), atau Kepada maupun tautan dokumen (surat keluar), agar dapat dikenali
saat impor ulang; baris tanpa keduanya ditolak per baris.

## Batas ekspor

Ekspor Excel/PDF surat masuk, surat keluar, dan arsip memakai filter pencarian,
tahun, unit, serta pembatasan keamanan yang sama dengan query datanya.
Maksimal 10.000 rekod dapat diekspor dalam satu permintaan.

- Lebih dari 10.000 hasil menghasilkan 422 `EXPORT_LIMIT_EXCEEDED`, beserta
  `total`, `limit`, dan petunjuk mempersempit filter. Tidak ada file parsial.
- Jumlah hasil yang berbeda antara penghitungan dan pembacaan menghasilkan
  409 `EXPORT_RESULT_CHANGED`; muat ulang daftar dan coba lagi.
- Ekspor besar secara asynchronous belum disediakan. Batas ini tidak
  membuktikan kapasitas atau waktu respons pada lingkungan produksi.

Parser dipatok pada `csv-parse` 7.0.2 setelah pemeriksaan advisori
[GHSA-8cw4-87c7-c6xx](https://github.com/adaltas/node-csv/security/advisories/GHSA-8cw4-87c7-c6xx).
Pengujian mencakup UTF-8 BOM, delimiter/newline di dalam kutipan, header
berbahaya/duplikat, tahun kabisat, duplikasi, audit gagal, dan pratinjau tanpa
mutasi. Jalur impor Google Sheets yang terpisah tidak diubah oleh fitur CSV ini.
