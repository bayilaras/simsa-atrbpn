# 📋 Mengenal Dashboard

Setelah berhasil login, halaman pertama yang kamu lihat adalah **Dashboard**. Ini adalah pusat informasi SIMSA yang menampilkan ringkasan semua data.

---

## Tampilan Dashboard

:::tip Tampilan Dashboard
Dashboard SIMSA terdiri dari beberapa bagian utama (dari atas ke bawah):

1. **🎨 Hero Section** — Area gradien biru di bagian atas, menampilkan salam, tanggal, dan unit kerja. Super Admin bisa memilih unit kerja melalui dropdown.
2. **📊 Kartu Statistik** — 6 kartu berisi angka ringkasan: Surat Masuk, Surat Keluar, Total Arsip, Arsip Masuk, Arsip Keluar, dan Segera Musnah.
3. **📈 Grafik Trend** — Grafik garis membandingkan volume surat masuk & keluar selama 12 bulan terakhir.
4. **📊 Perbandingan Unit Kerja** — Grafik batang horizontal menampilkan volume surat per unit kerja.
5. **⚡ Aksi Cepat** — 4 tombol shortcut: Surat Masuk, Surat Keluar, Laporan, Upload.
6. **⚠️ Masa Retensi** — Daftar arsip yang mendekati batas musnah (🔴 kritis, 🟡 peringatan, 🔵 informasi).
7. **📋 Aktivitas Terbaru** — 8 surat terakhir yang diinput ke sistem.
8. **🍩 Status Siklus Arsip** *(baru v1.1)* — Donut chart distribusi arsip: Aktif, Inaktif, Kadaluarsa, Belum Ditentukan.
9. **💿 Jenis Media Arsip** *(baru v1.1)* — Progress bar distribusi per jenis media (kertas, foto, video, audio, elektronik).
10. **📖 Peminjaman Arsip** *(baru v1.1)* — Jumlah arsip dipinjam dan yang terlambat dikembalikan.
11. **📋 Pipeline Penyusutan** *(baru v1.1)* — Status 5 tahap alur penyusutan arsip.
12. **🏢 Kapasitas Penyimpanan** *(baru v1.1)* — Utilisasi ruang arsip per gedung.
13. **🛡️ Arsip Vital & Terjaga** *(baru v1.1)* — Alert arsip belum diproteksi/dilaporkan ke ANRI.
:::

---

## Penjelasan Komponen

### 1. Hero Section

Bagian paling atas dengan latar **gradien biru**:
- Menampilkan **salam** dengan nama kamu
- Menampilkan **tanggal hari ini**
- Menampilkan **unit kerja** kamu
- Untuk **Super Admin**: ada dropdown untuk memilih unit kerja yang datanya ingin dilihat

### 2. Kartu Statistik (6 Kartu)

Baris kartu yang menampilkan angka-angka ringkasan:

| Kartu | Isi |
|-------|-----|
| **Surat Masuk** | Total surat masuk + jumlah bulan ini |
| **Surat Keluar** | Total surat keluar + jumlah bulan ini |
| **Total Arsip** | Jumlah total arsip |
| **Arsip Masuk** | Jumlah arsip dari surat masuk |
| **Arsip Keluar** | Jumlah arsip dari surat keluar |
| **Segera Musnah** | Arsip yang ≤ 15 hari menuju batas musnah |

### 3. Analisis Trend Surat

**Grafik garis** yang membandingkan volume surat masuk (hijau) dan surat keluar (kuning) selama **12 bulan terakhir**.

### 4. Perbandingan Unit Kerja

**Grafik batang horizontal** yang menampilkan volume surat per unit kerja bulan ini.

### 5. Aksi Cepat

4 tombol shortcut untuk akses cepat:

| Tombol | Fungsi |
|--------|--------|
| 📨 Surat Masuk | Langsung ke form tambah surat masuk |
| 📤 Surat Keluar | Langsung ke form tambah surat keluar |
| 📊 Laporan | Langsung ke halaman laporan |
| 📁 Upload | Langsung ke halaman bulk upload |

### 6. Masa Retensi

Daftar arsip yang mendekati batas waktu musnah (dalam 90 hari):

| Warna | Urgency | Keterangan |
|-------|---------|------------|
| 🔴 Merah | Kritis | ≤ 15 hari sebelum musnah |
| 🟡 Kuning | Peringatan | 16-30 hari sebelum musnah |
| 🔵 Biru | Informasi | 31-90 hari sebelum musnah |

Klik arsip untuk langsung ke halaman detail arsip tersebut.

### 7. Aktivitas Terbaru

Menampilkan **8 surat terakhir** (masuk dan keluar) yang diinput ke sistem. Klik untuk lihat detailnya.

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
- **Sedang Dipinjam** — jumlah arsip yang sedang dalam status borrowed
- **Terlambat Dikembalikan** — jumlah arsip yang melewati batas tanggal pengembalian (ditampilkan merah jika ada)

### 11. Pipeline Penyusutan Arsip

Menampilkan status alur persetujuan penyusutan arsip dalam **5 tahap berurutan**:

```
[Draft] → [Diusulkan] → [Ditinjau] → [Disetujui] → [Dilaksanakan]
```

Setiap tahap menunjukkan jumlah arsip yang sedang berada di tahap tersebut.

### 12. Kapasitas Penyimpanan Fisik

**Progress bar** menampilkan utilisasi ruang arsip per gedung:

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

Jika kamu **Super Admin**, ada tab tambahan **"Pengawasan"** yang menampilkan dashboard monitoring khusus untuk mengawasi aktivitas seluruh unit kerja.

---

[⬅️ Sebelumnya: Browser yang Kompatibel](browser-kompatibel.md) | [Selanjutnya: Navigasi Sidebar ➡️](navigasi-sidebar.md)
