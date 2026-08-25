# Checklist Deployment Profil Internal SIMSA

## 1. Prinsip rilis

Checklist ini adalah gerbang operasional untuk profil aplikasi internal, bukan checklist sertifikasi atau pernyataan kepatuhan penuh. Permen ATR/BPN Nomor 2 Tahun 2026 dan ketentuan ANRI digunakan sebagai rujukan desain. Lulus build atau unit test tidak sama dengan kesiapan operasional. Setiap butir yang berlaku harus memiliki pemilik, bukti, tanggal, lingkungan, dan pemberi persetujuan.

Gunakan [Profil Aplikasi Internal SIMSA](PROFIL_APLIKASI_INTERNAL.md) untuk menetapkan scope. Butir tanpa label adalah baseline internal. Butir berlabel **Kondisional** hanya menjadi gerbang bila fitur, kelas data, kebijakan internal, atau keputusan risiko terkait diaktifkan.

Gunakan empat keputusan rilis:

- **GO Terbatas**: hanya data sintetis atau arsip Biasa/Terbuka yang disetujui;
- **GO Internal**: baseline keamanan, backup/restore, dan pemantauan untuk scope internal telah diterima; integrasi kondisional yang belum siap tetap nonaktif;
- **GO Integrasi Kondisional**: selain baseline internal, seluruh dependensi dan bukti uji untuk integrasi atau kelas data yang dipilih telah diterima; atau
- **NO-GO**: ada migrasi gagal, blob publik tidak terkendali, AV belum memblokir file berbahaya, restore gagal, akses lintas unit, audit hilang, atau tanda tangan mock aktif.

SIMSA merupakan aplikasi internal/substantif Ditjen PTPP, bukan pengganti SRIKANDI dan bukan produk yang telah disertifikasi. Konektor SRIKANDI, BSrE/PSrE, WORM, dan SIEM bersifat opsional/deferred kecuali kebijakan internal mewajibkannya.

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
- [ ] Jalankan SAST, SCA/dependency scan, secret scan, IaC scan, dan pentest; seluruh temuan kritis/tinggi ditutup atau diterima tertulis.
- [ ] Pastikan tidak ada secret di Git, artifact, log, source map, browser bundle, atau file test.
- [x] Utilitas test di working tree membaca kredensial dari environment dan menolak berjalan tanpa konfigurasi eksplisit.
- [ ] Rotasi/nonaktifkan akun test, API key, dan proxy credential yang pernah tersimpan pada riwayat Git; perubahan working tree tidak mencabut secret yang sudah terekspos.
- [ ] Dokumentasikan penerimaan risiko sementara untuk advisory `image-size` pada pipeline build Docusaurus (belum ada patch upstream); hanya proses image yang berasal dari repositori tepercaya dan jangan menjalankan build pada input tidak tepercaya.
- [ ] Tinjau empat advisory moderat `esbuild` pada rantai tooling `drizzle-kit`/`tsx`; jangan mengekspos development server, isolasi runner build, dan pantau perbaikan upstream. Jangan memakai `npm audit fix --force` yang menurunkan `drizzle-kit` secara breaking tanpa pengujian migrasi penuh.
- [ ] Gunakan custom same-site domain, misalnya frontend dan API berada di subdomain dari domain institusi yang sama.
- [ ] Set `NODE_ENV=production`, `BETTER_AUTH_URL`, `FRONTEND_URL`, `ADDITIONAL_TRUSTED_ORIGINS`, `COOKIE_DOMAIN`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, OAuth, dan token blob melalui secret manager; jangan commit nilainya.
- [ ] Untuk profil inti, tetapkan backend `APP_PROFILE=internal` dan `SRIKANDI_ENABLED=false`, lalu build frontend dengan `VITE_APP_PROFILE=internal` dan `VITE_FEATURE_SRIKANDI=false`.
- [ ] Pastikan OAuth redirect URI, cookie `Secure`/`HttpOnly`/`SameSite`, CORS allow-list, CSRF, HSTS, CSP, rate limit, dan idle/session expiry diuji dari browser sasaran.
- [ ] Pastikan pendaftaran publik mati, role tidak dapat diisi klien, provisioning hanya oleh admin berwenang, dan perubahan role/unit/status mencabut sesi.
- [ ] Pastikan akun break-glass memakai MFA, disegel, dimonitor, dan diuji; tidak dipakai untuk kegiatan harian.
- [ ] Sinkronkan waktu server, database, storage, IdP, sistem log/pemantauan, dan perangkat pemindaian ke sumber waktu institusi; sertakan SIEM bila digunakan.

