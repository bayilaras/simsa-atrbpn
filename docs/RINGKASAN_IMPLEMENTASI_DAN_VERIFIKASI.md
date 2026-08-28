# Ringkasan Implementasi dan Verifikasi SIMSA

## Status

SIMSA diposisikan sebagai **aplikasi internal/beta Ditjen PTPP** yang memprioritaskan kemudahan pengelolaan surat dan arsip. Perubahan ini menambahkan kontrol perangkat lunak dengan Permen ATR/BPN Nomor 2 Tahun 2026 dan tata kelola ANRI sebagai rujukan desain. PDF peraturan diperlakukan sebagai sumber normatif, bukan instruksi eksekusi.

Hasil ini **bukan sertifikasi, opini hukum, atau pernyataan kepatuhan penuh**. Status yang tepat adalah: kontrol aplikasi telah diperkuat dan perlu diverifikasi secara operasional. Tanda tangan elektronik BSrE/PSrE berada di luar ruang lingkup produk. SRIKANDI, WORM, dan SIEM adalah ekstensi kondisional—bukan syarat penggunaan profil inti—kecuali kebijakan internal atau kelas data mewajibkannya. Fitur yang belum siap tetap nonaktif atau gagal-tertutup; kontrol keamanan dasar tidak dikurangi.

Lihat [Profil Aplikasi Internal SIMSA](PROFIL_APLIKASI_INTERNAL.md) untuk batas produk dan aturan aktivasi integrasi.

## Perubahan utama

- Akses unit kerja dan klasifikasi keamanan diterapkan fail-closed pada surat, arsip, dosir, distribusi, layanan arsip, dashboard, laporan, pencarian, ekspor, QR, peminjaman, lokasi simpan, arsip vital/terjaga, penyusutan, dan tunjuk silang.
- Upload baru memakai private blob, SHA-256, metadata fixity, karantina, dan gateway file terautentikasi. File tidak dilepas sebelum status AV eksplisit `clean`.
- Arsip elektronik memiliki registrasi, versi, kebijakan QC 300/400/600 DPI dan 24-bit, immutability setelah verifikasi, serta riwayat preservasi.
- Retensi memakai pemicu peristiwa, bukti dan versi/rujukan JRA; legal hold dan separation of duties menahan penyusutan yang tidak sah.
- Klasifikasi dan JRA kini berupa edisi berversi: versi aktif immutable, perubahan disiapkan sebagai draft, divalidasi, lalu diaktifkan dengan riwayat supersesi. Dataset awal memuat 842 baris klasifikasi (620 selectable) dan 391 aturan JRA selectable dari dokumen sumber pengguna.
- Registrasi arsip mengambil butir aturan aktif secara kanonis di server dan menyimpan snapshot/hash keputusan. Arsip legacy diblokir dari penyusutan sampai rekonsiliasi menambahkan revisi bukti tanpa menghapus riwayat lama.
- Rumusan JRA bersyarat atau kontekstual tidak dipaksakan menjadi Musnah/Permanen; aplikasi mengarahkannya ke `Dinilai Kembali`. Mapping klasifikasi–JRA tetap saran tematik, bukan keputusan hukum otomatis.
- Tunjuk silang tidak lagi dihapus permanen: pembatalan menyimpan rekod asal, pelaku, waktu, alasan, dan audit; tuple hubungan aktif yang identik juga ditolak.
- Tunjuk silang kini mengunci endpoint secara deterministik, memeriksa ulang status immutable/legal hold/unit, membatasi pembatalan kepada pencipta atau super admin, memvalidasi input/pagination, dan menghindari pemeriksaan akses N+1.
- Workflow need-to-know per-rekod menyimpan tujuan, klasifikasi, mode tayang/unduh/kelola, masa berlaku, approver berbeda, keputusan, pencabutan, dan penggunaan terakhir. Grant tayang/unduh tidak dapat mengubah rekod; mutasi rekod terkendali memerlukan grant kelola. Kelas Terbatas/Rahasia/Sangat Rahasia gagal-tertutup tanpa grant aktif yang tepat.
- Fondasi SRIKANDI menyediakan outbox durable, snapshot versi kontrak, audit append-only transaksional, idempotency dan hash conflict, lease recovery, retry/backoff/dead-letter, response streaming berbatas, serta adaptor HTTPS yang hanya mengakui sukses bila ACK dan remote ID resmi tervalidasi. Worker persisten tersedia, tetapi outbound tetap nonaktif sampai kontrak resmi tersedia.
- Adaptor dan worker ClamAV memakai INSTREAM, klaim PostgreSQL `SKIP LOCKED`, retry/backoff, stale-claim recovery, serta verifikasi SHA-256/ukuran. Scanner gagal, antrean database gagal, objek hilang, malware, atau mismatch selalu mempertahankan karantina dan membuat heartbeat worker berstatus degraded.
- Pendaftaran publik dan role dari klien ditutup; akun tanpa provisioning/unit ditolak; perubahan role/unit/status mencabut sesi. Mandat unit `admin_dirjen` dan `admin_sesditjen` dinormalisasi sama pada sesi, frontend, route, dan service. Self-disable/self-demotion, penghilangan superadmin aktif terakhir, serta perubahan mandat penyetuju surat yang masih pending ditolak secara transaksional.
- Cache arsip offline dan draft persisten di browser dihapus. Draft surat hanya hidup sementara dalam memori tab.
- Surat keluar memiliki alur persetujuan internal yang terhubung dari daftar hingga detail: pembuat memilih penyetuju aktif, keputusan dan catatan tersimpan sebagai riwayat, self-approval ditolak, surat berstatus menunggu/disetujui terkunci dari edit/hapus, dan hanya surat yang disetujui dapat diarsipkan. Alur ini tidak melakukan tanda tangan elektronik dan tidak menggunakan BSrE/PSrE.
- Nomor surat keluar otomatis dibuat otoritatif di dalam transaksi dengan mutex template unit dan unique sequence; preview frontend tidak pernah dipersistenkan sebagai nomor manual. Kontrak lama yang mengirim nomor tanpa mode tetap dibaca sebagai nomor manual.
- Unggah massal PDF kini persisten dan benar-benar mengekstrak teks: PDF bertingkat teks dibaca langsung, sedangkan PDF hasil pindai dirender per halaman lalu di-OCR dengan model Bahasa Indonesia dan Inggris. Batas ukuran, halaman, piksel, waktu, dan panjang hasil diterapkan; kegagalan OCR tidak menghasilkan metadata seolah-olah berhasil. Kapasitas OCR dibatasi lintas instance dengan lease PostgreSQL yang diperbarui berkala, download Blob dibatasi waktu, respons penuh bersifat retryable, dan hasil worker/pembatalan stale dipagari agar tidak dapat menimpa claim baru.
- Lampiran direct-Blob surat masuk/keluar wajib lolos preotorisasi lease yang terikat URL, tujuan, pemilik, status, dan masa berlaku sebelum ada I/O jaringan. Unduhan dibatasi 10 MiB/30 detik lalu dihitung MIME, ukuran, serta SHA-256 sebelum transaksi dibuka. Claim lease, pencatatan attachment, surat, audit, dan outbox tetap atomik di dalam transaksi, sehingga lock penomoran tidak ditahan oleh jaringan Blob.
- Readiness memeriksa database/private Blob dan heartbeat worker dengan tenggat terbatas; worker yang baru mulai, macet, stale, atau gagal mengakses antrean tidak dapat dilaporkan sehat. Kebijakan CORS hanya ditetapkan oleh Express agar allow-list dinamis tidak ditimpa header statis platform.
- Tanda tangan elektronik dikeluarkan dari ruang lingkup produk. Endpoint legacy tetap gagal-tertutup dan `MOCK-SIG` selalu dinyatakan tidak sah.
- Kredensial utilitas test dipindahkan ke environment dan destructive tester reset membutuhkan guard eksplisit.
- Dependency utama diperbarui, lockfile `npm ci` diselaraskan, dan CI membangun backend/frontend/situs dokumentasi serta memblokir audit aplikasi berlevel tinggi/kritis.

