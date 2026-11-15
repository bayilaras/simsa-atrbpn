# Kondisi produksi saat ini

Halaman ini adalah titik awal bagi siapa pun yang mengoperasikan SIMSA: apa yang berjalan di mana, jadwal pekerjaan otomatis, apa yang dipantau, di mana bukti tersimpan, dan peran siapa yang dapat bertindak. Bila terjadi gangguan, buka [buku saku insiden](BUKU_SAKU_INSIDEN.md).

Perbarui halaman ini setiap kali ada rilis, perubahan jadwal, atau perubahan akun. Bila isinya berbeda dengan berkas konfigurasi di repositori (`.github/workflows/`, `backend/vercel.json`, `frontend/vercel.mjs`), berkas konfigurasi yang berlaku; perbaiki halaman ini. Repositori bersifat publik: jangan menulis nama host database, ID project atau deployment, nilai rahasia, maupun nama orang di sini.

**Per 13 November 2026:** produksi menjalankan backend C75 dan frontend C68 dari `main` `8abfdf7`. Journal database berisi 54 migrasi, terakhir `0053_list_audit_attachment_indexes`. Laporan rilis disimpan di [`docs/rilis/`](rilis/README.md). Laporan C75/C68 (`HASIL_RILIS_C75_C68_2026-11-13.md`) diajukan lewat pull request tersendiri dan baru ada di folder itu setelah pull request tersebut digabung.

## Apa yang berjalan di mana

