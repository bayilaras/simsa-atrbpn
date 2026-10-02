# Rilis Gabungan Integrasi Surat Masuk–Keluar (P0–P5)

Dokumen ini adalah urutan tunggal untuk merge dan rilis produksi keenam fase integrasi surat (P0–P5). Isinya merangkum dan **tidak menggantikan** runbook per fase. Langkah rinci, kueri, dan pola shell tetap mengikuti:

- `docs/PREFLIGHT_INTEGRASI_SURAT_P0.md` — pre-flight read-only P0;
- `docs/RUNBOOK_INTEGRASI_SURAT_P1.md` — skema 0046/0047, konvergensi grant, pola prompt tersembunyi;
- `docs/RUNBOOK_INTEGRASI_SURAT_P3.md` — backfill langkah 1, deploy P3, gerbang §7, deploy P4 §8, gerbang P4 §8.1;
- `docs/RUNBOOK_INTEGRASI_SURAT_P5.md` — 0048, backfill data lama, flag;
- draf deskripsi PR P3, P4, dan P5 (`pr-p3-body.md`, `pr-p4-body.md`, `pr-p5-body.md` di folder `.superpowers/sdd/…` masing-masing worktree).

Bila dokumen ini bertentangan dengan runbook fase, **runbook fase yang berlaku**. Koreksi rilis gabungan yang ditandai **[GABUNGAN]** di bawah sudah dimuat juga di runbook fase: migrasi bertahap di runbook P3 §2 langkah 2 dan runbook P5 §5, helper backup pra-0048 di runbook P5 §2, dan CTRL-2 yang diamandemen di runbook P5 §3–§4.

Produksi memakai Vercel (`simsa-frontend` + `simsa-backend`) dan Neon. Semua connection string dimasukkan lewat prompt tersembunyi (`RUNBOOK_INTEGRASI_SURAT_P1.md`, bagian awal). Jangan pernah menaruhnya di argumen baris perintah atau riwayat shell.

## 1. Urutan merge

**Status per 2026-10-02: keenam branch sudah di-push ke `origin`.** Heads di bawah adalah heads di `origin` saat PR per fase dibuat (base bertumpuk: P0→`main`, P1→P0, …, P5→P4). CI sudah hijau penuh pada PG16/17/18 (termasuk `LACAK_PERF`, audit keamanan, lint, frontend) lewat PR uji #16 (P0–P3 @ `cbb6d0c`) dan #17 (P0–P5 @ `51071a9`); kedua PR uji itu ditutup setelah PR per fase ada. Setelah setiap rebase, catat head baru di kolom "Head setelah rebase".

**Status per 2026-10-03: P0–P4 sudah di-merge ke `main`.** Setiap branch diperbarui dengan *merge* `main` (bukan rebase, tanpa force push), base PR diganti ke `main`, dan CI penuh diulang pada head itu sebelum merge. Merge commit di `main`: P0 #18 `51679d3`, P1 #19 `57c5c90`, P2 #20 `8c267bd`, P3 #21 `05b3ede`, P4 #22 `7c18964`. **C47 = `7c18964`.** P5 (#23) sudah diperbarui dengan `main` dan menunggu langkah 10 (§3).

| Urutan | Branch | Head di `origin` | Commit di atas branch sebelumnya | Ditumpuk di atas | Isi singkat | Head setelah rebase |
|---|---|---|---|---|---|---|
| 1 | `feat/integrasi-surat-p0` | `164334c` | 15 (di atas `origin/main` `5f57b39`) | `origin/main` | Pre-flight read-only, perbaikan bug P0, paritas klasifikasi TS/SQL | |
| 2 | `feat/integrasi-surat-p1` | `df0b247` | 29 | P0 | Migrasi 0046/0047, REVOKE DELETE `rangkaian_*`, `rangkaianService` inti, runbook P1 | |
| 3 | `feat/integrasi-surat-p2` | `a57b0a3` | 26 | P1 | Akses lintas unit (`visibility-spec.ts`, `checkRead`), panel Alur Surat baca | |
| 4 | `feat/integrasi-surat-p3` | `cbb6d0c` | 53 (termasuk jalur frontend yang digabung di `d890ff2`, plus perbaikan CI: fixture mandat dan pembaruan dependensi keamanan) | P2 | Tindak lanjut, disposisi, inisiatif, backfill langkah 1, Lacak backend, runbook P3 | |
| 5 | `feat/integrasi-surat-p4` | `a545c3f` | 44 (termasuk perbaikan performa Lacak/Perlu Dilengkapi dan `SET LOCAL jit = off`) | P3 | Lacak Surat UI, Berkas Rangkaian, Perlu Dilengkapi (D7) | |
| 6 | `feat/integrasi-surat-p5` | ujung branch `feat/integrasi-surat-p5` saat PR dibuat (per 2026-10-02: `51071a9` sebelum pembaruan dokumen ini) | 42 | P4 | 0048, 0049 `pg_trgm`, backfill data lama, Koreksi Berkas, Tutup massal, notifikasi, ekspor, PANDUAN, runbook P5 | |

Aturan merge:

