# Checklist Deployment Profil Internal SIMSA

## 1. Prinsip rilis

Checklist ini adalah gerbang operasional untuk profil aplikasi internal, bukan checklist sertifikasi atau pernyataan kepatuhan penuh. Permen ATR/BPN Nomor 2 Tahun 2026 dan ketentuan ANRI digunakan sebagai rujukan desain. Lulus build atau unit test tidak sama dengan kesiapan operasional. Setiap butir yang berlaku harus memiliki pemilik, bukti, tanggal, lingkungan, dan pemberi persetujuan.

Gunakan [Profil Aplikasi Internal SIMSA](PROFIL_APLIKASI_INTERNAL.md) untuk menetapkan scope. Butir tanpa label adalah baseline internal. Butir berlabel **Kondisional** hanya menjadi gerbang bila fitur, kelas data, kebijakan internal, atau keputusan risiko terkait diaktifkan.

Gunakan empat keputusan rilis:

- **GO Terbatas**: hanya data sintetis atau arsip Biasa/Terbuka yang disetujui;
- **GO Internal**: baseline keamanan, backup/restore, dan pemantauan untuk scope internal telah diterima; integrasi kondisional yang belum siap tetap nonaktif;
- **GO Integrasi Kondisional**: selain baseline internal, seluruh dependensi dan bukti uji untuk integrasi atau kelas data yang dipilih telah diterima; atau
- **NO-GO**: ada migrasi gagal, blob publik tidak terkendali, AV belum memblokir file berbahaya, restore gagal, akses lintas unit, audit hilang, atau tanda tangan mock aktif.

SIMSA merupakan aplikasi internal/substantif Ditjen PTPP, bukan pengganti SRIKANDI dan bukan produk yang telah disertifikasi. Tanda tangan elektronik BSrE/PSrE berada di luar ruang lingkup produk. Konektor SRIKANDI, WORM, dan SIEM bersifat opsional/deferred kecuali kebijakan internal mewajibkannya.

## 2. Persiapan tata kelola

- [ ] Tetapkan pemilik sistem, pemilik data, Unit Pengolah, Unit Kearsipan, DPO/keamanan informasi, DBA, storage admin, dan incident commander.
- [ ] Sahkan ruang lingkup data, kelas keamanan yang diizinkan, periode pilot, RPO/RTO, retensi log, dan kriteria penerimaan.
- [ ] Verifikasi master klasifikasi dan JRA terhadap dokumen resmi; simpan versi, tanggal berlaku, approver, dan checksum sumber.
- [ ] Sahkan SOP penciptaan/penerimaan, registrasi, pemberkasan, alih media/QC, akses, peminjaman, preservasi, legal hold, penyusutan, pemusnahan, penyerahan, backup, restore, dan insiden.
- [ ] **Kondisional — SRIKANDI:** dapatkan kontrak API, sandbox, kredensial, serta persetujuan integrasi sebelum outbound diaktifkan.
- [ ] **Kondisional — tata kelola eksternal:** jadwalkan asistensi/uji petik dengan Unit Kearsipan Kementerian dan ANRI bila scope atau kebijakan mensyaratkannya.
- [ ] Jangan gunakan data Rahasia/Sangat Rahasia sampai pemilik risiko mengizinkan scope dan menetapkan kontrol tambahannya. Clearance, approval berbasis tujuan, watermark, DLP, KMS/HSM, WORM, SIEM, pentest, atau akreditasi diterapkan sesuai kebijakan dan hasil asesmen; kontrol akses, private storage, audit, backup, dan incident response tetap wajib.

## 3. Baseline teknis sebelum migrasi

