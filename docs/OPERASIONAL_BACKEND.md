# Pemeriksaan backend SIMSA

## Menelusuri permintaan

Server memberi setiap permintaan nomor `X-Request-ID` yang dibuat server.
Nomor ini tersedia pada header respons, log terstruktur, dan respons dari handler
error global. Nomor dari klien tidak digunakan sebagai identitas permintaan.
Ketika melaporkan gangguan, sertakan nomor tersebut, waktu kejadian, dan tindakan
yang dicoba. Jangan menyertakan cookie, token, kata sandi, atau isi arsip.

Log penyelesaian API berisi `event`, `requestId`, kelompok API, metode, status,
`durationMs`, dan `aborted`. Log ini tidak memuat URL rekod, parameter pencarian,
body, atau header autentikasi. Log Pino dalam permintaan mendapatkan konteks
`requestId` secara otomatis. Pembungkus Better Auth dan handler error global tidak mencetak
pesan exception mentah. Pelindungan field kredensial berlaku juga pada mode
pengembangan. Ini tidak menggantikan audit akses arsip yang sudah ada di database.

Untuk error terstruktur (`err`/`error`), logger hanya menyimpan jenis error dan
kode operasional yang dikenali. Pesan exception, stack, cause, serta payload
provider tidak disalin. Pemanggilan Pino tanpa teks juga memakai pesan tetap agar
pesan exception tidak otomatis masuk ke `msg`. Teks log langsung dan keluaran
`console` lama tetap perlu menggunakan pesan aman di lokasi pemanggilannya;
pelindung ini bukan penyaring semua data sensitif secara umum.

Pada paket Windows, log proses berada di
`output/local-runtime/internal-app.stdout.log` dan `internal-app.stderr.log`.
Folder tersebut diabaikan Git dan tetap perlu dibatasi aksesnya oleh pengelola.

## Membaca metrik

Setelah login sebagai **Super Admin**, buka `/api/operations/metrics` pada alamat
aplikasi yang sama. Endpoint menggunakan autentikasi dan pemeriksaan role server;
hasil tidak boleh di-cache. Staf, auditor, serta administrator unit tidak dapat
membacanya.

| Field | Arti |
| --- | --- |
| `scope`, `startedAt` | Penghitungan hanya pada proses API saat ini, sejak proses dimulai |
| `activeRequests` | Permintaan yang belum selesai; termasuk pembacaan metrik yang sedang dilakukan |
| `requests[].count` | Jumlah permintaan selesai atau terputus untuk kelompok API dan metode |
| `statusClasses` | Respons selesai dalam kelompok 1xx sampai 5xx |
| `aborted` | Koneksi terputus sebelum respons selesai; dihitung terpisah dari status sukses |
| `latencyMs` | Histogram kumulatif waktu respons; `upperBound: null` adalah batas tak terhingga |
| `memoryBytes` | Memori proses dan heap saat pembacaan |
| `databasePool` | Jumlah koneksi pool, koneksi menganggur, dan permintaan menunggu koneksi |

Kelompok API dan metode dibatasi untuk mencegah pertumbuhan memori oleh URL atau
ID yang berbeda-beda. Metrik tidak mengandung identitas pengguna atau isi rekod.
Penghitungan kembali dari awal saat proses diulang. Pada beberapa instance,
gabungkan log/metrik dari setiap instance melalui sistem pemantauan yang dikelola
instansi; endpoint ini tidak mengklaim memberikan riwayat atau agregat lintas
instance.

## Menangani gangguan

1. **Respons 400/413:** periksa format dan ukuran input. JSON rusak menghasilkan
   400; batas parser menghasilkan 413. Keduanya tidak dianggap kegagalan server.
2. **Banyak 5xx atau koneksi terputus:** cocokkan `X-Request-ID` dengan log, lalu
   periksa `/ready` dan `Cek-SIMSA.cmd`. Jangan mengulang operasi tulis tanpa
   memeriksa hasil atau status pekerjaan sebelumnya.
3. **Permintaan lambat:** periksa histogram dan `databasePool.waiting`, lalu
   cocokkan dengan kesehatan database, worker, serta penyimpanan. `/health`
   menunjukkan proses HTTP hidup; `/ready` memeriksa ketergantungan dan dapat
   menunjukkan layanan berkas belum tersedia.
4. **Pemulihan data:** gunakan prosedur backup dan verifikasi terpisah. Jangan
   melakukan reset atau menjalankan bootstrap untuk menangani masalah runtime.

