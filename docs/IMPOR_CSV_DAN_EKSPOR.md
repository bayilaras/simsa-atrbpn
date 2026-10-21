# Impor CSV/XLSX dan ekspor lengkap

## Impor CSV/XLSX surat masuk dan surat keluar

Pada daftar Surat Masuk atau Surat Keluar, petugas yang memiliki hak tulis dapat
memilih satu unit tujuan lalu membuka **Impor CSV/XLSX**. Berkas diperlakukan
persis seperti impor Google Sheets: kolom dikenali dari judulnya (tabel pada
[Impor Google Sheets](#impor-google-sheets)), sifat surat, identitas impor,
pemeriksaan duplikat sekaligus, impor per bagian, dan audit memakai jalur yang
sama (`importRows`). Fitur ini tidak ditampilkan pada demo metadata.

1. Pilih berkas `.csv` atau `.xlsx` (maksimal 4 MiB, 1.000 baris data, 64 kolom,
   16 KiB per sel). Batas 4 MiB berada di bawah batas badan permintaan Vercel.
2. Tekan **Pratinjau**. Untuk XLSX dengan beberapa lembar, pilih lembar kerja
   lalu tekan **Pratinjau** lagi; lembar tersembunyi ditandai. Lembar dipilih
   dari namanya dan tidak pernah ditebak. XLSX berlembar tunggal langsung
   dipratinjau.
3. Periksa pemetaan kolom dan contoh baris, lalu tekan **Impor N baris**. Berkas
   yang panjang diimpor per bagian; setiap bagian mengirim ulang berkas yang sama.
   Berkas hanya dibaca di memori selama permintaan dan tidak disimpan.

Cara berkas dibaca:

- **CSV**: UTF-8 (dengan atau tanpa BOM); bila bukan UTF-8 yang sah, dibaca
  sebagai Windows-1252 (simpanan "CSV (Comma delimited)" Excel). Pemisah `,`,
  `;` (Excel dengan pengaturan regional Indonesia), atau tab dideteksi dari
  sepuluh baris pertama di luar tanda kutip. Baris kosong diabaikan, dan sel
  serta baris kosong yang ditambahkan Excel hingga batas format tidak dihitung
  dalam batas baris dan kolom (berlaku juga untuk impor Google Sheets).
- **XLSX**: sel tanggal Excel (serial berformat tanggal, termasuk hasil rumus)
  menjadi `YYYY-MM-DD` tanpa jam; sel bertautan dibaca sebagai teksnya, seperti
  ekspor CSV Google Sheets, kecuali di bawah judul kolom tautan (Link Dokumen,
  Link, URL, Get link) pada surat keluar: di sana dipakai alamat tautannya bila
  `http(s)://`, termasuk rumus `HYPERLINK("https://…", …)` dengan alamat tertulis
  utuh (alamat hasil gabungan `"…"&D5` tidak dipakai); rumus dibaca dari hasil
  tersimpannya; teks kaya digabung; sel gabungan (merge)
  hanya bernilai pada sel pertamanya, seperti ekspor CSV Google Sheets. Baris
  yang hanya berformat diabaikan. Validasi data dan format bersyarat tidak dibaca.
- Bila dua kolom berjudul tautan sama-sama memuat alamat web (misalnya label
  "file" yang ditautkan ke berkas yang sama), dipakai kolom yang memuat setiap
  alamat kolom lainnya pada baris yang sama; bila alamatnya berbeda, pemetaan
  ditolak sebagai ambigu.

Ditolak sebelum dibaca: ekstensi selain `.csv`/`.xlsx` atau jenis MIME yang tidak
cocok; isi yang tidak sesuai ekstensi (byte awal); XLSX berkata sandi atau `.xls`
lama (format OLE); buku kerja bermakro (`vbaProject.bin`, lembar makro, tipe isi
`macroEnabled`) atau templat; paket ZIP dengan bagian terenkripsi, kompresi selain
deflate, nama bagian yang tidak baku (`./`, `..`, `//`, `/` di awal, non-ASCII,
atau field Unicode Path), direktori pusat yang tidak berakhir tepat di rekaman
akhirnya, lebih dari 1.000 bagian, lebih dari 100 lembar, total isi terekstrak di
atas 16 MiB, atau bagian yang mengembang melebihi ukuran yang dinyatakan; CSV
berisi byte NUL (misalnya UTF-16).

### Kontrak API (berkas)

Semua endpoint di bawah `/api/import/berkas` memerlukan hak tulis dan menerima
multipart dengan satu `file`:

| Endpoint | Field lain | Batas laju |
|---|---|---|
| `POST /lembar` | — | daftar lembar, 3/menit |
| `POST /preview` | `type` (`surat-masuk`/`surat-keluar`), `sheet`, `maxRows` (1–100, bawaan 10) | pratinjau, 3/menit |
| `POST /surat-masuk`, `POST /surat-keluar` | `sheet`, `unitKerjaId`, `startRow`, `prefixHash` | impor, 3/menit |

`/lembar` mengembalikan `{ format, sheets: [{ name, hidden }] }` (CSV: `sheets`
kosong). `/preview` mengembalikan `format`, `sheets`, `sheet`, ditambah bentuk
pratinjau Google Sheets (`headers`, `rows`, `totalRows`, `importType`,
`headerRow`, `mapping`). Impor mengembalikan bentuk hasil Google Sheets
(`totalRows`, `importedRows`, `duplicateRows`, `skippedRows`, `errors`, serta
`startRow`/`nextRow`/`prefixHash` bila per bagian). `sheet` wajib untuk XLSX
berlembar banyak dan dicocokkan persis.

## Impor CSV arsip (dan endpoint CSV lama)

Pada daftar Arsip, **Impor CSV** tetap memakai header persis di bawah ini.
Endpoint `POST /api/migration/surat-masuk` dan `/surat-keluar` tetap tersedia
dengan kontrak yang sama untuk klien lama; frontend baru memakai impor CSV/XLSX di
atas untuk surat masuk dan surat keluar.

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

Impor (bukan pratinjau) dapat berjalan **per bagian**; lihat
[Impor panjang per bagian](#impor-panjang-per-bagian).

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
satu-satunya kolom yang berisi alamat web, atau kolom yang memuat setiap alamat
kolom lainnya pada baris yang sama; hanya nilai `http(s)://` yang disimpan. Baris tanpa nomor surat (kosong atau "-") memerlukan Pengirim (surat
masuk), atau Kepada maupun tautan dokumen (surat keluar), agar dapat dikenali
saat impor ulang; baris tanpa keduanya ditolak per baris.

## Impor panjang per bagian

Lembar Google Sheets serta berkas CSV/XLSX yang panjang diimpor per bagian dalam satu
kali klik. Server berhenti memulai baris baru setelah ±25 detik per permintaan
dan memberi tahu baris lanjutan; dialog langsung mengirim bagian berikutnya
sampai selesai, sambil menampilkan jumlah baris yang sudah diproses, tersimpan,
duplikat, dan dilewati.

- **Hentikan setelah bagian ini** (Google Sheets dan CSV/XLSX) menyelesaikan bagian yang
  sedang berjalan lalu berhenti. Hasil menyebut baris tempat impor berhenti.
- Bila satu bagian lanjutan gagal atau habis waktu, dialog menampilkan
  **Impor belum selesai** beserta jumlah baris dari bagian sebelumnya yang
  sudah tersimpan. Hasil bagian yang gagal mungkin sebagian tersimpan.
- Dalam semua kasus itu, jalankan impor lagi dari awal. Baris yang sudah
  tersimpan dikenali sebagai duplikat dalam satu kueri, jadi pengulangan
  hanya menulis baris yang belum ada.
- Bila batas 3 permintaan impor per menit tercapai di tengah impor, dialog
  menunggu lalu melanjutkan sendiri.

Untuk surat masuk dan surat keluar, duplikat diperiksa sekali untuk seluruh
lembar/berkas sebelum penulisan (termasuk surat yang sudah dihapus); arsip CSV
masih diperiksa per rekod. Pemeriksaan sekaligus ini hanya mempercepat:
setiap baris yang belum ada tetap melewati transaksi kanonik yang memeriksa
ulang identitas di bawah kunci penomoran unit, lalu menyimpan surat dan audit.

### Kontrak API

Klien mengirim `startRow` (0–1.000, indeks baris data/rekod) untuk meminta impor
per bagian: JSON pada `POST /api/import/google-drive/surat-{masuk,keluar}`, field
multipart pada `POST /api/import/berkas/surat-{masuk,keluar}` dan `POST /api/migration/*`
(tidak untuk `dryRun=true`). Bagian kedua dan
seterusnya juga mengirim `prefixHash` dari respons sebelumnya.

Respons menambah `startRow`, `nextRow` (baris lanjutan, atau `null` bila selesai),
dan `prefixHash` (bila `nextRow` tidak `null`). Jumlah dan baris diagnostic pada
respons hanya mencakup bagian itu. `prefixHash` adalah SHA-256 atas baris sebelum
`nextRow` (untuk Sheets dan berkas CSV/XLSX: baris sebagaimana dibaca impor, sehingga kolom yang tidak dibaca seperti ID atau Status sumber boleh berubah). Bila baris sebelum
`startRow` berubah, disisipkan, atau dihapus, server menolak dengan 409 agar tidak
ada baris yang terlewat; baris yang ditambahkan di bawah tetap ikut diimpor.

Klien lama yang tidak mengirim `startRow` tetap mengimpor seluruh sumber dalam
satu permintaan seperti sebelumnya. Sebaliknya endpoint Google Sheets lama menolak
`startRow` (400, tanpa menulis apa pun), jadi backend harus dirilis sebelum frontend.

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
mutasi pada endpoint CSV lama. Impor CSV/XLSX surat memakai parser CSV terbatas
milik impor Google Sheets (dengan pemisah `;`/tab) dan pembaca XLSX `exceljs`
setelah pemeriksaan paket di atas; ujinya mencakup register sintetis (judul
gabungan, serial tanggal, sel bertautan, dua kolom "Get link"), batas baris/kolom/
sel, paket berbahaya, dan kesetaraan hasil XLSX, CSV `;`/`,`, dan Google Sheets.
