# Pemeriksaan integritas berkas berkala

Pekerjaan `start:file-fixity` membaca ulang berkas privat yang sudah lolos antivirus dan mempunyai baseline SHA-256. Hasil harus cocok dengan **hash dan ukuran** yang tercatat. Untuk GCS, pembacaan dikunci pada generation yang tercatat. Ini mendeteksi perubahan atau kerusakan; pemeriksaan tidak membuktikan kebenaran isi surat atau pengesahan pejabat.

## Menjalankan dan menjadwalkan

Terapkan migrasi sampai 0037 dan grant convergence dari checkout yang sama sebelum memakai worker ini. Gunakan identitas database anggota `simsa_worker_runtime`, bukan akun API atau migrator. Gunakan konfigurasi penyimpanan privat yang sama dengan worker antivirus. Image worker memuat `dist/workers/file-fixity.js`.

Untuk satu eksekusi pada lingkungan yang sudah dikonfigurasi:

```sh
npm run start:file-fixity
```

Untuk paket Compose yang tersedia di repository:

```sh
docker compose --env-file .env -f deploy/workers/compose.yml --profile maintenance run --rm file-fixity
```

Bootstrap worker GCP memasang `simsa-file-fixity.timer`. Timer berjalan setiap 15 menit, dengan penundaan acak hingga 2 menit; setiap berkas yang cocok dijadwalkan ulang setelah 7 hari. Pada server lain, pasang perintah tersebut di scheduler milik server dan tangkap exit status serta lognya. Belum ada scheduler yang dipasang pada komputer pengguna hanya karena dokumen ini tersedia.

| Pengaturan | Default | Batas yang diterima |
|---|---:|---|
| `FIXITY_BATCH_SIZE` | 20 berkas per eksekusi | 1–100 |
| `FIXITY_INTERVAL_SECONDS` | 604800 (7 hari) | 3600–31536000 |
| `FIXITY_RETRY_SECONDS` | 3600 (1 jam) | 60–86400 |
| `FIXITY_MAX_BYTES` | 67108864 (64 MiB) | 1–536870912 |
| `FIXITY_TIMEOUT_MS` | 30000 | 1000–120000 |

Dengan default, satu eksekusi membaca paling banyak 20 berkas dan satu pembacaan paling lama 30 detik. Batasi waktu proses scheduler dengan ruang tambahan untuk database. Sesuaikan frekuensi/jumlah batch terhadap inventaris dan kapasitas storage; jangan menaikkan batas tanpa memeriksa durasi dan biaya baca. Nilai konfigurasi yang tidak valid menggagalkan worker.

## Hasil dan respons petugas

Worker menulis ringkasan `checked`, `matched`, `mismatched`, `failed`, `stale`. Exit 0 berarti eksekusi berhasil tanpa ketidakcocokan/kegagalan. Exit 1 atau tidak adanya eksekusi sesuai jadwal harus memicu notifikasi petugas melalui fasilitas monitoring server. Status HTTP `/ready` tidak membuktikan timer ini sudah berjalan.

- `match`: hash dan ukuran cocok; jadwal berikutnya disimpan.
- `mismatch`: berkas ditandai tidak cocok. Jalur unduh terkendali menolak berkas tersebut. Worker berkala tidak memulihkannya otomatis. Pertahankan bukti, periksa storage/riwayat versi dan backup, lalu lakukan pemulihan melalui prosedur yang disetujui sebelum pemeriksaan manual.
- `error`: penyimpanan gagal dibaca, baseline tidak lengkap, atau batas waktu/ukuran terlampaui. Tidak ada verifikasi baru yang dinyatakan berhasil; percobaan ulang menunggu jeda. Selidiki kode stabil pada `last_error_code`.
- `stale`: baseline berubah atau lease diambil worker lain. Hasil lama tidak mengesahkan berkas baru. Periksa perubahan bersamaan dan jalankan ulang setelah penyebabnya selesai.

Setiap hasil yang masih memiliki lease sah dicatat bersama audit dalam satu transaksi. Jika audit gagal, pembaruan verifikasi dibatalkan. Lease yang hilang tidak menghasilkan audit verifikasi palsu. Tabel jadwal tidak dapat ditulis atau dihapus oleh akun API.

Petugas operasi dapat memeriksa:

```sql
SELECT last_result, count(*) FROM file_fixity_jobs GROUP BY last_result;
SELECT count(*) AS overdue, min(next_check_at) AS oldest_due
FROM file_fixity_jobs j JOIN file_attachments f ON f.id=j.attachment_id
WHERE j.next_check_at < now() AND f.storage_access='private'
  AND f.malware_scan_status='clean' AND f.integrity_status <> 'mismatch';
SELECT count(*) AS missing_schedule
FROM file_attachments f LEFT JOIN file_fixity_jobs j ON j.attachment_id=f.id
WHERE j.attachment_id IS NULL AND f.storage_access='private'
  AND f.malware_scan_status='clean' AND f.sha256 IS NOT NULL
  AND f.integrity_status <> 'mismatch';
```

Pantau antrean terlambat dan berkas yang belum terjadwal, selain exit worker. Penemuan berkas baru juga dibatasi per batch. Berkas tanpa hash, belum bersih, publik, atau sudah mismatch memerlukan penanganan terpisah dan tidak dianggap berhasil diperiksa.

## Backup dan uji penerimaan

Backup database saja tidak menyimpan byte dokumen. Simpan database, inventaris berkas beserta locator/generation/hash/ukuran, dan salinan/versioning storage dengan kebijakan retensi yang disahkan. Pulihkan keduanya pada lingkungan terpisah, verifikasi hash/ukuran serta relasi metadata, dan uji unduh dengan pengguna yang berwenang. Pertahankan baseline asli ketika pemeriksaan gagal; mengganti hash dengan hash berkas rusak bukan pemulihan.

Uji penerimaan operasi mencakup berkas cocok, byte berubah, storage tidak tersedia, waktu baca habis, proses berhenti/lease kedaluwarsa, dan alarm saat timer tidak berjalan. Pengujian otomatis memakai berkas sintetis dan PostgreSQL terisolasi; layanan storage, scheduler, alarm, dan restore di lingkungan tujuan tetap harus dibuktikan oleh operator.