1. **PR #15 di-merge lebih dulu ke `main`** (spec §10-P0 dan §12: "Dimerge setelah PR #15"). Sesudah itu P0 di-rebase ke `origin/main` yang baru, dengan tetap menjaga `getStats`, `arsip.service`, `ArchiveDialog`, `KlasifikasiPicker`, dan `dosir.service` tidak tersentuh.
2. Merge berurutan P0 → P1 → P2 → P3 → P4 → P5. **[GABUNGAN] P5 baru di-merge setelah langkah 10 (§3) bersih** (CTRL-2 diamandemen: menahan 0048 berarti menahan seluruh P5, termasuk merge dan deploy). Setelah setiap merge, branch berikutnya di-rebase ke `main` terbaru dan **CI diulang pada hasil rebase**. Hasil CI branch yang belum di-rebase tidak berlaku.
3. **CI wajib hijau pada setiap head hasil rebase**, sebagai syarat merge fase itu:
   - "Backend Tests", "Frontend Tests";
   - "Backend Tests (PostgreSQL 16)", "(PostgreSQL 17)", "(PostgreSQL 18)", termasuk langkah `npm run test:postgres-locks` (semua `backend/integration/*.postgres.test.ts`) dan profil backup-upgrade `.github/scripts/test-backup-upgrade-profile.mjs`;
   - mulai P4: langkah **"Run Lacak EXPLAIN and p95 gate (LACAK_PERF)"** (`LACAK_PERF=1`) pada PG16/17/18. EXPLAIN index dan non-vakum D7 adalah gerbang keras; p50/p95 dicatat di PR;
   - `npm run test:migration-manifest` di root;
   - mulai P5: journal berisi 50 entri (idx 0–49), termasuk `0049_lacak_trgm` dari Task 14. Bila `main` mendapat migrasi baru sebelum P5 di-merge, turunkan ulang `idx`/`when` 0048 dan 0049 dan ulangi `test:migration-manifest` (P5-C-11).

   Suite PostgreSQL P3–P5 sudah dijalankan di CI (PR uji #16/#17, PG16/17/18) dan lokal pada PG18. Hasil itu berlaku untuk head sebelum rebase; **ulangi CI pada setiap head hasil rebase** dan catat URL run CI per fase di tabel gerbang (§4).
4. **Merge ke `main` bukan rilis produksi.** Pastikan merge tidak memicu deploy produksi otomatis: promosi Vercel dilakukan manual dan terverifikasi (`docs/DEPLOY_VERCEL_NEON.md`).

   **[TEMUAN 2026-10-02] Frontend.** `git.deploymentEnabled.main: false` di `frontend/vercel.mjs` **tidak dipatuhi Vercel**: merge P0 dan P1 membuat deployment production `simsa-frontend` dari `main`, dan alias produksi kini menunjuk ke frontend `main` setelah P1 (`dpl_FX5TYmMpALcibypXPJbiqiXKmiYs`). Backend (`backend/vercel.json`) tidak terdampak. Sebagai penahan, proyek Vercel `simsa-frontend` diberi **Ignored Build Step**:

   ```bash
   if [ "$VERCEL_ENV" = "production" ] && [ -n "$VERCEL_GIT_COMMIT_REF" ] && [ "$SIMSA_VERIFY_CANDIDATE_SOURCE" != "1" ]; then exit 0; else exit 1; fi
   ```

   Deployment production dari merge P2, P3, dan P4 terbukti `CANCELED`. Konsekuensi untuk rilis: deploy production frontend dari checkout git (`vercel --prod --skip-domain`) **wajib** membawa `SIMSA_VERIFY_CANDIDATE_SOURCE=1` sebagai build env. Belum dibuktikan bahwa nilai `--build-env` sudah tersedia saat Ignored Build Step berjalan; pada rilis pertama, pastikan build kandidat tidak berstatus `CANCELED`. Bila terlewati, kosongkan Ignored Build Step sesaat untuk deploy kandidat, lalu pasang lagi. Tombol "Redeploy" production di dashboard juga ikut terlewati.

   **[GABUNGAN] Backup terjadwal.** Workflow terjadwal `backup-neon.yml` berjalan dari branch bawaan, dan manifest backup mengikat rantai migrasi secara eksak (`scripts/neon-backup-core.mjs`). Selama rantai journal di `main` berbeda dengan rantai database produksi, backup terjadwal harian akan gagal. Ini terjadi sejak P1 masuk `main` sampai 0046/0047 diterapkan, dan sejak P5 masuk `main` sampai 0048/0049 diterapkan. Karena P5 baru di-merge ketika 0048 dapat langsung diterapkan (langkah 10–14), jarak kedua cukup pendek. Rapatkan jarak antara merge dan rilis, atau ambil backup manual dengan helper checkout yang cocok.
5. **Dua checkout rilis** dipakai di §3. Keduanya diambil dari `main` setelah merge:
   - **C47** — commit merge P4 di `main` (journal berakhir di `0047_unit_kerja_direktorat`);
   - **C48** — commit merge P5 di `main` (journal berakhir di `0049_lacak_trgm`, setelah `0048_rangkaian_pengerasan`). C48 baru ada setelah langkah 11.

## 2. Prasyarat sebelum hari rilis

- [ ] PR #15 di-merge. P0–P4 di-merge berurutan dengan CI hijau pada setiap head hasil rebase (§1); P5 **baru** di-merge di langkah 11 (§3), setelah pre-0048 langkah 10 bersih.
- [ ] Pre-flight P0 dijalankan dengan role Neon read-only (`docs/PREFLIGHT_INTEGRASI_SURAT_P0.md`):
  - laporan `docs/HASIL_PREFLIGHT_INTEGRASI_SURAT_P0_<tanggal>.md` dan fixture `sifat-surat-produksi.json` ter-commit;
  - `visibility-spec.parity.test.ts` PASS;
  - blok Pengesahan terisi.

  Jawaban `data_lama_ringkasan` menjadi gerbang P5 (e).
- [ ] Uji asap manual staging P4 (`RUNBOOK_INTEGRASI_SURAT_P3.md` §8 langkah 6, butir 1–11) dijalankan pada deployment preview dengan head rilis, dan hasilnya dicatat di PR P4.
- [ ] Semua baris gerbang di §4 berstatus **disahkan**, kecuali yang secara eksplisit dijadwalkan "setelah deploy". Satu baris **ditolak** menahan rilis.
- [ ] Env Vercel backend produksi:
  - `RANGKAIAN_AJUKAN_AKSES` **tidak diset**;
  - `RANGKAIAN_DISPOSISI_LAMA_READ` **tidak diset**;
  - `RANGKAIAN_TUTUP_MASSAL_DATA_LAMA` **tidak diset** (CTRL-5; baru dinyalakan di langkah 19);
  - `RANGKAIAN_DATA_LAMA_SEBELUM` **kosong**, karena P3 dan P4 aktif dalam deploy yang sama (runbook P3 §8 langkah 1, "Deploy gabungan").
- [ ] `admin_unit` untuk `dir_bppt`, `dir_ptep`, `dir_ktpp`, dan `dir_plp` siap ditugaskan segera setelah 0047 (RUNBOOK_P1 Catatan Minor 4; runbook P3 §3.1.3).
- [ ] Catatan rilis TU disiapkan: 409 disposisi surat terkendali selama flag Ajukan Akses mati, 409 konflik penyimpanan bersamaan, dan menu baris Surat Masuk tanpa "Saya Balas".

## 3. Urutan produksi

Setiap langkah dicatat (waktu UTC dan WIB, operator, hasil) di hasil rilis. **Hentikan** pada kegagalan pertama dan lihat §5 untuk rollback tahap tersebut.

### Tahap A — Skema 0046/0047 dan backfill langkah 1

1. **Backup #1.** Pakai helper dari checkout yang **sedang berjalan di produksi** (rantai 0045), sesuai `docs/BACKUP_NEON.md` dan RUNBOOK_P1 langkah 1.
2. **Pre-flight read-only** dengan role read-only:
   - ulangi pemeriksaan pre-flight P0 bila laporan sudah lebih lama dari jendela yang disepakati;
   - RUNBOOK_P1 langkah 2: ketiga kueri pertama harus kosong;
   - RUNBOOK_P3 §1.2 (kueri FRa `arsip`) dan §1.4 (kueri C-10, disposisi terbuka per kelas). Bila ada kelas terkendali, tahan sampai keputusan C-10 tertulis.
3. **[GABUNGAN] Migrasi 0046/0047 dari checkout C47**, bukan C48, lewat adapter Neon:

   ```powershell
   # dari checkout C47 (journal berakhir di 0047)
   & $cloudNode "--env-file=$cloudEnv" scripts/neon-database.mjs migrate --apply
   if ($LASTEXITCODE -ne 0) { throw 'Migrasi/grant gagal; jangan deploy aplikasi' }
   & $cloudNode "--env-file=$cloudEnv" scripts/neon-database.mjs verify-runtime
   if ($LASTEXITCODE -ne 0) { throw 'Verifikasi runtime gagal; jangan deploy aplikasi' }
   ```

   **Alasan.** Adapter menjalankan **semua** migrasi tertunda dalam **satu transaksi** (`backend/scripts/migrate-database.mjs`) lalu langsung mengonvergensikan `grants/0002`. Tidak ada opsi target. Dari checkout C48, 0046, 0047, dan 0048 akan berjalan bersama. Setelah 0046, setiap baris `surat_distributions` lama masih ber-`rangkaian_id` NULL, sehingga precheck 0048 RAISE dan seluruh transaksi digulung balik. Rilis pun macet, walaupun tidak ada kerusakan data. Dari C48, 0048 dan 0049 juga berjalan dalam satu transaksi; 0049 mensyaratkan `pg_trgm` dari langkah privileged (langkah 13.1), dan tanpa itu 0049 RAISE dan 0048 ikut digulung balik.

   Lalu, sebagai `simsa_api`, jalankan kueri hak `rangkaian_surat` dan `unit_kerja` dari RUNBOOK_P1 langkah 4 (`verify-runtime` tidak memeriksanya). Tugaskan `admin_unit` `dir_*`.
4. **Backfill langkah 1, run pertama (pra-deploy).** Jalankan `npm --prefix backend run db:backfill:rangkaian-disposisi` sebagai `simsa_api` (RUNBOOK_P3 §4: kueri identitas dulu, `DATABASE_URL` hanya dari shell). Run ini boleh berakhir dengan `sisaTanpaRangkaian > 0`. Bila berhenti dengan `40P01`/`40001`, jalankan ulang (skrip idempoten). Ulangi kueri C-10 tepat sebelum deploy.

### Tahap B — Deploy kode dan kriteria keluar P3

5. **Deploy kode C47: frontend dan backend dalam satu deploy**, dari revisi yang sama (`aksiDiizinkan` dari server otoritatif di UI). Flag tetap tidak diset, dan `RANGKAIAN_DATA_LAMA_SEBELUM` kosong. P5 belum di-merge pada titik ini (CTRL-2 diamandemen; lihat langkah 10).
6. **`/ready` = 200** pada origin produksi (runbook P3 §2 langkah 6). 503 berarti kontrak skema belum lengkap: hentikan, lalu jalankan rollback tahap B (§5).
7. **Backfill langkah 1, run kedua — segera setelah deploy.** Kriteria keluar (runbook P3 §3):
   - `sisaTanpaRangkaian: 0`;
   - `dilewati: []`;
   - `SELECT count(*) FROM surat_distributions WHERE rangkaian_id IS NULL` = 0.

   Bila `dilewati` tidak kosong: entri `digabung` → jalankan ulang; entri `diberkaskan` → **gerbang P5 (f): tahan seluruh P5** (lihat langkah 10).
8. **Smoke test dan pencatatan:**
   - catat **waktu go-live P3** (UTC/WIB);
   - EXPLAIN (ANALYZE) Lacak (runbook P3 §3.1.2);
   - `GET /api/rangkaian/perlu-dilengkapi/ringkasan` sebagai FULL_ADMIN (runbook P3 §8 langkah 4b, env kosong) harus 200, dengan `data.batasDataLama` ≈ waktu backfill run pertama, **bukan** "sekarang";
   - `SHOW TimeZone` = `UTC` untuk `simsa_api` (runbook P3 §8 langkah 2):

     ```bash
     read -rs NEON_RUNTIME_DATABASE_URL && export NEON_RUNTIME_DATABASE_URL
     psql "$NEON_RUNTIME_DATABASE_URL" -c 'SHOW TimeZone;'   # harus UTC
     unset NEON_RUNTIME_DATABASE_URL
     ```
9. **Sematkan batas data lama.** Isi `RANGKAIAN_DATA_LAMA_SEBELUM` di Vercel dengan `batasDataLama` dari langkah 8 (ISO-8601 berzona), lalu **redeploy**. Vercel hanya menerapkan env pada deployment baru. Ulangi smoke `ringkasan`: nilainya harus sama. Catat nilai persisnya. Backfill P5 wajib memakai nilai yang **sama persis**.

### Tahap C — Keputusan P5 dan pengerasan 0048

10. **Pre-0048 pada database 0047, dengan kode C47 berjalan** (sebagai `simsa_api`, pola prompt tersembunyi). Ketiga kueri harus menghasilkan 0 / kosong:

    ```sql
    SELECT count(*) FROM surat_distributions WHERE rangkaian_id IS NULL;                -- 0
    SELECT rangkaian_id, count(*) FROM rangkaian_koreksi_berkas
     WHERE status IN ('pending', 'approved') GROUP BY rangkaian_id HAVING count(*) > 1; -- kosong
    SELECT id FROM rangkaian_koreksi_berkas
     WHERE (status = 'pending') <> (diputuskan_by IS NULL)
        OR (diputuskan_by IS NULL) <> (diputuskan_at IS NULL)
        OR (unit_pengolah_baru = unit_pengolah_lama AND klasifikasi_baru = klasifikasi_lama); -- kosong
    ```

    Bila kueri pertama bukan 0: jalankan kueri rincian runbook P5 §4 dan **tahan seluruh P5** (CTRL-2 diamandemen, gerbang f). Tidak ada prelude yang mematikan trigger. Selama penahanan:
    - P5 **tidak di-merge ke `main` dan tidak dideploy**. Produksi tetap pada kode C47 di rantai 0047, sehingga backup terjadwal dari `main` tetap cocok dengan rantai database;
    - backfill langkah 2 (`--apply`) juga tidak dapat berjalan, karena skrip menolak selama masih ada `rangkaian_id` NULL. Gerbang (a) dan (c) menunggu;
    - catat di gerbang (f): P5 belum dirilis, pemilik keputusan, dan syarat pelepasan (semua baris NULL terselesaikan). Rilis gabungan berakhir di sini, di P4.

    Bila kueri kedua atau ketiga tidak kosong, rekonsiliasi dulu bersama pemilik data. Pada database yang hanya pernah menjalankan kode C47, kedua kueri ini seharusnya kosong.
11. **Merge P5** ke `main` (rebase, CI hijau, §1) → checkout **C48**.
12. **[GABUNGAN] Backup #2 (pra-0048)** dengan helper dari **checkout C47**. Database masih di rantai 0047, dan helper C48 akan menolak rantai itu.
13. **Langkah privileged pg_trgm, lalu migrasi 0048/0049 dari checkout C48, dengan kode C47 masih berjalan** (bertahap, runbook P5 §5.1–§5.2). Kode C47 aman di atas skema 0048/0049: 0048 hanya menambah batasan yang sudah dipenuhi C47 (pra-cek langkah 10 bersih), dan 0049 hanya menambah index. Kode C48 **belum** dideploy (langkah 14).
    1. **Sebelum migrasi**, administrator grant Neon (pemilik database, `NEON_ADMIN_DATABASE_URL`; **bukan** `simsa_migration`) menjalankan `backend/src/db/grants/0003_optional_pg_trgm.sql` satu kali. Skrip menolak migrator dan memverifikasi versi bawaan, skema `public`, dan pemilik. `pg_trgm` didukung Neon dan bertanda *trusted*, sehingga pemilik database cukup; idempoten.

       ```bash
       read -rs NEON_ADMIN_DATABASE_URL && export NEON_ADMIN_DATABASE_URL
       psql "$NEON_ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/src/db/grants/0003_optional_pg_trgm.sql
       unset NEON_ADMIN_DATABASE_URL
       ```
    2. Ulangi ketiga kueri langkah 10 tepat sebelum migrasi.
    3. Jalankan migrasi (0048 dan `0049_lacak_trgm` dalam satu transaksi) lalu verifikasi:

       ```powershell
       # dari checkout C48 (journal berakhir di 0049)
       & $cloudNode "--env-file=$cloudEnv" scripts/neon-database.mjs migrate --apply
       if ($LASTEXITCODE -ne 0) { throw 'Migrasi/grant gagal' }
       & $cloudNode "--env-file=$cloudEnv" scripts/neon-database.mjs verify-runtime
       ```
    4. Kueri hak RUNBOOK_P1 langkah 4 sebagai `simsa_api`. Periksa `/ready` = 200 (kode C47). Sejak titik ini **lantai rollback adalah kode P3+** (§5). Setelah itu ambil **Backup #3** dengan helper checkout C48.
14. **Deploy kode C48: frontend dan backend dalam satu deploy — HANYA setelah 0049 diterapkan (langkah 13).** Seed Lacak C48 dirancang untuk index trigram 0049; di atas skema 0047 kueri nomor tetap benar tetapi kembali ke seq scan atas kedua tabel (p95 ±0,44–1,06 s; baris rollback "Index trigram 0049" dan runbook P5 §10.1). `RANGKAIAN_DISPOSISI_LAMA_READ`, `RANGKAIAN_TUTUP_MASSAL_DATA_LAMA`, dan `RANGKAIAN_AJUKAN_AKSES` tetap tidak diset; `RANGKAIAN_DATA_LAMA_SEBELUM` tetap nilai langkah 9. Periksa `/ready` = 200.

### Tahap D — Data lama (hanya bila gerbang (e) = "ada data lama")

Bila gerbang (e) = tidak ada data lama, rilis selesai setelah langkah 14. Lewati langkah 15–20 dan tandai gerbang (a), (b), (c), (g), (h), dan CTRL-5 "tidak berlaku".

15. **Dry-run backfill langkah 2** sebagai `simsa_api` (runbook P5 §6):

    ```bash
    read -rs NEON_RUNTIME_DATABASE_URL && export NEON_RUNTIME_DATABASE_URL
    export DATABASE_URL="$NEON_RUNTIME_DATABASE_URL"
    read -rs RANGKAIAN_DATA_LAMA_SEBELUM && export RANGKAIAN_DATA_LAMA_SEBELUM   # sama persis dengan Vercel (langkah 9)
    npm --prefix backend run rangkaian:backfill-lama:plan -- --out=<dir di luar repo checkout>
    unset DATABASE_URL NEON_RUNTIME_DATABASE_URL RANGKAIAN_DATA_LAMA_SEBELUM
    ```

    Hentikan (Ctrl+C) bila baris pertama tidak menunjukkan `dbUser: simsa_api`, database produksi, `zonaWaktu: UTC`, `sumberBatas: env`, dan `batasDataLama` = nilai langkah 9. Jangan commit laporannya.
16. **Sign-off SHA.** Pemilik keamanan menerima `ringkasan.json` dan ketiga CSV. Sign-off tertulis menyebut SHA-256 persisnya, dan menjadi bukti gerbang (b), (c), (g), dan (h). `total.sifat_tak_dikenal` di `ringkasan.json` adalah bukti gerbang (h).
17. **`--apply`** dalam satu jendela singkat sesudah sign-off (runbook P5 §8), memakai blok shell yang sama dengan `rangkaian:backfill-lama:apply -- --approved-sha256=<sha>`. Skrip menolak bila SHA berubah. Bila apply terputus, **jangan menebak**: ulangi dry-run → sign-off → apply.
18. **Gerbang (a).**
    - Bila "isi": jalankan `rangkaian:backfill-lama:isi-pengolah:plan` → sign-off SHA baru → `rangkaian:backfill-lama:isi-pengolah:apply -- --approved-sha256=<sha>`. Pakai **pembungkus shell yang sama** dengan langkah 15 (runbook P5 §8.1) (`DATABASE_URL` dan `RANGKAIAN_DATA_LAMA_SEBELUM` wajib dari shell; `--apply` menolak tanpanya), dan `--out` di luar repo.
    - Akses unit pengolah hasil langkah ini **tidak** dikendalikan flag.
19. **Gerbang CTRL-5, lalu Tutup massal data lama** (runbook P5 §8.2). Setelah langkah 18 **dieksekusi** ("isi") atau **ditolak** ("tidak" tercatat), isi `RANGKAIAN_TUTUP_MASSAL_DATA_LAMA=true` di Vercel lalu **redeploy**. Sebelum itu server menolak Tutup massal (409) dan panelnya tidak tampil. Pemberkasan mengunci `unit_pengolah_id` secara terminal. Setelah flag menyala, super_admin atau admin unit pengawas memakai UI tab Berkas Rangkaian: ulangi pratinjau → terapkan per batch 500. Rangkaian yang calon pengolahnya belum terisi selalu dikecualikan. Bila gerbang (a) = "tidak", rangkaian itu diberkaskan satu per satu lewat Berkaskan.
20. **Keputusan flag (gerbang c).** Dengan sign-off terpisah dari sign-off SHA, isi `RANGKAIAN_DISPOSISI_LAMA_READ=true` lalu **redeploy**. Tanpa sign-off, biarkan tidak diset. `RANGKAIAN_AJUKAN_AKSES` mengikuti sign-off keamanan P3 dengan pola yang sama: isi env, lalu redeploy.

### Tahap E — Penutupan

21. Catat di hasil rilis:
    - URL run CI;
    - waktu go-live;
    - `batasDataLama`;
    - SHA yang disetujui dan ringkasan apply;
    - keputusan setiap gerbang;
    - nama backup #1–#3.

    Pastikan backup terjadwal berikutnya (dari `main` = C48) berhasil.

## 4. Gerbang rilis gabungan

Status: **belum** / **disahkan** (nama, tanggal) / **ditolak** / **tidak berlaku**. Satu baris **ditolak** menahan rilis sampai diperbaiki. Pemilik: **Keamanan** = pemilik keamanan; **Spec** = pemilik spesifikasi; **Data** = pemilik data/TU; **Operator** = pelaksana runbook; **CI** = bukti otomatis.

| ID | Item | Sumber | Pemilik | Status |
|---|---|---|---|---|
| P0-1 | PR #15 di-merge sebelum P0; P0 di-rebase | spec §10-P0, §12 | Operator | belum |
| P0-2 | Laporan pre-flight P0 ter-commit, Pengesahan terisi, paritas `sifat_surat` PASS | PREFLIGHT P0 | Operator + Keamanan | belum |
| P1-1 | CI `test:postgres-locks` dan profil backup-upgrade hijau | RUNBOOK_P1 Catatan | CI | belum |
| P3-1a | Flag `RANGKAIAN_AJUKAN_AKSES` (tetap mati sampai disahkan) dan kebijakan disposisi surat terkendali §4.12, termasuk pendelegasian persetujuan grant | runbook P3 §7.1 | Keamanan | belum |
| P3-1b | `ditjen`/`sesditjen` sebagai unit pengawas | runbook P3 §7.1 | Keamanan | belum |
| P3-1c | Lacak menampilkan nomor/perihal node terbaca lewat pengawas/peserta/grant tanpa audit `view_via_rangkaian` | runbook P3 §7.1 | Keamanan | belum |
| P3-1d | Nomor Referensi menjadikan unit pencatat `penulis` rangkaian rujukan | runbook P3 §7.1 | Keamanan | belum |
| P3-1e | `tautan` membolehkan unit peserta menautkan SK-nya ke anggota yang tidak dapat dibacanya | runbook P3 §7.1 | Keamanan | belum |
| P3-C12a | T14-3: Buka Kembali ditolak (409) untuk rangkaian yang selesai otomatis | C-12, spec:710/715 | Spec | belum |
| P3-C12b | G-F3: isi SK draft/pending/rejected lintas unit tetap terbaca (juga temuan review P2) | C-12, spec §4.4 | Keamanan | belum |
| P3-C12c | C-10: keputusan tertulis atas disposisi terbuka surat tersamar (i/ii/iii), diulang tepat sebelum deploy | runbook P3 §1.4 | Keamanan + Data | belum |
| P3-3 | CTRL-1: super_admin tidak pernah dapat Tutup Disposisi | runbook P3 §7.3 | Spec | belum |
| P3-4 | F3: menu baris Surat Masuk tanpa "Saya Balas/Buat Nota Dinas" (deviasi spec:616) | runbook P3 §7.4 | Spec | belum |
| P3-5 | Pertanyaan pemilik spec: kode `RS-…` pada baris tersamar; 403 tindak lanjut untuk unit yang disposisinya `processed`; semantik `statusAlur`; kelas `sifat_surat` tak dikenal; `aksiDiizinkan` per baris daftar | runbook P3 §7.5, PR P3 | Spec | belum |
| P3-6 | CI PG16/17/18 hijau pada head P3 hasil rebase, termasuk 13 suite PostgreSQL P3 | runbook P3 §7.6, S-I3 | CI | belum |
| P3-7 | Frontend + backend satu deploy | runbook P3 §0.5 | Operator | belum |
| P3-8 | Runbook P3 lengkap: backfill dua kali, `sisaTanpaRangkaian: 0`, `dilewati: []` (atau keputusan), `/ready` 200, EXPLAIN tercatat, `admin_unit` `dir_*` sebelum flag apa pun | runbook P3 §7.8 | Operator | belum |
| P3-9 | Urutan merge P0→P1→P2→P3, rebase, dan CI diulang | runbook P3 §7.9 | Operator | belum |
| P4-1 | Tandai Inisiatif diotorisasi kebijakan list + unit pemilik, bukan `check()` | P4-G-7(a) | Keamanan | belum |
| P4-2 | O1: rangkaian backfill langkah 1 (`surat_masuk`, `selesai`) muncul di `siap_diberkaskan` dan badge | P4-G-7 | Spec | belum |
| P4-3 | G-F3 pada `tindak_lanjut_tertahan` ("Buka surat") | P4-G-7 | Keamanan | belum |
| P4-4 | p95 Lacak (target 150 ms). Gerbang (a) Task 14 terpenuhi: tanpa trigram p95 nomor ±470–590 ms (2×50 ribu baris, PG18 lokal tanpa JIT). Dengan index 0049 (P5 Task 14), p95 lokal min–maks atas tiga run (PG18 tanpa JIT, `lacak-explain.postgres.test.ts`, `LACAK_PERF=1`): **nomor memenuhi target** — `B-12345/PTPP` admin_unit 23–28 ms, pengawas 23–28 ms, super_admin 24–28 ms; `B-123` (qNorm < 5, btree 0046) 40–56 ms. **Perihal luas `koordinasi pertanahan` (±12,5 ribu baris cocok) TIDAK memenuhi target secara andal**: admin_unit 93–110 ms, tetapi pengawas 128–169 ms dan super_admin 132–165 ms (review independen: 166–203 ms) — di atas 150 ms pada sebagian run, **memerlukan penerimaan tertulis pemilik spesifikasi**. Sisa waktu perihal adalah heap fetch, skor per baris, dan probe `rangkaian_id`, bukan pemindaian index. CI menegaskan rencana memakai index (`*_trgm_idx`, `*_nomor_norm_idx`); angka CI (dengan JIT) dicatat di PR | P4-G-7, spec §6 | Spec | belum |
| P4-5 | Lacak tanpa audit `view_via_rangkaian`/`markGrantUsed` (semantik list); termasuk urutan placeholder D7 menurut tanggal | P4-D-18 | Keamanan | belum |
| P4-6 | `POST /:id/tautan` lewat `anggotaId` menutup `sm_belum_ditindaklanjuti` untuk SM tak terbaca | P4-D-18 | Spec | belum |
| P4-7 | Baris grant memperlihatkan `entityId`/kelas tersamar (P3 M-1) | P4-D-18 | Keamanan | belum |
| P4-8 | Kotak disposisi tersamar menampilkan `RS-YYYY-…` vs placeholder D7; Berkas Rangkaian masih mengirim `kode` untuk baris `dapatDibuka:false` | P4-D-18 | Spec | belum |
| P4-9 | Gerbang C-12 P3 disahkan sebelum P4 ke produksi | P4-D-18 | Keamanan + Spec | belum |
| P4-10 | CI PG16/17/18 hijau pada head P4, termasuk `lacak-explain` dan `asal-naskah.postgres` | P4-D-18 | CI | belum |
| P4-11 | Frontend + backend satu deploy | P4-D-18 | Operator | belum |
| P4-12 | Anggaran `generalLimiter` per IP diterima (re-key P5 Task 15 dilewati) | P4-C-7 | Spec | belum |
| P4-13 | Bukti `LACAK_PERF=1`: p50/p95, tiga rencana EXPLAIN, ringkasan D7 ditempel di PR | P4-T22-2 | CI | belum |
| P4-14 | Uji asap manual staging (runbook P3 §8.6, butir 1–11) | §10-P4 D7 | Operator | belum |
| P4-15 | `RANGKAIAN_DATA_LAMA_SEBELUM` (atau `batasDataLama` turunan) dicatat dan disematkan (langkah 9) | P4-D-19, P5-C-6 | Operator | belum (setelah deploy) |
| P5-a | Unit pengolah dari label lama: "isi" (`--isi-pengolah`, sebelum Tutup massal, akses tidak dikendalikan flag) atau "tidak" (spec:358 diwaiver) | P5-G-6, P5-C-2 | Spec + Keamanan | belum |
| P5-b | Peserta tidak ditambahkan ke rangkaian `diberkaskan` | P5-T5-3 | Spec | belum |
| P5-c | Menyalakan `RANGKAIAN_DISPOSISI_LAMA_READ` berdasarkan `pemetaan-label.csv`, dengan sign-off terpisah, lalu redeploy | spec §13 Q1 | Keamanan | belum (setelah apply) |
| P5-d | Tugas opsional 14 (pg_trgm) **dikerjakan**: migrasi `0049_lacak_trgm` + langkah privileged `grants/0003_optional_pg_trgm.sql` sebelum migrasi (langkah 13.1), kode C48 dideploy setelah 0049 (langkah 14); gerbang (a) terukur (P4-4), gerbang (b) = sign-off pemilik DB atas siapa yang menjalankan 0003 di Neon. Tugas 15 (re-key limiter) tetap dilewati | P5-G-6, spec §13 Q3 | Spec + Operator | belum |
| P5-e | Data lama ada di produksi? (dari pre-flight P0 `data_lama_ringkasan`) | spec §13 Q2 | Data | belum |
| P5-f | `dilewati` → **tahan 0048 = tahan seluruh P5** (CTRL-2 diamandemen): P5 tidak di-merge/dideploy, produksi tetap C47 di 0047 (backup terjadwal tetap hijau), `--apply` langkah 2 tertahan. Catat pemilik keputusan dan syarat pelepasan | P5-C-3, CTRL-2, B-I1 | Spec + Data | belum |
| P5-g | Gabung rangkaian `data_lama` ke rangkaian hidup menahan target `aktif` (fakta P1 `surat_masuk_belum_ditangani`) | P5-D-8 | Spec | belum |
| P5-h | SM lama dengan kelas `sifat_surat` tak dikenal tetap tersamar bagi peserta meski flag menyala. Jumlah = `total.sifat_tak_dikenal` di `ringkasan.json` dry-run (terikat SHA) | P5-D-10 | Keamanan | belum |
| P5-CTRL5 | `RANGKAIAN_TUTUP_MASSAL_DATA_LAMA=true` (lalu redeploy) **hanya** setelah gerbang P5-a dieksekusi (`--isi-pengolah --apply` selesai) atau ditolak. Rangkaian dengan calon pengolah belum terisi tetap dikecualikan server | CTRL-5, B-I2 | Spec + Keamanan | belum (setelah P5-a) |
| P5-i | C-12 P3 dan gerbang P4 disahkan; CI PG16/17/18 hijau pada head P5 (suite 0048 PGlite + harness `stopBefore`); satu deploy. Diketahui: backfill langkah 2 dan Koreksi Berkas hanya diuji di PGlite | P5-D-18 | CI + Spec | belum |

**Bukti gerbang P5-h.** Dry-run melaporkan `sifat_tak_dikenal` di `total` (`ringkasan.json`, ikut SHA): jumlah surat target (surat yang dirutekan) dengan kelas `sifat_surat` ternormalisasi di luar kelas yang dikenal visibility-spec. Normalisasinya sama dengan visibility-spec, termasuk whitespace Unicode.

## 5. Rollback per tahap

Prinsip umum:
- Migrasi **tidak pernah dibalik** secara manual. Pembatalan skema hanya lewat migrasi maju yang ditinjau, atau restore backup.
- Frontend dan backend **selalu** di-rollback bersama dari revisi yang sama.
- Perubahan env di Vercel baru berlaku setelah redeploy.

| Tahap gagal / titik rollback | Tindakan | Lantai rollback | Catatan |
|---|---|---|---|
| Langkah 1–2 (backup, pre-flight) | Tidak ada perubahan. Rekonsiliasi data lalu ulangi | — | — |
| Langkah 3 (migrasi 0046/0047) gagal | Transaksi digulung balik otomatis; produksi tetap di 0045. Perbaiki penyebab (precheck 0046/0047 RAISE) lalu ulangi | kode produksi lama | RUNBOOK_P1 langkah 2 |
| Setelah langkah 3–4 (skema 0047 + backfill run 1), sebelum deploy | Biarkan skema. Kode produksi lama kompatibel (kolom baru nullable, `rangkaian_*` tidak dipakai) | kode produksi lama di atas skema 0047 | RUNBOOK_P1 §Rollback. Pembatalan skema hanya dengan restore Backup #1 |
| Langkah 5–9 (kode C47 live, database 0047) | Redeploy rilis produksi terakhir (FE+BE bersama); `/ready` 200 | rilis produksi terakhir (runbook P3 §6) | Data P3 tetap ada. Saat roll-forward, jalankan lagi backfill sebelum dan sesudah deploy (P3 §6.3). Bila `RANGKAIAN_AJUKAN_AKSES` pernah menyala, cabut grant disposisi (P3 §6.4). Env `RANGKAIAN_DATA_LAMA_SEBELUM` boleh dibiarkan |
| Langkah 10 (pre-0048 tidak bersih) | Tahan seluruh P5 (gerbang f): P5 tidak di-merge/dideploy; produksi tetap C47 di 0047 | kode C47 | Lihat langkah 10 untuk batasan selama penahanan |
| Langkah 13 (migrasi 0048/0049) gagal | Transaksi digulung balik; database tetap 0047, kode C47 tetap berjalan. Rekonsiliasi lalu ulangi. Galat `0049: extension pg_trgm belum dipasang` → jalankan langkah 13.1 (`grants/0003`) lalu ulangi. **Jangan** deploy C48 sebelum migrasi berhasil | kode C47 | P5 **sudah** ada di `main` pada titik ini (di-merge langkah 11). Bila jeda perbaikan melewati jadwal backup terjadwal, ambil **backup manual** dengan helper checkout C47. Backup terjadwal (`backup-neon.yml`) akan terus gagal sampai 0048 berhasil diterapkan atau P5 dibalik dari `main` |
| Langkah 14 (deploy C48 di atas 0049) gagal | Redeploy C47 (FE+BE bersama); `/ready` 200. C47 aman di atas skema 0048/0049 | kode C47 | Skema tetap 0049; lihat baris berikut untuk lantai rollback |
| Setelah 0048 diterapkan | Redeploy **kode P3+** terakhir yang stabil (FE+BE bersama) | **kode P3+** (runbook P5 §10) | Rilis pra-P3 menulis distribusi tanpa `rangkaian_id` → `23502`. Lantai "rilis produksi terakhir" di runbook P3 §6 **tidak berlaku**. Pembatalan skema hanya lewat migrasi maju `ALTER COLUMN rangkaian_id DROP NOT NULL` atau restore Backup #2. Backup #2 adalah bundel rantai 0047: memulihkannya wajib memakai helper dari **checkout C47**, dan kode produksi harus ikut kembali ke **C47** (helper C48 menolak rantai 0047) |
| Index trigram 0049 bermasalah setelah diterapkan | `DROP INDEX IF EXISTS surat_masuk_nomor_norm_trgm_idx` dan lima `*_trgm_idx` lain sebagai pemilik tabel (`simsa_migration`), runbook P5 §10.1. Lacak tetap benar, tetapi kembali ke seq scan; terukur p95 nomor `B-12345/PTPP` 440–554 ms (setara baseline pra-Task 14 ±470–590 ms) dan nomor pendek `B-123` 808–1060 ms pada 2×50 ribu baris (tiga run, PG18 lokal). Buat ulang index secepatnya (±3 s pada 2×50 ribu baris). Extension `pg_trgm` dibiarkan | — | Baris journal 0049 tetap; buat ulang index dari `0049_lacak_trgm.sql` untuk memulihkan kinerja |
| Langkah 17 (`--apply` langkah 2) | Tidak dapat dibatalkan lewat aplikasi: runtime tidak punya DELETE pada `rangkaian_*`. Peserta `disposisi_lama` tetap **tanpa efek akses** selama flag mati. Apply yang terputus: dry-run → sign-off → apply ulang (idempoten) | — | Pembatalan penuh hanya dengan restore Backup #3 (kehilangan data sejak backup) |
| Langkah 18 (`--isi-pengolah`) | Akses pengolah **tidak** dicabut oleh flag. Koreksi hanya lewat Koreksi Berkas setelah diberkaskan, ke unit dalam jangkauan | — | Karena itu gerbang (a) disahkan sebelum langkah ini |
| Langkah 19 (Tutup massal) | Final: `diberkaskan` terminal. Unit pengolah dan klasifikasi hanya dapat dikoreksi lewat Koreksi Berkas. Hentikan pemakaian lebih lanjut dengan mengosongkan `RANGKAIAN_TUTUP_MASSAL_DATA_LAMA` lalu redeploy | — | — |
| Langkah 20 (flag) | Kosongkan `RANGKAIAN_DISPOSISI_LAMA_READ` (atau `RANGKAIAN_AJUKAN_AKSES`) lalu redeploy. Akses peserta data lama langsung tercabut | kode C48 | Tidak mencabut akses pengolah hasil langkah 18. Untuk Ajukan Akses, ikuti P3 §6.4 bila grant disposisi harus dicabut |

## 6. Catatan yang diketahui untuk rilis ini

- Deskripsi PR P3, P4, dan P5 masing-masing memuat bagian "Celah yang diketahui". Ringkasan yang relevan untuk operator:
  - Suite PostgreSQL nyata baru dijalankan oleh CI.
  - P5 tidak punya suite Postgres untuk backfill langkah 2 dan Koreksi Berkas.
  - Pratinjau Tutup massal hanya menampilkan jumlah.
- Koreksi yang sudah dimasukkan ke runbook P5 oleh gelombang perbaikan akhir P5:
  - rujukan gerbang ke tabel §4 dokumen ini (bukan "§8");
  - perintah `SHOW TimeZone` (§6), dan skrip backfill kini mematok `SET TIME ZONE 'UTC'` sendiri;
  - pembungkus shell `--isi-pengolah` dan `--out` di luar repo (§8.1);
  - dua pra-cek koreksi 0048 (§4);
  - CTRL-2 diamandemen: tahan 0048 = tahan seluruh P5, beserta akibatnya pada backup dan `--apply` (§3–§4);
  - migrasi bertahap dan helper backup pra-0048 (§2, §5);
  - gerbang CTRL-5 Tutup massal (§8.2);
  - Task 14: langkah privileged `pg_trgm` sebelum 0049 dan rollback index trigram (§5.1, §10.1).
