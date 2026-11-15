# 🗂️ Arsip Aktif

Panduan mengelola arsip aktif yang berasal dari surat masuk dan surat keluar.

---

## Apa Itu Arsip Aktif?

Arsip aktif adalah **arsip yang masih digunakan secara langsung** dalam pelaksanaan tugas. Arsip ini berasal dari surat masuk atau surat keluar yang sudah selesai diproses dan dipindahkan ke arsip.

Halaman **Manajemen Arsip** memiliki tiga tab:
- **Arsip Surat Keluar** — Arsip yang berasal dari surat keluar
- **Arsip Surat Masuk** — Arsip yang berasal dari surat masuk
- **Status Retensi** — Ringkasan arsip menurut tahap retensinya. Super Admin memilih satu unit kerja terlebih dahulu; selama **Semua Unit Kerja** terpilih tertulis *Pilih unit kerja untuk melihat status retensi.* Bila ringkasan gagal dimuat, tertulis *Status retensi belum dapat dimuat. Silakan coba lagi.*

---

## Melihat Daftar Arsip

### Langkah 1: Buka Menu Arsip Aktif

1. Di sidebar, klik **Arsip Aktif** (ada ikon ▼).
2. Pilih **Arsip Surat Masuk** atau **Arsip Surat Keluar**.

### Langkah 2: Lihat Tabel Arsip

Tabel menampilkan:

| Kolom | Keterangan |
|-------|------------|
| No. Berkas | Nomor berkas arsip |
| Klasifikasi | Kode klasifikasi arsip |
| Uraian Berkas | Deskripsi isi arsip. Klik uraian untuk melihat pratinjau di samping tabel |
| Tanggal / Unit | Tanggal arsip dan unit kerjanya |
| Lokasi | Lokasi penyimpanan fisik |
| Retensi | Masa aktif dan inaktif |
| Nasib Akhir | Permanen atau Musnah menurut JRA. Selama pemicu retensi belum terverifikasi tertulis **Menunggu verifikasi**; selama klasifikasi dan JRA arsip belum direkonsiliasi tertulis **Menunggu rekonsiliasi** |
| Aksi | Menu tiga titik (⋯) berisi **Detail Arsip** |

Gunakan kotak **Cari arsip** (nomor berkas, nomor surat, atau perihal) dan tombol **Filter** untuk menyaring menurut tahun. Frasa tetap ditemukan walaupun teks aslinya terpotong baris baru. Tombol **Perbarui**, **Impor CSV**, dan **Export** ada di kanan atas; **Impor CSV** hanya tampil bagi admin setelah satu unit kerja dipilih.

Bila daftar dibuka dari halaman [Lokasi Simpan](../layanan-fisik/lokasi-simpan.md), daftar tersaring untuk lokasi itu beserta sub-lokasinya dan menampilkan tanda **Lokasi simpan: nama (kode)** yang dapat dihapus. Bila lokasi itu juga menyimpan arsip jenis lain, di bawahnya ada tautan untuk melihat arsip surat masuk atau arsip surat keluar di lokasi yang sama.

### Ekspor Formulir 4 dan Formulir 6

Klik tombol **Export**, lalu pilih Excel (.xlsx) atau PDF pada formulir yang dibutuhkan. Isi ekspor mengikuti tab, unit, pencarian, dan tahun yang sedang dipilih. Saringan lokasi simpan tidak ikut ke berkas ekspor.

| Formulir | Isi |
|----------|-----|
| **Formulir 4 — Daftar Arsip Aktif** | Arsip yang masa aktifnya belum berakhir. Kolom: No. Berkas, Kode Klasifikasi, Uraian Informasi Berkas, Kurun Waktu, Jumlah Berkas, Item Arsip (No. Item, Uraian Informasi Arsip, Tanggal, Jumlah), Tingkat Perkembangan, Lokasi Simpan, Tingkat Klasifikasi Keamanan & Akses, Keterangan |
| **Formulir 6 — Daftar Arsip Inaktif (Kertas)** | Arsip yang masa aktifnya sudah berakhir atau yang sudah dipindahkan ke penyimpanan inaktif. Kolom: No, Kode Klasifikasi, Uraian Informasi Arsip/Berkas, Kurun Waktu, Tingkat Perkembangan, Jumlah, Lokasi Simpan, Keamanan & Akses, Jangka Simpan & Nasib Akhir, Kategori Arsip, Keterangan |

