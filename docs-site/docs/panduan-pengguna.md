---
title: Panduan Pengguna Lengkap SIMSA
sidebar_label: Panduan Lengkap
description: Panduan operasional SIMSA untuk pengguna internal Ditjen PTPP
slug: /panduan-pengguna
toc_max_heading_level: 3
---

# Panduan Pengguna Lengkap SIMSA

Panduan ini membantu pegawai mempelajari **Sistem Informasi Manajemen Surat & Arsip (SIMSA)** mulai dari masuk ke aplikasi hingga pengelolaan retensi dan penyusutan. Gunakan panduan sesuai peran dan kewenangan Anda.

> **Batas penggunaan:** SIMSA adalah aplikasi internal/beta untuk membantu pengelolaan administrasi dan arsip di lingkungan Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan. Aplikasi ini bukan sertifikasi kepatuhan, bukan pengganti penetapan pejabat berwenang, dan bukan pengganti pemeriksaan Unit Kearsipan atau ketentuan hukum yang berlaku.

Ringkasan perubahan terbaru ada di [Perubahan November 2026](./perubahan-november-2026.md).

## 1. Akses cepat untuk pengguna baru

Untuk langkah praktis pertama, ikuti [Mulai Inventaris Internal](./mulai-inventaris-internal.md). Buka SIMSA di browser pada `https://simsa-frontend.vercel.app`.

Sebelum mulai, pastikan Super Admin sudah:

- mendaftarkan alamat email Anda dengan ejaan yang tepat dan menyiapkan kata sandi untuk login email;
- menetapkan role dan unit kerja Anda; serta
- mengaktifkan akun Anda.

Alur belajar yang disarankan untuk hari pertama:

