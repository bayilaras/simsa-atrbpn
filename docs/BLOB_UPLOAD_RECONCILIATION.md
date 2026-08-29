# Rekonsiliasi unggahan private Blob

Unggahan multipart yang melewati backend dikompensasi langsung bila transaksi
database, audit, atau outbox gagal. Backend hanya menghapus URL yang baru saja
dihasilkan oleh `uploadFile()` pada request tersebut; locator lama dan URL dari
payload pengguna tidak pernah dijadikan target kompensasi.

Unggahan besar melalui `@vercel/blob/client` tidak berada dalam transaksi HTTP
yang menyimpan surat atau PDF regulasi. Migrasi
`0023_client_blob_upload_leases.sql` menambahkan lease durable untuk alur ini:

1. callback bertanda tangan dari Vercel mencatat URL, pemilik, tujuan, dan waktu
   kedaluwarsa;
2. transaksi surat atau rule-set mengubah `pending` menjadi `claimed` bersama
   commit referensi Blob;
3. reconciler hanya dapat mengambil lease `pending` yang telah kedaluwarsa;
4. status diubah atomik menjadi `cleanup_started` sebelum object dihapus, jadi
   commit bisnis tidak dapat berpacu dengan penghapusan.

## Konfigurasi wajib

- Terapkan migrasi `0023` sebelum menerima client upload.
- Sediakan `DATABASE_URL` dan `BLOB_READ_WRITE_TOKEN` dari environment yang sama.
- Di luar Vercel, dan selalu pada Vercel Preview yang memakai Deployment
  Protection, set
  `VERCEL_BLOB_CALLBACK_URL=https://<backend>` sebagai origin HTTPS tanpa
  trailing slash, path, query, fragment, atau kredensial. SDK Blob menambahkan
  path request `/api/client-upload` sendiri; origin tersebut harus dapat
  dijangkau layanan Vercel Blob. Callback tidak membawa session pengguna, tetapi
  diverifikasi kriptografis oleh SDK sebelum lease ditulis.
- Untuk Preview terlindungi, gunakan custom HTTPS origin khusus yang tidak
  terkena Deployment Protection; konfigurasi menolak origin `*.vercel.app`.
  Jangan menambahkan bypass secret sebagai query string callback karena URL
  masuk ke client token/browser. Uji unggah langsung sungguhan sampai callback
  menghasilkan lease `pending`, lalu klaim lease dalam transaksi surat/rule-set.
  Respons token saja belum membuktikan callback dapat dijangkau.
- `CLIENT_BLOB_UPLOAD_TTL_HOURS` default 24 jam dan dibatasi 1–168 jam.

## Jadwal operasi

Jalankan one-shot worker berikut melalui scheduler persisten sedikitnya setiap
jam (Kubernetes CronJob, systemd timer, atau scheduler container yang setara):

```text
npm run start:blob-reconciler
```

Atur `CLIENT_BLOB_RECONCILE_BATCH_SIZE` (default 100, maksimum efektif 200).
Exit code menjadi non-zero bila ada delete yang gagal agar monitoring dapat
memberi alarm dan menjalankan ulang. Endpoint admin
`POST /api/client-upload/reconcile` menyediakan operasi manual yang sama untuk
`super_admin`; endpoint itu tetap dilindungi session dan CSRF.

Tanpa scheduler, lease tetap mencegah salah-hapus dan dapat direkonsiliasi
manual, tetapi objek direct-upload yang tidak pernah diklaim tidak akan dibuang
tepat waktu. Karena itu scheduler merupakan dependency deployment, bukan proses
serverless Vercel.
