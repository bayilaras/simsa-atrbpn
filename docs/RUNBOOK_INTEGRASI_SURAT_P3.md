# Runbook Deploy P3: Integrasi Surat Masuk-Keluar (Rangkaian)

Runbook ini mengatur migrasi data dan urutan deploy untuk P3 (rangkaian
surat, disposisi eksplisit, tindak lanjut, Lacak). Produksi memakai
Vercel (`simsa-frontend` + `simsa-backend`, lihat `docs/DEPLOY_VERCEL_NEON.md`)
dan Neon. Ikuti urutan di bawah persis; jangan melompati langkah verifikasi.

P3 **tidak menambah migrasi maupun perubahan grant**. Namun P1 dan P2 belum
pernah dirilis ke produksi, sehingga rilis yang memuat P3 juga membawa skema
`0046_rangkaian_surat` dan `0047_unit_kerja_direktorat` beserta konvergensi
`grants/0002`. Karena itu langkah P1 menjadi prasyarat wajib (§0).

**Keamanan koneksi:** semua kueri manual dan perintah di runbook ini memakai
pola prompt tersembunyi dari `docs/RUNBOOK_INTEGRASI_SURAT_P1.md` (bagian
awal). Jangan pernah menaruh connection string di argumen baris perintah atau
riwayat shell.

## 0. Gerbang prasyarat (sebelum langkah apa pun)

Semua butir berikut wajib tercentang dan dicatat pada hasil menjalankan
runbook ini. Bila satu saja belum terpenuhi, **jangan deploy**.

1. **Pre-flight P0 disahkan**: `docs/PREFLIGHT_INTEGRASI_SURAT_P0.md` selesai,
   blok Pengesahan terisi, dan laporan
   `docs/HASIL_PREFLIGHT_INTEGRASI_SURAT_P0_<tanggal>.md` sudah ter-commit.
2. **Skema P1 (0046/0047)**: jalankan `docs/RUNBOOK_INTEGRASI_SURAT_P1.md`
   langkah 1–4 (backup, preflight read-only, migrasi + konvergensi grant lewat
   adapter Neon, verifikasi hak/skema) sebagai bagian rilis ini. Langkah 5–6
   P1 (backfill dan deploy) digantikan oleh §2 runbook ini. Bila 0046/0047
   ternyata sudah dirilis pada rilis sebelumnya, catat nama rilis dan hasil
   verifikasinya; `migrate --apply` tetap dijalankan (hasil `applied: 0` lalu
   memverifikasi ulang grant).
3. **Gate CI hijau** pada commit P3 yang sudah di-rebase ke `main` (setelah
   P0, P1, dan P2 di-merge):
   - "Backend Tests (PostgreSQL 16)", "(PostgreSQL 17)", dan "(PostgreSQL 18)",
     termasuk langkah `npm run test:postgres-locks` (seluruh
     `backend/integration/*.postgres.test.ts`, termasuk skenario a–e, backfill,
     Ajukan Akses, dan balapan T17-1) serta profil backup-upgrade
     `.github/scripts/test-backup-upgrade-profile.mjs`;
   - "Backend Tests" dan "Frontend Tests".
   Suite PostgreSQL P3 belum pernah dijalankan di luar CI; run CI ini adalah
   bukti pertama. Catat URL run CI-nya.
4. **Gerbang rilis §7 disahkan** (sign-off keamanan dan pemilik spesifikasi).
5. **Satu kali deploy frontend + backend.** UI memperlakukan
   `aksiDiizinkan` dari server sebagai otoritatif; frontend P3 terhadap
   backend lama menyembunyikan Edit/Arsip/Disposisi, dan backend P3 tanpa
   frontend P3 menawarkan alur yang tidak lengkap. Jangan deploy salah satunya
   saja.

## 1. Pre-flight data

1. **Backup** basis data produksi (dilakukan pada §0.2 lewat RUNBOOK_P1
   langkah 1; jangan diulang dengan helper versi berbeda).
