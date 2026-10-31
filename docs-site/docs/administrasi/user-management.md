# Pengelolaan akun pengguna

Hanya pengguna aktif dengan peran **Super Admin** dapat membuka **Manajemen Pengguna** dan mengubah akun. Perubahan penting dicatat dalam audit. Hak aplikasi harus mengikuti penugasan instansi; gelar Super Admin tidak otomatis menjadi kewenangan menandatangani surat atau memusnahkan arsip.

## Membuat akun

1. Buka **Administrasi → Manajemen Pengguna**, lalu **Tambah Pengguna**.
2. Isi nama, email unik, peran dan unit kerja yang sesuai penugasan. Jabatan dan NIP membantu identifikasi pejabat; mengisinya tidak membuat tanda tangan elektronik.
3. Untuk akun email/kata sandi, isi kata sandi minimal 8 karakter. Berikan kata sandi awal melalui saluran internal yang disetujui.
4. Simpan, lalu uji login serta akses menggunakan akun tersebut.

Metode login mengikuti penyedia autentikasi yang dikonfigurasi operator. Akun Better Auth dapat memakai email/kata sandi jika dibuat dengan kata sandi. Google hanya dapat digunakan jika integrasinya aktif dan identitas email sesuai. Jangan menganggap setiap akun baru otomatis dapat masuk melalui Google.

Pilihan peran hanya dua:

| Peran | Ruang lingkup |
|---|---|
| **Super Admin** | Administrasi lintas unit; unit kerja dikosongkan oleh sistem. |
| **Admin Unit Kerja** | Mengelola surat, arsip, dan fitur operasional pada satu unit kerja. Unit kerja wajib dipilih. |

Akun lama tetap mempertahankan hak aksesnya sampai Super Admin menetapkan peran baru. Admin Dirjen dan Admin Sesditjen lama tetap terbatas pada unit semula; akun Staff dan Auditor lama tidak otomatis mendapat kewenangan menulis. Pada dialog **Ubah Peran/Unit**, peran lama tampil dengan keterangan *(peran lama)* dan tidak tersedia untuk akun baru.

Akun yang menunggu persetujuan tampil dengan peran **Pengguna** dan belum memiliki akses data. Pilih **Menunggu persetujuan**, klik **Setujui akses**, lalu tetapkan peran dan unit kerjanya.

Unit kerja bukan sekadar isian pelengkap. Akun selain Super Admin yang belum ditugaskan pada unit tidak mendapatkan akses data. Arsip terbatas/rahasia juga mengikuti pemberian akses per arsip; peran umum tidak menjamin akses ke setiap dokumen.

## Mengubah dan menonaktifkan

Cari pengguna, buka menu tindakan, pilih **Ubah Peran/Unit**, ubah peran/unit/status sesuai penugasan, lalu simpan. Sistem membatasi perubahan yang akan menghilangkan Super Admin aktif terakhir dan membatalkan sesi yang terdampak perubahan akses.

Gunakan **Nonaktifkan** untuk menghentikan akses. Data identitas dan riwayat aktivitas tetap dipertahankan; tindakan ini bukan penghapusan permanen pengguna. Untuk mengaktifkan kembali, gunakan **Aktifkan** setelah penugasannya diperiksa.

## Pemeriksaan sebelum dipakai

Uji satu akun untuk setiap peran dan unit: login/logout, akses unit sendiri, penolakan unit lain, penolakan dokumen tanpa hak, perubahan peran dan penonaktifan akun saat masih memiliki sesi. Jangan menggunakan akun uji sebagai akun bersama untuk pekerjaan resmi.

[Audit Log](audit-log.md) · [Master Data](master-data.md)
