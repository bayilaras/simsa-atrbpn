# 📤 Surat Keluar

Panduan lengkap cara mengelola surat keluar di SIMSA.

---

## Melihat Daftar Surat Keluar

### Langkah 1: Buka Menu Surat Keluar

1. Di sidebar, klik menu **Surat** (ada ikon ▼).
2. Sub-menu akan terbuka, klik **Surat Keluar**.

### Langkah 2: Lihat Daftar Surat

Tabel daftar surat keluar mirip dengan surat masuk, dengan perbedaan:
- Kolom **"Penerima"** menggantikan kolom "Pengirim"
- Status persetujuan menampilkan **Draft**, **Menunggu Persetujuan**, **Disetujui**, atau **Ditolak**
- Aksi edit, hapus, dan arsip mengikuti status persetujuan

---

## Menambah Surat Keluar Baru

### Langkah 1: Klik Tombol Tambah

Klik tombol **"+ Tambah Surat Keluar"** berwarna biru di pojok kanan atas.

### Langkah 2: Isi Form Surat Keluar

| Kolom | Keterangan | Wajib |
|-------|-----------|:-----:|
| **Jenis Naskah Dinas** | Jenis naskah yang akan dikirim | ✅ |
| **Nomor Surat** | Nomor manual; kosongkan untuk nomor otomatis dari template unit | ❌ |
| **Tanggal Surat** | Tanggal surat dibuat | ✅ |
| **Penerima** | Tujuan pengiriman surat | ❌ |
| **Perihal** | Subjek / topik surat | ✅ |
| **Klasifikasi** | Pilih kode klasifikasi dari aturan aktif | ❌ |
| **Link Dokumen** | Tautan dokumen kerja bila diperlukan | ❌ |
| **Lampiran** | Upload file surat keluar | ❌ |

### Langkah 3: Simpan

1. Periksa kembali data.
2. Klik tombol **"Simpan"**.
3. Surat keluar baru akan muncul di daftar dengan status **Draft**.

---

## Persetujuan Internal Surat Keluar

1. Buka detail surat berstatus **Draft** atau **Ditolak**.
2. Klik **Ajukan Persetujuan** dan pilih administrator aktif lain yang tersedia pada unit surat.
3. Tambahkan catatan bila diperlukan, lalu kirim.
4. Penyetuju yang ditunjuk membuka surat dari antrean persetujuan dan memilih **Setujui** atau **Tolak**. Alasan wajib diisi saat menolak.
5. Jika ditolak, pembuat memperbaiki surat lalu mengajukannya ulang. Jika disetujui final, tombol **Arsipkan** tersedia.

Pembuat tidak boleh menjadi penyetuju suratnya sendiri. Surat **Menunggu Persetujuan** dan **Disetujui** terkunci dari edit/hapus, dan surat hanya dapat diarsipkan setelah disetujui final. Riwayat pengajuan, keputusan, catatan, dan pelaku dapat dilihat pada detail surat.

:::info Batas fitur
Alur ini adalah persetujuan proses internal. SIMSA tidak membuat tanda tangan elektronik dan tidak menggunakan BSrE/PSrE.
:::

---

## Membuat Surat Keluar sebagai Balasan

:::tip Fitur Baru v1.2
Selain membuat surat keluar baru secara manual, kamu bisa langsung **membalas surat masuk** dari halaman detailnya. Data form akan otomatis terisi!
:::

### Cara Cepat (dari Detail Surat Masuk):

1. Buka **Detail Surat Masuk** yang ingin dibalas.
2. Klik tombol **"Balas Surat"** (ikon ↩️).
3. Form Tambah Surat Keluar terbuka dengan **Perihal**, **Kepada**, dan **Referensi** otomatis terisi.
4. Lengkapi field lainnya dan klik **"Simpan"**.

Untuk panduan lengkap, lihat bagian [Membalas Surat Masuk](surat-masuk.md#membalas-surat-masuk).

---

## Melihat Detail Surat Keluar

1. Klik **ikon mata** (👁️) atau klik baris surat.
2. Lihat informasi lengkap surat beserta lampiran.
3. Lihat status serta riwayat persetujuan.
4. Gunakan aksi yang tersedia sesuai role dan status: **Edit/Hapus** untuk Draft atau Ditolak, **Setujui/Tolak** untuk penyetuju aktif, dan **Arsipkan** setelah Disetujui.

---

## Mengedit dan Menghapus

Edit dan hapus hanya tersedia bagi admin berwenang ketika surat masih **Draft** atau **Ditolak** dan belum diarsipkan. Saat surat **Menunggu Persetujuan** atau **Disetujui**, perubahan ditolak untuk menjaga konsistensi keputusan. Jangan menghapus surat hanya untuk memperbaiki metadata; gunakan edit pada status yang diizinkan agar jejak proses tetap dapat ditelusuri.

---

[⬅️ Sebelumnya: Surat Masuk](surat-masuk.md) | [Selanjutnya: Distribusi Surat ➡️](distribusi.md)
