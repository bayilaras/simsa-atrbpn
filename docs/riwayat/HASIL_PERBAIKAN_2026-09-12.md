# Hasil perbaikan proyek SIMSA — 12 September 2026

Perbaikan ini menindaklanjuti kajian menyeluruh repositori. Tanda tangan elektronik tersertifikasi dikecualikan sesuai instruksi pengguna. Perbaikan source masih berada di working tree dan aplikasi Vercel belum dideploy ulang. Atas instruksi lanjutan pengguna, migrasi `0039` sudah diterapkan ke Neon produksi: journal 40, izin dan readiness lulus. Lihat [hasil migrasi langsung](MIGRASI_0039_2026-09-12.md). SIMSA digunakan mandiri; integrasi SRIKANDI bukan prasyarat.

## Perubahan fungsional dan keamanan

| Area | Perbaikan |
| --- | --- |
| Permohonan akses | Pagination mandiri untuk daftar milik sendiri, pending, dan approved. Entri setelah 100 dapat dijangkau. Halaman terakhir dikoreksi setelah keputusan mengurangi jumlah data. |
| Outbox SRIKANDI | Pagination server, pergantian unit/status kembali ke halaman pertama, respons dari filter lama ditolak. |
| Notifikasi | Respons fetch dan hasil penandaan baca dari unit/sesi lama tidak mengganti notifikasi scope baru. Menonaktifkan preferensi langsung menyembunyikan data terkait. |
| CSRF | Token cookie Better Auth harus 64 karakter hexadecimal lowercase; cookie rusak diperbarui. Browser menangani kegagalan decode cookie dan meminta token baru tanpa melempar URIError; format token sesi Firebase tetap terpisah. Perbandingan backend dilakukan setelah format dan panjang byte valid, sehingga input multibyte tidak menyebabkan exception. Cookie deployment selalu secure. |
| Pembatasan permintaan | Store PostgreSQL dipakai pada production, Vercel, dan Cloud Run. Counter atomik dibagi antar-instance, bertahan setelah pergantian instance, dan hanya menyimpan HMAC kunci pengguna/IP. Kegagalan store menolak permintaan dengan 503. |
| Login | Limiter Express dan konsumsi atomik Better Auth memakai store bersama. Login yang selesai dengan respons 2xx/3xx mengembalikan kuota percobaan gagal hanya pada periode asalnya; pekerjaan refund didaftarkan pada Vercel sebelum respons. Header IP internal ditimpa dari hasil resolusi proxy Express; input header palsu tidak menjadi sumber identitas langsung. IPv6 memakai subnet /56. Konfigurasi deployment tidak mendapat kelonggaran development. |
| Impor | Google Sheets memakai satu deadline jaringan 15 detik per operasi, batas CSV 5 MiB, HTML 1 MiB, total pengambilan 6 MiB, tiga redirect HTTPS ke host yang diizinkan, 1.000 baris data, 64 kolom, field 16 KiB, dan preview maksimal 100 baris. Kuota impor per pengguna berlaku untuk jalur Sheets dan CSV. |
| Pembatalan impor | Disconnect membatalkan pengambilan dan menghentikan proses sebelum baris berikutnya. Transaksi baris yang sudah berjalan tidak dipaksa batal; baris yang sudah berhasil tetap tercatat beserta auditnya. |
| Error API | Route impor, upload, arsip elektronik, peminjaman, lokasi, penyusutan, pengguna, distribusi, dan legacy auth meneruskan kegagalan ke boundary tersanitasi. Error domain mempunyai status eksplisit; isi exception umum tidak dipakai untuk menebak status. Respons memiliki kode stabil dan request ID jika tersedia. |
| Header frontend | CSP, nosniff, anti-framing, referrer policy, COOP yang mendukung popup, permissions policy, dan HSTS. Kebijakan API/PDF tetap berasal dari backend. SPA dan halaman maintenance, termasuk subpath health/ready, memperoleh header frontend. |
| Migrasi dan backup | Jumlah, timestamp, dan hash migrasi berasal dari journal checkout. Tidak ada gate final yang mengandalkan angka 34. Hash berurutan, allowlist hash historis, pengikatan commit/artefak, dan pemisahan grant tetap diperiksa. |
| Pengujian dan lint | Fixture capability demo, mode antivirus on-demand, mock limiter, bridge upload preservasi, dan pesan 503 disesuaikan dengan kontrak aktual. Hook bootstrap PGlite untuk tes fixity mendapat 30 detik; deadline inspeksi satu detik dan assertion pembatalannya tetap. Lint mengecualikan bundel `dist-*` agar memeriksa source, bukan salinan vendor hasil build. |

