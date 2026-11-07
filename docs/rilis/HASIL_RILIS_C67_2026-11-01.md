# Hasil rilis C67: hemat kuota Blob di paket Hobby, 1 November 2026

Lanjutan `HASIL_RILIS_C66_C62_2026-11-01.md`. Semua waktu dalam UTC (WIB = UTC+7). Rilis ini hanya untuk backend, tanpa migrasi dan tanpa perubahan env. Frontend tetap C62. Kredensial tidak pernah dicatat.

Paket Vercel masih Hobby karena upgrade ke Pro ditunda. Karena itu, perbaikan operasi dari #118 dipecah: bagian yang aman untuk Hobby masuk ke #123 dan dirilis sekarang, sedangkan #118 tinggal berisi batas backup untuk Pro.

## Isi rilis (`main` `60f3ecc`)

**PR #123** (`60f3ecc`):

- **Backup** (workflow; berlaku sejak merge)
  - Anggaran dokumen dihitung atas objek unik setelah deduplikasi URL. Sebelumnya, 21 referensi terhitung 112 MiB, padahal objek uniknya hanya 19 dengan ukuran 74 MiB.
  - Batas untuk Hobby: 160 MiB objek unik, 100 objek unik, dan 1.000 referensi.
  - Peringatan muncul pada pemakaian 75%, atau bila sisa ruang lebih kecil dari satu batch unggah massal (50 berkas / 100 MiB).
- **Fixity** (workflow; berlaku sejak merge)
  - Berjalan dua kali sehari dengan batch 20.
  - Berkas baru didaftarkan terpisah dari batch baca, lalu disebar ke run berikutnya.
- **Monitor** (backend; berlaku dengan rilis ini): toleransi keterlambatan fixity naik dari 1 jam menjadi 28 jam.
- **Penghematan operasi Blob** (backend; berlaku dengan rilis ini)
  - Readiness yang dilayani (`/ready`, `/api/health`, panel, probe CI, dan wake pemindai) memakai ulang hasil probe `list()` Blob yang lulus selama 10 menit. Probe yang gagal selalu diulang.
  - Status operasional memakai ulang bukti backup yang berhasil dibaca selama 10 menit.
  - Sebelumnya, Monitoring Operasional yang terbuka memicu kira-kira satu *advanced operation* per menit, sedangkan jatah Hobby hanya 2.000 per 30 hari.

**#118** sekarang hanya berisi `ed90e6f` (1 GiB, 1.000 objek, 2.000 referensi, timeout 60 menit) dengan base `main`. PR ini menunggu paket Pro.

Migrasi: tidak ada. Journal tetap 54 entri, terakhir `0053_list_audit_attachment_indexes`.

## Persiapan

| Langkah | Hasil | Waktu |
|---|---|---|
| Merge | #123 disetujui efanwahyu pukul 07:25:10 dan digabung setelah semua cek wajib hijau. Run CI `push` `41285061093` di `main` sukses untuk semua job | 07:30:36; CI 07:30:39–07:41:26 |
| Sumber rilis | `release-source.mjs prepare --commit 60f3ecc2f54d…`: 1.417 berkas, manifest `119720d537bc28a1f8fe72983e2816acefab9e184d957efb91ad132088b8878f`, 54 migrasi. `verify` lulus | ±07:31 |
| Kandidat backend C67 | `dpl_BoJoQjfF1uqRCGj1BqcZP3Jkfiio`. 280 berkas / 3.872 test lulus. `SIMSA candidate backend: source checks passed`. Runtime PDF terverifikasi (`pageCount` 1, worker dan canvas native terbawa). Build 15 menit di `sin1` | 07:31:26–07:47:07 |
| Titik pulih | Tidak ada migrasi, jadi tidak perlu backup tambahan. Target rollback C66 dicatat sebelum promosi | 07:47 |

## Promosi

| Langkah | Hasil | Waktu |
|---|---|---|
| Promosi backend C67 | Sukses; alias `simsa-backend.vercel.app` → `dpl_BoJoQjfF1uqRCGj1BqcZP3Jkfiio` | 07:47:58–07:48:06 |
| Smoke backend | `release-smoke.mjs backend` 7/7; `/ready` 200 `ready` (database, Blob, dan pemindai siap) | 07:48:14 |
| Operations Monitor | Run manual `41286236553` sukses: `Pemindai: fresh`, `Monitoring operasional: sehat` | 07:48:17–07:48:29 |

## Pemeriksaan setelah promosi

- Pemakaian ulang probe Blob terlihat di produksi. Probe pertama setelah promosi butuh 584 ms. Tiga panggilan `/ready` berikutnya, berjarak sekitar 7 detik, melaporkan Blob siap dengan latensi 0–1 ms, artinya tanpa panggilan `list()` baru.
- `vercel logs` backend produksi sejak 07:47:58 mencatat 15 entri: 10 respons 200 dan 5 respons 401 yang diharapkan dari smoke. Tidak ada log `error` dan tidak ada respons 5xx.
- Frontend tidak berubah.

## Deployment

| Komponen | Deployment aktif | Sumber | Rollback |
|---|---|---|---|
| Backend | `dpl_BoJoQjfF1uqRCGj1BqcZP3Jkfiio` (C67, `sin1`) | `main` `60f3ecc` | C66 `dpl_7pokbUFYvEAYpeVknNi8aQovK8nf` |
| Frontend | `dpl_CqeUR1HmdnEbqJCFX6Gr3nytjf2r` (C62) | `main` `93dbe98` | Tidak berubah |

Rollback cukup dengan mempromosikan C66, karena skema database dan env produksi tidak berubah. Perubahan workflow dari #123 (backup dan fixity) tetap berlaku setelah rollback, karena workflow membaca kode dari `main`, bukan dari deployment.

## Sisa

- Pemakaian Blob harian sebelum ada pengguna sungguhan (22 Okt–1 Nov 2026): 80–165 *simple operations*, 9–40 *advanced operations*, dan transfer 78–195 MB. Batas Hobby per 30 hari adalah 10.000 *simple operations*, 2.000 *advanced operations*, dan 10 GB transfer. Bila salah satunya terlewati, Blob diblokir 30 hari.
- Selama masih Hobby, peringatan sisa ruang backup akan muncul di setiap run. Upgrade ke Pro sebelum unggah atau impor massal dokumen, lalu gabungkan #118.
- #117 dan #120 masih menunggu review. Setelah keduanya digabung, situs panduan dipublikasikan ulang.
