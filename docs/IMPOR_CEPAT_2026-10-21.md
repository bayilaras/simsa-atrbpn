# Impor Google Sheets/CSV yang cepat dan dapat dilanjutkan (2026-10-21)

Catatan desain untuk branch `perf/import-cepat`. Tujuan: tab register surat keluar
2025 (797 baris), 2024 (758) dan 2023 (642) dapat diimpor dalam satu kali klik.
Belum ada perubahan produksi; rilis mengikuti urutan di bawah.

## Masalah yang diukur

Produksi C55 (2026-10-20): ±1,4 detik per baris, termasuk baris duplikat. Impor 197
baris terhenti oleh batas fungsi Vercel 300 detik setelah ±168 baris; pengulangan
menghabiskan ±4 menit hanya untuk memeriksa ulang 168 duplikat. Dialog menyerah
setelah 30 detik dengan "Waktu tunggu permintaan habis" padahal server masih bekerja.

Penyebab: setiap SQL adalah satu round trip node-postgres, dan fungsi berjalan di
`iad1` (AS timur) sementara Neon berada di `aws-ap-southeast-1` (Singapura).

| Per baris (sebelum) | Round trip | Isi |
|---|---|---|
| Baris baru | 8 | BEGIN, upsert template, kunci template, cek identitas, no_urut terakhir, INSERT surat, INSERT audit, COMMIT |
| Baris duplikat | 5 | BEGIN, upsert template, kunci template, cek identitas, ROLLBACK |

Diukur pada PostgreSQL 18 lokal dengan proxy latensi (`backend/integration/helpers/latency-proxy.ts`)
dan penghitung kueri (`backend/integration/google-sheets-import-throughput.postgres.test.ts`).

## Perubahan

1. **Fungsi dipindah ke `sin1`** (`backend/vercel.json` `"regions": ["sin1"]`), satu wilayah AWS
   dengan Neon. Berlaku untuk semua fungsi proyek (API, malware scan, cron).
2. **Duplikat murah.** Sebelum transaksi per baris, seluruh identitas impor lembar/berkas
   (surat masuk/keluar) diperiksa dalam satu kueri (`existingSuratImportIdentities`).
   Kunci identitas dibangun oleh fungsi yang sama dengan pemeriksaan kanonik
   (`suratImportIdentityKey` → `suratImportIdentityWhere`), dan layanan surat memakai
   `importIdentityKey` yang sama di dalam `create()`. Pemeriksaan ini hanya penasihat:
   baris yang tidak ditemukan tetap melewati transaksi kanonik, yang memeriksa ulang di
   bawah kunci template unit lalu menyimpan surat dan audit. Baris yang ditemukan pasti
   duplikat (termasuk surat terhapus, karena identitas memang mencakupnya), jadi
   melewatinya tidak mengubah semantik; sebelumnya pun duplikat tidak menghasilkan audit.
   Uji Postgres membuktikan hasil kueri sama baris demi baris dengan transaksi kanonik.
3. **Impor per bagian.** Klien yang mengirim `startRow` mendapat batas waktu 25 detik per
   permintaan: server berhenti memulai baris baru, lalu mengembalikan `nextRow` dan
   `prefixHash` (SHA-256 baris sebelum `nextRow`; untuk Sheets hanya kolom yang dibaca).
   Bagian berikutnya ditolak 409 bila baris sebelumnya berubah, sehingga tidak ada baris
   yang terlewat diam-diam. Klien lama tanpa `startRow` tetap satu permintaan.
4. **Dialog jujur.** Impor Google Sheets dan CSV melanjutkan bagian berikutnya sendiri,
   menampilkan baris diproses/tersimpan/duplikat/dilewati, menunggu sendiri bila batas
   3 impor/menit tercapai, menyediakan "Hentikan setelah bagian ini" (Sheets), dan bila
   satu bagian lanjutan gagal menampilkan "Impor belum selesai" beserta jumlah yang sudah
   tersimpan. Batas waktu per bagian di klien 120 detik (sebelumnya 30 detik).

Tidak ada migrasi basis data.

## Hasil pengukuran (simulasi lokal)

Harness yang sama untuk sebelum (origin/main 03bfcc9) dan sesudah; surat keluar sintetis
dengan campuran bernomor dan tanpa nomor (identitas tautan).

