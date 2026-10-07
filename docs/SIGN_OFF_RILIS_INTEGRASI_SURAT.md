# Persetujuan pemakaian integrasi surat (P0–P5)

SIMSA adalah aplikasi internal untuk membantu mencatat dan mencari surat masuk, surat keluar, dan arsipnya. SIMSA bukan pengganti tata naskah atau arsip resmi instansi. Karena itu, sign-off per baris oleh pemilik keamanan, spesifikasi, dan data (§4 `RILIS_INTEGRASI_SURAT_P0_P5.md`) diganti dengan satu persetujuan atasan langsung. Tabel §4 tetap menjadi daftar periksa teknis bagi operator, bukan syarat tanda tangan.

Produksi saat persetujuan: backend C53 `dpl_6xHiuwE46hNrqLMMnvYFTibBzC67`, frontend C50 `dpl_8P7cMrmofdfhLEWFFQ9YwoRov7fP`, database 51 migrasi.

## Ringkasan bukti

| Hal | Bukti |
|---|---|
| Rilis P0–P5 di produksi | `HASIL_RILIS_INTEGRASI_SURAT_TAHAP_AB_2026-10-03.md`, `HASIL_RILIS_INTEGRASI_SURAT_TAHAP_C_2026-10-03.md`, `HASIL_RILIS_C49_2026-10-04.md` s.d. `HASIL_RILIS_C53_2026-10-07.md` |
| Uji asap data sintetis dan uji akun direktorat lulus | `HASIL_UJI_ASAP_INTEGRASI_SURAT_2026-10-04.md` |
| CI 9/9 hijau pada setiap PR yang di-merge | PR #23 dan PR #27–#39 |
| Lampiran hanya di penyimpanan privat; pemindaian malware otomatis | `HASIL_RILIS_C52_2026-10-05.md`, `HASIL_RILIS_C53_2026-10-07.md` |
| Unit pengawas hanya `ditjen` dan `sesditjen`; admin unit direktorat dibuat | `HASIL_RILIS_C50_C51_2026-10-04.md` |
| Tidak ada data lama, sehingga Tahap D tidak berlaku | Gerbang (e): `surat_masuk.created_by IS NULL` = 0 |

## Yang tetap berlaku tanpa keputusan baru

- `RANGKAIAN_AJUKAN_AKSES` dan `RANGKAIAN_DISPOSISI_LAMA_READ` tetap tidak diset. Menyalakannya memerlukan persetujuan atasan tersendiri.
- Kinerja pencarian perihal luas untuk pengawas dan super_admin (p95 128–169 ms, P4-4) diterima sebagai bagian persetujuan ini.
- Laporan insiden store Blob publik lama ditangani terpisah, lewat atasan atau petugas keamanan informasi.

## Persetujuan

Integrasi surat SIMSA disetujui untuk dipakai TU dan unit kerja mulai tanggal di bawah.

| Peran | Nama | Tanggal | Tanda tangan / rujukan persetujuan |
|---|---|---|---|
| Atasan langsung | | | |
| Operator SIMSA | | | |

Persetujuan boleh berupa tanda tangan di lembar ini, nota dinas, atau pesan tertulis; cukup catat rujukannya di kolom terakhir.
