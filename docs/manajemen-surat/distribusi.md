# 🔄 Distribusi Surat

Panduan cara mendistribusikan (mendisposisikan) surat ke unit kerja lain.

---

## Apa Itu Distribusi?

Distribusi adalah proses **meneruskan surat masuk** kepada unit kerja lain yang perlu menindaklanjuti surat tersebut. Di aplikasi, tindakan ini bernama **Disposisi ke Direktorat**.

---

## Alur Distribusi

```
📨 Surat Masuk     →    📤 Disposisikan     →    📥 Muncul di Kotak Masuk
   Diterima               ke Unit Tujuan          Distribusi unit tujuan
```

---

## Cara Mendistribusikan Surat

### Langkah 1: Buka Dialog Disposisi

Pilih salah satu cara:

- Di daftar **Surat** > **Surat Masuk**, klik menu tiga titik (⋯) pada baris surat, lalu pilih **Distribusi**.
- Di halaman detail surat masuk, klik **Tindak Lanjut**, lalu pilih **Disposisi ke Direktorat**.

Dialog **Disposisi ke Direktorat** terbuka dan menampilkan nomor serta perihal surat.

### Langkah 2: Pilih Tujuan

1. Centang satu atau beberapa **Unit tujuan**.
2. Bila perlu, pilih satu unit sebagai **Penanggung jawab (Unit Pengolah)**.
3. Isi **Batas waktu** bila ada tenggat.
4. Tulis **Instruksi / Catatan**, atau klik pilihan instruksi yang tersedia.
5. Klik **"Disposisikan"**.

Batas waktu (opsional) menentukan urgensi notifikasi: mendesak saat tersisa 2 hari atau kurang dan saat lewat batas waktu.

Untuk surat bersifat Terbatas, Rahasia, atau Sangat Rahasia, disposisi sekaligus mengajukan permohonan akses bagi admin unit tujuan dan menunggu persetujuan Super Admin.

### Langkah 3: Selesai!

Surat akan muncul di **Kotak Masuk** halaman Distribusi unit kerja tujuan. Disposisi juga dapat diisi langsung saat mencatat surat masuk, lewat isian **Disposisi ke** pada form.

---

## Melihat Kotak Masuk dan Kotak Keluar

### Langkah 1: Buka Menu Distribusi

1. Di sidebar, klik menu **Distribusi**. Halaman **Distribusi Surat** terbuka.

### Langkah 2: Pilih Tab

- **Kotak Masuk** — surat yang didistribusikan kepada unit kamu dan perlu ditindaklanjuti. Centang **Lewat batas waktu** untuk hanya menampilkan yang terlambat.
- **Kotak Keluar** — surat yang kamu distribusikan ke unit lain.

Kotak cari di halaman ini hanya menyaring halaman yang sedang ditampilkan.

### Langkah 3: Tindaklanjuti

Gunakan tombol ikon di kolom **Aksi** pada Kotak Masuk:

| Tombol | Fungsi |
|--------|--------|
| **Terima Surat** | Menandai surat sudah diterima |
| **Buat Tindak Lanjut** | Membuka form surat keluar yang terhubung dengan surat ini |
| **Penyelesaian** | Menutup disposisi dengan memilih surat keluar yang sudah disetujui, atau dengan catatan penyelesaian (minimal 10 karakter) |
| **Tolak & Kembalikan** | Mengembalikan surat ke pengirim; alasan penolakan wajib diisi |

### Status Disposisi

| Status | Keterangan |
|--------|------------|
| **Menunggu** | Belum diterima unit tujuan |
| **Diterima** | Sudah diterima, belum selesai |
| **Selesai** | Sudah diselesaikan |
| **Ditolak** | Dikembalikan ke pengirim |

Surat yang isinya belum boleh kamu baca tampil sebagai **Dikecualikan**.

### Mengekspor Rekap Disposisi

Rekap tindak lanjut disposisi dapat diunduh untuk pelaporan. Tombolnya hanya tampil bagi admin unit, Super Admin, dan auditor.

1. Buka tab **Kotak Masuk** atau **Kotak Keluar**. Di Kotak Masuk, centang **Lewat batas waktu** bila hanya disposisi terlambat yang diperlukan.
2. Klik **Ekspor Excel** atau **Ekspor PDF** di kanan atas halaman.

Berkas memuat **seluruh** disposisi pada kotak yang sedang dibuka sesuai penyaringnya, bukan hanya halaman yang tampil. Kata kunci di kotak cari tidak ikut menyaring berkas.

| Kolom | Isi |
|-------|-----|
| **Nomor Surat**, **Perihal** | Surat yang didisposisikan |
| **Unit Asal**, **Unit Tujuan** | Unit pengirim dan penerima disposisi |
| **Instruksi** | Instruksi saat disposisi dibuat |
| **Catatan** | Catatan penyelesaian, atau alasan penolakan untuk disposisi yang ditolak |
| **Batas Waktu**, **Status** | Tenggat dan status disposisi (Menunggu, Diterima, Selesai, Ditolak) |
| **Tanggal Dikirim**, **Tanggal Diterima**, **Tanggal Selesai** | Waktu tiap tahap dalam WIB |
| **Lewat Batas** | **Ya** bila disposisi belum selesai dan batas waktunya sudah lewat; selain itu **Tidak** |

- Surat yang tampil sebagai **Dikecualikan** di layar juga tertulis **Dikecualikan** di berkas: nomor, perihal, instruksi, dan catatannya tidak ikut diekspor. Unit, status, tanggal, dan batas waktunya tetap tercantum.
- Ekspor dibatasi 10.000 baris dan setiap ekspor tercatat di Audit Log beserta penyaringnya.

---

[⬅️ Sebelumnya: Surat Keluar](surat-keluar.md) | [Selanjutnya: Arsip Aktif ➡️](../siklus-arsip/arsip-aktif.md)
