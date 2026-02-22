# 📨 Surat Masuk

Panduan lengkap cara mengelola surat masuk di SIMSA.

---

## Melihat Daftar Surat Masuk

### Langkah 1: Buka Menu Surat Masuk

1. Di sidebar, klik menu **Surat** (ada ikon ▼).
2. Sub-menu akan terbuka, klik **Surat Masuk**.

### Langkah 2: Lihat Daftar Surat

Kamu akan melihat tabel daftar surat masuk:

:::tip Tampilan Halaman Surat Masuk
Halaman ini menampilkan:
- **Header** dengan judul "Surat Masuk" dan tombol **"+ Tambah Surat Masuk"** berwarna biru di kanan atas
- **Bar pencarian & filter**: kolom pencarian, dropdown filter status, dan filter tanggal
- **Tabel data** dengan kolom: No, No Surat, Tanggal, Pengirim, Status (🟢 Selesai / 🔵 Diproses / 🟡 Didistribusikan), dan Aksi (👁️ Lihat, ✏️ Edit, 🗑 Hapus)
- **Pagination** di bagian bawah tabel
:::

### Fitur di Halaman Ini:

| Fitur | Keterangan |
|-------|------------|
| **Pencarian** 🔍 | Ketik kata kunci untuk mencari berdasarkan nomor surat, perihal, atau pengirim |
| **Filter Status** | Saring berdasarkan status: Diproses, Selesai, Didistribusikan |
| **Filter Tanggal** | Saring berdasarkan rentang tanggal |
| **Pagination** | Navigasi halaman jika data lebih dari 10 |

---

## Menambah Surat Masuk Baru

### Langkah 1: Klik Tombol Tambah

Klik tombol **"+ Tambah Surat Masuk"** berwarna biru di pojok kanan atas.

### Langkah 2: Isi Form Surat Masuk

Form akan muncul dengan kolom-kolom berikut:

| Kolom | Keterangan | Wajib |
|-------|-----------|:-----:|
| **Nomor Surat** | Nomor sesuai tertera di surat fisik | ✅ |
| **Tanggal Surat** | Tanggal yang tertulis di surat | ✅ |
| **Tanggal Terima** | Tanggal surat diterima di unit kerja | ✅ |
| **Pengirim** | Nama instansi / perorangan pengirim | ✅ |
| **Perihal** | Subjek / topik surat | ✅ |
| **Klasifikasi** | Pilih kode klasifikasi dari dropdown | ✅ |
| **Sifat Surat** | Biasa / Segera / Sangat Segera | ✅ |
| **Lampiran** | Upload file surat (PDF, gambar, dll) | ❌ |

:::tip Tampilan Form Tambah Surat Masuk
Form ini berisi kolom-kolom input yang harus diisi:
- **Nomor Surat**, **Tanggal Surat**, **Tanggal Terima** (dengan date picker 📅)
- **Pengirim**, **Perihal** (kolom teks)
- **Klasifikasi** (dropdown pilihan kode)
- **Sifat Surat** (radio button: Biasa / Segera / Sangat Segera)
- **Lampiran** (area drag & drop untuk upload file 📎)
- Tombol **"Batal"** dan **"Simpan"** di bagian bawah
:::

### Langkah 3: Upload Lampiran (Opsional)

1. Klik area **drag & drop** atau seret file ke area tersebut.
2. File yang didukung: **PDF, JPG, PNG, DOCX**.
3. Bisa upload **lebih dari satu** file.

### Langkah 4: Simpan

1. Periksa kembali semua data yang sudah diisi.
2. Klik tombol **"Simpan"** berwarna biru.
3. Jika berhasil, kamu akan kembali ke daftar surat masuk dan surat baru akan muncul.

---

## Melihat Detail Surat Masuk

### Langkah 1: Klik Surat

Klik **ikon mata** (👁️) pada kolom Aksi, atau klik langsung pada baris surat.

### Langkah 2: Lihat Detail

Halaman detail menampilkan semua informasi surat, termasuk lampiran yang bisa diunduh.

### Tombol Aksi di Detail:

| Tombol | Fungsi | Akses |
|--------|--------|-------|
| **Edit** | Ubah data surat | Staff, Admin |
| **Distribusikan** | Kirim surat ke unit lain | Staff, Admin |
| **Arsipkan** | Pindahkan ke arsip | Staff, Admin |
| **Hapus** | Hapus surat | Admin saja |

---

## Mengedit Surat Masuk

1. Klik **ikon pensil** (✏️) di kolom Aksi, atau klik **"Edit"** di halaman detail.
2. Ubah data yang diperlukan.
3. Klik **"Simpan"** untuk menyimpan perubahan.

---

## Menghapus Surat Masuk

1. Klik **ikon tempat sampah** (🗑) di kolom Aksi.
2. Akan muncul dialog konfirmasi.
3. Klik **"Hapus"** untuk mengonfirmasi.

> ⚠️ **Perhatian:** Penghapusan surat **tidak bisa dibatalkan**. Pastikan kamu yakin sebelum menghapus.

---

[⬅️ Sebelumnya: Role & Hak Akses](../tutorial-dasar/role-hak-akses.md) | [Selanjutnya: Surat Keluar ➡️](surat-keluar.md)
