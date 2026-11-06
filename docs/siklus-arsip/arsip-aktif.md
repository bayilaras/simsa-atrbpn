# 🗂️ Arsip Aktif

Panduan mengelola arsip aktif yang berasal dari surat masuk dan surat keluar.

---

## Apa Itu Arsip Aktif?

Arsip aktif adalah **arsip yang masih digunakan secara langsung** dalam pelaksanaan tugas. Arsip ini berasal dari surat masuk atau surat keluar yang sudah selesai diproses dan dipindahkan ke arsip.

SIMSA membagi arsip aktif menjadi dua tab:
- **Arsip Surat Masuk** — Arsip yang berasal dari surat masuk
- **Arsip Surat Keluar** — Arsip yang berasal dari surat keluar

---

## Melihat Daftar Arsip

### Langkah 1: Buka Menu Arsip Aktif

1. Di sidebar, klik **Arsip Aktif** (ada ikon ▼).
2. Pilih **Arsip Surat Masuk** atau **Arsip Surat Keluar**.

### Langkah 2: Lihat Tabel Arsip

Tabel menampilkan:

| Kolom | Keterangan |
|-------|------------|
| Kode Klasifikasi | Kode sesuai JRA |
| Uraian Berkas | Deskripsi isi arsip |
| Tanggal | Tanggal arsip |
| Jumlah Item | Banyaknya berkas dalam arsip |
| Status | Aktif / Inaktif |
| Lokasi | Lokasi penyimpanan fisik |

### Ekspor Formulir 4 dan Formulir 6

Klik tombol **Export**, lalu pilih Excel (.xlsx) atau PDF pada formulir yang dibutuhkan. Isi ekspor mengikuti tab, unit, pencarian, dan tahun yang sedang dipilih.

| Formulir | Isi |
|----------|-----|
| **Formulir 4 — Daftar Arsip Aktif** | Arsip yang masa aktifnya belum berakhir. Kolom: No. Berkas, Kode Klasifikasi, Uraian Informasi Berkas, Kurun Waktu, Jumlah Berkas, Item Arsip (No. Item, Uraian Informasi Arsip, Tanggal, Jumlah), Tingkat Perkembangan, Lokasi Simpan, Tingkat Klasifikasi Keamanan & Akses, Keterangan |
| **Formulir 6 — Daftar Arsip Inaktif (Kertas)** | Arsip yang masa aktifnya sudah berakhir atau yang sudah dipindahkan ke penyimpanan inaktif. Kolom: No, Kode Klasifikasi, Uraian Informasi Arsip/Berkas, Kurun Waktu, Tingkat Perkembangan, Jumlah, Lokasi Simpan, Keamanan & Akses, Jangka Simpan & Nasib Akhir, Kategori Arsip, Keterangan |

Masa aktif baru dianggap berakhir bila klasifikasi/JRA arsip sudah terverifikasi dan peristiwa pemicu retensinya sudah diverifikasi. Arsip yang belum memenuhi syarat itu tetap tercantum di Formulir 4 sampai pemindahannya dicatat di SIMSA melalui modul Penyusutan. Pemindahan yang dilakukan di luar SIMSA, misalnya selama modul Penyusutan belum diaktifkan, tidak mengubah isi kedua formulir. Arsip yang penyusutannya sudah dilaksanakan tidak tercantum di kedua formulir.

Bila belum ada arsip inaktif untuk filter yang dipilih, Formulir 6 tidak diunduh. Di bawah tombol muncul keterangan "Belum ada arsip inaktif untuk filter ini…".

---

## Melihat Detail Arsip

### Langkah 1: Klik Arsip

Klik baris arsip untuk melihat detail.

### Langkah 2: Lihat Halaman Detail

```
┌─────────────────────────────────────────────────┐
│  📋 Detail Arsip                                │
│  Kode: KL.01.02 | 15 Item | Status: Aktif      │
│                                                 │
│  [Ubah Metadata] [Lihat Surat Asli]             │
├─────────────────────────────────────────────────┤
│  [Informasi]  [Item Berkas]  [Riwayat]  ← Tab  │
├─────────────────────────────────────────────────┤
│                                                 │
│  Kode Klasifikasi : KL.01.02                    │
│  Uraian Berkas    : Surat Keputusan Penetapan   │
│  Unit Kerja       : Direktorat A                │
│  Lokasi Simpan    : Rak-01, Lantai 2            │
│                                                 │
│  Masa Retensi:                                  │
│  ████████████░░░░░░ 65% (195/300 hari)          │
│  ⏱️ Sisa 105 hari                               │
│                                                 │
└─────────────────────────────────────────────────┘
```

Tombol aksi: **Ubah Metadata** dan **Rekonsiliasi Klasifikasi/JRA** (untuk admin yang berwenang atas unit arsip), **Lihat Surat Asli** (bila arsip berasal dari surat), dan **Cetak Detail**.

### Tab di Halaman Detail:

| Tab | Isi |
|-----|-----|
| **Informasi** | Data lengkap arsip (klasifikasi, uraian, unit kerja, lokasi) |
| **Item Berkas** | Daftar file/dokumen dalam arsip |
| **Riwayat** | Timeline perubahan arsip (siapa mengubah apa dan kapan) |

### Progress Bar Retensi

Bar visual menunjukkan **persentase masa retensi yang sudah berjalan**. Semakin penuh bar, semakin dekat arsip ke batas waktu musnah.

---

## Mengubah Metadata Arsip

Bila ada data berkas yang salah catat, admin yang berwenang atas unit arsip dapat memperbaikinya dari halaman detail:

1. Klik **Ubah Metadata** di bagian atas halaman atau di kartu **Aksi Cepat**.
2. Perbaiki isian yang salah: Nomor Berkas, Unit Pengolah, Uraian Berkas, Kurun Waktu, Nomor Item, Tingkat Perkembangan, Uraian Item, Tanggal Arsip, Jumlah, Media, No. Filing Cabinet, No. Laci, No. Folder, Klasifikasi Keamanan, PIC, atau Keterangan.
3. Klik **Simpan**. Hanya isian yang diubah yang disimpan, dan perubahannya tercatat di log audit.

Kode klasifikasi arsip dan JRA tidak diubah di sini; gunakan **Rekonsiliasi Klasifikasi/JRA**. Tombol **Ubah Metadata** dikunci bila arsip sedang legal hold, sedang dalam proses penyusutan, atau penyusutannya sudah dilaksanakan.

Admin Unit Kerja hanya dapat memilih klasifikasi keamanan Biasa/Terbuka atau Terbatas; Rahasia dan Sangat Rahasia hanya dapat dipilih Super Admin. Kelas yang sudah tersimpan boleh dipertahankan. Bila kelas dinaikkan ke Terbatas atau lebih tinggi, arsip memerlukan persetujuan akses; pengubahnya pun mungkin perlu mengajukan persetujuan akses untuk membuka arsip itu lagi.

---

## Mengarsipkan Surat

Kamu bisa mengarsipkan surat dari halaman detail surat masuk/keluar:

1. Buka **detail surat**.
2. Klik tombol **"Arsipkan"**.
3. Pilih **kode klasifikasi** dan **lokasi penyimpanan**.
4. Klik **"Simpan"**.

---

[⬅️ Sebelumnya: Distribusi Surat](../manajemen-surat/distribusi.md) | [Selanjutnya: Pemberkasan (Dosir) ➡️](dosir.md)
