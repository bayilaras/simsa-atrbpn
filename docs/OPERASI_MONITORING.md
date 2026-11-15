# Monitoring operasional

Ringkasan layanan, jadwal, dan peran ada di [kondisi produksi](KONDISI_PRODUKSI.md); langkah saat terjadi gangguan ada di [buku saku insiden](BUKU_SAKU_INSIDEN.md).

Super Admin membuka **Administrasi → Monitoring Operasional**. Status memeriksa database, penyimpanan privat, mesin pemindai dan masa berlaku definisinya, antrean pemindaian, antrean integritas, backup, serta pemulihan. Halaman memperbarui status setiap menit saat aktif. Kegagalan pengambilan data menghapus status lama; `unknown` tidak pernah dianggap sehat.

Pembaruan tiap menit tidak menambah operasi Blob. Probe penyimpanan privat memakai `list()`, yang dihitung sebagai *advanced operation*. Penghematan berikut disusun ketika produksi masih memakai paket Vercel Hobby, yang hanya menyediakan 2.000 operasi semacam itu per 30 hari; produksi kini memakai paket Pro, tempat pemakaian di atas jatah ditagih, dan penghematan itu tetap berlaku. Probe yang lulus dipakai ulang paling lama 10 menit di dalam satu instans backend, untuk `/ready`, `/api/health`, panel, probe CI, dan wake pemindai. Probe yang gagal selalu diulang pada pemeriksaan berikutnya. Bukti backup dan pemulihan juga dipakai ulang paling lama 10 menit. Akibatnya, gangguan Blob baru dapat terlihat sampai 10 menit setelah probe terakhir yang lulus.

`GET /api/operations/status` memakai sesi Super Admin. Dengan sesi yang sama, `GET /api/operations/scan-failures` menampilkan paling banyak 50 berkas yang gagal dipindai, dan `POST /api/operations/scan-failures/requeue` atau `POST /api/operations/scan-failures/<id>/requeue` mengantrekannya ulang. `POST /api/operations/scanner-run` (tombol **Jalankan pemindai**) membangunkan pemindai seperti saat berkas diunggah; permintaan dicatat di log audit lebih dulu dan dibatasi seperti antre ulang. `GET /api/operations/probe` khusus CI memakai `Authorization: Bearer OPERATIONS_MONITOR_TOKEN`, kredensial acak minimal 32 karakter yang tidak memberi akses dokumen atau akun. Respons probe hanya memuat waktu dan status pemeriksaan. Respons 503 membuat pekerjaan CI gagal bila terdapat kegagalan, keterlambatan, atau bukti yang belum tersedia.

Workflow `.github/workflows/operations-monitor.yml` berjalan setiap jam setelah tersedia pada cabang default. Environment GitHub `production-monitor` menyimpan secret `OPERATIONS_MONITOR_TOKEN` yang sama dengan environment production backend Vercel. Batasi environment pada cabang default. Jalankan workflow manual satu kali dan periksa hasil sebelum menyatakan jadwal aktif. Status CI adalah kanal notifikasi awal; kegagalan juga dilaporkan sebagai isu GitHub (lihat di bawah). Di aplikasi, Super Admin melihat tanda **Operasional: perlu perhatian** atau **Operasional: gagal** di header setiap halaman selama status keseluruhan tidak sehat (pada layar sempit hanya ikon peringatan); tanda itu menautkan ke halaman ini. Header memeriksa `GET /api/operations/status` paling sering sekali per lima menit dan hanya saat tab terlihat, dan langsung memakai status terbaru halaman ini saat halaman ini terbuka. Tidak ada webhook tambahan.

## Pemberitahuan kegagalan

Bila job utama workflow ini gagal atau terhenti karena batas waktu, job `notify-failure` membuka isu GitHub berjudul **Pemeriksaan operasional gagal**, atau menambah komentar pada isu terbuka berjudul sama yang dibuka oleh workflow itu sendiri; isu berjudul sama buatan orang lain tidak dipakai. GitHub mengirim email ke setiap orang yang memantau repositori (*Watch → All Activity*, atau *Custom → Issues*), jadi pengelola perlu mengaktifkan pantauan itu. Karena repositori bersifat publik, isi isu hanya satu kalimat tetap dan tautan ke run; nama pemeriksaan, angka, nama host, dan nama berkas tidak ditulis. Rinciannya tetap di halaman run dan di Monitoring Operasional.

