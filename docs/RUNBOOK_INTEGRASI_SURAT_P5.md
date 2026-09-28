# Runbook Deploy Integrasi Surat — P5 (Pengerasan 0048 + Backfill Data Lama)

Berlaku untuk rilis yang memuat migrasi `0048_rangkaian_pengerasan` dan skrip backfill
`backend/scripts/backfill-rangkaian-lama.mjs`. Produksi memakai Vercel + Neon; jalur
Cloud SQL/psql lain tidak dipakai untuk backfill data lama (§4).

**Prasyarat runbook ini:** `docs/RUNBOOK_INTEGRASI_SURAT_P1.md`, `docs/RUNBOOK_INTEGRASI_SURAT_P3.md`
(§7 dan §8) sudah dijalankan dan gerbang rilisnya disahkan; CI "Backend Tests
(PostgreSQL 16/17/18)" hijau pada head P5, termasuk suite 0048 PGlite dan Postgres.
Jangan menaruh connection string di argumen baris perintah atau berkas riwayat
shell — ikuti pola prompt tersembunyi yang sama dengan `RUNBOOK_INTEGRASI_SURAT_P1.md`
untuk setiap variabel `NEON_*_DATABASE_URL` di bawah.

## 1. Prasyarat

1. Jawaban tertulis pre-flight P0 §13 pertanyaan 2 ("apakah ada data lama di
   produksi?") harus sudah tersedia. **Bila tidak ada data lama**, hentikan
   runbook ini setelah langkah 3 (migrasi 0048) — langkah 5–8 (dry-run, sign-off,
   apply, flag) tidak perlu dijalankan.
2. Gerbang rilis P5 "Gerbang rilis P5" pada deskripsi PR (baris a–i, lihat §7)
   sudah diisi (disahkan atau ditolak) untuk setiap baris yang berlaku sebelum
   langkah manapun di bawah dijalankan pada produksi.
3. **Deploy kode P5 dengan `RANGKAIAN_DISPOSISI_LAMA_READ` tidak diset (mati)**,
   sebelum langkah migrasi/backfill di bawah. Konfirmasi di Vercel env project
   backend bahwa flag **tidak** bernilai persis `true` sebelum `--apply` (§5).
   Kode produksi sudah menghormati flag ini sejak P2 (`visibility-spec.ts`), jadi
   flag yang sudah menyala sebelum sign-off memberi akses baru fail-open segera
   setelah baris peserta ditulis backfill.

## 2. Backup

Ikuti `docs/BACKUP_NEON.md` memakai helper dari checkout yang **sedang berjalan
di produksi** (pre-0048). Backup yang diambil **setelah** 0048 diterapkan wajib
memakai helper dari checkout P5, karena manifest bundle backup mengikat rantai
migrasi (`scripts/neon-backup-core.mjs:43-58`).

## 3. Pre-0048: kueri NULL dan keputusan `dilewati` (gerbang rilis baris f)

Sebagai role **read-only** (pola aman §0 `RUNBOOK_INTEGRASI_SURAT_P1.md`):

```sql
SELECT count(*) FROM surat_distributions WHERE rangkaian_id IS NULL;
```

Harus **0**. Bila tidak, jalankan kueri rincian berikut dan putuskan gerbang
rilis baris (f) sebelum melanjutkan:

```sql
SELECT d.id, d.surat_masuk_id, d.status, a.rangkaian_id, r.status AS status_rangkaian
  FROM surat_distributions d
  JOIN rangkaian_anggota a ON a.surat_masuk_id = d.surat_masuk_id
  JOIN rangkaian_surat r ON r.id = a.rangkaian_id
 WHERE d.rangkaian_id IS NULL;
```

**Keputusan gerbang rilis baris (f), sudah dikunci di migrasi ini [CTRL-2]:
tahan 0048.** Migrasi `0048_rangkaian_pengerasan.sql` memuat pemeriksaan
`RAISE EXCEPTION` bila ada baris `rangkaian_id IS NULL` dan **tidak** memuat
prelude yang mematikan trigger `surat_distributions_closed_guard`. Bila kueri
di atas mengembalikan bukan 0, **jangan jalankan migrasi**: selesaikan dulu
setiap entri `dilewati` (jalankan ulang backfill langkah 1 P3 untuk entri
`digabung` yang transien; untuk entri `diberkaskan`, dokumentasikan keputusan
pemilik spesifikasi bersama TU/pengawas unit pencatat — baris itu tetap
ber-`rangkaian_id` NULL secara permanen sampai ada jalur baru).

Baris `dilewati` P3 secara konstruksi berstatus `processed`/`rejected` (tidak
ada disposisi terbuka); Koreksi Berkas **tidak** dapat memperbaikinya karena ia
hanya mengubah `rangkaian_surat`, bukan `surat_distributions`, dan trigger
`surat_distributions_closed_guard` (0046) tidak punya jalur bypass GUC.

## 4. Migrasi 0048

Sebagai bagian dari deploy (adapter Neon):

```powershell
& $cloudNode "--env-file=$cloudEnv" scripts/neon-database.mjs migrate --apply
& $cloudNode "--env-file=$cloudEnv" scripts/neon-database.mjs verify-runtime
```

`verify-runtime` tidak memeriksa privilege tabel `rangkaian_*`; jalankan juga
kueri privilege `simsa_api` pada `RUNBOOK_INTEGRASI_SURAT_P1.md` langkah 4
sebagai role runtime `simsa_api` setelah `verify-runtime` selesai.

## 5. Dry-run backfill data lama

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

Sebelum menjalankan skrip, konfirmasi `SHOW TimeZone;` pada koneksi `simsa_api`
mengembalikan `UTC` (`surat_masuk.created_at` bertipe `timestamp` tanpa zona
dan dibandingkan dengan `$batas::timestamptz`).

Baris JSON pertama yang dicetak skrip berisi `dbUser`, `dbName`, `batasDataLama`,
dan `sumberBatas` — **hentikan segera (Ctrl+C)** bila `dbUser` bukan `simsa_api`
atau `dbName` bukan database produksi yang dimaksud, sama seperti aturan
`RUNBOOK_INTEGRASI_SURAT_P3.md` §4. Catat `batasDataLama` pada hasil runbook ini.

Skrip menulis empat berkas ke `--out`: `pemetaan-label.csv`, `balasan-ditinjau.csv`,
`calon-pengolah.csv`, dan `ringkasan.json` (memuat SHA-256 rencana). **Jangan
commit laporan ini ke repo.** Kirim keempat berkas ke pemilik keamanan.

## 6. Sign-off SHA

Kirim `ringkasan.json` (berisi SHA-256) beserta ketiga CSV ke pemilik keamanan.
Sign-off tertulis wajib menyebut SHA-256 persis dari `ringkasan.json` dry-run
tersebut.

**Stabilitas SHA.** SHA mencakup kondisi yang dievaluasi saat `--apply`
(`sudah_anggota`, total baris, dan `sudah_didisposisikan`). Perubahan apa pun
di antara dry-run dan apply — pengeditan label lama, disposisi baru, atau
tautan baru — memaksa dry-run dan sign-off baru. Jalankan dry-run → sign-off →
apply dalam satu jendela waktu yang singkat.

## 7. `--apply`

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

### 7.1 Gerbang (a): unit pengolah data lama

Spec:358 meminta unit pengolah dari label lama diisi otomatis. `ubahUnitPengolah`
dan Koreksi Berkas hanya menerima unit yang sudah berada di
`unitDalamJangkauanBerkas` (target distribusi ∪ anggota) — peserta
`disposisi_lama` tidak pernah ada di situ, jadi kedua jalur itu **tidak bisa**
dipakai untuk mengisi `unit_pengolah_id` hasil backfill.

Putuskan gerbang rilis baris (a) berdasarkan `calon-pengolah.csv` dan sign-off
pemilik keamanan:
- **"isi"**: jalankan mode pengisian pengolah, SHA-bound dan diaudit:

  ```bash
  npm --prefix backend run rangkaian:backfill-lama:isi-pengolah:plan -- --out=<dir>
  # setelah sign-off SHA baru atas ringkasan.json mode ini:
  npm --prefix backend run rangkaian:backfill-lama:isi-pengolah:apply -- --approved-sha256=<sha256>
  ```

  Jalankan langkah ini **sebelum** Tutup massal data lama mana pun (§7.2) —
  Tutup massal mengunci `unit_pengolah_id` secara terminal begitu rangkaian
  berstatus `diberkaskan`.
- **"tidak"**: spec:358 diwaiver secara sadar; rangkaian data lama akan
  diberkaskan tanpa pengolah (ke pencatat) lewat Tutup massal.

Akses unit pengolah hasil mode ini **tidak dikendalikan** oleh
`RANGKAIAN_DISPOSISI_LAMA_READ`: setelah mode pengolah dijalankan, mematikan
flag tidak mencabut akses itu.

### 7.2 Tutup massal data lama

Setelah keputusan gerbang (a) dijalankan (bila "isi"), super admin atau admin
unit pengawas dapat memakai **Tutup massal data lama** di tab Berkas Rangkaian
(lihat PANDUAN 5.5). Rangkaian tanpa pengolah diberkaskan ke unit pencatat.

## 8. Nyalakan flag (terpisah, setelah sign-off terpisah)

Nyalakan `RANGKAIAN_DISPOSISI_LAMA_READ=true` **hanya** setelah sign-off
tertulis terpisah dari sign-off SHA backfill. Sampai saat itu peserta data
lama tidak memberi akses baca.

Menyalakan flag berarti mengisi variabel env di Vercel **dan me-redeploy** —
Vercel hanya menerapkan perubahan env pada deployment baru. Rollback flag
berarti mengosongkan variabel dan me-redeploy; ini mencabut semua akses lintas
unit yang berasal dari backfill **hanya selama** `unit_pengolah_id` masih NULL
(lihat §7.1 — bila mode pengolah sudah dijalankan, mematikan flag tidak
mencabut akses pengolah).

## 9. Rollback

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
