# Pengelolaan akun pengguna

Hanya pengguna aktif dengan peran **Super Admin** dapat membuka **Manajemen Pengguna** dan mengubah akun. Perubahan penting dicatat dalam audit. Hak aplikasi harus mengikuti penugasan instansi; gelar Super Admin tidak otomatis menjadi kewenangan menandatangani surat atau memusnahkan arsip.

## Membuat akun

1. Buka **Administrasi → Manajemen Pengguna**, lalu **Tambah Pengguna**.
2. Isi nama, email unik, peran dan unit kerja yang sesuai penugasan. Jabatan dan NIP membantu identifikasi pejabat; mengisinya tidak membuat tanda tangan elektronik.
3. Untuk akun email/kata sandi, isi kata sandi 8 sampai 128 karakter. Berikan kata sandi awal melalui saluran internal yang disetujui, lalu minta pengguna menggantinya di [Pengaturan → Profil → Ubah Kata Sandi](settings.md#ubah-kata-sandi).
4. Simpan, lalu uji login serta akses menggunakan akun tersebut.

Metode login mengikuti penyedia autentikasi yang dikonfigurasi operator. Akun Better Auth dapat memakai email/kata sandi jika dibuat dengan kata sandi. Google hanya dapat digunakan jika integrasinya aktif dan identitas email sesuai. Jangan menganggap setiap akun baru otomatis dapat masuk melalui Google.

Pilihan peran hanya dua:

| Peran | Ruang lingkup |
|---|---|
| **Super Admin** | Administrasi lintas unit; unit kerja dikosongkan oleh sistem. |
| **Admin Unit Kerja** | Mengelola surat, arsip, dan fitur operasional pada satu unit kerja. Unit kerja wajib dipilih. Surat unit lain hanya dapat dibaca, tanpa diubah, melalui rangkaian surat yang diikuti unitnya atau bila unitnya unit pengawas (Ditjen/Sesditjen). |

Akun lama tetap mempertahankan hak aksesnya sampai Super Admin menetapkan peran baru. Admin Dirjen dan Admin Sesditjen lama hanya dapat mengubah data unit semula (Ditjen atau Sesditjen). Karena kedua unit itu unit pengawas, akun tersebut juga dapat membaca surat Ditjen, Sesditjen, dan seluruh direktorat tanpa dapat mengubahnya. Akun Staff dan Auditor lama tidak otomatis mendapat kewenangan menulis. Pada dialog **Ubah Peran/Unit**, peran lama tampil dengan keterangan *(peran lama)* dan tidak tersedia untuk akun baru.

Unit kerja bukan sekadar isian pelengkap. Akun selain Super Admin yang belum ditugaskan pada unit tidak mendapatkan akses data. Arsip terbatas/rahasia juga mengikuti pemberian akses per arsip; peran umum tidak menjamin akses ke setiap dokumen.

## Menyetujui akun Google baru

Login Google pertama dengan email yang belum terdaftar membuat akun berperan **Pengguna** dengan status **Menunggu persetujuan**. Akun ini belum memiliki unit kerja dan belum dapat membuka data.

1. Di **Manajemen Pengguna**, klik filter **Menunggu persetujuan**.
2. Pastikan nama dan email milik pegawai yang memang memerlukan akses.
3. Klik **Setujui akses** pada baris pengguna tersebut.
4. Pada dialog **Setujui akses pengguna**, pilih **Peran**. Untuk **Admin Unit Kerja**, pilih juga **Unit kerja**; Super Admin tidak memiliki unit kerja.
5. Klik **Setujui akses**.

Persetujuan menutup sesi lama pengguna, sehingga pengguna perlu masuk kembali dengan Google. Jangan menyetujui akun yang tidak dikenal; pilih **Nonaktifkan** dari menu tindakannya.

## Mengubah dan menonaktifkan

Cari pengguna, buka menu tindakan, pilih **Ubah Peran/Unit**, ubah peran/unit/status sesuai penugasan, lalu simpan. Sistem membatasi perubahan yang akan menghilangkan Super Admin aktif terakhir dan membatalkan sesi yang terdampak perubahan akses. Perubahan peran atau unit dan penonaktifan juga ditolak selama pengguna masih menjadi penyetuju aktif surat keluar yang menunggu persetujuan.

Gunakan **Nonaktifkan** untuk menghentikan akses. Data identitas dan riwayat aktivitas tetap dipertahankan; tindakan ini bukan penghapusan permanen pengguna. Untuk mengaktifkan kembali, gunakan **Aktifkan** setelah penugasannya diperiksa.

### Mengubah akun lama menjadi Admin Unit Kerja

1. Buka menu tindakan pada akun lama, lalu pilih **Ubah Peran/Unit**.
2. Pada **Peran Pengguna**, pilih **Admin Unit Kerja**.
3. Periksa **Unit Kerja**. Akun Admin Dirjen dan Admin Sesditjen lama terisi unit Ditjen atau Sesditjen; ubah bila penugasannya berbeda.
4. Klik **Simpan Perubahan**. Sesi pengguna ditutup dan pengguna perlu masuk kembali.

Perubahan ini satu arah: setelah disimpan, peran lama tidak dapat dipilih kembali. Bila penyimpanan ditolak dengan pesan *Pengguna masih menjadi penyetuju aktif untuk surat pending…*, selesaikan atau teruskan persetujuan surat tersebut, lalu ulangi. Staff dan Auditor lama tidak dapat mengubah data, sedangkan Admin Unit Kerja dapat mengubah data unitnya. Tidak ada peran baru yang setara baca-saja, jadi biarkan peran lama bila pengguna cukup membaca.

## Atur ulang kata sandi

SIMSA tidak mengirim email untuk mengatur ulang kata sandi. Bila pengguna lupa kata sandinya, Super Admin menetapkan kata sandi baru.

1. Cari pengguna, buka menu tindakan, lalu pilih **Atur Ulang Kata Sandi**.
2. Isi **Kata sandi baru** (8 sampai 128 karakter) dan **Konfirmasi kata sandi baru**.
3. Klik **Atur Ulang Kata Sandi**.
4. Sampaikan kata sandi kepada pengguna secara langsung, lalu minta pengguna menggantinya di [Pengaturan → Profil → Ubah Kata Sandi](settings.md#ubah-kata-sandi).

- Kata sandi baru langsung berlaku, kata sandi lama tidak dapat dipakai lagi, dan semua sesi pengguna tersebut ditutup.
- Hanya Super Admin yang dapat melakukannya, termasuk untuk akun Super Admin lain.
- Menu ini tidak tampil untuk akun Anda sendiri; gunakan **Ubah Kata Sandi** di Pengaturan.
- Menu ini juga tidak tampil untuk akun yang belum disetujui (peran **Pengguna**); setujui aksesnya terlebih dahulu.
- Akun nonaktif dapat diatur ulang, tetapi pengguna baru dapat masuk setelah akun diaktifkan kembali.
- Akun yang selama ini hanya masuk dengan Google mendapat kata sandi SIMSA, sehingga dapat masuk dengan Google maupun dengan email dan kata sandi.
- Tindakan ini dicatat dalam audit tanpa menyimpan kata sandi.

## Pemeriksaan sebelum dipakai

Uji satu akun untuk setiap peran dan unit: login/logout, akses unit sendiri, penolakan perubahan di unit lain, baca-saja surat unit lain hanya melalui rangkaian atau unit pengawas, penolakan dokumen tanpa hak, perubahan peran dan penonaktifan akun saat masih memiliki sesi. Jangan menggunakan akun uji sebagai akun bersama untuk pekerjaan resmi.

[Audit Log](audit-log.md) · [Master Data](master-data.md)