- [ ] Kunci commit/artifact yang akan dirilis; hasil build backend/frontend dan seluruh test tersimpan sebagai bukti CI.
- [ ] Gunakan Node 24 yang sama pada CI, Vercel, dan image worker; jangan merilis artifact yang dibangun dengan major runtime berbeda.
- [ ] Pisahkan `DATABASE_URL`, private Blob store/token, OAuth callback, dan domain antara Preview dan Production. Pada Vercel, biarkan `VITE_API_URL` kosong agar cookie auth, CSRF, dan upload Blob tetap same-origin; tetapkan `API_PROXY_ORIGIN` server-side ke branch alias backend Preview HTTPS (`simsa-backend-git-...`) yang cocok dengan `VERCEL_GIT_COMMIT_REF` frontend. Target kosong menghasilkan shell `503` tanpa proxy; target branch/alias Production, alias branch lain, FQDN ekuivalen, dan URL deployment Vercel yang environment-nya ambigu ditolak. Pemisahan database/Blob tetap wajib dibuktikan secara operasional.
- [ ] Isi seluruh kontrak backend `PREVIEW_*`, kemudian dan hanya kemudian set `SIMSA_PREVIEW_ENABLED=true`. Sebelum itu backend tidak mengimpor aplikasi: `/health` tetap menunjukkan proses hidup, sedangkan `/ready` dan seluruh route bisnis mengembalikan `503 preview_not_provisioned`. Frontend tanpa `API_PROXY_ORIGIN` juga hanya menampilkan shell 503 tanpa proxy ke Production.
- [ ] Backend Vercel Preview dipaksa ke mode antivirus internal quarantine-only: scanner/worker/`CLAMAV_*` Production tidak diwarisi. `SMTP_TIMEOUT_MS`, TTL lease Blob, dan batch reconciliation memakai `PREVIEW_*` eksplisit atau default aman. Worker scanner Preview, bila diuji, harus berupa deployment persisten terpisah yang hanya terhubung ke database/Blob Preview.
- [ ] Aktifkan Vercel System Environment Variables dan verifikasi `VERCEL_ENV` serta `VERCEL_GIT_COMMIT_REF` ada pada build Preview; guard menolak target project SIMSA bila referensi branch tidak tersedia.
- [ ] Aktifkan Automation Bypass pada project backend Preview yang dilindungi Vercel, simpan secret-nya hanya pada environment **Preview frontend** sebagai `BACKEND_VERCEL_PROTECTION_BYPASS`, dan uji `/health` melalui proxy frontend tanpa redirect SSO. Header `x-vercel-protection-bypass` harus ditambahkan oleh routing layer, bukan kode browser; jangan memakai prefiks `VITE_`, mencatat, atau mengirim secret ke origin selain branch alias backend SIMSA.
- [ ] Provision custom HTTPS callback origin backend Preview yang dapat dijangkau Vercel Blob dan tidak terkena Deployment Protection, lalu set `PREVIEW_VERCEL_BLOB_CALLBACK_URL` tanpa path/trailing slash. Jangan menaruh bypass secret dalam URL callback/client token. Uji direct upload sungguhan sampai callback bertanda tangan membuat lease `pending`, transaksi surat/rule-set mengklaimnya, dan object yatim dipulihkan reconciler; konfigurasi menolak callback Preview `*.vercel.app`.
- [ ] Jalankan SAST, SCA/dependency scan, secret scan, IaC scan, dan pentest; seluruh temuan kritis/tinggi ditutup atau diterima tertulis.
- [ ] Pastikan tidak ada secret di Git, artifact, log, source map, browser bundle, atau file test.
- [x] Utilitas test di working tree membaca kredensial dari environment dan menolak berjalan tanpa konfigurasi eksplisit.
- [ ] Rotasi/nonaktifkan akun test, API key, dan proxy credential yang pernah tersimpan pada riwayat Git; perubahan working tree tidak mencabut secret yang sudah terekspos.
- [ ] Dokumentasikan penerimaan risiko sementara untuk advisory `image-size` pada pipeline build Docusaurus (belum ada patch upstream); hanya proses image yang berasal dari repositori tepercaya dan jangan menjalankan build pada input tidak tepercaya.
- [ ] Tinjau empat advisory moderat `esbuild` pada rantai tooling `drizzle-kit`/`tsx`; jangan mengekspos development server, isolasi runner build, dan pantau perbaikan upstream. Jangan memakai `npm audit fix --force` yang menurunkan `drizzle-kit` secara breaking tanpa pengujian migrasi penuh.
- [ ] Gunakan custom domain institusi dan reverse proxy API same-origin. Seluruh build production harus membiarkan `VITE_API_URL` kosong; hosting selain Vercel wajib menyediakan aturan `/api`, `/health`, `/ready`, dan `/uploads` yang ekuivalen.
- [ ] Set `NODE_ENV=production`, `BETTER_AUTH_URL`, `FRONTEND_URL`, `ADDITIONAL_TRUSTED_ORIGINS`, `COOKIE_DOMAIN`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, OAuth, dan `BLOB_READ_WRITE_TOKEN` melalui secret manager; daftarkan setiap alias Preview secara exact dan jangan pernah mempercayai wildcard `*.vercel.app`, commit nilainya, atau mengekspos token Blob sebagai variabel `VITE_*`.
- [ ] Set `OCR_TESSDATA_PATH` ke sumber/direktori terkontrol yang memuat `ind.traineddata.gz` dan `eng.traineddata.gz`. Pastikan runtime dapat membacanya tanpa bergantung pada unduhan internet; bila perlu, set `OCR_CACHE_PATH` ke direktori cache writable dengan kapasitas dan lifecycle yang dipantau.
- [ ] Hubungkan private Vercel Blob store ke backend production. Uji token unggah PDF regulasi yang terikat `ruleSetId`, batas 50 MiB, random suffix, larangan overwrite/public locator, serta server refetch sebelum bukti sumber diterima.
- [ ] Untuk profil inti, tetapkan backend `APP_PROFILE=internal` dan `SRIKANDI_ENABLED=false`, lalu build frontend dengan `VITE_APP_PROFILE=internal` dan `VITE_FEATURE_SRIKANDI=false`.
- [ ] Pastikan OAuth redirect URI, cookie `Secure`/`HttpOnly`/`SameSite`, CORS allow-list, CSRF, HSTS, CSP, rate limit, dan idle/session expiry diuji dari browser sasaran.
- [ ] Pastikan pendaftaran publik mati, role tidak dapat diisi klien, provisioning hanya oleh admin berwenang, dan perubahan role/unit/status mencabut sesi.
- [ ] Pastikan akun break-glass memakai MFA, disegel, dimonitor, dan diuji; tidak dipakai untuk kegiatan harian.
- [ ] Sinkronkan waktu server, database, storage, IdP, sistem log/pemantauan, dan perangkat pemindaian ke sumber waktu institusi; sertakan SIEM bila digunakan.