Masa aktif baru dianggap berakhir bila klasifikasi/JRA arsip sudah terverifikasi dan peristiwa pemicu retensinya sudah diverifikasi. Arsip yang belum memenuhi syarat itu tetap tercantum di Formulir 4 sampai pemindahannya dicatat di SIMSA melalui modul Penyusutan. Pemindahan yang dilakukan di luar SIMSA, misalnya selama modul Penyusutan belum diaktifkan, tidak mengubah isi kedua formulir. Arsip yang sudah dimusnahkan atau diserahkan tidak tercantum di kedua formulir.

Arsip yang pemindahannya dilaksanakan melalui modul Penyusutan sebelum pembaruan siklus arsip pada September 2026 tetap tercantum di Formulir 6, walaupun batch pemindahannya belum dipulihkan dengan **Pulihkan kelanjutan retensi**. Alih media yang dilaksanakan sebelum pembaruan itu tidak mengakhiri siklus arsip, sehingga arsipnya tercantum di Formulir 4 atau Formulir 6 menurut aturan masa aktif di atas. Formulir 4 dan Formulir 6 yang dicetak dari modul Penyusutan mengikuti aturan yang sama dengan ekspor ini.

Arsip yang memiliki beberapa item dicetak **satu baris per item**:

- **Formulir 4**: item diurutkan menurut nomor item. Di Excel, kolom berkas (Nomor Berkas, Kode Klasifikasi, Uraian Informasi Berkas, Kurun Waktu, Jumlah berkas, Klasifikasi Keamanan, Keterangan) digabung menjadi satu sel per berkas, dan Jumlah berkas adalah jumlah dari semua itemnya. Di PDF, kolom berkas dicetak pada baris pertama tiap berkas dan diulang bila berkas bersambung ke halaman berikutnya; kaki tabel menulis *Total: N arsip, M item* bila jumlah baris berbeda dari jumlah arsip.
- **Formulir 6**: nomor urut bersambung per item. Kolom uraian berisi uraian item diikuti *(Berkas: uraian berkas)*. Tingkat perkembangan, jumlah, dan lokasi simpan diambil dari item; bila item kosong, dipakai data berkas.
- Arsip tanpa rincian item tetap dicetak satu baris dari data berkas.
- Arsip berkelas Terbatas, Rahasia, atau Sangat Rahasia selalu dicetak satu baris ringkasan berkas, tanpa rincian per item. Rincian itemnya hanya dapat dilihat di halaman detail arsip.

Bila belum ada arsip inaktif untuk filter yang dipilih, Formulir 6 tidak diunduh. Di bawah tombol muncul keterangan "Belum ada arsip inaktif untuk filter ini…".

---

## Melihat Detail Arsip

### Langkah 1: Buka Arsip

Pada baris arsip, klik menu tiga titik (⋯) lalu pilih **Detail Arsip**. Kamu juga dapat mengeklik uraian berkas untuk melihat pratinjau, lalu membuka detailnya dari sana.

### Langkah 2: Lihat Halaman Detail

:::tip Tampilan Detail Arsip
Halaman detail arsip menampilkan:
- **Header** dengan nomor berkas dan ringkasan: jumlah item, retensi, lokasi, dan keamanan
- **Tombol aksi**: **Ubah Metadata** dan **Rekonsiliasi Klasifikasi/JRA** (untuk admin yang berwenang atas unit arsip), **Lihat Surat Asli** (bila arsip berasal dari surat), dan **Cetak Detail**
- **6 tab**: Identifikasi, Item Arsip, Retensi & Lokasi, Jejak Aturan, Keamanan, dan Surat Asli
- **Kartu ringkasan**: Status Arsip, Bukti Aturan, Aksi Cepat, Retensi, Riwayat, dan Tunjuk Silang
:::

Bagi admin tersebut, kedua tombol pertama tetap tampil tetapi nonaktif, disertai alasannya, bila arsip tidak dapat diubah dengan akunnya. Untuk arsip berkelas Terbatas, Rahasia, atau Sangat Rahasia, keduanya hanya aktif bila persetujuan akses Anda atas arsip itu bermode **Tayang dan kelola**; persetujuan **Tayang saja** atau **Tayang dan unduh** hanya membuka arsip untuk dibaca. Rekonsiliasi juga dapat ditolak saat disimpan bila arsip sedang dalam penilaian JRA yang belum selesai.

