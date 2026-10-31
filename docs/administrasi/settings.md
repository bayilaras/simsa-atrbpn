# ⚙️ Settings

Panduan menggunakan halaman pengaturan SIMSA.

---

## Akses Settings

Menu **Pengaturan** (⚙️) muncul bagi semua akun yang sudah diprovisi. Anda juga dapat membukanya dari avatar di header. Tab yang tersedia menyesuaikan role.

1. Buka **Pengaturan** dari sidebar atau avatar di header.
2. Semua pengguna mendapat tab **Profil** dan **Preferensi**.
3. Admin Unit Kerja mendapat tab **Template** untuk unitnya. Super Admin mendapat tab **Template** untuk unit yang dipilih dan tab **Unit Kerja**.

---

## Tab Profil

Tab ini tersedia untuk **semua pengguna** yang login.

### Mengubah Nama

1. Buka tab **Profil**.
2. Ubah nama Anda di kolom **Nama**.
3. Klik **"Simpan Perubahan"**.

> 💡 Perubahan nama akan langsung berlaku di seluruh sistem.

### Ubah Kata Sandi

Kartu **Ubah Kata Sandi** ada di bawah profil dan berlaku untuk akun yang masuk dengan email dan kata sandi.

1. Isi **Kata sandi saat ini**.
2. Isi **Kata sandi baru** (8 sampai 128 karakter dan berbeda dari kata sandi saat ini), lalu ulangi pada **Konfirmasi kata sandi baru**.
3. Klik **"Simpan Kata Sandi"**.

> 💡 Setelah berhasil, sesi di perangkat lain ditutup; perangkat yang sedang Anda pakai tetap masuk. Pesan *Kata sandi saat ini salah.* berarti isian pertama keliru. Setelah terlalu banyak percobaan, tunggu beberapa menit.

Akun yang hanya masuk dengan Google tidak memiliki kata sandi SIMSA, sehingga kartu ini hanya menampilkan keterangan tanpa formulir. Bila perlu masuk dengan email dan kata sandi, atau lupa kata sandi saat ini, minta Super Admin memakai [Atur Ulang Kata Sandi](user-management.md#atur-ulang-kata-sandi).

---

## Tab Preferensi

Tab ini tersedia untuk **semua pengguna**. Tema, bahasa, notifikasi dalam aplikasi, dan pilihan email notifikasi disimpan pada akun sehingga konsisten pada sesi berikutnya. Email notifikasi tetap nonaktif sampai pengguna mengaktifkannya dan SMTP telah dikonfigurasi operator.

---

## Tab Unit Kerja

> 🔒 Hanya tersedia untuk **Super Admin**, yang mengelola data unit kerja lintas unit.

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