## 4. Backup pra-migrasi

- [ ] Pastikan secret GitHub `NEON_BACKUP_DATABASE_URL` memakai direct endpoint TLS dan role khusus `INHERIT pg_read_all_data` tanpa hak tulis/admin, serta `BACKUP_ENCRYPTION_PASSPHRASE` acak satu baris minimal 32 karakter tersedia juga di secret manager terpisah. Workflow wajib hijau: custom dump dialirkan langsung ke enkripsi, dekripsi dialirkan langsung ke restore PostgreSQL terisolasi, tabel/kolom/PK/constraint/migrasi kritis diverifikasi, lalu artifact terenkripsi diunggah.
- [ ] Buat snapshot/PITR database dan `pg_dump` terenkripsi; uji restore ke lingkungan terisolasi.
- [ ] Ekspor inventaris seluruh object: URL/key, ukuran, MIME, SHA-256 bila ada, entity, kelas keamanan, access mode, dan version ID.
- [ ] Backup konfigurasi, kebijakan IAM/storage, serta audit; simpan terpisah dari production account. Sertakan mapping SRIKANDI dan material KMS bila kapabilitas tersebut digunakan.
- [ ] Catat waktu cut-off dan batasi write selama langkah yang memerlukan konsistensi.
- [ ] Verifikasi bahwa backup mencakup database **dan bitstream**. Workflow Neon hanya mencakup database; backup dan restore private Blob tetap blocker eksternal sampai inventory, salinan independen, checksum, dan drill pasangan database–Blob dibuktikan.

## 5. Migrasi database 0010 sampai 0029

Migrasi yang harus berurutan:

1. `backend/src/db/migrations/0010_retention_trigger_legal_hold.sql`
2. `backend/src/db/migrations/0011_private_bitstream_fixity.sql`
3. `backend/src/db/migrations/0012_traceable_cross_reference_cancellation.sql`
4. `backend/src/db/migrations/0013_srikandi_durable_outbox.sql`
5. `backend/src/db/migrations/0014_purpose_bound_record_access.sql`
6. `backend/src/db/migrations/0015_better_auth_account_issuer.sql`
7. `backend/src/db/migrations/0016_versioned_regulatory_rules.sql`
8. `backend/src/db/migrations/0017_retention_appraisal_governance.sql`
9. `backend/src/db/migrations/0018_regulatory_maker_checker.sql`
10. `backend/src/db/migrations/0019_authoritative_retention_decisions.sql`
11. `backend/src/db/migrations/0020_permanent_transfer_lifecycle.sql`
12. `backend/src/db/migrations/0021_archive_source_domain_integrity.sql`
13. `backend/src/db/migrations/0022_operational_integrations.sql`
14. `backend/src/db/migrations/0023_client_blob_upload_leases.sql`
15. `backend/src/db/migrations/0024_durable_bulk_and_autentikasi_blob.sql`
16. `backend/src/db/migrations/0025_worker_readiness_heartbeats.sql`
17. `backend/src/db/migrations/0026_global_ocr_capacity.sql`
18. `backend/src/db/migrations/0027_canonical_user_unit_mandates.sql`
19. `backend/src/db/migrations/0028_user_profile_columns.sql`
20. `backend/src/db/migrations/0029_outgoing_security_classification.sql`

`0010` menambahkan pemicu retensi berbasis peristiwa, bukti/versi/rujukan JRA, legal hold, constraint, dan indeks kandidat. Migrasi ini sengaja **tidak** mengisi pemicu dari `tanggal_arsip`; rekod legacy tetap tidak layak menjadi kandidat penyusutan sampai arsiparis memasukkan bukti peristiwa yang sah.

`0011` menambahkan baseline SHA-256 dan status bitstream, relasi arsip elektronik ke lampiran, kode registrasi/QC/immutability, serta pelaku proposed/reviewed/executed. Migrasi menandai seluruh locator legacy sebagai `storage_access='public'` kecuali hostname secara eksplisit menunjukkan Vercel private storage; penandaan tersebut bukan migrasi fisik ke private storage.

