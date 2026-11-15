# 📋 Mengenal Dashboard

Setelah berhasil login, halaman pertama yang kamu lihat adalah **Dashboard**. Ini adalah pusat informasi SIMSA yang menampilkan ringkasan semua data.

---

## Tampilan Dashboard

:::tip Tampilan Dashboard
Dashboard SIMSA terdiri dari beberapa bagian utama (dari atas ke bawah):

1. **👋 Bagian Salam** — Bagian paling atas, menampilkan salam, tanggal, dan unit kerja. Super Admin bisa memilih unit kerja melalui dropdown.
2. **📊 Kartu Statistik** — 6 kartu berisi angka ringkasan: Surat Masuk, Surat Keluar, Total Arsip, Arsip Masuk, Arsip Keluar, dan Perlu Telaah Retensi.
3. **📈 Grafik Trend** — Grafik garis membandingkan volume surat masuk & keluar selama 12 bulan terakhir.
4. **📊 Perbandingan Unit Kerja** — Grafik batang horizontal menampilkan volume surat per unit kerja.
5. **⚡ Tindakan Utama** — Deretan tombol di bawah salam: Catat Surat Masuk, Catat Surat Keluar, Buat Surat Inisiatif, Cari Arsip, Laporan, dan Unggah Massal.
6. **⚠️ Masa Retensi** — Daftar arsip yang mendekati batas retensi dalam 90 hari (🔴 kritis, 🟡 peringatan, 🔵 informasi).
7. **📋 Aktivitas Terbaru** — Surat masuk dan keluar terbaru yang dicatat ke sistem.
8. **🍩 Status Siklus Arsip** *(baru v1.1)* — Donut chart distribusi arsip: Aktif, Inaktif, Kadaluarsa, Belum Ditentukan.
9. **💿 Jenis Media Arsip** *(baru v1.1)* — Progress bar distribusi per jenis media (kertas, foto, video, audio, elektronik).
10. **📖 Peminjaman Arsip** *(baru v1.1)* — Jumlah arsip dipinjam dan yang terlambat dikembalikan.
11. **📋 Pipeline Penyusutan** *(baru v1.1)* — Status 5 tahap alur penyusutan arsip. Hanya tampil bila modul Penyusutan diaktifkan operator.
12. **🏢 Kapasitas Penyimpanan** *(baru v1.1)* — Utilisasi ruang arsip per gedung.
13. **🛡️ Arsip Vital & Terjaga** *(baru v1.1)* — Alert arsip belum diproteksi/dilaporkan ke ANRI.
:::

---

## Penjelasan Komponen

### 1. Bagian Salam

Bagian paling atas halaman:
- Menampilkan **salam** "Halo, [nama kamu]"
- Menampilkan **tanggal hari ini**
- Menampilkan **nama unit kerja** kamu (bukan kodenya)
- Untuk **Super Admin**: ada dropdown untuk memilih unit kerja yang datanya ingin dilihat

### 2. Kartu Statistik (6 Kartu)

Baris kartu yang menampilkan angka-angka ringkasan:

| Kartu | Isi |
|-------|-----|
| **Surat Masuk** | Total surat masuk + jumlah bulan ini (bulan berjalan menurut WIB) |
| **Surat Keluar** | Total surat keluar + jumlah bulan ini (bulan berjalan menurut WIB) |
| **Total Arsip** | Jumlah total arsip |
| **Arsip Masuk** | Jumlah arsip dari surat masuk |
| **Arsip Keluar** | Jumlah arsip dari surat keluar |
| **Perlu Telaah Retensi** | Arsip yang ≤ 15 hari menuju batas retensi dan perlu ditelaah. Angka ini bukan keputusan pemusnahan |

### 3. Analisis Trend Surat

**Grafik garis** yang membandingkan volume surat masuk (hijau) dan surat keluar (kuning) selama **12 bulan terakhir**.

### 4. Perbandingan Unit Kerja

**Grafik batang horizontal** yang menampilkan volume surat per unit kerja bulan ini.

### 5. Tindakan Utama

Deretan tombol di bawah salam untuk akses cepat:

| Tombol | Fungsi |
|--------|--------|
| 📨 Catat Surat Masuk | Langsung ke form tambah surat masuk (admin) |
| 📤 Catat Surat Keluar | Langsung ke form tambah surat keluar (admin) |
| ➕ Buat Surat Inisiatif | Langsung ke form surat keluar tanpa surat masuk induk (admin) |
| 🗂️ Cari Arsip | Langsung ke daftar arsip |
| 📊 Laporan | Langsung ke halaman laporan |
| 📁 Unggah Massal | Langsung ke halaman Unggah Massal & OCR. Hanya muncul bila modul Unggah Massal & OCR diaktifkan operator dan unggah file tersedia |

Pengguna yang hanya dapat membaca melihat **Lihat Surat Masuk** dan **Lihat Surat Keluar** sebagai pengganti tombol catat.

Di bawah deretan tombol ini ada bagian **Perlu ditindaklanjuti**. Bagi admin, bagian ini memuat baris *N surat keluar menunggu keputusan Anda* dengan tombol **Tinjau surat yang menunggu** bila ada surat keluar yang diajukan kepada kamu sebagai penyetuju, serta pengingat peminjaman yang terlambat.

