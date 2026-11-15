# ⚙️ Pengaturan

Panduan menggunakan halaman pengaturan SIMSA.

---

## Akses Pengaturan

Menu **Pengaturan** (⚙️) di sidebar muncul bagi semua akun yang sudah aktif. Semua peran juga dapat membukanya dari menu akun (avatar) di kanan atas header. Tab yang tersedia menyesuaikan role.

1. Buka **Pengaturan** dari sidebar atau dari menu akun.
2. Semua pengguna mendapat tab **Profil** dan **Preferensi**.
3. Admin Unit Kerja mendapat tab **Template** untuk unitnya. Super Admin mendapat tab **Template** untuk unit yang dipilih dan tab **Unit Kerja**.

---

## Tab Profil

Tab ini tersedia untuk **semua pengguna** yang login.

### Mengubah Nama

1. Buka tab **Profil**.
2. Ubah nama Anda di kolom **Nama Lengkap**. Bila perlu, isi **URL Foto Profil**. Email tidak dapat diubah di sini.
3. Klik **"Simpan Profil"**.

> 💡 Perubahan nama akan langsung berlaku di seluruh sistem.

### Ubah Kata Sandi

Kartu **Ubah Kata Sandi** ada di bawah profil dan berlaku untuk akun yang masuk dengan email dan kata sandi.

1. Isi **Kata sandi saat ini**.
2. Isi **Kata sandi baru**, lalu ulangi pada **Konfirmasi kata sandi baru**. Kata sandi baru minimal 12 karakter (paling banyak 128), tidak memuat nama atau bagian depan email Anda, bukan kata sandi yang umum, dan berbeda dari kata sandi saat ini.
3. Klik **"Simpan Kata Sandi"**.

> 💡 Setelah berhasil, sesi di perangkat lain ditutup; perangkat yang sedang Anda pakai tetap masuk. Pesan *Kata sandi saat ini salah.* berarti isian pertama keliru. Setelah terlalu banyak percobaan, tunggu beberapa menit. Kata sandi lama yang lebih pendek dari 12 karakter tetap dapat dipakai untuk masuk sampai Anda menggantinya.

| Pesan | Yang perlu diperbaiki |
|-------|------------------------|
| Kata sandi minimal 12 karakter. | Perpanjang kata sandi |
| Kata sandi tidak boleh memuat nama pengguna. | Jangan memakai bagian dari nama Anda |
| Kata sandi tidak boleh memuat bagian depan alamat email (sebelum tanda @). | Jangan memakai bagian depan email Anda |
| Kata sandi ini terlalu umum dan mudah ditebak. Pilih kata sandi lain. | Pilih kata sandi yang tidak umum |
| Konfirmasi kata sandi tidak sama. | Ketik ulang kata sandi baru yang sama persis |

Akun yang hanya masuk dengan Google tidak memiliki kata sandi SIMSA, sehingga kartu ini hanya menampilkan keterangan tanpa formulir. Bila perlu masuk dengan email dan kata sandi, atau lupa kata sandi saat ini, minta Super Admin memakai [Atur Ulang Kata Sandi](user-management.md#atur-ulang-kata-sandi).

---

## Tab Preferensi

Tab ini tersedia untuk **semua pengguna**. Tema, bahasa antarmuka, notifikasi dalam aplikasi, dan notifikasi email disimpan pada akun sehingga tetap sama saat Anda masuk dari perangkat lain. Klik **"Simpan Preferensi"** setelah mengubahnya. Notifikasi email tetap nonaktif sampai pengguna mengaktifkannya dan layanan email sudah disiapkan operator.

---

## Tab Unit Kerja

> 🔒 Hanya tersedia untuk **Super Admin**, yang mengelola data unit kerja lintas unit.

Tab ini menampilkan daftar unit kerja yang terdaftar di sistem.

### Mengedit Unit Kerja

1. Pilih unit kerja dari daftar.
2. Ubah **Nama Unit** atau **Deskripsi**, dan atur dua pilihan berikut:
   - **Unit Pengawas (pencatat terpusat)** — admin unit ini dapat membaca rangkaian surat Ditjen, Sesditjen, dan seluruh direktorat.
   - **Dapat menerima distribusi** — unit muncul sebagai tujuan disposisi dan distribusi.
3. Klik **"Simpan Perubahan"**.

---

## Tab Template Surat

> 🔒 Tersedia untuk admin sesuai cakupan unit kerja.

Tab ini mengelola format nomor otomatis surat masuk dan keluar. Nomor manual tetap dapat digunakan; bila nomor dikosongkan, nomor dibentuk dari template unit dan tanggal surat.

### Mengelola Template

1. Buka tab **Template**.
2. Perbarui **Format Nomor Surat Masuk** dan **Format Nomor Surat Keluar** dengan variabel yang didukung, misalnya `{noUrut}`, `{tahun}`, `{bulan}`, dan `{naskahDinas}`. Contoh hasilnya tampil di bawah isian.
3. Klik **"Simpan Template"**, lalu uji pembuatan surat tanpa nomor manual.

---

[⬅️ Sebelumnya: User Management](user-management.md)
