# Onboarding Google pending — 14 September 2026

Login pertama melalui identitas Google terverifikasi dapat membuat akun SIMSA pending. Fitur ini harus diaktifkan secara eksplisit melalui `GOOGLE_PENDING_SIGNUP_ENABLED=true`; nilai bawaan adalah `false`. Flag ini tidak memberikan akses arsip, unit, atau peran operasional secara otomatis. Implementasi tidak membutuhkan migrasi database.

## Keadaan akun dan akses

| Keadaan | Perilaku backend |
| --- | --- |
| Google baru, email terverifikasi, flag aktif | Membuat identitas `role=user`, `unitKerjaId=null`, `isActive=true`. Input role, unit, dan aktivasi dari klien tidak diterima. |
| Google baru, flag mati | Menolak pendaftaran; akun yang sudah disiapkan administrator masih dapat login. |
| Email Google tidak terverifikasi | Menolak sebelum identitas baru dipersistenkan. |
| Akun pending | Dapat membaca identitas/status sesi sendiri dan keluar. UI menyediakan bantuan. API bisnis tetap menolak arsip, surat, pencarian, dashboard, ekspor, unduhan, profil bisnis, dan administrasi pengguna. Native Better Auth juga menolak perubahan profil dan administrasi akun/sesi. |
| Akun Google yang sudah disiapkan atau telah ditautkan | Mempertahankan peran dan unit SIMSA. Better Auth dapat menautkan email yang sama hanya dengan bukti email terverifikasi dari Google. |
| Akun nonaktif | Tidak diaktifkan kembali; pembuatan sesi baru ditolak dan API bisnis tetap menolak sesi lama. |
| Persetujuan administrator | Super Admin menetapkan peran secara eksplisit. Admin Unit juga membutuhkan unit yang dipilih secara eksplisit. Super Admin memiliki scope lintas unit (`null`). Akun harus aktif untuk mendapat akses bisnis. |
| Setelah persetujuan | Transaksi menyimpan perubahan dan audit serta menghapus sesi Better Auth. Pada Firebase, token dicabut setelah komit. Pengguna harus login kembali; tombol periksa ulang dapat kembali ke halaman login karena sesi telah dicabut. |

Daftar peran yang boleh diberikan tetap **Super Admin** dan **Admin Unit Kerja**. Peran lama tetap dapat dibaca untuk kompatibilitas; pendaftaran Google tidak mengubah matriks izin yang ada. Persetujuan dan penonaktifan menggunakan API manajemen pengguna yang sudah dilindungi, tanpa endpoint persetujuan publik baru. Filter `role=user` yang ada digunakan untuk menemukan akun pending.

## Dua provider autentikasi

Better Auth memakai `validateUserInfo` dari versi pustaka yang terpasang untuk menolak identitas OAuth tidak terverifikasi, baik pada alur ID token maupun callback authorization code. Hook pembuatan user memaksa status pending; hook itu tidak mengganti penugasan akun yang sudah ada. Hook sesi menolak akun nonaktif. Gate native membaca sesi authoritative dari database sebelum operasi profil atau akun.

Pada Firebase, pembuatan akun SIMSA hanya berasal dari token terverifikasi dengan `firebase.sign_in_provider=google.com`, email terverifikasi, dan flag aktif. UID menjadi referensi identitas; kecocokan email tidak boleh menautkan ulang UID yang berbeda atau mengambil alih akun lokal yang belum dipetakan. Pembuatan row pending dan audit berada dalam satu transaksi. Pemeriksaan ulang sesi tidak membuat akun. Provider password/custom yang belum dipetakan tetap ditolak.

Jika data Firebase lama mempunyai email yang sama tetapi UID berbeda atau belum dipetakan, rekonsiliasi administrator diperlukan. Implementasi ini tidak melakukan migrasi UID otomatis. Menonaktifkan flag kembali hanya menghentikan pendaftaran baru; identitas pending yang sudah ada tetap dapat membaca statusnya dan keluar, dengan seluruh API bisnis tetap ditolak.

Capability publik `authentication.pendingGoogleSignup` hanya bernilai `true` jika Google tersedia, konfigurasi valid, fitur diaktifkan, dan aplikasi bukan profil demo. Nilai flag salah eja menjadi kesalahan konfigurasi startup. Flag dan capability tidak mengandung kredensial provider.

## Berkas utama

- [Better Auth](../backend/src/config/auth.ts), [konfigurasi Google](../backend/src/config/google-oauth.ts), dan [capability publik](../backend/src/config/public-capabilities.ts).
- [Pendaftaran Firebase pending](../backend/src/services/pending-google-user.service.ts), [sesi Firebase](../backend/src/routes/firebase-auth.routes.ts), dan [identitas request](../backend/src/services/request-identity.service.ts).
- [Persetujuan pengguna](../backend/src/services/user-management.service.ts). [Middleware bisnis](../backend/src/middlewares/auth.middleware.ts) tetap menjadi penegak batas akses server.

## Verifikasi dan batas bukti

Pengujian lokal memakai data sintetis. Better Auth menjalankan handler asli, JWT RSA yang ditandatangani secara lokal, stub endpoint token/JWKS yang menolak tujuan lain, serta alur state cookie dan PKCE. Akun baru pending, callback akun Super Admin yang sudah ditautkan, email belum terverifikasi, flag mati, signup password publik, dan operasi native pending diuji. Integrasi PGlite membuktikan transaksi persetujuan, audit, sesi lama tidak berlaku, dan login baru mendapat peran/unit yang disetujui.

Integrasi Firebase memakai PGlite dengan hasil verifikasi identitas yang dikendalikan test. Cakupannya meliputi pendaftaran serentak tanpa duplikasi, rollback ketika audit gagal, benturan email/UID termasuk email lama dengan huruf besar, flag mati, akun nonaktif, serta pending mendapat HTTP 403 pada middleware bisnis. Pengujian yang sudah ada memeriksa pencabutan token Firebase setelah perubahan penugasan dan retry setelah kegagalan provider.

Bukti RED dan hasil akhir berada di folder `simsa-google-release-evidence-20260914` di samping kandidat. RED adalah pembuktian kebutuhan perilaku onboarding baru; jangan menghitung setiap assertion RED sebagai bug produksi. Pengujian ini tidak memakai login Google manusia, tidak memanggil layanan Google/Firebase nyata, dan tidak menjadi bukti bahwa callback produksi sudah diuji dari browser. Aktivasi flag, deployment, serta QA sesudah deployment dicatat terpisah oleh proses rilis.
