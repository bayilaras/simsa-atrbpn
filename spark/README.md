# SIMSA Spark — pilot metadata berbasis Firebase

Status: implementasi edisi terpisah untuk pengujian. **Belum deploy atau
disetujui untuk data arsip asli.** Seluruh data yang digunakan edisi ini berada
di Cloud Firestore; identitas berada di Firebase Authentication. Tidak ada
PostgreSQL, API Express, Cloud SQL, Functions, atau Storage yang perlu berjalan.
Kode backend lama tetap dipertahankan. Ini bukan migrasi otomatis semua tabel
atau semua fitur dari backend lama. Project `arsip-d16d3` tidak diubah.

## Cakupan

- Login email/password dan Google, tanpa pendaftaran mandiri di UI.
- Pengguna terverifikasi yang sudah diizinkan operator, akses satu unit.
- Metadata judul, nomor, tanggal, klasifikasi, lokasi fisik, dan uraian.
- Draf/aktif, penyuntingan dengan pemeriksaan versi, penutupan metadata
  (`archived`) dengan alasan. Status ini bukan keputusan retensi/pemusnahan.
- Pencarian nomor persis, halaman 25 data, riwayat perubahan snapshot atomik.
- Ekspor CSV data halaman yang sedang terlihat, **bukan backup seluruh database**.
- Klasifikasi/lokasi/profil disediakan operator tepercaya, bukan pengguna sendiri.

Belum termasuk file PDF/foto, OCR, antivirus, tanda tangan, integrasi eksternal,
persetujuan/retensi backend lama, administrasi seluruh akun Firebase Auth, audit
keamanan independen, backup terkelola otomatis, atau PITR. Tidak ada file yang
disimpan sebagai Base64 di Firestore. Tidak ada fallback ke backend/data lama.

## Jalankan lokal tanpa akun cloud

Prasyarat: Node **24**, npm, Java **21+** di PATH/JAVA_HOME. Java hanya untuk
emulator, bukan untuk browser yang nanti memakai aplikasi. Instalasi portable
bisa digunakan tanpa mengganti Java sistem. Tidak membutuhkan Docker/billing.

Dari direktori `spark`:

```sh
npm ci
npm test
npm run typecheck
npm run build:emulator
npm run test:emulator
npm run backup:drill
```

Tes emulator menjalankan Auth/Firestore lokal hanya pada project
`demo-simsa-spark` dan menghentikannya setelah selesai. Jangan menjalankan
`test:emulator` jika emulator interaktif sudah memakai port yang sama.

Untuk uji browser, terminal pertama:

```sh
npm run emulators
```

Terminal kedua, set variabel **pada proses lokal ini saja**:

```powershell
$env:GCLOUD_PROJECT = 'demo-simsa-spark'
$env:GOOGLE_CLOUD_PROJECT = 'demo-simsa-spark'
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8088'
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9098'
npm run seed:emulator
npm run dev:emulator
```

Buka http://127.0.0.1:5188. Akun sintetis hanya di emulator:

- `operator@example.test` atau `viewer@example.test`.
- Password keduanya: `Local-Spark-Only-2026!`.

Fixture tidak pernah digunakan di project nyata. Seed hanya membuat data yang
belum ada, tidak menghapus/mengganti fixture sebelumnya. Emulator bersifat
sementara; restart tanpa ekspor akan menghilangkan data lokal. Hentikan kedua
terminal dengan Ctrl+C. Build emulator berada di `dist-emulator`, bukan folder
Hosting `dist`, dan menolak berjalan pada origin non-loopback.

## Model data dan otorisasi

Lihat [CONTRACT.md](CONTRACT.md). Field dibatasi, string disimpan tanpa spasi
awal/akhir, referensi katalog wajib sah, tanggal kalender harus valid. Tidak
ada hard-delete dari client. Setiap mutasi metadata dan history harus ditulis
atomik; Rules memverifikasi kecocokan snapshot, versi, actor dan server time.
Rules tidak mempercayai validasi UI. Akun Admin SDK/IAM tetap dapat melewati
Rules; history ini tidak boleh disebut bukti audit lengkap yang independen.

Aturan read menolak pengguna tidak dikenal, email belum diverifikasi, akun
nonaktif, dan unit berbeda. Profil hanya bisa dibaca pemilik akun; daftar
profil, perubahan peran sendiri, akses collection-group dan collection lain
ditolak. Role `admin` pada profil tetap dibatasi unit, bukan admin project.
Authentication memakai session-only persistence; cache Firestore hanya memory.
Setelah akses dicabut, data yang sudah dilihat/diekspor orang tidak bisa ditarik
kembali. Akses server berikutnya tetap diperiksa Rules.

## Pemulihan gangguan saat dipakai

- Bila pemuatan katalog gagal karena jaringan, gunakan tombol coba lagi.
  Daftar arsip dan penulisan baru diaktifkan setelah seluruh referensi berhasil
  dimuat. Penolakan hak akses tetap memblokir data; coba ulang bukan bypass.
- Bila simpan **arsip baru** belum terkonfirmasi, isi yang sudah dikirim dikunci.
  Coba ulang dari editor yang sama agar memakai identitas transaksi yang sama.
  Aplikasi memeriksa rekaman beserta riwayat awal sebelum menulis lagi; hasil
  edit/penutupan yang lebih baru tidak ditimpa.
