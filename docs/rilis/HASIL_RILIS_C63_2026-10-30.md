# Hasil rilis C63: jejak audit penghapusan dosir, 30 Oktober 2026

Lanjutan `HASIL_RILIS_C62_2026-10-30.md`. Semua waktu dalam UTC (WIB = UTC+7). Rilis ini hanya backend dan tidak membutuhkan kredensial database.

## Isi rilis (`main` `ee3818a`)

- **PR #101** (`c1f3b82`): laporan rilis C62 (dokumentasi).
- **PR #102** (`ee3818a`): penghapusan dosir kini mencatat semua tautan surat yang ikut terhapus, yaitu ID surat, waktu ditautkan, dan catatan. Tautan itu dicatat di log audit penghapusan, termasuk tautan ke surat yang tidak terlihat oleh penghapus, sehingga bisa dipulihkan. Baris dosir dikunci selama penghapusan supaya tidak ada tautan baru yang lolos dari pencatatan. Respons API dan perilaku penghapusan tidak berubah.

Tanpa migrasi (journal tetap 53, terakhir `0052`), tanpa perubahan grant atau env. Tidak ada perubahan frontend sejak sumber C59 (`5602120`), jadi frontend tetap C59.

## Langkah

| Langkah | Hasil | Waktu |
|---|---|---|
| Merge | #102, disetujui efanwahyu, 9/9 cek CI hijau | 07:36:27 |
| Sumber rilis | `release-source.mjs prepare --commit ee3818ae86618ab6…`, 1.719 berkas, manifest `1246d1cd804065c5a0d2d4ae1e7c9169d09662475d63a173542e4e08ba6303a5`, 53 migrasi; `verify` lulus | ±07:39 |
| Kandidat backend C63 | `dpl_HMgs1aNyExKJGmsDYE9S5SAmiJmY`; 294 berkas / 4.267 test lulus; `SIMSA candidate backend: source checks passed`; build 15 menit; `api/index` dan `api/internal-malware-scan` di `sin1` | 07:39–07:55 |
| Promosi backend C63 | Sukses | 07:56:52–07:57:00 |

## Smoke setelah promosi

- Alias `simsa-backend.vercel.app` → `dpl_HMgs1aNyExKJGmsDYE9S5SAmiJmY`.
- `release-smoke.mjs backend` 7/7. `/health` 200. `/ready` 200 `degraded` hanya karena worker malware masih `standby/awaiting_first_run_on_deployment`; status ini wajar sesaat setelah promosi. Database dan Blob siap. Endpoint terlindung tanpa sesi mengembalikan 401.
- `/api/auth/get-session` 200. `/api/dosir` tanpa sesi 401.
- `vercel logs` produksi sejak 07:56: 0 log `error` dan 0 respons 5xx (dicek 07:57, 9 request tercatat).

## Deployment

| Komponen | Deployment aktif | Sumber | Rollback |
|---|---|---|---|
| Backend | `dpl_HMgs1aNyExKJGmsDYE9S5SAmiJmY` (C63, `sin1`) | `main` `ee3818a` | C62 `dpl_2JBe8B1M1cEhiNFXX8a6tqNpUVAV` |
| Frontend | `dpl_9zWKN51Sczxp3CNwFj8A2fikAwj6` (C59, tidak berubah) | `main` `5602120` | C58 `dpl_8HwvgyFtRUFiHQs5khQttg3aNYe4` |

Rollback ke C62 tidak menyentuh database karena skemanya sama. C62 dan C63 sama-sama cocok dengan frontend C59.

## Sisa

- Tidak ada pekerjaan teknis tersisa dari rilis ini.
