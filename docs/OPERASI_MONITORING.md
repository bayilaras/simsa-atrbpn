# Monitoring operasional

Super Admin membuka **Administrasi → Monitoring Operasional**. Status memeriksa database, penyimpanan privat, mesin pemindai dan masa berlaku definisinya, antrean pemindaian, antrean integritas, backup, serta pemulihan. Halaman memperbarui status setiap menit saat aktif. Kegagalan pengambilan data menghapus status lama; `unknown` tidak pernah dianggap sehat.

`GET /api/operations/status` memakai sesi Super Admin. `GET /api/operations/probe` khusus CI memakai `Authorization: Bearer OPERATIONS_MONITOR_TOKEN`, kredensial acak minimal 32 karakter yang tidak memberi akses dokumen atau akun. Respons probe hanya memuat waktu dan status pemeriksaan. Respons 503 membuat pekerjaan CI gagal bila terdapat kegagalan, keterlambatan, atau bukti yang belum tersedia.

Workflow `.github/workflows/operations-monitor.yml` berjalan setiap jam setelah tersedia pada cabang default. Environment GitHub `production-monitor` menyimpan secret `OPERATIONS_MONITOR_TOKEN` yang sama dengan environment production backend Vercel. Batasi environment pada cabang default. Jalankan workflow manual satu kali dan periksa hasil sebelum menyatakan jadwal aktif. Status CI adalah kanal notifikasi awal; tidak ada pengiriman email atau webhook tambahan.

## Bukti backup dan pemulihan

Panel membaca objek **privat** `operations/recovery-status-v1.json` pada penyimpanan Blob aplikasi. Pembacaan dibatasi 16 KiB dan lima detik, tanpa cache CDN. Tidak ada URL penyimpanan, nama dokumen, data pengguna, atau kredensial dalam respons panel.

Format bukti:

```json
{
  "schemaVersion": 1,
  "backup": {
    "status": "success",
    "completedAt": "2026-09-15T00:00:00.000Z",
    "evidenceSha256": "<SHA256 laporan verifikasi>",
    "databaseVerified": true,
    "documentsVerified": true
  },
  "restore": {
    "status": "failed",
    "completedAt": "2026-09-15T00:00:00.000Z",
    "evidenceSha256": "<SHA256 laporan percobaan terakhir>",
    "databaseVerified": false,
    "documentsVerified": false
  }
}
```

Penerbit bukti harus memverifikasi artefak terenkripsi, fingerprint database dan izin, serta jumlah dan hash berkas. `restore` sukses memerlukan pemulihan nyata, termasuk pengujian akses unduhan pada lingkungan terpisah. Jangan menandai backup database saja sebagai perlindungan dokumen lengkap. Catat percobaan gagal terbaru sebagai `failed`, tanpa menghapus artefak sebelumnya. Metadata ini adalah ringkasan; simpan laporan asal dan arsip terenkripsi secara terpisah.

Backup kedaluwarsa setelah 36 jam; bukti restore setelah 90 hari. Waktu di masa depan dan hash tidak valid menjadi `unknown`. Keberhasilan upload objek status sendiri tidak membuktikan backup atau restore berhasil.

## Tindak lanjut

1. **Pemindai gagal/kedaluwarsa:** jalankan worker on-demand melalui endpoint internal terautentikasi, periksa bukti mesin dan waktu kedaluwarsa. Jangan mengganti status berkas secara manual.
2. **Antrean terlambat:** periksa worker, kegagalan penyimpanan, dan status retry. Selidiki berkas `scan_error`/`infected` tanpa merilis karantina.
3. **Integritas:** jalankan worker `file-fixity` dengan peran database worker, lalu periksa mismatch/error. Peran API tetap hanya membaca antrean. Jangan mengganti hash baseline untuk menyembunyikan mismatch.
4. **Backup/pemulihan:** jalankan pekerjaan terkait dengan target dan skema yang dipatok, terbitkan bukti baru hanya setelah pemeriksaan aktual selesai.
5. **CI tidak tersedia:** periksa secret dan keberadaan workflow pada cabang default. Berkas workflow lokal bukan bukti jadwal telah berjalan.

Pekerjaan backup lama pada cabang utama dapat memiliki kontrak skema yang lebih tua daripada produksi. Gunakan verifier yang cocok dengan migrasi produksi; kegagalan kontrak harus diperbaiki secara eksplisit sebelum backup dijalankan ulang.
