# Ringkasan Implementasi dan Verifikasi SIMSA

## Status

SIMSA diposisikan sebagai **aplikasi internal/beta Ditjen PTPP** yang memprioritaskan kemudahan pengelolaan surat dan arsip. Perubahan ini menambahkan kontrol perangkat lunak dengan Permen ATR/BPN Nomor 2 Tahun 2026 dan tata kelola ANRI sebagai rujukan desain. PDF peraturan diperlakukan sebagai sumber normatif, bukan instruksi eksekusi.

Hasil ini **bukan sertifikasi, opini hukum, atau pernyataan kepatuhan penuh**. Status yang tepat adalah: kontrol aplikasi telah diperkuat dan perlu diverifikasi secara operasional. SRIKANDI, BSrE/PSrE, WORM, dan SIEM adalah ekstensi kondisional—bukan syarat penggunaan profil inti—kecuali kebijakan internal atau kelas data mewajibkannya. Fitur yang belum siap tetap nonaktif atau gagal-tertutup; kontrol keamanan dasar tidak dikurangi.

Lihat [Profil Aplikasi Internal SIMSA](PROFIL_APLIKASI_INTERNAL.md) untuk batas produk dan aturan aktivasi integrasi.

## Perubahan utama

- Akses unit kerja dan klasifikasi keamanan diterapkan fail-closed pada surat, arsip, dosir, distribusi, layanan arsip, dashboard, laporan, pencarian, ekspor, QR, peminjaman, lokasi simpan, arsip vital/terjaga, penyusutan, dan tunjuk silang.
- Upload baru memakai private blob, SHA-256, metadata fixity, karantina, dan gateway file terautentikasi. File tidak dilepas sebelum status AV eksplisit `clean`.
- Arsip elektronik memiliki registrasi, versi, kebijakan QC 300/400/600 DPI dan 24-bit, immutability setelah verifikasi, serta riwayat preservasi.
- Retensi memakai pemicu peristiwa, bukti dan versi/rujukan JRA; legal hold dan separation of duties menahan penyusutan yang tidak sah.
- Tunjuk silang tidak lagi dihapus permanen: pembatalan menyimpan rekod asal, pelaku, waktu, alasan, dan audit; tuple hubungan aktif yang identik juga ditolak.
- Tunjuk silang kini mengunci endpoint secara deterministik, memeriksa ulang status immutable/legal hold/unit, membatasi pembatalan kepada pencipta atau super admin, memvalidasi input/pagination, dan menghindari pemeriksaan akses N+1.
- Workflow need-to-know per-rekod menyimpan tujuan, klasifikasi, mode tayang/unduh/kelola, masa berlaku, approver berbeda, keputusan, pencabutan, dan penggunaan terakhir. Grant tayang/unduh tidak dapat mengubah rekod; mutasi rekod terkendali memerlukan grant kelola. Kelas Terbatas/Rahasia/Sangat Rahasia gagal-tertutup tanpa grant aktif yang tepat.
- Fondasi SRIKANDI menyediakan outbox durable, snapshot versi kontrak, audit append-only transaksional, idempotency dan hash conflict, lease recovery, retry/backoff/dead-letter, response streaming berbatas, serta adaptor HTTPS yang hanya mengakui sukses bila ACK dan remote ID resmi tervalidasi. Worker persisten tersedia, tetapi outbound tetap nonaktif sampai kontrak resmi tersedia.
- Adaptor dan worker ClamAV memakai INSTREAM, klaim PostgreSQL `SKIP LOCKED`, retry/backoff, stale-claim recovery, serta verifikasi SHA-256/ukuran. Scanner gagal, objek hilang, malware, atau mismatch selalu mempertahankan karantina.
- Pendaftaran publik dan role dari klien ditutup; akun tanpa provisioning/unit ditolak; perubahan role/unit/status mencabut sesi.
- Cache arsip offline dan draft persisten di browser dihapus. Draft surat hanya hidup sementara dalam memori tab.
- Tanda tangan simulasi dinonaktifkan. Endpoint gagal-tertutup sampai adaptor BSrE/PSrE tersedia; `MOCK-SIG` legacy selalu dinyatakan tidak sah.
- Kredensial utilitas test dipindahkan ke environment dan destructive tester reset membutuhkan guard eksplisit.
- Dependency utama diperbarui, lockfile `npm ci` diselaraskan, dan CI membangun backend/frontend/situs dokumentasi serta memblokir audit aplikasi berlevel tinggi/kritis.