2. Bila P2 belum melakukannya, jalankan kueri FRa berikut dan rekonsiliasi
   setiap baris yang muncul sebelum melanjutkan:

   ```sql
   SELECT count(*) FROM arsip
   WHERE trim(klasifikasi_keamanan) = '' AND klasifikasi_keamanan <> '';
   ```

3. Konfirmasi bahwa flag `RANGKAIAN_AJUKAN_AKSES` **tidak** diset (unset),
   bukan `false` secara eksplisit — hanya string `true` yang menyalakannya.
   Hal yang sama untuk `RANGKAIAN_DISPOSISI_LAMA_READ` (milik P5; tidak
   dipakai P3).
4. **[C-10] Disposisi terbuka pada surat yang tersamar bagi penerimanya.**
   Jalankan kueri berikut dengan role baca-saja (kelas kosong/NULL ≡ biasa,
   sama dengan normalisasi aplikasi):

   ```sql
   SELECT coalesce(nullif(lower(regexp_replace(btrim(sm.sifat_surat), '[[:space:]-]+', '_', 'g')), ''), 'biasa') AS kelas,
          d.status, count(*)
     FROM surat_distributions d JOIN surat_masuk sm ON sm.id = d.surat_masuk_id
    WHERE d.status IN ('sent', 'received') AND sm.is_deleted IS NOT TRUE
    GROUP BY 1, 2 ORDER BY 1, 2;
   ```

   Setiap `kelas` yang **bukan** alias biasa
   (`biasa`, `biasa/terbuka`, `terbuka`, `segera`, `sangat_segera`,
   `undangan`, `penting` — `BIASA_SIFAT_ALIASES` di
   `backend/src/services/access/visibility-spec.ts`) tersamar bagi target
   tanpa grant: `terbatas`/`rahasia`/`sangat_rahasia`, dan juga kelas lain yang
   tidak dikenal (kelas tak dikenal tersamar tetapi **tidak** dapat diajukan
   aksesnya). Bila ada baris seperti itu, **tahan deploy** sampai salah satu
   keputusan berikut dicatat tertulis (templat di bawah):
   - (i) sign-off keamanan diperoleh, lalu `RANGKAIAN_AJUKAN_AKSES`
     dinyalakan segera setelah deploy (hanya berlaku untuk kelas
     terkendali; kelas tak dikenal tetap perlu (ii) atau (iii));
   - (ii) TU/pengawas menutup (Tutup Disposisi) atau menerbitkan ulang
     disposisi tersebut **segera setelah** deploy (Tutup adalah aksi P3; tidak
     tersedia sebelum deploy, dan menerbitkan ulang lewat kode lama justru
     membuat baris ber-`rangkaian_id` NULL baru);
   - (iii) diterima bahwa target akan menolaknya (Tolak).

   Ulangi kueri ini **tepat sebelum** deploy (§2 langkah 4): penulis lama
   masih aktif dan dapat menambah baris.

   Templat keputusan (salin ke hasil menjalankan runbook):

   ```text
   C-10 — tanggal/jam kueri: ....   jumlah baris per kelas/status: ....
   Keputusan: (i) / (ii) / (iii)   Alasan: ....
   Diputuskan oleh (nama, jabatan): ....   Disetujui keamanan: ....
   ```

   Catatan rilis untuk TU: "selama flag Ajukan Akses mati, surat
   Terbatas/Rahasia tidak dapat didisposisikan (409)."

## 2. Urutan deploy

Contoh perintah adapter Neon memakai variabel yang sama dengan
`docs/DEPLOY_RENDER_NEON.md` §2 (`$cloudNode` = Node 24 lokal,
`$cloudEnv` = berkas env privat berisi pin target dan akun migrasi):