## Unggahan terputus dan pemrosesan OCR

Batch unggahan dicatat di database sebelum penyimpanan objek dimulai. Setiap
batch memiliki nama objek yang ditentukan server dan tidak boleh menimpa objek
yang sudah ada. Jika provider menerima berkas tetapi respons hilang, intent
batch tetap tersedia untuk rekonsiliasi. Cleanup batch kedaluwarsa membaca
maksimal 50 nama objek yang sudah dicadangkan, memeriksa referensi arsip, lalu
menghapus generation yang tepat. Proses ini mengikuti worker pembersihan dan
retensi yang dikonfigurasi; kegagalan tidak dianggap sudah bersih.

Pada bulk OCR, parent memeriksa berkas dan memegang lease kapasitas global di
database. Ekstraksi PDF/render/Tesseract dijalankan di child
`dist/workers/ocr-process.js`, tanpa kredensial database, autentikasi, atau object
storage. PDF dikirim lewat stdin, tidak ditulis ke direktori kerja. Child memakai
direktori sementara sendiri untuk cache model. Parent yang masih hidup
membersihkannya setelah child tertutup; jika parent mati mendadak, cache model
dapat tertinggal di direktori sementara OS, tanpa PDF sumber.
`OCR_TESSDATA_PATH` tetap menunjuk model bahasa yang disiapkan pengelola;
path relatif dinormalisasi sebelum direktori kerja berubah.

Batas pengawas child OCR adalah 200 detik sejak parent memulai proses; batas
luar parent adalah 225 detik sejak child dimulai. Input dibatasi 50 MiB dan heap V8
512 MiB. Batas heap
bukan batas seluruh memori native; gunakan pembatasan memori/CPU pada deployment.
Batas halaman/piksel/teks yang sudah ada tetap berlaku. Timeout atau kehilangan
lease menghentikan child dan menunggu `close` sebelum slot kapasitas dilepas.
Hasil dari klaim lama tidak boleh menimpa hasil klaim baru.

Pengawas berjalan pada thread tersendiri sebelum mesin OCR dimuat. Ia tetap
dapat menghentikan child saat thread OCR sibuk dan parent mati. Pengawas memeriksa
kehidupan parent serta deadline monotonic yang tidak diperpanjang. Penggunaan
ulang PID dapat menunda deteksi parent yang mati, tetapi deadline tetap membatasi
proses agar tidak melewati anggaran lease minimum setelah download.

Kontrak saat ini tetap `POST /api/bulk-upload/:batchId/process` untuk memproses
satu item dan mengembalikan HTTP 200 beserta status aktual. `GET` hanya membaca
status. Pemisahan child menjaga CPU utama tetap tersedia, tetapi permintaan
POST masih menunggu hasil; ini belum antrean daemon yang mengembalikan 202.
Pastikan batas request/proxy lingkungan file cukup untuk pekerjaan tersebut.
Untuk penyebaran yang membutuhkan pekerjaan terus berjalan setelah request
berakhir, diperlukan worker OCR persisten dan kontrak enqueue/polling tersendiri.

Isolasi environment child bukan sandbox sistem operasi. Jalankan layanan dengan
akun dan izin filesystem minimum pada lingkungan tujuan. Konfigurasi lokal
saat ini tetap menonaktifkan unggahan/OCR karena storage dan antivirus belum
disiapkan.

## Backup aktual

Ikuti [backup database lokal dan verifikasi pemulihan](BACKUP_LOKAL.md) untuk
mencadangkan database aktif tanpa mengubah sumber serta memulihkan artefak pada
cluster baru. `Cek-SIMSA.cmd` menampilkan ringkasan backup dan verifikasi untuk
bundle yang sama. Perintah npm `backup:local-current`, `restore:local-current`,
dan `test:local-current-backup` menyediakan entrypoint prosedur tersebut; lihat
panduan untuk argumen Python, bundle, dan kunci yang diperlukan.

Tidak ada pengiriman alarm ke pihak luar atau penjadwalan baru yang diaktifkan
oleh perubahan ini. Batas waktu respons, jumlah pengguna bersamaan, toleransi
kehilangan data, serta waktu pemulihan organisasi perlu ditetapkan bersama
pengelola berdasarkan pengukuran lingkungan tujuan.

Acuan: [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
dan [PostgreSQL 18 Backup and Restore](https://www.postgresql.org/docs/18/backup.html).
