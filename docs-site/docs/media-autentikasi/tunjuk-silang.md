# 🔗 Tunjuk Silang

Panduan membuat tunjuk silang antar dokumen.

---

## Apa Itu Tunjuk Silang?

Tunjuk silang adalah catatan yang **menghubungkan dokumen-dokumen yang saling berkaitan**: arsip, surat masuk, surat keluar, dan dosir. Dengan tunjuk silang, dokumen terkait mudah ditelusuri tanpa menggandakan arsip.

Contoh:
- Surat keluar yang merupakan **balasan** dari surat masuk
- Arsip lampiran yang **melengkapi** arsip utama
- Berkas yang **berkaitan** dengan sebuah dosir

Menu ini tersedia bagi Super Admin dan Admin Unit Kerja.

---

## Cara Membuat Tunjuk Silang

### Langkah 1: Buka Menu
Di sidebar, klik **Tunjuk Silang** di bawah **Media & Autentikasi**.

### Langkah 2: Buat Tunjuk Silang Baru

1. Klik **"Tambah Tunjuk Silang"**.
2. Pada **Dokumen sumber**, pilih jenisnya (**Arsip**, **Surat Masuk**, **Surat Keluar**, atau **Dosir**), ketik nomor atau perihal di kotak cari, lalu klik hasilnya. Dokumen terpilih tampil dengan tombol **Ganti**.
3. Pada **Dokumen tujuan**, pilih dokumen dengan cara yang sama. Dokumen tujuan dicari dalam unit kerja dokumen sumber; sebelum sumber dipilih tertulis *Pilih dokumen sumber terlebih dahulu.*
4. Pilih **Jenis hubungan**:

| Jenis | Keterangan |
|-------|------------|
| **Balasan** | Salah satu dokumen membalas dokumen lainnya |
| **Tindak Lanjut** | Salah satu dokumen menindaklanjuti dokumen lainnya |
| **Lampiran** | Salah satu dokumen adalah lampiran dokumen lainnya |
| **Referensi** | Salah satu dokumen merujuk dokumen lainnya |
| **Revisi** | Salah satu dokumen memperbaiki dokumen lainnya |
| **Duplikat** | Kedua dokumen berisi hal yang sama |
| **Berkaitan** | Hubungan lain yang perlu dicatat |

5. Isi **Keterangan (opsional)**.
6. Klik **"Simpan Tunjuk Silang"**. Bila berhasil, tampil pesan *Tunjuk silang berhasil ditambahkan*.

### Tanda pada Hasil Pencarian Dokumen

| Tanda | Arti |
|-------|------|
| **Perlu persetujuan akses** | Dokumen berkelas Terbatas atau lebih tinggi. Dokumen tetap dapat dipilih, tetapi hanya dapat ditelusuri atau ditautkan selama kamu memegang persetujuan akses yang masih berlaku |
| **Tidak dapat ditautkan** | Dokumen tidak dapat dipilih pada dialog tambah |
| **Dokumen sumber** | Dokumen yang sudah dipilih sebagai sumber, sehingga tidak dapat dipilih lagi sebagai tujuan |

Bila tidak ada hasil, tertulis bahwa tidak ada dokumen yang cocok atau belum ada dokumen dalam jangkauan kamu. Bila pencarian gagal, klik **Coba lagi**.

Bila penyimpanan ditolak untuk dokumen berkelas Terbatas atau lebih tinggi, ajukan dahulu persetujuan akses untuk mengelola dokumen itu melalui [Persetujuan Akses](../administrasi/persetujuan-akses.md).

---

## Melihat Tunjuk Silang

### Dari Halaman Tunjuk Silang

- Daftar di halaman ini menampilkan setiap hubungan beserta judul atau perihal dokumen, jenisnya, dan nomornya. Klik nama dokumen untuk membuka halaman rincinya.
- Pada tab **Cari & Telusuri**, pilih jenis dokumen, cari, lalu klik dokumennya. Hasil menampilkan jumlah tunjuk silang yang dapat kamu lihat, dengan arah **Menunjuk Ke** atau **Ditunjuk Oleh**.
- Dokumen yang tidak boleh kamu baca tampil sebagai *Dokumen lain (tidak dalam jangkauan Anda)* tanpa tautan.

Bila tidak ada yang dapat ditampilkan, tertulis **Tidak Ada yang Dapat Ditampilkan**. Untuk dokumen berkelas Terbatas atau lebih tinggi, tunjuk silangnya hanya dapat ditelusuri selama kamu memegang persetujuan akses yang masih berlaku.

### Dari Halaman Rinci Surat atau Arsip

Halaman detail surat masuk, surat keluar, dan arsip memiliki kartu **Tunjuk Silang** yang hanya untuk dibaca. Kartu ini memuat hubungan yang masih berlaku: arah (**Menunjuk ke** / **Ditunjuk oleh**), jenis hubungan, nama dokumen, dan keterangan. Pengelola mendapat tautan **Buka halaman Tunjuk Silang**. Bila kosong, tertulis *Tidak ada tunjuk silang yang dapat Anda lihat untuk dokumen ini.*

---

## Membatalkan Tunjuk Silang

Tunjuk silang yang keliru tidak dihapus, tetapi dibatalkan:

1. Pada baris tunjuk silang, pilih tindakan pembatalan.
2. Pada dialog **Batalkan Tunjuk Silang**, isi **Alasan pembatalan** (minimal 10 karakter).
3. Klik **"Batalkan Tunjuk Silang"**.

Setelah berhasil tampil pesan *Tunjuk silang dibatalkan*. Catatan lama tetap disimpan sebagai jejak koreksi.

---

[⬅️ Sebelumnya: Autentikasi Arsip](autentikasi.md) | [Selanjutnya: Laporan ➡️](../administrasi/laporan.md)