1. Masuk dengan email dan kata sandi akun pribadi yang telah didaftarkan.
2. Kenali Dashboard, sidebar, pencarian, notifikasi, dan menu pengguna.
3. Cari satu surat atau arsip contoh dan baca halaman detailnya.
4. Pelajari pekerjaan harian sesuai role pada bagian [alur per peran](#4-alur-belajar-berdasarkan-peran).
5. Admin mencatat metadata atau mengimpor daftar pada unit yang benar, lalu mencari dan memeriksa hasilnya. Untuk latihan, gunakan data latihan yang ditetapkan operator.
6. Keluar dari aplikasi setelah selesai, terutama pada komputer bersama.

### Login email dan kata sandi

1. Buka alamat aplikasi yang diberikan operator.
2. Isi **Email kedinasan** dan **Kata sandi**, lalu klik **Masuk**.
3. Setelah masuk, periksa peran dan unit kerja Anda sebelum mencatat data.

Aplikasi tidak menyediakan pendaftaran mandiri dengan email dan kata sandi. Super Admin membuat akun melalui **Administrasi → Manajemen Pengguna → Tambah Pengguna**. Jangan membagikan akun uji untuk pekerjaan resmi. Bila lupa kata sandi, minta Super Admin mengatur ulangnya, lalu ganti kata sandi itu di **Pengaturan → Profil → Ubah Kata Sandi**. **Pengaturan** dibuka dari menu akun di kanan atas atau dari sidebar. Kata sandi baru minimal 12 karakter, tidak memuat nama atau bagian depan email Anda, dan bukan kata sandi yang umum; kata sandi lama tetap dapat dipakai untuk masuk sampai diganti.

### Login Google bila tersedia

1. Buka alamat aplikasi.
2. Klik tombol **Masuk dengan Google** di bawah pemisah **atau**.
3. Pilih akun Google dengan email yang sama seperti akun yang diprovisi Super Admin.
4. Selesaikan autentikasi Google. Setelah berhasil, Anda kembali ke Dashboard SIMSA.

Login Google hanya digunakan ketika integrasinya sudah dikonfigurasi. Email Google yang belum terdaftar menjadi akun **Menunggu persetujuan** tanpa akses data sampai Super Admin menetapkan peran dan unit kerjanya; setelah disetujui, masuk kembali. Jika akun dinonaktifkan atau peran/unitnya belum benar, hubungi Super Admin.

Bila masuk dengan Google ditolak, halaman masuk menampilkan sebabnya:

| Pesan | Artinya |
|---|---|
| *Akun Anda tidak aktif atau belum disetujui. Hubungi Super Admin.* | Akun dinonaktifkan atau masih menunggu persetujuan. |
| *Email akun Google Anda belum terverifikasi. …* | Verifikasi email itu di akun Google, lalu coba lagi. |
| *Akun Google ini belum terdaftar di SIMSA. Minta Super Admin mendaftarkan akun Anda.* | Pendaftaran akun Google baru tidak dibuka; Super Admin perlu membuat akun dengan email itu. |
| *Masuk dengan Google gagal. …* | Sebab lain; coba lagi atau hubungi Super Admin. |

### Sesi dan keluar aplikasi

- Setelah 25 menit tanpa aktivitas muncul peringatan *Sesi Anda akan berakhir dalam 5 menit karena tidak ada aktivitas.* Klik **Tetap Masuk** untuk melanjutkan atau **Keluar Sekarang** untuk keluar.
- Setelah 30 menit tanpa aktivitas, SIMSA keluar otomatis. Halaman masuk lalu menampilkan *Sesi berakhir karena tidak ada aktivitas. Silakan masuk kembali.*
- Isian formulir **Tambah/Edit Surat Masuk**, **Tambah/Edit Surat Keluar** (termasuk surat inisiatif), dan dialog **Arsipkan Surat** yang belum disimpan disimpan sementara di tab peramban yang sama. Penanda *Isian tersimpan sementara di tab ini* tampil di dekat tombol simpan.
- Setelah masuk kembali atau memuat ulang halaman di tab yang sama, buka lagi formulir atau dialog itu. SIMSA menanyakan *Pulihkan isian yang belum disimpan?*; pilih **Pulihkan isian** untuk melanjutkan atau **Buang isian** untuk mulai dari kosong. Berkas PDF yang sudah dipilih tidak ikut tersimpan dan perlu dipilih ulang.
- Isian sementara hilang bila tab ditutup, bila Anda menekan **Keluar**, **Batal**, atau **Tinggalkan halaman**, dan setelah surat atau arsip tersimpan. Isian yang lebih lama dari 12 jam tidak ditawarkan lagi. Tetap simpan pekerjaan sebelum meninggalkan komputer.
- Bila Anda berpindah halaman saat formulir masih berisi perubahan, SIMSA bertanya *Tinggalkan halaman ini?*; pilih **Tetap di halaman** untuk kembali ke formulir.
- Bila muncul *Versi baru SIMSA tersedia. Simpan pekerjaan Anda, lalu muat ulang.*, simpan pekerjaan lalu klik **Muat ulang**, atau **Nanti** untuk menunda. Halaman tidak dimuat ulang sendiri selama formulir surat atau dialog Arsipkan masih berisi isian yang belum disimpan.
- Untuk keluar, klik avatar di kanan atas lalu pilih **Keluar**.

## 2. Navigasi dasar

### Sidebar

Menu dikelompokkan menjadi **Utama**, **Manajemen Surat**, **Siklus Hidup Arsip**, **Layanan & Fisik**, **Media & Autentikasi**, dan **Administrasi**. Menu yang muncul mengikuti role. Tidak munculnya sebuah menu biasanya berarti role Anda tidak memiliki akses, bukan kerusakan aplikasi.

- Klik ikon menu di kiri atas untuk membuka atau melipat sidebar.
- Menu dengan tanda panah memiliki sub-menu.
- Breadcrumb di atas isi halaman menunjukkan posisi Anda.
- Tautan **Panduan** di bagian bawah sidebar membuka pusat panduan di dalam aplikasi.

### Header

- **Unit kerja:** nama unit kerja akun Anda tampil di sebelah kiri kotak pencarian (pada layar yang cukup lebar).
- **Pencarian:** mencari surat masuk, surat keluar, arsip, dan dosir.
- **Atur tampilan:** pilih tema **Terang**, **Gelap**, atau **Ikuti perangkat**, serta **Ukuran teks** **Standar** atau **Besar**.
- **Notifikasi:** terbagi atas tab **Surat**, **Arsip**, **Alur**, dan **Semua**; klik item untuk membuka rekod terkait.
- **Avatar:** melihat nama dan email, membuka **Pengaturan** dan **Panduan Pengguna**, serta **Keluar** dari aplikasi. Menu ini sama untuk semua peran.
- **Tanda operasional (khusus Super Admin):** tanda **Operasional: perlu perhatian** atau **Operasional: gagal** muncul bila ada pemeriksaan di Monitoring Operasional yang tidak sehat; klik untuk membuka halamannya.

### Pencarian global

1. Klik kotak/ikon pencarian pada header, atau tekan `Ctrl+K` di Windows/Linux dan `Command+K` di macOS.
2. Ketik minimal dua karakter dari nomor, perihal, uraian, atau kata kunci.
3. Klik hasil; pada keyboard gunakan panah atas/bawah lalu `Enter`.
4. Bila hasilnya banyak, tertulis misalnya *Menampilkan 10 dari 37 hasil.*; klik **Tampilkan lebih banyak** untuk memuat hasil berikutnya.

Pencarian mencakup data surat dan arsip yang dicatat, tidak termasuk isi PDF hasil pindaian.

Gunakan filter lokal pada halaman Surat, Arsip, Laporan, Peminjaman, atau Audit Log untuk hasil yang lebih spesifik. Kotak pencarian di daftar surat, daftar arsip, dan daftar dosir tetap menemukan frasa walaupun teks aslinya terpotong baris baru. Hasil tetap dibatasi oleh role, unit kerja, klasifikasi keamanan, dan persetujuan akses Anda.

## 3. Role dan tanggung jawab

| Role | Penggunaan utama |
|---|---|
| **Belum aktif** | Hanya melihat Dashboard pemberitahuan aktivasi; minta Super Admin menetapkan role dan unit kerja. |
| **Admin Unit Kerja** | Mengelola operasional surat, arsip, distribusi, dosir, retensi, layanan fisik, media, laporan, dan tahapan tata kelola pada unit kerja yang ditetapkan, sesuai pemisahan tugas. Pada penyusutan, role ini membuat, mengusulkan, dan meninjau batch. Persetujuan dan pelaksanaan penyusutan, master klasifikasi/JRA, Autentikasi, Audit Log, Monitoring Operasional, tab **Unit Kerja** di Pengaturan, dan Manajemen Pengguna dikelola Super Admin. |
| **Super Admin** | Seluruh kewenangan admin untuk semua unit, pengelolaan pengguna dan pengaturan (termasuk tab **Unit Kerja**), master klasifikasi/JRA, Audit Log, Monitoring Operasional, persetujuan dan pelaksanaan penyusutan beserta unggah bukti pelaksanaannya, keputusan akses, filter lintas unit, serta aktivasi versi aturan. |

Super Admin hanya dapat memilih dua role tersebut. Admin Unit Kerja hanya dapat mengubah data unitnya sendiri. Surat unit lain dapat dibaca, tanpa diubah, bila unitnya ikut dalam rangkaian surat tersebut; Admin Unit Kerja pada unit pengawas (Ditjen dan Sesditjen) juga dapat membaca surat Ditjen, Sesditjen, dan seluruh direktorat. Surat lintas unit berklasifikasi Terbatas atau lebih tinggi tetap memerlukan izin akses.

Akun lama tetap mempertahankan hak aksesnya sampai Super Admin menetapkan role baru. Admin Dirjen dan Admin Sesditjen lama hanya dapat mengubah data unit semula (Ditjen atau Sesditjen) dan, sebagai unit pengawas, dapat membaca surat lintas unit seperti di atas; akun Staff dan Auditor lama tidak otomatis mendapat kewenangan menulis.

Prinsip yang harus selalu dipakai:

- gunakan akun pribadi, bukan akun bersama;
- akses hanya data yang diperlukan untuk tugas;
- pencatat, penelaah, penyetuju, atau penerima harus berbeda bila sistem mensyaratkan pemisahan tugas;
- Super Admin dapat melihat lintas unit, sedangkan pengguna lain mengikuti unit dan cakupan aksesnya; dan
- role administratif tidak otomatis membuka bitstream berklasifikasi Terbatas, Rahasia, atau Sangat Rahasia.

## 4. Alur belajar berdasarkan peran

### Semua pengguna

1. Buka Dashboard dan baca notifikasi.
2. Pelajari daftar serta detail Surat Masuk dan Surat Keluar.
3. Gunakan pencarian global dan filter daftar.
4. Buka Arsip Aktif dan pahami tab Identifikasi, Item Arsip, Retensi & Lokasi, Jejak Aturan, Keamanan, dan Surat Asli.
5. Gunakan Laporan sesuai lingkup akses.
6. Ajukan Persetujuan Akses jika rekod terkendali diperlukan untuk tugas.

### Admin surat

1. Registrasikan surat masuk/keluar dan periksa metadata.
2. Distribusikan surat masuk bila diperlukan.
3. Arsipkan surat yang prosesnya selesai.
4. Pilih klasifikasi dan butir JRA berdasarkan isi/fungsi, bukan hanya kemiripan kata.
5. Periksa kembali unit pengolah, keamanan, item, dan lokasi fisik.

### Arsiparis/admin kearsipan

1. Jaga dosir dan lokasi simpan. Perubahan master klasifikasi dan JRA dilakukan Super Admin melalui **Versi Aturan**.
2. Catat peristiwa pemicu retensi beserta bukti.
3. Minta petugas berbeda memverifikasi bukti pemicu.
4. Gunakan appraisal untuk JRA manual, Dinilai Kembali, atau pengecualian komponen.
5. Terapkan legal hold bila ada sengketa, audit, pemeriksaan, atau kebutuhan lain yang sah.
6. Buat usulan penyusutan atau manifest permanen hanya setelah semua prasyarat terpenuhi.

### Penelaah

1. Periksa sumber, identitas rekod, alasan, bukti, checksum, tanggal, dan jejak pelaku.
2. Petugas penelaah yang ditunjuk dan memiliki izin keputusan dapat menolak atau mengembalikan pekerjaan yang bukti/alasannya belum memadai.
3. Jangan menelaah pekerjaan yang Anda buat sendiri.
4. Gunakan riwayat dan jejak versi yang tersedia dalam cakupan akses; Audit Log global saat ini hanya tersedia bagi Super Admin.

### Super Admin

1. Provisi pengguna dengan email, role, unit kerja, jabatan, NIP, dan status yang tepat.
2. Tinjau akun tidak aktif serta perubahan personel secara berkala.
3. Kelola pengaturan dan versi aturan tanpa menghapus jejak lama.
4. Putuskan permohonan akses dengan asas kebutuhan minimum dan masa berlaku terbatas.
5. Pantau tab **Pengawasan** di Dashboard serta kegagalan operasional.

## 5. Dashboard dan notifikasi

Dashboard merangkum jumlah surat, arsip, tren bulanan, aktivitas terbaru, arsip yang mendekati batas retensi, dan widget pengelolaan arsip. Super Admin dapat memilih **Semua Unit Kerja** atau unit tertentu dan membuka tab **Pengawasan**.

Bagi admin, bagian **Perlu ditindaklanjuti** menampilkan baris *N surat keluar menunggu keputusan Anda* dengan tombol **Tinjau surat yang menunggu** bila ada surat keluar yang diajukan kepada Anda sebagai penyetuju.

Gunakan Dashboard sebagai daftar perhatian, bukan sebagai keputusan pemusnahan. Angka **Perlu Telaah Retensi** atau indikator kedaluwarsa tetap harus diperiksa terhadap pemicu terverifikasi, JRA, appraisal, legal hold, dan workflow penyusutan.

Pada ikon lonceng:

- pilih tab **Surat**, **Arsip**, **Alur**, atau **Semua**;
- klik notifikasi untuk membuka rekod;
- tandai sudah dibaca setelah ditindaklanjuti; dan
- gunakan **Perbarui notifikasi** bila data baru belum tampak.

## 6. Surat masuk, surat keluar, dan distribusi

### Surat masuk

Untuk admin:

1. Buka **Surat > Surat Masuk** lalu klik **Surat Baru**.
2. Isi jenis dan sifat surat, nomor, tanggal surat, perihal, pengirim, penerima, disposisi bila ada, klasifikasi, dan metadata lain yang tersedia. Nomor boleh dikosongkan agar dibuat otomatis dari template unit. Sifat surat terdiri atas Biasa, Segera, Sangat Segera, Terbatas, Rahasia, Sangat Rahasia, Undangan, dan Penting. Terbatas, Rahasia, dan Sangat Rahasia adalah kelas keamanan surat: admin dapat memilih Terbatas, sedangkan sifat Rahasia dan Sangat Rahasia hanya dapat ditetapkan oleh Super Admin. Surat Terbatas, Rahasia, atau Sangat Rahasia hanya dapat dibuka atau diubah dengan persetujuan akses berjangka, juga oleh pencatatnya; ajukan persetujuan akses setelah menyimpan.
3. **No. Agenda** boleh dikosongkan agar nomor dibuat otomatis; di bawahnya tertulis *Nomor otomatis berikutnya: N*. Isi hanya bila ingin melanjutkan nomor dari buku agenda kantor. Nomor yang sudah dipakai surat lain di unit itu pada tahun yang sama, termasuk nomor surat yang sudah dihapus, ditolak. Nomor yang lebih dari 100 di atas nomor otomatis berikutnya meminta konfirmasi **Simpan dengan nomor ini?**, karena nomor otomatis sesudahnya melanjutkan dari angka itu dan tidak dapat diturunkan lagi.
4. Isi **Link Dokumen** atau unggah berkas PDF bila ada dan fasilitas penyimpanan file tersedia. Keduanya tidak wajib; hasil pindai dapat ditambahkan nanti lewat **Edit Surat**. Link dokumen harus berupa alamat lengkap, misalnya `https://contoh.go.id/berkas`. Saat menyimpan dengan berkas PDF, kemajuan unggah tampil di bilah tombol, misalnya *Mengunggah berkas: 45%*.
5. Periksa nomor, tanggal, pengirim, perihal, unit, dan file sebelum menyimpan. Bila nomor surat yang diketik sudah tercatat, formulir menampilkan **Nomor sudah terdaftar**; periksa apakah suratnya sama. Peringatan ini tidak menghalangi penyimpanan. Surat yang disimpan tanpa disposisi meminta konfirmasi **Simpan tanpa disposisi?**.
6. Bila ada isian yang ditolak, pesannya tampil di bawah isian terkait dan ringkasannya berbunyi *Surat belum dapat disimpan. Periksa isian berikut: ...*
7. Di daftar, status surat adalah **Belum Diproses** atau **Sudah Dibalas**. Tindakan per surat ada di menu tiga titik (⋯): **Detail & File**, **Edit Surat**, **Distribusi**, **Arsipkan**, dan **Hapus Surat**. Di halaman detail, gunakan **Edit**, menu **Tindak Lanjut** (misalnya **Saya Balas** atau **Disposisi ke Direktorat**), dan **Arsipkan** sesuai kewenangan.

Isian teks boleh memuat tanda kurung sudut, misalnya `Luas < 5 ha` atau `<e-Office>`; teks disimpan seperti diketik dan hanya tag HTML yang dibuang. Baris baru pada perihal dan isian panjang lain tetap tampil di halaman detail.

Bila tanggal surat diubah ke tahun lain, formulir menulis *Tahun berubah. Surat akan mendapat nomor agenda baru di tahun …; nomor surat yang dibuat otomatis ikut diperbarui.* Tahun surat harus antara 2000 dan 2100. Bila surat yang sama sudah diubah orang lain sejak Anda membukanya, penyimpanan ditolak dengan pesan *Data ini sudah diubah pengguna lain sejak Anda membukanya…*; muat ulang halaman lalu ulangi perubahan Anda.

Di daftar Surat Masuk, pilihan **Urutkan** menyediakan **Terakhir dicatat**, **Tanggal surat (terbaru)**, dan **Tanggal surat (terlama)**; urutan ini juga dipakai **Export**. Penyaring **Disposisi Ke** memuat nama unit kerja tujuan disposisi serta **Kabag Program dan Hukum** dan **Kabag Kepegawaian Keuangan dan Umum**; disposisi yang ditolak tidak ikut. Super Admin yang memilih **Semua Unit Kerja** melihat kolom **Unit Kerja**.

### Surat keluar

1. Buka **Surat > Surat Keluar** lalu klik **Buat Surat Inisiatif**, atau pilih **Tindak Lanjut Surat Masuk…** dari menu panah di sampingnya.
2. Isi jenis naskah dinas, nomor, tanggal, tujuan, perihal, klasifikasi, dan klasifikasi keamanan sesuai dokumen sumber. **No. Urut** boleh dikosongkan agar nomor dibuat otomatis, atau diisi untuk melanjutkan nomor urut dari buku agenda kantor; aturannya sama dengan No. Agenda surat masuk. Link dokumen dan berkas tidak wajib, tetapi hanya dapat ditambahkan selama surat masih draf atau ditolak, yaitu sebelum diajukan untuk persetujuan.
3. Untuk membalas surat masuk, buka detail surat masuk, klik **Tindak Lanjut**, lalu pilih **Saya Balas** agar referensi asal tetap terhubung.
4. Simpan surat sebagai draft, lalu buka halaman detail dan periksa seluruh metadata.
5. Klik **Ajukan Persetujuan**, pilih administrator aktif lain sebagai penyetuju, isi catatan bila perlu, lalu kirim.
6. Penyetuju yang ditunjuk membuka surat itu dari Dashboard, dari kartu *surat menunggu keputusan Anda* di halaman Surat Keluar, atau dari penyaring **Menunggu keputusan saya**, lalu memilih **Setujui** atau **Tolak**. Alasan wajib diisi saat menolak.
7. Surat yang ditolak dapat diperbaiki dan diajukan ulang. Surat yang telah disetujui final dapat diarsipkan melalui halaman detail.

Beberapa surat dapat diajukan atau disetujui sekaligus: centang surat di daftar, lalu pakai **Ajukan Persetujuan (N)** atau **Setujui (N)** pada bilah **Tindakan untuk surat terpilih** (paling banyak 100 surat). Bila pembuat surat sudah nonaktif atau pindah unit, Super Admin atau admin unit surat dapat mengajukan atas namanya.

Pembuat tidak dapat menyetujui suratnya sendiri. Selama status **Menunggu Persetujuan** atau **Disetujui**, surat terkunci dari edit dan hapus; surat belum dapat diarsipkan sebelum persetujuan final. Seluruh pengajuan, keputusan, catatan, dan pelaku tampil pada riwayat. Ini adalah persetujuan proses internal, bukan tanda tangan elektronik, serta tidak menggunakan BSrE/PSrE.

### Distribusi

1. Di daftar Surat Masuk pilih **Distribusi** dari menu tiga titik (⋯), atau di detail surat pilih **Tindak Lanjut > Disposisi ke Direktorat**.
2. Centang unit tujuan, pilih penanggung jawab dan batas waktu bila perlu, tulis instruksi, lalu klik **Disposisikan**.
3. Buka menu **Distribusi**: tab **Kotak Masuk** untuk kiriman masuk (terima, buat tindak lanjut, selesaikan, atau tolak) dan tab **Kotak Keluar** untuk kiriman yang Anda buat.

Jangan menghapus surat hanya untuk memperbaiki kesalahan kecil. Gunakan fungsi edit/koreksi yang tersedia agar jejak aktivitas tetap dapat ditelusuri. Penghapusan hanya dilakukan oleh petugas berwenang setelah memastikan dampaknya.

### Menghapus dan memulihkan surat

1. Pilih **Hapus Surat** dari menu tiga titik (⋯) di daftar Surat Masuk atau Surat Keluar.
2. Dialog menjelaskan *Surat akan hilang dari semua daftar. Hanya Super Admin yang dapat memulihkannya.* Isi **Alasan penghapusan** (minimal 10 karakter), lalu klik **Hapus**.
3. Bila surat ternyata sudah dihapus orang lain, tampil *Surat tidak ditemukan atau sudah dihapus. Muat ulang daftar.*

Super Admin membuka tab **Surat Terhapus** di atas daftar Surat Masuk atau Surat Keluar. Tabelnya memuat Nomor Surat, Perihal, Unit Kerja, Dihapus oleh, Waktu hapus, dan Alasan hapus. Klik **Pulihkan**, isi **Alasan pemulihan** (minimal 10 karakter) pada dialog **Pulihkan surat?**, lalu klik **Pulihkan**. Surat kembali dengan nomor agenda atau nomor urut dan nomor surat semula, dan pemulihannya dicatat di log audit. Bila nomor surat yang sama juga dipakai surat aktif lain di unit itu, pemberitahuan menyebutkannya agar Anda memeriksa apakah suratnya sama. Surat yang rangkaiannya sudah diberkaskan tidak dapat dipulihkan.

### Impor daftar CSV atau XLSX

Admin dapat memilih **Impor CSV/XLSX** pada daftar Surat Masuk atau Surat Keluar. Super Admin memilih satu unit kerja terlebih dahulu. Pilih berkas `.csv` atau `.xlsx`, klik **Pratinjau** (untuk XLSX dengan beberapa lembar, pilih lembar kerja lalu **Pratinjau** lagi), periksa pemetaan kolom dan contoh baris, lalu klik **Impor**. Judul kolom dikenali seperti impor Google Sheets, misalnya `Hal` → Perihal dan `Get link` → Tautan dokumen. Maksimal 1.000 baris data dan 4 MiB per berkas; berkas panjang diimpor per bagian secara otomatis, dan baris yang sudah tersimpan dikenali sebagai duplikat saat impor ulang. Selama pemilih unit menunjukkan Semua Unit Kerja, tombol impor nonaktif.

Kolom **No**, **No. Agenda**, atau **Nomor Agenda** pada sumber disimpan sebagai nomor agenda surat masuk atau nomor urut surat keluar bila nomor itu belum dipakai di unit dan tahun yang sama. Pada pemetaan kolom tertulis **No. Agenda (disimpan bila belum dipakai)** atau **No. Urut (disimpan bila belum dipakai)**. Bila nomornya sudah terpakai atau bukan angka, baris tetap disimpan dengan nomor berikutnya dan keterangannya menyebut, misalnya, *Nomor agenda sumber 12 sudah dipakai; diberi nomor 57.* Karena itu, **impor register lama lebih dahulu** sebelum mencatat surat baru untuk tahun yang sama. Kolom yang dikenali tetapi tidak disimpan, misalnya **ID sumber** dan **Status sumber**, ditandai **(tidak disimpan)** pada pemetaan. Pada surat keluar, **Klasifikasi arsip** dan **Kode klasifikasi** hanya disimpan bila ada kolom **Jenis klasifikasi**, dan sebaliknya.

Pratinjau memeriksa setiap baris dengan pemeriksaan yang sama seperti impor. Bila ada baris yang akan ditolak, tampil kotak *n dari total baris akan ditolak* beserta daftar *Baris data ke-…: alasan*. Pratinjau juga menyebut baris yang akan dilewati, misalnya *… baris sudah tercatat di SIMSA pada unit ini …*, *… baris ganda di sumber akan dilewati.*, dan *… baris cocok dengan surat yang sudah dihapus dan tidak akan dibuat ulang.* Surat masuk bernomor dianggap sama bila nomor, tahun, dan pengirimnya sama; huruf besar-kecil dan spasi pada nama pengirim tidak dibedakan, dan baris tanpa pengirim cocok dengan pengirim mana pun. Bila nomornya sama tetapi pengirimnya berbeda, pratinjau menulis *… baris bernomor sama dengan surat yang sudah tercatat tetapi pengirimnya berbeda; baris ini akan dicatat sebagai surat baru. Periksa penulisan pengirim bila surat itu sama.*

Impor dari Google Sheets hanya dapat membaca lembar yang akses umumnya "Siapa saja yang memiliki link". Aktifkan berbagi link hanya selama impor, lalu matikan kembali setelah impor selesai. Register yang memuat surat Terbatas atau lebih tinggi jangan dibagikan lewat link: unduh sebagai Microsoft Excel (.xlsx), lalu impor dengan **Impor CSV/XLSX**.

Setelah impor (CSV/XLSX maupun Google Sheets), **Rincian hasil impor per baris** menampilkan status setiap baris: tersimpan, duplikat (ganda di sumber, sudah tercatat, atau cocok dengan surat yang sudah dihapus), ditolak beserta alasannya, atau kosong. Filter bawaan "Perlu dicek" hanya menampilkan baris yang perlu ditindaklanjuti (ganda di sumber, surat dihapus, ditolak, tidak diperbarui); **Unduh laporan (CSV)** menyimpan semua baris dengan pemisah titik koma sehingga langsung terbuka per kolom di Excel berpengaturan Indonesia. Untuk menerapkan perubahan sumber pada surat yang sudah diimpor, centang **Sinkronkan surat yang sudah tercatat** sebelum mengimpor ulang: perihal, tanggal, sifat, tautan dokumen, dan jenis naskah surat keluar (surat masuk: perihal, tanggal, jenis surat; sifat surat masuk tidak diubah) diperbarui bila berbeda dan dicatat di log audit. Sel kosong tidak menghapus data; surat yang sudah disetujui, diarsipkan, dihapus, atau tidak boleh Anda ubah dilaporkan "Tidak diperbarui".

Sifat surat masuk sekaligus menjadi klasifikasi keamanan, sehingga impor memakai batas yang sama dengan formulir. Baris surat masuk bersifat **Rahasia** atau **Sangat Rahasia** hanya dapat diimpor oleh Super Admin. Bila diimpor oleh Admin Unit Kerja, Admin Dirjen, atau Admin Sesditjen, baris itu ditolak dengan keterangan "Klasifikasi keamanan melebihi kewenangan pengguna…", tidak dicocokkan dengan surat yang sudah tercatat (juga saat sinkron), dan baris lain tetap tersimpan. Minta Super Admin mengimpor atau mencatat surat tersebut. Impor surat keluar tidak terpengaruh karena sifatnya adalah urgensi dan klasifikasi keamanannya selalu dicatat Biasa.

Sifat urgensi Segera, Sangat Segera, Amat Segera/Kilat, Penting, dan Undangan dibaca sebagai Biasa, dan sel sifat yang kosong atau berisi "-" dicatat sebagai Biasa. Sifat lain yang tidak dikenal, misalnya "Konfidensial", ditolak per baris untuk semua pengguna, termasuk Super Admin, dengan keterangan "Sifat surat tidak dikenal…", karena surat seperti itu tidak dapat dibaca siapa pun. Penolakan ini hanya untuk baris yang akan dicatat sebagai surat baru; saat sinkron, baris yang cocok dengan surat yang sudah tercatat tetap memperbarui perihal, tanggal, dan jenis surat. Baris yang akan ditolak karena sifat sudah tercantum di pratinjau sebelum **Impor**. Perbaiki sifatnya di sumber lalu buat pratinjau lagi.

Tanggal selalu dibaca dengan urutan **hari, bulan, tahun**: `03/11/2026`, `3-11-2026`, `3.11.2026`, `03/11/26`, `3 November 2026`, `3 Nov 2026`, atau `03-Nov-26`. Penulisan `2026-11-03` dan sel tanggal Excel juga diterima. Tahun dua angka 00–69 dibaca 2000-an dan 70–99 dibaca 1900-an. Baris yang tanggalnya tidak dapat dibaca **ditolak, tidak ditebak**: tanggal yang jelas ditulis bulan lebih dulu (misalnya `11/25/2026`), tanggal yang tidak ada di kalender (misalnya `31/02/2026`), tahun di luar 1920 sampai 2199, dan angka tanpa pemisah seperti `031126`. Baris seperti itu tercantum di kotak *n dari total baris akan ditolak* pada pratinjau beserta alasannya. Baris lain tetap dapat diimpor; perbaiki tanggal di sumber data, lalu buat pratinjau lagi agar baris itu ikut tersimpan.

Pada Arsip Aktif, **Impor CSV** memakai kolom `Nomor Berkas`, `Tanggal`, `Uraian`, `Jenis Arsip` (`masuk` atau `keluar`). Tanggal dibaca dengan aturan yang sama seperti impor surat di atas (urutan hari, bulan, tahun; tahun 1920 sampai 2199). Pemisah kolom boleh koma, titik koma, atau tab dan dibaca dari baris judul; sebaiknya simpan sebagai "CSV UTF-8", tetapi CSV biasa dari Excel juga dapat dibaca. Maksimal 1.000 rekod dan 4 MiB per berkas; beri setiap kolom judul yang berbeda dan pecah berkas besar sebelum diimpor. Pilih CSV lalu **Pratinjau**, koreksi baris yang ditolak pada sumbernya, centang *Saya sudah memeriksa pratinjau dan memahami bahwa impor ini permanen.*, lalu klik **Impor data valid**. Arsip yang diimpor tidak dapat dihapus dari aplikasi dan impor tidak dapat dibatalkan. Baris yang berhasil tetap tersimpan bila baris lain gagal; periksa hasil sebelum mengulang.

Impor ini mencatat metadata, bukan mengunggah berkas digital. Impor arsip belum memetakan kolom lokasi terstruktur; catatan lokasi dapat ditempatkan pada `Keterangan`. Klasifikasi/JRA hasil impor perlu dicocokkan melalui rekonsiliasi, tidak otomatis terverifikasi. Lihat [langkah inventaris fisik](./mulai-inventaris-internal.md).

### Unggah massal dan OCR PDF

Fitur ini hanya tersedia bila operator mengaktifkan modul Unggah Massal & OCR serta mengonfigurasi penyimpanan privat dan pemeriksaan file. Bila tombol **Unggah Massal** tidak tampil, pencatatan manual atau impor metadata tetap dapat digunakan. Jangan membuat unggahan kosong atau tautan publik untuk mengganti bukti.

Untuk menyiapkan beberapa draft arsip dari PDF sekaligus:

1. Klik **Unggah Massal** di Dashboard atau di halaman Arsip Aktif untuk membuka halaman **Unggah Massal & OCR**.
2. Pilih satu unit kerja yang konkret. Super Admin juga wajib memilih unit tujuan sebelum unggah.
3. Pilih atau seret PDF, maksimal 50 berkas, 50 MiB per berkas, dan 100 MiB per batch.
4. Klik **Mulai unggah** dan tunggu sampai pemrosesan selesai. PDF yang memiliki text layer dibaca langsung; PDF hasil pindai dirender lalu dikenali dengan OCR Bahasa Indonesia dan Inggris.
5. Tinjau dan koreksi nomor surat, tanggal, pengirim, perihal, serta metadata lain pada setiap hasil. Jangan menganggap hasil OCR sebagai salinan yang pasti benar.
6. Konfirmasi hanya item yang sudah diperiksa. Batch yang belum selesai disimpan agar dapat dipulihkan, sedangkan item gagal harus diperiksa dari pesan kesalahannya.

OCR PDF hasil pindai dibatasi maksimal 10 halaman dan dapat gagal bila citra terlalu besar, teks tidak cukup terbaca, model bahasa tidak tersedia, atau waktu proses habis. Kegagalan tersebut tidak membuat metadata pengganti secara otomatis.

## 7. Membuat dan mengelola arsip

### Mengarsipkan surat

1. Buka detail surat yang telah selesai diproses lalu klik **Arsipkan**. Surat keluar harus sudah disetujui admin lain.
2. Periksa atau isi **Nomor Berkas**.
3. Pilih **Klasifikasi Arsip & Jadwal Retensi**. Pilih klasifikasi dahulu, kemudian butir JRA yang sesuai.
4. Baca pratinjau retensi aktif, retensi inaktif, hasil JRA, versi, dan referensi.
5. Isi uraian berkas, unit pengolah, kurun waktu, item arsip, tingkat perkembangan, tanggal, jumlah, dan lokasi fisik (No. Filing Cabinet, No. Laci, No. Folder). Bila perlu, pilih juga **Lokasi Simpan** dari daftar gedung, ruang, rak, atau boks.
6. Tetapkan klasifikasi keamanan dan **Penanggung Jawab**. Admin Unit Kerja hanya dapat memilih Biasa/Terbuka atau Terbatas; bila surat sumber berkelas Rahasia atau Sangat Rahasia, kelas itu dipertahankan pada arsip, dan kelas yang lebih tinggi hanya dapat dipilih Super Admin.
7. Periksa ulang, centang *Saya memahami bahwa pengarsipan ini permanen dan tidak dapat dibatalkan.*, lalu klik **Simpan Arsip**.

Pengarsipan bersifat permanen. Setelah disimpan, surat terkunci: tidak dapat diubah atau dihapus, dan berkas PDF tidak dapat lagi ditambahkan dari halaman surat. Arsip tidak dapat dihapus dari aplikasi. Lengkapi hasil pindai sebelum mengarsipkan.

Saran JRA dari aplikasi membantu pencarian, tetapi **bukan keputusan otomatis**. Petugas tetap menilai isi, fungsi, konteks, dan rumusan pemicu. Pemicu retensi juga tidak ditetapkan pada dialog registrasi; catat setelah arsip dibuat melalui **Tata Kelola Retensi**.

### Daftar dan detail arsip

- **Arsip Surat Masuk/Keluar:** gunakan pencarian, tahun, filter lanjutan, unit (jika berwenang), dan pagination. Kolom **Nasib Akhir** menulis **Menunggu verifikasi** atau **Menunggu rekonsiliasi** selama nasib akhir arsip belum dapat dihitung.
- **Tab Status Retensi:** merangkum arsip menurut tahap retensinya. Super Admin memilih satu unit kerja terlebih dahulu; selama **Semua Unit Kerja** terpilih tertulis *Pilih unit kerja untuk melihat status retensi.*
- **Tab Retensi & Lokasi:** menampilkan lokasi penyimpanan, termasuk **Lokasi Simpan** bila sudah dipilih, serta informasi masa simpan. Bagian **Kemajuan Masa Aktif** baru tampil setelah pemicu retensi terverifikasi dan menulis *Dihitung sejak tanggal pemicu retensi …*. Sebelum itu tertulis *Menunggu verifikasi pemicu retensi*, atau *Menunggu rekonsiliasi klasifikasi dan JRA* bila aturan arsip belum dicocokkan.
- **Tab Jejak Aturan:** menunjukkan versi klasifikasi/JRA dan revisi yang pernah dipakai.
- **Tab Keamanan:** menunjukkan klasifikasi keamanan dan kontrol akses.
- **Tab Surat Asli:** menghubungkan arsip dengan surat sumber.
- **Kartu Tunjuk Silang:** menampilkan dokumen lain yang ditautkan dengan arsip ini.
- **Export:** pilih **Formulir 4** (Daftar Arsip Aktif) atau **Formulir 6** (Daftar Arsip Inaktif), lalu Excel atau PDF. Isi ekspor mengikuti tab, unit, pencarian, dan tahun yang sedang dipilih. Saringan lokasi simpan tidak ikut ke berkas ekspor. Arsip yang memiliki beberapa item dicetak satu baris per item; arsip berkelas Terbatas atau lebih tinggi tetap dicetak satu baris ringkasan berkas.

Formulir 4 memuat arsip yang masa aktifnya belum berakhir. Formulir 6 memuat arsip yang masa aktifnya sudah berakhir menurut klasifikasi/JRA dan peristiwa pemicu retensi yang sudah terverifikasi, serta arsip yang pemindahannya ke penyimpanan inaktif sudah dicatat di SIMSA melalui modul Penyusutan; pemindahan di luar SIMSA tidak mengubah isi formulir. Arsip yang belum terverifikasi dan belum dicatat pindah tetap tercantum di Formulir 4, sedangkan arsip yang sudah dimusnahkan atau diserahkan tidak tercantum di keduanya. Arsip yang pemindahannya dilaksanakan melalui modul Penyusutan sebelum pembaruan siklus arsip pada September 2026 tetap tercantum di Formulir 6. Bila belum ada arsip inaktif untuk filter yang dipilih, Formulir 6 tidak diunduh dan muncul keterangan "Belum ada arsip inaktif untuk filter ini…". Rincian kolom ada di [Arsip Aktif](./siklus-arsip/arsip-aktif.md#ekspor-formulir-4-dan-formulir-6).

Arsip lama berstatus aturan belum terverifikasi dapat dibaca tetapi tidak boleh masuk penyusutan. Admin dapat memilih **Rekonsiliasi Klasifikasi/JRA**, memilih aturan aktif, dan mengisi alasan yang spesifik. Rekonsiliasi tidak tersedia bila arsip sedang legal hold, berada dalam workflow penyusutan, atau sudah dieksekusi.

Untuk memperbaiki data berkas yang salah catat, admin yang berwenang atas unit arsip memilih **Ubah Metadata** di halaman detail. Isian yang dapat diubah: nomor dan uraian berkas, unit pengolah, kurun waktu, nomor dan uraian item, tingkat perkembangan, tanggal arsip, jumlah, media, No. Filing Cabinet, No. Laci, No. Folder, Lokasi Simpan, klasifikasi keamanan, Penanggung Jawab, dan keterangan. Lokasi Simpan tidak dapat diubah selama arsip atau boksnya dipinjam. Hanya isian yang diubah yang disimpan, dan perubahannya tercatat di log audit. Bila arsip sudah diubah orang lain sejak Anda membuka dialog, penyimpanan ditolak dengan pesan *Data ini sudah diubah pengguna lain sejak Anda membukanya…*; muat ulang halaman lalu ulangi perubahan. Klasifikasi/JRA tetap diubah melalui **Rekonsiliasi Klasifikasi/JRA**. **Ubah Metadata** dikunci bila arsip sedang legal hold, sedang dalam proses penyusutan, atau penyusutannya sudah dilaksanakan. Untuk arsip berkelas Terbatas atau lebih tinggi, **Ubah Metadata** dan **Rekonsiliasi Klasifikasi/JRA** hanya aktif bila persetujuan akses Anda atas arsip itu bermode **Tayang dan kelola**; tombol yang dikunci menampilkan alasannya. Perubahan nomor item, uraian item, tingkat perkembangan, tanggal arsip, atau lokasi ikut memperbarui item ringkasan dan item di lokasi lama yang sama pada tab **Item Arsip**; rinciannya ada di [Arsip Aktif](./siklus-arsip/arsip-aktif.md#daftar-item-ikut-diperbarui). Admin Unit Kerja hanya dapat memilih klasifikasi keamanan Biasa/Terbuka atau Terbatas; kelas yang sudah tersimpan boleh dipertahankan.

### Dosir dan lokasi fisik

- Gunakan **Pemberkasan (Dosir)** untuk menghimpun surat yang berhubungan dalam satu perkara/kegiatan. Admin yang berwenang atas unit dosir dapat memakai **Edit** dan **Hapus** pada menu kartu dosir, **Edit Dosir** di halaman detail, dan tombol **Lepas dari dosir** pada surat di dalamnya. Catatan yang diisi saat menambahkan surat tampil di bawah surat itu.
- Gunakan **Lokasi Simpan** untuk mengelola daftar gedung, ruang, rak, dan boks. Kode QR lokasi diunduh lewat **Unduh Kode QR** untuk ditempel pada rak atau boks.
- Halaman Lokasi Simpan menampilkan jumlah arsip yang tertaut ke tiap lokasi dan tombol **Lihat arsip di lokasi ini**. Lokasi yang masih ditautkan arsip tidak dapat dihapus.
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
6. Pilih **Aktifkan**. Tahap ini tidak memerlukan akun penelaah atau penyetuju terpisah; sistem tetap memeriksa sumber, integritas, dan tanggal berlaku saat aktivasi.
7. Setelah aktif, aturan lama tetap melekat pada arsip lama; jangan melakukan perubahan massal tanpa rekonsiliasi yang dapat diaudit.

Menu **Versi Aturan**, termasuk PDF sumber, hasil validasi, dan jejak audit versi, hanya tersedia bagi Super Admin.

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

Menu **Penyusutan** hanya muncul bila modulnya diaktifkan operator. Selama modul belum diaktifkan, pemindahan dan pemusnahan arsip dilakukan di luar SIMSA mengikuti prosedur unit; gunakan **Manajemen Retensi** untuk melihat arsip yang masa retensinya sudah atau hampir habis dan untuk mencetak draf berita acara pemusnahan tanpa nomor (nomor diisi manual) melalui **Generate Berita Acara**. Bila tidak ada arsip yang dapat dimuat, tampil *Belum ada arsip yang memenuhi syarat* dan draf tidak dibuat; berita acara hanya memuat arsip Musnah yang retensinya telah berakhir, memiliki pemicu, tidak di-hold, dan belum masuk proses penyusutan.

Pada menu **Penyusutan**:

1. Pilih tab **Pemindahan**, **Pemusnahan**, atau **Alih Media**.
2. Klik **Buat Usulan**, pilih kandidat, dan isi keterangan.
3. Periksa daftar arsip di dalam batch.
4. Majukan status secara tertib: **Draft > Diusulkan > Ditinjau > Disetujui > Dilaksanakan**. Admin Unit Kerja dapat mengusulkan dan meninjau batch unitnya. Tahap **Disetujui** dan **Dilaksanakan**, termasuk unggah bukti pelaksanaan pemusnahan, hanya dapat dilakukan Super Admin.
5. Gunakan akun berbeda untuk setiap tahap pemeriksaan: peninjau berbeda dari pembuat dan pengusul, penyetuju berbeda dari pembuat, pengusul, dan peninjau, dan pelaksana berbeda dari semua akun sebelumnya. Artinya, penyetuju dan pelaksana harus dua akun Super Admin yang berbeda.
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
5. Simpan, lalu cek tab **Dipinjam** atau **Terlambat**.
6. Gunakan **Perpanjang** untuk mengubah jatuh tempo atau **Kembalikan** untuk mencatat pengembalian dan kondisi/catatan.

Fitur ini mencatat sirkulasi secara langsung; pastikan kewenangan peminjaman telah diperiksa di luar aplikasi bila prosedur unit mensyaratkannya. Cocokkan arsip/box fisik sebelum menyerahkan dan saat menerima kembali.

### Fitur layanan lainnya

- **Layanan Arsip:** catat dan pantau permohonan penggandaan atau legalisasi arsip lewat **Buat Permohonan**.
- **Arsip Vital / Arsip Terjaga:** tandai dan kelola arsip yang memerlukan perlindungan khusus sesuai kewenangan. **Cetak Daftar** di Arsip Vital mencetak daftar sesuai penyaring yang sedang dipakai, lengkap dengan nama unit kerja, tanggal cetak, dan kolom **Lokasi Cadangan** serta **Kategori**. Menu Arsip Terjaga hanya muncul bila modulnya diaktifkan operator.
- **Arsip Elektronik:** catat data teknis berkas digital sebuah arsip lewat **Tambah Metadata**.
- **Autentikasi:** buat berita acara autentikasi arsip hasil alih media (khusus Super Admin).
- **Tunjuk Silang:** hubungkan arsip, surat masuk, surat keluar, dan dosir yang berkaitan tanpa menggandakan arsip. Dokumen dipilih lewat pencarian nomor atau perihal, dan hubungannya tampil pada kartu **Tunjuk Silang** di halaman rinci surat dan arsip. Tunjuk silang yang keliru dibatalkan dengan alasan, bukan dihapus.
- **Formulir:** galeri ini berisi 33 template referensi kosong yang dapat dibuka dengan **Lihat Template Kosong**. Hanya tiga formulir yang dapat dibuat dari data aplikasi: Formulir 4 dan Formulir 6 lewat tombol **Ekspor dari Arsip** (menu **Export** di halaman Arsip), serta Formulir 27 lewat tombol **Buka Arsip Vital** (tombol **Cetak Daftar** di halaman itu). Formulir lain bertanda **Diisi manual dari template**.

## 12. Persetujuan akses rekod terkendali

Untuk Terbatas, Rahasia, atau Sangat Rahasia, role admin tidak otomatis memberikan hak melihat/unduh.

1. Buka surat atau arsip dari daftarnya. Bila isinya belum boleh Anda buka, halaman menampilkan **Perlu persetujuan akses** beserta nomor dan perihalnya.
2. Klik **Minta Akses**. Formulir permohonan terbuka dengan rekod itu sudah terpilih.
3. Pilih mode minimum: tayang saja, tayang dan unduh, atau tayang dan kelola. Mode **Tayang saja** hanya menyembunyikan tombol unduh, cetak, dan buka di tab baru; isi berkas tetap tampil di layar peminta dan dapat disalin, dan setiap penayangan tercatat di Audit Log.
4. Jelaskan kebutuhan kedinasan secara spesifik lalu kirim.
5. Pantau status pada **Administrasi > Persetujuan Akses Arsip**, tab **Permohonan Saya**.

Permohonan juga dapat dibuat dari tombol **Minta akses** di halaman itu; karena belum ada rekod terpilih, isi **ID rekod** dengan deret kode di akhir alamat halaman detail rekod.

Khusus Super Admin, tab **Perlu Keputusan** digunakan untuk menyetujui/menolak, menetapkan masa berlaku, atau mencabut akses. Pemohon tidak boleh menyetujui permohonannya sendiri. Persetujuan di SIMSA tidak menggantikan clearance, surat tugas, atau kewenangan pejabat.

## 13. Laporan dan Audit Log

### Laporan

1. Buka **Administrasi > Laporan**.
2. Pilih tahun atau isi **Dari Tanggal** / **Sampai Tanggal**, lalu klik **Tampilkan Data**. Bila tanggal diisi, pilihan tahun diabaikan untuk surat masuk dan surat keluar.
3. Gunakan tab **Ringkasan**, **Surat Masuk**, **Surat Keluar**, **Arsip**, atau **Peminjaman**.
4. Pada tab Surat Masuk, Surat Keluar, atau Arsip, pilih **Excel** atau **PDF**. Isi berkas surat sama dengan tabel di layar; ekspor arsip hanya memakai tahun.
5. Pada tab **Peminjaman**, peminjaman yang lewat jatuh tempo dan belum dikembalikan berstatus **Terlambat** dan dapat disaring dengan pilihan **Terlambat**.
6. Periksa periode, unit, jumlah baris, dan filter sebelum menggunakan hasil.

Tanggal dan waktu pada laporan serta berkas ekspor mengikuti WIB, dan label di berkas sama dengan label di layar. Bila Super Admin mengekspor dari daftar Surat Masuk, Surat Keluar, atau Arsip dengan pilihan **Semua Unit Kerja**, berkasnya memuat kolom **Unit Kerja** berisi nama unit. Pada PDF, baris yang lebih tinggi dari satu halaman dipotong dengan catatan *Teks yang terlalu panjang dipotong; versi Excel memuat isi lengkap.*

File ekspor adalah salinan kerja. Lindungi, batasi distribusi, dan hapus salinan lokal sesuai kebijakan setelah tidak diperlukan.

### Audit Log

Super Admin membuka **Administrasi > Audit Log** untuk:

- mencari nama pengguna, email, atau ID data;
- memfilter tipe entitas dan aksi, termasuk aksi **Masuk**, **Gagal masuk**, **Keluar**, dan **Mengganti kata sandi** (rinciannya hanya menulis *kata sandi: diganti*, tanpa isi kata sandi); aksi **Menjalankan Pemindai** dari Monitoring Operasional juga tercatat;
- memeriksa waktu, pelaku, rekod, IP, dan rincian perubahan yang tersedia; serta
- menelusuri urutan kejadian bersama jejak aturan, appraisal, pemicu, atau manifest.

Audit Log bukan alasan untuk membagikan informasi sensitif. Ekspor atau tangkapan layar audit hanya diberikan kepada pihak berwenang.

## 14. Pengelolaan pengguna dan administrasi

Khusus Super Admin:

1. Buka **Manajemen Pengguna** dan klik **Tambah Pengguna**.
2. Isi email yang tepat, nama, role, unit kerja, jabatan, NIP, dan kata sandi agar pengguna dapat masuk dengan email dan kata sandi. Kata sandi minimal 12 karakter, tidak memuat nama atau bagian depan email pengguna, dan bukan kata sandi yang umum. Isian ini boleh dikosongkan: akun tanpa kata sandi hanya dapat masuk dengan Google. Minta pegawai mengganti kata sandi awal di **Pengaturan › Profil** setelah masuk pertama kali.
3. Untuk Google, email yang diprovisi harus sama dengan akun Google pengguna. Akun Google baru yang menunggu persetujuan disetujui lewat tombol **Setujui akses**; pastikan dahulu langsung kepada pemilik email, lalu centang *Saya sudah memastikan langsung kepada pemilik email ini.* Pilihan **Ubah Peran/Unit** dan **Atur Ulang Kata Sandi** tidak tampil untuk akun yang belum disetujui.
4. Gunakan **Ubah Peran/Unit** dari menu tindakan untuk mengubah role, unit, jabatan, NIP, atau status.
5. Nonaktifkan akun segera saat pegawai mutasi/berhenti atau akses tidak lagi diperlukan. Pilihan **Nonaktifkan** dan **Aktifkan** meminta konfirmasi lewat dialog **Nonaktifkan pengguna?** atau **Aktifkan pengguna?**.
6. Hindari menghapus akun yang memiliki histori; nonaktifkan bila tujuan utamanya menghentikan akses.

Gunakan **Pengaturan** untuk konfigurasi yang memang tersedia bagi Super Admin, termasuk unit kerja atau templat. Daftar pengguna dan pilihan unit kerja menampilkan nama unit, bukan kodenya. Uji perubahan pada data yang aman sebelum digunakan secara luas.

**Monitoring Operasional** menampilkan kartu pemeriksaan berstatus **Sehat**, **Perlu perhatian**, **Gagal**, **Belum terverifikasi**, atau **Tidak diaktifkan**, dan diperbarui setiap menit selama halaman terbuka. Bila ada pemeriksaan yang tidak sehat, header menampilkan tanda **Operasional: perlu perhatian** atau **Operasional: gagal** yang membuka halaman ini. Kartu **Pemindai keamanan dokumen** memiliki tombol **Jalankan pemindai** untuk berkas yang lama menunggu pemindaian. Kartu **Pembersihan unggahan langsung** menghitung berkas yang diunggah tetapi tidak jadi disimpan pada surat atau arsip (**Belum terhapus**); berkas itu dihapus otomatis setiap hari, jadi hubungi pengelola sistem bila angkanya tidak turun dalam beberapa hari.

Kartu **Antrean pemindaian** menunjukkan jumlah berkas **Menunggu**, **Terlambat**, **Gagal**, dan **Terdeteksi berbahaya**. Berkas yang gagal dipindai belum dapat dibuka; gunakan **Antre ulang** per berkas atau **Antre ulang semua yang gagal dipindai** (paling banyak 100 berkas per tekan) agar dipindai lagi. Berkas yang terdeteksi berbahaya tetap dikunci, tidak dapat diantre ulang, dan perlu diganti.

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
- File umum dibatasi maksimum 10 MiB dan isi file diperiksa terhadap jenis yang dinyatakan. PDF, Word, Excel, JPG, PNG, dan GIF didukung pada alur lampiran umum; tampilan form tertentu dapat membatasi lebih ketat, misalnya formulir surat masuk dan surat keluar hanya menerima PDF.
- Lampiran tetap dikarantina sampai pemeriksaan keamanan menyatakan bersih. Bila terlalu lama, jangan mengunggah berulang-ulang; laporkan kepada admin.
- Penghapusan langsung bitstream/lampiran dinonaktifkan. Gunakan workflow penyusutan yang menjaga persetujuan dan bukti.
- Keluar setelah bekerja di komputer bersama dan jangan menyimpan password di browser publik.
- Laporkan salah akses, file mencurigakan, kehilangan perangkat, atau aktivitas tidak dikenal secepatnya.

## 17. Pemecahan masalah

| Gejala | Pemeriksaan dan tindakan |
|---|---|
| Tombol **Masuk dengan Google** kembali ke login/gagal | Baca pesan di halaman masuk (lihat [Login Google bila tersedia](#login-google-bila-tersedia)). Pastikan akun Google yang dipilih sama dengan email yang diprovisi. Coba jendela privat, izinkan cookie/redirect untuk domain aplikasi, lalu hubungi Super Admin bila tetap gagal. |
| Halaman hanya menampilkan *Peramban ini tidak didukung SIMSA. …* | Perbarui peramban ke Chrome atau Edge 111 ke atas, Firefox 128 ke atas, atau Safari 16.4 ke atas. Lihat [Browser yang Kompatibel](./tutorial-dasar/browser-kompatibel.md). |
| Berhasil login tetapi menu sangat sedikit | Role atau unit kerja belum ditetapkan/diaktifkan. Lihat role pada menu avatar dan hubungi Super Admin. |
| Menu tertentu tidak ada atau kembali ke Dashboard | Role tidak memiliki kewenangan atau fitur dinonaktifkan pada profil internal. Jangan mencoba memakai URL langsung. |
| Sesi tiba-tiba berakhir | Sesi berakhir setelah 30 menit tanpa aktivitas, atau ditutup karena kata sandi atau peran Anda diubah. Masuk kembali, lalu buka lagi formulir surat atau dialog Arsipkan di tab yang sama untuk memulihkan isian yang belum disimpan. Periksa apakah perubahan terakhir sudah tersimpan. |
| Muncul *Versi baru SIMSA tersedia. …* | Simpan pekerjaan yang sedang diisi, lalu klik **Muat ulang**. |
| Unggah berkas PDF lama atau melewati batas waktu | Periksa koneksi internet. Kecilkan ukuran PDF (misalnya dengan fitur kompres PDF), pilih berkas yang sudah dikecilkan, lalu simpan kembali; isian formulir tetap ada. |
| *Data ini sudah diubah pengguna lain sejak Anda membukanya. …* | Klik **Muat ulang**, periksa perubahan terbaru, lalu ulangi perubahan Anda. |
| *No. Agenda … sudah dipakai surat lain di unit ini. …* | Kosongkan **No. Agenda** (atau **No. Urut**) agar nomor dibuat otomatis, atau isi nomor lain. Nomor milik surat yang sudah dihapus juga tidak dapat dipakai ulang. |
| Pencarian tidak menemukan data | Ketik minimal dua karakter, periksa ejaan/filter/unit, lalu cari melalui daftar khusus. Data terkendali tetap tersembunyi tanpa akses. |
| Unggah ditolak | Periksa ukuran maksimum, ekstensi, jenis MIME, isi file, dan apakah file rusak. Simpan ulang dari aplikasi sumber bila perlu. |
| File ada tetapi tidak dapat dibuka | File mungkin masih menunggu pemindaian keamanan, gagal dipindai, terdeteksi bermasalah, atau memerlukan persetujuan akses. Hubungi Super Admin dengan nomor rekod dan waktu unggah agar berkas diantre ulang dari Monitoring Operasional, tanpa mengirim file lewat kanal pribadi. |
| Halaman surat/arsip menampilkan **Perlu persetujuan akses** | Rekod berkelas Terbatas atau lebih tinggi. Klik **Minta Akses** dan tunggu keputusan Super Admin. |
| Baris impor ditolak karena tanggal | Tulis tanggal dengan urutan hari, bulan, tahun (misalnya 03/11/2026 atau 3 November 2026) atau sebagai 2026-11-03, lalu buat pratinjau lagi. |
| Nomor agenda hasil impor berbeda dari kolom No di sumber | Nomor sumber sudah dipakai surat lain di tahun itu, biasanya karena surat baru dicatat sebelum register lama diimpor. Keterangan baris menyebut nomor yang diberikan. |
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
- [ ] Klasifikasi keamanan dan Penanggung Jawab sudah tepat.
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
