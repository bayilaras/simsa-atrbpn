# Login dengan email dan kata sandi

Gunakan akun pribadi yang dibuat Super Admin melalui **Administrasi → Manajemen Pengguna → Tambah Pengguna**. Akun harus aktif, memiliki kata sandi untuk login email, serta peran dan unit kerja sesuai penugasan.

## Buka dan masuk

1. Buka `https://simsa-frontend.vercel.app` di browser.
2. Isi **Email kedinasan** dan **Kata sandi**.
3. Klik **Masuk**. Setelah berhasil, periksa peran dan unit kerja Anda sebelum mencatat data.

Login Google hanya digunakan jika integrasinya sudah dikonfigurasi. Aplikasi tidak menyediakan pendaftaran mandiri dengan email dan kata sandi; login Google pertama dengan email baru hanya membuat akun yang menunggu persetujuan Super Admin. Akun uji tidak digunakan sebagai akun bersama untuk pekerjaan resmi.

## Jika gagal

- Periksa ejaan email, kata sandi, dan status akun bersama administrator. Jangan mengirim kata sandi atau tangkapan layar yang memperlihatkannya.
- Jika muncul **Origin tidak diizinkan**, pastikan alamat halaman persis `https://simsa-frontend.vercel.app` atau laporkan alamat halaman kepada operator. Mengganti kata sandi tidak memperbaiki kesalahan alamat ini.
- Jika halaman tidak dapat dibuka, sampaikan waktu kejadian dan pesan yang tampil kepada operator.
- Jika akun belum memiliki peran/unit yang benar, minta Super Admin menyesuaikannya dengan penugasan.

## Lupa kata sandi

SIMSA tidak mengirim email untuk mengatur ulang kata sandi. Di bawah kolom **Kata sandi** tertulis *Lupa kata sandi? Hubungi Super Admin untuk mengatur ulang kata sandi Anda.*

1. Minta Super Admin memakai [Atur Ulang Kata Sandi](../administrasi/user-management.md#atur-ulang-kata-sandi). Super Admin menyampaikan kata sandi baru secara langsung, dan semua sesi Anda ditutup.
2. Bila email akun Anda juga akun Google, Anda tetap dapat masuk dengan **Masuk dengan Google**. Cara ini tidak memulihkan kata sandi, karena mengubah kata sandi memerlukan kata sandi saat ini.
3. Setelah masuk dengan kata sandi dari Super Admin, ganti kata sandi itu di [Pengaturan → Profil → Ubah Kata Sandi](../administrasi/settings.md#ubah-kata-sandi).

Setelah selesai, buka menu avatar dan pilih **Keluar**, terutama pada komputer bersama.

[Pengelolaan akun](../administrasi/user-management.md) · [Login Google](login-google.md)
