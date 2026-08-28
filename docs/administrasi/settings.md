# ⚙️ Settings

Panduan menggunakan halaman pengaturan SIMSA.

---

## Akses Settings

Menu **Pengaturan** (⚙️) muncul bagi semua akun yang sudah diprovisi. Anda juga dapat membukanya dari avatar di header. Tab yang tersedia menyesuaikan role.

1. Buka **Pengaturan** dari sidebar atau avatar di header.
2. Semua pengguna mendapat tab **Profil** dan **Preferensi**.
3. Admin mendapat tab **Unit Kerja** dan **Template** sesuai cakupan unitnya; Super Admin dapat memilih lintas unit.

---

## Tab Profil

Tab ini tersedia untuk **semua pengguna** yang login.

### Mengubah Nama

1. Buka tab **Profil**.
2. Ubah nama Anda di kolom **Nama**.
3. Klik **"Simpan Perubahan"**.

> 💡 Perubahan nama akan langsung berlaku di seluruh sistem.

---

## Tab Preferensi

Tab ini tersedia untuk **semua pengguna**. Tema, bahasa, notifikasi dalam aplikasi, dan pilihan email notifikasi disimpan pada akun sehingga konsisten pada sesi berikutnya. Email notifikasi tetap nonaktif sampai pengguna mengaktifkannya dan SMTP telah dikonfigurasi operator.

---

## Tab Unit Kerja

> 🔒 Tersedia untuk admin. Admin biasa hanya dapat mengubah unit dalam cakupannya; Super Admin dapat mengelola lintas unit.

Tab ini menampilkan daftar unit kerja yang terdaftar di sistem.

### Mengedit Unit Kerja

1. Pilih unit kerja dari daftar.
2. Ubah nama, deskripsi, atau status penerimaan distribusi.
3. Klik **"Simpan Perubahan"**.

---

## Tab Template Surat

> 🔒 Tersedia untuk admin sesuai cakupan unit kerja.

Tab ini mengelola format nomor otomatis surat masuk dan keluar. Nomor manual tetap dapat digunakan; bila nomor dikosongkan, server membentuk nomor secara atomik dari template unit dan tanggal surat.

### Mengelola Template

1. Buka tab **Template**.
2. Perbarui format dengan placeholder yang didukung, misalnya `{noUrut}`, `{tahun}`, `{bulan}`, dan `{naskahDinas}`.
3. Simpan perubahan, lalu uji pembuatan surat tanpa nomor manual.

---

[⬅️ Sebelumnya: User Management](user-management.md)
