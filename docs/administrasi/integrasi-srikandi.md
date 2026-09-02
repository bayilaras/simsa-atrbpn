# ☁️ Integrasi SRIKANDI

Halaman **Integrasi SRIKANDI** adalah panel operasional outbox SIMSA. Halaman ini tidak mengaktifkan integrasi secara otomatis dan tidak menggantikan SRIKANDI.

> Outbound harus tetap nonaktif sampai endpoint, autentikasi, kontrak payload, field ACK, dan ID resmi telah disahkan serta diuji di sandbox bersama pengelola SRIKANDI.

## Status konfigurasi

Empat indikator ditampilkan tanpa membocorkan endpoint atau kredensial:

- **Outbound aktif** — feature flag integrasi diaktifkan.
- **Siap dikirim** — seluruh konfigurasi wajib lolos validasi.
- **Endpoint** — origin HTTPS dan path sudah dikonfigurasi.
- **Kontrak respons** — versi kontrak, ACK, dan field ID resmi sudah ditetapkan.

Status API juga membedakan kesiapan producer dan outbound. Producer surat hanya
boleh diaktifkan dengan `SRIKANDI_PRODUCER_ENABLED=true`, profil
`simsa-record-v1`, nama event surat masuk/keluar dari kontrak resmi, serta versi
kontrak yang sama. Pengiriman jaringan tetap memerlukan `SRIKANDI_ENABLED=true`.

## Status outbox

| Status | Arti |
|---|---|
| Menunggu | Pesan belum dicoba |
| Diproses | Pesan sedang memiliki lease aktif |
| Retry terjadwal | Kegagalan sementara; percobaan berikutnya sudah dijadwalkan |
| Tersinkron resmi | Respons memenuhi ACK dan memuat ID resmi |
| Dead letter | Percobaan habis atau respons tidak dapat diterima |

HTTP 2xx saja tidak pernah dianggap sebagai bukti sinkronisasi. Status berhasil hanya diberikan setelah ACK dan ID resmi sesuai kontrak tervalidasi.

## Operasi administrator

- Gunakan filter unit dan status untuk memeriksa queue.
- **Kirim** memproses satu pesan dengan idempotency key yang sama.
- **Proses 1 pesan** adalah fallback diagnostik yang hanya bekerja untuk satu unit konkret. Antrean produksi diproses oleh worker persisten, bukan request serverless.
- **Retry** pada dead letter wajib menyertakan alasan minimal 10 karakter.
- Periksa jumlah percobaan, jadwal berikutnya, remote ID, dan error tanpa menyalin token ke log.

Setiap enqueue, claim, keberhasilan, retry, dead-letter, dan manual retry dicatat pada audit append-only dalam transaksi yang sama dengan perubahan status.

## Sebelum mengaktifkan outbound

1. Dapatkan kontrak dan sandbox resmi.
2. Verifikasi mTLS/autentikasi, rate limit, signature, idempotency server, SLA, dan perubahan skema.
3. Tetapkan pemetaan metadata dan sumber kebenaran antara SIMSA dan SRIKANDI.
4. Verifikasi producer surat masuk/keluar menulis outbox dalam transaksi yang sama dengan mutasi dan auditnya.
5. Jalankan uji timeout, retry, duplicate delivery, respons tidak valid, dead-letter, dan rekonsiliasi.
6. Simpan berita acara serta persetujuan Unit Kearsipan/pengelola SRIKANDI.

Selama sandbox dan kontrak resmi belum diterima, producer tidak memiliki efek keluar karena outbound tetap nonaktif. Outbox adalah **fondasi teknis**, bukan klaim integrasi produksi.