1. **Backup** — sudah dilakukan pada §0.2 (RUNBOOK_P1 langkah 1).
2. **Migrasi + konvergensi grant + verifikasi runtime** (adapter Neon,
   RUNBOOK_P1 langkah 3–4):

   ```powershell
   & $cloudNode "--env-file=$cloudEnv" scripts/neon-database.mjs migrate --apply
   if ($LASTEXITCODE -ne 0) { throw 'Migrasi/grant gagal; jangan deploy aplikasi' }
   & $cloudNode "--env-file=$cloudEnv" scripts/neon-database.mjs verify-runtime
   if ($LASTEXITCODE -ne 0) { throw 'Verifikasi runtime gagal; jangan deploy aplikasi' }
   ```

   Lalu jalankan kueri hak `rangkaian_surat` dan `unit_kerja` pada
   RUNBOOK_P1 langkah 4 sebagai `simsa_api` (`verify-runtime` tidak
   memeriksanya).

   Jalur Cloud SQL/psql (bukan produksi): `npm --prefix backend run db:migrate`,
   lalu **segera**
   `EXPECTED_MIGRATIONS_JSON="$(python3 .github/scripts/build-migration-manifest.py)" npm --prefix backend run db:grants:converge`
   (tanpa `EXPECTED_MIGRATIONS_JSON` konvergensi menolak berjalan). Skrip
   `db:migrate`/`db:grants:converge` hanya ada di `backend/package.json`, bukan
   di root.
3. **Backfill langkah 1, run pertama (pra-deploy)** — perintah lengkap di §4.
   Run ini boleh berakhir dengan `sisaTanpaRangkaian` > 0 (penulis lama masih
   aktif). Bila berhenti dengan galat `40P01` (deadlock) atau `40001`, lihat
   §4 "Galat konkurensi" — jalankan ulang.
4. **Ulangi kueri C-10 (§1.4)**; tahan bila muncul baris baru tanpa keputusan.
5. **Deploy kode P3** — frontend dan backend bersamaan (§0.5): promosikan
   deployment `simsa-backend` dan `simsa-frontend` dari revisi yang sama
   sesuai `docs/DEPLOY_VERCEL_NEON.md` (tanpa migrasi/seed saat build).
6. **Periksa `/ready` = 200** pada origin produksi (frontend meneruskan
   `/ready` ke backend):

   ```bash
   curl -fsS -o /dev/null -w '%{http_code}\n' https://<origin-produksi>/ready   # harus 200
   ```

   503 berarti kontrak skema P1 belum lengkap (lihat RUNBOOK_P1 langkah 6);
   **hentikan** dan rollback (§6) bila tidak dapat diperbaiki segera.
7. **Backfill langkah 1, run kedua — segera setelah deploy** (§4, perintah
   yang sama). Run ini bebas deadlock terhadap kode P3 (setiap penulis
   distribusi P3 mengunci `surat_masuk` lebih dulu).
8. **Kriteria keluar** (§3).
9. **Langkah pasca-deploy** (§3.1).

`npm run db:backfill:rangkaian-disposisi` bare (tanpa `DATABASE_URL` diset
eksplisit) BUKAN cara yang benar untuk menjalankan langkah ini — lihat §4
untuk alasan dan perintah yang benar.

Penulis lama (`POST /api/distributions` pra-P3) masih aktif sampai kode P3
benar-benar live, sehingga baris `surat_distributions` baru dengan
`rangkaian_id` NULL bisa tetap tercipta selama jendela deploy. Karena itu
skrip backfill (idempoten) **wajib** dijalankan lagi persis setelah deploy P3,
bukan hanya sekali sebelum deploy. [T2-2, C-M3]

## 3. Kriteria keluar (diverifikasi SESUDAH deploy)

Run backfill kedua (§2 langkah 7) harus melapor:
- `sisaTanpaRangkaian: 0`
- `dilewati` kosong (`[]`).

Dan secara independen (role baca-saja):

```sql
SELECT count(*) FROM surat_distributions WHERE rangkaian_id IS NULL;
-- harus 0 (atau hanya baris `dilewati` yang sudah diputuskan di bawah)
```