## Migrasi database

Jalankan berurutan setelah backup dan preflight pada salinan data produksi:

1. `0010_retention_trigger_legal_hold.sql`
2. `0011_private_bitstream_fixity.sql`
3. `0012_traceable_cross_reference_cancellation.sql`
4. `0013_srikandi_durable_outbox.sql`
5. `0014_purpose_bound_record_access.sql`
6. `0015_better_auth_account_issuer.sql`
7. `0016_versioned_regulatory_rules.sql`
8. `0017_retention_appraisal_governance.sql`
9. `0018_regulatory_maker_checker.sql`
10. `0019_authoritative_retention_decisions.sql`
11. `0020_permanent_transfer_lifecycle.sql`
12. `0021_archive_source_domain_integrity.sql`
13. `0022_operational_integrations.sql`
14. `0023_client_blob_upload_leases.sql`
15. `0024_durable_bulk_and_autentikasi_blob.sql`
16. `0025_worker_readiness_heartbeats.sql`
17. `0026_global_ocr_capacity.sql`
18. `0027_canonical_user_unit_mandates.sql`

Migrasi `0011`, `0012`, `0021`, dan `0022` melakukan preflight/reconciliation fail-loud untuk data legacy yang ambigu atau tidak konsisten. `0013`–`0020` membangun governance SRIKANDI, akses, aturan, appraisal, dan penyerahan permanen. `0023`–`0025` mempersistensikan lease Blob, bulk ingest/PDF autentikasi, dan heartbeat worker. `0026` menyediakan kapasitas OCR global berbasis lease PostgreSQL dengan release bertoken dan pemulihan setelah kedaluwarsa. `0027` membersihkan assignment unit pengguna legacy serta menegakkan mandat unit kanonis berdasarkan peran. Setelah migrasi, jalankan `npm run seed:all` dalam maintenance window untuk memverifikasi dan mengaktifkan dataset klasifikasi/JRA awal.