| Bagian | Tempat | Keterangan |
|---|---|---|
| Aplikasi web | Vercel (paket Pro), proyek `simsa-frontend`, https://simsa-frontend.vercel.app | Meneruskan `/api`, `/health`, dan `/ready` ke backend. Staf hanya memakai alamat ini. |
| API | Vercel, proyek `simsa-backend`, region `sin1`, https://simsa-backend.vercel.app | Fungsi utama `api/index.js`. Merge ke `main` tidak men-deploy otomatis; rilis selalu berupa kandidat tanpa domain yang lalu dipromosikan. |
| Pemindai antivirus | ClamAV native di fungsi `api/internal-malware-scan.js` pada proyek backend (batas 300 detik per pemanggilan) | Berjalan sesuai permintaan (`MALWARE_SCAN_WORKER_RUNTIME=on-demand`), tidak ada server pemindai yang selalu hidup. Lihat [operasi antivirus](OPERASI_ANTIVIRUS_BITSTREAM.md). |
| Database | Neon PostgreSQL 18, endpoint langsung (bukan `-pooler`), TLS `verify-full` | Login aplikasi: `simsa_api` (API), `simsa_worker` (pemindai dan pemeriksaan integritas), `simsa_backup` (baca saja, untuk backup), `simsa_migration` (migrasi). `neondb_owner` hanya untuk operator. Rinciannya di [runbook kredensial](RUNBOOK_KREDENSIAL_DATABASE.md#peran-database). |
| Berkas digital | Vercel Blob, store privat yang tersambung ke proyek backend | Berkas hanya dibuka lewat backend setelah izin, pemindaian, dan hash diperiksa. Status backup juga disimpan di store ini. |
| Login | Better Auth: email dan kata sandi, serta Google | Email tidak dikirim di produksi. Kata sandi yang lupa diatur ulang oleh Super Admin. |
| Situs panduan | Vercel, proyek `simsa-atrbpn`, https://simsa-atrbpn.vercel.app | Dipublikasikan manual dari sumber rilis yang sama. |
| Pekerjaan terjadwal | GitHub Actions di repositori ini dan Vercel Cron | Lihat [jadwal](#jadwal-pekerjaan-otomatis). |
| Rilis | Jalur manual dari workstation operator, sesuai [prosedur rilis](RUNBOOK_KREDENSIAL_DATABASE.md#prosedur-rilis) | Workflow `release-vercel.yml` (dengan persetujuan peninjau dan rollback otomatis) sudah tersedia, tetapi rilis sejauh ini memakai jalur manual (celah 5 di runbook). Uji keringnya dijelaskan di [serah terima operator](SERAH_TERIMA_OPERATOR.md#menjalankan-rilis-uji-kering). |

## Jadwal pekerjaan otomatis

WIB = UTC+7. Jadwal GitHub Actions bersifat *best-effort*: run sering dimulai terlambat beberapa jam, dan sesekali dilewati.

| Pekerjaan | Jadwal | Dijalankan oleh | Hasil dan bukti |
|---|---|---|---|
| Backup database dan dokumen, lalu uji pulih ke cluster terpisah (`operations-recovery.yml`) | Sekali sehari, sekitar 22:30 WIB | GitHub Actions, environment `production-recovery` | Artefak terenkripsi `simsa-recovery-*` (14 hari), status di Blob privat, kartu backup di panel |
| Pemeriksaan integritas berkas (`operations-fixity.yml`) | Terjadwal di workflow; batch dan jadwal persisnya tercantum di berkas itu | GitHub Actions, environment `production-integrity`; hanya bila variabel `OPERATIONS_FIXITY_ENABLED` = `true` | Artefak `simsa-file-integrity-*` (90 hari), kartu integritas di panel |
| Monitor operasional (`operations-monitor.yml`) | Tiap jam pada menit ke-17, *best-effort*: tidak setiap jam benar-benar berjalan | GitHub Actions, environment `production-monitor` | Run hijau atau merah; isu GitHub bila gagal |
| Membangunkan pemindai | 03:07, 07:07, 11:07, 15:07, 19:07, 23:07 UTC (10:07, 14:07, 18:07, 22:07, 02:07, 06:07 WIB) | Vercel Cron di `backend/vercel.json` | Status pemindai di panel |
| Membersihkan unggahan langsung yang tidak jadi disimpan | Terjadwal otomatis; jadwalnya di berkas konfigurasi cron | Cron produksi | Lease kedaluwarsa dibersihkan; lihat [rekonsiliasi unggahan](BLOB_UPLOAD_RECONCILIATION.md) |
| Pembaruan dependensi | Mingguan, Senin 02:00 WIB | Dependabot (`.github/dependabot.yml`) | Pull request |
| Pemeriksaan kode | Setiap pull request dan push | `ci.yml` | Status check pada PR |

Selain jadwal, pemindai juga dibangunkan oleh setiap unggahan, tombol **Lanjutkan pemeriksaan** pada berkas yang menunggu, dan run monitor. Cron dan monitor membangunkan pemindai bila verifikasi definisinya hilang atau tersisa kurang dari 13 jam, atau bila ada berkas yang sudah menunggu pemindaian lebih dari 10 menit.

## Apa yang dipantau

Super Admin membuka **Administrasi → Monitoring Operasional**. Halaman itu memperbarui status setiap menit selama dibuka. Super Admin juga melihat penanda status operasi di aplikasi tanpa harus membuka halaman tersebut. Probe untuk monitor (`/api/operations/probe`) memakai pemeriksaan yang sama dan menjawab 503 bila ada pemeriksaan yang tidak sehat; pemeriksaan berstatus **Tidak diaktifkan** tidak dihitung.

| Kartu di panel | Sehat bila | Perlu perhatian atau Gagal bila |
|---|---|---|
| Database | Koneksi dan struktur database siap | Pemeriksaan database gagal |
| Penyimpanan dokumen | Store privat dapat diakses. Hasil probe yang lulus dipakai ulang paling lama 10 menit. | Store privat tidak dapat diakses atau belum dikonfigurasi |
| Pemindai keamanan dokumen | Verifikasi mesin dan definisi virus masih berlaku | Siaga (perlu perhatian) atau verifikasi hilang/gagal (gagal) |
| Antrean pemindaian | Tidak ada berkas yang menunggu lebih dari 30 menit, gagal dipindai, atau terdeteksi berbahaya | Ada salah satunya |
| Integritas dokumen berkala | Tidak ada berkas rusak, pemeriksaan gagal, pemeriksaan ulang yang terlambat lebih dari 28 jam, atau berkas bersih yang belum terjadwal lebih dari 28 jam | Berkas rusak (gagal); hal lain (perlu perhatian) |
| Backup database dan dokumen | Backup terakhir berhasil, berumur kurang dari 36 jam, database dan dokumen terverifikasi | Gagal, lebih tua dari 36 jam, atau belum ada bukti |
| Uji pemulihan backup | Uji pulih terakhir berhasil dan berumur kurang dari 90 hari | Gagal, kedaluwarsa, atau belum ada bukti |

Label status di panel: **Sehat**, **Perlu perhatian**, **Gagal**, **Belum terverifikasi**, dan **Tidak diaktifkan**.

Bila run monitor atau run backup gagal (termasuk terhenti karena batas waktu), workflow membuka isu GitHub berjudul **Pemeriksaan operasional gagal**, atau menambah komentar pada isu yang masih terbuka. GitHub mengirim email kepada orang yang memantau repositori (*Watch → All Activity*, atau *Custom → Issues*). Workflow pemeriksaan integritas tidak membuka isu; kegagalannya terlihat di tab Actions dan di kartu integritas panel.

## Titik pulih dan jendela pemulihan

| Ukuran | Nilai | Dasar |
|---|---|---|
| Titik pulih dari backup (RPO) | **Sekitar 24 jam.** Bila satu run terlewat, bisa sampai sekitar 48 jam. | Backup berjalan sekali sehari. Surat dan PDF yang dicatat sesudah snapshot terakhir hanya dilindungi Neon dan Blob sampai snapshot berikutnya. Waktu snapshot terakhir tertera sebagai **Bukti terakhir** pada kartu backup di panel, dan di `BACA-SAYA.txt` hasil membuka backup. |
| Backup saat `main` memuat migrasi yang belum diterapkan | Backup tetap berjalan | Backup menerima database produksi yang tertinggal dari `main`, sehingga merge PR bermigrasi tidak lagi menghentikan backup sampai migrasinya diterapkan. |
| Jendela pemulihan titik waktu Neon (PITR) | **[ISI OLEH PEMILIK PROJECT NEON: … jam/hari; diperiksa tanggal …; oleh (peran) …]** | Ditetapkan pemilik project di Neon Console (pengaturan retensi riwayat). Jangan mengisi dari dugaan. |
| Waktu pemulihan layanan (RTO) | **[ISI SETELAH LATIHAN PERTAMA: … jam]** | Pemulihan ke project Neon baru belum pernah dilatih. Langkah dan catatan waktunya ada di [runbook pemulihan produksi](RUNBOOK_PEMULIHAN_PRODUKSI.md#catatan-waktu). |
| Masa simpan artefak backup di GitHub | 14 hari | `retention-days` di `operations-recovery.yml`. Salinan jangka panjang wajib diunduh ke penyimpanan kantor, lihat [masa simpan artefak](OPERATIONS_RECOVERY.md#masa-simpan-artefak). |
| Lokasi salinan backup bulanan di kantor | **[ISI OLEH PENGELOLA: media dan tempat penyimpanan]** | Tidak dapat diperiksa dari repositori. |

## Di mana bukti tersimpan

| Bukti | Tempat | Masa simpan |
|---|---|---|
| Status terkini semua pemeriksaan | Panel **Monitoring Operasional** | Selalu terbaru |
| Hasil setiap run backup, integritas, dan monitor | Tab Actions repositori: halaman run dan artefaknya | Artefak backup 14 hari, integritas 90 hari |
| Status backup dan uji pulih terakhir | Blob privat: `operations/recovery-status-v1.json` | Ditimpa setiap run |
| Bukti setiap percobaan backup | Blob privat: `operations/recovery-runs/<runId>.json` | Tidak ditimpa |
| Pemberitahuan kegagalan | Isu GitHub **Pemeriksaan operasional gagal** | Sampai isu ditutup |
| Laporan rilis | [`docs/rilis/`](rilis/README.md) | Permanen |
| Jejak tindakan pengguna dan alat operator | Menu **Audit Log** di aplikasi (tabel `audit_log`) | Permanen |
| Log permintaan | Vercel → proyek → Logs, dicari dengan `X-Request-ID` | Mengikuti paket Vercel |

## Siapa yang dapat bertindak

Halaman ini sengaja tidak memuat nama. Daftar nama dan nomor kontak untuk setiap peran disimpan di dokumen internal kantor. Setiap peran sebaiknya dipegang minimal dua orang; caranya ada di [serah terima operator](SERAH_TERIMA_OPERATOR.md).

| Peran | Dapat melakukan | Akses yang diperlukan |
|---|---|---|
| Super Admin aplikasi | Membaca panel monitoring, mengantre ulang berkas yang gagal dipindai, mengelola akun, mengatur ulang kata sandi | Akun SIMSA berperan Super Admin |
| Admin repositori GitHub | Mengubah secret, variabel, dan environment; mengaktifkan workflow | Peran Admin pada repositori |
| Operator workflow | Menjalankan workflow secara manual, mengunduh artefak, menutup isu | Minimal peran Write pada repositori |
| Peninjau rilis | Menyetujui environment `production` pada workflow rilis | Terdaftar sebagai *required reviewer* environment `production` |
| Pengelola Vercel | Mengubah Environment Variables Production, membuat kandidat, promosi dan rollback, membaca log, mengelola store Blob | Anggota tim Vercel dengan hak tersebut |
| Pemilik project Neon | Membuka Console, membuat branch atau pemulihan titik waktu, me-reset password `neondb_owner` | Akses ke project Neon produksi |
| Pemegang passphrase backup | Membuka artefak backup | Salinan `BACKUP_ENCRYPTION_PASSPHRASE` |
| Kasubbag TU (pemilik data) | Memutuskan pemulihan yang menghilangkan data, mengumumkan gangguan kepada staf | Tidak memerlukan akses teknis |