`0012` mengganti penghapusan permanen tunjuk silang dengan pembatalan yang menyimpan pelaku, waktu, dan alasan. Migrasi sengaja berhenti bila terdapat hubungan aktif duplikat agar rekonsiliasi provenans dilakukan sebelum unique index diterapkan.

`0013` menambahkan outbox SRIKANDI durable, snapshot versi kontrak, status retry/dead-letter, idempotency, bukti respons resmi, dan audit append-only. Tabel tersebut belum mengaktifkan pengiriman; outbound tetap memerlukan kontrak dan konfigurasi resmi.

`0014` menambahkan permohonan akses per-rekod dengan tujuan, klasifikasi, mode tayang/unduh/kelola, keputusan, kedaluwarsa, dan pencabutan. Unique index mencegah permohonan atau grant aktif ganda untuk pengguna dan rekod yang sama.

`0015` memperbaiki identitas issuer akun Better Auth agar login sosial Google yang telah ditautkan tetap dapat ditemukan setelah perubahan konfigurasi auth.

`0016` menambahkan edisi klasifikasi/JRA yang berversi, item aturan terikat edisi, snapshot keputusan arsip append-only, provenance aturan, serta perlindungan database terhadap perubahan item versi terbit. Migrasi sengaja menandai arsip lama `legacy_unverified`; jangan mengubahnya menjadi `verified` secara massal tanpa rekonsiliasi arsiparis.

`0017` dan `0019` melengkapi appraisal/keputusan retensi yang berwenang, separation of duties, bukti, dan status hasil yang menjadi dasar workflow penyusutan.

`0018` menambahkan workflow maker-checker, bukti PDF private Blob terverifikasi server, manifest kelengkapan/cakupan halaman, diff dan analisis dampak, serta rantai audit append-only untuk perubahan master klasifikasi/JRA. Locator private hanya disimpan internal dan wajib ada untuk edisi baru sebelum aktivasi.

`0020` menambahkan lifecycle penyerahan arsip permanen, reservasi satu proses aktif per arsip, pembatalan/riwayat manifest append-only, serta pengikatan bukti serah pada lampiran terverifikasi.

`0021` mengunci integritas domain relasi surat–arsip, menyelaraskan flag `is_archived`, menolak sumber ganda/salah jenis, dan membuat linkage sumber immutable. `0022` mempersistensikan preferensi, template nomor, dan status baca notifikasi dengan constraint yang direkonsiliasi secara fail-loud.

`0023` mencatat lease unggahan Blob langsung agar objek yang sudah diklaim transaksi tidak dihapus rekonsiliator dan objek kedaluwarsa yang belum diklaim dapat dibersihkan aman. `0024` membuat batch/item bulk upload durable serta memindahkan PDF autentikasi ke private Blob. `0025` menyimpan heartbeat per-instance untuk readiness worker antivirus dan SRIKANDI. `0026` menambahkan semaphore OCR global berbasis lease PostgreSQL; kapasitas, durasi lease, dan jeda retry tersimpan secara otoritatif di `ocr_capacity_control`, bukan pada konfigurasi masing-masing instance. `0027` merekonsiliasi unit kerja pengguna legacy dan menegakkan mandat kanonis di database: superadmin lintas unit disimpan tanpa unit, sedangkan administrator Ditjen/Sesditjen selalu terikat ke unit mandatnya. `0028` menambahkan kolom profil pengguna `jabatan` dan `nip`. `0029` menambahkan klasifikasi keamanan eksplisit untuk surat keluar baru; baris legacy tetap `NULL` dan diperlakukan sebagai `terbatas` oleh access layer.

Langkah eksekusi:

- [ ] Cocokkan `backend/src/db/migrations/meta/_journal.json` dengan kedua puluh file SQL `0010`–`0029` dan pastikan tidak ada migration ID ganda.
- [ ] Uji seluruh migrasi pada salinan production yang telah dianonimkan; catat durasi, lock, ukuran indeks, dan error.
- [ ] Jalankan preflight duplikasi `(arsip_id, versi_dokumen)`. Migrasi `0011` sengaja berhenti bila data legacy ambigu; rekonsiliasi provenans bersama arsiparis dan jangan melakukan auto-renumber.
- [ ] Jalankan preflight hubungan tunjuk silang aktif duplikat. Migrasi `0012` juga sengaja berhenti sampai duplikasi direkonsiliasi dan keputusannya dicatat.
- [ ] Jalankan dari direktori `backend` dengan `npm run db:migrate`; jangan memakai `db:push` untuk produksi terkontrol.
- [ ] Masih dalam maintenance window, jalankan `npm run seed:all`. Seed memverifikasi SHA-256/manifest, mengganti hanya dua draft awal dengan dataset resmi, mengaktifkannya, lalu menambahkan mapping rekomendasi secara idempotent. Hentikan rollout bila seed gagal.
- [ ] Verifikasi kolom, foreign key, check constraint, unique/partial index, dan entri jurnal migrasi.
- [ ] Verifikasi tepat satu versi `active` untuk `klasifikasi` dan satu untuk `jra`; klasifikasi berisi 842 baris/620 selectable dan JRA berisi 545 baris/391 selectable.
- [ ] Verifikasi `super_admin.unit_kerja_id IS NULL`, `admin_dirjen.unit_kerja_id='ditjen'`, dan `admin_sesditjen.unit_kerja_id='sesditjen'` setelah rekonsiliasi 0027.
- [ ] Verifikasi arsip legacy berstatus `legacy_unverified`, memiliki snapshot migrasi, dan tidak muncul pada kandidat penyusutan sampai direkonsiliasi.
- [ ] Pastikan rekod legacy memiliki `retention_trigger_date IS NULL` dan tidak muncul sebagai kandidat penyusutan.
- [ ] Pastikan objek dengan URL publik ditandai `storage_access='public'`, bukan dianggap private.
- [ ] Jalankan smoke test create/read/update, upload/download, QC/fixity, legal hold, kandidat retensi, dan seluruh transisi penyusutan.

