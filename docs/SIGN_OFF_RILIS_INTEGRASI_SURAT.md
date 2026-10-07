# Lembar sign-off rilis integrasi surat (P0–P5)

Pendamping §4 `RILIS_INTEGRASI_SURAT_P0_P5.md`. Kolom **Bukti** hanya merujuk catatan yang sudah ada; status akhir tetap ditetapkan pemilik baris (Keamanan, Spec, Data, Operator, CI). Produksi saat penyusunan: backend C51 `dpl_BCwR7GLsZSgfiYq9MuYLVaJuJTkd`, frontend C50 `dpl_8P7cMrmofdfhLEWFFQ9YwoRov7fP`, database 51 migrasi.

## Baris dengan bukti tercatat

| ID | Bukti | Usulan status |
|---|---|---|
| P3-1b | `is_unit_pengawas` hanya `ditjen` dan `sesditjen` (diperiksa 4 Okt setelah koreksi direktorat 08:35–08:36; `HASIL_RILIS_C50_C51_2026-10-04.md` temuan 3) | disahkan Keamanan |
| P3-8 | `admin_unit` `dir_bppt`/`dir_ptep`/`dir_ktpp` dibuat 4 Okt; `RANGKAIAN_AJUKAN_AKSES` tidak diset; backfill dan `/ready` di `HASIL_RILIS_INTEGRASI_SURAT_TAHAP_AB_2026-10-03.md` | disahkan Operator |
| P3-7, P4-11 | C48 frontend dan backend dari satu `git archive` (`20b2787`), dipromosikan 10:59:29 dan 10:59:45 (`HASIL_RILIS_INTEGRASI_SURAT_TAHAP_C_2026-10-03.md`) | disahkan Operator |
| P4-14 | Uji asap produksi data sintetis `HASIL_UJI_ASAP_INTEGRASI_SURAT_2026-10-04.md` (butir 1–7 lulus; uji akun Dit. BPPT dan isolasi Dit. PTEP lulus 6 Okt 2026, laporan operator) | disahkan Operator |
| P4-15 | `batasDataLama` `2026-10-03T03:48:44.501Z` (dokumen Tahap A–B dan Tahap C) | disahkan Operator |
| P5-d | `grants/0003` dijalankan `neondb_owner`; migrasi 0049; C48 setelah 0049 (Tahap C langkah 13–14). Sign-off pemilik DB atas pelaksana 0003 tetap diperlukan | disahkan Spec + pemilik DB |
| P5-e | Gerbang (e) = tidak ada data lama (`surat_masuk.created_by IS NULL` = 0) | disahkan Data |
| P5-a, P5-c, P5-g, P5-h, P5-CTRL5 | Tahap D tidak berlaku karena tidak ada data lama; flag terkait tidak diset | tidak berlaku |
| P5-f | 0048 tidak dilewati; P5 dirilis | tidak berlaku |
| P3-6, P4-10, bagian CI P5-i | CI 9/9 hijau (PG16/17/18) pada setiap PR yang di-merge, termasuk PR #23 (P5) dan PR #27–#33 | disahkan CI |

## Baris yang memerlukan keputusan pemilik

P0-1, P0-2 (Pengesahan laporan pre-flight), P1-1, P3-1a, P3-1c, P3-1d, P3-1e, P3-C12a, P3-C12b, P3-C12c, P3-3, P3-4, P3-5, P3-9, P4-1 s.d. P4-10, P4-12, P4-13, P5-b, dan bagian Spec/Keamanan P5-i. Bukti teknis tiap baris ada pada runbook P3/P5 dan PR terkait; sign-off adalah keputusan pemilik, bukan hasil uji otomatis. P4-4 memerlukan **penerimaan tertulis** pemilik spesifikasi atas p95 perihal luas untuk pengawas dan super_admin (128–169 ms).

## Pengesahan

| Peran | Nama | Tanggal | Catatan |
|---|---|---|---|
| Pemilik keamanan | | | |
| Pemilik spesifikasi | | | |
| Pemilik data / TU | | | |
| Operator rilis | | | |
