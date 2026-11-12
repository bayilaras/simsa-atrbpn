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
- **Header** dengan judul "Surat Masuk" dan deretan tombol: **Refresh**, **Impor dari Google Sheets**, **Impor CSV/XLSX**, **Export**, dan **Surat Baru**. Tombol impor dan **Surat Baru** hanya tampil bagi admin; Super Admin juga melihat pilihan **Unit kerja**
- **Empat kartu ringkasan**: Total Surat, Perlu Tindakan, Sudah Dibalas, dan Diarsipkan
- **Kotak pencarian** dan tombol **Filter**
- **Tabel data** dengan kolom: No., Tanggal, Nomor Surat, Perihal & Pengirim, Status, dan Aksi
- **Pagination** di bagian bawah tabel
:::

Kolom **Status** berisi **Belum Diproses** atau **Sudah Dibalas**. Surat yang sudah diarsipkan mendapat tanda tambahan **Arsip**.

### Fitur di Halaman Ini:

| Fitur | Keterangan |
|-------|------------|
| **Pencarian** 🔍 | Ketik kata kunci untuk mencari berdasarkan nomor surat, perihal, atau pengirim |
| **Filter** | Klik **Filter** untuk menyaring menurut Tahun, Jenis Surat, Status (Belum Diproses / Sudah Dibalas), Sifat Surat, Rentang Tanggal, dan Disposisi Ke |
| **Menu tiga titik** (⋯) | Tindakan untuk satu surat: **Detail & File**, **Edit Surat**, **Distribusi**, **Arsipkan**, dan **Hapus Surat**. Selain **Detail & File**, pilihan hanya tampil bagi admin |
| **Pagination** | Navigasi halaman jika data lebih dari 10 |

---

## Menambah Surat Masuk Baru

### Langkah 1: Klik Tombol Tambah

Klik tombol **"Surat Baru"** di pojok kanan atas. Halaman **Tambah Surat Masuk** terbuka.

### Langkah 2: Isi Form Surat Masuk

Form terbagi menjadi beberapa bagian:

| Kolom | Keterangan | Wajib |
|-------|-----------|:-----:|
| **Jenis Surat** | Jenis naskah dinas surat yang diterima | ✅ |
| **Sifat Surat** | Biasa / Segera / Sangat Segera / Terbatas / Rahasia / Sangat Rahasia / Undangan / Penting. Terbatas, Rahasia, dan Sangat Rahasia adalah kelas keamanan surat. Admin Unit Kerja dapat memilih Terbatas; Rahasia dan Sangat Rahasia hanya dapat ditetapkan oleh Super Admin, dan Admin Unit Kerja tidak melihat kedua pilihan itu kecuali sifat itu sudah tersimpan pada surat. Surat Terbatas, Rahasia, atau Sangat Rahasia hanya dapat dibuka atau diubah dengan persetujuan akses berjangka, juga oleh pencatatnya; ajukan persetujuan akses setelah menyimpan. | ✅ |
| **Nomor Surat** | Nomor sesuai tertera di surat. Bila dikosongkan, nomor dibuat otomatis dari template unit | ❌ |
| **Tanggal Surat** | Tanggal yang tertulis di surat | ✅ |
| **Perihal** | Subjek / topik surat | ✅ |
| **Nomor Referensi (surat kita)** | Diisi bila surat ini membalas surat keluar unit kamu. Hanya ada saat menambah surat | ❌ |
| **Dari (Pengirim)** | Nama instansi / perorangan pengirim | ✅ |
| **Kepada (Penerima)** | Unit kerja / pejabat penerima | ✅ |
| **Keterangan** | Pilihan keterangan, misalnya Tembusan | ❌ |
| **Disposisi ke** | Unit tujuan disposisi. Setelah unit dipilih, tampil pilihan **Penanggung jawab (Unit Pengolah)**, **Batas waktu**, dan **Instruksi disposisi** (paling banyak 2000 karakter) | ❌ |
| **Klasifikasi** | Pasangan klasifikasi arsip dan JRA. Pilihan ini diteruskan saat surat diarsipkan | ❌ |
| **Link Dokumen** | Alamat lengkap dokumen, misalnya `https://contoh.go.id/berkas` | ❌ |
| **Upload Berkas** | Hasil pindai surat dalam bentuk PDF, paling besar 10 MiB | ❌ |

