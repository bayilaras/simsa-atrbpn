# Runbook Deploy Integrasi Surat — P5 (Pengerasan 0048 + Backfill Data Lama)

Berlaku untuk rilis yang memuat migrasi `0048_rangkaian_pengerasan` dan skrip backfill
`backend/scripts/backfill-rangkaian-lama.mjs`. Produksi memakai Vercel + Neon; jalur
Cloud SQL/psql lain tidak dipakai untuk backfill data lama (§5).

**Prasyarat runbook ini:** `docs/RUNBOOK_INTEGRASI_SURAT_P1.md`, `docs/RUNBOOK_INTEGRASI_SURAT_P3.md`
(§7 dan §8) sudah dijalankan dan gerbang rilisnya disahkan; CI "Backend Tests
(PostgreSQL 16/17/18)" hijau pada head P5, termasuk suite 0048 PGlite dan Postgres.
Jangan menaruh connection string di argumen baris perintah atau berkas riwayat
shell — ikuti pola prompt tersembunyi yang sama dengan `RUNBOOK_INTEGRASI_SURAT_P1.md`
untuk setiap variabel `NEON_*_DATABASE_URL` di bawah.

## 1. Prasyarat

1. Jawaban tertulis pre-flight P0 §13 pertanyaan 2 ("apakah ada data lama di
   produksi?") harus sudah tersedia. **Bila tidak ada data lama**, hentikan
   runbook ini setelah langkah 5 (migrasi 0048) — langkah 6–9 (dry-run, sign-off,
   apply, flag) tidak perlu dijalankan.
2. Gerbang rilis P5 "Gerbang rilis P5" pada deskripsi PR (baris a–i; tabel
   gabungannya ada di `docs/RILIS_INTEGRASI_SURAT_P0_P5.md` §4, termasuk baris
   CTRL-5 flag Tutup massal) sudah diisi (disahkan atau ditolak) untuk setiap baris yang berlaku sebelum
   langkah manapun di bawah dijalankan pada produksi.

## 2. Backup

Ikuti `docs/BACKUP_NEON.md`. Manifest bundle backup mengikat rantai migrasi
secara eksak (`scripts/neon-backup-core.mjs:43-58`), jadi helper diambil dari
checkout yang **journal-nya sama dengan rantai database**, bukan dari checkout
yang kodenya sedang berjalan:
- **Backup pra-0048** (database di rantai 0047): helper dari **commit merge P4**
  (journal berakhir di `0047_unit_kerja_direktorat`), juga bila kode P5 sudah
  dideploy. Helper checkout P5 akan menolak rantai 0047.
- **Backup setelah 0048**: helper dari checkout P5 (commit merge P5).

Workflow terjadwal `backup-neon.yml` berjalan dari branch bawaan. Sejak P5 masuk
`main` sampai 0048 diterapkan, rantai `main` ≠ rantai database, sehingga backup
terjadwal harian gagal. Karena itu P5 baru di-merge ketika 0048 dapat langsung
diterapkan (§4, CTRL-2). Bila jarak merge → 0048 melewati jadwal backup, ambil
backup manual dengan helper yang cocok.

## 3. Deploy kode P5

**Syarat [CTRL-2, diamandemen]:** kueri pre-0048 §4 sudah dijalankan pada
database produksi (rantai 0047, kode P4 berjalan) dan **ketiganya bersih**.
Bila tidak bersih, P5 **tidak di-merge ke `main` dan tidak dideploy** (§4).

**Deploy kode P5 dengan `RANGKAIAN_DISPOSISI_LAMA_READ` dan
`RANGKAIAN_TUTUP_MASSAL_DATA_LAMA` tidak diset (mati)**,
sebelum langkah migrasi/backfill di bawah (jangan mendeploy sebelum backup
§2 — backup harus diambil dengan kode produksi yang masih berjalan, lalu
kode P5 didorong). Konfirmasi di Vercel env project backend bahwa flag
**tidak** bernilai persis `true` sebelum `--apply` (§6). Kode produksi sudah
menghormati flag ini sejak P2 (`visibility-spec.ts`), jadi flag yang sudah
menyala sebelum sign-off memberi akses baru fail-open segera setelah baris
peserta ditulis backfill. `RANGKAIAN_TUTUP_MASSAL_DATA_LAMA` baru dinyalakan
di §8.2 (CTRL-5).

Koreksi Berkas aman sebelum 0048: `ajukan` sendiri memeriksa, di bawah kunci
rangkaian, bahwa belum ada koreksi `pending`/`approved` (409). Index unik 0048
hanya pengaman tambahan. Tetap terapkan 0048 (§5) segera setelah deploy.

## 4. Pre-0048: kueri NULL dan keputusan `dilewati` (gerbang rilis baris f)

Jalankan bagian ini **dua kali**:
1. sebelum P5 di-merge/dideploy, pada database 0047 dengan kode P4 berjalan.
   Hasilnya menentukan apakah P5 dirilis;
2. sekali lagi tepat sebelum migrasi §5.

Sebagai role **`simsa_api`** (lewat prompt tersembunyi, `DATABASE_URL` dari
`NEON_RUNTIME_DATABASE_URL`, pola yang sama dengan §6/§8). Amandemen
pra-eksekusi P5-T13-1 §3 mensyaratkan pemeriksaan ini berjalan sebagai
`simsa_api`, bukan role read-only, karena kueri rincian di bawah menyentuh
tabel `rangkaian_*` yang tidak semua role read-only berhak baca:

```sql
SELECT count(*) FROM surat_distributions WHERE rangkaian_id IS NULL;                -- harus 0
-- 0048 juga RAISE pada dua kondisi Koreksi Berkas berikut; keduanya harus kosong:
SELECT rangkaian_id, count(*) FROM rangkaian_koreksi_berkas
 WHERE status IN ('pending', 'approved') GROUP BY rangkaian_id HAVING count(*) > 1;  -- koreksi terbuka ganda
SELECT id FROM rangkaian_koreksi_berkas
 WHERE (status = 'pending') <> (diputuskan_by IS NULL)
    OR (diputuskan_by IS NULL) <> (diputuskan_at IS NULL)
    OR (unit_pengolah_baru = unit_pengolah_lama AND klasifikasi_baru = klasifikasi_lama); -- baris koreksi tidak konsisten
```

Bila kueri kedua atau ketiga tidak kosong, rekonsiliasi dulu bersama pemilik
data dan pemilik spesifikasi. Koreksi ganda diputuskan atau ditolak lewat UI.
Baris tidak konsisten tidak boleh ada; perlakukan sebagai insiden.

Kueri pertama harus **0**. Bila tidak, jalankan kueri rincian berikut dan putuskan gerbang
rilis baris (f) sebelum melanjutkan:

```sql
SELECT d.id, d.surat_masuk_id, d.status, a.rangkaian_id, r.status AS status_rangkaian
  FROM surat_distributions d
  JOIN rangkaian_anggota a ON a.surat_masuk_id = d.surat_masuk_id
  JOIN rangkaian_surat r ON r.id = a.rangkaian_id
 WHERE d.rangkaian_id IS NULL;
```

**Keputusan gerbang rilis baris (f), sudah dikunci di migrasi ini [CTRL-2]:
tahan 0048. Menahan 0048 berarti menahan SELURUH rilis P5, yaitu merge ke
`main` dan deploy, bukan hanya migrasinya.** Alasannya:
- **Backup.** `backup-neon.yml` terjadwal berjalan dari `main` dan mensyaratkan
  rantai database = rantai checkout (`collect-backup-evidence.sql`, profil
  pre/post migration). Bila P5 ada di `main` sementara database tertahan di
  0047, tidak ada profil yang cocok. Backup produksi harian gagal selama
  penahanan, dan migrasi apa pun mensyaratkan restore drill hijau.
- **Backfill langkah 2.** `--apply` (§8, §8.1) menolak berjalan selama masih
  ada `surat_distributions.rangkaian_id IS NULL`. Akibatnya §8–§9 dan gerbang
  (a)/(c) tidak dapat diselesaikan.

Selama penahanan, produksi tetap pada kode P4 (commit merge P4) di rantai 0047.
Backup terjadwal tetap hijau karena `main` masih berakhir di 0047. Catat di
gerbang (f): P5 belum dirilis, siapa pemilik keputusannya, dan syarat
pelepasannya (semua baris NULL terselesaikan).

Migrasi `0048_rangkaian_pengerasan.sql` memuat pemeriksaan
`RAISE EXCEPTION` bila ada baris `rangkaian_id IS NULL` dan **tidak** memuat
prelude yang mematikan trigger `surat_distributions_closed_guard`. Bila kueri
di atas mengembalikan bukan 0, **jangan jalankan migrasi**: selesaikan dulu
setiap entri `dilewati` (jalankan ulang backfill langkah 1 P3 untuk entri
`digabung` yang transien — bila proses ini berhenti dengan galat `40P01`
(deadlock) atau `40001`, ikuti panduan jalankan-ulang di
`RUNBOOK_INTEGRASI_SURAT_P3.md` §2 (skrip idempoten: jalankan ulang perintah
yang sama sampai selesai); untuk entri `diberkaskan`, dokumentasikan keputusan
pemilik spesifikasi bersama TU/pengawas unit pencatat — baris itu tetap
ber-`rangkaian_id` NULL secara permanen sampai ada jalur baru).

Baris `dilewati` P3 secara konstruksi berstatus `processed`/`rejected` (tidak
ada disposisi terbuka); Koreksi Berkas **tidak** dapat memperbaikinya karena ia
hanya mengubah `rangkaian_surat`, bukan `surat_distributions`, dan trigger
`surat_distributions_closed_guard` (0046) tidak punya jalur bypass GUC.

**Catatan audit — jalur rangkaian yang sudah ada (carry-forward P3).** Skrip
`backfill-rangkaian-disposisi.mjs` P3 mengisi `rangkaian_id` pada jalur
"rangkaian sudah ada" (`:109-111`) **tanpa** menulis baris `audit_log`; hanya
pembuatan rangkaian baru yang diaudit (`:103-106`). Ini tidak diperbaiki di
P5 (opsi ADVISORY pada amandemen pra-eksekusi, tidak diambil). Bila operator
memerlukan jejak audit atas baris yang diisi lewat jalur ini, gunakan kueri
berikut terhadap `surat_distributions.updated_at` (bandingkan dengan jendela
waktu run backfill langkah 1 P3):

```sql
SELECT id, surat_masuk_id, rangkaian_id, updated_at
  FROM surat_distributions
 WHERE rangkaian_id IS NOT NULL
   AND updated_at BETWEEN '<awal-run-backfill>' AND '<akhir-run-backfill>'
 ORDER BY updated_at;
```

## 5. Migrasi 0048

**Migrasi bertahap (rilis gabungan P0–P5).** Adapter Neon menjalankan **semua**
migrasi tertunda dalam satu transaksi (`backend/scripts/migrate-database.mjs`)
dan tidak punya opsi target. Dari checkout P5, database di 0045 akan menjalankan
0046, 0047, dan 0048 bersama. Setelah 0046, setiap distribusi lama masih
ber-`rangkaian_id` NULL, sehingga precheck 0048 RAISE dan seluruh transaksi
digulung balik. Karena itu:
1. Terapkan **0046/0047 dari commit merge P4** (journal berakhir di 0047).
   Lalu jalankan backfill langkah 1 run 1, deploy, run 2, dan capai kriteria
   keluar (`RUNBOOK_INTEGRASI_SURAT_P3.md` §2.2–§3).
2. Ambil backup pra-0048 dengan helper commit merge P4 (§2).
3. Setelah §4 bersih, terapkan **0048 dari checkout P5** (perintah di bawah).

Sebagai bagian dari deploy (adapter Neon, dari checkout P5):

```powershell
& $cloudNode "--env-file=$cloudEnv" scripts/neon-database.mjs migrate --apply
& $cloudNode "--env-file=$cloudEnv" scripts/neon-database.mjs verify-runtime
```

`verify-runtime` tidak memeriksa privilege tabel `rangkaian_*`; jalankan juga
kueri privilege `simsa_api` pada `RUNBOOK_INTEGRASI_SURAT_P1.md` langkah 4
sebagai role runtime `simsa_api` setelah `verify-runtime` selesai.

## 6. Dry-run backfill data lama

Jalankan sebagai role runtime **`simsa_api`** (bukan `simsa_maintenance`/
`simsa_operator`), dengan `DATABASE_URL` diisi dari `NEON_RUNTIME_DATABASE_URL`
lewat prompt tersembunyi, memakai pola shell yang sama dengan
`RUNBOOK_INTEGRASI_SURAT_P3.md` §4:

```bash
read -rs NEON_RUNTIME_DATABASE_URL && export NEON_RUNTIME_DATABASE_URL
export DATABASE_URL="$NEON_RUNTIME_DATABASE_URL"
read -rs RANGKAIAN_DATA_LAMA_SEBELUM && export RANGKAIAN_DATA_LAMA_SEBELUM   # nilai tercatat di runbook Deploy P4, persis sama
npm --prefix backend run rangkaian:backfill-lama:plan -- --out=<dir di luar repo checkout>
unset DATABASE_URL NEON_RUNTIME_DATABASE_URL RANGKAIAN_DATA_LAMA_SEBELUM
```

`surat_masuk.created_at` bertipe `timestamp` tanpa zona dan dibandingkan dengan
`$batas::timestamptz`. Skrip menjalankan `SET TIME ZONE 'UTC'` sendiri pada
sesinya dan mencetak `zonaWaktu`. Sebelum menjalankan skrip, tetap konfirmasi
zona bawaan role runtime, yang dipakai aplikasi:

```bash
read -rs NEON_RUNTIME_DATABASE_URL && export NEON_RUNTIME_DATABASE_URL
psql "$NEON_RUNTIME_DATABASE_URL" -c 'SHOW TimeZone;'   # harus UTC
unset NEON_RUNTIME_DATABASE_URL
```

Baris JSON pertama yang dicetak skrip berisi `dbUser`, `dbName`, `dbHost`,
`zonaWaktu` (harus `UTC`), `batasDataLama`, dan `sumberBatas` — **hentikan segera (Ctrl+C)** bila `dbUser` bukan `simsa_api`
atau `dbName` bukan database produksi yang dimaksud, sama seperti aturan
`RUNBOOK_INTEGRASI_SURAT_P3.md` §4. Catat `batasDataLama` pada hasil runbook ini.

Skrip menulis empat berkas ke `--out`: `pemetaan-label.csv`, `balasan-ditinjau.csv`,
`calon-pengolah.csv`, dan `ringkasan.json`. `ringkasan.json` memuat SHA-256
rencana dan `total`, termasuk `sifat_tak_dikenal`: jumlah surat target yang
kelas `sifat_surat`-nya tak dikenal, sehingga tetap tersamar bagi peserta
meski flag menyala. Angka ini menjadi bukti gerbang (h).

Skrip berhenti bila tabel `disposisi_label_unit` memuat baris
`perlu_verifikasi = true` yang menunjuk unit. Verifikasi atau hapus baris itu
dulu. `ALLOW_NON_RUNTIME_ROLE=1` hanya berlaku untuk host lokal dan tidak
pernah dipakai di produksi. **Jangan
commit laporan ini ke repo.** Kirim keempat berkas ke pemilik keamanan.

## 7. Sign-off SHA

Kirim `ringkasan.json` (berisi SHA-256) beserta ketiga CSV ke pemilik keamanan.
Sign-off tertulis wajib menyebut SHA-256 persis dari `ringkasan.json` dry-run
tersebut.

**Stabilitas SHA.** SHA mencakup kondisi yang dievaluasi saat `--apply`
(`sudah_anggota`, total baris, dan `sudah_didisposisikan`). Perubahan apa pun
di antara dry-run dan apply — pengeditan label lama, disposisi baru, atau
tautan baru — memaksa dry-run dan sign-off baru. Jalankan dry-run → sign-off →
apply dalam satu jendela waktu yang singkat.

## 8. `--apply`

```bash
read -rs NEON_RUNTIME_DATABASE_URL && export NEON_RUNTIME_DATABASE_URL
export DATABASE_URL="$NEON_RUNTIME_DATABASE_URL"
read -rs RANGKAIAN_DATA_LAMA_SEBELUM && export RANGKAIAN_DATA_LAMA_SEBELUM   # sama persis dengan dry-run
npm --prefix backend run rangkaian:backfill-lama:apply -- --approved-sha256=<sha256 yang disetujui>
unset DATABASE_URL NEON_RUNTIME_DATABASE_URL RANGKAIAN_DATA_LAMA_SEBELUM
```

Skrip menolak `--apply` bila SHA tidak cocok dengan kondisi data saat ini, atau
bila `RANGKAIAN_DATA_LAMA_SEBELUM` tidak diset persis di shell. Skrip idempoten:
peserta yang sudah dicabut (`berakhir_at`) tidak dihidupkan kembali oleh apply
ulang. **Bila apply berhenti di tengah jalan** (galat/koneksi putus), jangan
menebak status: jalankan dry-run baru dan minta sign-off baru atas SHA yang
baru sebelum mencoba `--apply` lagi.

### 8.1 Gerbang (a): unit pengolah data lama

Spec:358 meminta unit pengolah dari label lama diisi otomatis. `ubahUnitPengolah`
dan Koreksi Berkas hanya menerima unit yang sudah berada di
`unitDalamJangkauanBerkas` (target distribusi ∪ anggota) — peserta
`disposisi_lama` tidak pernah ada di situ, jadi kedua jalur itu **tidak bisa**
dipakai untuk mengisi `unit_pengolah_id` hasil backfill.

Putuskan gerbang rilis baris (a) berdasarkan `calon-pengolah.csv` dan sign-off
pemilik keamanan:
- **"isi"**: jalankan mode pengisian pengolah, yang SHA-bound dan diaudit.
  Jalankan sebagai `simsa_api` dengan pembungkus shell yang sama dengan §6/§8.
  `DATABASE_URL` dan `RANGKAIAN_DATA_LAMA_SEBELUM` wajib dari shell; skrip
  menolak tanpanya.

  ```bash
  read -rs NEON_RUNTIME_DATABASE_URL && export NEON_RUNTIME_DATABASE_URL
  export DATABASE_URL="$NEON_RUNTIME_DATABASE_URL"
  read -rs RANGKAIAN_DATA_LAMA_SEBELUM && export RANGKAIAN_DATA_LAMA_SEBELUM   # sama persis dengan §6/§8
  npm --prefix backend run rangkaian:backfill-lama:isi-pengolah:plan -- --out=<dir di luar repo checkout>
  unset DATABASE_URL NEON_RUNTIME_DATABASE_URL RANGKAIAN_DATA_LAMA_SEBELUM

  # setelah sign-off SHA baru atas ringkasan.json mode ini (calon-pengolah.csv memuat rangkaian_id):
  read -rs NEON_RUNTIME_DATABASE_URL && export NEON_RUNTIME_DATABASE_URL
  export DATABASE_URL="$NEON_RUNTIME_DATABASE_URL"
  read -rs RANGKAIAN_DATA_LAMA_SEBELUM && export RANGKAIAN_DATA_LAMA_SEBELUM
  npm --prefix backend run rangkaian:backfill-lama:isi-pengolah:apply -- --approved-sha256=<sha256>
  unset DATABASE_URL NEON_RUNTIME_DATABASE_URL RANGKAIAN_DATA_LAMA_SEBELUM
  ```

  Jalankan langkah ini **sebelum** flag Tutup massal dinyalakan (§8.2).
  Tutup massal mengunci `unit_pengolah_id` secara terminal begitu rangkaian
  berstatus `diberkaskan`.
- **"tidak"**: spec:358 diwaiver secara sadar. Rangkaian data lama tanpa calon
  pengolah diberkaskan ke pencatat lewat Tutup massal. Rangkaian yang punya
  calon pengolah (tepat satu direktorat) tetap dikecualikan dari Tutup massal
  (fail closed, §8.2). Berkaskan rangkaian itu satu per satu lewat Berkaskan di
  panel Alur Surat, dengan unit pengolah dipilih eksplisit.

Akses unit pengolah hasil mode ini **tidak dikendalikan** oleh
`RANGKAIAN_DISPOSISI_LAMA_READ`: setelah mode pengolah dijalankan, mematikan
flag tidak mencabut akses itu.

### 8.2 Tutup massal data lama (gerbang CTRL-5)

Tutup massal dikunci di server oleh `RANGKAIAN_TUTUP_MASSAL_DATA_LAMA`. Flag ini
mati secara bawaan; hanya nilai persis `true` yang menyalakannya. Selama mati,
panel tidak tampil (`dapatMenutup: false`) dan endpoint menjawab 409.

Nyalakan flag **hanya setelah** keputusan gerbang (a) **dieksekusi** atau
**ditolak**:
- "isi": `--isi-pengolah --apply` §8.1 sudah selesai;
- "tidak": keputusan itu sudah tercatat di gerbang (a).

Isi variabel di Vercel env backend, lalu **redeploy**. Catat waktu dan
penyetujunya di baris gerbang CTRL-5.

Setelah flag menyala, super admin atau admin unit pengawas dapat memakai
**Tutup massal data lama** di tab Berkas Rangkaian (lihat PANDUAN 5.5).
Rangkaian tanpa pengolah diberkaskan ke unit pencatat. Rangkaian yang calon
pengolahnya belum terisi selalu dikecualikan dari pratinjau dan eksekusi.
Calon pengolah belum terisi berarti: pengolah NULL, induk `data_lama`, dan
peserta `disposisi_lama` berisi tepat satu direktorat.

Rollback: kosongkan variabel lalu redeploy. Rangkaian yang sudah diberkaskan
tetap diberkaskan.

## 9. Nyalakan flag (terpisah, setelah sign-off terpisah)

Nyalakan `RANGKAIAN_DISPOSISI_LAMA_READ=true` **hanya** setelah sign-off
tertulis terpisah dari sign-off SHA backfill. Sampai saat itu peserta data
lama tidak memberi akses baca.

Menyalakan flag berarti mengisi variabel env di Vercel **dan me-redeploy** —
Vercel hanya menerapkan perubahan env pada deployment baru. Rollback flag
berarti mengosongkan variabel dan me-redeploy; ini mencabut semua akses lintas
unit yang berasal dari backfill **hanya selama** `unit_pengolah_id` masih NULL
(lihat §8.1 — bila mode pengolah sudah dijalankan, mematikan flag tidak
mencabut akses pengolah).

## 10. Rollback

Migrasi **tidak pernah dibalik**. Setelah `0048_rangkaian_pengerasan`
diterapkan, lantai rollback adalah **kode P3+**: rilis pra-P3 (dan P2, yang
tidak pernah dirilis) menulis `surat_distributions` tanpa `rangkaian_id`, yang
ditolak 0048 dengan `23502`. `docs/RUNBOOK_INTEGRASI_SURAT_P3.md` §6
("rilis produksi terakhir yang pernah dideploy" sebagai lantai rollback)
tidak berlaku setelah 0048 diterapkan; setelah 0048 hanya kode P3 atau lebih
baru yang menjadi target rollback yang valid.

1. Redeploy kode P3+ terakhir yang stabil (frontend dan backend dari revisi
   yang sama). Periksa `/ready` = 200.
2. Data tetap kompatibel-baca: baris `rangkaian_*`, `unit_pengolah_id` hasil
   backfill, dan `audit_log` tetap ada.
3. Bila skema harus dibatalkan, jalankan migrasi maju
   `ALTER COLUMN rangkaian_id DROP NOT NULL` — jangan pernah mengedit skema
   secara manual — atau pulihkan dari backup §2.