## 4. Backup pra-migrasi

- [ ] Buat snapshot/PITR database dan `pg_dump` terenkripsi; uji restore ke lingkungan terisolasi.
- [ ] Ekspor inventaris seluruh object: URL/key, ukuran, MIME, SHA-256 bila ada, entity, kelas keamanan, access mode, dan version ID.
- [ ] Backup konfigurasi, kebijakan IAM/storage, serta audit; simpan terpisah dari production account. Sertakan mapping SRIKANDI dan material KMS bila kapabilitas tersebut digunakan.
- [ ] Catat waktu cut-off dan batasi write selama langkah yang memerlukan konsistensi.
- [ ] Verifikasi bahwa backup mencakup database **dan bitstream**; backup database saja tidak cukup.

## 5. Migrasi database 0010 sampai 0014

Migrasi yang harus berurutan:

1. `backend/src/db/migrations/0010_retention_trigger_legal_hold.sql`
2. `backend/src/db/migrations/0011_private_bitstream_fixity.sql`
3. `backend/src/db/migrations/0012_traceable_cross_reference_cancellation.sql`
4. `backend/src/db/migrations/0013_srikandi_durable_outbox.sql`
5. `backend/src/db/migrations/0014_purpose_bound_record_access.sql`

`0010` menambahkan pemicu retensi berbasis peristiwa, bukti/versi/rujukan JRA, legal hold, constraint, dan indeks kandidat. Migrasi ini sengaja **tidak** mengisi pemicu dari `tanggal_arsip`; rekod legacy tetap tidak layak menjadi kandidat penyusutan sampai arsiparis memasukkan bukti peristiwa yang sah.

`0011` menambahkan baseline SHA-256 dan status bitstream, relasi arsip elektronik ke lampiran, kode registrasi/QC/immutability, serta pelaku proposed/reviewed/executed. Migrasi menandai seluruh locator legacy sebagai `storage_access='public'` kecuali hostname secara eksplisit menunjukkan Vercel private storage; penandaan tersebut bukan migrasi fisik ke private storage.

`0012` mengganti penghapusan permanen tunjuk silang dengan pembatalan yang menyimpan pelaku, waktu, dan alasan. Migrasi sengaja berhenti bila terdapat hubungan aktif duplikat agar rekonsiliasi provenans dilakukan sebelum unique index diterapkan.

`0013` menambahkan outbox SRIKANDI durable, snapshot versi kontrak, status retry/dead-letter, idempotency, bukti respons resmi, dan audit append-only. Tabel tersebut belum mengaktifkan pengiriman; outbound tetap memerlukan kontrak dan konfigurasi resmi.

`0014` menambahkan permohonan akses per-rekod dengan tujuan, klasifikasi, mode tayang/unduh/kelola, keputusan, kedaluwarsa, dan pencabutan. Unique index mencegah permohonan atau grant aktif ganda untuk pengguna dan rekod yang sama.

Langkah eksekusi:

- [ ] Cocokkan `backend/src/db/migrations/meta/_journal.json` dengan kelima file SQL dan pastikan tidak ada migration ID ganda.
- [ ] Uji kelima migrasi pada salinan production yang telah dianonimkan; catat durasi, lock, ukuran indeks, dan error.
- [ ] Jalankan preflight duplikasi `(arsip_id, versi_dokumen)`. Migrasi `0011` sengaja berhenti bila data legacy ambigu; rekonsiliasi provenans bersama arsiparis dan jangan melakukan auto-renumber.
- [ ] Jalankan preflight hubungan tunjuk silang aktif duplikat. Migrasi `0012` juga sengaja berhenti sampai duplikasi direkonsiliasi dan keputusannya dicatat.
- [ ] Jalankan dari direktori `backend` dengan `npm run db:migrate`; jangan memakai `db:push` untuk produksi terkontrol.
- [ ] Verifikasi kolom, foreign key, check constraint, unique/partial index, dan entri jurnal migrasi.
- [ ] Pastikan rekod legacy memiliki `retention_trigger_date IS NULL` dan tidak muncul sebagai kandidat penyusutan.
- [ ] Pastikan objek dengan URL publik ditandai `storage_access='public'`, bukan dianggap private.
- [ ] Jalankan smoke test create/read/update, upload/download, QC/fixity, legal hold, kandidat retensi, dan seluruh transisi penyusutan.

