# Operasi Antivirus Bitstream SIMSA

SIMSA mendukung worker ClamAV TCP untuk instalasi persisten dan adaptor native
sesuai permintaan untuk Vercel. Konfigurasi, isolasi akun dan recovery Vercel ada
di [panduan Vercel dan Neon](DEPLOY_VERCEL_NEON.md#antivirus-native-sesuai-permintaan).
Adaptor native memakai executable resmi, definisi bertanda tangan yang diperbarui
setelah 24 jam, deadline serta batas memori; Preview aplikasi tidak menjalankannya.
Aktivasi Production memerlukan hasil uji cloud lengkap, bukan hanya unit test.

Bukti verifikasi pemindai on-demand berlaku 24 jam sejak definisi terakhir diperbarui. Pemindai yang dibangunkan memperbarui definisi lewat Freshclam begitu masa berlakunya tersisa kurang dari 13 jam (`MALWARE_DEFINITION_REFRESH_BEFORE_MS`); bila pembaruan lebih awal itu gagal, definisi yang masih sah tetap dipakai dan mirror resmi baru dicoba lagi satu jam kemudian. Definisi yang sudah kedaluwarsa tidak pernah dipakai. Pemicunya dua: **Vercel Cron** (`backend/vercel.json`, enam entri harian pukul 03:07, 07:07, 11:07, 15:07, 19:07, dan 23:07 UTC; paket Hobby mengizinkan tiap entri sekali sehari dengan presisi ±59 menit) memanggil `GET /api/operations/scanner-wake` dengan `Authorization: Bearer $CRON_SECRET`, dan workflow **SIMSA Operations Monitor** memanggil `POST /api/operations/scanner-wake` dengan `OPERATIONS_MONITOR_TOKEN` sebelum probe. Jadwal GitHub bersifat *best-effort* dan dapat tertunda berjam-jam, sehingga Vercel Cron menjadi pemicu utama. Backend hanya membangunkan pemindai bila verifikasi hilang atau tersisa kurang dari 13 jam. `CRON_SECRET` (acak, minimal 32 karakter) wajib diisi di environment Production `simsa-backend`; tanpa itu cron ditolak 401. Endpoint ini hanya mempercepat; ia tidak mengubah status antrean atau karantina.

Definisi yang sudah diperbarui hanya ada di `/tmp` instance yang memperbaruinya. Instance dingin mulai dari definisi bawaan build (`native-clamav-assets/manifest.json`, `verifiedAt` = waktu build), sehingga pada deployment yang berumur lebih dari 24 jam setiap pemindaian dingin harus mengunduh definisi dari `database.clamav.net`. Karena itu `/ready` membedakan:

| `malwareWorker.state` | `reason` | `/ready` | Arti |
|---|---|---|---|
| `ready` | — | 200 `ready` | Run terakhir membuktikan definisi masih dalam lease 24 jam |
| `standby` | `definitions_lease_expired` | 200 `degraded` | Run terakhir sukses, lease habis paling lama 8 jam lalu; pemindaian/cron berikutnya memperbarui definisi |
| `standby` | `awaiting_first_run_on_deployment` | 200 `degraded` | Heartbeat terbaru (paling lama 8 jam lalu, sukses atau gagal) dicatat deployment lain, mis. sebelum promosi; deployment ini belum menjalankan pemindai |
| `not_ready` | `on_demand_refresh_failed` | 503 | Run terakhir deployment ini gagal, termasuk gagal sebelum mengunci antrean (koneksi, peran DB, kunci) atau saat inisialisasi pemindai; atau heartbeat gagal deployment lain lebih dari 8 jam tanpa run deployment ini |
| `not_ready` | `on_demand_verification_missing_or_expired` | 503 | Tidak ada heartbeat sama sekali, bukti tidak sah, lease habis lebih dari 8 jam, atau heartbeat sukses deployment lain sudah kedaluwarsa lebih dari 8 jam |

Batas 8 jam = dua jadwal Vercel Cron (tiap 4 jam, ±59 menit). Kegagalan sebelum worker berjalan tidak dapat dicatat sebagai heartbeat: validasi environment atau impor modul gagal (sengaja tanpa memuat modul database), deadline invocation terlalu pendek, atau dispatch dari API ditolak (`MALWARE_SCAN_DISPATCH_TOKEN`, `VERCEL_URL`, proteksi deployment; peran API tidak boleh menulis heartbeat). Untuk kasus itu `scanner-wake` menjawab `unavailable` atau wake gagal di log, monitor gagal karena cek `scanner` tetap `attention`, dan `/ready` menjadi 503 paling lambat 8 jam setelah heartbeat terakhir.

Heartbeat pemindai menyimpan `deploymentId` (`VERCEL_DEPLOYMENT_ID`). Cek `scanner` di Operations Monitor dan panel Super Admin bernilai `attention` saat `standby`; monitor tetap membangunkan pemindai lebih dulu dan gagal bila wake tidak memulihkannya. Berkas baru tetap dikarantina sampai pemindaian membuktikannya bersih, apa pun status `/ready`.

Bagian TCP berikut memakai protokol resmi ClamAV `clamd` `INSTREAM`. Berkas tetap berada
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
docker run --rm --name simsa-clamav \
  -e CLAMD_CONF_StreamMaxLength=52428800 \
  -p 127.0.0.1:3310:3310 \
  clamav/clamav:1.5-debian13-slim@sha256:967334b92d1782e4d1314ddf903ae537d26792d21c9a39adecb8ac9757980514
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

Repositori tidak menyediakan paket deployment worker persisten (Compose atau
image). Instalasi persisten menyediakan proses dan jaringan privatnya sendiri:
jangan membuka port ClamAV ke host publik, samakan `StreamMaxLength` dengan
batas aplikasi, dan patok image ClamAV dengan digest seperti contoh di atas;
perubahan digest wajib disertai uji ulang.

Untuk produksi dengan ClamAV aktif, worker wajib diaktifkan dan API pada Vercel
atau Cloud Run memakai runtime `external`. Token Blob diperlukan bagi provider
Blob; GCS memakai konfigurasinya sendiri. Host scanner eksplisit dan pengakuan
jaringan tepercaya wajib pada proses yang benar-benar membuka koneksi ClamAV.
Worker terpisah juga menolak dijalankan sebagai fungsi Vercel.

Profil `internal` mengizinkan scanner dan worker sama-sama nonaktif dalam mode
karantina tertutup. Pengecualian ini memungkinkan pengelolaan metadata sebelum
fasilitas berkas tersedia; berkas tidak dianggap bersih dan tidak dilepas oleh
gateway. Profil terintegrasi tetap memerlukan scanner sesuai validasi runtime.

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

Promosi objek GCS dari karantina ke bucket akhir dijalankan melalui child process
`dist/workers/gcs-promotion.js`. Batas `MALWARE_SCAN_PROMOTION_TIMEOUT_MS` adalah
45.000 ms secara default. Saat batas tercapai, parent menghentikan child dan
menunggu proses tertutup sebelum melanjutkan. Environment child memuat kebutuhan
GCS/ADC saja, tanpa kredensial database atau autentikasi aplikasi.

Penghentian proses tidak membatalkan salinan yang mungkin sudah diterima GCS.
Hasil yang belum pasti mempertahankan klaim `scanning`; pengambilan ulang klaim
stale mengulangi tujuan deterministik dan memeriksa generation yang ada sebelum
mencatat hasil. Jangan mengubahnya menjadi `clean` atau menghapus objek secara
manual. Default `MALWARE_SCAN_STALE_AFTER_MS` menjadi 300.000 ms; nilainya harus
melampaui gabungan batas download, koneksi ClamAV, scan, dan promosi GCS.

Job CI `ClamAV Clean, EICAR & Restart Smoke` memakai implementasi `INSTREAM`
aplikasi terhadap image ClamAV Linux yang dipatok digest, memverifikasi sampel
bersih dan EICAR, me-restart container, lalu mengulangi kedua scan. Sebelum
rilis, tetap uji setidaknya: `PING` ke scanner, sampel bersih, sampel uji EICAR
yang disediakan resmi oleh organisasi antivirus, scanner mati/timeout, objek
lebih besar dari batas, serta perubahan byte setelah baseline. Jangan menandai
status database secara manual sebagai `clean`.

## Lampiran surat lama tanpa pemindaian

Semua lampiran, termasuk PDF surat masuk/keluar di Vercel Blob privat, hanya
dapat dibuka setelah pemindai menyatakan `clean` dan hash cocok. Lampiran surat
yang tersimpan sebelum aturan ini berstatus `not_required` tanpa hash; lampiran
tersebut ditahan (423, status `pending`) dan dihitung pada antrean pemindaian
di Monitoring Operasional sampai diproses.

Setelah backend baru aktif, jalankan dari direktori `backend` dengan
`DATABASE_URL` dan `BLOB_READ_WRITE_TOKEN` produksi:

1. `npm run files:letter-scan-backfill:plan` — hanya membaca, menghitung hash
   setiap berkas lama, dan melaporkan jumlahnya tanpa mengubah data.
2. `npm run files:letter-scan-backfill:apply` — mencatat hash dan ukuran dari
   objek tersimpan, mengubah status menjadi `not_scanned`, dan menulis audit
   `system:letter-attachment-scan-backfill`. Worker antivirus kemudian memindai
   seperti unggahan baru.
3. Skrip tidak membangunkan pemindai. Klik **Lanjutkan pemeriksaan** pada salah
   satu lampiran yang menunggu. Setiap pemanggilan worker memindai satu berkas,
   tetapi satu pemicu terus membangunkannya sampai antrean kosong, maksimal 25
   berkas dan selama sisa batas waktu permintaan. Ulangi klik bila Monitoring
   Operasional masih menunjukkan antrean.

Berkas yang tidak dapat dibaca, melebihi 64 MiB, atau ukurannya berbeda dari
catatan tetap `not_required` dan tertahan; skrip keluar dengan kode 2 dan
mencatat ID lampiran untuk ditinjau. Skrip aman diulang karena hanya memproses
baris yang masih `not_required`.