### 6. Masa Retensi

Daftar arsip yang mendekati batas retensi (dalam 90 hari). Daftar ini adalah pengingat untuk menelaah, bukan keputusan pemusnahan:

| Warna | Urgency | Keterangan |
|-------|---------|------------|
| 🔴 Merah | Kritis | ≤ 15 hari sebelum batas retensi |
| 🟡 Kuning | Peringatan | 16-30 hari sebelum batas retensi |
| 🔵 Biru | Informasi | 31-90 hari sebelum batas retensi |

Klik arsip untuk langsung ke halaman detail arsip tersebut.

### 7. Aktivitas Terbaru

Menampilkan surat masuk dan surat keluar terbaru yang dicatat ke sistem. Klik untuk lihat detailnya.

---

## 🆕 Widget Tambahan (v1.1)

Mulai versi 1.1, dashboard menampilkan **6 widget tambahan** di bawah Aktivitas Terbaru:

### 8. Status Siklus Arsip (Donut Chart)

**Donut chart** yang menampilkan distribusi arsip berdasarkan status siklus hidupnya:

| Status | Warna | Keterangan |
|--------|-------|------------|
| **Aktif** | 🟢 Hijau | Masa retensi aktif masih berjalan |
| **Inaktif** | 🔵 Biru | Masa aktif selesai, masa inaktif berjalan |
| **Kadaluarsa** | 🔴 Merah | Semua masa retensi telah berakhir |
| **Belum Ditentukan** | ⚪ Abu-abu | Belum memiliki data retensi |

Status dihitung otomatis dari **tanggal arsip** dan **jadwal retensi aktif/inaktif**.

### 9. Jenis Media Arsip

**Progress bar** yang menampilkan distribusi arsip berdasarkan jenis media penyimpanan. Setiap jenis memiliki ikon dan warna berbeda:

- 📄 **Kertas** (kuning)
- 📸 **Foto** (pink)
- 🎬 **Video** (ungu)
- 🎵 **Audio** (teal)
- 💻 **Elektronik** (biru)

### 10. Peminjaman Arsip

Menampilkan **2 angka penting**:
- **Sedang Dipinjam** — jumlah arsip yang sedang dipinjam
- **Terlambat Dikembalikan** — jumlah arsip yang melewati batas tanggal pengembalian (ditampilkan merah jika ada)

### 11. Pipeline Penyusutan Arsip

Menampilkan status alur persetujuan penyusutan arsip dalam **5 tahap berurutan**:

```
[Draft] → [Diusulkan] → [Ditinjau] → [Disetujui] → [Dilaksanakan]
```

Setiap tahap menunjukkan jumlah arsip yang sedang berada di tahap tersebut.

Widget ini hanya tampil bila modul Penyusutan diaktifkan operator. Selama modul belum diaktifkan, pemindahan dan pemusnahan arsip dilakukan di luar SIMSA.

### 12. Kapasitas Penyimpanan Fisik

**Progress bar** menampilkan utilisasi ruang arsip per gedung. Isi boks dihitung dari arsip yang benar-benar ditautkan ke lokasi simpannya:

| Tingkat Pengisian | Warna | Keterangan |
|-------------------|-------|------------|
| < 70% | 🟢 Hijau | Kapasitas masih cukup |
| 70-89% | 🟡 Kuning | Mendekati penuh |
| ≥ 90% | 🔴 Merah | Hampir penuh, perlu perhatian |

Tombol **"Kelola Penyimpanan"** mengarah ke halaman Lokasi Simpan.

### 13. Arsip Vital & Terjaga

**Alert card** yang menampilkan:
- **Arsip Vital** — jumlah arsip vital yang belum diproteksi (merah jika ada)
- **Arsip Terjaga** — jumlah arsip terjaga yang belum dilaporkan ke **ANRI** (kuning jika ada)

Jika semua arsip sudah diproteksi/dilaporkan, warnanya berubah menjadi **hijau** ✅.

Bagian arsip terjaga hanya tampil bila modul Arsip Terjaga diaktifkan operator; tanpa modul itu kartu bernama **Arsip Vital**.

:::info Semua Widget Filter per Unit Kerja
Semua widget otomatis menyesuaikan dengan **unit kerja yang dipilih** oleh Super Admin. Untuk admin biasa, data ditampilkan sesuai unit kerja masing-masing.
:::

---

## ⚡ Dashboard Update Otomatis

Dashboard SIMSA akan **otomatis refresh data** ketika:
- Kamu **kembali dari halaman lain** ke Dashboard
- Kamu **berpindah tab browser** dan kembali ke SIMSA
- Kamu baru saja **menambah surat/arsip baru**

Tidak perlu refresh browser secara manual!

---

## Tab Pengawasan (Super Admin)

Dashboard memiliki tab **Ringkasan**. Jika kamu **Super Admin**, ada tab tambahan **"Pengawasan"** yang menampilkan ringkasan khusus untuk mengawasi aktivitas seluruh unit kerja.

---

[⬅️ Sebelumnya: Browser yang Kompatibel](browser-kompatibel.md) | [Selanjutnya: Navigasi Sidebar ➡️](navigasi-sidebar.md)