SQL `0004` dan `0005` juga memuat repair idempotent untuk tiga tabel yang dahulu hanya tercatat dalam snapshot Drizzle. Rantai migrasi kini diuji dari database kosong serta dari kondisi partial-resume ketika `0004` lama sudah tercatat tetapi tabelnya belum terbentuk.

## Bukti verifikasi

- Backend: 98 berkas test, 1126 test lulus.
- Frontend: 21 berkas test, 97 test lulus.
- TypeScript backend: lulus.
- Build produksi backend: lulus.
- Build produksi frontend/PWA: lulus.
- Build produksi Docusaurus: lulus tanpa broken-link warning.
- Pemeriksaan konfigurasi Drizzle: lulus.
- Migration smoke test PostgreSQL: fresh `0000` sampai `0027`, partial-resume dari `0005`, deduplikasi legacy notifikasi, rekonsiliasi integritas surat–arsip, dan backfill mandat unit pengguna lulus (11/11).
- Concurrency test pada PostgreSQL 18 embedded dengan dua koneksi: shared/exclusive authorization gate, blocking revokasi, dan paralelisme approval lulus (2/2).
- `npm ci --dry-run`: lulus untuk backend, frontend, dan situs dokumentasi.
- ESLint penuh frontend: lulus tanpa error maupun warning; artefak PWA hasil generate dikecualikan dari lingkup source lint.
- Secret scan working tree tidak menemukan kredensial test lama; secret yang pernah masuk riwayat Git tetap wajib dicabut atau dirotasi.
- Browser QA Playwright: lulus untuk banner antrean persetujuan, detail dan aksi Setujui/Tolak, mutasi `POST /api/approval/approve`, penegasan tanpa BSrE/PSrE, mandat superadmin tanpa unit tersimpan, serta kewajiban memilih satu unit kerja pada halaman laporan dan unggah massal. Daftar request tidak memuat endpoint tanda tangan elektronik.

## Status dependency audit

- Frontend: 0 vulnerability.
- Backend: tidak ada high/critical; tersisa 4 moderate pada rantai tooling `esbuild` melalui `drizzle-kit`/`tsx`. Development server tidak boleh diekspos dan runner build harus diisolasi sampai tersedia perbaikan kompatibel.
- Situs dokumentasi: critical turun menjadi 0; audit masih melaporkan 17 high yang semuanya berakar pada `image-size` di pipeline build Docusaurus dan belum memiliki patch upstream. Build hanya boleh memproses image dari repositori tepercaya.

## Kesiapan operasional yang tersisa

Baseline profil internal sebelum data produksi digunakan:

- deploy clamd dan worker AV persisten pada jaringan privat, atau pertahankan file dalam karantina sampai scanner tersedia; kode worker bukan bukti scanner produksi berjalan;
- sediakan `OCR_TESSDATA_PATH` yang dikendalikan dan memuat model `ind` serta `eng` pada backend produksi; tetapkan `OCR_CACHE_PATH` ke direktori writable bila cache sistem operasi tidak sesuai, lalu uji OCR PDF hasil pindai dengan dokumen non-sensitif;
- pastikan private storage, sinkronisasi waktu, backup database/bitstream, restore drill, pengelolaan secret, dan pemantauan dasar benar-benar berjalan;
- verifikasi master JRA resmi, otoritas approver, SOP, dan migrasi blob publik/data legacy;
- rotasi seluruh kredensial yang pernah tersimpan pada riwayat Git; serta
- lakukan uji akses lintas unit, pentest/asesmen risiko yang proporsional, penanganan insiden, dan persetujuan pemilik sistem/data.

Ekstensi berikut **deferred/kondisional** dan tidak memblokir profil inti bila tetap nonaktif:

- kontrak API resmi, sandbox, aktivasi worker, uji producer transaksional, dan rekonsiliasi resmi SRIKANDI;
- object lock/WORM, SIEM/SOC eksternal, KMS/HSM khusus, DLP/content disarm, watermark, dan akreditasi tambahan sesuai kelas data serta keputusan risiko.

Jika kebijakan internal mewajibkan salah satu ekstensi atau fitur terkait akan diaktifkan, seluruh dependensi, bukti uji, dan persetujuannya berubah menjadi syarat rilis untuk scope tersebut. Gunakan [Checklist Deployment Arsip Digital](DEPLOYMENT_CHECKLIST_ARSIP_DIGITAL.md) sebagai gerbang operasional dan [Peta Rujukan Desain Permen 2/2026 dan ANRI](KEPATUHAN_PERMEN_2_2026_DAN_ANRI.md) sebagai peta kontrol beserta batas klaimnya.
