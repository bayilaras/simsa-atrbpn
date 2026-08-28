# Operasi Antivirus Bitstream SIMSA

SIMSA memakai protokol resmi ClamAV `clamd` TCP `INSTREAM`. Berkas tetap berada
dalam karantina sampai `clamd` mengembalikan respons persis `stream: OK` dan
SHA-256 serta ukuran hasil baca ulang cocok dengan baseline ingest. Respons
ambigu, timeout, object storage gagal, hash berubah, atau scanner nonaktif tidak
pernah diubah menjadi hasil bersih.

Referensi protokol primer:

- <https://docs.clamav.net/manual/Usage/ClamdProtocol.html>
- <https://docs.clamav.net/manual/Usage/Scanning.html>

`clamd` TCP tidak menyediakan autentikasi atau enkripsi. Jangan membuka port
3310 ke internet. Tempatkan API/worker dan `clamd` pada host yang sama atau
jaringan privat yang dibatasi firewall/security group. Perbarui basis tanda
tangan memakai `freshclam` dan pantau kegagalannya.

## Menjalankan secara lokal

Salah satu cara menjalankan image resmi ClamAV hanya pada loopback:

```sh
docker run --rm --name simsa-clamav -p 127.0.0.1:3310:3310 clamav/clamav:stable
```

Atur environment backend (nilai token harus berasal dari secret manager atau
environment lokal yang tidak dilacak Git):

```dotenv
MALWARE_SCANNER_MODE=clamav
MALWARE_SCAN_WORKER_ENABLED=true
MALWARE_SCAN_WORKER_RUNTIME=embedded
BLOB_READ_WRITE_TOKEN=...
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
CLAMAV_TRUSTED_NETWORK=true
CLAMAV_MAX_STREAM_BYTES=52428800
MALWARE_SCAN_DOWNLOAD_TIMEOUT_MS=30000
```

Nilai `StreamMaxLength` pada `clamd.conf` harus sekurang-kurangnya sama dengan
`CLAMAV_MAX_STREAM_BYTES`. Jalankan backend persisten seperti biasa:

```sh
npm run build
npm start
```

## Produksi persisten dan Vercel

Pada container/VM Node yang persisten, mode `embedded` menjalankan worker di
proses API. Klaim database atomik memungkinkan beberapa replika API berjalan
tanpa memindai job yang sama secara bersamaan.

Vercel Serverless tidak boleh memakai mode `embedded`, karena timer proses dapat
dibekukan setelah request. Konfigurasi API Vercel harus memakai:

```dotenv
MALWARE_SCAN_WORKER_RUNTIME=external
```

Kemudian jalankan image/build backend yang sama pada container/VM persisten di
jaringan privat ClamAV dengan environment `external` dan perintah:

```sh
npm run build
npm run start:malware-worker
```

Repositori juga menyediakan definisi deployment siap-validasi di
`deploy/workers/compose.yml`. Salin `deploy/workers/.env.example` menjadi `.env`,
isi secret yang benar, lalu jalankan dari direktori tersebut:

```sh
docker compose --env-file .env -f compose.yml up -d --build clamav malware-worker
```

Definisi itu menempatkan port ClamAV hanya pada jaringan internal Compose,
menunggu health check `clamd`, dan menjalankan worker dari commit backend yang
sama dengan API.

Cold-start produksi akan gagal bila Vercel dikonfigurasi `embedded`, scanner
dinonaktifkan, worker dinonaktifkan, token Blob hilang, atau pengakuan jaringan
tepercaya belum diberikan. Worker terpisah juga menolak dijalankan di Vercel.

## Status dan pemulihan

- `not_scanned`: antrean ingest, tidak dapat diunduh.
- `scanning:<attempt>:<epoch>`: klaim aktif bertimestamp, tidak dapat diunduh.
- `retry:<attempt>:<epoch>`: kegagalan sementara dengan exponential backoff.
- `clean`: hanya ditulis setelah verdict ClamAV bersih dan fixity terverifikasi.
- `infected`: malware terdeteksi; objek tetap dikarantina dan tidak dihapus otomatis.
- `scan_error`: percobaan habis atau kegagalan non-retryable; perlu investigasi operator.

Jika proses mati setelah klaim, worker lain mengambil ulang status `scanning`
setelah `MALWARE_SCAN_STALE_AFTER_MS`. Hasil dari worker lama ditolak dengan
conditional update. Setiap transisi yang diterima ditulis atomik ke `audit_log`
tanpa menyimpan locator object storage di bukti audit.

Sebelum rilis, uji setidaknya: `PING` ke scanner, sampel bersih, sampel uji EICAR
yang disediakan resmi oleh organisasi antivirus, scanner mati/timeout, objek
lebih besar dari batas, serta perubahan byte setelah baseline. Jangan menandai
status database secara manual sebagai `clean`.
