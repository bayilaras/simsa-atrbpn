# Pemeliharaan otomatis — Dependabot, pemindai siaga, latensi Blob (21 Oktober 2026)

Catatan desain untuk branch `chore/pemeliharaan-otomatis`. Semua waktu UTC (WIB = UTC+7).
Produksi tidak diubah saat menyusun catatan ini; data diambil dari `/ready` publik, riwayat
run GitHub Actions publik, dan metadata store di Vercel API (baca saja).

## 1. Pembaruan dependensi (Dependabot)

**Pemicu.** Pada 21 Okt advisori GHSA baru (`vite`/`launch-editor`, `follow-redirects`)
menggagalkan job Security Audit untuk setiap PR dan harus ditambal manual di dalam PR fitur
(`5201b13`).

**Konfigurasi** (`.github/dependabot.yml`):

| Ekosistem | Direktori | Jadwal versi | Grup | Batas PR versi |
|---|---|---|---|---|
| npm | `/backend`, `/frontend` | Senin 02:00 WIB, mingguan | minor+patch → 1 PR | 3 |
| npm | `/spark`, `/docs-site` | tanggal 1, bulanan | minor+patch → 1 PR | 2 |
| GitHub Actions | `/` | Senin 02:00 WIB, mingguan | minor+patch → 1 PR | 2 |

- Spark dan docs-site ikut karena gerbang `npm-audit-gate.mjs` juga mengauditnya (advisori
  21 Okt mengenai docs-site). Uji `.github/scripts/dependabot-config.test.mjs` di job Security
  Audit gagal bila proyek baru masuk gerbang audit tanpa entri Dependabot.
- Pembaruan **keamanan** tidak digabung dan tidak terkena cooldown/jadwal: satu PR per advisori,
  batas tetap GitHub 10 PR terbuka. `ignore` sengaja tidak dipakai karena juga menahan PR keamanan.
- Versi **major** tetap PR tersendiri (perlu tinjauan perilaku); cooldown 5 hari untuk pembaruan
  versi memberi waktu rilis npm bermasalah ditarik.
- Lockfile `lockfileVersion: 3` diperbarui Dependabot; CI menjalankan `npm ci` dan gerbang audit
  yang sama. CI tidak memakai secret, jadi PR Dependabot (token baca-saja, tanpa secret Actions)
  menjalankan semua job.
- Override npm (`esbuild` 0.28.2 dan `uuid` 11.1.1 di backend, `path-to-regexp` di frontend, dst.)
  membatasi apa yang bisa dinaikkan Dependabot; advisori pada paket yang dioverride tetap harus
  ditambal manual (ubah override), seperti sebelumnya.

**Interaksi dengan proteksi `main`.** Setiap PR tetap butuh approve efanwahyu dan branch
*up to date*. Dependabot hanya me-rebase otomatis saat konflik; bila PR tertinggal `main`, komentar
`@dependabot rebase` (approve ulang diperlukan karena commit baru membatalkan approve).

## 2. Pemindai on-demand: mengapa `/ready` 503 setelah promosi atau ±24 jam

**Penyebab dari kode.**

1. Lease definisi 24 jam hanya hidup di `/tmp` instance fungsi `api/internal-malware-scan`
   (`NativeClamAvDefinitions.snapshot`). Instance dingin mulai dari definisi bawaan build:
   `prepare()` memakai `manifest.verifiedAt` (waktu build) sebagai awal lease. Wake setiap 12 jam
   hampir selalu mendarat di instance dingin.
2. Akibatnya, pada deployment berumur 11–24 jam setiap wake dingin mencoba Freshclam lebih awal
   (gagal = tidak fatal, lease tetap waktu-build + 24 jam), dan pada deployment berumur > 24 jam
   setiap wake/pemindaian dingin **wajib** mengunduh definisi dari `database.clamav.net`. Bila gagal,
   run mencatat heartbeat `degraded`.
3. `/ready` hanya membaca heartbeat terbaru. Satu run gagal menimpa lease yang masih berlaku dari run
   sebelumnya, dan run gagal di deployment lama tetap membuat deployment baru 503 sampai ada wake
   di deployment baru — padahal deployment baru membawa definisi bertanda tangan segar dari build
   dan bisa langsung memindai tanpa jaringan. Itu pola "503 setelah promosi, pulih setelah monitor
   manual" (C55, 20 Okt 13:51–13:53).
