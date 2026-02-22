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
