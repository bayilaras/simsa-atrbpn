# Hasil rilis frontend C74 dan C75: tabel, kartu, dan bilah tab responsif, 18 November 2026

Lanjutan `HASIL_RILIS_FRONTEND_C73_2026-11-17.md`. Semua waktu dalam UTC (WIB = UTC+7).

Dua rilis frontend pada hari yang sama:

- **C74** dari `main` `85b56b3` (PR #186)
- **C75** dari `main` `088963d` (PR #187)

Backend tetap C79. Di antara `4208b98` (C73) dan `088963d`, hanya ada dua jenis perubahan: berkas di `frontend/` dan laporan rilis C73 di `docs/rilis/`. Tidak ada migrasi, perubahan env, atau kredensial yang dicatat.

## Isi rilis

**PR #186 (C74)** memperbaiki daftar dan detail surat yang meluber pada layar laptop (sekitar 1.366 px) dan layar sempit. Laporan awalnya berupa tangkapan layar dua bagian yang keluar dari kolom atau kartunya: daftar Surat Masuk, dan badge Unit Kerja di kartu Metadata. PR ini mengubah 15 berkas frontend.

**Tabel**
- Sel tabel tidak lagi memaksa teks satu baris (`whitespace-nowrap` bawaan diganti `whitespace-normal break-words`).
- Di ponsel, tabel tersusun sebagai kartu dan teks panjang boleh dipenggal di mana saja (`overflow-wrap: anywhere`). Sebelumnya alamat e-mail panjang di Manajemen Pengguna tetap meluber.

**Surat Masuk dan Surat Keluar**
- Daftar: perihal dipotong dua baris dengan teks lengkap di tooltip. Nomor surat dan nama unit kerja turun baris di dalam kolomnya.
- Detail: Unit Kerja di kartu Metadata kini berupa teks rata kanan yang turun baris, bukan badge berbentuk pil.

**Halaman lain**
- Badge disposisi dan peserta alur boleh turun baris.
- Judul dan deskripsi kartu boleh turun baris.
- Penyesuaian tata letak di halaman Dosir, Formulir, Jadwal Retensi, Tata Kelola Retensi, dan Manajemen Pengguna.

**PR #187 (C75)** menghilangkan scrollbar vertikal kecil di samping bilah tab, misalnya "Daftar Surat / Surat Terhapus". Bilah tab tetap memakai `overflow-x-auto` agar bisa digeser ke samping di ponsel, tetapi aturan itu juga membuat sumbu vertikal bisa digulir. Garis bawah pemicu tab, sebuah pseudo-elemen di `bottom-[-5px]` yang tidak terlihat pada varian bawaan, menjorok 1–2 px di bawah bilah sehingga scrollbar muncul.

- `TabsList` mendapat `overflow-y-hidden`.
- Pemicu tab di dialog Pilih Klasifikasi & Retensi Arsip diberi `min-h-7`. Sebelumnya `h-7` kalah oleh `min-h-9` bawaan, sehingga pemicu lebih tinggi dari bilahnya.

## Pemeriksaan sebelum merge

Pemeriksaan visual memakai server lokal dengan API tiruan berisi data yang sengaja panjang.

- **#186:** audit luapan pada 36 rute di lebar 1.366, 1.024, dan 375 px. Setelah perbaikan, tidak ada temuan di 1.366 px dan 375 px.
- **#187:** pengukuran semua bilah tab pada 21 rute di lebar 1.366 dan 375 px, ditambah dialog Pilih Klasifikasi. Tidak ada bilah yang bisa digulir vertikal, dan tidak ada pemicu yang terpotong.
- **Kedua PR:** lint bersih, 246 berkas uji (1.699 uji) lulus, dan build sukses.

## Langkah C74

| Langkah | Hasil | Waktu |
|---|---|---|
| Merge #186 | Disetujui efanwahyu pukul 03:33:18, lalu auto-merge sebagai `85b56b3`. Tree `85b56b3` identik dengan head PR `4f59fd2` yang lulus semua cek. CI `push` `44231338461` sukses | 03:34:11 |
| Sumber rilis | `release-source.mjs prepare` pada `85b56b3`: 1.669 berkas, manifest `94e883ef96c176f1b4013da9544fca99006a62bf16e32a9c7979b9857d83c9d7`, 55 migrasi (tidak ada yang baru) | ±03:34 |
| Target rollback | C73 `dpl_8rDZuG6MkgoojnZodxmYM7HQi7HR`, dibaca dari alias produksi dan dicatat di `rollback.md` sebelum build | ±03:34 |
| Kandidat frontend C74 | `dpl_FMrvfvYKwjmmNV27Vbrcnp8fMgA2` Ready. Verifikasi sumber lulus: lint, 246 berkas uji (1.699 uji). Precache 159 entri (2.777,34 KiB) | 03:35–03:42 |
| Promosi frontend C74 | Sukses. Alias produksi menunjuk `dpl_FMrvfvYKwjmmNV27Vbrcnp8fMgA2` | 03:43:15 |
| Uji asap | `release-smoke.mjs frontend` 7/7, termasuk bundel `index-CvAoxBYC.js`. `release-smoke.mjs backend` tetap lulus | ±03:44 |

## Langkah C75

| Langkah | Hasil | Waktu |
|---|---|---|
| Merge #187 | Disetujui efanwahyu pukul 05:04:26, lalu auto-merge sebagai `088963d`. Tree `088963d` identik dengan head PR `eea4956` yang lulus semua cek. CI `push` `44241804532` sukses | 05:05:55 |
| Sumber rilis | `release-source.mjs prepare` pada `088963d`: 1.669 berkas, manifest `36101c02273f78866cc14b76468c8cf55ae6dfd31d25354b6f865cbd117ea3a4`, 55 migrasi (tidak ada yang baru) | ±05:06 |
| Target rollback | C74 `dpl_FMrvfvYKwjmmNV27Vbrcnp8fMgA2`, dibaca dari alias produksi dan dicatat di `rollback.md` sebelum build | ±05:06 |
| Kandidat frontend C75 | `dpl_Djp4BoyWTveepzDZqj694E6jzZRm` Ready. Verifikasi sumber lulus: lint, 246 berkas uji (1.699 uji). Precache 159 entri (2.777,46 KiB) | 05:06–05:17 |
| Promosi frontend C75 | Sukses. Alias produksi menunjuk `dpl_Djp4BoyWTveepzDZqj694E6jzZRm` | 05:18:35 |
| Uji asap | `release-smoke.mjs frontend` 7/7, termasuk bundel `index-DoFVYtDU.js`. `release-smoke.mjs backend` tanpa kegagalan | ±05:19 |

## Pemeriksaan setelah promosi

**C74**
- Daftar dan detail Surat Masuk diperiksa langsung dengan akun yang masuk, di lebar 1.366 px.
- Halaman tidak bergeser ke samping, dan tabel muat di kotaknya.
- Skrip pengukur tidak menemukan elemen yang keluar dari sel, kartu, atau badge.
- Unit Kerja yang panjang di kartu Metadata turun baris di dalam kartu.
- Pemeriksaan ini pula yang menemukan scrollbar bilah tab yang kemudian diperbaiki di C75.

**C75**
- Bundel produksi memuat kelas yang baru: `overflow-x-auto overflow-y-hidden` di modul tab, `h-7 min-h-7` di modul KlasifikasiPicker, dan aturan `overflow-y-hidden` di CSS.

**Belum diperiksa**
- Bilah tab C75 belum dilihat langsung dengan akun yang masuk, karena sesi di browser pemeriksa sudah berakhir.
- Pengguna yang masih memuat bundel lama dari cache perlu memuat ulang halaman sekali.

**Sisa yang diketahui**
- Pada lebar 1.024 px, enam tabel lebar masih bisa digeser ke samping di dalam kotaknya sendiri: Surat Masuk, Surat Keluar, Distribusi, Arsip, Arsip Elektronik, dan Aturan Regulasi.
- Halaman itu sendiri tidak bergeser ke samping. Kondisi ini dibiarkan.

## Deployment

| Komponen | Deployment aktif | Sumber | Rollback |
|---|---|---|---|
| Backend | `dpl_3auuJCLJqATaW9mXGq4emVJxbbQG` (C79) | `main` `d9dff53` | tidak berubah |
| Frontend | `dpl_Djp4BoyWTveepzDZqj694E6jzZRm` (C75) | `main` `088963d` | C74 `dpl_FMrvfvYKwjmmNV27Vbrcnp8fMgA2`, lalu C73 `dpl_8rDZuG6MkgoojnZodxmYM7HQi7HR` |
| Situs panduan | `dpl_C87rrBV7qre51aQnNLgUgD3b5hCW` | `main` `a715742` | tidak berubah oleh rilis ini |

Rollback cukup dengan mempromosikan kembali deployment sebelumnya dari folder yang tertaut ke project frontend. Skema database dan env produksi tidak berubah.

## Tindak lanjut

- Sebelum 2026-12-02, periksa apakah `picomatch` (GHSA-fc5q-39xc-vjpf) sudah punya versi perbaikan. Bila sudah, naikkan versinya dan hapus entri allowlist. Bila belum, putuskan perpanjangan sebelum cek Security Audit gagal pada tanggal itu.
