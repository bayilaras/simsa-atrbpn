# Hasil rilis C62: kontrak rute dan antrean keluar SRIKANDI, 30 Oktober 2026

Lanjutan `HASIL_RILIS_C61_C59_2026-10-30.md`. Semua waktu dalam UTC (WIB = UTC+7). Rilis ini hanya backend dan tidak membutuhkan kredensial database.

## Isi rilis (`main` `1d737b1`)

- **PR #98** (`9dd9192`): laporan rilis C61/C59 (dokumentasi).
- **PR #99** (`25d9d93`): kontrak rute. Setiap handler HTTP tercatat bersama mekanisme aksesnya, dan tes gagal bila ada rute baru yang tidak tercatat. Hanya tes, tanpa perubahan perilaku.
- **PR #100** (`1d737b1`): respons antrean keluar SRIKANDI mengikuti visibilitas daftar surat. Pada baris yang surat sumbernya tidak terlihat oleh pembaca di daftar surat, isi surat di payload dan respons SRIKANDI disamarkan. Status dan riwayat pengiriman tetap tampil.

Tanpa migrasi (journal tetap 53, terakhir `0052`), tanpa perubahan grant atau env. Tidak ada perubahan frontend sejak sumber C59 (`5602120`), jadi frontend tetap C59.

## Langkah

| Langkah | Hasil | Waktu |
|---|---|---|
| Merge | #99 dan #100, keduanya disetujui efanwahyu | 03:04:12 dan 04:32:54 |
| Sumber rilis | `release-source.mjs prepare --commit 1d737b1d599cc1aa…`, 1.718 berkas, manifest `5ef7dec2c06049abffcf901d4e399aff17c0fb65fa43ee2658c2f22be4b5c9f1`, 53 migrasi; `verify` lulus | ±04:37 |
| Kandidat backend C62 | `dpl_2JBe8B1M1cEhiNFXX8a6tqNpUVAV`; 294 berkas / 4.266 test lulus; `SIMSA candidate backend: source checks passed`; build 16 menit; `api/index` dan `api/internal-malware-scan` di `sin1` | 04:38–04:54 |
| Promosi backend C62 | Sukses | 04:55:19 |

## Smoke setelah promosi

- Alias `simsa-backend.vercel.app` → `dpl_2JBe8B1M1cEhiNFXX8a6tqNpUVAV`.
- `release-smoke.mjs backend` 7/7 (`/health`, `/ready` 200 `ready`; endpoint terlindung tanpa sesi 401). `/api/auth/get-session` 200. `/api/integrations/srikandi/outbox` tanpa sesi 401.
- `vercel logs` produksi sejak 04:55: 0 log `error` dan 0 respons 5xx (dicek 04:56, 9 request tercatat).

## Deployment

| Komponen | Deployment aktif | Sumber | Rollback |
|---|---|---|---|
| Backend | `dpl_2JBe8B1M1cEhiNFXX8a6tqNpUVAV` (C62, `sin1`) | `main` `1d737b1` | C61 `dpl_93yNNqYqkiKAqsV258MQgtyJiWbW` |
| Frontend | `dpl_9zWKN51Sczxp3CNwFj8A2fikAwj6` (C59, tidak berubah) | `main` `5602120` | C58 `dpl_8HwvgyFtRUFiHQs5khQttg3aNYe4` |

Rollback ke C61 tidak menyentuh database (skemanya sama). C61 dan C62 sama-sama cocok dengan frontend C59.

## Sisa

- Tidak ada pekerjaan teknis tersisa dari rilis ini.
