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

Masa aktif baru dianggap berakhir bila klasifikasi/JRA arsip sudah terverifikasi dan peristiwa pemicu retensinya sudah diverifikasi. Arsip yang belum memenuhi syarat itu tetap tercantum di Formulir 4 sampai pemindahannya dicatat di SIMSA melalui modul Penyusutan. Pemindahan yang dilakukan di luar SIMSA, misalnya selama modul Penyusutan belum diaktifkan, tidak mengubah isi kedua formulir. Arsip yang sudah dimusnahkan atau diserahkan tidak tercantum di kedua formulir.

Arsip yang pemindahannya dilaksanakan melalui modul Penyusutan sebelum pembaruan siklus arsip pada September 2026 tetap tercantum di Formulir 6, walaupun batch pemindahannya belum dipulihkan dengan **Pulihkan kelanjutan retensi**. Alih media yang dilaksanakan sebelum pembaruan itu tidak mengakhiri siklus arsip, sehingga arsipnya tercantum di Formulir 4 atau Formulir 6 menurut aturan masa aktif di atas. Formulir 4 dan Formulir 6 yang dicetak dari modul Penyusutan mengikuti aturan yang sama dengan ekspor ini.

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

Bagi admin tersebut, kedua tombol pertama tetap tampil tetapi nonaktif, disertai alasannya, bila arsip tidak dapat diubah dengan akunnya. Untuk arsip berkelas Terbatas, Rahasia, atau Sangat Rahasia, keduanya hanya aktif bila persetujuan akses Anda atas arsip itu bermode **Tayang dan kelola**; persetujuan **Tayang saja** atau **Tayang dan unduh** hanya membuka arsip untuk dibaca. Rekonsiliasi juga dapat ditolak saat disimpan bila arsip sedang dalam penilaian JRA yang belum selesai.

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

### Daftar item ikut diperbarui

Arsip yang dicatat lewat **Arsipkan** pada surat masuk atau surat keluar memiliki daftar item di tab **Item Arsip**. Item pertama disalin menjadi ringkasan item berkas (Nomor Item, Uraian Item, Tingkat Perkembangan, Tanggal Arsip, dan lokasi). Saat perubahan disimpan:

- Bila Nomor Item, Uraian Item, Tingkat Perkembangan, Tanggal Arsip, atau lokasi diubah, item yang menjadi ringkasan itu disamakan dengan semua isian tersebut pada arsip, termasuk isian yang tidak diubah. Item tersebut dikenali bila berkas hanya berisi satu item, atau bila tepat satu item masih sama dengan ringkasan sebelum diubah (nomor, uraian, tingkat perkembangan, dan tanggal). Jadi pada berkas satu item, item itu ikut diselaraskan walaupun isinya, termasuk lokasinya, sempat berbeda dari ringkasan berkas.
- Bila lokasi diubah, item lain yang tersimpan di lokasi lama yang sama (No. Filing Cabinet, No. Laci, dan No. Folder ketiganya sama) ikut dipindahkan ke lokasi baru. Item di lokasi lain tidak berubah.
- Bila item ringkasan tidak dapat dikenali, misalnya dua item sama persis atau isinya sudah berbeda dari ringkasan, perubahan tetap disimpan pada arsip, tetapi tidak ada item yang diperlakukan sebagai ringkasan. Item yang berlokasi sama tetap ikut dipindahkan bila lokasi diubah.
- Jumlah dan Media hanya mengubah ringkasan berkas, tidak mengubah daftar item.
- Selama appraisal JRA atas arsip itu masih terbuka atau sedang ditelaah, perubahan Nomor Item, Uraian Item, Tingkat Perkembangan, Tanggal Arsip, atau lokasi pada arsip yang memiliki daftar item ditolak dengan pesan dari server. Selesaikan appraisal terlebih dahulu. Isian lain, misalnya Keterangan, tetap dapat diubah.

Perubahan pada item dicatat dalam entri log audit yang sama dengan perubahan arsip, dan tampil di halaman **Audit Log** di bawah rincian perubahan arsip pada bagian **Daftar Item Arsip**.

Untuk arsip berkelas Terbatas atau lebih tinggi, **Ubah Metadata** dan **Rekonsiliasi Klasifikasi/JRA** juga dikunci kecuali Anda memegang persetujuan akses bermode **Tayang dan kelola** atas arsip itu. Cara memperolehnya:

1. Bila Anda sudah memegang persetujuan **Tayang saja** atau **Tayang dan unduh** yang masih berlaku, permohonan baru akan ditolak. Minta Super Admin mencabut persetujuan itu, atau tunggu sampai masa berlakunya berakhir.
2. Buka halaman **Persetujuan Akses Rekod** (menu **Persetujuan Akses Arsip**), lalu ajukan akses dengan ID arsip yang disalin dari halaman detail, mode **Tayang dan kelola (tanpa unduh)**, dan tujuan kedinasan yang jelas.
3. Setelah disetujui, buka kembali halaman detail arsip. Tombol aktif selama persetujuan masih berlaku.

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