## 6. Urutan rollout aplikasi

1. Aktifkan maintenance window atau kontrol write yang disetujui.
2. Ambil backup dan bukti restore.
3. Jalankan migrasi sampai `0029` dengan `npm run db:migrate`.
4. Jalankan `npm run seed:all`, lalu verifikasi jumlah, hash sumber, status versi aktif, dan snapshot legacy.
5. Deploy backend baru; pastikan `/health` menjawab liveness dan `/ready` atau `/api/health` lulus probe database/private Blob serta heartbeat worker yang diwajibkan.
6. Deploy frontend baru; invalidasi asset cache, tetapi jangan cache respons `/api/*`.
7. Smoke test login Google/email, pemilih klasifikasi/JRA aktif, registrasi arsip, rekonsiliasi arsip legacy, legal hold, penolakan penyusutan tanpa provenance, persetujuan internal surat keluar, serta OCR PDF bertingkat teks dan PDF hasil pindai.
8. Verifikasi provisioning super admin, role, unit kerja, isolasi lintas unit, dan sesi yang dicabut setelah perubahan otorisasi.
9. Verifikasi file baru tersimpan private dan hanya dapat diambil melalui `/api/files/...` dengan audit serta header `no-store`.
10. Unggah PDF sumber regulasi berukuran di atas 4 MiB melalui direct private Blob, selesaikan verifikasi server, dan pastikan respons daftar/detail aturan tidak memuat locator Blob.
11. Migrasikan blob publik legacy sesuai Bagian 7.
12. **Kondisional — SRIKANDI:** deploy worker persisten dan aktifkan connector hanya setelah uji sandbox serta rekonsiliasi lulus; jika tidak diwajibkan, pertahankan outbound nonaktif.
13. Buka pilot terbatas; pantau error, audit, AV, fixity, storage, dan database, serta queue integrasi bila diaktifkan.

## 7. Migrasi blob publik legacy

- [ ] Hasilkan manifest immutable yang memetakan object lama ke object private baru dan mencatat hash sebelum/sesudah.
- [ ] Salin, jangan langsung pindahkan atau hapus, setiap object publik ke namespace private.
- [ ] Hitung SHA-256 dari sumber dan tujuan; hentikan batch bila tidak sama.
- [ ] Jalankan AV/DLP sebelum object tujuan dinyatakan tersedia.
- [ ] Perbarui locator dan `storage_access` dalam transaksi atau batch idempotent; simpan checkpoint dan audit actor.
- [ ] Uji akses pemilik unit, penolakan lintas unit, kelas keamanan, view/download/manage, larangan mutasi melalui grant tayang/unduh, audit, dan expiry otorisasi.
- [ ] Pantau referensi ke URL publik selama masa observasi.
- [ ] Hapus atau nonaktifkan object publik hanya setelah rekonsiliasi 100%, persetujuan pemilik data, bukti backup, dan masa observasi selesai.
- [ ] Nonaktifkan endpoint kompatibilitas yang dapat mengarahkan langsung ke object publik setelah tidak ada referensi legacy.

## 8. Kontrol bitstream dan alih media

