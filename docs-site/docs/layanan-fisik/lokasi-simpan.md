# 📍 Lokasi Simpan

Panduan mengelola lokasi penyimpanan arsip fisik.

> 🔒 Menu **Lokasi Simpan** hanya tersedia bagi Super Admin dan Admin Unit Kerja.

---

## Apa Itu Lokasi Simpan?

Lokasi simpan adalah **daftar tempat penyimpanan fisik** arsip di unit kerja kamu, disusun bertingkat:

- **Gedung**
- **Ruang**
- **Rak**
- **Box** (boks arsip)

Daftar ini dipakai saat mengarsipkan surat dan saat mengubah metadata arsip, sehingga setiap arsip dapat ditautkan ke tempat simpannya.

---

## Melihat Daftar Lokasi

1. Di sidebar, klik **Lokasi Simpan** di bawah **Layanan & Fisik**. Halaman **Lokasi Penyimpanan** terbuka. Super Admin memilih unit kerja terlebih dahulu.
2. Lokasi tampil sebagai susunan bertingkat. Klik sebuah lokasi untuk membuka atau menutup sub-lokasinya, atau cari dengan kode atau nama lokasi.

Pada setiap baris terlihat:

| Keterangan | Arti |
|------------|------|
| Kode dan nama | Kode lokasi (misalnya `G1-R2-RAK3-B15`) dan namanya |
| **Isi: N / kapasitas** | Khusus boks: jumlah arsip yang tertaut dibanding kapasitasnya |
| **Arsip: N** | Tingkat lain: jumlah arsip di lokasi itu, termasuk sub-lokasinya |

Angka dihitung dari arsip yang benar-benar tertaut ke lokasi itu, sesuai unit kerja dan kewenangan kelas kamu. Di layar lebar, di sampingnya tampil rincian jumlah arsip surat masuk dan arsip surat keluar.

Tombol ikon **Lihat arsip di lokasi ini** membuka daftar Arsip yang sudah tersaring untuk lokasi tersebut.

---

## Menambah Lokasi Baru

1. Klik **"Tambah Lokasi"**, atau klik ikon **Tambah Sub-lokasi** pada lokasi induk.
2. Pilih **Level**, lalu isi **Kode** dan **Nama**. Untuk boks, isi juga **Kapasitas**. **Keterangan** boleh dikosongkan.
3. Klik **"Tambah"**.

Membuat lokasi tidak otomatis memindahkan arsip. Arsip ditautkan ke lokasi lewat pilihan **Lokasi Simpan** saat [mengarsipkan surat](../siklus-arsip/arsip-aktif.md#mengarsipkan-surat) atau lewat **Ubah Metadata** pada detail arsip.

---

## Mengedit & Menghapus

1. Klik ikon **Edit** atau **Hapus** pada baris lokasi.
2. Ubah data lalu klik **"Simpan Perubahan"**, atau konfirmasi penghapusan.

Lokasi yang masih ditautkan arsip tidak dapat dihapus:

| Pesan | Tindakan |
|-------|----------|
| Lokasi tidak dapat dihapus karena masih menyimpan arsip. Pindahkan arsipnya terlebih dahulu. | Ubah lokasi simpan arsip-arsip itu, lalu ulangi |
| Lokasi tidak dapat dihapus karena masih ditautkan ke arsip yang tidak dapat Anda kelola. Hubungi Super Admin. | Minta Super Admin memeriksa arsip yang tersisa |
| Lokasi tidak dapat dihapus karena masih ditautkan ke arsip yang penyusutannya sudah dilaksanakan. Catatan arsip tersebut tidak dapat diubah lagi. | Lokasi dipertahankan |

---

## QR Code dan Detail Lokasi

Ikon **QR Code** pada baris lokasi menampilkan kode yang dapat diunduh lewat **Download QR Code** dan ditempel pada rak atau boks. Memindai kode itu membuka halaman detail lokasi.

Halaman detail menampilkan kode, jenis lokasi, unit kerja, keterangan, kapasitas, dan **Jumlah arsip (termasuk sub-lokasi)**, misalnya *4: 3 arsip surat masuk, 1 arsip surat keluar*. Dari sini kamu dapat membuka daftar arsipnya: satu tombol **Lihat arsip di lokasi ini**, atau dua tombol terpisah untuk arsip surat masuk dan arsip surat keluar bila lokasi menyimpan keduanya.

---

[⬅️ Sebelumnya: Peminjaman](peminjaman.md) | [Selanjutnya: Arsip Vital & Terjaga ➡️](arsip-vital-terjaga.md)
