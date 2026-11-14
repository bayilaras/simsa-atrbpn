# Impor CSV/XLSX dan ekspor lengkap

## Impor CSV/XLSX surat masuk dan surat keluar

Pada daftar Surat Masuk atau Surat Keluar, petugas yang memiliki hak tulis dapat
memilih satu unit tujuan lalu membuka **Impor CSV/XLSX**. Berkas diperlakukan
persis seperti impor Google Sheets: kolom dikenali dari judulnya (tabel pada
[Impor Google Sheets](#impor-google-sheets)), sifat surat, identitas impor,
pemeriksaan duplikat sekaligus, impor per bagian, dan audit memakai jalur yang
sama (`importRows`). Selama
pemilih unit menunjukkan "Semua Unit Kerja", tombol impor tetap tampil tetapi
nonaktif dengan petunjuk "Pilih unit kerja terlebih dahulu".

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
| `POST /surat-masuk`, `POST /surat-keluar` | `sheet`, `unitKerjaId`, `startRow`, `prefixHash`, `sinkron` (`true`/`false`) | impor, 3/menit |

`/lembar` mengembalikan `{ format, sheets: [{ name, hidden }] }` (CSV: `sheets`
kosong). `/preview` mengembalikan `format`, `sheets`, `sheet`, ditambah bentuk
pratinjau Google Sheets (`headers`, `rows`, `totalRows`, `importType`,
`headerRow`, `mapping`). Impor mengembalikan bentuk hasil Google Sheets
(`totalRows`, `importedRows`, `updatedRows`, `duplicateRows`, `skippedRows`,
`errors`, `rows`, serta `startRow`/`nextRow`/`prefixHash` bila per bagian; lihat
[Laporan per baris dan sinkron](#laporan-per-baris-dan-sinkron)). `sheet` wajib untuk XLSX
berlembar banyak dan dicocokkan persis.

## Impor CSV arsip (dan endpoint CSV lama)

Pada daftar Arsip, **Impor CSV** tetap memakai header persis di bawah ini.
Endpoint `POST /api/migration/surat-masuk` dan `/surat-keluar` tetap tersedia
dengan kontrak yang sama untuk klien lama; frontend baru memakai impor CSV/XLSX di
atas untuk surat masuk dan surat keluar.

1. Pilih CSV dengan header unik, maksimal 1.000 rekod dan 4 MiB per berkas
   (batas yang sama dengan impor CSV/XLSX surat). Parser membatasi ukuran satu
   rekod menjadi 64 KiB. Pecah sumber yang lebih besar menjadi batch. Pemisah
   kolom boleh koma, titik koma (CSV biasa dari Excel berpengaturan Indonesia),
   atau tab, dan dibaca dari baris judul. Bila kolom wajib tidak ditemukan,
   pesannya menyebut pemisah yang terbaca, misalnya *Pemisah kolom yang terbaca:
   titik koma.*
2. Tekan **Pratinjau**. Tidak ada penulisan rekod, alokasi nomor surat, atau
   pencatatan audit mutasi pada tahap ini.
3. Periksa tanggal sumber, tanggal hasil, duplikasi, dan pesan setiap baris.
   Nomor baris menghitung record header sebagai 1; newline di dalam nilai CSV
   bertanda kutip tetap termasuk record yang sama.
4. Koreksi sumber jika ada kesalahan. Tanggal dibaca dengan aturan yang sama
   seperti impor surat: urutan hari, bulan, tahun (`03/11/2026`, `3-11-2026`,
   `3.11.2026`, `03/11/26`, `3 November 2026`, `03-Nov-26`), atau `2026-11-03`,
   boleh diikuti jam. Tahun dua angka 00–69 dibaca 2000-an dan 70–99 dibaca
   1900-an. Tanggal kosong, tanggal yang tidak ada dalam kalender, tanggal yang
   jelas ditulis bulan lebih dulu, format tidak dikenal, dan tahun di luar 1920
   sampai 2199 ditolak. Tanggal tidak pernah ditebak atau diganti dengan tanggal
   hari impor.
5. Setelah pratinjau berhasil, tekan **Impor data valid**. Mengganti berkas,
   jenis rekod, atau unit tujuan membatalkan pratinjau sebelumnya.

Pratinjau memeriksa tanggal, identitas, dan duplikasi saat dibaca. Hak akses serta
aturan bisnis tetap diperiksa oleh layanan penyimpanan saat impor. Pratinjau
bukan reservasi data: impor yang terjadi bersamaan dapat mengubah hasil.
Penyimpanan dan audit setiap rekod tetap dalam transaksi kanoniknya. Bila satu
baris gagal, baris yang telah berhasil tidak dibatalkan. Periksa ringkasan dan
hasil baris sebelum mengulang; pemeriksaan duplikasi menggunakan identitas
nomor/tahun/unit (surat masuk bernomor: juga pengirim), atau
tanggal/uraian/pihak untuk sumber tanpa nomor.

Kode klasifikasi arsip lama tetap menjadi catatan sumber yang belum diverifikasi;
impor tidak menetapkan JRA atau mengesahkan aturan retensi.

Untuk CSV surat keluar, kolom opsional `Sifat Surat` (Biasa, Penting, Segera,
Sangat Segera) disimpan sebagai sifat surat; teks lain disimpan apa adanya.
Untuk CSV surat masuk, `Sifat Surat` adalah klasifikasi keamanan: baris Rahasia
dan Sangat Rahasia dari pengguna selain Super Admin ditolak per baris, begitu
pula baris dengan sifat yang tidak dikenal untuk semua pengguna, juga saat
pratinjau CSV lama (`dryRun=true`). Sel kosong atau "-" dicatat sebagai Biasa
(lihat [batas klasifikasi keamanan](#sifat-surat-masuk-dan-batas-klasifikasi-keamanan)).

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
akses "Siapa saja yang memiliki link". Aktifkan berbagi link hanya selama impor,
lalu matikan kembali setelah impor selesai; dialog impor mengingatkan hal ini.
Register yang memuat surat Terbatas atau lebih tinggi jangan dibagikan lewat
link: unduh sebagai Microsoft Excel (.xlsx), lalu impor dengan **Impor CSV/XLSX**.

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
| No. Agenda (surat masuk) / No. Urut (surat keluar) | No, Nomor Urut, No Urut, No Agenda, Nomor Agenda; juga judul kolom pertama yang diakhiri kata "No" bila judul register menyatu dengannya (mis. `SURAT KELUAR 2026 No` pada ekspor CSV Google). Bila ada kolom "No" dan kolom "No. Agenda", dipakai kolom No. Agenda | Tidak |
| Jenis surat (surat masuk) / Jenis naskah (surat keluar) | Jenis Surat, Jenis Naskah, Naskah Dinas, Jenis | Tidak |
| Sifat surat | Sifat Surat, Sifat | Tidak |
| Disposisi (surat masuk) | Disposisi | Tidak |
| Tautan dokumen (surat keluar) | Link Dokumen, Link, URL, Get link | Tidak |
| Klasifikasi arsip, Kode klasifikasi, Jenis klasifikasi (surat keluar) | Klasifikasi Arsip, Klasifikasi; Kode Klasifikasi, Klasifikasi Kode, Kode; Jenis Klasifikasi, Klasifikasi Jenis | Tidak |
| ID sumber; Status sumber (surat masuk) | ID; Status, Disposisi Status | Tidak (dikenali, tidak disimpan) |

**Nomor dari sumber.** Nilai kolom No. Agenda/No. Urut disimpan sebagai nomor
agenda surat masuk atau nomor urut surat keluar bila nomor itu belum dipakai di
unit dan tahun yang sama, termasuk oleh surat yang sudah dihapus. Pemetaan pada
pratinjau menulis **No. Agenda (disimpan bila belum dipakai)** atau **No. Urut
(disimpan bila belum dipakai)**. Bila nomornya sudah terpakai atau bukan angka 1
sampai 999999, baris tetap disimpan dengan nomor berikutnya dan keterangannya
menyebut, misalnya, *Nomor agenda sumber 12 sudah dipakai; diberi nomor 57.*
Karena itu, impor register lama sebelum mencatat surat baru untuk tahun yang
sama; bila tidak, nomor yang sudah terpakai oleh surat baru membuat baris
register mendapat nomor lain. Kolom "No" sumber tetap tercantum di rincian hasil
per baris.

**Kolom yang tidak disimpan.** Pemetaan menandai kolom yang dikenali tetapi tidak
disimpan dengan **(tidak disimpan)**: ID sumber, Status sumber (surat masuk
yang diimpor selalu mulai berstatus belum diproses), serta Klasifikasi arsip dan
Kode klasifikasi bila tidak ada kolom Jenis klasifikasi (fasilitatif atau
substantif), atau Jenis klasifikasi bila tidak ada kolom kode atau judul
klasifikasi.

Bila dua kolom tautan berjudul sama (misalnya label "file" dan URL), dipakai
satu-satunya kolom yang berisi alamat web, atau kolom yang memuat setiap alamat
kolom lainnya pada baris yang sama; hanya nilai `http(s)://` yang disimpan. Baris tanpa nomor surat (kosong atau "-") memerlukan Pengirim (surat
masuk), atau Kepada maupun tautan dokumen (surat keluar), agar dapat dikenali
saat impor ulang; baris tanpa keduanya ditolak per baris.

### Pratinjau memeriksa setiap baris

Pratinjau Google Sheets dan CSV/XLSX menjalankan pemeriksaan per baris yang sama
dengan impor (tanggal, sifat dan batas kelas surat masuk, identitas impor, dan
isian wajib), tanpa menyimpan apa pun. Hasilnya tampil sebelum **Impor**:

- Kotak *n dari total baris akan ditolak* beserta daftar *Baris data ke-N:
  alasan*. Baris lain tetap dapat diimpor.
- Baris yang akan dilewati: *… baris sudah tercatat di SIMSA pada unit ini dan
  akan dilewati, atau diperbarui bila Sinkronkan dipilih dan sumbernya
  berubah.*, *… baris ganda di sumber akan dilewati.*, dan *… baris cocok dengan
  surat yang sudah dihapus dan tidak akan dibuat ulang.*
- Surat masuk bernomor dianggap sama bila nomor, tahun, dan pengirimnya sama.
  Pengirim dibandingkan tanpa membedakan huruf besar-kecil dan spasi; baris atau
  surat tanpa pengirim cocok dengan pengirim mana pun. Bila nomornya sama tetapi
  pengirimnya berbeda, pratinjau menulis *… baris bernomor sama dengan surat yang
  sudah tercatat tetapi pengirimnya berbeda; baris ini akan dicatat sebagai surat
  baru. Periksa penulisan pengirim bila surat itu sama.*

Pratinjau bukan reservasi: impor tetap memeriksa ulang setiap baris, sehingga
perubahan data di antara pratinjau dan impor dapat mengubah hasilnya.

### Sifat surat masuk dan batas klasifikasi keamanan

Pada surat masuk, sifat surat sekaligus menjadi klasifikasi keamanan: Biasa,
Terbatas, Rahasia, atau Sangat Rahasia. Sifat urgensi Segera, Sangat Segera,
Amat Segera/Kilat (juga "Amat Segera / Kilat", atau Amat Segera atau Kilat saja),
Penting, dan Undangan, serta Terbuka dan Biasa/Terbuka, dibaca sebagai Biasa. Sel
kosong atau berisi "-" dicatat sebagai Biasa. Huruf besar-kecil, spasi di tepi, dan tanda hubung
tidak berpengaruh, sehingga "SANGAT-SEGERA" sama dengan "Sangat Segera".

Semua jalur impor surat masuk (Google Sheets, CSV/XLSX, dan
`POST /api/migration/surat-masuk`) menerapkan batas kelas yang sama dengan
formulir: Admin Unit Kerja, Admin Dirjen, dan Admin Sesditjen hanya dapat
mengimpor baris Biasa dan Terbatas; baris **Rahasia** dan **Sangat Rahasia**
hanya dapat diimpor oleh Super Admin.

- Baris di atas batas itu **ditolak per baris** dengan keterangan "Klasifikasi
  keamanan melebihi kewenangan pengguna. Kelas Rahasia dan Sangat Rahasia hanya
  dapat ditetapkan oleh Super Admin." Baris lain tetap diimpor, dan impor tidak
  gagal seluruhnya.
- Baris yang ditolak tidak dicocokkan dengan surat yang sudah tercatat, juga saat
  sinkron, dan tidak dihitung sebagai baris sebelumnya untuk pemeriksaan ganda.
  Impor ulang lembar yang sama oleh Admin tetap melaporkannya sebagai ditolak,
  meskipun Super Admin sudah mengimpornya.
- Minta Super Admin mengimpor lembar tersebut atau mencatat surat itu melalui
  formulir.
- Sifat lain yang tidak dikenal (misalnya "Konfidensial" atau singkatan "R")
  **ditolak per baris untuk semua pengguna**, termasuk Super Admin, dengan
  keterangan "Sifat surat tidak dikenal. Gunakan Biasa, Terbatas, Rahasia, atau
  Sangat Rahasia, atau sifat urgensi Segera, Sangat Segera, Amat Segera/Kilat,
  Penting, atau Undangan." Surat dengan sifat seperti itu tidak dapat dibaca
  siapa pun, jadi tidak dicatat. Sifat yang lebih dari 50 karakter juga ditolak.
  Perbaiki sifat di sumber lalu impor ulang.
- Penolakan sifat tak dikenal hanya berlaku untuk baris yang akan dicatat
  sebagai surat baru. Saat sinkron, baris yang cocok dengan surat yang sudah
  tercatat tetap memperbarui perihal, tanggal, dan jenis surat, karena sinkron
  tidak pernah mengubah sifat surat masuk.
- Pratinjau Google Sheets dan berkas CSV/XLSX memeriksa setiap baris dengan
  pemeriksaan yang sama seperti impor, termasuk kedua jenis penolakan sifat ini,
  dan mencantumkannya sebelum **Impor** (lihat
  [Pratinjau](#pratinjau-memeriksa-setiap-baris)).
- `POST` dan `PUT /api/surat-masuk` menolak sifat yang tidak dikenal dengan 400
  dan pesan yang sama; kelas yang dikenal di atas kewenangan tetap dijawab 403.
- Surat keluar tidak terpengaruh: sifat surat keluar adalah urgensi, dan impor
  selalu mencatat klasifikasi keamanannya sebagai Biasa.

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

## Laporan per baris dan sinkron

Setelah impor, dialog menampilkan **Rincian hasil impor per baris** untuk semua
baris dari semua bagian: nomor baris data (dihitung dari 1 setelah judul kolom,
baris kosong tidak dihitung), kolom "No" sumber, nomor surat, tanggal seperti
tertulis, perihal, status, dan keterangan. Filter bawaan "Perlu dicek" hanya
menampilkan baris yang perlu ditindaklanjuti: ganda di sumber, cocok dengan surat
yang sudah dihapus, ditolak, dan tidak diperbarui; surat yang sudah tercatat (tanpa
perubahan) tidak termasuk. Ringkasan memisahkan baris yang sudah tercatat di SIMSA,
ganda di sumber, dan cocok dengan surat yang dihapus. **Unduh laporan (CSV)**
menyimpan semua baris (UTF-8 dengan BOM, pemisah titik koma `;` agar Excel dengan
pengaturan regional Indonesia langsung memisahkan kolom; Google Sheets mendeteksinya
otomatis).

| Status | Arti |
|---|---|
| Tersimpan | Surat baru dibuat. |
| Duplikat | Tidak ditulis: identitas impor sama dengan baris sumber sebelumnya (disebut nomor barisnya; `duplicate: source`), sudah tercatat di unit ini (`recorded`), atau cocok dengan surat yang sudah dihapus (`deleted`; tidak dibuat ulang). Surat masuk bernomor sama bila nomor, tahun, dan pengirimnya sama (lihat [Pratinjau](#pratinjau-memeriksa-setiap-baris)). |
| Ditolak | Baris tidak dapat disimpan, misalnya tanggal kosong/tidak valid, surat tanpa nomor yang tidak punya pengirim/tujuan, atau surat masuk Rahasia/Sangat Rahasia yang diimpor bukan oleh Super Admin (lihat [batas klasifikasi keamanan](#sifat-surat-masuk-dan-batas-klasifikasi-keamanan)). |
| Kosong | Nomor surat dan perihal kosong. |
| Diperbarui | (Sinkron) surat yang sudah tercatat diubah; keterangan memuat nilai lama → baru. |
| Tidak diperbarui | (Sinkron) sumber berbeda tetapi surat tidak boleh diubah; keterangan menyebut sebabnya. |

**Sinkronkan surat yang sudah tercatat** (kotak centang pada pratinjau, mati secara
bawaan) memperbarui surat yang identitas impornya sudah tercatat di unit tujuan bila
sumber mengubahnya:

- Surat keluar: perihal, tanggal, sifat, tautan dokumen, jenis naskah. Surat masuk:
  perihal, tanggal, jenis surat. **Sifat surat masuk tidak pernah diubah** karena
  menentukan klasifikasi keamanan.
- Hanya kolom yang dipetakan; sel kosong tidak menghapus nilai.
- Tidak diubah: surat keluar yang sedang/telah disetujui, surat yang diarsipkan atau
  dihapus, surat yang tidak boleh diubah pengimpor (klasifikasi terbatas ke atas tanpa
  izin kelola), surat masuk dalam rangkaian yang perubahannya memerlukan alasan, dan
  identitas yang cocok dengan lebih dari satu surat. Bila nomor yang sama muncul
  beberapa kali di sumber, hanya baris pertamanya yang dipakai.
- Bila sumber menyebut pengirim (surat masuk) atau tujuan (surat keluar) yang berbeda
  dari yang tercatat, surat tidak diubah: nomor yang sama mungkin milik surat lain.
- Teks sumber disimpan seperti dari formulir (tag dibuang, spasi dirapatkan); beda
  format saja tidak dianggap perubahan.
- Setiap surat yang berubah mendapat satu entri log audit `update` dengan nilai lama
  dan baru serta `sumber: impor_sinkron`.
- Untuk surat tanpa nomor, tanggal dan perihal adalah bagian identitas; mengubahnya
  di sumber membuat baris dianggap surat baru.

API: `sinkron: true` (JSON Google Sheets) atau field `sinkron=true` (berkas). Respons
menambah `updatedRows` dan `rows[]` berisi `{ row, no, nomorSurat, tanggal, perihal,
status: imported|updated|duplicate|locked|invalid|empty, duplicate?: source|recorded|deleted,
reason?, changes? }`; pada
impor per bagian `rows` hanya mencakup bagian itu. `errors` (maks. 20) tetap ada untuk
klien lama.

## Batas ekspor

Ekspor Excel/PDF surat masuk, surat keluar, dan arsip memakai filter pencarian,
tahun, unit, serta pembatasan keamanan yang sama dengan query datanya.
Maksimal 10.000 rekod dapat diekspor dalam satu permintaan.

- Lebih dari 10.000 hasil menghasilkan 422 `EXPORT_LIMIT_EXCEEDED`, beserta
  `total`, `limit`, dan petunjuk mempersempit filter. Tidak ada file parsial.
- Jumlah hasil yang berbeda antara penghitungan dan pembacaan menghasilkan
  409 `EXPORT_RESULT_CHANGED`; muat ulang daftar dan coba lagi.
- Ekspor arsip memisahkan Formulir 4 (arsip aktif) dan Formulir 6 (arsip
  inaktif: masa aktif berakhir menurut klasifikasi/JRA dan pemicu retensi
  terverifikasi, atau pemindahannya sudah dicatat melalui modul Penyusutan).
  Hanya arsip yang sudah dimusnahkan atau diserahkan yang tidak masuk
  keduanya. Pemindahan yang dilaksanakan sebelum pembaruan siklus arsip pada
  September 2026 tetap masuk Formulir 6 tanpa pemulihan batch, dan alih media
  dari masa itu mengikuti aturan masa aktif biasa. Formulir 4 dan Formulir 6
  yang dicetak dari modul Penyusutan memakai aturan yang sama. Batas
  10.000 dihitung dari seluruh hasil filter sebelum dipisah per formulir.
  Formulir 6 tanpa arsip inaktif menghasilkan 422 `EXPORT_FORMULIR6_EMPTY`
  beserta pesan penjelasan; tidak ada file kosong. Ekspor arsip dari menu
  Laporan tidak dipisah per fase dan tetap memuat semua arsip sesuai filter.
- Ekspor besar secara asynchronous belum disediakan. Batas ini tidak
  membuktikan kapasitas atau waktu respons pada lingkungan produksi.

Isi berkas ekspor:

- Tanggal dan waktu ditulis dalam WIB (waktu cetak berakhiran "WIB"), dan label
  nilai sama dengan label di layar.
- Super Admin yang mengekspor daftar Surat Masuk, Surat Keluar, atau Arsip
  dengan pilihan **Semua Unit Kerja** mendapat kolom **Unit Kerja** berisi nama
  unit, bukan kodenya.
- Ekspor memakai urutan yang dipilih pada **Urutkan** di daftar surat.
- Pada PDF, teks panjang dibungkus dalam sel dan tinggi baris mengikuti isinya,
  termasuk pada Formulir 4 dan Formulir 6. Baris yang lebih tinggi dari satu
  halaman dipotong dengan catatan *Teks yang terlalu panjang dipotong; versi Excel
  memuat isi lengkap.*

Parser dipatok pada `csv-parse` 7.0.2 setelah pemeriksaan advisori
[GHSA-8cw4-87c7-c6xx](https://github.com/adaltas/node-csv/security/advisories/GHSA-8cw4-87c7-c6xx).
Pengujian mencakup UTF-8 BOM, delimiter/newline di dalam kutipan, header
berbahaya/duplikat, tahun kabisat, duplikasi, audit gagal, dan pratinjau tanpa
mutasi pada endpoint CSV lama. Impor CSV/XLSX surat memakai parser CSV terbatas
milik impor Google Sheets (dengan pemisah `;`/tab) dan pembaca XLSX `exceljs`
setelah pemeriksaan paket di atas; ujinya mencakup register sintetis (judul
gabungan, serial tanggal, sel bertautan, dua kolom "Get link"), batas baris/kolom/
sel, paket berbahaya, dan kesetaraan hasil XLSX, CSV `;`/`,`, dan Google Sheets.
