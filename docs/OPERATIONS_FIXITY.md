# Pemeriksaan integritas file terjadwal

`scripts/check-file-integrity.mjs` menjalankan **FileFixityService existing** sekali dalam batch terbatas. Service tersebut menemukan file yang memenuhi syarat, membuat jadwal jika belum ada, mengklaim pekerjaan dengan lease, membaca byte privat, membandingkan hash dan ukuran, serta menulis status, waktu pemeriksaan, hasil pekerjaan, dan audit melalui transaksi existing.

Runner tidak mengunggah atau mengubah isi file, tidak menulis ulang hash expected, dan tidak mengubah role atau akun pengguna. Mismatch tetap menjadi mismatch dan menghasilkan exit nonzero. Kegagalan unduh memakai kode error stabil, tanpa URL/token dalam laporan. Letter attachments yang dikecualikan oleh kebijakan service existing tetap dikecualikan; runner tidak memperluas eligibility lewat SQL baru.

Jalankan `node scripts/check-file-integrity.mjs run` pada Node 24 setelah memasang dependency lockfile backend. Environment privat yang diperlukan:

| Nama | Fungsi |
|---|---|
| `NEON_WORKER_DATABASE_URL` | Koneksi langsung role `simsa_worker`, TLS verify-full/channel binding |
| `NEON_WORKER_EXPECTED_HOST`, `NEON_WORKER_EXPECTED_DATABASE` | Pin target database yang harus cocok persis |
| `SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN` | Token alias Blob privat; setiap URL GET dipin ke hostname dalam token |
| `OPERATIONS_RECOVERY_EXPECTED_BLOB_HOSTNAME` | Opsional, pin hostname tambahan; bukan ID control-plane `store_<id>` |
| `OPERATIONS_FIXITY_REPORT` | Opsional, path baru untuk JSON tersanitasi; file existing tidak dioverwrite |

Konfigurasi memakai loader service existing. Default batch runner adalah 10; maksimum 20 pemeriksaan per proses, 64 MiB per objek, dan timeout paling lama 120 detik per objek. Interval existing adalah 604.800 detik (7 hari), retry 3.600 detik. Workflow memeriksa antrean setiap hari; hanya file baru atau yang telah jatuh tempo akan diinspeksi. Status sukses dengan nol pekerjaan berarti tidak ada pekerjaan yang berhasil diklaim, bukan bukti semua byte diperiksa ulang pada hari itu.

Sebelum mutasi operasional, runner memeriksa identitas, membership, search path, dan batas izin worker dalam transaksi read-only. Database pool selalu ditutup. Stream memakai deadline serta batas byte dari `inspectBitstream`; ciphertext/file plaintext tidak disimpan oleh job ini.

Workflow `.github/workflows/operations-fixity.yml` hanya berjalan dari default branch, memakai dedicated environment `production-integrity`, dan membutuhkan repository variable `OPERATIONS_FIXITY_ENABLED=true`. Environment harus membatasi deployment ke branch terlindungi. Credential baru dimuat pada langkah eksekusi setelah dependency dan tes. Tidak diperlukan env API, Google OAuth, atau password pengguna aplikasi.

Implementasi workflow dan pengaturan secret tidak membuktikan jadwal GitHub sudah aktif. Merge ke protected default branch dan run pertama harus dicatat terpisah. Eksekusi operator pertama boleh memakai batch 3 untuk tiga file yang ditemukan monitor; hasil aktual dan auditnya berada dalam bukti operasional, bukan dalam dokumen ini sebelum verifikasi.