Helper baru memisahkan pengambilan Google Sheets, respons error publik, counter PostgreSQL, resolusi IP Better Auth, dan pagination UI. Tidak dilakukan pemecahan massal service domain yang berisiko mengubah transaksi/lock tanpa kebutuhan fungsional.

## Migrasi dan urutan penerapan

Migration baru `backend/src/db/migrations/0039_shared_rate_limits.sql` menambahkan tabel counter dan indeks kedaluwarsa. Journal sekarang mempunyai **40 entri**, terakhir timestamp `1788064200000`. Migrasi terdahulu tidak diubah.

Jalur GCP menyediakan profil `pre_upgrade_0038` untuk sumber yang tepat mempunyai 39 migrasi sampai `0038_arsip_direct_upload`, selain `pre_migration` historis dan `post_migration` penuh. Profil ini mempertahankan pemeriksaan ACL matang dan memakai manifest baseline yang tepat saat restore. Profil pra-upgrade ditolak setelah database mencapai 40 migrasi. Wrapper grant database aktif tetap mensyaratkan seluruh checkout. Penambahan migrasi berikutnya harus meninjau baseline upgrade yang diizinkan secara eksplisit.

1. Verifikasi backup sumber dan kemampuan restore pada lingkungan yang cocok sebelum mengubah database operasional.
2. Jalankan bootstrap role awal, migrator canonical, bootstrap final, dan grant convergence sesuai panduan deployment. Tabel baru memberikan DML kepada `simsa_api_runtime` dan pembacaan kepada `simsa_backup_reader`.
3. Pastikan readiness dan bukti journal/grant cocok dengan checkout 40 migrasi. Terapkan database sebelum kode API yang memakai store baru agar permintaan tidak gagal 503 karena tabel belum ada.
4. Terapkan API dan frontend melalui jalur rilis proyek, lalu uji login, session refresh, pagination, upload/PDF, dan header pada origin deployment sesungguhnya.

`RATE_LIMIT_KEY_SECRET` opsional, minimal 32 karakter dan harus sama di semua instance API. Jika tidak diisi, digunakan secret sesi dari provider autentikasi aktif. Jangan membuat secret baru saat startup; rotasi secret mengganti kunci counter dan mereset kuota klien. Preview memakai `PREVIEW_RATE_LIMIT_KEY_SECRET` atau secret autentikasi Preview yang terisolasi, serta menghapus key production yang diwarisi.

Resolusi IP mengikuti kontrak proxy Express proyek saat ini (`trust proxy = 1`). Konfigurasi topology/rewrite di layanan nyata tetap harus cocok dengan batas kepercayaan tersebut. Tes lokal membuktikan parsing chain/header, bukan topology cloud.

## Verifikasi

Seluruh pemeriksaan menggunakan Node.js 24.21.0. PostgreSQL 18 sementara memakai direktori, port, dan database terpisah dari database operasional. Suite kode di bawah dijalankan sebelum migrasi produksi; tidak melakukan deployment atau seed. Penerapan dan verifikasi Neon berikutnya dicatat dalam laporan migrasi terpisah.

| Pemeriksaan | Hasil |
| --- | --- |
| Frontend Vitest penuh | 68 file, 432 tes lulus |
| Regresi API frontend terakhir | 5 file, 31 tes lulus setelah perbaikan cookie CSRF; 13 kasus khusus cookie/refresh/Firebase, lint tiga file lulus |
| Frontend lint standar | Lulus; bundel `dist-*` dikecualikan |
| Frontend typecheck | Lulus dengan compiler TypeScript backend yang terpasang; konfigurasi existing tidak memeriksa seluruh tipe JavaScript secara ketat |
| Backend typecheck | Lulus setelah perbaikan proxy, secret, isolasi Preview, dan refund autentikasi terakhir |
| Backend domain peminjaman/lokasi/penyusutan | 6 file, 145 tes lulus |
| Backend regresi error workflow | 15 tes lulus |
| Backend impor dan arsip elektronik | 7 file, 108 tes lulus |
| Backend pengguna dan distribusi | 5 file, 135 tes lulus |
| Legacy auth | 6 tes lulus |
| Limiter PostgreSQL native | 6 tes lulus: 80 counter konkuren, kuota HTTP dua instance, konsumsi Better Auth atomik, refund login berhasil, presisi microsecond dan penolakan refund periode lama, serta kegagalan store |
| Regresi refund autentikasi | 14 tes lulus, termasuk lifecycle Vercel, respons terputus, metadata periode yang tidak berubah, dan error background tersanitasi |
| Gate migrasi PostgreSQL native | 19 pemeriksaan lulus, kemudian diulang reviewer independen: sumber 39 ke 40, grant, collector, dan penolakan hash/rantai/profil yang salah |
| Validator GCP | Empat validator dan regresi manifest lulus |
| Regresi final migrasi/backup | 45 tes Node/PGlite lulus setelah penambahan profil sumber 39 migrasi dan collector hash berurutan |
| Spark | Typecheck, build emulator, 39 tes skrip Node dan 45 tes aplikasi lulus; source/lockfile tidak diubah |
| Spark rules dan repository pada emulator | 2 file, 105 tes lulus, exit code 0; Java 21 portabel, Firebase Auth/Firestore project demo, hanya localhost, seluruh port ditutup setelah pengujian |
| Spark backup–restore emulator | Lulus, exit code 0; 281 dokumen dan metadata 55 akun dipulihkan melalui proses independen dengan digest data identik. Seluruh akun hasil restore tetap disabled, tiga korupsi ditolak sebelum akses jaringan, dan target tidak kosong menolak restore ulang tanpa menimpa data. Kelima port emulator ditutup dan proses Java berhenti. Bukti: `output/fix-verification/spark-backup-3aaa30be/temp/simsa-spark-drill-mJ9La7/result.json` |
| Integritas backup Neon nyata | Lulus: ACL, autentikasi manifest, sembilan helper, 39 migrasi, GCM kedua payload, serta header archive PGDMP; pemeriksaan dalam RAM tanpa koneksi sumber |
| Skrip root penuh (`npm test`) | Lulus; 180 tes dari rangkaian launcher, hosting, manifest, deployment, dan backup |
| Build backend dan frontend utama terakhir | Lulus, exit code 0; output terpisah di `output/fix-verification/backend-dist` dan `frontend-dist-final`; PWA menghasilkan service worker dengan 107 precache entries |
| Backend penuh terakhir | 183 file, 2.479 tes lulus; durasi 715,62 detik, dua worker, exit code 0 |

