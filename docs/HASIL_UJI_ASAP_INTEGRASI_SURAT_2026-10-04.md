# Hasil uji asap integrasi surat, 4 Oktober 2026

Uji asap produksi dengan data sintetis setelah frontend C50 dan backend C51. Waktu dalam UTC (WIB = UTC+7). Dijalankan lewat browser bawaan Claude Code dengan sesi super_admin **efan wahyu** atas persetujuan operator, sehingga log audit mencatat akun tersebut. Data uji berawalan `UJI ASAP 5 OKT`.

## Hasil

| # | Langkah | Hasil | Bukti |
|---|---|---|---|
| 1 | Catat surat masuk di Sesditjen (Surat Dinas) dengan lampiran PDF sintetis dan disposisi ke Dit. BPPT | Lulus | `POST /api/surat-masuk` 201, nomor `002/SM/2026`, 15:37:52. Daftar tujuan disposisi memuat Ditjen, Dit. BPPT, Dit. KTPP, Dit. PTEP |
| 2 | Karantina dan pemindaian lampiran | Lulus | Unggah lewat Blob privat (`client-upload` 200); sebelum dipindai unduhan 423 `File quarantined`; pemindai dibangunkan otomatis oleh unggahan; status `clean` / `verified`; unduhan 200, 614 byte, header `%PDF-` sama dengan berkas asli |
| 3 | Rangkaian | Lulus | `RS-2026-000002`, peserta `sesditjen` (pencatat) dan `dir_bppt` (disposisi) |
| 4 | Kotak masuk Dit. BPPT → Terima Surat → Penyelesaian (catatan, tanpa surat keluar) | Lulus | `PUT …/receive` 200, `PUT …/process` 200; status Menunggu → Diterima → Selesai; rangkaian otomatis `selesai` |
| 5 | Lacak `UJI ASAP` | Lulus | 1 hasil, dikelompokkan per rangkaian, status Selesai |
| 6 | Tolak disposisi surat uji C47 (`ini cuma surat uji`, `dir_ktpp` → `ditjen`) | Lulus | `PUT …/reject` 200, status `rejected` dengan alasan "Surat uji rilis C47; bukan surat dinas, dibersihkan dari daftar kerja." |
| 7 | Galat runtime backend selama uji | Lulus | 0 log `error`/`fatal` (15:02–15:42) |

Ringkasan daftar kerja setelah uji: `disposisi_terbuka` 0, `siap_diberkaskan` 1 (rangkaian UJI ASAP), `sm_belum_ditindaklanjuti` 1 (surat uji C47 yang dikembalikan ke Dit. KTPP). Keduanya data uji dan dapat diberkaskan atau ditutup oleh admin unit masing-masing.

## Belum diuji

Langkah 4 dijalankan dengan hak super_admin pada cakupan unit Dit. BPPT. Dua uji berikut harus dilakukan pemilik akun dengan login Google masing-masing:

1. Admin Dit. BPPT membuka Distribusi dan melihat riwayat `002/SM/2026` dengan hak `admin_unit`.
2. Admin Dit. PTEP mencari `UJI ASAP` di Lacak: surat tidak dapat dibuka (tampil "Dikecualikan" atau tidak muncul).

Catat hasilnya di bawah sebelum sign-off.

| Uji | Pelaksana | Tanggal | Hasil |
|---|---|---|---|
| Admin Dit. BPPT melihat riwayat disposisi | Admin unit Dit. BPPT (akun Google sendiri) | 6 Okt 2026 | Lulus (laporan operator): `002/SM/2026` tampil Selesai di Kotak Masuk; `RS-2026-000002` dapat dibuka di Lacak |
| Isolasi Lacak admin Dit. PTEP | Admin unit Dit. PTEP (akun Google sendiri) | 6 Okt 2026 | Lulus (laporan operator): surat `UJI ASAP` tidak dapat dibuka dari Lacak dan tidak ada di Kotak Masuk PTEP |