- [x] Gateway aplikasi menolak file `not_scanned`, sedang dipindai, retry, gagal, terinfeksi, public legacy, tanpa hash, atau hash mismatch.
- [x] Adaptor ClamAV INSTREAM dan worker PostgreSQL idempotent tersedia di kode, termasuk retry/backoff, stale-claim recovery, dan verifikasi fixity sebelum status `clean`.
- [x] CI Linux menjalankan scanner aplikasi terhadap ClamAV yang dipatok digest, membuktikan sampel bersih dan EICAR sebelum serta sesudah restart container.
- [x] Unggah massal menyimpan batch/item secara durable; ekstraksi memakai text layer bila tersedia dan OCR citra nyata untuk PDF hasil pindai, dengan batas fail-closed pada ukuran, halaman, piksel, waktu, serta hasil teks.
- [x] Setiap item OCR mengambil lease kapasitas global dari PostgreSQL sebelum diproses, memperpanjangnya berkala berdasarkan pasangan item/token selama unduh dan Tesseract, lalu melepasnya dengan token di blok `finally`; database tidak dikunci selama Tesseract berjalan. Commit hasil juga dipagari oleh claim item (`status` + `processing_started_at`) agar worker lama tidak dapat menimpa hasil claim baru. Kapasitas penuh mengembalikan `503` dan `Retry-After` tanpa menandai item gagal, sedangkan lease proses yang mati dapat diambil kembali setelah kedaluwarsa.
- [ ] Deploy clamd dan worker sebagai proses persisten pada jaringan privat; jangan mengandalkan `setInterval` dalam fungsi Vercel/serverless. Uji EICAR, timeout, scanner mati, objek hilang, hash mismatch, dan restart worker.
- [ ] Pastikan jaringan `scanner` tetap internal, jaringan `clamav-updates` memiliki egress untuk FreshClam, batas stream clamd sama dengan `CLAMAV_MAX_STREAM_BYTES`, image memakai digest yang disetujui, resource/log limit aktif, dan shutdown grace period lebih panjang dari deadline shutdown internal worker 30 detik; verifikasi klaim stale pulih secara fail-closed setelah penghentian paksa.
- [ ] Terbitkan worker hanya melalui workflow rilis tanpa auto-deploy, simpan provenance dan SBOM-nya, lalu jalankan `preflight-worker-image.sh` terhadap referensi `registry/repository@sha256:<digest>` sebelum setiap `pull` dan rollout produksi.
- [ ] Uji model OCR `ind+eng` dari `OCR_TESSDATA_PATH` pada image/artifact produksi, termasuk PDF scan maksimal 10 halaman, dokumen tanpa teks bermakna, timeout unduh Blob 30 detik, restart proses, konsumsi CPU/memori, cleanup cache, saturasi lintas replica, penghormatan `Retry-After`, renewal/reklamasi lease, serta penolakan hasil worker stale. Handler Vercel menetapkan `maxDuration=300` detik: 30 detik text-layer + 180 detik scan OCR + 30 detik unduh Blob + 60 detik margin cold-start/database/cleanup; pastikan plan/runtime deployment mendukung nilai tersebut. Kalibrasi `ocr_capacity_control.max_concurrency` hanya melalui perubahan operasional database yang diaudit dan uji beban; jangan membuat override berbeda pada tiap instance. Metadata hasil OCR wajib ditinjau manusia sebelum dikonfirmasi.
- [ ] Terapkan private object access, encryption-at-rest yang didukung platform, least privilege, lifecycle, backup, dan pemisahan admin.
- [ ] **Kondisional — hardening storage:** integrasikan content disarm/DLP, KMS/HSM khusus, versioning, dan object lock/WORM bila kelas data, kebijakan, atau keputusan risiko mensyaratkannya; simpan bukti konfigurasi dan uji.
- [ ] Uji QC 300 DPI kertas, 400 DPI kartografis, 600 DPI foto, 24-bit; kalibrasi alat dan lakukan sampling visual.
- [ ] Tetapkan format preservasi, misalnya PDF/A/TIFF sesuai kebijakan yang disahkan; jangan hanya mengganti ekstensi.
- [ ] Jadwalkan fixity check; alert dan karantina jika hash berbeda; catat investigasi serta pemulihan dari replika bersih.
- [ ] Simpan versi lama ketika migrasi/konversi; dokumentasikan tool/version, parameter, hash sumber/hasil, operator, waktu, dan validasi.

## 9. Akses, kerahasiaan, dan audit

