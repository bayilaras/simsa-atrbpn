# Fondasi Integrasi SRIKANDI

Integrasi ini masih berupa fondasi teknis dan **tidak menyatakan SIMSA sudah terintegrasi secara resmi dengan SRIKANDI**. Dalam [Profil Aplikasi Internal SIMSA](PROFIL_APLIKASI_INTERNAL.md), integrasi SRIKANDI bersifat opsional/deferred dan bukan syarat operasi inti kecuali kebijakan internal mewajibkannya. Lalu lintas keluar dinonaktifkan secara default sampai kontrak API resmi, endpoint HTTPS, kredensial, dan aturan validasi respons telah disetujui serta dikonfigurasi lengkap.

## Arsitektur

Jika integrasi diwajibkan dan disetujui, alur produksi yang dimaksud adalah:

1. layanan bisnis memasukkan pesan ke `srikandi_outbox` melalui `SrikandiService.enqueue()` dalam alur yang terkontrol;
2. outbox menyimpan versi kontrak, hash pesan, idempotency key, unit kerja, payload, status, dan audit append-only;
3. worker persisten mengklaim pesan secara atomik, kemudian mengirimkannya melalui adaptor HTTP;
4. kegagalan sementara dijadwalkan ulang dengan exponential backoff;
5. kegagalan permanen atau percobaan yang habis masuk `dead_letter`;
6. status menjadi `succeeded` hanya setelah respons resmi memuat ACK yang cocok dan remote ID yang valid.

HTTP 2xx, koneksi yang berhasil, atau body yang selesai dibaca tidak pernah cukup untuk menyatakan sinkronisasi berhasil.

## Worker produksi

Jika connector diaktifkan, pemrosesan antrean produksi harus dijalankan sebagai proses persisten terpisah dari Vercel/serverless request:

```text
npm run build
npm run start:srikandi-worker
```

Untuk pengembangan lokal:

```text
npm run dev:srikandi-worker
```

Deploy worker pada runtime yang mendukung proses jangka panjang dan graceful shutdown. Beberapa instance boleh berjalan bersamaan karena claim dan lease dilakukan secara kondisional di database.

Endpoint admin `POST /api/integrations/srikandi/dispatch-due` hanya fallback diagnostik dan dibatasi satu item per request. Endpoint itu bukan pengganti worker produksi.

## Konfigurasi

Outbound HTTP baru aktif jika `SRIKANDI_ENABLED=true` dan seluruh konfigurasi berikut valid:

- `SRIKANDI_BASE_URL`: origin HTTPS resmi, tanpa path/query/credential;
- `SRIKANDI_SYNC_PATH`: path endpoint resmi pada origin yang sama;
- `SRIKANDI_API_TOKEN`: kredensial yang diberikan otoritas API;
- `SRIKANDI_CONTRACT_VERSION`: versi kontrak resmi yang disnapshot saat enqueue;
- `SRIKANDI_ACK_FIELD` dan `SRIKANDI_ACK_VALUE`: field/value pengakuan resmi;
- `SRIKANDI_REMOTE_ID_FIELD`: field ID resmi hasil sinkronisasi.

Kebijakan operasional opsional:

- `SRIKANDI_TIMEOUT_MS` (1.000–45.000 ms);
- `SRIKANDI_MAX_ATTEMPTS` (1–20);
- `SRIKANDI_BACKOFF_BASE_SECONDS` dan `SRIKANDI_BACKOFF_MAX_SECONDS`;
- `SRIKANDI_WORKER_POLL_MS`;
- `SRIKANDI_WORKER_BATCH_SIZE` (1–50).

Versi kontrak pada row outbox bersifat immutable evidence. Pergantian environment ke versi kontrak baru tidak mengubah header atau body pesan lama saat dikirim. Penggunaan ulang idempotency key dengan versi kontrak atau payload berbeda ditolak.

## Batas respons dan retry

Adaptor membaca body secara streaming dan menghentikan pembacaan ketika total byte melewati 1 MiB, termasuk ketika server tidak mengirim `Content-Length`. Timer dan `AbortController` tetap aktif sampai body selesai.

Kesalahan HTTP 408, 429, dan 5xx—termasuk kegagalan decode/parse body pada status tersebut—dapat dijadwalkan ulang. Kesalahan kontrak pada 2xx/4xx, ACK yang tidak cocok, atau remote ID kosong/lebih dari 255 karakter tidak pernah dianggap sukses.

Retry manual memerlukan alasan dan dicatat dalam audit outbox. Audit state transition ditulis dalam transaksi yang sama; kegagalan audit membatalkan perubahan status.

## Syarat kondisional sebelum aktivasi

Syarat berikut memblokir **aktivasi connector SRIKANDI**, bukan penggunaan profil internal inti. Sebelum connector diaktifkan, ATR/BPN/ANRI atau pengelola SRIKANDI perlu memberikan dan menyetujui:

- hostname, path, dan lingkungan production/sandbox resmi;
- metode autentikasi, rotasi secret, mTLS, allowlist jaringan, atau signature;
- skema payload setiap operasi dan metadata kearsipan wajib;
- definisi ACK, remote ID, error code, dan signature respons;
- jaminan serta scope idempotency pada server;
- rate limit, SLA, retry guidance, dan prosedur rekonsiliasi;
- aturan data pribadi/rahasia dan larangan field yang boleh dikirim.

Sampai syarat tersebut selesai, producer bisnis tidak boleh dihubungkan ke mutasi arsip/surat dan `SRIKANDI_ENABLED` harus tetap `false`. Kondisi nonaktif ini adalah konfigurasi aman yang sah untuk profil internal bila tidak ada mandat integrasi.