### Tab di Halaman Detail:

| Tab | Isi |
|-----|-----|
| **Identifikasi** | Nomor berkas, klasifikasi, jenis arsip, uraian, kurun waktu, dan unit pengolah |
| **Item Arsip** | Daftar item dalam berkas |
| **Retensi & Lokasi** | Lokasi penyimpanan (Filing Cabinet, Laci, Folder, dan **Lokasi Simpan** bila sudah dipilih), JRA, masa retensi, **Status Penyusutan**, dan **Kemajuan Masa Aktif** |
| **Jejak Aturan** | Riwayat klasifikasi dan JRA yang pernah dipakai arsip ini |
| **Keamanan** | Bagian **Keamanan & Penanggung Jawab**: klasifikasi keamanan, Penanggung Jawab, dan keterangan |
| **Surat Asli** | Nomor, tanggal, dan perihal surat asal arsip |

Baris **Lokasi Simpan** menampilkan nama dari gedung sampai lokasi terpilih diikuti kodenya, misalnya *Gedung Arsip / Ruang Sentral / Rak Satu / Boks Dua (G1-R1-RAK1-B2)*.

### Kemajuan masa aktif

Bagian **Kemajuan Masa Aktif** pada tab **Retensi & Lokasi** baru tampil setelah peristiwa pemicu retensi dicatat dan diverifikasi petugas berbeda melalui **Tata Kelola Retensi**. Bagian ini menunjukkan berapa tahun masa aktif yang sudah berjalan dan menulis *Dihitung sejak tanggal pemicu retensi …*. Sebelum itu, isian retensi menulis *Menunggu verifikasi pemicu retensi*, atau *Menunggu rekonsiliasi klasifikasi dan JRA* bila aturan arsip lama belum dicocokkan melalui **Rekonsiliasi Klasifikasi/JRA**. Tanggal arsip saja tidak dipakai sebagai awal perhitungan.

### Jika Tampil "Perlu persetujuan akses"

Arsip berkelas Terbatas atau lebih tinggi yang belum boleh kamu buka menampilkan halaman **Perlu persetujuan akses**. Klik **Minta Akses** untuk mengajukan permohonan yang sudah terisi untuk arsip itu, lalu pantau statusnya di menu **Persetujuan Akses Arsip**. Bila tampil **Arsip Tidak Ditemukan**, arsip itu milik unit lain, di atas kewenangan kelas peran kamu, atau memang tidak ada.

---

## Mengubah Metadata Arsip

Bila ada data berkas yang salah catat, admin yang berwenang atas unit arsip dapat memperbaikinya dari halaman detail:

1. Klik **Ubah Metadata** di bagian atas halaman atau di kartu **Aksi Cepat**.
2. Perbaiki isian yang salah: Nomor Berkas, Unit Pengolah, Uraian Berkas, Kurun Waktu, Nomor Item, Tingkat Perkembangan, Uraian Item, Tanggal Arsip, Jumlah, Media, No. Filing Cabinet, No. Laci, No. Folder, Lokasi Simpan, Klasifikasi Keamanan, Penanggung Jawab, atau Keterangan.
3. Klik **Simpan**. Hanya isian yang diubah yang disimpan, dan perubahannya tercatat di log audit.

Bila arsip sudah diubah orang lain sejak dialog **Ubah Metadata Arsip** dibuka, penyimpanan ditolak dengan pesan *Data ini sudah diubah pengguna lain sejak Anda membukanya. Muat ulang halaman untuk melihat perubahan terbaru, lalu ulangi perubahan Anda.*

Kode klasifikasi arsip dan JRA tidak diubah di sini; gunakan **Rekonsiliasi Klasifikasi/JRA**. Tombol **Ubah Metadata** dikunci bila arsip sedang legal hold, sedang dalam proses penyusutan, atau penyusutannya sudah dilaksanakan.

### Lokasi Simpan

Pilihan **Lokasi Simpan** menautkan arsip ke gedung, ruang, rak, atau boks dari daftar di menu [Lokasi Simpan](../layanan-fisik/lokasi-simpan.md). Isian ini opsional (pilihan kosongnya **Belum ditentukan**) dan hanya tampil bagi pengguna unit pemilik arsip atau Super Admin. Isian No. Filing Cabinet, No. Laci, dan No. Folder tetap ada.