- Menutup editor, mengganti akun/unit atau memuat ulang halaman menghilangkan
  identitas percobaan tersebut, **bukan membatalkan simpan di server**. Periksa
  nomor arsip dan riwayat sebelum membuat draf pengganti. Nomor arsip tidak
  dipaksa unik, sehingga membuat draf baru bukan cara aman mengulang simpan.
- Saat keluar, data segera disembunyikan. Login lain diblokir sampai logout
  selesai. Jika gagal, gunakan tombol **Coba keluar lagi**; jangan menganggap
  sesi Firebase sudah berakhir hanya karena daftar arsip tidak terlihat.

Perlindungan simpan ulang ini berlaku pada editor/sesi yang sama, bukan jaminan
tanpa duplikasi setelah browser ditutup atau antarperangkat. Isi draf dan token
percobaan tidak disimpan ke localStorage untuk pemulihan lintas sesi.
Hasil regresi, uji browser offline/online, dan batas pembuktiannya dicatat di
[RECOVERY-VERIFICATION.md](RECOVERY-VERIFICATION.md).

## Jalur rilis Spark (belum dieksekusi)

1. Review PR baru dan semua required checks pada **merge commit baru**. Hasil
   PR 7 tidak otomatis mengesahkan implementasi Firestore ini.
2. Dengan persetujuan pemilik, inventaris project Firebase pilot **terpisah**
   dari data/Production yang sudah ada: paket Spark, satu database Firestore
   Standard `(default)`, region yang disetujui, aplikasi web, dan Hosting.
   Jangan mengganti Rules project aktif tanpa meninjau seluruh koleksinya.
3. Aktifkan provider login yang dipilih. Verifikasi authorized domains dan
   buat akun operator lewat Firebase Console. Buat profil `sparkUsers/{uid}`
   serta unit/katalog sesuai kontrak menggunakan operator terpercaya. Tidak
   ada tombol menjadi admin pertama dan tidak ada private key di frontend.
4. Daftarkan App Check reCAPTCHA Enterprise untuk aplikasi web dan domain pilot.
   Isi public web config dari `.env.example` ke `.env.local`. Secret/admin key
   tidak boleh ada pada `VITE_*`. Script build menolak konfigurasi tidak lengkap,
   domain-project tidak cocok, dan proyek emulator dalam mode production.
5. Deploy Rules/indexes hanya ke project pilot yang sudah diperiksa. Rules
   berlaku untuk database, **bukan per Hosting preview channel**. Tunggu index
   siap. Terapkan enforcement App Check untuk Firestore setelah konfigurasi
   tervalidasi; emulator tidak membuktikan enforcement App Check di cloud.
6. Build production dan deploy Hosting ke preview channel dengan project
   eksplisit. Tidak ada `.firebaserc`/script auto-deploy di edisi ini; jalur
   ini tidak otomatis memakai project dari login CLI atau melakukan upgrade.
7. Uji login/logout, verifikasi email, unknown/disabled user, lintas unit,
   CRUD/penutupan, konflik dua tab, pencarian/pagination, CSV, reload dan batas
   kuota. Google popup, email delivery, App Check dan CSP perlu bukti live.
8. Tentukan prosedur backup **metadata lengkap** oleh operator: inventaris
   semua koleksi/subkoleksi dan akun, penghentian penulisan untuk konsistensi,
   ekspor tervalidasi/terenkripsi, kunci terpisah, retensi, lalu restore ke
  project/emulator terpisah dan perbandingan data. Ekspor halaman UI maupun
   drill PostgreSQL lama tidak memenuhi ini. [Latihan backup terenkripsi lokal](BACKUP-DRILL.md)
   tersedia untuk metadata sintetis dan metadata akun (tanpa kredensial, akun
   restore nonaktif). Tool backup live yang lengkap tetap belum tersedia.
9. Hanya setelah pilot diterima dan backup teruji, putuskan pemakaian metadata
   nyata serta promosi Hosting. Catat commit, URL dan release sebelumnya untuk
   rollback; rollback frontend tidak mengembalikan data atau Rules otomatis.

**Jangan mengaktifkan billing**, App Hosting, Functions, Storage, SQL Connect,
Cloud SQL, atau Cloud Run sebagai bagian dari runbook Spark ini. Tidak perlu
memasukkan kartu kredit. Jangan memasukkan dokumen asli pada tahap pilot.

## Kuota dan batas gratis

Paket Spark tidak memerlukan informasi pembayaran. Firestore memiliki satu
database gratis per project, 1 GiB data, 50.000 read/hari, 20.000 write/hari,
20.000 delete/hari, dan 10 GiB transfer keluar/bulan menurut dokumentasi saat
implementasi. Rules yang membaca profil/katalog dapat menambah read; setiap
perubahan metadata juga menulis history. Katalog dibaca per 50 item dengan
pagination internal, maksimal 1.000 item per jenis per unit; bila lebih,
pemuatan ditolak secara eksplisit, tidak ditampilkan sebagian tanpa peringatan.
Kuota habis dapat membuat operasi gagal; gratis bukan kapasitas tanpa batas.

Cloud Storage for Firebase dan fitur backup/PITR Firestore tidak tersedia pada
jalur Spark tanpa billing. Tidak ada janji seluruh fitur aplikasi lama dapat
berjalan pada layanan gratis ini.

Referensi resmi:

- https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
- https://firebase.google.com/docs/firestore/quotas
- https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024
- https://firebase.google.com/docs/firestore/security/rules-conditions
- https://firebase.google.com/docs/rules/unit-tests