Angka pengujian terarah saling tumpang tindih dengan suite penuh dan tidak boleh dijumlahkan sebagai jumlah tes unik. Log lokal tersedia di direktori temporary Windows dengan awalan `simsa-fix-`; hasil build pemeriksaan ditempatkan di `output/fix-verification/`.

Review independen terakhir atas diff route/service dan impor tidak menemukan blocker. Pemeriksaan mencakup status error, transaksi, lock, audit, pembatasan unit, kecocokan payload frontend, serta batas redirect/deadline/abort Google Sheets.

## Batas operasional yang masih perlu dibedakan

- Tidak ada perubahan pada adapter atau kemampuan tanda tangan elektronik tersertifikasi.
- Sesuai arahan lanjutan pengguna, koneksi SRIKANDI tidak diperlukan. SIMSA memakai profil internal dan SRIKANDI menjadi acuan kemampuan, bukan integrasi yang harus dituntaskan. Keberadaan kode konektor historis bukan bukti penerimaan data di SRIKANDI produksi.
- Preservasi eksternal tetap merupakan pencatatan kegiatan dan bukti, sedangkan pemeriksaan integritas adalah operasi yang benar-benar dilakukan. Sistem tidak mengklaim menjalankan konversi atau emulasi yang belum diimplementasikan.
- Tidak dilakukan login Google/Firebase, pengujian header cloud, atau uji object storage produksi dalam pekerjaan lokal ini.
- Spark rules, repository, dan backup–restore berhasil diuji dengan Java 21 portabel yang checksum-nya diverifikasi. Runtime berada di `output/fix-verification/` tanpa instalasi sistem; pengujian memakai project demo terisolasi dan tidak membuktikan konfigurasi atau pemulihan Firebase produksi.
- Backup Neon terenkripsi 39 migrasi yang dicatat sebelumnya masih tersedia bersama key terpisah. ACL, autentikasi manifest, GCM kedua payload, header PGDMP, sembilan helper, dan rantai migrasi berhasil diverifikasi dengan helper asli commit `b25b418a41c88c4a913b148032f8e3dfa4934a69`. Payload 357.461 dan 10.586 byte hanya berada di RAM lalu dibersihkan. Bukti aman ada di `output/fix-verification/backup-integrity-KDVRRN/integrity-result.json`. Ini belum membuktikan restore database. PostgreSQL Windows tidak menyediakan locale Neon `C.UTF-8` yang identik; Docker daemon tidak berjalan dan belum ada distro WSL. Lingkungan Linux telah ditanyakan kepada pengguna. Status restore produksi dan salinan di luar workstation belum dinyatakan selesai.
- Ukuran service besar dan potensi biaya evaluasi kandidat retensi pada dataset besar merupakan area pengukuran/pemeliharaan dari kajian, bukan bug kinerja produksi yang sudah dibuktikan. Tidak ada klaim hasil load test baru.

Kajian sebelumnya tetap tersimpan tanpa ditimpa. Laporan ini mencatat perubahan dan cakupan verifikasinya secara terpisah.