:::tip Tampilan Form Tambah Surat Masuk
Form ini berisi lima bagian bernomor:
1. **Jenis & Sifat Surat**
2. **Identitas Surat** (Nomor Surat, Tanggal Surat, Perihal)
3. **Pengirim & Penerima** (termasuk Keterangan dan Disposisi ke)
4. **Klasifikasi Arsip**
5. **Lampiran Dokumen** (Link Dokumen dan Upload Berkas)

Tombol **"Batal"** dan **"Simpan"** ada di bagian bawah. Bagian Lampiran Dokumen hanya tampil bila penyimpanan berkas sudah disiapkan operator.
:::

### Langkah 3: Lampiran (Opsional)

1. Isi **Link Dokumen**, atau klik area **Upload Berkas** lalu pilih berkas. Berkas juga dapat diseret ke area tersebut.
2. Berkas yang didukung hanya **PDF**, satu berkas per surat.
3. Di bagian ini tertulis *Catatan: Link dokumen dan berkas tidak wajib diisi.* Selama keduanya masih kosong, tampil juga petunjuk *Surat dapat disimpan tanpa lampiran; hasil pindai dapat ditambahkan nanti lewat menu Edit Surat.*

### Langkah 4: Simpan

1. Periksa kembali semua data yang sudah diisi.
2. Klik tombol **"Simpan"**.
3. Jika berhasil, tampil pesan *Berhasil! Surat masuk telah disimpan ke sistem.* dan surat baru muncul di daftar.

### Jika Surat Belum Dapat Disimpan

Isian yang ditolak ditandai langsung di bawah isiannya, dan di bagian atas form tampil ringkasan *Surat belum dapat disimpan. Periksa isian berikut: ...*. Contoh pesannya:

| Pesan | Yang perlu diperbaiki |
|-------|------------------------|
| Perihal wajib diisi / Pengirim wajib diisi / Tanggal surat wajib diisi | Lengkapi isian tersebut |
| Tanggal tidak valid | Pilih ulang tanggal surat |
| Penerima maksimal 255 karakter / Keterangan maksimal 2000 karakter | Persingkat isian |
| Link dokumen harus berupa alamat lengkap, misalnya https://contoh.go.id/berkas | Tulis alamat lengkap, atau kosongkan Link Dokumen |
| Unit tujuan disposisi wajib diisi / Unit tujuan disposisi tidak valid | Pilih ulang unit tujuan disposisi |
| Instruksi disposisi maksimal 2000 karakter | Persingkat instruksi |
| Disposisi tidak valid. Periksa unit tujuan dan batas waktunya. | Pilih paling banyak 10 unit tujuan dan periksa batas waktunya |

---

## Melihat Detail Surat Masuk

### Langkah 1: Buka Surat

Pada baris surat, klik **menu tiga titik** (⋯) di kolom Aksi, lalu pilih **Detail & File**.

### Langkah 2: Lihat Detail

Halaman **Detail Surat Masuk** menampilkan informasi surat, pratinjau berkas, panel **Alur Surat**, kartu **Tunjuk Silang**, serta kartu **Status** (Sudah Dibalas / Belum Dibalas dan Sudah Diarsipkan / Belum Diarsipkan).

### Tombol Aksi di Detail:

| Tombol | Fungsi | Akses |
|--------|--------|-------|
| **Edit** | Ubah data surat | Super Admin, Admin Unit Kerja |
| **Tindak Lanjut** | Menu berisi **Saya Balas**, **Buat Nota Dinas**, **Buat ND Penjelas**, **Disposisi ke Direktorat**, **Terima Disposisi**, **Penyelesaian**, dan **Tautkan ke Rangkaian**. Pilihan yang tampil mengikuti kewenangan kamu atas surat itu | Sesuai kewenangan |
| **Arsipkan** | Pindahkan ke arsip | Super Admin, Admin Unit Kerja |