**Bila `dilewati` tidak kosong** [C-6], setiap entri adalah surat masuk
anggota rangkaian yang bukan `aktif`/`selesai`:
- `status: 'digabung'` — sementara: gabung memindahkan anggota ke rangkaian
  tujuan. Jalankan ulang backfill; entri itu akan terisi ke rangkaian tujuan.
- `status: 'diberkaskan'` — baris lama tidak dapat diisi (trigger 0046
  mengunci berkas). Baris tetap ber-`rangkaian_id` NULL sampai Koreksi Berkas
  (P5) tersedia. Kode P3 memperlakukannya konsisten: dihitung sebagai
  penghalang rangkaian keanggotaannya dan ditolak 409 bila diubah. Catat
  daftar entri; **pemutus**: pemilik spesifikasi bersama TU/pengawas unit
  pencatat — dianggap selesai bila dicatat untuk P5.

Catatan: rangkaian `selesai` yang menerima baris terbuka lewat backfill
tetap `selesai` sampai hitung ulang berikutnya (mis. aksi apa pun pada
rangkaian itu), yang membukanya kembali dengan audit. Berkaskan sudah menolak
rangkaian dengan disposisi terbuka (C-6), jadi ini hanya inkonsistensi
tampilan sementara. [C-M3]

### 3.1 Langkah pasca-deploy

1. **Catat waktu go-live P3** (UTC dan WIB) pada hasil runbook — dipakai P4
   untuk `RANGKAIAN_DATA_LAMA_SEBELUM`.
2. **Smoke EXPLAIN Lacak (T4-6)** pada data berukuran produksi, sebagai
   `simsa_api` (read-only; hanya `EXPLAIN (ANALYZE)` pada kueri seed Lacak
   dengan kata kunci contoh) — catat waktu eksekusi; > 2 detik = batas
   `statement_timeout` Lacak, eskalasi ke P4.
3. Pastikan `admin_unit` sudah ditugaskan untuk `dir_bppt`, `dir_ptep`,
   `dir_ktpp`, `dir_plp` sebelum flag apa pun dinyalakan (grant disposisi
   hanya diajukan ke admin aktif unit target).
4. Catatan rilis TU: 409 "Terjadi konflik penyimpanan bersamaan; silakan coba
   lagi." dapat muncul sesekali saat dua pengguna mengubah surat yang sama
   bersamaan — ulangi aksi.

## 4. Peran dan perintah backfill

Jalankan skrip backfill sebagai role runtime `simsa_api` lewat
`NEON_RUNTIME_DATABASE_URL`. Role itu sudah memegang grant yang diperlukan
(`backend/src/db/grants/0002_converge_application_grants.sql`). **Jangan**
memakai role maintenance terpisah — itu mengubah hash grants/0002 dan pin
Neon. [T2-3]

**Penting — beda dari pola P1.** Pola prompt tersembunyi di
`docs/RUNBOOK_INTEGRASI_SURAT_P1.md:7-27` mengisi variabel
`NEON_QUERY_DATABASE_URL` untuk `psql`. Skrip backfill ini (Node, bukan
`psql`) hanya membaca `DATABASE_URL`, dan **tidak** memakai fallback
`backend/.env` untuk variabel ini — kalau `DATABASE_URL` tidak diset
eksplisit di shell, skrip berhenti dengan error, TIDAK diam-diam
membackfill database lain. Isi `DATABASE_URL` dengan connection string
`simsa_api` (`NEON_RUNTIME_DATABASE_URL`) lewat pola aman di bawah, jalankan
lewat `npm --prefix backend run ...` dari root repo, lalu hapus variabelnya
segera setelah selesai — jangan pernah menaruh connection string di
argumen baris perintah atau berkas riwayat shell.

**Sebelum** menjalankan skrip, pastikan target dengan kueri identitas
read-only memakai connection string yang sama (mis. Neon Console → SQL Editor
dengan role `simsa_api`, atau `psql` lewat pola prompt tersembunyi):

```sql
SELECT current_user, current_database();   -- harus simsa_api dan database produksi yang dimaksud
```