| Skenario | RTT terukur | Sebelum: baris baru | Sebelum: duplikat | Sesudah: baris baru | Sesudah: duplikat |
|---|---|---|---|---|---|
| Seperti sekarang (`iad1`→Singapura), 30 baris | 233 ms | 1.867 ms/baris (8 kueri) | 1.166 ms/baris (5 kueri) | 1.891 ms/baris (8 kueri) | 8 ms/baris (1 kueri untuk 30 baris) |
| Satu wilayah (langsung ke klaster lokal), 800 baris | 0,7–0,8 ms | 12,7 ms/baris (10,1 s) | 5,0 ms/baris (4,0 s) | 12,0 ms/baris (9,6 s) | 0,1 ms/baris (1 kueri, 0,1 s) |

Angka produksi (±1,4 s campuran baru/duplikat) cocok dengan baris pertama. Di Windows,
penundaan proxy kecil (1 ms) membengkak menjadi ±14 ms karena granularitas timer, jadi
skenario satu wilayah diukur tanpa proxy; RTT `sin1`→Neon nyata diperkirakan 1–3 ms.

Perkiraan untuk tab 2025 (797 baris):

| | `iad1` (sekarang) | `iad1` + branch ini | `sin1` + branch ini |
|---|---|---|---|
| Semua baris baru | ±25 menit, tidak mungkin selesai (batas 300 s) | ±25 menit dalam ±60 bagian berprogres, selesai otomatis | ±12 ms + 8 × RTT per baris ≈ 20–30 s, 1–2 bagian |
| Impor ulang (semua duplikat) | ±15 menit, tidak mungkin selesai | 1 kueri, < 1 s setelah unduhan lembar | 1 kueri, < 1 s setelah unduhan lembar |

Perkiraan `sin1` berasal dari CPU lokal; CPU fungsi Vercel dapat berbeda.

## Trade-off wilayah `sin1`

Keuntungan
- Setiap round trip basis data turun dari ±220 ms ke orde 1–2 ms. Ini mempercepat
  seluruh API (daftar, dasbor, sesi), bukan hanya impor.
- Pengguna di Indonesia lebih dekat ke fungsi; pemrosesan berada di wilayah yang sama
  dengan data (Singapura), bukan menyeberang ke AS.
- Paket Hobby mengizinkan satu wilayah apa pun; cron Vercel berjalan di wilayah fungsi.
  Rollback ke deployment C55 otomatis kembali ke `iad1` karena wilayah melekat pada deployment.

Risiko dan yang perlu diperiksa
- **Wilayah store Blob `simsa-arsip-private`** tidak terlihat lewat API; default Vercel
  `iad1`. Bila di `iad1`, unduhan lampiran (backend men-stream Blob ke pengguna),
  pemindaian ClamAV, dan OCR menyeberang Pasifik antara Blob dan fungsi. Byte tetap
  menyeberang sekali seperti sekarang (kini antara fungsi dan pengguna), jadi dampaknya
  terutama latensi awal ±0,2 s per berkas. Unggahan berjalan langsung dari peramban ke
  Blob dan tidak terpengaruh. Periksa di Vercel → Storage → simsa-arsip-private.
  Memindahkan store ke `sin1` adalah pekerjaan terpisah (store baru + salin objek).
- **Biaya/kuota**: harga Fluid Compute dan transfer data berbeda per wilayah. Periksa
  Usage satu minggu setelah rilis.
- `functionFailoverRegions` tidak tersedia di Hobby (sama seperti sekarang).

Tanpa `sin1`, impor tetap selesai lewat bagian-bagian (duplikat tetap satu kueri), tetapi
baris baru tetap ±1,9 s per baris.

## Rilis (oleh operator)

1. Backend lebih dulu: skema baru menerima `startRow`/`prefixHash`, klien lama tetap
   berfungsi. Deployment pertama dengan `regions: ["sin1"]` harus dicek: header
   `x-vercel-id` berisi `sin1`, `/ready` hijau dan latensi DB turun, satu unduhan
   lampiran dan satu pemindaian berjalan.
2. Frontend sesudahnya (frontend baru mengirim `startRow`; backend lama menolaknya 400
   tanpa menulis apa pun).
3. Uji asap: impor ulang tab 2026 (194 baris, semua duplikat) → selesai dalam satu
   permintaan, `duplicateRows` 194, tidak ada surat/audit baru. Lalu tab 2025.

## Tidak dikerjakan

- Penyisipan beberapa baris dalam satu transaksi (±0,3 round trip per baris baru). Hanya
  perlu bila `sin1` tidak diambil; menambah jalur pembuatan kedua yang harus dijaga
  setara dengan `create()`.
- Pemeriksaan duplikat sekaligus untuk arsip CSV (masih per rekod).