## 6. Urutan rollout aplikasi

1. Aktifkan maintenance window atau kontrol write yang disetujui.
2. Ambil backup dan bukti restore.
3. Jalankan migrasi `0010`, `0011`, `0012`, `0013`, lalu `0014`.
4. Deploy backend baru dan lakukan health check internal.
5. Deploy frontend baru; invalidasi asset cache, tetapi jangan cache respons `/api/*`.
6. Verifikasi provisioning super admin, role, unit kerja, isolasi lintas unit, dan sesi yang dicabut setelah perubahan otorisasi.
7. Verifikasi file baru tersimpan private dan hanya dapat diambil melalui `/api/files/...` dengan audit serta header `no-store`.
8. Migrasikan blob publik legacy sesuai Bagian 7.
9. **Kondisional — SRIKANDI:** deploy worker persisten dan aktifkan connector hanya setelah uji sandbox serta rekonsiliasi lulus; jika tidak diwajibkan, pertahankan outbound nonaktif.
10. Buka pilot terbatas; pantau error, audit, AV, fixity, storage, dan database, serta queue integrasi bila diaktifkan.

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
- [ ] Deploy clamd dan worker sebagai proses persisten pada jaringan privat; jangan mengandalkan `setInterval` dalam fungsi Vercel/serverless. Uji EICAR, timeout, scanner mati, objek hilang, hash mismatch, dan restart worker.
- [ ] Terapkan private object access, encryption-at-rest yang didukung platform, least privilege, lifecycle, backup, dan pemisahan admin.
- [ ] **Kondisional — hardening storage:** integrasikan content disarm/DLP, KMS/HSM khusus, versioning, dan object lock/WORM bila kelas data, kebijakan, atau keputusan risiko mensyaratkannya; simpan bukti konfigurasi dan uji.
- [ ] Uji QC 300 DPI kertas, 400 DPI kartografis, 600 DPI foto, 24-bit; kalibrasi alat dan lakukan sampling visual.
- [ ] Tetapkan format preservasi, misalnya PDF/A/TIFF sesuai kebijakan yang disahkan; jangan hanya mengganti ekstensi.
- [ ] Jadwalkan fixity check; alert dan karantina jika hash berbeda; catat investigasi serta pemulihan dari replika bersih.
- [ ] Simpan versi lama ketika migrasi/konversi; dokumentasikan tool/version, parameter, hash sumber/hasil, operator, waktu, dan validasi.

## 9. Akses, kerahasiaan, dan audit

- [ ] Petakan role ke jabatan/mandat; lakukan joiner-mover-leaver review dan recertification akses berkala.
- [x] Workflow aplikasi menyediakan permohonan per-rekod, tujuan akses, approver terpisah, mode tayang/unduh/kelola, masa berlaku maksimal 30 hari, pencabutan, dan audit penggunaan. Grant tayang/unduh tidak memberi hak mutasi.
- [ ] Hubungkan workflow tersebut dengan register clearance personal, jabatan/penugasan resmi, matriks pejabat approver, SLA, notifikasi, recertification, dan pencabutan otomatis saat mutasi pegawai.
- [ ] Tambahkan watermark pengguna/waktu/tujuan dan kontrol print/export untuk Terbatas/Rahasia/Sangat Rahasia.
- [ ] Pastikan respons tidak membedakan “tidak ada” dari “tidak berwenang” pada object sensitif.
- [ ] Lindungi audit dari perubahan tidak berwenang; batasi admin, tetapkan retensi, backup, sinkronisasi waktu, dan alert dasar untuk akses massal, lintas unit, gagal login, perubahan role, legal hold, export, dan penghapusan.
- [ ] **Kondisional — WORM/SIEM:** kirim audit ke penyimpanan WORM dan/atau SIEM/SOC bila diwajibkan kebijakan atau hasil asesmen risiko.
- [ ] Tetapkan retensi audit; uji korelasi actor, session, IP/device, record, action, waktu, alasan, hasil, dan request ID.
- [ ] Ganti pola audit best-effort untuk aksi kritis dengan outbox/transaksi atau mekanisme fail-closed yang disepakati.

## 10. Retensi, legal hold, dan penyusutan

