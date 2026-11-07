# 🧭 Navigasi Sidebar

Sidebar adalah menu navigasi utama di sisi kiri layar SIMSA. Dari sini kamu bisa mengakses semua fitur yang tersedia.

---

## Tampilan Sidebar

Sidebar menampilkan menu navigasi yang dikelompokkan sebagai berikut:

**UTAMA**
- 📊 Dashboard

**MANAJEMEN SURAT**
- 📧 Surat → 📨 Surat Masuk, 📤 Surat Keluar, 🔍 Lacak Surat
- 🔄 Distribusi

**SIKLUS HIDUP ARSIP**
- 🗂️ Arsip Aktif → Arsip Surat Masuk, Arsip Surat Keluar
- 📁 Pemberkasan (Dosir)
- ⏱️ Jadwal Retensi 🔒
- 📊 Manajemen Retensi
- ⚖️ Tata Kelola Retensi
- ✂️ Penyusutan

**LAYANAN & FISIK**
- 📋 Layanan Arsip
- 🔄 Peminjaman
- 📍 Lokasi Simpan
- 🛡️ Arsip Vital
- 🔐 Arsip Terjaga

**MEDIA & AUTENTIKASI**
- 💾 Arsip Elektronik
- 🛡️ Autentikasi 🔒
- 🔗 Tunjuk Silang

**ADMINISTRASI**
- 📊 Laporan
- 📝 Audit Log 🔒
- 🔑 Persetujuan Akses Arsip
- 🖥️ Monitoring Operasional 🔒
- ⚙️ Pengaturan
- ☁️ Integrasi SRIKANDI
- 👥 Manajemen Pengguna 🔒
- 📂 Master Data 🔒 → Versi Aturan, Klasifikasi Arsip

Tautan **📖 Panduan** ada di bagian bawah sidebar.

*Menu dengan 🔒 hanya tersedia untuk Super Admin. Arsip Elektronik, Autentikasi, Penyusutan, Arsip Terjaga, dan Integrasi SRIKANDI hanya muncul bila fiturnya diaktifkan operator.*

---

## Cara Menggunakan Sidebar

### Membuka Menu

1. **Menu biasa** — Klik langsung pada nama menu, kamu akan diarahkan ke halaman tersebut.
2. **Menu dengan sub-menu** (ada ikon ▼) — Klik untuk membuka/tutup sub-menu, lalu klik sub-menu yang diinginkan.

### Melipat Sidebar

- Klik ikon **hamburger** (☰) di bagian atas untuk **melipat** sidebar.
- Sidebar yang dilipat hanya menampilkan **ikon** saja, tanpa teks.
- Hover mouse di atas ikon untuk melihat **tooltip** nama menu.
- Klik ikon hamburger lagi untuk **membuka** kembali sidebar.

---

## Menu dengan 🔒 (Khusus Super Admin)

Menu yang ditandai 🔒 **hanya tersedia** untuk Super Admin:

| Menu | Tersedia Untuk |
|------|----------------|
| Jadwal Retensi | Super Admin saja |
| Autentikasi | Super Admin saja |
| Audit Log | Super Admin saja |
| Monitoring Operasional | Super Admin saja |
| Manajemen Pengguna | Super Admin saja |
| Master Data (Versi Aturan, Klasifikasi Arsip) | Super Admin saja |

**Admin Unit Kerja** melihat semua menu lain untuk unit kerja yang ditetapkan. Di **Pengaturan**, tab **Profil**, **Preferensi**, dan **Template** tersedia untuk Admin Unit Kerja; tab **Unit Kerja** hanya untuk Super Admin.

Akun lama Admin Dirjen dan Admin Sesditjen melihat menu yang sama dengan Admin Unit Kerja. Akun lama Staff dan Auditor hanya melihat Dashboard, Surat, Arsip Aktif, Layanan Arsip, Laporan, Persetujuan Akses Arsip, dan Pengaturan (tab Profil dan Preferensi); Auditor lama juga melihat Tata Kelola Retensi.

> 💡 Jika kamu tidak melihat menu tertentu di sidebar, artinya role kamu tidak memiliki akses ke menu tersebut.

---

## Indikator Menu Aktif

- Menu yang sedang **aktif** (halaman yang sedang dibuka) akan ditandai dengan **highlight** berwarna.
- Bagi Super Admin dan Admin Unit Kerja, sub-menu **Lacak Surat** menampilkan angka bila ada surat yang perlu dilengkapi.

---

[⬅️ Sebelumnya: Mengenal Dashboard](mengenal-dashboard.md) | [Selanjutnya: Role & Hak Akses ➡️](role-hak-akses.md)