- [ ] Petakan role ke jabatan/mandat; lakukan joiner-mover-leaver review dan recertification akses berkala.
- [x] Workflow aplikasi menyediakan permohonan per-rekod, tujuan akses, approver terpisah, mode tayang/unduh/kelola, masa berlaku maksimal 30 hari, pencabutan, dan audit penggunaan. Grant tayang/unduh tidak memberi hak mutasi.
- [x] Workflow persetujuan internal surat keluar mencatat pengaju, penyetuju aktif, keputusan, catatan, dan riwayat; self-approval ditolak, surat pending/disetujui terkunci dari edit/hapus, dan pengarsipan hanya tersedia setelah persetujuan final. Workflow ini bukan tanda tangan elektronik BSrE/PSrE.
- [ ] Uji matriks pembuat–penyetuju pada setiap unit: pengajuan draft/ditolak, antrean penyetuju yang ditunjuk, persetujuan/penolakan, pengajuan ulang, larangan self-approval, penolakan akses lintas unit, serta larangan edit/hapus/arsip pada status yang tidak sesuai.
- [ ] Hubungkan workflow tersebut dengan register clearance personal, jabatan/penugasan resmi, matriks pejabat approver, SLA, notifikasi, recertification, dan pencabutan otomatis saat mutasi pegawai.
- [ ] Tambahkan watermark pengguna/waktu/tujuan dan kontrol print/export untuk Terbatas/Rahasia/Sangat Rahasia.
- [ ] Pastikan respons tidak membedakan “tidak ada” dari “tidak berwenang” pada object sensitif.
- [ ] Lindungi audit dari perubahan tidak berwenang; batasi admin, tetapkan retensi, backup, sinkronisasi waktu, dan alert dasar untuk akses massal, lintas unit, gagal login, perubahan role, legal hold, export, dan penghapusan.
- [ ] **Kondisional — WORM/SIEM:** kirim audit ke penyimpanan WORM dan/atau SIEM/SOC bila diwajibkan kebijakan atau hasil asesmen risiko.
- [ ] Tetapkan retensi audit; uji korelasi actor, session, IP/device, record, action, waktu, alasan, hasil, dan request ID.
- [ ] Verifikasi mutasi kritis memakai audit transaksional/fail-closed dan pastikan tidak ada jalur kritis baru yang kembali memakai audit best-effort.

## 10. Retensi, legal hold, dan penyusutan

- [ ] Arsiparis memasukkan jenis/label/tanggal/bukti pemicu dan versi/rujukan JRA; reviewer memvalidasi sampling dan pengecualian setiap item JRA.
- [ ] Jangan menghitung retensi rekod legacy dari tanggal arsip bila norma menetapkan peristiwa lain.
- [ ] Pastikan legal hold aktif mengeluarkan arsip dari seluruh daftar/transisi penyusutan dan menghasilkan notifikasi.
- [ ] Uji separation of duties: creator/proposer/reviewer/approver/executor harus berbeda sesuai kebijakan.
- [ ] Untuk pemusnahan, buat daftar, persetujuan, berita acara, saksi, hash/identifier, dan bukti bahwa seluruh salinan, cache, replika, serta backup yang jatuh tempo telah ditangani sesuai kebijakan.
- [ ] Untuk penyerahan permanen, uji paket metadata/bitstream, checksum manifest, media/kanal, tanda terima, dan rekonsiliasi dengan ANRI.

## 11. Integrasi kondisional SRIKANDI

Lewati aktivasi pada bagian ini bila SRIKANDI tidak diwajibkan. Kontrol gagal-tertutup dan feature flag nonaktif tetap harus dipertahankan.

- [x] Tanda tangan elektronik berada di luar ruang lingkup; endpoint legacy tidak membuat `MOCK-SIG`, tetap gagal-tertutup, dan artefak simulasi selalu dianggap tidak sah.
- [ ] **Kondisional — SRIKANDI:** gunakan sandbox; uji idempotency, retry, dead-letter, timeout, perubahan skema, dan rekonsiliasi sesuai kontrak resmi.
- [x] Fondasi outbox durable, snapshot versi kontrak, audit append-only, idempotency/hash conflict, lease recovery, retry/backoff/dead-letter, bounded response streaming, validasi ACK + remote ID, dan worker persisten tersedia serta disabled-by-default.
- [ ] **Kondisional — SRIKANDI:** deploy worker pada runtime persisten; endpoint HTTP pemrosesan antrean hanya fallback diagnostik satu item.
- [ ] **Kondisional — SRIKANDI:** simpan mapping ID SIMSA–SRIKANDI serta bukti sinkronisasi; hindari duplikasi nomor registrasi resmi.
- [ ] **Kondisional — SRIKANDI:** definisikan operasi saat layanan tidak tersedia dan batas waktu rekonsiliasi setelah pulih.

## 12. Backup, restore, dan observabilitas

- [ ] Terapkan strategi 3-2-1 untuk database, private object, audit, dan konfigurasi, serta material KMS bila digunakan; pastikan semuanya dapat dipulihkan secara sah.
- [ ] Enkripsi backup tanpa file plaintext sementara, pisahkan akun/credential backup dari akun aplikasi, simpan key di luar GitHub untuk pemulihan, catat checksum artifact, dan pantau kegagalan job.
- [ ] **Kondisional — immutable backup:** terapkan immutable retention/object lock pada backup bila diwajibkan kebijakan atau keputusan risiko.
- [ ] Lakukan restore drill end-to-end; cek konsistensi database–bitstream, hash, legal hold, dan audit, serta mapping integrasi bila digunakan.
- [ ] Ukur serta setujui RPO/RTO berdasarkan hasil drill, bukan nilai asumsi.
- [ ] Monitor availability, latency, error rate, failed login, AV, fixity, capacity, backup, dan restore; sertakan queue integrasi, DLP, KMS, dan certificate expiry bila kapabilitas tersebut digunakan.
- [ ] Uji incident response untuk kebocoran URL publik, malware, kehilangan object, hash mismatch, akses lintas unit, dan kompromi akun admin.