- Lokasi harus milik unit kerja arsip. Bila tidak, tampil pesan *Lokasi simpan tidak ditemukan atau bukan milik unit kerja arsip ini. Pilih lokasi simpan lain.*
- Selama arsip atau boksnya dipinjam, lokasi tidak dapat diubah atau dilepas: *Lokasi simpan tidak dapat diubah karena arsip atau boksnya sedang dipinjam. Catat pengembaliannya terlebih dahulu.* Isian lain tetap dapat disimpan.
- Arsip tidak dapat ditautkan ke boks yang sedang dipinjam: *Boks yang dipilih sedang dipinjam. Pilih lokasi simpan lain atau catat pengembalian boks terlebih dahulu.*

Perubahan lokasi simpan tercatat di log audit arsip.

### Daftar item ikut diperbarui

Arsip yang dicatat lewat **Arsipkan** pada surat masuk atau surat keluar memiliki daftar item di tab **Item Arsip**. Item pertama disalin menjadi ringkasan item berkas (Nomor Item, Uraian Item, Tingkat Perkembangan, Tanggal Arsip, dan lokasi). Saat perubahan disimpan:

- Bila Nomor Item, Uraian Item, Tingkat Perkembangan, Tanggal Arsip, atau lokasi diubah, item yang menjadi ringkasan itu disamakan dengan semua isian tersebut pada arsip, termasuk isian yang tidak diubah. Item tersebut dikenali bila berkas hanya berisi satu item, atau bila tepat satu item masih sama dengan ringkasan sebelum diubah (nomor, uraian, tingkat perkembangan, dan tanggal). Jadi pada berkas satu item, item itu ikut diselaraskan walaupun isinya, termasuk lokasinya, sempat berbeda dari ringkasan berkas.
- Bila lokasi diubah, item lain yang tersimpan di lokasi lama yang sama (No. Filing Cabinet, No. Laci, dan No. Folder ketiganya sama) ikut dipindahkan ke lokasi baru. Item di lokasi lain tidak berubah.
- Bila item ringkasan tidak dapat dikenali, misalnya dua item sama persis atau isinya sudah berbeda dari ringkasan, perubahan tetap disimpan pada arsip, tetapi tidak ada item yang diperlakukan sebagai ringkasan. Item yang berlokasi sama tetap ikut dipindahkan bila lokasi diubah.
- Jumlah dan Media hanya mengubah ringkasan berkas, tidak mengubah daftar item.
- Selama appraisal JRA atas arsip itu masih terbuka atau sedang ditelaah, perubahan Nomor Item, Uraian Item, Tingkat Perkembangan, Tanggal Arsip, atau lokasi pada arsip yang memiliki daftar item ditolak dengan pesan dari server. Selesaikan appraisal terlebih dahulu. Isian lain, misalnya Keterangan, tetap dapat diubah.

Perubahan pada item dicatat dalam entri log audit yang sama dengan perubahan arsip, dan tampil di halaman **Audit Log** di bawah rincian perubahan arsip pada bagian **Daftar Item Arsip**.

Untuk arsip berkelas Terbatas atau lebih tinggi, **Ubah Metadata** dan **Rekonsiliasi Klasifikasi/JRA** juga dikunci kecuali Anda memegang persetujuan akses bermode **Tayang dan kelola** atas arsip itu. Cara memperolehnya:

1. Bila Anda sudah memegang persetujuan **Tayang saja** atau **Tayang dan unduh** yang masih berlaku, permohonan baru akan ditolak. Minta Super Admin mencabut persetujuan itu, atau tunggu sampai masa berlakunya berakhir.
2. Buka halaman **Persetujuan Akses Rekod** (menu **Persetujuan Akses Arsip**), lalu ajukan akses untuk arsip itu dengan mode **Tayang dan kelola (tanpa unduh)** dan tujuan kedinasan yang jelas. Lihat [Persetujuan Akses](../administrasi/persetujuan-akses.md).
3. Setelah disetujui, buka kembali halaman detail arsip. Tombol aktif selama persetujuan masih berlaku.

