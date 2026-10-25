# Pengelolaan akun pengguna

Hanya pengguna aktif dengan peran **Super Admin** dapat membuka **Manajemen Pengguna** dan mengubah akun. Perubahan penting dicatat dalam audit. Hak aplikasi harus mengikuti penugasan instansi; gelar Super Admin tidak otomatis menjadi kewenangan menandatangani surat atau memusnahkan arsip.

## Membuat akun

1. Buka **Administrasi → Manajemen Pengguna**, lalu **Tambah Pengguna**.
2. Isi nama, email unik, peran dan unit kerja yang sesuai penugasan. Jabatan dan NIP membantu identifikasi pejabat; mengisinya tidak membuat tanda tangan elektronik.
3. Untuk akun email/kata sandi, isi kata sandi minimal 8 karakter. Berikan kata sandi awal melalui saluran internal yang disetujui.
4. Simpan, lalu uji login serta akses menggunakan akun tersebut.

Metode login mengikuti penyedia autentikasi yang dikonfigurasi operator. Akun Better Auth dapat memakai email/kata sandi jika dibuat dengan kata sandi. Google hanya dapat digunakan jika integrasinya aktif dan identitas email sesuai. Pembuatan akun Firebase melalui administrator memerlukan kata sandi. Jangan menganggap setiap akun baru otomatis dapat masuk melalui Google.

| Peran | Ruang lingkup |
|---|---|
| `super_admin` | Administrasi lintas unit; unit nominal dikosongkan oleh sistem. |
| `admin_dirjen` | Mandat tetap unit `ditjen`. |
| `admin_sesditjen` | Mandat tetap unit `sesditjen`. |
| `staff` | Membaca surat/arsip pada unit yang ditugaskan; tindakan layanan mengikuti izin modul. Tidak boleh mengubah arsip terjaga atau penyusutan. |
| `auditor` | Akses audit sesuai unit mandat yang diberikan. |
| `user` | Akun dengan akses paling terbatas; bukan pengganti peran petugas. |

Unit kerja bukan sekadar isian pelengkap. Petugas dan auditor yang belum ditugaskan pada unit tidak mendapatkan akses lintas unit. Arsip terbatas/rahasia juga mengikuti pemberian akses per arsip; peran umum tidak menjamin akses ke setiap dokumen.

## Mengubah dan menonaktifkan

Cari pengguna, pilih **Edit**, ubah peran/unit/status sesuai penugasan, lalu simpan. Sistem membatasi perubahan yang akan menghilangkan Super Admin aktif terakhir dan membatalkan sesi yang terdampak perubahan akses.

Gunakan **Nonaktifkan** untuk menghentikan akses. Data identitas dan riwayat aktivitas tetap dipertahankan; tindakan ini bukan penghapusan permanen pengguna. Untuk mengaktifkan kembali, gunakan **Aktifkan** setelah penugasannya diperiksa.

## Pemeriksaan sebelum dipakai

Uji satu akun untuk setiap peran dan unit: login/logout, akses unit sendiri, penolakan unit lain, penolakan dokumen tanpa hak, perubahan peran dan penonaktifan akun saat masih memiliki sesi. Jangan menggunakan akun uji sebagai akun bersama untuk pekerjaan resmi.

[Audit Log](audit-log.md) · [Master Data](master-data.md)
