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

Tidak ada pengiriman alarm ke pihak luar atau penjadwalan baru yang diaktifkan
oleh perubahan ini. Batas waktu respons, jumlah pengguna bersamaan, toleransi
kehilangan data, serta waktu pemulihan organisasi perlu ditetapkan bersama
pengelola berdasarkan pengukuran lingkungan tujuan.

Acuan: [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
dan [PostgreSQL 18 Backup and Restore](https://www.postgresql.org/docs/18/backup.html).