```bash
read -rs NEON_RUNTIME_DATABASE_URL && export NEON_RUNTIME_DATABASE_URL
export DATABASE_URL="$NEON_RUNTIME_DATABASE_URL"
npm --prefix backend run db:backfill:rangkaian-disposisi
unset DATABASE_URL NEON_RUNTIME_DATABASE_URL
```

```powershell
$secure = Read-Host -AsSecureString 'NEON_RUNTIME_DATABASE_URL'
$ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($secure)
try {
    $env:DATABASE_URL = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($ptr)
} finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($ptr)
}
npm --prefix backend run db:backfill:rangkaian-disposisi
Remove-Item Env:\DATABASE_URL
```

Jalankan blok ini dua kali sesuai §2 (sebelum dan segera setelah deploy
kode P3). Baris pertama yang dicetak skrip adalah
`{"dbUser":"...","dbName":"..."}` — periksa sebagai konfirmasi kedua bahwa
`dbUser` = `simsa_api` dan `dbName` = database produksi yang dimaksud. Skrip
**tidak berhenti menunggu** setelah baris ini: batch pertama dapat sudah
ter-commit ketika baris itu terbaca. Karena itu pemeriksaan identitas di atas
wajib dilakukan **sebelum** menjalankan skrip. Bila baris identitas
menunjukkan role atau database yang salah, hentikan segera (Ctrl+C), catat
kejadiannya, dan periksa database tersebut (backfill hanya mengisi
`rangkaian_id` dan membuat rangkaian/anggota ber-audit; tidak menghapus
apa pun). [F3]

**Galat konkurensi (pra-deploy).** Terhadap kode lama yang masih live,
receive/process/reject mengunci baris distribusi lalu trigger 0046 mengambil
kunci rangkaian — kebalikan urutan skrip — sehingga run pra-deploy dapat
berhenti dengan `40P01` (deadlock) atau `40001` dan keluar dengan kode ≠ 0.
Batch yang sedang berjalan digulung balik; batch sebelumnya tetap tersimpan.
Skrip idempoten: **jalankan ulang** perintah yang sama sampai selesai. Run
pasca-deploy bebas deadlock terhadap kode P3. [C-M3]

Kode keluar ≠ 0 tanpa galat berarti `sisaTanpaRangkaian` ≠ 0 atau `dilewati`
tidak kosong — wajar pada run pra-deploy; pada run pasca-deploy ikuti §3.

## 5. Flag

`RANGKAIAN_AJUKAN_AKSES` tetap mati sampai sign-off keamanan (§1.4 dan
gerbang rilis §7). Bila pernah dinyalakan lalu rilis di-rollback, ikuti §6
langkah 4.

## 6. Rollback

Migrasi **tidak pernah dibalik**. Lantai rollback adalah **rilis produksi
terakhir yang pernah dideploy** (sebelum rilis ini), dijalankan di atas skema
0046/0047 yang tetap terpasang — sama dengan RUNBOOK_P1 §Rollback. P2 tidak
pernah dirilis sehingga "redeploy P2" bukan pilihan. Bila skema harus
dibatalkan, pulihkan dari backup §0.2 (RUNBOOK_P1 langkah 1).

> **Catatan P5.** Lantai rollback di atas tidak berlaku setelah 0048
> diterapkan; lantai rollback setelah 0048 adalah kode P3+, karena setiap rilis
> lebih lama (termasuk rilis yang dijadikan lantai di sini) menulis
> `surat_distributions` tanpa `rangkaian_id`, yang ditolak `23502` oleh 0048.
> Lihat `docs/RUNBOOK_INTEGRASI_SURAT_P5.md` §9.

1. **Redeploy** frontend dan backend rilis produksi terakhir bersamaan
   (keduanya dari revisi yang sama). Periksa `/ready` = 200.