## 13. Smoke test dan bukti penerimaan

- [ ] Pengguna tanpa provisioning ditolak; staff tanpa unit ditolak.
- [ ] Pengguna unit A tidak dapat membaca, mengubah, mengunduh, mengekspor, atau menebak ID milik unit B.
- [ ] Kelas Rahasia/Sangat Rahasia fail-closed sampai clearance/approval tersedia.
- [ ] File private tidak dapat diakses dengan URL publik atau tanpa sesi; view/download tercatat dan tidak di-cache.
- [ ] Hasil digitasi di bawah DPI/24-bit gagal QC dan tidak dapat diverifikasi.
- [ ] Perubahan bitstream menghasilkan hash mismatch dan alert.
- [ ] Arsip tanpa bukti pemicu atau dengan legal hold tidak menjadi kandidat penyusutan.
- [ ] Arsip `legacy_unverified` tidak menjadi kandidat penyusutan; rekonsiliasi menambah revisi snapshot dan tidak menimpa bukti lama.
- [ ] Versi aturan aktif tidak dapat diedit; aktivasi draft menutup versi sebelumnya dan registrasi baru memakai tepat versi aktif terbaru.
- [ ] PDF sumber edisi baru tersimpan pada private Blob di namespace draft, SHA-256/jumlah halaman berasal dari server refetch, locator tidak bocor melalui API, dan objek hilang/berukuran salah ditolak.
- [ ] Kode klasifikasi cetak yang sama tetap dibedakan berdasarkan ID/identitas baris sumber.
- [ ] Pelaku yang sama tidak dapat melewati separation-of-duties.
- [ ] Logout, session expiry, dan perubahan role membersihkan data lokal serta mencabut sesi.
- [ ] **Kondisional — SRIKANDI:** layanan menerima tepat satu transaksi untuk retry yang sama dan rekonsiliasi menunjukkan nol selisih yang tidak dijelaskan.
- [ ] Restore drill mengembalikan database, bitstream, hash, akses, audit, dan mapping integrasi secara konsisten.

## 14. Strategi rollback

Migrasi `0010` sampai `0029` pada umumnya bersifat aditif, tetapi rollback dengan `DROP COLUMN`/`DROP TABLE` berisiko menghapus bukti legal hold, hash, koreksi tunjuk silang, keputusan akses, audit integrasi, versi aturan, appraisal/penyusutan, penyerahan permanen, lease Blob/OCR, batch ingest, heartbeat, snapshot keputusan, profil pengguna, klasifikasi keamanan surat keluar, atau constraint mandat unit. Karena itu:

1. **Sebelum cutover dan belum ada write baru:** batalkan deploy aplikasi; bila migrasi gagal, pulihkan database ke branch/snapshot pra-migrasi dan verifikasi checksum/count.
2. **Sesudah cutover tetapi belum ada data bermakna:** arahkan trafik ke maintenance, pulihkan snapshot ke environment baru, validasi, lalu switch connection secara terkontrol.
3. **Sesudah ada write produksi:** jangan menjalankan down migration destruktif. Pertahankan kolom, lakukan forward-fix, atau pulihkan ke branch baru lalu rekonsiliasi perubahan dengan prosedur yang disetujui pemilik data.
4. **Blob legacy:** jangan mengubah object private baru menjadi publik. Gunakan manifest untuk mengembalikan pointer hanya bila object lama masih utuh dan disetujui; gateway terautentikasi tetap dipertahankan.
5. **Connector SRIKANDI bila diaktifkan:** hentikan worker melalui feature flag, biarkan outbox/dead-letter utuh, lalu rekonsiliasi sebelum melanjutkan; jangan menghapus pesan gagal.

Kriteria rollback wajib: akses lintas unit, object menjadi publik, migrasi/hash tidak konsisten, audit kritis hilang, legal hold dapat dilewati, atau AV gagal tertutup. Ketidakcocokan data SIMSA–SRIKANDI juga menjadi kriteria rollback bila connector tersebut diaktifkan.

## 15. Persetujuan akhir

- [ ] Product owner Ditjen PTPP
- [ ] Unit Pengolah
- [ ] Unit Kearsipan Kementerian ATR/BPN
- [ ] Keamanan informasi atau fungsi pemilik risiko
- [ ] DPO atau fungsi pelindungan data
- [ ] DBA dan storage owner; KMS owner bila digunakan
- [ ] **Kondisional:** pengelola SRIKANDI bila connector diaktifkan
- [ ] **Kondisional:** ANRI/asistensi yang relevan bila diwajibkan scope atau kebijakan

Tanpa bukti dan persetujuan untuk scope yang dipilih, label yang tepat adalah **“aplikasi internal dengan kontrol yang telah diuji terbatas”**, bukan “tersertifikasi” atau “sepenuhnya patuh”.
