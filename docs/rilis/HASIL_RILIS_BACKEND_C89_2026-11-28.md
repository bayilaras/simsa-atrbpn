# Hasil rilis backend C89: modul isi formulir surat dari PDF dinyalakan, 28 November 2026

Lanjutan `HASIL_RILIS_C88_C91_2026-11-28.md`. Semua waktu dalam UTC (WIB = UTC+7); rilis berlangsung 28 November malam WIB.

Rilis ini tidak membawa kode baru. Backend dibangun ulang dari `main` `7eb1862c`, sumber yang sama dengan C88, setelah `SIMSA_LETTER_PDF_PREFILL_ENABLED=true` dipasang di environment Production proyek backend. Deployment Vercel memakai environment saat ia dibangun, jadi modul baru menyala lewat deployment baru ini. Frontend tetap C91 dan situs panduan tidak berubah. Tidak ada migrasi (journal tetap 56, terakhir `0055_surat_diimpor_at`).

## Yang berubah bagi pengguna

Di **Tambah Surat Masuk** dan **Tambah Surat Keluar**, di atas formulir kini tampil kotak **Punya PDF suratnya?**. Setelah PDF dipilih, kotak itu menampilkan isian yang terbaca dari berkas; tombol **Isi formulir** mengisikannya ke isian yang masih kosong. Sifat surat dan kelas keamanan tidak pernah diisi dari berkas, isian yang sudah diketik tidak diubah, dan PDF hasil pindai tanpa teks tidak dapat dibaca. Formulir Edit tidak berubah. Cara pakainya ada di panduan Surat Masuk dan Surat Keluar.

## Langkah

| Langkah | Hasil | Waktu |
|---|---|---|
| Env Production backend | `SIMSA_LETTER_PDF_PREFILL_ENABLED` ditambahkan dengan nilai `true`. Belum berpengaruh sampai ada deployment baru | ±11:38 |
| Sumber rilis | `release-source.mjs prepare` pada `7eb1862c`: 1.826 berkas, manifest `015bf9baa9b9f0cb60a69c4e102d9c93ecea6e9d2d9cd1505faab80ab53d67c3`, sama dengan C88 | ±11:38 |
| Target rollback | Backend C88 `dpl_9dwTkfYspEWt4iyg1MZCNidUBg7V`, dibaca dari alias produksi dan dicatat di `rollback.md` sebelum build | ±11:38 |
| Kandidat backend C89 | `dpl_5CvHV8otGxZHZRr7cmK7nCrP5NEh` Ready. Verifikasi sumber lulus: pemeriksaan tipe dan 358 berkas uji (5.293 uji lulus, 3 dilewati) | 11:38–11:56 |
| Promosi backend C89 | Sukses, alias produksi menunjuk kandidat | 11:56:51–11:56:59 |
| Uji asap | `release-smoke.mjs backend` 7/7; `release-smoke.mjs frontend` 7/7 dengan bundel `index-S8gJ2H1l.js` dan proxy `/api` | ±11:57 |
| Modul | `/api/capabilities` melaporkan `letterPdfPrefill: true`; `bulkOcr` dan `advancedArchiveWorkflows` tetap `false`. `POST /api/letter-prefill` tanpa sesi ditolak (403) | ±11:57 |
| Operations Monitor | Run manual `46142371168` sukses | 11:58:34–11:58:47 |
| Log produksi | Tidak ada entri tingkat error di proyek backend dalam 25 menit terakhir | ±11:58 |

## Pemeriksaan di produksi

Dengan akun Super Admin di peramban, sekitar pukul 12:00. Berkas yang dipakai adalah PDF fiktif satu halaman yang dibuat untuk pengujian (nota dinas contoh), bukan surat asli. Formulir tidak disimpan.

| Bagian | Hasil |
|---|---|
| Kotak di Tambah Surat Masuk | "Punya PDF suratnya?" dengan tombol **Pilih berkas PDF** tampil di atas formulir |
| Membaca PDF | Setelah berkas dipilih, chunk `vendor-pdfjs` dan pekerja `/assets/pdf.worker.min-B5Yc7dP4.js` dimuat (200), lalu `POST /api/letter-prefill` dijawab 200. Kotak menampilkan keenam isian dengan benar: Jenis Surat (Nota Dinas), Nomor Surat, Tanggal Surat, Perihal, Dari, dan Kepada |
| Sebelum tombol ditekan | Tidak ada isian formulir yang berubah |
| **Isi formulir** | Keenam isian terisi; muncul "6 isian diisi dari berkas. Periksa kembali sebelum menyimpan."; tombol menjadi tidak aktif. Sifat Surat tetap "Biasa" |
| Konsol peramban | Tanpa galat |
| Membatalkan | **Batal** lalu **Tinggalkan halaman**: kembali ke daftar Surat Masuk, tidak ada draf isian tersisa, tidak ada permintaan simpan atau unggah yang dikirim |
| Tambah Surat Keluar | Kotak dan tombol **Pilih berkas PDF** tampil |

Yang belum diperiksa:

- **PDF surat asli.** Ketepatan baca pada surat nyata belum diuji; contoh fiktif memakai tata letak yang rapi.
- **PDF hasil pindai** dan **akun Admin Unit** belum dicoba di produksi; keduanya hanya tercakup uji otomatis.
- **Menyimpan surat** setelah isian diisi dari berkas belum dicoba di produksi, agar tidak meninggalkan data uji.

## Deployment

| Komponen | Deployment aktif | Sumber | Rollback |
|---|---|---|---|
| Backend | `dpl_5CvHV8otGxZHZRr7cmK7nCrP5NEh` (C89) | `main` `7eb1862c`, modul menyala | C88 `dpl_9dwTkfYspEWt4iyg1MZCNidUBg7V` (modul mati) |
| Frontend | `dpl_3g867KX6K9nVyBdePrh2nVErWXsi` (C91) | `main` `7eb1862c` | C90 `dpl_BRgRJDdkn6r7fgzGD96jv6mZTaNi` |
| Situs panduan | `dpl_FXuf7bnve59ieAvYQBqhHv4ofjzL` | `main` `7eb1862c` | `dpl_HRb5o1C5moMbuZJo7SuFQvbbQHv9` |

Mematikan modul: promosikan kembali backend C88. Deployment itu dibangun tanpa flag, jadi modul langsung mati dan kotaknya hilang dari formulir pada pemuatan halaman berikutnya. Agar build berikutnya juga mati, hapus variabelnya (`vercel env rm SIMSA_LETTER_PDF_PREFILL_ENABLED production`) atau ubah nilainya menjadi `false`. Modul tidak menyimpan apa pun, jadi tidak ada data yang perlu dibersihkan.