- [ ] Arsiparis memasukkan jenis/label/tanggal/bukti pemicu dan versi/rujukan JRA; reviewer memvalidasi sampling dan pengecualian setiap item JRA.
- [ ] Jangan menghitung retensi rekod legacy dari tanggal arsip bila norma menetapkan peristiwa lain.
- [ ] Pastikan legal hold aktif mengeluarkan arsip dari seluruh daftar/transisi penyusutan dan menghasilkan notifikasi.
- [ ] Uji separation of duties: creator/proposer/reviewer/approver/executor harus berbeda sesuai kebijakan.
- [ ] Untuk pemusnahan, buat daftar, persetujuan, berita acara, saksi, hash/identifier, dan bukti bahwa seluruh salinan, cache, replika, serta backup yang jatuh tempo telah ditangani sesuai kebijakan.
- [ ] Untuk penyerahan permanen, uji paket metadata/bitstream, checksum manifest, media/kanal, tanda terima, dan rekonsiliasi dengan ANRI.

## 11. Integrasi kondisional: tanda tangan elektronik dan SRIKANDI

Lewati aktivasi pada bagian ini bila fitur tidak diwajibkan. Kontrol gagal-tertutup dan feature flag nonaktif tetap harus dipertahankan.

- [x] Endpoint aplikasi tidak lagi membuat `MOCK-SIG`; penandatanganan gagal-tertutup sampai layanan tersertifikasi tersedia, dan artefak simulasi legacy selalu dianggap tidak sah.
- [ ] **Kondisional — tanda tangan resmi:** integrasikan BSrE/PSrE sebelum mengaktifkan penandatanganan elektronik.
- [ ] **Kondisional — tanda tangan resmi:** verifikasi sertifikat, rantai kepercayaan, OCSP/CRL, waktu tanda tangan, identitas penanda tangan, integritas dokumen, dan long-term validation.
- [ ] **Kondisional — SRIKANDI:** gunakan sandbox; uji idempotency, retry, dead-letter, timeout, perubahan skema, dan rekonsiliasi sesuai kontrak resmi.
- [x] Fondasi outbox durable, snapshot versi kontrak, audit append-only, idempotency/hash conflict, lease recovery, retry/backoff/dead-letter, bounded response streaming, validasi ACK + remote ID, dan worker persisten tersedia serta disabled-by-default.
- [ ] **Kondisional — SRIKANDI:** deploy worker pada runtime persisten; endpoint HTTP pemrosesan antrean hanya fallback diagnostik satu item.
- [ ] **Kondisional — SRIKANDI:** simpan mapping ID SIMSA–SRIKANDI serta bukti sinkronisasi; hindari duplikasi nomor registrasi resmi.
- [ ] **Kondisional — SRIKANDI:** definisikan operasi saat layanan tidak tersedia dan batas waktu rekonsiliasi setelah pulih.

## 12. Backup, restore, dan observabilitas

- [ ] Terapkan strategi 3-2-1 untuk database, private object, audit, dan konfigurasi, serta material KMS bila digunakan; pastikan semuanya dapat dipulihkan secara sah.
- [ ] Enkripsi backup, pisahkan akun/credential backup, dan pantau kegagalan job.
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
- [ ] Pelaku yang sama tidak dapat melewati separation-of-duties.
- [ ] Logout, session expiry, dan perubahan role membersihkan data lokal serta mencabut sesi.
- [ ] **Kondisional — SRIKANDI:** layanan menerima tepat satu transaksi untuk retry yang sama dan rekonsiliasi menunjukkan nol selisih yang tidak dijelaskan.
- [ ] Restore drill mengembalikan database, bitstream, hash, akses, audit, dan mapping integrasi secara konsisten.

## 14. Strategi rollback

Migrasi `0010` sampai `0014` bersifat aditif, tetapi rollback dengan `DROP COLUMN`/`DROP TABLE` berisiko menghapus bukti legal hold, hash, koreksi tunjuk silang, keputusan akses, audit integrasi, atau pelaku workflow. Karena itu:

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
- [ ] **Kondisional:** BSrE/PSrE bila tanda tangan/segel resmi diaktifkan
- [ ] **Kondisional:** ANRI/asistensi yang relevan bila diwajibkan scope atau kebijakan

Tanpa bukti dan persetujuan untuk scope yang dipilih, label yang tepat adalah **“aplikasi internal dengan kontrol yang telah diuji terbatas”**, bukan “tersertifikasi” atau “sepenuhnya patuh”.