Tombol yang sama juga ada di kartu **Aksi Cepat** di sisi kanan. Menghapus surat dilakukan dari daftar, bukan dari halaman detail.

### Jika Tampil "Perlu persetujuan akses"

Surat berkelas Terbatas, Rahasia, atau Sangat Rahasia tetap tampil di daftar, tetapi isinya baru dapat dibuka setelah permohonan akses kamu disetujui Super Admin. Halaman detail lalu menampilkan judul **Perlu persetujuan akses** beserta nomor dan perihal surat.

1. Klik **Minta Akses**. Halaman permohonan terbuka dengan surat itu sudah terpilih.
2. Pilih mode akses, tulis tujuan kedinasan, lalu kirim.
3. Pantau statusnya di menu **Persetujuan Akses Arsip**.

Memilih **Edit Surat** pada surat seperti ini juga membawa kamu ke halaman yang sama. Bila yang tampil **Surat Tidak Ditemukan**, surat itu milik unit lain, berada di atas kewenangan kelas peran kamu, atau memang tidak ada. Langkah lengkapnya ada di [Persetujuan Akses](../administrasi/persetujuan-akses.md).

---

## Membalas Surat Masuk

:::tip Tindak Lanjut
Menu **Tindak Lanjut** tersedia di header halaman detail dan di kartu **Aksi Cepat** di sisi kanan.
:::

### Langkah 1: Buka Detail Surat

Buka surat yang ingin dibalas lewat **Detail & File** pada daftar Surat Masuk.

### Langkah 2: Pilih Saya Balas

Klik **Tindak Lanjut**, lalu pilih **Saya Balas**.

### Langkah 3: Form Otomatis Terisi

Kamu akan diarahkan ke form **Tambah Surat Keluar** dengan data otomatis terisi:

| Kolom | Isi Otomatis |
|-------|-------------|
| **Perihal** | "Balasan: [Perihal Surat Masuk]" |
| **Kepada** | Nama pengirim surat masuk asal |
| **Nomor Referensi** | Surat masuk asal, sudah terpilih dan terkunci |

### Langkah 4: Lengkapi & Simpan

1. Isi kolom lainnya: **Naskah Dinas**, **Nomor Surat**, **Tanggal Surat**, dan lampiran bila ada.
2. Klik **"Simpan"** untuk menyimpan surat keluar balasan.

:::info
Setelah disimpan, status surat masuk otomatis berubah menjadi **"Sudah Dibalas"**.
:::

---

## Mengedit Surat Masuk

1. Pilih **Edit Surat** dari menu tiga titik (⋯) di daftar, atau klik **"Edit"** di halaman detail.
2. Ubah data yang diperlukan. Hasil pindai yang belum ada dapat ditambahkan di sini.
3. Klik **"Perbarui"** untuk menyimpan perubahan.

Sifat Rahasia atau Sangat Rahasia yang sudah tersimpan boleh dipertahankan. Bila diganti lalu disimpan, sifat itu hanya dapat dipilih kembali oleh Super Admin.

Bila surat sudah menjadi bagian dari rangkaian, perubahan nomor, perihal, atau sifat meminta **Alasan koreksi** dan dicatat.

---

## Menghapus Surat Masuk

1. Pilih **Hapus Surat** dari menu tiga titik (⋯) di kolom Aksi.
2. Pada dialog **Hapus Surat Masuk?**, isi **Alasan penghapusan** (minimal 10 karakter).
3. Klik **"Hapus"** untuk mengonfirmasi.

> ⚠️ **Perhatian:** Penghapusan surat **tidak bisa dibatalkan**. Pastikan kamu yakin sebelum menghapus.

---

[⬅️ Sebelumnya: Role & Hak Akses](../tutorial-dasar/role-hak-akses.md) | [Selanjutnya: Surat Keluar ➡️](surat-keluar.md)