## Migrasi database

Jalankan berurutan setelah backup dan preflight pada salinan data produksi:

1. `0010_retention_trigger_legal_hold.sql`
2. `0011_private_bitstream_fixity.sql`
3. `0012_traceable_cross_reference_cancellation.sql`
4. `0013_srikandi_durable_outbox.sql`
5. `0014_purpose_bound_record_access.sql`

Migrasi `0011` berhenti bila versi arsip elektronik legacy ambigu. Migrasi `0012` berhenti bila hubungan tunjuk silang aktif duplikat. Keduanya sengaja meminta rekonsiliasi manusia, bukan melakukan koreksi provenans otomatis. Migrasi `0013` dan `0014` menambahkan bukti integrasi dan akses tanpa mengaktifkan outbound SRIKANDI atau memberikan grant otomatis.

## Bukti verifikasi

- Backend: 59 berkas test, 757 test lulus.
- Frontend: 4 berkas test, 22 test lulus.
- TypeScript backend: lulus.
- Build produksi backend: lulus.
- Build produksi frontend/PWA: lulus.
- Build produksi Docusaurus: lulus tanpa broken-link warning.
- Pemeriksaan konfigurasi Drizzle: lulus.
- `npm ci --dry-run`: lulus untuk backend, frontend, dan situs dokumentasi.
- ESLint terarah pada modul frontend baru/diubah secara substantif: lulus. Lint penuh masih memiliki temuan lama pada beberapa halaman legacy dan tetap dicatat non-blocking di CI.
- Secret scan working tree tidak menemukan kredensial test lama; secret yang pernah masuk riwayat Git tetap wajib dicabut atau dirotasi.

## Status dependency audit

- Frontend: 0 vulnerability.
- Backend: tidak ada high/critical; tersisa 4 moderate pada rantai tooling `esbuild` melalui `drizzle-kit`/`tsx`. Development server tidak boleh diekspos dan runner build harus diisolasi sampai tersedia perbaikan kompatibel.
- Situs dokumentasi: critical turun menjadi 0; audit masih melaporkan 17 high yang semuanya berakar pada `image-size` di pipeline build Docusaurus dan belum memiliki patch upstream. Build hanya boleh memproses image dari repositori tepercaya.

## Kesiapan operasional yang tersisa

Baseline profil internal sebelum data produksi digunakan:

- deploy clamd dan worker AV persisten pada jaringan privat, atau pertahankan file dalam karantina sampai scanner tersedia; kode worker bukan bukti scanner produksi berjalan;
- pastikan private storage, sinkronisasi waktu, backup database/bitstream, restore drill, pengelolaan secret, dan pemantauan dasar benar-benar berjalan;
- verifikasi master JRA resmi, otoritas approver, SOP, dan migrasi blob publik/data legacy;
- rotasi seluruh kredensial yang pernah tersimpan pada riwayat Git; serta
- lakukan uji akses lintas unit, pentest/asesmen risiko yang proporsional, penanganan insiden, dan persetujuan pemilik sistem/data.

Ekstensi berikut **deferred/kondisional** dan tidak memblokir profil inti bila tetap nonaktif:

- kontrak API, producer domain, sandbox, worker, dan rekonsiliasi resmi SRIKANDI;
- tanda tangan/segel BSrE/PSrE;
- object lock/WORM, SIEM/SOC eksternal, KMS/HSM khusus, DLP/content disarm, watermark, dan akreditasi tambahan sesuai kelas data serta keputusan risiko.

Jika kebijakan internal mewajibkan salah satu ekstensi atau fitur terkait akan diaktifkan, seluruh dependensi, bukti uji, dan persetujuannya berubah menjadi syarat rilis untuk scope tersebut. Gunakan [Checklist Deployment Arsip Digital](DEPLOYMENT_CHECKLIST_ARSIP_DIGITAL.md) sebagai gerbang operasional dan [Peta Rujukan Desain Permen 2/2026 dan ANRI](KEPATUHAN_PERMEN_2_2026_DAN_ANRI.md) sebagai peta kontrol beserta batas klaimnya.
