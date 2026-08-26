# ⏱️ Jadwal Retensi Arsip (JRA)

Panduan mengelola jadwal retensi arsip di SIMSA.

---

## Apa Itu JRA?

**Jadwal Retensi Arsip (JRA)** adalah daftar yang berisi **jangka waktu penyimpanan arsip**. JRA menentukan berapa lama arsip harus disimpan (masa aktif dan inaktif) sebelum dimusnahkan, diserahkan, atau dinilai kembali.

---

## Melihat Daftar JRA

### Langkah 1: Buka Menu

1. Di sidebar, klik **Jadwal Retensi** di bawah grup **Siklus Hidup Arsip**.

### Langkah 2: Lihat Tabel

| Kolom | Keterangan |
|-------|------------|
| Kode Klasifikasi | Kode klasifikasi arsip |
| Uraian | Deskripsi jenis arsip |
| Masa Aktif | Lama penyimpanan di unit kerja (tahun) |
| Masa Inaktif | Lama penyimpanan di pusat arsip (tahun) |
| Keterangan | Informasi tambahan (musnah/serah/dinilai kembali) |

---

## Mengubah JRA (Super Admin)

JRA aktif bersifat hanya-baca. Perubahan selalu dibuat sebagai versi draft agar keputusan arsip lama tidak ikut berubah.

1. Buka **Master Data > Versi Aturan**.
2. Buat draft JRA dari versi aktif.
3. Catat dasar hukum, tanggal berlaku, dokumen sumber, dan SHA-256.
4. Edit atau impor isi draft, validasi, lalu aktifkan setelah review.

Pemetaan klasifikasi ke JRA pada dialog arsip hanya saran. Arsiparis tetap wajib menilai butir JRA yang tepat. Arsip lama yang belum memiliki provenance aturan terverifikasi harus direkonsiliasi sebelum dapat masuk penyusutan. Lihat [Versi Aturan Klasifikasi dan JRA](../administrasi/versi-aturan.md).

---

[⬅️ Sebelumnya: Pemberkasan (Dosir)](dosir.md) | [Selanjutnya: Manajemen Retensi ➡️](manajemen-retensi.md)