2. **Kompatibilitas data.** Kode rilis terakhir (pra-P1) tidak memakai tabel
   `rangkaian_*` maupun kolom baru `surat_distributions`; kolom baru
   nullable/berdefault dan index parsial lebih longgar daripada cek lama.
   Data yang ditulis P3 **tetap ada**: `surat_masuk.status` turunan, baris
   `rangkaian_*`, grant disposisi, dan baris `audit_log`. (Catatan: kode P2 —
   bila kelak dideploy — **membaca** `surat_distributions.rangkaian_id` untuk
   jangkauan peserta, `visibility-spec.ts` `jangkauanSql`; klaim lama bahwa P2
   mengabaikan kolom itu keliru.)
3. **Roll-forward.** Selama rollback, `distribute` lama kembali menulis baris
   ber-`rangkaian_id` NULL. Saat P3 dideploy ulang, jalankan lagi §2 langkah
   3–8: backfill sebelum dan segera setelah deploy, lalu verifikasi
   `sisaTanpaRangkaian: 0` dan `dilewati: []` (§3). Tanpa ini, penerima
   disposisi era rollback kembali mendapat 404 atas suratnya.
4. **Grant disposisi (hanya bila `RANGKAIAN_AJUKAN_AKSES` pernah menyala).**
   Kode lama tidak mencabut grant `[disposisi:<id>]` saat disposisi diproses
   atau ditolak. Cabut semuanya saat rollback (grant yang masih diperlukan
   diajukan ulang lewat alur grant biasa), sebagai `simsa_api` lewat pola
   prompt tersembunyi, dengan `:'aktor'` = id pengguna super_admin yang
   melakukan rollback:

   ```sql
   -- psql: \set aktor '<uuid super_admin pelaksana>'
   BEGIN;
   WITH ditolak AS (
       UPDATE record_access_grants
          SET status = 'denied', decided_by = :'aktor', decided_at = now(),
              decision_reason = 'Rollback P3: grant disposisi dicabut', updated_at = now()
        WHERE status = 'pending' AND entity_type = 'surat_masuk' AND purpose LIKE '[disposisi:%'
       RETURNING id)
   INSERT INTO audit_log (user_id, action, entity_type, entity_id, changes)
   SELECT :'aktor', 'deny_access', 'record_access_grant', id, '{"via":"disposisi","langkah":"rollback-p3"}'::jsonb FROM ditolak;
   WITH dicabut AS (
       UPDATE record_access_grants
          SET status = 'revoked', revoked_by = :'aktor', revoked_at = now(),
              revocation_reason = 'Rollback P3: grant disposisi dicabut', updated_at = now()
        WHERE status = 'approved' AND entity_type = 'surat_masuk' AND purpose LIKE '[disposisi:%'
       RETURNING id)
   INSERT INTO audit_log (user_id, action, entity_type, entity_id, changes)
   SELECT :'aktor', 'revoke_access', 'record_access_grant', id, '{"via":"disposisi","langkah":"rollback-p3"}'::jsonb FROM dicabut;
   SELECT count(*) AS sisa FROM record_access_grants
    WHERE status IN ('pending', 'approved') AND entity_type = 'surat_masuk' AND purpose LIKE '[disposisi:%';  -- harus 0
   COMMIT;
   ```

   Alternatif yang harus dicatat tertulis: menerima kedaluwarsa alami grant
   (maksimum 30 hari) dengan persetujuan keamanan.
5. Catat waktu rollback dan alasannya; `dilewati` backfill yang sudah
   diputuskan tetap berlaku.

## 7. Gerbang rilis (sign-off sebelum produksi)

Setiap butir wajib bertanda tangan (nama, tanggal, keputusan) pada hasil
menjalankan runbook ini; butir yang ditolak menahan rilis sampai diperbaiki.

