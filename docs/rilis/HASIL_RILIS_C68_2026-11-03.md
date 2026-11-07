# Hasil rilis C68: pembaruan dependensi backend, 3 November 2026

Lanjutan `HASIL_RILIS_C67_2026-11-01.md`. Semua waktu dalam UTC (WIB = UTC+7). Rilis ini hanya untuk backend, tanpa migrasi dan tanpa perubahan env. Frontend tetap C62. Kredensial tidak pernah dicatat.

## Isi rilis (`main` `80dd766`)

**PR #132** (`80dd766`) menggabungkan PR Dependabot #124 sampai #128 beserta perbaikannya. Bagian yang ikut ke bundel backend:

- **dotenv 17 → 18** (dependensi runtime).
  - dotenv 18 menulis pesan "injected env" ke stderr. Di Vercel, pesan itu akan tercatat sebagai log error pada setiap cold start fungsi.
  - Semua pemanggilan `config()` di backend sekarang memakai `quiet: true, override: false`. Dengan begitu tidak ada log, dan `.env` tidak bisa menimpa variabel yang sudah diset di shell, walaupun `DOTENV_OVERRIDE` atau `DOTENV_CONFIG_OVERRIDE` diset di sana.
- **`@vercel/functions` 3.10.3 → 3.10.4** (dependensi runtime).

Bagian yang tidak mengubah bundel backend:

- `@electric-sql/pglite` 0.5.12 hanya dipakai untuk test.
- Workflow `operations-fixity`, `operations-recovery`, dan `release-vercel` memakai `actions/upload-artifact` v7.0.2. Perubahan ini berlaku sejak merge, karena workflow membaca kode dari `main`.
- Dependabot tidak lagi mengusulkan kenaikan mayor `@types/node`, karena runtime tetap Node 24. Akibatnya #129 dan #130 ditutup oleh Dependabot sendiri.
- Perubahan frontend (klien `better-auth` 1.7.14, `@vercel/config` 0.14.0, dan ESLint 10 dengan `eslint-plugin-react-hooks` 7.1.1) belum dirilis. Perubahan itu ikut rilis frontend berikutnya.

Migrasi: tidak ada. Journal tetap 54 entri, terakhir `0053_list_audit_attachment_indexes`.

## Persiapan

| Langkah | Hasil | Waktu |
|---|---|---|
| Merge | #132 disetujui efanwahyu pukul 06:21:00, lalu digabung otomatis (*auto-merge*) setelah semua cek wajib hijau. Run CI `push` `41589447633` di `main` sukses untuk semua job | 06:22:13; CI 06:22:16–06:32:47 |
| Sumber rilis | `release-source.mjs prepare --commit 80dd7661ad23…`: 1.420 berkas, manifest `40295ae80bed83bc026fb7f9dc38e6069a242038bcfebf3b61f09f502acad0cb`, 54 migrasi. `verify` lulus | ±06:25 |
| Kandidat backend C68 | `dpl_3N9EyrpNSBS3ZzbVnWTX612qwZAf`. 280 berkas / 3.872 test lulus. `SIMSA candidate backend: source checks passed`. Runtime PDF terverifikasi (`pageCount` 1, worker dan canvas native terbawa). Build 16 menit di `sin1`. Log build tidak memuat baris "injected env" | 06:25:47–06:43:23 |
| Cek kandidat | `vercel-release.mjs candidate`: READY, target production, project yang benar, dan belum melayani alias (alias masih C67) | ±06:45 |
| Titik pulih | Tidak ada migrasi, jadi tidak perlu backup tambahan. Target rollback C67 dicatat sebelum promosi | ±06:45 |

## Promosi

| Langkah | Hasil | Waktu |
|---|---|---|
| Promosi backend C68 | Sukses; alias `simsa-backend.vercel.app` → `dpl_3N9EyrpNSBS3ZzbVnWTX612qwZAf` | 06:59:38–06:59:51 |
| Smoke backend | `release-smoke.mjs backend` 7/7; `/ready` 200 `ready` (database, Blob, dan pemindai siap) | 07:00:02 |
| Operations Monitor | Run manual `41593413464` sukses: `Pemindai: fresh`, `Monitoring operasional: sehat` | 07:00:09–07:00:25 |

## Pemeriksaan setelah promosi

- `vercel logs` backend produksi sejak 06:59:38 mencatat 10 entri, semuanya dari C68 dan berlevel `info`: 5 respons 200 dan 5 respons 401 yang diharapkan dari smoke. Tidak ada log `error` dan tidak ada respons 5xx.
- Tidak ada entri yang memuat "injected env" atau "dotenv", termasuk entri cold start pertama (`/health`, yang dibuka dengan log `EmailService`). Perbaikan `quiet: true` bekerja di produksi.
- Frontend tidak berubah.

## Deployment

| Komponen | Deployment aktif | Sumber | Rollback |
|---|---|---|---|
| Backend | `dpl_3N9EyrpNSBS3ZzbVnWTX612qwZAf` (C68, `sin1`) | `main` `80dd766` | C67 `dpl_BoJoQjfF1uqRCGj1BqcZP3Jkfiio` |
| Frontend | `dpl_CqeUR1HmdnEbqJCFX6Gr3nytjf2r` (C62) | `main` `93dbe98` | Tidak berubah |

Rollback cukup dengan mempromosikan C67, karena skema database dan env produksi tidak berubah. Perubahan workflow dan konfigurasi Dependabot dari #132 tetap berlaku setelah rollback, karena keduanya dibaca dari `main`, bukan dari deployment.

## Sisa

- Run `operations-fixity` dan `operations-recovery` berikutnya adalah run pertama dengan `upload-artifact` v7. Periksa bahwa artefaknya terunggah.
- Unggahan lampiran pertama setelah rilis memicu pemindaian berkas di C68. Smoke dan Operations Monitor sudah memastikan pemindai siap, tetapi unggahan lewat akun pengguna belum diuji.
- Setelah #132 masuk, Dependabot membuka #133 sampai #137. Triase PR tersebut berjalan terpisah.
- #118 masih menunggu paket Pro.