Admin Unit Kerja hanya dapat memilih klasifikasi keamanan Biasa/Terbuka atau Terbatas; Rahasia dan Sangat Rahasia hanya dapat dipilih Super Admin. Kelas yang sudah tersimpan boleh dipertahankan. Bila kelas dinaikkan ke Terbatas atau lebih tinggi, arsip memerlukan persetujuan akses; pengubahnya pun mungkin perlu mengajukan persetujuan akses untuk membuka arsip itu lagi. Dalam keadaan itu tombol **Ubah Metadata** dan rekonsiliasi dikunci dengan alasan *Arsip kini berkelas Terbatas atau lebih tinggi dan memerlukan persetujuan akses sebelum dapat dibuka atau diubah kembali.*

---

## Mengarsipkan Surat

Kamu bisa mengarsipkan surat dari daftar surat (menu tiga titik ⋯, lalu **Arsipkan**) atau dari halaman detail surat masuk/keluar. Surat keluar baru dapat diarsipkan setelah [disetujui admin lain](../manajemen-surat/surat-keluar.md#persetujuan-internal-surat-keluar).

1. Klik **"Arsipkan"**. Dialog **Arsipkan Surat** terbuka.
2. Isi **Identifikasi Berkas**: Nomor Berkas, **Klasifikasi Arsip & Jadwal Retensi**, Uraian Informasi Berkas, Unit Pengolah, dan Kurun Waktu.
3. Isi **Detail Item Arsip**. Klik **Tambah Item** bila berkas berisi lebih dari satu item. Tiap item memiliki No. Filing Cabinet, No. Laci, dan No. Folder sendiri.
4. Bila perlu, pilih **Lokasi Simpan** (gedung, ruang, rak, atau boks). Daftarnya dikelola di menu Lokasi Simpan.
5. Pada bagian **Keamanan & Catatan Lain**, isi **Klasifikasi Keamanan**, **Penanggung Jawab**, dan **Keterangan Tambahan**.
6. Baca peringatan **Pengarsipan bersifat permanen.**, lalu centang *Saya memahami bahwa pengarsipan ini permanen dan tidak dapat dibatalkan.*
7. Klik **"Simpan Arsip"**.

> ⚠️ **Perhatian:** Setelah disimpan, surat terkunci: tidak dapat diubah atau dihapus, dan berkas PDF tidak dapat lagi ditambahkan dari halaman surat. Pengarsipan tidak dapat dibatalkan, dan arsip tidak dapat dihapus dari aplikasi. Lengkapi hasil pindai surat **sebelum** mengarsipkan.

Bila kotak pernyataan belum dicentang, tampil pesan *Centang pernyataan di atas sebelum menyimpan arsip.*

Isian dialog **Arsipkan Surat** yang belum disimpan disimpan sementara di tab peramban yang sama. Bila sesi berakhir atau halaman dimuat ulang, buka lagi dialog untuk surat yang sama lalu pilih **Pulihkan isian**. Tombol **Batal**, tombol tutup, atau tombol Esc membuang isian dialog.

Hal yang sama berlaku untuk **Impor CSV** arsip: dialognya menampilkan *Impor arsip bersifat permanen.* dan tombol **Impor data valid** baru aktif setelah kamu mencentang *Saya sudah memeriksa pratinjau dan memahami bahwa impor ini permanen.*

Ketentuan berkas **Impor CSV** arsip:

- Kolom utama: Nomor Berkas, Tanggal, Uraian, dan Jenis Arsip (`masuk` atau `keluar`). Beri setiap kolom judul yang berbeda.
- Pemisah kolom boleh koma, titik koma, atau tab, dan dibaca dari baris judul. Sebaiknya simpan sebagai "CSV UTF-8"; CSV biasa dari Excel juga dapat dibaca.
- Maksimal 1.000 rekod dan 4 MiB per berkas; pecah berkas besar sebelum diimpor.
- Tanggal ditulis dengan urutan hari, bulan, tahun, misalnya `03/11/2026`, `3-11-2026`, atau `3 November 2026`; penulisan `2026-11-03` juga diterima. Tanggal yang tidak dapat dibaca atau bertahun di luar 1920 sampai 2199 ditolak, tidak ditebak atau diganti dengan tanggal hari ini.
- Bila kolom wajib tidak ditemukan, pesan galat menyebut pemisah kolom yang terbaca agar judul kolom dapat diperiksa.

---

[⬅️ Sebelumnya: Distribusi Surat](../manajemen-surat/distribusi.md) | [Selanjutnya: Pemberkasan (Dosir) ➡️](dosir.md)