4. Pemicu wake jarang: dua Vercel Cron (03:07, 15:07, ±59 menit) memberi tepat satu percobaan di
   jendela refresh 13 jam; jadwal GitHub tiap jam hanya berjalan 4–6×/hari pada Oktober (run #87–#186).
   Riwayat monitor menunjukkan deret gagal panjang (11 Okt 05:58 → 12 Okt 01:24; 14 Okt 07:45 →
   15 Okt 01:33; 17 Okt 10:54 → 20 Okt 07:42). Script monitor tidak mencetak cek mana yang gagal,
   jadi penyebab per deret tidak bisa dipastikan dari log.

Bukti langsung 21 Okt 13:57: `/ready` produksi C56 `definitionsExpiresAt` 22 Okt 12:27:59 = waktu
build C56 + 24 jam, walau wake monitor #185 berjalan 13:18 (lease mengikuti build, bukan wake).

**Perbaikan (lapisan yang tepat).**

| Lapisan | Perubahan | Alasan |
|---|---|---|
| Kesiapan (`readiness.service.ts`) | Status `standby` (HTTP 200, `/ready` `degraded`) untuk lease yang habis ≤ 8 jam setelah run sukses, dan untuk heartbeat terbaru dari deployment lain (≤ 8 jam). `not_ready` (503) tetap untuk run gagal **deployment ini** (`on_demand_refresh_failed`), tanpa heartbeat, bukti tidak sah, atau siaga > 8 jam | Membedakan "dingin tapi bisa dibangunkan" dari gangguan nyata. 8 jam = dua jadwal cron; siaga lebih lama berarti wake tidak sampai ke worker. Keamanan tidak berubah: berkas tetap dikarantina sampai pemindaian membuktikannya bersih |
| Worker (`malware-scan-on-demand.ts`) | Heartbeat menyimpan `deploymentId` (`VERCEL_DEPLOYMENT_ID`). Kegagalan sebelum kunci antrean (koneksi, peran DB, kunci) dan inisialisasi pemindai kini juga mencatat heartbeat `degraded`; `busy` tidak | Agar kegagalan deployment lama tidak dibebankan ke deployment baru, dan kegagalan deployment baru tidak tersembunyi di balik `standby`. Gagal validasi env/impor (sengaja tanpa memuat database) dan dispatch API yang ditolak tidak bisa dicatat: tertangkap monitor dan batas 8 jam |
| Vercel Cron (`backend/vercel.json`) | 6 entri harian, tiap 4 jam (03, 07, 11, 15, 19, 23 :07) | Sesuai Hobby (tiap entri 1×/hari, maks 100 entri). Jendela refresh 13 jam kini berisi 3 percobaan; refresh gagal dicoba ulang ≤ ±5 jam; deployment baru dibuktikan ≤ ±5 jam setelah promosi |
| Monitor (`check-operations.mjs`) | Mencetak id + status cek yang bermasalah, mis. `(scanner: attention, backup: failed)` | Deret gagal berikutnya bisa didiagnosis dari log run |

**Trade-off.**

- *Kenapa tidak menambah jadwal GitHub?* Jadwal GitHub sudah tiap jam tetapi hanya berjalan 4–6×
  sehari dan bisa absen berjam-jam; menambah jadwal tidak menambah keandalan. Vercel Cron tidak
  memakai menit Actions. Repositori saat ini publik (menit runner standar gratis); bila menjadi
  privat, monitor tiap jam sendiri ±720 menit/bulan dari kuota 2.000 — wake di Vercel Cron tidak
  bergantung pada itu.
- *Biaya cron tambahan.* Cron yang menemukan lease masih > 13 jam hanya menghitung kesiapan
  (1 kueri DB + 1 `list` Blob, ±1 s). Pemindai hanya dibangunkan bila lease < 13 jam atau siaga,
  sehingga dalam kondisi normal tetap ±2 run pemindai per hari; tambahan hanya saat refresh gagal.
  Tambahan operasi Blob ±4 `list`/hari (±120/bulan).
- *Percobaan Freshclam lebih sering saat refresh gagal.* Wake hanya membangunkan pemindai bila lease
  tersisa < 13 jam atau siaga, dan hampir selalu di instance dingin. Bila refresh dini gagal, setiap
  wake berikutnya mengunduh ulang `daily.cvd` penuh (±23 MB): dari cron kini sampai 3 percobaan per
  jendela 13 jam (dulu 1), ditambah wake dari monitor GitHub (tiap run, sudah ada sebelumnya) dan
  pemindaian unggahan. Pembatasnya: jarak antar-cron 4 jam; `EARLY_REFRESH_RETRY_MS` (1 jam) hanya
  berlaku di instance hangat; dan 6×/hari masih di bawah bawaan Freshclam (`Checks 12`/hari). Tidak ada
  backoff lintas instance; bila mirror ClamAV mulai membatasi (HTTP 429), jalan keluarnya cache definisi
  atau redeploy berkala (lihat di bawah), bukan menambah pemicu.
- *`/ready` 200 saat siaga.* `/ready` tidak dipakai untuk routing Vercel; hanya sinyal operator,
  monitor, dan `verify-cloud-access.mjs` (yang tetap menuntut `status: ready`). Status `degraded`
  plus `malwareWorker.state` di body tetap jujur. Setelah promosi, `/ready` 200 `degraded` dengan
  `awaiting_first_run_on_deployment` adalah normal; jalankan monitor (atau tunggu cron) untuk bukti.
- *Yang belum diselesaikan.* Pada deployment berumur > 24 jam setiap pemindaian dingin tetap
  mengunduh `daily.cvd` penuh (±23 MB pada build C56; `main.cvd` 89 MB bila ikut berubah) dari
  mirror ClamAV (risiko rate-limit). Opsi lanjutan: cache definisi bertanda tangan di Blob
  (diverifikasi ulang `sigtool`; ±23 MB per instance dingin, berat untuk kuota transfer Blob Hobby)
  atau redeploy berkala. Belum diusulkan di sini.

## 3. Latensi Blob dan apakah store perlu dipindah

**Temuan.** Premis "store Blob tetap di wilayah lamanya" tidak benar: Vercel API melaporkan store
privat `simsa-arsip-private` (`store_oCG80crbZI1PLMP4`) di **`sin1`** (78,6 MB, 65 objek). Sejak
C56 fungsi, Neon (`ap-southeast-1`), dan Blob sama-sama di Singapura; lintas wilayah justru terjadi
sebelum C56 (fungsi di `iad1`).

Sampel `/ready` produksi 21 Okt 14:24–14:25 (5×, jarak 6 s): DB 14–94 ms (833 ms saat dingin),
`list` Blob **477–1.045 ms** (median 588 ms). Karena store sudah satu wilayah, waktu itu berasal dari
API kontrol Blob (`list`/`put`/`head`/`del`), bukan jarak ke store.

**Pengukuran baru.** `POST /api/operations/storage-latency` (token monitor, tanpa sesi, satu
pengukuran per instance) mengukur dari fungsi produksi: unggah, `head`, unduh (dengan cek SHA-256),
dan hapus objek uji 16 KiB dan 1 MiB masing-masing 3 kali, plus `list`. Objek uji memakai prefiks
`__simsa_latency_probe__/` dan dihapus di setiap putaran; di awal dan akhir setiap run, objek uji yang
berumur > 5 menit (sisa `put` yang timeout setelah tersimpan, hapus yang gagal, atau fungsi yang
terhenti) ikut dihapus dan jumlahnya dilaporkan. Tidak ada catatan DB yang merujuknya, dan backup
memakai rujukan DB sehingga tidak ikut. Jalankan lewat **Actions → SIMSA Operations Monitor → Run
workflow → centang "Ukur latensi Blob privat"**; hasil (median per operasi) tercetak di langkah
"Measure private storage latency". Endpoint baru tersedia setelah backend dirilis.

**Rekomendasi: jangan pindahkan store.** Tidak ada wilayah yang lebih dekat untuk dituju, dan
pemindahan mahal:

- Hostname store (`<id>.private.blob.vercel-storage.com`) tertulis di setiap `file_attachments.file_url`
  dan di `regulatory_rule_sets.source_document_blob_url`, `client_blob_uploads.blob_url`,
  `bulk_upload_items.blob_url`; semua harus dimigrasi dalam satu jendela pemeliharaan, dan
  `client-blob-upload.service.ts` menolak hostname selain store ID yang tertanam di token.
- Token dan variabel berubah: `SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN`/`_STORE_ID`/`_WEBHOOK_PUBLIC_KEY`
  di Vercel, secret `SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN` dan variabel
  `OPERATIONS_RECOVERY_EXPECTED_BLOB_HOSTNAME` di environment GitHub untuk backup dan fixity.
- Catatan fixity (SHA-256) tetap berlaku bila byte disalin utuh, tetapi semua berkas perlu diverifikasi
  ulang di store baru; bukti backup/restore lama merujuk hostname lama.

Bila pengukuran menunjukkan unduhan 1 MiB jauh di atas ±200 ms dari `sin1`, yang ditinjau adalah
pola akses (mis. mengurangi `head`/`list` per permintaan), bukan wilayah store.

## Yang harus diaktifkan pengguna

Lihat draf body PR (catatan sesi) — ringkasnya: aktifkan *Dependabot alerts* dan *Dependabot
security updates* di Settings → Code security; tidak ada perubahan env/secret Vercel; cron baru aktif
saat backend berikutnya dipromosikan dan perlu dicek di Vercel → simsa-backend → Settings → Cron Jobs.