1. **Sign-off keamanan**:
   - flag `RANGKAIAN_AJUKAN_AKSES` (tetap mati sampai disahkan) dan kebijakan
     disposisi surat terkendali §4.12 (termasuk apakah persetujuan grant boleh
     didelegasikan ke pengawas pemilik);
   - penandaan `ditjen`/`sesditjen` sebagai unit pengawas;
   - Lacak menampilkan nomor/perihal node yang terbaca lewat
     pengawas/peserta/grant tanpa audit `view_via_rangkaian` (konsisten dengan
     semantik daftar; P2 mengaudit bacaan detail yang setara);
   - registrasi Nomor Referensi menjadikan unit pencatat `penulis` (peserta)
     rangkaian rujukan (eskalasi tier sesuai skenario d);
   - `tautan` membolehkan unit peserta menautkan SK-nya ke anggota yang tidak
     dapat dibacanya.
2. **Deviasi C-12** (sahkan atau tolak masing-masing):
   - **T14-3**: Buka Kembali ditolak (409) untuk rangkaian yang selesai
     otomatis (spec:710/715);
   - **G-F3**: isi SK draft/pending/rejected lintas unit tetap terbaca
     (spec §4.4);
   - **C-10**: keputusan tertulis atas disposisi terbuka surat tersamar (§1.4).
3. **CTRL-1**: super_admin tidak pernah dapat Tutup Disposisi (jangkauan unit
   super_admin NULL); menutup disposisi mensyaratkan `admin_unit` unit
   pengawas.
4. **F3**: penghapusan item "Saya Balas/Buat Nota Dinas" dari menu baris
   daftar Surat Masuk (deviasi spec:616; tetap tersedia di detail).
5. **Pertanyaan pemilik spesifikasi**:
   - baris kotak disposisi tersamar menampilkan kode `RS-YYYY-…` (§4.8 vs D7);
   - unit yang disposisinya `processed` mendapat 403 untuk tindak lanjut
     berikutnya;
   - semantik `statusAlur` (balasan_untuk lama, balasan belum disetujui);
   - kelas `sifat_surat` tak dikenal (tersamar bagi target, tidak dapat
     diajukan aksesnya).
6. **CI PostgreSQL hijau** pada PG16, PG17, dan PG18 untuk head P3 yang sudah
   di-rebase (§0.3), termasuk `npm run test:postgres-locks`.
7. **Frontend + backend satu deploy** (§0.5).
8. **Runbook dijalankan lengkap**: backfill sebelum dan sesudah deploy dengan
   `sisaTanpaRangkaian: 0` dan `dilewati: []` (atau keputusan §3), `/ready` =
   200, smoke EXPLAIN tercatat, `admin_unit` `dir_*` ditugaskan sebelum flag
   apa pun dinyalakan.
9. **Urutan merge**: P3 di-merge setelah P0, P1, dan P2 masuk `main`, lalu
   di-rebase dan CI §0.3 diulang pada hasil rebase.

## 8. Deploy P4 (Lacak Surat + Perlu Dilengkapi)

P4 ditumpuk di atas P3 dan dirilis setelah gerbang §7 disahkan. Bagian ini
tidak mengubah langkah P3 di atas.

1. **Isi env batas data lama sebelum kode P4 aktif.** Di Vercel (proyek
   backend), isi `RANGKAIAN_DATA_LAMA_SEBELUM` dengan waktu kode P3 aktif di
   produksi, ISO-8601 **berzona** (mis. `2026-10-05T00:00:00+07:00`). Vercel
   hanya menerapkan perubahan env pada deployment **baru**: isi variabel
   sebelum memicu deployment produksi P4, atau redeploy setelah mengisinya.
   Bila dibiarkan kosong, batas diturunkan dari `min(created_at)` rangkaian
   non-`data_lama` (§7 D7). Nilai yang tidak valid membuat setiap panggilan
   Perlu Dilengkapi (`/api/rangkaian/perlu-dilengkapi*`, termasuk badge
   sidebar) gagal 500 — disengaja agar salah konfigurasi tidak senyap.
2. **Pastikan zona waktu sesi database = UTC.** `created_at` bertipe
   `timestamp` tanpa zona dan dibandingkan dengan `$batas::timestamptz`.
   Periksa dengan role runtime lewat pola prompt tersembunyi §4:

   ```bash
   read -rs NEON_RUNTIME_DATABASE_URL && export NEON_RUNTIME_DATABASE_URL
   psql "$NEON_RUNTIME_DATABASE_URL" -c 'SHOW TimeZone;'   # harus UTC (bawaan Neon)
   unset NEON_RUNTIME_DATABASE_URL
   ```