Hanya job `notify-failure` yang memiliki izin `issues: write`; job itu tidak memakai environment produksi dan tidak menerima secret. Workflow monitor berjalan tiap jam, sehingga komentar baru paling sering ditambahkan enam jam sekali selama isu masih terbuka. Jeda itu dihitung dari laporan terakhir yang ditulis workflow, sehingga komentar orang lain tidak menundanya. Tutup isu setelah penyebabnya ditangani; kegagalan berikutnya membuka isu baru. Run yang dilewati (bukan cabang default, atau workflow dinonaktifkan) dan run yang berhasil tidak membuat isu. Pemberitahuan memerlukan fitur Issues aktif di repositori; bila job `notify-failure` sendiri gagal, kegagalan hanya terlihat di tab Actions.

## Bukti backup dan pemulihan

Panel membaca objek **privat** `operations/recovery-status-v1.json` pada penyimpanan Blob aplikasi. Pembacaan dibatasi 16 KiB dan lima detik, tanpa cache CDN. Setiap pembacaan dihitung sebagai satu *simple operation* Blob, jadi pembacaan yang berhasil dipakai ulang paling lama 10 menit oleh instans backend yang sama. Tidak ada URL penyimpanan, nama dokumen, data pengguna, atau kredensial dalam respons panel.

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

1. **Pemindai gagal/kedaluwarsa, atau berkas lama menunggu pemindaian:** tekan **Jalankan pemindai** pada kartu **Pemindai keamanan dokumen**, lalu periksa bukti mesin dan waktu kedaluwarsa setelah beberapa menit. Jangan mengganti status berkas secara manual.
2. **Antrean terlambat:** periksa worker, kegagalan penyimpanan, dan status retry. Kartu **Antrean pemindaian** memisahkan hitungan **Gagal** (`scan_error`) dari **Terdeteksi berbahaya** (`infected`).
   - **Gagal dipindai:** setelah penyebabnya diperiksa, Super Admin menekan **Antre ulang** pada berkas terkait atau **Antre ulang semua yang gagal dipindai** (paling banyak 100 berkas per tekan, berkas terlama lebih dulu). Berkas kembali ke antrean sebagai percobaan pertama dan tetap terkunci sampai pemindaian menyatakannya aman dan utuh. Setiap antre ulang tercatat di log audit atas nama Super Admin tersebut. Hitungan Gagal turun begitu berkas diantre ulang; bila pemindaian gagal lagi, berkas kembali muncul di daftar.
   - **Terdeteksi berbahaya:** tidak dapat diantre ulang dan tetap dikarantina. Kartu tetap berstatus perlu perhatian sampai berkas tersebut diganti atau ditangani.
3. **Integritas:** jalankan worker `file-fixity` dengan peran database worker, lalu periksa mismatch/error. Peran API tetap hanya membaca antrean. Jangan mengganti hash baseline untuk menyembunyikan mismatch.
4. **Backup/pemulihan:** jalankan pekerjaan terkait dengan target dan skema yang dipatok, terbitkan bukti baru hanya setelah pemeriksaan aktual selesai.
5. **CI tidak tersedia:** periksa secret dan keberadaan workflow pada cabang default. Isu **Pemeriksaan operasional gagal** hanya dibuat oleh run yang benar-benar berjalan dan gagal; jadwal yang tidak pernah dimulai tidak menghasilkan isu. Berkas workflow lokal bukan bukti jadwal telah berjalan.

Pekerjaan backup lama pada cabang utama dapat memiliki kontrak skema yang lebih tua daripada produksi. Gunakan verifier yang cocok dengan migrasi produksi; kegagalan kontrak harus diperbaiki secara eksplisit sebelum backup dijalankan ulang.
