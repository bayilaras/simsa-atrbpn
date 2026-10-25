# Hasil rilis C49 dan pemulihan Operational Health, 4 Oktober 2026

Lanjutan `HASIL_RILIS_INTEGRASI_SURAT_TAHAP_C_2026-10-03.md`. Setelah C48, monitor **SIMSA Operations Monitor** (`operations-monitor.yml`) gagal. Dokumen ini mencatat pemulihannya dan dua perbaikan yang dirilis sebagai C49. Semua waktu dalam UTC (WIB = UTC+7). Kredensial tidak pernah dicatat; semua nilai rahasia dimasukkan lewat prompt tersembunyi.

## Ringkasan

| Langkah | Hasil | Waktu |
|---|---|---|
| Bukti backup/pemulihan | `operations-recovery.yml` dijalankan ulang setelah secret environment `production-recovery` diperbaiki; berhasil, `backup` dan `restore` healthy | 3 Okt 15:38–15:40 |
| Backfill lampiran surat lama | `files:letter-scan-backfill:plan` → `planned: 9`, gagal 0; `apply` → `queued: 9`, gagal 0, exit 0 (6 surat masuk, 3 surat keluar, dibuat 13–17 Sep) | 3 Okt 23:25–23:26 |
| Pemindaian | Pemindai dibangunkan lewat `POST /api/upload/keluar/<id>/scan` (202); ketiga pemanggilan `internal-malware-scan` 200; antrean kosong, tidak ada `infected`/`scan_error` | 3 Okt 23:52–23:54 |
| Jadwal integritas | `operations-fixity.yml` dijalankan manual (46 s, hijau); `belum_terjadwal` 10 → 0, `mismatch` 0 | 4 Okt ~00:1x |
| Monitor | Hijau, ketujuh pemeriksaan healthy | 4 Okt ~00:2x |
| PR #27 (frontend) | Merge `4148a23`, CI 9/9 hijau, approve efanwahyu | 4 Okt |
| Frontend C49 | Kandidat `dpl_8ysikCmaEigc9YGeREerdkJsen53` dari `git archive 4148a23` (1.614 file, manifest `82980fb826cf1e191d012cf987ce499537372a4e6fcfc24f681273b38482e5b3`); 148 berkas / 1.059 test lulus; dipromosikan | 4 Okt 03:41 |
| PR #28 (backend) | Merge `5d703b0`, CI 9/9 hijau, approve efanwahyu | 4 Okt |
| Backend C49 | Kandidat `dpl_CHrZ2pXCnFjmATUm2NJQ77BfvMcg` dari `git archive 5d703b0` (1.614 file, manifest `86d623521c96c2b356a60739e5f555a4468f57d4cd6b4e0777f2721ac2829bab`); `tsc` bersih, 267 berkas / 3.887 test lulus; dipromosikan | 4 Okt 04:48 |
| Monitor dengan kode C49 | Hijau | 4 Okt ~04:5x |

## Deployment

| Komponen | Deployment aktif | Sumber | Rollback (C48) |
|---|---|---|---|
| Backend | `dpl_CHrZ2pXCnFjmATUm2NJQ77BfvMcg` | `main` `5d703b0` | `dpl_Bnfs1HZhPK4dVrXLukwGZybtvi9z` |
| Frontend | `dpl_8ysikCmaEigc9YGeREerdkJsen53` | `main` `4148a23` (kode frontend identik dengan `5d703b0`) | `dpl_Fa5jRxNxffCE5ikzo3gU4C32dL7K` |

Database tidak berubah: 51 migrasi, tanpa migrasi baru. Rollback kode ke C48 aman untuk kedua komponen.

Smoke setelah promosi backend: `/ready` 200 langsung dan lewat proxy frontend (5×; pertama 3,3 s karena *cold start*), `/health` 200, `/api/operations/probe` tanpa token 401, 0 galat runtime. Build git frontend dari merge #28 (`dpl_2h2W4YvVK9oqPNnRexUh2hkPvjH7`) dibatalkan Ignored Build Step seperti seharusnya.

## Temuan dan perbaikan

1. **Token Blob untuk skrip lokal.** Lampiran produksi ada di store privat `simsa-arsip-private` (`oCG80crbZI1PLMP4`). Backend Production memperolehnya dari `SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN` (sensitive), yang dipetakan ke `BLOB_READ_WRITE_TOKEN` oleh `backend/lib/vercel-private-blob.mjs`. Variabel proyek `BLOB_READ_WRITE_TOKEN` (All Environments) adalah token **store lama** (`A3HOx…`); dry-run pertama dengan token itu gagal membaca kesembilan objek (tanpa perubahan data). Untuk skrip lokal, ambil token dari halaman store `simsa-arsip-private` dan pastikan `$env:BLOB_READ_WRITE_TOKEN.Split('_')[3]` = `oCG80crbZI1PLMP4`. `docs/OPERASI_ANTIVIRUS_BITSTREAM.md` masih menyebut "`BLOB_READ_WRITE_TOKEN` produksi"; artinya nilai alias privat ini.
2. **Tombol pemulihan karantina tersembunyi untuk surat (PR #27).** `FilePreviewSection.jsx` masih mengecualikan lampiran surat di Vercel Blob dari panel karantina, padahal sejak C48 backend memindai dan mengunci (423) lampiran surat. Akibatnya **Lanjutkan pemeriksaan** tidak tersedia untuk surat. Diperbaiki di frontend C49.
3. **Monitor merah setiap ada berkas baru (PR #28).** Jadwal integritas hanya dibuat worker fixity harian (00:45 UTC, batch 10); peran API sengaja tidak punya `INSERT` pada `file_fixity_jobs`. Monitor berjalan tiap jam, sehingga berkas yang baru `clean` memerahkan monitor sampai jadwal harian berikutnya. Backend C49 hanya menghitung berkas bersih yang belum terjadwal bila `coalesce(last_fixity_check_at, created_at)` lebih tua dari 26 jam. Bila lebih dari 10 berkas menjadi bersih per hari, backlog tetap terlihat setelah tenggang; naikkan `FIXITY_BATCH_SIZE` di workflow bila itu terjadi.
4. **Koreksi jadwal backup.** Backup harian otomatis dijalankan `operations-recovery.yml` (00:15 UTC). `backup-neon.yml` tidak lagi punya jadwal (Disabled); catatan di dokumen Tahap C dan uraian "backup terjadwal `backup-neon.yml`" di `RILIS_INTEGRASI_SURAT_P0_P5.md` merujuk ke perilaku lama.

## Sisa

- Pantau jadwal 5 Okt: `operations-recovery.yml` 00:15, `operations-fixity.yml` 00:45, monitor tiap jam (menit 17).
- Uji panel **Periksa status / Lanjutkan pemeriksaan** pada unggahan surat berikutnya.
- Salin bundle + kunci Backup #2 dan #3 ke penyimpanan di luar laptop, cocokkan SHA-256, lalu hapus salinan lokal.
- Penugasan `admin_unit` direktorat; tolak disposisi surat uji "UJI RILIS C47" di Ditjen.
- Token store lama (`BLOB_READ_WRITE_TOKEN`, "Needs Attention" di Vercel): tinjau terpisah sebelum dihapus atau dirotasi.