3. **Tidak ada migrasi.** P4 tidak menambah migrasi, grant, role, flag, atau
   limiter; hash `grants/0002` dan pin Neon tidak berubah.
4. **Smoke test pasca-deploy.** Sebagai pengguna FULL_ADMIN, panggil
   `GET /api/rangkaian/perlu-dilengkapi/ringkasan` dan harapkan 200 dengan
   `data.batasDataLama` sama dengan instan yang dikonfigurasi (boleh tampil
   dalam UTC). 500 berarti nilai env rusak: perbaiki env lalu redeploy.
5. **Catat nilainya.** Tulis nilai persis `RANGKAIAN_DATA_LAMA_SEBELUM` pada
   hasil runbook ini. Backfill P5 wajib memakai nilai yang sama persis.
6. **Rollback.** Redeploy rilis P3 terakhir. Nilai `asal_naskah='inisiatif'`
   yang ditulis Tandai Inisiatif tetap tersimpan dan diterima P3 (kolom dan
   CHECK-nya sudah ada sejak `0046_rangkaian_surat.sql`).

### 8.1 Gerbang rilis P4 (keamanan / pemilik spec)

Setiap baris dicatat **disahkan** atau **ditolak** sebelum produksi:

| Item | Sumber | Keputusan |
|---|---|---|
| Tandai Inisiatif diotorisasi kebijakan list + unit pemilik, bukan `check()` | spec §13, rencana P4 D7 | sign-off keamanan |
| O1: rangkaian hasil backfill langkah 1 (`asal='surat_masuk'`, `selesai`) muncul di `siap_diberkaskan` dan badge | spec §7 D7 | pemilik spec: dihitung data lama atau tidak |
| G-F3: SK draf lintas unit terbaca; `tindak_lanjut_tertahan` menawarkan "Buka surat" | P3 G-F3 | sign-off keamanan (bawaan P3) |
| p95 Lacak dan masukan pg_trgm | spec §6, §13 no. 3 | penerimaan pemilik bila p95 ≥ 150 ms |
| Lacak menampilkan nomor/perihal node terbaca via pengawas/peserta/grant tanpa audit `view_via_rangkaian`/`markGrantUsed` (semantik list) | P3 carry-forward akses 5 | sign-off keamanan |
| `POST /:id/tautan` lewat `anggotaId` menutup `sm_belum_ditindaklanjuti` untuk SM yang tidak dapat dibaca unit peserta | P3 carry-forward akses 7 | pemilik spec |
| Baris grant (`ajukan-akses`, `record-access-grants/mine`) memperlihatkan `entityId`/kelas tersamar (P3 M-1) | P3 carry-forward akses 9 | sign-off keamanan, atau "diperbaiki" |
| Baris kotak disposisi tersamar menampilkan `RS-YYYY-…` sementara placeholder D7 tanpa rangkaian | P3 T10 | pemilik spec (bawaan P3) |
| Gerbang C-12 P3 (§7) disahkan sebelum P4 ke produksi | §7 | prasyarat |
| CI "Backend Tests (PostgreSQL 16/17/18)" hijau pada head P4, termasuk `lacak-explain` dan semua `integration/*.postgres.test.ts` P3 | `ci.yml` | gerbang keras |
| Frontend dan backend satu deploy (`aksiDiizinkan` otoritatif di UI) | P3 catatan rilis frontend | gerbang keras |
| Anggaran `generalLimiter` per IP: (jumlah tab FULL_ADMIN di balik NAT kantor × 15 + polling notifikasi yang ada) < 500 per 15 menit — pemilik menerima, atau menjadwalkan re-key per pengguna (P5 Task 15) dengan sign-off | `rate-limiter.middleware.ts` | pemilik |
