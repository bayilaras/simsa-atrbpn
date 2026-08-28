---
title: Panduan Pengguna Lengkap SIMSA
description: Panduan operasional SIMSA untuk pengguna internal Ditjen PTPP
---

# Panduan Pengguna Lengkap SIMSA

Panduan ini membantu pegawai mempelajari **Sistem Informasi Manajemen Surat & Arsip (SIMSA)** mulai dari masuk ke aplikasi hingga pengelolaan retensi dan penyusutan. Gunakan panduan sesuai peran dan kewenangan Anda.

> **Batas penggunaan:** SIMSA adalah aplikasi internal/beta untuk membantu pengelolaan administrasi dan arsip di lingkungan Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan. Aplikasi ini bukan sertifikasi kepatuhan, bukan pengganti penetapan pejabat berwenang, dan bukan pengganti pemeriksaan Unit Kearsipan atau ketentuan hukum yang berlaku.

## 1. Akses cepat untuk pengguna baru

Alamat aplikasi: [https://simsa-frontend.vercel.app](https://simsa-frontend.vercel.app)

Sebelum mulai, pastikan Super Admin sudah:

- mendaftarkan alamat email kedinasan/Google Anda dengan ejaan yang tepat;
- menetapkan role dan unit kerja Anda; serta
- mengaktifkan akun Anda.

Alur belajar yang disarankan untuk hari pertama:

1. Masuk dengan Google menggunakan email yang telah didaftarkan.
2. Kenali Dashboard, sidebar, pencarian, notifikasi, dan menu pengguna.
3. Cari satu surat atau arsip contoh dan baca halaman detailnya.
4. Pelajari pekerjaan harian sesuai role pada bagian [alur per peran](#4-alur-belajar-berdasarkan-peran).
5. Coba input hanya pada data latihan yang disetujui admin.
6. Keluar dari aplikasi setelah selesai, terutama pada komputer bersama.

### Login Google internal

1. Buka alamat aplikasi.
2. Klik tombol **Masuk dengan Google** di bawah pemisah **atau**.
3. Pilih akun Google dengan email yang sama seperti akun yang diprovisi Super Admin.
4. Selesaikan autentikasi Google. Setelah berhasil, Anda kembali ke Dashboard SIMSA.

Login Google **tidak membuat akun baru secara otomatis**. Jika email belum diprovisi, salah penulisan, dinonaktifkan, atau belum diberi role, hubungi Super Admin. Form email dan password hanya digunakan untuk akun yang memang dikelola admin; aplikasi tidak menyediakan pendaftaran mandiri.

### Sesi dan keluar aplikasi

- Peringatan muncul setelah sekitar 25 menit tanpa aktivitas.
- Sesi berakhir otomatis setelah sekitar 30 menit tanpa aktivitas.
- Simpan pekerjaan sebelum meninggalkan halaman.
- Untuk keluar, klik avatar di kanan atas lalu pilih **Keluar**.

## 2. Navigasi dasar

### Sidebar

Menu dikelompokkan menjadi **Utama**, **Manajemen Surat**, **Siklus Hidup Arsip**, **Layanan & Fisik**, **Media & Autentikasi**, dan **Administrasi**. Menu yang muncul mengikuti role. Tidak munculnya sebuah menu biasanya berarti role Anda tidak memiliki akses, bukan kerusakan aplikasi.

- Klik ikon menu di kiri atas untuk membuka atau melipat sidebar.
- Menu dengan tanda panah memiliki sub-menu.
- Breadcrumb di atas isi halaman menunjukkan posisi Anda.
- Tautan **Panduan** di bagian bawah sidebar membuka pusat panduan di dalam aplikasi.

### Header

- **Pencarian:** mencari surat masuk, surat keluar, arsip, dan dosir.
- **Tema:** pilih terang, gelap, atau mengikuti sistem.
- **Notifikasi:** memisahkan notifikasi surat dan retensi; klik item untuk membuka rekod terkait.
- **Avatar:** melihat email/role dan keluar dari aplikasi.

### Pencarian global

1. Klik kotak/ikon pencarian pada header, atau tekan `Ctrl+K` di Windows/Linux dan `Command+K` di macOS.
2. Ketik minimal dua karakter dari nomor, perihal, uraian, atau kata kunci.
3. Klik hasil; pada keyboard gunakan panah atas/bawah lalu `Enter`.

Gunakan filter lokal pada halaman Surat, Arsip, Laporan, Peminjaman, atau Audit Log untuk hasil yang lebih spesifik. Hasil tetap dibatasi oleh role, unit kerja, klasifikasi keamanan, dan persetujuan akses Anda.

## 3. Role dan tanggung jawab

| Role | Penggunaan utama |
|---|---|
| **Belum aktif** | Hanya melihat Dashboard pemberitahuan aktivasi; minta admin menetapkan role dan unit kerja. |
| **Staf** | Melihat surat masuk/keluar dan arsip aktif, membuka detail yang diizinkan, mencari data, meminta akses rekod terkendali, serta melihat laporan. Tidak dapat mengubah data. |
| **Admin Dirjen** | Mengelola operasional surat, arsip, distribusi, dosir, klasifikasi/JRA, retensi, penyusutan, layanan fisik, media, laporan, dan tahapan tata kelola sesuai pemisahan tugas. |
| **Admin Sesditjen** | Kewenangan operasional setara Admin Dirjen, dengan lingkup unit kerja yang ditetapkan. |
| **Super Admin** | Seluruh kewenangan admin, pengelolaan pengguna dan pengaturan, keputusan akses, filter lintas unit, serta aktivasi versi aturan. |
| **Auditor** | Dashboard, Audit Log, Persetujuan Akses miliknya, Versi Aturan, dan Tata Kelola Retensi dalam mode pengawasan/baca-saja. |

Prinsip yang harus selalu dipakai:

- gunakan akun pribadi, bukan akun bersama;
- akses hanya data yang diperlukan untuk tugas;
- pencatat, penelaah, penyetuju, atau penerima harus berbeda bila sistem mensyaratkan pemisahan tugas;
- Super Admin dapat melihat lintas unit, sedangkan pengguna lain mengikuti unit dan cakupan aksesnya; dan
- role administratif tidak otomatis membuka bitstream berklasifikasi Terbatas, Rahasia, atau Sangat Rahasia.

## 4. Alur belajar berdasarkan peran

### Staf

1. Buka Dashboard dan baca notifikasi.
2. Pelajari daftar serta detail Surat Masuk dan Surat Keluar.
3. Gunakan pencarian global dan filter daftar.
4. Buka Arsip Aktif dan pahami tab Identifikasi, Item, Retensi, Jejak Aturan, Keamanan, dan Surat.
5. Gunakan Laporan sesuai lingkup akses.
6. Ajukan Persetujuan Akses jika rekod terkendali diperlukan untuk tugas.

### Admin surat

1. Registrasikan surat masuk/keluar dan periksa metadata.
2. Distribusikan surat masuk bila diperlukan.
3. Arsipkan surat yang prosesnya selesai.
4. Pilih klasifikasi dan butir JRA berdasarkan isi/fungsi, bukan hanya kemiripan kata.
5. Periksa kembali unit pengolah, keamanan, item, dan lokasi fisik.

### Arsiparis/admin kearsipan

1. Jaga master klasifikasi, JRA, dosir, dan lokasi simpan.
2. Catat peristiwa pemicu retensi beserta bukti.
3. Minta petugas berbeda memverifikasi bukti pemicu.
4. Gunakan appraisal untuk JRA manual, Dinilai Kembali, atau pengecualian komponen.
5. Terapkan legal hold bila ada sengketa, audit, pemeriksaan, atau kebutuhan lain yang sah.
6. Buat usulan penyusutan atau manifest permanen hanya setelah semua prasyarat terpenuhi.

### Reviewer/auditor

1. Periksa sumber, identitas rekod, alasan, bukti, checksum, tanggal, dan jejak pelaku.
2. Tolak atau kembalikan pekerjaan yang bukti/alasan belum memadai.
3. Jangan menelaah pekerjaan yang Anda buat sendiri.
4. Gunakan Audit Log dan jejak versi untuk menelusuri perubahan, bukan hanya tampilan terakhir.

### Super Admin

1. Provisi pengguna dengan email, role, unit kerja, jabatan, NIP, dan status yang tepat.
2. Tinjau akun tidak aktif serta perubahan personel secara berkala.
3. Kelola pengaturan dan versi aturan tanpa menghapus jejak lama.
4. Putuskan permohonan akses dengan asas kebutuhan minimum dan masa berlaku terbatas.
5. Pantau tab **Pengawasan** di Dashboard serta kegagalan operasional.

## 5. Dashboard dan notifikasi

Dashboard merangkum jumlah surat, arsip, tren bulanan, aktivitas terbaru, arsip yang mendekati batas retensi, dan widget pengelolaan arsip. Super Admin dapat memilih **Semua Unit Kerja** atau unit tertentu dan membuka tab **Pengawasan**.

Gunakan Dashboard sebagai daftar perhatian, bukan sebagai keputusan pemusnahan. Angka **Segera Musnah** atau indikator kedaluwarsa tetap harus diperiksa terhadap pemicu terverifikasi, JRA, appraisal, legal hold, dan workflow penyusutan.

Pada ikon lonceng:

- pilih tab **Surat**, **Arsip**, atau **Semua**;
- klik notifikasi untuk membuka rekod;
- tandai sudah dibaca setelah ditindaklanjuti; dan
- gunakan **Perbarui notifikasi** bila data baru belum tampak.

## 6. Surat masuk, surat keluar, dan distribusi

### Surat masuk

Untuk admin:

1. Buka **Surat > Surat Masuk** lalu klik **Tambah Surat Masuk**.
2. Isi nomor, tanggal surat, tanggal diterima, pengirim, tujuan/perihal, naskah atau sifat surat, klasifikasi, dan metadata lain yang tersedia.
3. Lampirkan dokumen bila diperlukan. PDF dianjurkan untuk salinan final.
4. Periksa nomor, tanggal, pengirim, perihal, unit, dan file sebelum menyimpan.
5. Buka detail untuk mengedit, membalas, mendistribusikan, atau mengarsipkan sesuai tombol dan kewenangan.

### Surat keluar

1. Buka **Surat > Surat Keluar** lalu klik **Tambah Surat Keluar**.
2. Isi jenis naskah dinas, nomor, tanggal, tujuan, perihal, klasifikasi, serta dokumen final.
3. Untuk membalas surat masuk, buka detail surat masuk dan pilih **Balas Surat** agar referensi asal tetap terhubung.
4. Simpan surat sebagai draft, lalu buka halaman detail dan periksa seluruh metadata.
5. Klik **Ajukan Persetujuan**, pilih administrator aktif lain sebagai penyetuju, isi catatan bila perlu, lalu kirim.
6. Penyetuju yang ditunjuk membuka antrean atau detail surat dan memilih **Setujui** atau **Tolak**. Alasan wajib diisi saat menolak.
7. Surat yang ditolak dapat diperbaiki dan diajukan ulang. Surat yang telah disetujui final dapat diarsipkan melalui halaman detail.

Pembuat tidak dapat menyetujui suratnya sendiri. Selama status **Menunggu Persetujuan** atau **Disetujui**, surat terkunci dari edit dan hapus; surat belum dapat diarsipkan sebelum persetujuan final. Seluruh pengajuan, keputusan, catatan, dan pelaku tampil pada riwayat. Ini adalah persetujuan proses internal, bukan tanda tangan elektronik, serta tidak menggunakan BSrE/PSrE.

### Distribusi

1. Buka detail surat masuk dan pilih **Distribusikan**.
2. Pilih unit kerja tujuan dan tulis catatan yang menjelaskan tindak lanjut.
3. Periksa Inbox **Distribusi** untuk kiriman masuk dan riwayat kiriman keluar.

Jangan menghapus surat hanya untuk memperbaiki kesalahan kecil. Gunakan fungsi edit/koreksi yang tersedia agar jejak aktivitas tetap dapat ditelusuri. Penghapusan hanya dilakukan oleh petugas berwenang setelah memastikan dampaknya.

### Unggah massal dan OCR PDF

Untuk menyiapkan beberapa draft arsip dari PDF sekaligus:

1. Buka **Unggah Massal & OCR** dari Dashboard.
2. Pilih satu unit kerja yang konkret. Super Admin juga wajib memilih unit tujuan sebelum unggah.
3. Pilih atau seret PDF, maksimal 50 berkas, 50 MiB per berkas, dan 100 MiB per batch.
4. Klik **Mulai unggah** dan tunggu sampai pemrosesan selesai. PDF yang memiliki text layer dibaca langsung; PDF hasil pindai dirender lalu dikenali dengan OCR Bahasa Indonesia dan Inggris.
5. Tinjau dan koreksi nomor surat, tanggal, pengirim, perihal, serta metadata lain pada setiap hasil. Jangan menganggap hasil OCR sebagai salinan yang pasti benar.
6. Konfirmasi hanya item yang sudah diperiksa. Batch yang belum selesai disimpan agar dapat dipulihkan, sedangkan item gagal harus diperiksa dari pesan kesalahannya.

OCR PDF hasil pindai dibatasi maksimal 10 halaman dan dapat gagal bila citra terlalu besar, teks tidak cukup terbaca, model bahasa tidak tersedia, atau waktu proses habis. Kegagalan tersebut tidak membuat metadata pengganti secara otomatis.

## 7. Membuat dan mengelola arsip

### Mengarsipkan surat

1. Buka detail surat yang telah selesai diproses lalu klik **Arsipkan**.
2. Periksa atau isi **Nomor Berkas**.
3. Pilih **Klasifikasi Arsip & Jadwal Retensi**. Pilih klasifikasi dahulu, kemudian butir JRA yang sesuai.
4. Baca pratinjau retensi aktif, retensi inaktif, hasil JRA, versi, dan referensi.
5. Isi uraian berkas, unit pengolah, kurun waktu, item arsip, tingkat perkembangan, tanggal, jumlah, dan lokasi fisik.
6. Tetapkan klasifikasi keamanan dan PIC.
7. Periksa ulang lalu simpan.

Saran JRA dari aplikasi membantu pencarian, tetapi **bukan keputusan otomatis**. Petugas tetap menilai isi, fungsi, konteks, dan rumusan pemicu. Pemicu retensi juga tidak ditetapkan pada dialog registrasi; catat setelah arsip dibuat melalui **Tata Kelola Retensi**.

### Daftar dan detail arsip

- **Arsip Surat Masuk/Keluar:** gunakan pencarian, tahun, filter lanjutan, unit (jika berwenang), dan pagination.
- **Tab Retensi:** menampilkan informasi dan kemajuan masa simpan berdasarkan data otoritatif.
- **Tab Jejak Aturan:** menunjukkan versi klasifikasi/JRA dan revisi yang pernah dipakai.
- **Tab Keamanan:** menunjukkan klasifikasi keamanan dan kontrol akses.
- **Tab Surat:** menghubungkan arsip dengan surat sumber.

Arsip lama berstatus aturan belum terverifikasi dapat dibaca tetapi tidak boleh masuk penyusutan. Admin dapat memilih **Rekonsiliasi Klasifikasi/JRA**, memilih aturan aktif, dan mengisi alasan yang spesifik. Rekonsiliasi tidak tersedia bila arsip sedang legal hold, berada dalam workflow penyusutan, atau sudah dieksekusi.

### Dosir dan lokasi fisik

- Gunakan **Pemberkasan (Dosir)** untuk menghimpun arsip yang berhubungan dalam satu berkas/kegiatan.
- Gunakan **Lokasi Simpan** untuk menjaga kode ruang, rak/lemari, laci, folder, atau box tetap konsisten.
- Cocokkan lokasi di sistem dengan label fisik saat menyimpan, meminjamkan, memindahkan, dan mengembalikan arsip.

## 8. Klasifikasi arsip dan JRA

### Memilih butir yang benar

1. Baca uraian kegiatan dan isi berkas, bukan hanya judul surat.
2. Pilih kode klasifikasi paling spesifik yang tersedia.
3. Periksa butir JRA, retensi aktif/inaktif, keterangan hasil, dan pemicu waktunya.
4. Bila rumusan bersyarat atau tidak cukup jelas, gunakan **Dinilai Kembali** dan appraisal; jangan memaksakan Musnah/Permanen.
5. Simpan bukti dan alasan bila dilakukan rekonsiliasi atau pengecualian.

### Mengubah aturan saat peraturan berubah

Versi aktif tidak diedit langsung. Alur yang benar:

1. Super Admin membuka **Master Data > Versi Aturan** dan membuat draft revisi dari versi aktif.
2. Lengkapi identitas versi, tanggal berlaku, dasar hukum, URL sumber resmi, dan PDF sumber.
3. Sistem menghitung informasi dokumen sumber dan SHA-256; jangan mengganti bukti itu dengan nilai yang diketik sendiri.
4. Edit/impor isi draft, isi manifest kelengkapan halaman, periksa perbedaan dan dampak.
5. Jalankan validasi sampai tidak ada kesalahan.
6. Laksanakan tahapan **Ajukan > Telaah > Setujui > Aktifkan** dengan akun berbeda sesuai pemisahan tugas.
7. Setelah aktif, aturan lama tetap melekat pada arsip lama; jangan melakukan perubahan massal tanpa rekonsiliasi yang dapat diaudit.

Auditor dapat membaca versi, PDF sumber yang tersedia, validasi, dan jejak audit. Aktivasi versi hanya dilakukan Super Admin.

## 9. Retensi, appraisal, pemicu, dan legal hold

### Manajemen Retensi

Halaman **Manajemen Retensi** menampilkan ringkasan arsip yang akan/sudah inaktif atau kedaluwarsa serta kandidat berdasarkan hasil Musnah, Permanen, atau Dinilai Kembali. Arsip tanpa pemicu terverifikasi dan arsip yang terkena legal hold dikeluarkan dari kandidat.

Untuk menerapkan atau melepas legal hold:

1. Pilih arsip pada Manajemen Retensi.
2. Pilih tindakan legal hold/pelepasan.
3. Tulis alasan substantif sesuai penugasan atau dasar yang berlaku.
4. Simpan dan pastikan status tercatat.

Jangan melepas legal hold hanya agar arsip muncul sebagai kandidat penyusutan.

### Appraisal

Pada **Tata Kelola Retensi > Appraisal**:

1. Klik **Buat appraisal**.
2. Pilih arsip dan jenis kasus: **JRA manual**, **Dinilai Kembali**, atau **Pengecualian komponen**.
3. Isi alasan, usulan hasil, pertimbangan, dan keputusan komponen bila diperlukan.
4. Simpan kasus, buka detail, lalu tambahkan sedikitnya satu bukti pendukung.
5. Ajukan untuk telaah.
6. Reviewer yang berbeda memeriksa bukti dan memberi alasan sebelum menyetujui/menolak.

Hasil **Musnah** hanya menyatakan arsip layak diajukan ke proses berikutnya. Tidak ada penghapusan otomatis.

### Pemicu retensi

Pada **Tata Kelola Retensi > Pemicu Retensi**:

1. Klik **Catat peristiwa**.
2. Pilih arsip, jenis peristiwa, tanggal, label, dan bukti yang dapat ditelusuri.
3. Simpan; status awal menunggu verifikasi.
4. Petugas berbeda memeriksa dokumen dan checksum lalu memilih hasil verifikasi.
5. Gunakan **Riwayat** untuk melihat revisi dan pemicu aktif.

Jenis peristiwa yang tersedia mencakup kegiatan selesai, berkas ditutup, serah terima, penetapan, atau lainnya. Jika salah, gunakan **Koreksi** dengan alasan; jangan menghapus riwayat lama.

## 10. Penyusutan dan penyerahan permanen

### Pemindahan, pemusnahan, dan alih media

Pada menu **Penyusutan**:

1. Pilih tab **Pemindahan**, **Pemusnahan**, atau **Alih Media**.
2. Klik **Buat Usulan**, pilih kandidat, dan isi keterangan.
3. Periksa daftar arsip di dalam batch.
4. Majukan status secara tertib: **Draft > Diusulkan > Ditinjau > Disetujui > Dilaksanakan**.
5. Gunakan akun/pejabat berbeda pada tahap pemeriksaan jika diwajibkan.
6. Cetak daftar usul atau berita acara pada tahap yang tersedia.

Kandidat dapat tidak muncul karena retensi belum jatuh tempo, pemicu belum terverifikasi, keputusan belum efektif, aturan lama belum direkonsiliasi, legal hold aktif, arsip sedang direservasi workflow lain, atau penyusutan sudah selesai.

Tab **Penyerahan (Riwayat)** hanya untuk membaca/mencetak batch lama. Penyerahan baru memakai manifest terkontrol.

### Manifest penyerahan permanen

Pada **Tata Kelola Retensi > Penyerahan Permanen**:

1. Pastikan setiap arsip memiliki keputusan appraisal **Permanen** yang disetujui.
2. Pastikan objek digital/lampiran sudah bersih dan pemeriksaan fixity berhasil.
3. Klik **Buat manifest**, isi nomor, tujuan, keterangan, arsip, keputusan appraisal, dan objek digital terverifikasi.
4. Buka detail manifest dan catat **Serah terima** beserta waktu, nomor referensi, pihak penerima, serta berita acara terverifikasi.
5. Pejabat berbeda mencatat **Penerimaan**. Tahap ini memfinalkan penyerahan.

Sebelum serah terima, manifest dapat diajukan untuk pembatalan dengan alasan. Reviewer berbeda menyetujui atau menolak. Manifest dan riwayat pembatalan tidak dihapus; bila disetujui, buat **manifest pengganti** agar hubungan riwayat tetap jelas.

## 11. Peminjaman dan layanan arsip

### Peminjaman fisik

1. Buka **Layanan & Fisik > Peminjaman** lalu klik **Catat Peminjaman**.
2. Pilih tipe **Per Arsip** atau **Per Box**.
3. Cari arsip/lokasi dengan minimal tiga karakter dan pilih hasil yang benar.
4. Isi nama peminjam, unit kerja, tanggal jatuh tempo, dan tujuan.
5. Simpan, lalu cek tab **Sedang Dipinjam** atau **Terlambat**.
6. Gunakan **Perpanjang** untuk mengubah jatuh tempo atau **Kembalikan** untuk mencatat pengembalian dan kondisi/catatan.

Fitur ini mencatat sirkulasi secara langsung; pastikan kewenangan peminjaman telah diperiksa di luar aplikasi bila prosedur unit mensyaratkannya. Cocokkan arsip/box fisik sebelum menyerahkan dan saat menerima kembali.

### Fitur layanan lainnya

- **Layanan Arsip:** catat dan pantau permintaan layanan internal.
- **Arsip Vital / Arsip Terjaga:** tandai dan kelola arsip yang memerlukan perlindungan khusus sesuai kewenangan.
- **Arsip Elektronik:** kelola media digital dan metadata teknis.
- **Autentikasi:** catat proses autentikasi arsip.
- **Tunjuk Silang:** hubungkan rekod yang berkaitan tanpa menggandakan arsip.
- **Formulir:** galeri ini berisi format referensi kosong. Untuk dokumen berbasis data, gunakan tombol cetak/unduh pada modul Peminjaman, Penyusutan, Arsip Vital/Terjaga, atau Laporan agar isi berasal dari rekod aplikasi.

## 12. Persetujuan akses rekod terkendali

Untuk Terbatas, Rahasia, atau Sangat Rahasia, role admin tidak otomatis memberikan hak melihat/unduh.

1. Buka **Administrasi > Persetujuan Akses**.
2. Klik **Minta akses**.
3. Pilih jenis rekod, masukkan UUID rekod, dan pilih mode minimum: tayang, tayang dan unduh, atau tayang dan kelola.
4. Jelaskan kebutuhan kedinasan secara spesifik lalu kirim.
5. Pantau status pada **Permohonan Saya**.

Khusus Super Admin, tab **Perlu Keputusan** digunakan untuk menyetujui/menolak, menetapkan masa berlaku, atau mencabut akses. Pemohon tidak boleh menyetujui permohonannya sendiri. Persetujuan di SIMSA tidak menggantikan clearance, surat tugas, atau kewenangan pejabat.

## 13. Laporan dan Audit Log

### Laporan

1. Buka **Administrasi > Laporan**.
2. Pilih tahun/rentang tanggal lalu klik **Tampilkan Data**.
3. Gunakan tab **Ringkasan**, **Surat Masuk**, **Surat Keluar**, **Arsip**, atau **Peminjaman**.
4. Pada tab yang menyediakan ekspor, pilih Excel atau PDF.
5. Periksa periode, unit, jumlah baris, dan filter sebelum menggunakan hasil.

File ekspor adalah salinan kerja. Lindungi, batasi distribusi, dan hapus salinan lokal sesuai kebijakan setelah tidak diperlukan.

### Audit Log

Admin dan Auditor membuka **Administrasi > Audit Log** untuk:

- mencari pengguna/email/ID;
- memfilter tipe entitas dan aksi;
- memeriksa waktu, pelaku, rekod, IP, dan rincian perubahan yang tersedia; serta
- menelusuri urutan kejadian bersama jejak aturan, appraisal, pemicu, atau manifest.

Audit Log bukan alasan untuk membagikan informasi sensitif. Ekspor atau tangkapan layar audit hanya diberikan kepada pihak berwenang.

## 14. Pengelolaan pengguna dan administrasi

Khusus Super Admin:

1. Buka **Manajemen Pengguna** dan klik **Tambah Pengguna**.
2. Isi email yang tepat, nama, role, unit kerja, jabatan, NIP, dan kredensial bila digunakan.
3. Untuk Google, email yang diprovisi harus sama dengan akun Google pengguna.
4. Gunakan edit untuk mengubah role, unit, jabatan, NIP, atau status.
5. Nonaktifkan akun segera saat pegawai mutasi/berhenti atau akses tidak lagi diperlukan.
6. Hindari menghapus akun yang memiliki histori; nonaktifkan bila tujuan utamanya menghentikan akses.

Gunakan **Pengaturan** untuk konfigurasi yang memang tersedia bagi Super Admin, termasuk unit kerja atau templat. Uji perubahan pada data yang aman sebelum digunakan secara luas.

## 15. Panduan penggunaan pada ponsel/tablet

- Gunakan browser versi terbaru dan orientasi potret untuk daftar/form sederhana.
- Ketuk ikon menu di kiri atas untuk membuka sidebar.
- Pencarian tampil sebagai ikon kaca pembesar pada layar sempit.
- Tabel responsif dapat berubah menjadi kartu/baris bertumpuk; baca label setiap nilai sebelum menekan tindakan.
- Geser tab secara horizontal jika semua tab belum terlihat.
- Tutup keyboard layar agar tombol dialog bagian bawah terlihat.
- Untuk impor massal, penelaahan aturan, appraisal kompleks, dan manifest permanen, gunakan layar desktop/laptop agar semua bukti mudah dibandingkan.
- Jangan mengunduh rekod sensitif ke ponsel pribadi atau perangkat yang tidak dikelola organisasi.
- Saat indikator **offline** muncul, jangan mengisi atau mengirim form. Data arsip sensitif tidak disimpan untuk penggunaan offline; tunggu koneksi pulih lalu muat ulang.

## 16. Keamanan penggunaan

- Jangan membagikan password, OTP, tautan autentikasi, atau sesi browser.
- Pastikan domain aplikasi benar sebelum masuk.
- Gunakan klasifikasi keamanan yang sesuai dan asas need-to-know.
- Jangan mengunggah file yang tidak berhubungan dengan pekerjaan.
- File umum dibatasi maksimum 10 MiB dan isi file diperiksa terhadap jenis yang dinyatakan. PDF, Word, Excel, JPG, PNG, dan GIF didukung pada alur lampiran umum; tampilan form tertentu dapat membatasi lebih ketat.
- Lampiran tetap dikarantina sampai pemeriksaan keamanan menyatakan bersih. Bila terlalu lama, jangan mengunggah berulang-ulang; laporkan kepada admin.
- Penghapusan langsung bitstream/lampiran dinonaktifkan. Gunakan workflow penyusutan yang menjaga persetujuan dan bukti.
- Keluar setelah bekerja di komputer bersama dan jangan menyimpan password di browser publik.
- Laporkan salah akses, file mencurigakan, kehilangan perangkat, atau aktivitas tidak dikenal secepatnya.

## 17. Pemecahan masalah

| Gejala | Pemeriksaan dan tindakan |
|---|---|
| Tombol **Masuk dengan Google** kembali ke login/gagal | Pastikan akun Google yang dipilih sama dengan email yang diprovisi. Coba jendela privat, izinkan cookie/redirect untuk domain aplikasi, lalu hubungi Super Admin bila tetap gagal. |
| Berhasil login tetapi menu sangat sedikit | Role atau unit kerja belum ditetapkan/diaktifkan. Lihat role pada menu avatar dan hubungi Super Admin. |
| Menu tertentu tidak ada atau kembali ke Dashboard | Role tidak memiliki kewenangan atau fitur dinonaktifkan pada profil internal. Jangan mencoba memakai URL langsung. |
| Sesi tiba-tiba berakhir | Kemungkinan idle sekitar 30 menit atau sesi tidak valid. Masuk kembali dan periksa apakah perubahan terakhir sudah tersimpan. |
| Pencarian tidak menemukan data | Ketik minimal dua karakter, periksa ejaan/filter/unit, lalu cari melalui daftar khusus. Data terkendali tetap tersembunyi tanpa akses. |
| Unggah ditolak | Periksa ukuran maksimum, ekstensi, jenis MIME, isi file, dan apakah file rusak. Simpan ulang dari aplikasi sumber bila perlu. |
| File ada tetapi tidak dapat dibuka | File mungkin masih dikarantina, terdeteksi bermasalah, atau memerlukan persetujuan akses. Hubungi admin dengan ID rekod dan waktu unggah, tanpa mengirim file lewat kanal pribadi. |
| Arsip tidak masuk kandidat penyusutan | Periksa jatuh tempo, pemicu terverifikasi, keputusan appraisal, legal hold, provenance versi aturan, reservasi manifest, dan batch aktif. |
| Tidak dapat menelaah/menyetujui | Sistem mencegah self-review. Minta akun pejabat lain yang berwenang melakukan tahap tersebut. |
| Manifest permanen tidak dapat dibuat | Pastikan keputusan Permanen telah disetujui serta objek digital bersih dan lolos fixity; pastikan arsip belum direservasi/dieksekusi. |
| Data tampak tidak sesuai | Muat ulang sekali, catat URL/ID rekod, waktu, langkah, pesan kesalahan, dan tangkapan layar yang tidak membocorkan data; kirim ke admin. |
| Indikator offline muncul | Hentikan input, tunggu koneksi pulih, kemudian muat ulang. SIMSA tidak menyimpan data arsip untuk kerja offline. |

Saat melapor, sertakan role, unit kerja, waktu kejadian, halaman/menu, ID atau nomor rekod, langkah sebelum error, dan teks pesan error. Jangan mengirim password, OTP, token, atau seluruh dokumen sensitif.

## 18. Glosarium singkat

| Istilah | Arti dalam aplikasi |
|---|---|
| **Arsip aktif** | Arsip yang masih digunakan langsung dalam kegiatan unit pengolah. |
| **Arsip inaktif** | Arsip yang frekuensi penggunaannya menurun dan dikelola sesuai retensi/lokasi. |
| **Klasifikasi arsip** | Pengelompokan arsip berdasarkan fungsi/kegiatan dengan kode dan uraian. |
| **JRA** | Jadwal Retensi Arsip: masa aktif, masa inaktif, pemicu, dan keterangan tindak lanjut. |
| **Pemicu retensi** | Peristiwa terverifikasi yang menjadi titik mulai perhitungan retensi. |
| **Appraisal** | Penilaian manusia yang terdokumentasi untuk menentukan keputusan arsip. |
| **Dinilai Kembali** | Keputusan sementara saat hasil akhir memerlukan penilaian kontekstual lebih lanjut. |
| **Legal hold** | Penangguhan penyusutan karena kebutuhan hukum, audit, pemeriksaan, atau dasar sah lainnya. |
| **Penyusutan** | Pemindahan, pemusnahan, penyerahan, atau tindakan lain yang mengurangi/mengatur volume sesuai proses berwenang. |
| **Manifest permanen** | Daftar terkontrol arsip permanen, objek digital, checksum, dan peristiwa serah terima/penerimaan. |
| **Checksum/SHA-256** | Sidik digital untuk membantu membuktikan apakah isi file berubah. |
| **Fixity** | Pemeriksaan konsistensi bitstream terhadap checksum yang dipercaya. |
| **Maker-checker** | Pemisahan pelaku pembuat/pengaju dari penelaah/penyetuju. |
| **Provenance/jejak aturan** | Bukti versi klasifikasi/JRA dan revisi yang menjadi dasar keputusan arsip. |
| **Rekonsiliasi** | Penetapan ulang yang terdokumentasi untuk menghubungkan arsip lama dengan aturan aktif tanpa menghapus histori. |
| **Dosir** | Himpunan arsip yang berhubungan dengan urusan, kegiatan, atau subjek tertentu. |
| **Tunjuk silang** | Hubungan referensial antarrekod tanpa membuat salinan baru. |

## 19. Checklist operasional

### Sebelum menyimpan surat/arsip

- [ ] Nomor, tanggal, perihal, pihak, dan unit kerja benar.
- [ ] Klasifikasi dipilih berdasarkan fungsi dan isi.
- [ ] Butir JRA dan rumusan pemicu sudah dibaca.
- [ ] Item, jumlah, kurun waktu, serta lokasi fisik cocok.
- [ ] Klasifikasi keamanan dan PIC sudah tepat.
- [ ] Lampiran dapat dibuka, merupakan versi final, dan tidak berisi file yang tidak perlu.

### Sebelum appraisal atau verifikasi pemicu

- [ ] Identitas arsip dan versi aturan benar.
- [ ] Alasan spesifik, tidak sekadar “sesuai”.
- [ ] Bukti dapat ditelusuri dan checksum tersedia bila diminta.
- [ ] Tidak ada legal hold yang terlewat.
- [ ] Reviewer berbeda dari pencatat/assessor.

### Sebelum penyusutan atau penyerahan

- [ ] Retensi dan pemicu sudah efektif/terverifikasi.
- [ ] Keputusan appraisal final tersedia jika diperlukan.
- [ ] Legal hold tidak aktif.
- [ ] Daftar arsip dan komponen diperiksa satu per satu.
- [ ] Persetujuan dan berita acara lengkap.
- [ ] Untuk permanen, objek digital bersih, fixity valid, dan penerima berbeda dari pencatat serah terima.
- [ ] Salinan laporan/manifest disimpan dan didistribusikan sesuai klasifikasi akses.

## 20. Kontak bantuan

Jika mengalami kendala, hubungi **Super Admin SIMSA** atau **admin kearsipan unit kerja** melalui kanal resmi internal yang ditetapkan organisasi. Kanal kontak tidak dicantumkan di panduan publik agar tetap mudah diperbarui dan tidak mengekspos kontak pribadi.

Saat meminta bantuan, sertakan halaman/menu, waktu kejadian, role dan unit kerja, ID rekod bila ada, langkah sebelum masalah, serta teks pesan kesalahan. Jangan mengirim kata sandi, OTP, token, atau dokumen sensitif melalui kanal bantuan umum.
