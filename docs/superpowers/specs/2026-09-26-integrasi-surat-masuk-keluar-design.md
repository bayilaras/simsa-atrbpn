# Rencana Fitur: Integrasi Surat Masuk & Surat Keluar

Basis: `origin/main` 5f57b39. Tree-nya identik dengan HEAD 5e279a3 dan working tree bersih. Rencana ini disusun dari proposal *thread-first*, yang dinilai terbaik oleh ketiga juri, lalu dilengkapi ide terbaik dari *edge-first* dan *workflow-first*. Semua butir `must_fix_in_synthesis` sudah diperbaiki, begitu pula temuan review kedua (lihat Lampiran).

Referensi file/baris diperiksa ulang terhadap repo:
- `record-access.service.ts:46-77` (`normalizeSecurityClassification`, `isAllowedForRecordUnit`) dan `:166-265` (`inspect`, `check`; lookup grant hanya dijalankan bila `unitAllowed`, :208-212)
- `record-access-grant.service.ts:92-113` (`request` → `inspect` → `NotFoundError` bila tidak `requestable`) dan `:287-293` (re-check persetujuan)
- `record-unit-scope.ts:6-47`
- `utils/resolve-unit-kerja.ts:16-40` (`ROLE_MANDATED_UNIT_KERJA`, `resolveEffectiveUnitKerjaId`)
- `distribution.service.ts:15-25` (`incomingSecurityCondition`, normalisasi SQL yang **tidak** sama dengan TS), `:31-102` (`distribute(data, auditContext?)` membuka `db.transaction` sendiri di :39; audit `entityType:'surat_distribution'` di :72-76), `:115-120` (`findInbox` menyaring kelas)
- `distribution.routes.ts:186,229,254,278` (`canWriteMiddleware` pada POST, receive, process, reject)
- `app.ts:344` (generalLimiter dipasang sebelum router) dan `:370,:378,:391`
- `rate-limiter.middleware.ts:99-120` (pola ocrLimiter per user)
- `file-access.routes.ts:179,:215`
- `settings.routes.ts:193-213` (`PUT /unit-kerja/:id`, khusus super_admin, hanya name/description/canReceiveDistribution)
- `global-search.service.ts:89-91` (guard panjang minimum) dan `:470-476` (`extractSearchTerms`, tokenizer ASCII `/[^\w\s]/g`)
- `surat-masuk.routes.ts:465-482` (DELETE soft delete tanpa guard status)
- `surat-keluar.service.ts:367,456` (update/delete hanya untuk draft/rejected)
- `migration.service.ts:161` (status diimpor dari Excel)
- `0012_traceable_cross_reference_cancellation.sql:18-24` (pola `coalesce(length(trim(...)),0) >= 10`)
- `schema/record-access-grants.ts:36-79` (status `pending|approved|denied|revoked|expired`; `purpose` ≥20 karakter; `revoked` wajib aktor dan alasan ≥10)
- `grants/0002_converge_application_grants.sql:626-629` (default privileges memberi SELECT/INSERT/UPDATE/DELETE ke `simsa_api_runtime`)
- journal terakhir idx 45 `when` 1789397416667
- `SuratKeluar.jsx:379-386`
- `DistributionInbox.jsx:419,533` ("Tolak & Kembalikan")
- `app-sidebar.jsx:80-90`
- `retention_trigger_events` (`schema/retention-governance.ts:227`)
- `klasifikasi_arsip` (`schema/master-data.ts:10`)

---

## 0. Ringkasan eksekutif

SIMSA mendapat entitas baru **Rangkaian Surat**, yaitu berkas naskah yang merangkai surat masuk → disposisi → tindak lanjut → surat keluar dalam satu rantai yang dapat ditelusuri. Pola ini mengikuti SRIKANDI, tetapi murni internal: tidak ada integrasi API, dan outbox SRIKANDI tidak disentuh.

Keanggotaan rangkaian disimpan di tabel terpisah (`rangkaian_surat`, `rangkaian_anggota`, `rangkaian_relasi`). Karena itu `surat_masuk` hanya mendapat index ekspresi, dan `surat_keluar` hanya mendapat satu kolom opsional `asal_naskah`. Trigger 0021, spread insert Drizzle, dan branch snapshot tetap aman.

`surat_distributions` tetap menjadi buku disposisi. Tabel ini diperluas dengan batas waktu, penanggung jawab, dan penyelesaian, dan tidak dibekukan. Setiap baris disposisi non-rejected **wajib** punya `rangkaian_id`: data yang sudah ada diisi oleh langkah backfill tanpa gerbang di P3, dan semua jalur `distribute()` melewati `ensureForSuratMasuk`.

Akses lintas unit memakai `recordAccessService.checkRead/checkMany`, yang selalu read-only. `check()` tidak berubah sedikit pun. Predikat visibilitas punya **satu sumber** (spesifikasi TS yang menghasilkan fragmen SQL), dipakai bersama oleh `checkRead`, kotak disposisi, seed Lacak, dan daftar rangkaian. Klasifikasi Terbatas ke atas tetap disamarkan ("Dikecualikan") kecuali ada grant yang terikat unit pemilik rekaman. Surat terkendali hanya boleh didisposisikan bila jalur grant disposisi aktif (§4.12).

Pencarian "Lacak Surat" menormalkan nomor, mengelompokkan hasil per rangkaian, dan langsung menampilkan pratinjau rantai. Tombol **Buat Surat Inisiatif** memulai surat keluar mandiri. Rangkaian yang selesai **diberkaskan ke Direktorat (Unit Pengolah)**. Status "diberkaskan" dikunci di level DB, dan koreksinya hanya lewat alur **Koreksi Berkas** super_admin yang maker-checker. Total estimasi sekitar 24–29 hari kerja dalam 6 fase (P0–P5).

**Keputusan yang dipakai:**
- **D1** Registrasi surat masuk terpusat di TU Ditjen/Sesditjen. TU menjadi *unit pencatat* dan mendisposisikan surat ke direktorat.
- **D2** Surat "dikembalikan ke direktorat" berarti dua hal:
  1. surat diteruskan untuk tindak lanjut (disposisi);
  2. setelah rangkaian lengkap, seluruh rangkaian diberkaskan di direktorat itu sebagai *Unit Pengolah*.

  Kepemilikan rekaman tidak pernah dipindah, sehingga provenance terjaga (Permen 2/2026, Perban ANRI 5/2021 Pasal 137(2)).
- **D3** Surat Inisiatif adalah surat keluar mandiri bertanda `asal_naskah='inisiatif'`. Surat ini menjadi induk rantai baru yang bisa dikaitkan kemudian, misalnya ND penjelas SK.
- **D4** Unit peserta rangkaian dan unit pengawas (efektif `ditjen`/`sesditjen`) dapat melihat rangkaian. Node terkendali tetap disamarkan tanpa grant.

---

## 1. Konsep & istilah

| SRIKANDI | SIMSA | Penyimpanan |
|---|---|---|
| Registrasi Naskah Masuk (TU) | Registrasi surat masuk oleh TU (D1) | `surat_masuk` (pemilik = unit pencatat, tidak berubah) |
| Nomor Agenda | No. urut agenda | `surat_masuk.no_urut` (tetap) |
| Disposisi | Disposisi ke Direktorat | `surat_distributions` (+ `rangkaian_id`, `batas_waktu`, `penanggung_jawab`) |
| Tindak Lanjut ▸ Saya Balas | Menu **Tindak Lanjut ▸ Saya Balas / Buat Nota Dinas** | `surat_keluar` + `rangkaian_relasi` (`balasan`/`tindak_lanjut`) |
| Penyelesaian Disposisi | **Penyelesaian** di Kotak Disposisi | `surat_distributions.status='processed'` + `penyelesaian_surat_keluar_id`/`catatan_penyelesaian` |
| Selesai | **Tandai Selesai** / otomatis | `rangkaian_surat.status='selesai'` (+ `selesai_manual`) |
| Nomor Referensi (`reply_id`) | **Nomor Referensi** (ke surat kita) | `rangkaian_relasi` (`merujuk`, `menjelaskan`) |
| Histori Naskah / Linimasa | Panel **Alur Surat** | read model dari rangkaian |
| Naskah keluar tanpa referensi | **Surat Inisiatif** | `surat_keluar.asal_naskah='inisiatif'` |
| Diberkaskan oleh Unit Pengolah | **Berkaskan ke Direktorat (Unit Pengolah)** | `rangkaian_surat.status='diberkaskan'`, `unit_pengolah_id` |
| Unit Kearsipan II | Pengawas rangkaian | `unit_kerja.is_unit_pengawas=true` (ditjen, sesditjen), dicocokkan dengan unit **efektif** (§4.2) |

**Definisi:**
- **Rangkaian (Rangkaian Surat):** himpunan surat yang saling terkait dalam satu urusan dan sekaligus satu berkas naskah. Setiap rangkaian punya:
  - kode unik `RS-YYYY-NNNNNN` (P2/2026 hlm. 77)
  - unit pencatat dan unit pengolah
  - status
  - klasifikasi berkas

  Satu surat berada di **paling banyak satu** rangkaian. Surat tanpa relasi dan tanpa disposisi adalah "tunggal" dan tidak memerlukan baris rangkaian (dibuat *lazy*, lihat §3).
- **Relasi:** sisi berarah antar-anggota dalam satu rangkaian, dari surat yang lebih baru ke surat yang dirujuk. Jenisnya `balasan`, `tindak_lanjut`, `menjelaskan`, dan `merujuk`. Relasi dikoreksi dengan pembatalan (aktor dan alasan ≥10 karakter), tidak pernah dihapus. Hubungan antar-rangkaian ("Rangkaian terkait", misalnya lanjutan dari berkas yang sudah ditutup) **ditampilkan tetapi tidak memberi akses**.
- **Tindak Lanjut:** surat keluar yang dibuat sebagai respons atas anggota rangkaian (surat masuk atau surat keluar). Pembuatnya bisa unit pemilik, unit penerima disposisi aktif, atau pengawas, dan pembuat **wajib dapat membaca** induknya (`checkRead` allowed).
- **Surat Inisiatif:** surat keluar yang dibuat atas prakarsa sendiri (ND, SE, Undangan, Keputusan, Surat Tugas, dan lainnya) tanpa induk surat masuk. Surat ini menjadi induk rangkaian baru begitu ada surat lain yang dikaitkan.
- **Unit Pengolah:** direktorat yang memiliki berkas rangkaian (D2). Nilai default-nya penerima disposisi yang ditandai *penanggung jawab*. Nilainya hanya boleh diambil dari unit yang sudah ada di jangkauan (§9). Rekaman anggota tetap dimiliki unit masing-masing.
- **Peserta:** unit yang punya jangkauan baca atas rangkaian. Jangkauan ini **diturunkan secara langsung** (tidak disalin), sehingga pencabutannya otomatis (§4).

`tunjuk_silang` dan `dosir` **tidak diubah**:
- `tunjuk_silang` tetap menjadi rujuk silang tingkat arsip dengan aturan same-unit dan mutable (`tunjuk-silang.routes.ts:212`, `tunjuk-silang.service.ts:166`).
- `dosir` tetap map kasus manual.

Dengan cara ini hanya ada satu jalur tulis rantai.

---

## 2. Alur kerja end-to-end (sudut pandang operator)

**(a) TU mencatat → disposisi ke BPPT → BPPT membalas → diberkaskan di BPPT**

1. Admin TU Sesditjen membuka **Surat Masuk ▸ Catat Surat Masuk** dan mengetik nomor. Sistem menjalankan cek duplikat melalui Lacak (`mode=cek`, backend dibangun di P3). Jika nomor sudah terdaftar, muncul peringatan "Nomor sudah terdaftar / terkait RS-2026-000123". Operator lalu mengisi bagian **Disposisi ke**:
   - multi-pilih unit dari `/api/distributions/units` (Dit. BPPT, PTEP, KTPP, PLP, Sesditjen, Ditjen)
   - chip instruksi cepat
   - batas waktu
   - radio **Penanggung jawab (Unit Pengolah)**

   Disposisi wajib diisi; jika dikosongkan, muncul konfirmasi "Surat belum didisposisikan". Untuk sifat surat terkendali (Terbatas ke atas), perilaku dialog mengikuti §4.12: disposisi diblokir selama jalur grant disposisi belum aktif, atau diajukan bersama grant disposisi bila jalur itu sudah aktif.
2. Saat disimpan, satu transaksi menjalankan:
   - insert `surat_masuk`
   - `rangkaianService.ensureForSuratMasuk(tx)`, yang membuat rangkaian (pencatat `sesditjen`, pengolah `dir_bppt`) dan anggota `induk`
   - `distributionService.distribute(data, auditContext, tx)`, yang menulis baris disposisi dengan `rangkaian_id`
   - pengisian label `disposisi text[]` ('Dit. BPPT') untuk kompatibilitas
   - audit (`logActionOrThrow`)
   - producer SRIKANDI dipanggil **tanpa perubahan**
3. Admin BPPT melihat baris di **Kotak Disposisi** (`/distribusi`). Baris itu kini menjadi tautan ke detail surat.
   - Detail terbuka read-only dengan banner "Dilihat melalui rangkaian RS-2026-000123". Aksesnya lewat `checkRead` dengan `via='peserta'`, dan PDF dapat dibuka.
   - Membuka detail **tidak** mengubah status disposisi; GET tetap bebas efek samping selain audit view.
   - Status `received` diisi hanya lewat aksi FULL_ADMIN yang eksplisit: tombol **Terima**, atau secara implisit di dalam POST yang membuat tindak lanjut/penyelesaian (transaksi sama, diaudit).
4. BPPT memilih **Tindak Lanjut ▸ Buat Nota Dinas**. Form surat keluar terbuka dengan chip Nomor Referensi terkunci. Saat disimpan, surat keluar dibuat dengan penomoran BPPT, lalu `rangkaian_anggota` dan relasi `tindak_lanjut` ditambahkan. Disposisi `sent` ikut ditandai `received` di transaksi yang sama. `balasan_untuk` tetap NULL karena lintas unit.
5. Approval internal BPPT berjalan seperti sekarang. Saat persetujuan final, `recomputeSuratMasukStatus(tx)` mengubah status menjadi `sudah_dibalas` (diaudit).
6. BPPT mengklik **Penyelesaian** pada baris disposisi, lalu memilih ND tersebut atau menulis catatan ≥10 karakter. Rangkaian otomatis menjadi `selesai` karena:
   - tidak ada lagi disposisi terbuka
   - tidak ada anggota draft/pending/rejected yang hidup
7. Admin BPPT (unit pengolah) atau TU mengklik **Berkaskan ke Direktorat (Unit Pengolah)** pada panel Alur Surat. Dialog berisi:
   - unit pengolah terisi otomatis, hanya dari unit dalam jangkauan
   - klasifikasi berkas (default dari klasifikasi induk, wajib diisi)
   - **konfirmasi dua langkah** yang menampilkan ulang unit dan klasifikasi (keduanya menentukan retensi)

   Setelah dikonfirmasi, rangkaian menjadi `diberkaskan`, dikunci DB, dan tampil di tab **Berkas Rangkaian** milik BPPT.

**(b) SK sebagai surat inisiatif lalu ND penjelas**

1. BPPT membuka **Surat Keluar ▸ Buat Surat Inisiatif ▸ Keputusan**, lalu mengisi dan menyimpan dengan `asal_naskah='inisiatif'`. Belum ada baris rangkaian (surat tunggal).
2. Di detail SK (naskah cocok `/keputusan/i`), operator memilih **Tindak Lanjut ▸ Buat ND Penjelas**. Form sudah terisi naskah 'Nota Dinas' dan perihal "Penjelasan Keputusan Nomor …", dengan relasi `menjelaskan` → SK. Transaksi pembuatannya:
   - `ensureForSurat(SK)` membuat rangkaian dengan SK sebagai induk (`asal='inisiatif'`)
   - ND ditambahkan sebagai anggota
   - relasi dibuat
3. Jika ND sudah dibuat terpisah, operator memakai **Tautkan ke Rangkaian** dari detail ND dan memilih SK lewat picker Lacak (`mode=referensi`, backend P3).
4. Di Lacak, pencarian nomor SK maupun perihal ND sama-sama menampilkan satu kartu RS-… berisi SK dan ND. Kartu mencantumkan tahun karena nomor SK berulang setiap tahun.
5. Rangkaian inisiatif tanpa disposisi otomatis menjadi `selesai` ketika semua anggota sudah disetujui, tanpa perlu klik "Tandai Selesai".

**(c) Disposisi ke dua direktorat (BPPT dan PTEP)**

- TU memilih BPPT dan PTEP, dengan BPPT sebagai penanggung jawab. Terbentuk dua baris disposisi, dan keduanya menjadi peserta.
- Masing-masing membuat dan menyetujui ND-nya sendiri, lalu melakukan penyelesaian.
- Rangkaian baru `selesai` setelah **semua** disposisi yang tidak ditolak berstatus processed.
- Rangkaian diberkaskan **satu kali** di BPPT (Pasal 137(2)). ND milik PTEP tetap rekaman PTEP, dan PTEP tetap melihat seluruh rangkaian sebagai peserta.
- Jika PTEP menolak ("Tolak & Kembalikan"), jangkauan bacanya hilang otomatis, kecuali PTEP sudah menulis anggota. TU dapat mendisposisikan ulang karena indeks unik mengabaikan baris `rejected`.
- Bila target tidak bisa memproses (misalnya disposisi lama atas surat yang tidak dapat dibacanya), pengawas dapat **Tutup Disposisi** dengan alasan ≥10 karakter (§5), sehingga rangkaian tidak macet selamanya.

**(d) Surat masuk yang membalas surat keluar kita**

1. TU mencatat surat masuk dan mengisi **Nomor Referensi (surat kita)** lewat picker Lacak. TU adalah pengawas, sehingga surat keluar BPPT terlihat, dengan penyamaran untuk yang terkendali.
2. Form menyarankan disposisi ke pemilik surat rujukan (Dit. BPPT).
3. Perilakunya bergantung pada status rangkaian rujukan:
   - `aktif`/`selesai`: surat masuk bergabung dengan relasi `merujuk`. Rangkaian yang `selesai` kembali `aktif` otomatis (diaudit).
   - `diberkaskan`: dibuat rangkaian **baru** dengan `lanjutan_dari_id` menunjuk rangkaian lama. Rangkaian ini tampil sebagai "Rangkaian terkait" dan tidak mewariskan jangkauan (P2/2026 hlm. 10, 114).

**(e) Pemulihan "TU lupa mengisi Nomor Referensi"**

BPPT sudah membuat balasan di rangkaian A, sementara surat masuk baru ada di rangkaian B. Admin TU (pengawas) memilih **Gabungkan Rangkaian** di panel Alur Surat dan mengisi alasan ≥10 karakter. Dialog menampilkan daftar unit yang akan mendapat akses baru.

Aturan gabung:
- Sumber dan target harus `aktif`/`selesai`, tidak pernah yang `diberkaskan` atau `digabung`.
- Baris disposisi sumber ikut dipindah ke target (§3 Catatan gabung).

---

## 3. Model data

### Prinsip

- Tidak ada kolom baru di `surat_masuk`. `surat_keluar` hanya mendapat kolom nullable `asal_naskah`, yang tidak dijaga trigger 0021.
- Nomor dinormalisasi lewat **index ekspresi**, bukan generated column.
- Rangkaian dibuat secara *lazy*, hanya saat ada disposisi, relasi, atau Nomor Referensi. Surat tunggal cukup dikelompokkan dengan `coalesce(rangkaian_id, surat_id)` di pencarian. Hook hanya jalan bila payload tindak lanjut/disposisi ada, sehingga churn pada mock Proxy di test create berkurang.
- **Pengecualian invarian:** setiap baris `surat_distributions` harus punya `rangkaian_id`.
  - Baris baru: dijamin oleh semua jalur `distribute()`, termasuk `POST /api/distributions` yang lama, yang memanggil `ensureForSuratMasuk` dalam tx yang sama.
  - Baris yang sudah ada: diisi oleh langkah backfill 1 (ungated, P3) sebelum kode P3 aktif.

### `0046_rangkaian_surat.sql` (BARU)

Aturan file: SQL tulis tangan, akhir baris LF, `--> statement-breakpoint`, journal `{idx:46, when:1789397417667, tag:"0046_rangkaian_surat"}`.

```sql
-- Precheck (pola 0012): gagal dengan pesan jelas
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM surat_distributions WHERE status NOT IN ('sent','received','processed','rejected'))
    THEN RAISE EXCEPTION '0046: status surat_distributions tidak dikenal, rekonsiliasi dulu'; END IF;
  IF EXISTS (SELECT 1 FROM surat_distributions WHERE status <> 'rejected'
             GROUP BY surat_masuk_id, target_unit_id HAVING count(*) > 1)
    THEN RAISE EXCEPTION '0046: distribusi aktif ganda (surat,target), rekonsiliasi dulu'; END IF;
END $$;
CREATE SEQUENCE IF NOT EXISTS rangkaian_surat_kode_seq;
CREATE TABLE rangkaian_surat (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kode varchar(30) NOT NULL UNIQUE,                      -- RS-2026-000123
  asal varchar(20) NOT NULL CHECK (asal IN ('surat_masuk','inisiatif','data_lama')),
  status varchar(20) NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','selesai','diberkaskan','digabung')),
  unit_pencatat_id varchar(50) NOT NULL REFERENCES unit_kerja(id),
  unit_pengolah_id varchar(50) REFERENCES unit_kerja(id),
  judul text NOT NULL,                                   -- dari perihal induk, SELALU disamarkan bila induk terkendali
  tahun int NOT NULL,
  klasifikasi_item_id int REFERENCES klasifikasi_arsip(id) ON DELETE RESTRICT,
  lanjutan_dari_id uuid REFERENCES rangkaian_surat(id),
  digabung_ke_id uuid REFERENCES rangkaian_surat(id),
  selesai_at timestamptz, selesai_by uuid REFERENCES users(id), catatan_selesai text,
  selesai_manual boolean NOT NULL DEFAULT false,         -- true hanya dari aksi "Tandai Selesai"
  diberkaskan_at timestamptz, diberkaskan_by uuid REFERENCES users(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rangkaian_berkas_check CHECK (status <> 'diberkaskan' OR (unit_pengolah_id IS NOT NULL
     AND klasifikasi_item_id IS NOT NULL AND diberkaskan_at IS NOT NULL AND diberkaskan_by IS NOT NULL)),
  CONSTRAINT rangkaian_gabung_check CHECK ((status='digabung') = (digabung_ke_id IS NOT NULL) AND digabung_ke_id IS DISTINCT FROM id),
  CONSTRAINT rangkaian_selesai_manual_check CHECK (NOT selesai_manual
     OR (selesai_by IS NOT NULL AND coalesce(length(trim(catatan_selesai)), 0) >= 10))
);
CREATE TABLE rangkaian_anggota (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rangkaian_id uuid NOT NULL REFERENCES rangkaian_surat(id),
  surat_masuk_id uuid REFERENCES surat_masuk(id),
  surat_keluar_id uuid REFERENCES surat_keluar(id),
  unit_kerja_id varchar(50) NOT NULL REFERENCES unit_kerja(id),  -- snapshot pemilik (tidak pernah berubah)
  peran varchar(10) NOT NULL DEFAULT 'anggota' CHECK (peran IN ('induk','anggota')),
  sumber varchar(15) NOT NULL DEFAULT 'aplikasi' CHECK (sumber IN ('aplikasi','tautan','gabung','data_lama')),
  ditambahkan_by uuid REFERENCES users(id), ditambahkan_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(surat_masuk_id, surat_keluar_id) = 1),
  UNIQUE (rangkaian_id, id)
);
CREATE UNIQUE INDEX rangkaian_anggota_sm_uidx ON rangkaian_anggota (surat_masuk_id) WHERE surat_masuk_id IS NOT NULL;
CREATE UNIQUE INDEX rangkaian_anggota_sk_uidx ON rangkaian_anggota (surat_keluar_id) WHERE surat_keluar_id IS NOT NULL;
CREATE UNIQUE INDEX rangkaian_anggota_induk_uidx ON rangkaian_anggota (rangkaian_id) WHERE peran='induk';
CREATE INDEX rangkaian_anggota_unit_idx ON rangkaian_anggota (unit_kerja_id, rangkaian_id);
CREATE TABLE rangkaian_relasi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rangkaian_id uuid NOT NULL, dari_anggota_id uuid NOT NULL, ke_anggota_id uuid NOT NULL,
  jenis_relasi varchar(20) NOT NULL CHECK (jenis_relasi IN ('balasan','tindak_lanjut','menjelaskan','merujuk')),
  keterangan text, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz, cancelled_by uuid REFERENCES users(id), cancellation_reason text,
  FOREIGN KEY (rangkaian_id, dari_anggota_id) REFERENCES rangkaian_anggota (rangkaian_id, id) ON UPDATE CASCADE,
  FOREIGN KEY (rangkaian_id, ke_anggota_id)  REFERENCES rangkaian_anggota (rangkaian_id, id) ON UPDATE CASCADE,
  CHECK (dari_anggota_id <> ke_anggota_id),
  CHECK ((cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason IS NULL)
      OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
          AND coalesce(length(trim(cancellation_reason)), 0) >= 10))   -- pola 0012:22, NULL ditolak
);
CREATE UNIQUE INDEX rangkaian_relasi_active_uidx ON rangkaian_relasi (dari_anggota_id, ke_anggota_id, jenis_relasi) WHERE cancelled_at IS NULL;
CREATE INDEX rangkaian_relasi_ke_idx ON rangkaian_relasi (ke_anggota_id) WHERE cancelled_at IS NULL;
-- Peserta eksplisit HANYA untuk data lama; dapat dicabut dengan jejak
CREATE TABLE rangkaian_peserta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rangkaian_id uuid NOT NULL REFERENCES rangkaian_surat(id),
  unit_kerja_id varchar(50) NOT NULL REFERENCES unit_kerja(id),
  peran varchar(20) NOT NULL CHECK (peran IN ('disposisi_lama')),
  label_asal text, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  berakhir_at timestamptz, berakhir_by uuid REFERENCES users(id), alasan_berakhir text,
  CHECK (berakhir_at IS NULL OR (berakhir_by IS NOT NULL
         AND coalesce(length(trim(alasan_berakhir)), 0) >= 10))           -- NULL ditolak
);
CREATE UNIQUE INDEX rangkaian_peserta_active_uidx ON rangkaian_peserta (rangkaian_id, unit_kerja_id, peran) WHERE berakhir_at IS NULL;
-- Koreksi berkas yang sudah diberkaskan (maker-checker, §9)
CREATE TABLE rangkaian_koreksi_berkas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rangkaian_id uuid NOT NULL REFERENCES rangkaian_surat(id),
  unit_pengolah_lama varchar(50) NOT NULL, unit_pengolah_baru varchar(50) NOT NULL REFERENCES unit_kerja(id),
  klasifikasi_lama int NOT NULL, klasifikasi_baru int NOT NULL REFERENCES klasifikasi_arsip(id),
  alasan text NOT NULL CHECK (coalesce(length(trim(alasan)), 0) >= 10),
  status varchar(15) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','applied')),
  diajukan_by uuid NOT NULL REFERENCES users(id), diajukan_at timestamptz NOT NULL DEFAULT now(),
  diputuskan_by uuid REFERENCES users(id), diputuskan_at timestamptz,
  CHECK (diputuskan_by IS NULL OR diputuskan_by <> diajukan_by)
);
CREATE TABLE disposisi_label_unit (label_norm varchar(100) PRIMARY KEY,
  unit_kerja_id varchar(50) REFERENCES unit_kerja(id), perlu_verifikasi boolean NOT NULL DEFAULT false, catatan text);
ALTER TABLE surat_distributions
  ADD COLUMN rangkaian_id uuid REFERENCES rangkaian_surat(id),
  ADD COLUMN batas_waktu date,
  ADD COLUMN penanggung_jawab boolean NOT NULL DEFAULT false,
  ADD COLUMN processed_by uuid REFERENCES users(id),
  ADD COLUMN penyelesaian_surat_keluar_id uuid REFERENCES surat_keluar(id),
  ADD COLUMN catatan_penyelesaian text,
  ADD COLUMN ditutup_pengawas boolean NOT NULL DEFAULT false;
ALTER TABLE surat_distributions ADD CONSTRAINT surat_distributions_status_check
  CHECK (status IN ('sent','received','processed','rejected'));
CREATE UNIQUE INDEX surat_distributions_active_target_uidx ON surat_distributions (surat_masuk_id, target_unit_id) WHERE status <> 'rejected';
CREATE INDEX surat_distributions_target_status_idx ON surat_distributions (target_unit_id, status);
CREATE INDEX surat_distributions_rangkaian_idx ON surat_distributions (rangkaian_id, target_unit_id) WHERE rangkaian_id IS NOT NULL;
ALTER TABLE surat_keluar ADD COLUMN asal_naskah varchar(15)
  CONSTRAINT surat_keluar_asal_naskah_check CHECK (asal_naskah IS NULL OR asal_naskah IN ('inisiatif','tindak_lanjut'));
UPDATE surat_keluar SET asal_naskah='tindak_lanjut' WHERE balasan_untuk IS NOT NULL AND asal_naskah IS NULL;
CREATE INDEX IF NOT EXISTS idx_surat_keluar_balasan ON surat_keluar (balasan_untuk) WHERE balasan_untuk IS NOT NULL;
CREATE INDEX surat_masuk_nomor_norm_idx  ON surat_masuk  ((lower(regexp_replace(coalesce(nomor_surat,''),'[^0-9A-Za-z]+','','g'))) text_pattern_ops);
CREATE INDEX surat_keluar_nomor_norm_idx ON surat_keluar ((lower(regexp_replace(coalesce(nomor_surat,''),'[^0-9A-Za-z]+','','g'))) text_pattern_ops);
```

**Trigger (pola 0021):**

- **`rangkaian_guard_closed()`** dipasang `BEFORE INSERT OR UPDATE` pada `rangkaian_anggota`, `rangkaian_relasi`, **dan `surat_distributions`**. Fungsi ini menolak operasi (RAISE) bila `rangkaian_surat.status` untuk `rangkaian_id` lama maupun baru adalah `diberkaskan`. Artinya, disposisi baru maupun perubahan disposisi dalam berkas tertutup tidak mungkin terjadi.
- **Trigger kedua pada `rangkaian_surat`:**
  - Menolak perubahan dari `diberkaskan` ke status lain.
  - Menolak perubahan `unit_pengolah_id`/`klasifikasi_item_id` setelah diberkaskan. Satu-satunya pengecualian: GUC transaksi `current_setting('simsa.berkas_koreksi', true)` sama dengan id baris `rangkaian_koreksi_berkas` berstatus `approved` untuk rangkaian itu, dan nilai barunya sama dengan isi baris koreksi tersebut (§9).
  - Menolak `digabung_ke_id` yang menunjuk rangkaian berstatus `digabung` atau `diberkaskan`, sehingga siklus A→B→A tidak mungkin terjadi.

**Catatan 0046:**
- Tidak ada `CONCURRENTLY` dan tidak ada extension. Relasi memakai composite FK dengan `UNIQUE(rangkaian_id,id)` sebagai pendukung.
- **Catatan gabung/tautan:** `ON UPDATE CASCADE` memungkinkan penggabungan dengan `UPDATE rangkaian_anggota SET rangkaian_id=…, peran='anggota'`, yang juga memenuhi partial unique index `induk`. Dalam transaksi yang sama, service:
  1. mengunci kedua baris `rangkaian_surat` (`FOR UPDATE`, id menaik);
  2. mensyaratkan target `aktif|selesai`;
  3. menjalankan `UPDATE surat_distributions SET rangkaian_id=target WHERE rangkaian_id=sumber`;
  4. menandai sumber `digabung`;
  5. menghitung ulang status target.

  Tautan induk rangkaian 1-anggota diperlakukan sebagai gabung (sumber → `digabung`), sehingga tidak tersisa rangkaian kosong yang masih `aktif`.
- `UPDATE asal_naskah` hanya menyentuh sekitar 1 baris dan bukan kolom yang dijaga 0021.
- Drizzle: `backend/src/db/schema/rangkaian-surat.ts` (BARU) diekspor dari `schema/index.ts`. Kolom baru ditambahkan di `surat-distribution.ts` dan `surat-keluar.ts`. **Jangan** jalankan drizzle-kit.
- **Grants (koreksi fakta):** default privileges di 0002:626-629 langsung memberi SELECT/INSERT/UPDATE/DELETE pada tabel baru ke `simsa_api_runtime`.
  - Tambahkan pada 0002: `REVOKE DELETE ON rangkaian_surat, rangkaian_anggota, rangkaian_relasi, rangkaian_peserta, rangkaian_koreksi_berkas FROM simsa_api_runtime;`
  - Urutan deploy: **migrate → `db:grants:converge` (perbarui `EXPECTED_MIGRATIONS_JSON`) segera → backfill langkah 1 (§3) → deploy kode**.
  - Kode aplikasi tidak pernah memakai DELETE pada tabel-tabel ini.
- **Test PGlite:** insert baris relasi yang dibatalkan dengan `cancellation_reason` NULL dan baris peserta berakhir dengan `alasan_berakhir` NULL harus **ditolak** CHECK. Hal yang sama berlaku untuk `selesai_manual` tanpa catatan.

### `0047_unit_kerja_direktorat.sql` (BARU; `when` 1789397418667)

Isinya satu blok `DO`:
1. `RAISE` bila ada `unit_kerja.id ~ '^direktorat-'` (fail-closed).
2. `INSERT … ON CONFLICT (id) DO NOTHING` untuk `dir_bppt`, `dir_ptep`, `dir_ktpp`, `dir_plp` dengan `parent_id='ditjen'`, `unit_type='direktorat'`, `can_receive_distribution=true`.
3. `parent_id`/`unit_type` pada `sesditjen` dan `dir_*` hanya diisi bila NULL.

`deployment-unit-seed.sql` **tidak diubah**, agar `deployment-regulatory-evidence.test.ts:54-64` tetap hijau. Unit bagian (`bagian_*`) tidak ditambahkan.

Nama resmi dikoreksi lewat `PUT /api/settings/unit-kerja/:id`. Endpoint ini khusus super_admin dan hanya mengubah `name`, `description`, `canReceiveDistribution`. `parent_id`/`unit_type` hanya diatur oleh 0047.

### Backfill: dua skrip dengan gerbang berbeda

**Langkah 1: disposisi eksplisit (P3, tanpa gerbang sign-off).** Skrip `backend/scripts/backfill-rangkaian-disposisi.mjs` (BARU) dijalankan di runbook deploy P3 **sebelum** kode P3 aktif.
- Baris `surat_distributions` yang sudah ada adalah keputusan routing sah oleh unit pemilik.
- Untuk setiap surat masuk yang punya baris distribusi tanpa `rangkaian_id`, skrip membuat rangkaian dengan:
  - `asal='surat_masuk'`
  - `status='aktif'` bila ada disposisi `sent/received`, selain itu `selesai`
  - pencatat = pemilik surat
  - pengolah = target tunggal bila hanya satu
  - `judul` dengan pola COALESCE di bawah
- Lalu skrip menambah anggota `induk` dan mengisi `rangkaian_id` pada **semua** baris distribusinya, termasuk yang `rejected`.
- Batch 500 baris per transaksi, setiap insert diaudit, dan skrip idempoten (`NOT EXISTS`).
- **Kriteria keluar P3:** `SELECT count(*) FROM surat_distributions WHERE rangkaian_id IS NULL` = 0. Sesudahnya, migrasi pengerasan di P5 dapat menambahkan `SET NOT NULL`.

**Langkah 2: label bebas data lama (P5, bergerbang).** Skrip `backend/scripts/backfill-rangkaian-lama.mjs` (BARU) berjalan dry-run secara default dan menghasilkan CSV `label → unit → jumlah`. Opsi `--apply` hanya dipakai setelah sign-off pemilik keamanan. Pola batch, audit, dan idempotensinya sama. Langkahnya:
1. Seed `disposisi_label_unit`. Normalisasi label: `lower(regexp_replace(trim(label),'\s+',' ','g'))`.
   - `bppt`, `dit. bppt` → `dir_bppt`; demikian juga untuk ptep, ktpp, plp
   - `sesditjen`, `sekditjen` → `sesditjen`
   - `dirjen`, `ditjen` → `ditjen`
   - kedua label `kabag …` → `sesditjen` dengan `perlu_verifikasi=true`
   - label kosong (100 baris) diabaikan
2. Untuk surat masuk **tanpa** rangkaian dari langkah 1 yang punya label terpetakan ke unit selain pemilik, buat rangkaian `asal='data_lama'` dengan `status='selesai'` dan `selesai_manual=false`. Status ini dipilih agar tidak membanjiri daftar kerja (dasarnya di §8).
   - `judul = COALESCE(NULLIF(trim(perihal),''), nomor_surat, '(tanpa perihal)')`, karena `perihal` nullable (lihat fixture `migration-chain.integration.test.ts:119-126`).
   - Anggota induk memakai `sumber='data_lama'`.

   Surat yang sudah punya rangkaian dari langkah 1 hanya mendapat baris peserta.
3. Label yang terpetakan menghasilkan `rangkaian_peserta(peran='disposisi_lama', label_asal)`. Baris ini **tidak memberi jangkauan baca** sampai flag `RANGKAIAN_DISPOSISI_LAMA_READ=true` diaktifkan setelah sign-off. Tanpa flag ini, sekitar 1.421 label 'BPPT' akan diam-diam membuka surat Ditjen ke `dir_bppt`.
4. `balasan_untuk` **same-unit** menjadi anggota plus relasi `balasan`. Baris lintas unit (1 baris) tidak dimasukkan dan dicantumkan di laporan untuk ditinjau TU.
5. `unit_pengolah_id` hanya diisi bila tepat satu label direktorat terpetakan.
6. `surat_masuk.status` **tidak ditulis ulang**.

Prasyarat: P0 sudah memverifikasi apakah data lama (2.047 surat masuk) memang ada di prod saat ini.

### Kolom lama

| Kolom | Nasib |
|---|---|
| `surat_keluar.balasan_untuk` | Dipertahankan dan tetap diisi untuk balasan **same-unit**, sehingga `/balasan`, `/with-links`, dan kolom Excel tetap jalan. Semantik rantai ada di `rangkaian_relasi`. |
| `surat_masuk.disposisi text[]` | Menjadi label tampilan/ekspor yang diisi server dari `disposisiUnitIds`. Label Kabag tetap bisa dipilih sebagai chip label-saja, tanpa routing. |
| `surat_masuk.status` | Tetap dua nilai tetapi diturunkan server secara monoton dan diaudit (§8). |
| `tunjuk_silang`, `dosir` | Tidak berubah. |

---

## 4. Aturan akses & keamanan (D4)

1. **`check()` tidak diubah sama sekali.** Semua jalur mutasi (PUT, DELETE, arsip, upload, relasi via `tunjuk_silang`) tetap owner-only.
2. **Pengawas: ditentukan oleh unit, bukan role (keputusan D5).** Tidak ada role baru. Role yang diberikan hanya `super_admin` dan `admin_unit`.
   - Kolom baru `unit_kerja.is_unit_pengawas boolean NOT NULL DEFAULT false` (migrasi 0046). Nilainya di-set `true` untuk `ditjen` dan `sesditjen` dengan UPDATE idempoten, dan hanya super_admin yang bisa mengubahnya (lewat `PUT /api/settings/unit-kerja/:id`, diaudit).
   - Status pengawas = role FULL_ADMIN **dan** unit efektif (`resolveEffectiveUnitKerjaId(role, user.unitKerjaId)`) punya `is_unit_pengawas = true`. Karena itu `admin_unit@sesditjen` (petugas TU) otomatis menjadi pengawas.
   - Role lama `admin_dirjen`/`admin_sesditjen` tetap berfungsi lewat unit mandatnya. Pengguna lama dimigrasi bertahap ke `admin_unit` dengan unit yang sama (tanpa perubahan skema role).
   - super_admin sudah punya akses penuh lewat `check()`.
3. **Satu sumber predikat visibilitas.** Modul `backend/src/services/access/visibility-spec.ts` (BARU) memuat spesifikasi tabel tunggal:
   - daftar nilai sifat → kelas
   - kelas per role
   - aturan pengawas/peserta
   - syarat grant

   Dari spesifikasi itu dihasilkan dua bentuk:
   - fungsi TS: `normalizeSecurityClassification` dipindahkan ke sini, dengan re-export dari `record-access.service.ts` agar impor lama tetap jalan
   - fragmen SQL: `klasifikasiNormSql(col)` dengan urutan persis seperti TS, yaitu `coalesce(col,'biasa')` → `trim` → `lower` → `regexp_replace('[\s-]+','_','g')` → pemetaan daftar; ditambah `visibleSql(user)`

   Pemakainya:
   - `incomingSecurityCondition` (`distribution.service.ts:15-25`)
   - seed Lacak
   - `GET /api/rangkaian`
   - `checkMany`
   - `checkRead`, yang mendelegasikan ke `checkMany` untuk satu ref

   Perbaikan normalisasi kotak disposisi (saat ini 'Sangat Segera' jatuh ke `sangat_segera` lewat cabang ELSE sehingga terkecualikan) masuk **P0**.
4. **`record-access.service.ts`** mendapat tiga tambahan:
   - **`findActiveGrant(executor, user, type, id, unitKerjaId, classification)`**, diekstrak dari query grant di `check()`. `check()` memanggilnya dengan hasil identik dan tetap hanya bila `unitAllowed`. `checkRead` memanggilnya **tanpa** syarat `unitAllowed`, karena grant tetap terikat `unit_kerja_id` rekaman dan kelas yang disyaratkan.
   - **`checkRead(user, type, id, executor)`**:
     - Bila `check()` lolos, hasilnya `{...res, via:'owner'}`.
     - Bila tidak, jangkauan dihitung ulang **setiap kali** (tidak di-cache ke grant):
       - `pengawas`: pengguna adalah pengawas (§4.2) dan unit rekaman ∈ `{ditjen, sesditjen, dir_*}`
       - `peserta`: unit efektif pengguna ∈ `jangkauan(rangkaian rekaman)`
     - Untuk `pengawas`/`peserta`, kelas `biasa` diizinkan bila role diizinkan untuk biasa. Kelas terkendali **wajib** grant approved yang belum kedaluwarsa dan terikat `unit_kerja_id` rekaman. Kebijakan list admin (biasa+terbatas) **tidak** berlaku untuk pengawas.
     - `mutable` selalu `false` kecuali `via='owner'`.
     - Surat keluar lama dengan klasifikasi NULL dianggap `terbatas`.
   - **`checkMany(user, refs)`**: pola batch dari `checkEntityAccessMany` (`tunjuk-silang.routes.ts:63`) dipindahkan ke service. Kebutuhannya tiga query: metadata per tipe, jangkauan, dan grant `IN (…)`.
5. **Jangkauan peserta diturunkan secara langsung.** Tidak ada salinan yang bisa basi. `jangkauan(R)` adalah gabungan dari:
   - `unit_pencatat_id` dan `unit_pengolah_id`
   - `rangkaian_anggota.unit_kerja_id` (penulis)
   - target `surat_distributions` dengan `rangkaian_id=R AND status<>'rejected'`
   - `rangkaian_peserta` aktif, hanya bila flag data lama menyala

   Konsekuensinya:
   - Disposisi yang ditolak otomatis mencabut jangkauan kecuali unit tersebut menulis anggota.
   - Setiap perubahan dasar jangkauan sudah diaudit melalui baris distribusi, anggota, atau peserta yang dibuat dalam transaksi masing-masing.
   - Karena gabung memindahkan `surat_distributions.rangkaian_id` (§3), jangkauan tidak bergantung pada lompatan `digabung_ke_id`. Resolusi `digabung_ke_id` hanya dipakai untuk navigasi.
   - `lanjutan_dari_id` **tidak** memberi jangkauan.
6. **Role (D5):** jangkauan lintas unit berlaku untuk FULL_ADMIN. Role lama `staff`/`auditor` tidak lagi diberikan ke pengguna baru dan tetap read-only di unitnya sendiri, tanpa jangkauan pengawas/peserta.
7. **Scope pemuatan:** setelah `checkRead` lolos lintas unit, route memuat rekaman dengan `findById(id, access.unitKerjaId)`, yaitu unit rekaman itu sendiri. Nilai `null` tidak pernah dipakai karena dicadangkan untuk super_admin (`record-unit-scope.ts:6-10`). Helper baru `scopeForAuthorizedRead(req, access)` ditambahkan di `record-unit-scope.ts`.
8. **Penyamaran (placeholder paling konservatif):** `{anggotaId, jenis:'surat_masuk'|'surat_keluar', unitNama, label:'Dikecualikan', masked:true, dapatAjukanAkses}`.
   - Placeholder tidak memuat surat id, nomor, perihal, tanggal, dari/kepada, maupun berkas.
   - Bidang turunan ikut disamarkan:
     - `rangkaian.judul` diganti "Rangkaian RS-… (Dikecualikan)" bila induk tersamar
     - `instruction`, `catatan_penyelesaian`, dan `rejection_reason` disposisi mengikuti penyamaran surat masuknya
   - Metadata routing (unit, status, tanggal disposisi, batas waktu) tetap tampil.
9. **Tanpa oracle:** predikat `visibleSql` yang sama (§4.3) diterapkan **di SQL seed pencarian sebelum `LIMIT`**, sehingga perihal/nomor node tersamar tidak pernah bisa dicocokkan. Paritasnya dijaga dua test:
   - **Parity test:** semua nilai `sifat_surat` yang ditemukan di prod (dari pre-flight P0) ditambah varian spasi/tanda hubung/kapital menghasilkan kelas yang sama di TS dan SQL.
   - **Property test:** kombinasi acak (role, unit, NULL-unit, sifat teks bebas, grant, jangkauan) dijalankan lewat `checkRead` dan seed SQL, dan keduanya harus memberi hasil izinkan/samarkan yang identik.
10. **Audit:**
    - Stream berkas pada **kedua** cabang `file-access.routes.ts` (lampiran :179 dan langsung :215) memakai `checkRead`, dan audit mencatat `via` beserta `rangkaianId`.
    - Pembacaan detail lintas unit menulis audit `view_via_rangkaian`.
    - Semua mutasi rangkaian memakai `logActionOrThrow(tx)` dengan entityType `rangkaian_surat` atau `rangkaian_relasi`.
    - Mutasi disposisi tetap memakai entityType **`surat_distribution`** (tunggal, sama dengan kode yang ada di `distribution.service.ts:72-76`) supaya jejak audit tidak terbelah.
    - Perubahan status surat masuk diaudit sebagai `surat_masuk`.
11. **Ajukan Akses:** endpoint `POST /api/rangkaian/anggota/:anggotaId/ajukan-akses` me-resolve rekaman di sisi server lalu memanggil jalur baru `recordAccessGrantService.requestViaRangkaian(user, ref, tx?)`.
    - Jalur ini diperlukan karena `request()` memanggil `inspect()`, yang mensyaratkan `isAllowedForRecordUnit` sehingga peserta di luar unit pemilik selalu mendapat `NotFoundError`.
    - Gerbang saat pengajuan dan re-check saat persetujuan (`record-access-grant.service.ts:287-293`) memakai predikat yang **sama**: "unit pemilik (`isAllowedForRecordUnit`) **atau** pengawas **atau** jangkauan rangkaian yang **masih hidup**".
    - `check()` dan `inspect()` tidak berubah. Grant yang disetujui dibaca oleh `checkRead` lewat `findActiveGrant` tanpa syarat `unitAllowed` (§4.4).
    - Persetujuan tetap hanya oleh super_admin.
    - Fitur dibangun di P3 di balik flag `RANGKAIAN_AJUKAN_AKSES`, dan flag dinyalakan **setelah** sign-off pemilik keamanan (gerbang rilis P3).
    - Matriks keamanan P3 mencakup: pengajuan oleh peserta di luar unit pemilik, persetujuan, pembacaan via grant, dan penolakan setelah jangkauan dicabut.
12. **Disposisi surat terkendali (keputusan untuk P3).** Direktorat yang ditugasi harus bisa membaca surat yang wajib ditindaklanjutinya.
    - **Default v1 (b):** selama flag `RANGKAIAN_AJUKAN_AKSES` mati, `distribute()` menolak (409) disposisi surat masuk yang kelasnya Terbatas ke atas. Pesan: "Surat terkendali belum dapat didisposisikan; tangani di unit pencatat atau aktifkan jalur akses disposisi". Surat itu tetap ditangani TU sebagai pemilik.
    - **Setelah flag menyala (a):** membuat disposisi surat terkendali sekaligus membuat, dalam transaksi yang sama, **permohonan grant bertujuan 'disposisi'** untuk setiap target. Sifat grant:
      - `accessMode` view
      - terikat `unit_kerja_id` rekaman
      - `purpose` ≥20 karakter dibuat otomatis
    - Permohonan ini disetujui oleh approver bernama, yaitu super_admin sesuai aturan yang berlaku. Pendelegasian ke admin pengawas pemilik adalah perubahan kebijakan yang perlu sign-off (§13).
    - Grant dicabut (`status='revoked'`, dengan aktor dan alasan) di transaksi `process()`/`reject()`/tutup disposisi.
    - Dalam kedua opsi, `attachTindakLanjut`, `process()`, dan pembuatan penyelesaian **mewajibkan `checkRead(...).allowed` atas induk**, sehingga tidak ada yang menindaklanjuti surat yang tidak bisa dibacanya.
13. **Disposisi oleh pengawas:** aturan `distribute()` bahwa unit sumber harus pemilik surat masuk (`distribution.service.ts:40-51`) **dipertahankan**. Sesuai D1, TU adalah pemilik surat yang dicatatnya. Direktorat tidak mendisposisikan ulang di v1; jika salah alamat, direktorat menolak dan TU mendisposisikan ulang.

---

## 5. API backend

Endpoint baru ada di `backend/src/routes/rangkaian.routes.ts` (BARU), dipasang `app.use('/api/rangkaian', …)` setelah `app.ts:378`, dengan logika di `backend/src/services/rangkaian.service.ts` (BARU). Aturan umum:
- Semua `:id` memakai `validateIdParam`.
- Semua tulis memakai `canWriteMiddleware` dan `logActionOrThrow(tx)`.
- Semua path ditambahkan ke allowlist `demo-access.middleware.ts:45-53`.
- Semua handler GET bebas efek samping selain audit view.

| Method | Path | Fungsi | Peran |
|---|---|---|---|
| GET | `/api/rangkaian/lacak?q&tahun&mode=lacak\|referensi\|cek&limit≤8` | Pencarian terkelompok + pratinjau ≤8 node/kartu (**backend di P3**) | semua role terprovisi (lacakLimiter) |
| GET | `/api/rangkaian?unitPengolahId&status&asal&page` | Daftar Berkas Rangkaian (default mengecualikan `data_lama`) | peserta/pengawas |
| GET | `/api/rangkaian/:id`, `/api/rangkaian/by-surat/:jenis/:suratId` | Rangkaian lengkap: anggota (tersamar), relasi, disposisi, rangkaian terkait (1 hop, ≤5), `aksiDiizinkan[]`, `truncated` (≤300 node) | peserta/pengawas/owner |
| POST | `/api/rangkaian/:id/tautan` | Tautkan surat tunggal ke rangkaian ini; induk rangkaian 1-anggota diproses sebagai gabung (§3). `{jenis,suratId,keAnggotaId,jenisRelasi,keterangan}` | pemilik surat yang juga peserta/pengawas target |
| POST | `/api/rangkaian/:id/gabung` | Gabungkan rangkaian lain ke sini, termasuk pemindahan `surat_distributions.rangkaian_id`; sumber dan target harus `aktif\|selesai`. `{sumberId, alasan≥10}` | admin pengawas atau super_admin |
| POST | `/api/rangkaian/relasi/:relasiId/batal` | Batalkan relasi `{alasan≥10}`; hitung ulang status | pembuat relasi/pengawas, rangkaian belum diberkaskan |
| PUT | `/api/rangkaian/:id/unit-pengolah` | Ubah unit pengolah; hanya ke unit yang sudah ada di jangkauan (lihat bawah), dengan pratinjau dan audit delta akses | pencatat/pengawas, sebelum diberkaskan |
| POST | `/api/rangkaian/:id/selesai` / `/buka-kembali` | `{catatan≥10}` (mengisi `selesai_manual`) / `{alasan}` | pengolah/pencatat |
| POST | `/api/rangkaian/:id/berkaskan` | `{unitPengolahId, klasifikasiItemId, konfirmasi:true, catatan?}`; dari `selesai`, atau `aktif` tanpa disposisi terbuka dan tanpa anggota hidup draft/pending/rejected | pengolah/pencatat/pengawas (FULL_ADMIN) |
| POST | `/api/rangkaian/disposisi/:distribusiId/tutup` | Pengawas menutup disposisi yang tidak dapat diproses target `{alasan≥10}` → `processed`, `ditutup_pengawas=true`, `processed_by` = pengawas, grant disposisi dicabut | admin pengawas |
| POST | `/api/rangkaian/anggota/:anggotaId/ajukan-akses` | Ajukan grant untuk node tersamar lewat `requestViaRangkaian` (§4.11) | peserta/pengawas (flag) |
| POST | `/api/rangkaian/:id/koreksi-berkas` | Ajukan koreksi unit pengolah/klasifikasi berkas yang sudah diberkaskan `{unitPengolahBaru, klasifikasiBaru, alasan≥10}` | super_admin (pengaju) |
| POST | `/api/rangkaian/koreksi-berkas/:koreksiId/putuskan` | Setujui/tolak; bila setuju, terapkan dalam tx dengan `set_config('simsa.berkas_koreksi', id, true)` → status `applied` | super_admin lain (maker-checker) |
| POST | `/api/rangkaian/data-lama/tutup-massal` | Berkaskan/tutup massal rangkaian `data_lama` per filter | super_admin, admin pengawas |

**Batas `unitPengolahId`** (PUT unit-pengolah maupun berkaskan). Nilainya harus salah satu dari:
- target disposisi non-rejected di rangkaian itu
- unit penulis anggota
- pemilik induk

Unit lain (misalnya `bagian_*` atau direktorat yang tidak terlibat) ditolak 422 dengan pesan "Disposisikan dulu ke unit ini". Dialog menampilkan konfirmasi "unit yang mendapat akses baru" seperti pada gabung (biasanya kosong karena unitnya sudah di jangkauan), dan audit mencatat delta akses.

**Perubahan pada kode yang sudah ada:**

- **`validators/schemas.ts`:**
  - `createSuratMasukSchema` mendapat `disposisi?: {targets:[{unitKerjaId, batasWaktu?, penanggungJawab?}], instruksi?}` dan `referensi?: {jenis:'surat_keluar', id}`.
  - `createSuratKeluarSchema` mendapat `asalNaskah?` dan `tindakLanjut?: {jenis, suratId, jenisRelasi, distribusiId?}`. `inisiatif` bersama induk menghasilkan 400. `balasanUntuk` lama dipetakan ke `tindakLanjut` dengan relasi `balasan`.
  - `createDistributionSchema.instruction` menjadi `.nullish()` (sudah di P0).
  - `processDistributionSchema` (BARU) berisi `{penyelesaianSuratKeluarId?} | {catatanPenyelesaian ≥10}`.
  - `status` dihapus dari `updateSuratMasukSchema` (P3).
- **`distribution.service.ts`:**
  - Signature menjadi `distribute(data, auditContext?, tx?)`. Tanpa `tx`, fungsi membuka transaksinya sendiri seperti sekarang (:39); dengan `tx`, fungsi memakai transaksi luar.
  - **Semua** pemanggil, termasuk `POST /api/distributions` yang dipakai `DistributeDialog`, memanggil `rangkaianService.ensureForSuratMasuk(tx)` terlebih dahulu dan mengisi `rangkaian_id` di transaksi yang sama.
  - Validasi `target ≠ source` dan `can_receive_distribution`, serta aturan surat terkendali §4.12.
  - Cek duplikat (:54-66) mengabaikan `rejected`.
  - Audit tetap `entityType:'surat_distribution'`.
  - `findInbox` **selalu** mencantumkan baris milik target untuk keperluan routing. Perihal/dari/instruksi disamarkan (placeholder §4.8) bila kelasnya tidak boleh dibaca, sehingga target tetap bisa Tolak, dan pengawas bisa Tutup Disposisi.
  - `receive` tetap eksplisit (PUT `/:id/receive`, `canWriteMiddleware`) dan juga dijalankan implisit oleh create tindak lanjut/penyelesaian di tx yang sama.
  - `process` mengisi `processed_by` dan penyelesaian. Syaratnya:
    - `checkRead` atas induk lolos
    - surat keluar penyelesaian sudah disetujui, milik unit target, dan anggota rangkaian yang sama
  - Setelah proses, `rangkaianService.recomputeStatus(tx)` dipanggil.
- **`surat-masuk.service.ts`:**
  - **`create` (:193-282):** setelah insert, bila ada `disposisi`/`referensi`, panggil `rangkaianService.ensureForSuratMasuk(tx, …)` lalu `distribute(data, auditContext, tx)`. Hook ini dimuat dari modul terpisah yang dapat di-`vi.mock`.
  - **`update`/`delete`:** untuk anggota rangkaian `diberkaskan`, soft-delete dan perubahan `nomor_surat`/`perihal`/`sifat_surat` ditolak (409). Untuk anggota rangkaian `aktif`/`selesai`, perubahan ketiga kolom itu dan soft-delete mewajibkan `alasan` ≥10 yang diaudit, lalu `recomputeStatus`.
- **`surat-keluar.service.ts` `create`:**
  - Blok cek same-unit dan flip otomatis (:233-248, :284-293) diganti `rangkaianService.attachTindakLanjut(tx, …)`. Wewenangnya:
    - pemilik induk, target disposisi hidup, atau pengawas
    - **dan** `checkRead` atas induk lolos
    - rangkaian tidak boleh `diberkaskan`
  - `balasan_untuk` hanya diisi untuk balasan same-unit ke surat masuk.
  - Hook diletakkan **setelah insert**, jauh dari baris `assertImportConnected`/`prepareSuratRuleSelection` yang diubah branch snapshot.
  - `update`/`delete` (sudah dibatasi draft/rejected, :367,:456) memanggil `recomputeSuratMasukStatus`.
- **`approval.service.ts`:** jalur approve final (sekitar :482-500) dan reject memanggil `recomputeSuratMasukStatus(tx)` dan `recomputeStatus(tx)`.
- **Semua query recompute/prasyarat** menyaring `is_deleted IS NOT TRUE`, sehingga anggota draft yang dihapus tidak memblokir `selesai` selamanya.
- **`surat-masuk.routes.ts:182-199`, `surat-keluar.routes.ts` GET `/:id`, dan `file-access.routes.ts:179,:215`:** beralih ke `checkRead`. Respons ditambah `aksesMelalui` dan `aksiDiizinkan[]`.
- **`record-access-grant.service.ts`:**
  - Tambah `requestViaRangkaian` (menerima `tx` opsional, karena `request()` membuka transaksinya sendiri di :113).
  - Perluas re-check :287-293 dengan predikat jangkauan hidup yang sama.
  - Tambah pembuatan permohonan grant 'disposisi' (§4.12, di balik flag).
- **`sanitize.middleware.ts`:** himpunan `MULTILINE_FIELDS` (BARU) berisi `instruction`, `instruksi`, `catatan`, `catatanPenyelesaian`, `alasan`, dan `keterangan`. Tag tetap dibuang, tetapi baris baru dipertahankan.
- **`rate-limiter.middleware.ts`:** `lacakLimiter` (BARU) 90 req/menit, dikunci per `req.user.id` seperti `ocrLimiter`, dipasang setelah auth pada route lacak. **`generalLimiter` tidak diberi skip.**
- **`notification.service.ts`:**
  - Blok pending (:172-195) memakai status turunan.
  - Blok kotak distribusi menambah urgensi `batas_waktu ≤ 2 hari`.
  - Baris data lama dikecualikan.
- **Tidak disentuh:** `SuratMasukService.getStats`, `arsip.service`, `ArchiveDialog`, `KlasifikasiPicker` (hanya diimpor, tidak diubah), `dosir.service`, serta pemanggilan maupun payload producer SRIKANDI.

---

## 6. Pencarian terintegrasi "Lacak Surat"

- **Normalisasi nomor:** `utils/nomor-surat.ts` (BARU) memuat:
  - `normalizeNomor(q) = q.toLowerCase().replace(/[^0-9a-z]+/g,'')`
  - `nomorNormSql(col)`, yang menghasilkan ekspresi **persis sama** dengan index
  - `escapeLike()` dengan `ESCAPE '\'`

  Test paritas TS/SQL memastikan normalisasi nomor konsisten. Paritas klasifikasi/visibilitas diuji terpisah (§4.9).
- **Klasifikasi kueri:**
  - `q` di-trim, panjang 3–100.
  - Mode nomor dipakai bila q memuat digit dan salah satu dari `/ . -`, atau `qNorm` ≥3 dengan digit.
  - Token perihal berupa kata Unicode (`\p{L}\p{N}`) ≥2 karakter yang di-AND-kan. Ini sekaligus memperbaiki kehilangan token non-ASCII oleh tokenizer ASCII di `extractSearchTerms` (`global-search.service.ts:470-476`).
- **Seed CTE:**
  - `UNION ALL` atas `surat_masuk` dan `surat_keluar`, dengan `is_deleted IS NOT TRUE`.
  - Predikat visibilitas diterapkan dalam SQL lewat `visibleSql(user)` dari `visibility-spec.ts` (§4.3), fragmen yang sama dengan yang dipakai `checkMany`. Unit sendiri memakai kebijakan list; pengawas/peserta hanya kelas `biasa` atau yang punya grant.
  - Left join `rangkaian_anggota`, dengan `LIMIT 200` **setelah** penyaringan.
  - Tidak ada tahap "cari tanpa scope lalu saring", sehingga hasil tidak terpotong diam-diam.
- **Skor:**

  | Kecocokan | Skor |
  |---|---|
  | nomor mentah sama persis (case-insensitive) | 100 |
  | `nomor_norm` sama | 90 |
  | prefix `nomor_norm` (index) | 70 |
  | substring `nomor_norm` (hanya bila `len(qNorm) ≥ 5`) | 50 |
  | semua token di perihal | 40 (+5 bila frasa utuh) |
  | dari/kepada | 20 |

  Skor nomor mentah di atas skor normal mengatasi tabrakan seperti `1/23` vs `12/3`.
- **Pengelompokan:** hasil dikelompokkan per `coalesce(resolve_digabung(rangkaian_id), 'surat:'||id)` dan diurutkan dengan `max(skor)` lalu `max(tanggal_surat)`. Delapan kelompok teratas diambil. `resolve_digabung` aman dari loop karena trigger melarang rantai `digabung` (§3).
- **Ekspansi:** tidak butuh rekursi karena keanggotaan tersimpan. Satu kueri `WHERE rangkaian_id = ANY(:ids)` mengambil pratinjau ≤8 node per kartu (tersamar per node) beserta label relasi, tahun, dan jenis naskah. Rangkaian lengkap diambil lewat `GET /:id`. Bila hanya satu kelompok cocok, klien langsung membukanya.
- **Mode:**
  - `referensi`: picker Nomor Referensi dan tautan.
  - `cek`: peringatan duplikat saat registrasi; hanya mengembalikan kecocokan nomor persis/normal di scope pengguna.

  Ketiga mode dibangun di **P3** karena dibutuhkan registrasi dan picker.
- **Batas:** `SET LOCAL statement_timeout='2s'`, maksimal 8 kelompok, 8 node pratinjau, dan 300 node pada detail.
- **Performa:**
  - Tanpa pg_trgm: prefix/persis nomor dilayani btree `text_pattern_ops`. Perihal ILIKE memakai seq scan atas sekitar 2–10 ribu baris per tahun, yang memakan beberapa ms dan layak hingga sekitar 100 ribu baris. Targetnya p95 <150 ms.
  - Dengan pg_trgm (opsional, fase terpisah): extension dipasang dulu lewat langkah privileged satu kali yang ditinjau (pola pgcrypto di `grants/0001:353-380`). Setelah itu migrasi berikutnya menambah GIN `gin_trgm_ops` pada ekspresi nomor dan `lower(perihal)`, dan akan gagal keras bila extension belum ada. Kode pencarian tidak berubah.
- **Rate limit:**
  - Klien memakai debounce 300 ms, minimal 3 karakter, AbortController, penjaga urutan basi, dan cache 20 entri.
  - Server memakai `lacakLimiter` per user.
  - Ctrl+K GlobalSearch tidak menambah request; hanya ada item "Lacak rangkaian 'q'".
  - Masalah NAT pada `generalLimiter` (500/15 menit per IP, `app.ts:344`) dijadikan **tugas terpisah**: re-key per user terautentikasi, dengan sign-off. Limiter ini tidak di-skip.

---

## 7. Antarmuka

**Rekomendasi letak tombol Buat Surat Inisiatif.** Tombol "Surat Baru" di `SuratKeluar.jsx:379-386` diganti **split button**:
- Aksi utama **"Buat Surat Inisiatif"**, dengan menu Nota Dinas, Surat Edaran, Surat Undangan, Keputusan, Surat Tugas, dan Lainnya…
- Aksi sekunder **"Tindak Lanjut Surat Masuk…"**, yang membuka picker kotak disposisi dan surat masuk unit.

Alasannya:
- operator memulai surat keluar dari halaman ini;
- satu klik langsung memilih jenis naskah;
- dua asal surat terpisah dengan jelas sejak awal, sama seperti SRIKANDI memisahkan registrasi naskah keluar tanpa referensi dari "Saya Balas".

Tombol juga tersedia di dua tempat lain:
- Quick action di `Dashboard.jsx:394` (saat ini "Catat Surat Keluar") ditambah "Buat Surat Inisiatif".
- Route nyata `/surat/keluar/inisiatif?naskah=Keputusan` (RoleGuard `ALL_ADMIN_ROLES`, `App.jsx:243-251`) yang me-render `TambahSuratKeluar` dengan `mode="inisiatif"`. Route ini bisa dibookmark dan sorotan sidebar tetap benar.

Daftar surat keluar (:643-648) menampilkan badge **Inisiatif** atau **Tindak Lanjut**.

**TambahSuratKeluar.jsx:**
- Mode dibaca dari route atau `location.state`, dan state `tindakLanjut` dikonsumsi di :192-209.
- Kartu referensi di :569-672 dipindah ke `components/surat-keluar/ReferensiSection.jsx` (BARU):
  - mode inisiatif: badge "Inisiatif: memulai rangkaian baru", tanpa referensi
  - mode tindak lanjut: chip Nomor Referensi terkunci (nomor, perihal, kode RS)
- Picker berbasis Lacak (`mode=referensi`) menggantikan picker `belum_dibalas`-saja (:268-282), sehingga surat yang sudah dibalas bisa dipilih.

**Menu Tindak Lanjut.** `components/surat/TindakLanjutMenu.jsx` (BARU) menggantikan "Balas Surat" di `DetailHeader.jsx:55-133`, `StatusSidebar.jsx:133-175`, dan menu baris `SuratMasuk.jsx:699-721`. Item menu tampil sesuai `aksiDiizinkan[]` dari server, bukan `canWrite(unit rekaman)`:
- **Saya Balas**
- **Buat Nota Dinas**
- **Disposisi ke Direktorat** (khusus TU/pemilik): `DistributeDialog` diperluas dengan:
  - multi-target
  - chip instruksi dari `backend/src/config/instruksi-disposisi.ts` (BARU, statis)
  - batas waktu
  - radio **Penanggung jawab (Unit Pengolah)**
  - untuk surat terkendali, perilaku §4.12: diblokir selama flag mati, atau info "grant disposisi akan diajukan" bila flag menyala
- **Tautkan ke Rangkaian**
- **Tandai Selesai**
- Di detail Keputusan: **Buat ND Penjelas**

Direktorat yang melihat surat Ditjen hanya mendapat Saya Balas, Buat Nota Dinas, Terima, dan Penyelesaian. Tombol edit/hapus/arsip disembunyikan bila `aksesMelalui ≠ 'owner'`.

**Panel Alur Surat.** `components/surat/AlurSuratPanel.jsx` (BARU) memakai `TimelineItem` yang diekstrak dari `DosirDetail.jsx:53-104` ke `components/surat/TimelineItem.jsx` (BARU). Panel diletakkan setelah InfoSection di `SuratMasukDetail.jsx` (~:139) dan menggantikan tautan tunggal di `SuratKeluarDetail.jsx:452-466`. Isinya:
- kode RS, status, pencatat → pengolah, dan chip peserta
- tabel **Status Tindak Lanjut per penerima** (unit, instruksi, batas waktu, status, penyelesaian), dengan aksi **Tutup Disposisi** untuk pengawas
- linimasa surat, relasi, approval, kejadian selesai/diberkaskan, dan koreksi berkas
- node tersamar berwarna abu-abu dengan tombol "Ajukan Akses"
- "Rangkaian terkait"
- tombol **Berkaskan ke Direktorat (Unit Pengolah)**, yang membuka `BerkaskanDialog.jsx` (BARU) dengan pilihan unit terbatas pada jangkauan dan langkah konfirmasi kedua
- **Gabungkan Rangkaian** (khusus pengawas)
- **Koreksi Berkas** (khusus super_admin, pada rangkaian `diberkaskan`)

Kata "Kembalikan" **tidak** dipakai untuk penyerahan berkas karena sudah dipakai untuk penolakan ("Tolak & Kembalikan", `DistributionInbox.jsx:419,533`).

**Lacak Surat (P4).**
- `pages/LacakSurat.jsx` (BARU) di `/surat/lacak` (RoleGuard `ALL_PROVISIONED_ROLES`), dengan entri sidebar "Lacak Surat" di grup Surat (`app-sidebar.jsx:84-85`).
- Halaman berisi satu input besar, kartu rangkaian dengan pratinjau node inline, ekspansi di tempat, dan sinkronisasi URL (`?q=`, `?rangkaian=`).
- Tab **Berkas Rangkaian** memuat filter unit pengolah dan status. Data lama tersembunyi secara default, dengan aksi "Tutup massal data lama" untuk pengawas.
- `GlobalSearch.jsx` mendapat aksi "Lihat rangkaian" per hasil surat tanpa request tambahan.

**Kotak Disposisi direktorat.** `DistributionInbox.jsx:344-425` tetap menjadi kotak disposisi (tidak diganti). Perubahannya:
- Baris menjadi tautan ke detail surat.
- Ditambah tombol **Terima**, **Buat Tindak Lanjut**, dan **Penyelesaian**, kolom batas waktu, dan filter "lewat batas waktu".
- Baris surat yang tidak boleh dibaca tetap tampil dengan data tersamar. Hanya **Tolak** yang aktif, dengan info "Ajukan akses / hubungi TU".

**Registrasi.**
- `TambahSuratMasuk.jsx:127-135` beralih dari label tetap ke multi-pilih unit (termasuk Dit. PLP). Label Kabag tetap ada sebagai chip label-saja.
- Ditambah picker Nomor Referensi dan peringatan duplikat nomor (keduanya memakai backend `/lacak` dari P3).
- `InfoSection.jsx` menghapus field fantom (tanggalDiterima, noAgenda, catatan) dan menampilkan disposisi serta keterangan.

**Service klien:** `frontend/src/services/rangkaian.service.js` (BARU).

**Role gating:** tulis hanya untuk FULL_ADMIN (praktisnya `admin_unit` dan `super_admin`) yang ada di `aksiDiizinkan`. Role lama staff/auditor read-only, sehingga membuka halaman tidak pernah menulis apa pun selain audit view. Pengaturan Unit Kerja mendapat toggle **Unit Pengawas (pencatat terpusat)** khusus super_admin.

---

## 8. Status & siklus hidup

- **Rangkaian:**
  - `aktif → selesai → diberkaskan`. Status terakhir terminal dan dikunci trigger; hanya unit pengolah/klasifikasinya yang bisa dikoreksi lewat Koreksi Berkas.
  - `selesai → aktif` lewat buka kembali dengan alasan, atau otomatis saat ada anggota/disposisi baru.
  - `aktif|selesai → digabung` lewat penggabungan.
  - **Himpunan status anggota yang memblokir** (dipakai sama persis untuk auto-selesai dan berkaskan): anggota surat keluar **hidup** (`is_deleted IS NOT TRUE`) dengan `approval_status IN ('draft','pending','rejected')`. Surat keluar `rejected` yang ditinggalkan harus dihapus (soft) atau relasinya dibatalkan.
  - Transisi otomatis ke `selesai` terjadi bila tidak ada disposisi `sent/received` dan tidak ada anggota yang memblokir, **serta** memenuhi salah satu syarat berikut:
    - minimal satu disposisi processed
    - minimal satu tindak lanjut disetujui
    - rangkaian berasal inisiatif

    Selain itu ada **Tandai Selesai** manual dengan catatan (`selesai_manual=true`).
  - Data lama dibuat `selesai` (`selesai_manual=false`) dan disaring dari daftar kerja/notifikasi. Rangkaian ini dibuka kembali otomatis bila ada surat baru yang terkait.
- **Disposisi:** `sent → received → processed` (penyelesaian atau tutup oleh pengawas), atau `rejected` (dapat dikirim ulang). `received` hanya lewat aksi tulis eksplisit.
- **Approval surat keluar:** tetap `draft/pending/approved/rejected`. Tidak ada `signed` karena TTE `sign()` mengembalikan 501.
- **`surat_masuk.status` (kompatibilitas):**
  - Nilainya tetap `belum_dibalas | sudah_dibalas`, tetapi **diturunkan**. `sudah_dibalas` ⇔ salah satu dari:
    - ada relasi aktif `balasan`/`tindak_lanjut` ke surat itu dari surat keluar hidup berstatus `approved`
    - ada disposisi processed dengan penyelesaian
    - rangkaiannya `selesai_manual=true` dan `asal <> 'data_lama'`
  - **Monoton untuk baris tanpa bukti rangkaian.** Recompute hanya boleh menurunkan `sudah_dibalas → belum_dibalas` bila surat itu punya relasi rangkaian (aktif atau dibatalkan) atau disposisi processed di rangkaiannya, yaitu status yang memang pernah diturunkan dari rangkaian. Nilai manual atau hasil impor Excel (`migration.service.ts:161`) tanpa relasi tidak pernah diturunkan.
  - `recomputeSuratMasukStatus(tx, smIds)` berjalan saat create/update/delete surat keluar, approve/reject, pembatalan relasi, proses/tutup disposisi, dan selesai. Setiap perubahan nilai diaudit dalam transaksi yang sama.
  - Ini memperbaiki flip saat masih draft yang tidak diaudit dan tidak pernah dibalik (`surat-keluar.service.ts:284-293`).
  - Konsumen seperti `getStats`, `getPendingForReply`, `report.service.ts:208`, `export.service.ts:108,621`, enum swagger, dan impor tetap bekerja tanpa perubahan kode.
  - Release notes perlu mencatat bahwa hitungan "belum dibalas" kini ikut memasukkan surat yang balasannya masih draft.
  - Baris lama tidak ditulis ulang.
- **`statusAlur` turunan** dikembalikan API dan tidak disimpan: `terdaftar | didisposisikan | ditindaklanjuti | selesai | diberkaskan`.

---

## 9. Pemberkasan & pengembalian ke direktorat

- **Unit Pengolah** diambil dari penerima disposisi `penanggung_jawab`, dengan cadangan unit pemilik induk bila tidak ada disposisi (misalnya inisiatif).
  - Nilainya dapat diubah pencatat/pengawas sebelum diberkaskan, tetapi **hanya** ke unit yang sudah ada di jangkauan: target disposisi non-rejected, penulis anggota, atau pemilik induk.
  - Unit lain harus didisposisikan lebih dulu, karena unit pengolah memberi akses baca permanen setelah berkas ditutup.
  - Dialog menampilkan "unit yang mendapat akses baru", dan audit mencatat delta aksesnya.
- **"Dikembalikan ke direktorat" (D2)** terdiri dari dua langkah:
  1. Disposisi meneruskan surat untuk tindak lanjut.
  2. **Berkaskan ke Direktorat** menetapkan rangkaian sebagai berkas milik Unit Pengolah, lalu rangkaian muncul di tab Berkas Rangkaian unit itu.

  Rekaman tidak dipindah kepemilikannya, karena trigger 0021 dan grant yang terikat unit melarangnya. Berkas memuat surat masuk dan balasannya bersama-sama (Pasal 137(2)).
- **Syarat pemberkasan:**
  - tidak ada disposisi terbuka (`sent/received`)
  - tidak ada anggota yang memblokir (himpunan §8: surat keluar hidup `draft/pending/rejected`)
  - `klasifikasi_item_id` wajib (P2/2026 hlm. 18), dengan default dari klasifikasi induk
  - konfirmasi dua langkah yang menampilkan unit pengolah dan klasifikasi (keduanya menentukan retensi)
  - aktor adalah FULL_ADMIN pengolah, pencatat, atau pengawas
- **Penutupan** diberlakukan di DB (trigger §3), mencakup anggota, relasi, **dan disposisi**. Setelah diberkaskan:
  - Disposisi baru atas surat masuk anggota ditolak (409) dan diarahkan ke koreksi atau surat lanjutan.
  - Surat masuk induk/anggota tidak bisa di-soft-delete dan nomor/perihal/sifatnya tidak bisa diubah (§5).
  - Surat terkait yang datang kemudian memulai **rangkaian lanjutan** (`lanjutan_dari_id`) yang tidak mewarisi jangkauan.
- **Koreksi Berkas (v1):** bila unit pengolah atau klasifikasi salah pilih, super_admin mengajukan koreksi (alasan ≥10), lalu super_admin **lain** memutuskan.
  - Penerapan berjalan dalam satu transaksi dengan `set_config('simsa.berkas_koreksi', id, true)`. Trigger hanya mengizinkan perubahan yang sama persis dengan baris koreksi `approved`.
  - Setiap langkah diaudit dengan `logActionOrThrow`.
  - Status `diberkaskan` sendiri tidak dapat dibuka kembali.
- **Dosir** tidak dipakai sebagai berkas rangkaian. Dosir tetap map kasus manual, karena `removeSurat*` tidak memeriksa status dan `DELETE /api/dosir/:id` menghapus permanen. PANDUAN menjelaskan bahwa "Berkas Rangkaian" adalah berkas naskah, sedangkan "Dosir" adalah map kasus.
- **Retensi:** selesai atau diberkaskan **tidak** memulai retensi secara otomatis. `selesai_at` dan `diberkaskan_at` (dengan aktor dan audit) diekspos sebagai **bukti** untuk proses maker-checker `retention_trigger_events` yang sudah ada (jenis `kegiatan_selesai`/`berkas_ditutup`) pada arsip anggota. Di v1 ada tiga hal:
  - `GET /api/rangkaian/by-surat/...` mengembalikan tanggal penutupan
  - panel menampilkan "Bukti penutupan berkas: RS-…, tgl …"
  - PANDUAN menjelaskan cara memakainya sebagai `evidence`

  Integrasi UI di arsip menunggu branch snapshot di-merge (§13).

---

## 10. Tahapan implementasi

| Fase | Cakupan | Bergantung | Hari | Kriteria selesai |
|---|---|---|---|---|
| **P0 Prasyarat & perbaikan bug** | **Pre-flight prod read-only:** baris `unit_kerja` (ada/tidaknya `dir_*`, `direktorat-*`), duplikat distribusi aktif, status tak dikenal, index manual (`idx_surat_keluar_balasan`), pg_trgm, keberadaan data lama, **daftar distinct `sifat_surat`** dan jumlah distribusi `sent/received` per kelas. **Perbaikan:** `createDistributionSchema.instruction` `.nullish()` (bug 400 DistributeDialog); `is_deleted IS NOT TRUE` di list keluar (`surat-keluar.service.ts:54`) dan notifikasi; `validateIdParam` pada `/balasan`, `/with-links`, `/source`, `/archive-full`; field fantom InfoSection; **normalisasi klasifikasi SQL di `incomingSecurityCondition` disamakan dengan TS** (trim → lower → `[\s-]+`→`_` → pemetaan), cikal bakal `visibility-spec.ts`. Dimerge setelah PR #15. | – | 2 | Laporan pre-flight ditandatangani; route test distribusi tanpa instruksi hijau; RTL InfoSection; test paritas TS/SQL klasifikasi atas semua `sifat_surat` prod ('Sangat Segera' → biasa tampil di inbox) |
| **P1 Skema** | 0046 (termasuk `rangkaian_koreksi_berkas`, `selesai_manual`, `ditutup_pengawas`, trigger penutupan atas `surat_distributions`, trigger anti-siklus gabung), 0047, Drizzle, REVOKE di 0002, runbook deploy (migrate → converge → backfill langkah 1 → kode), `rangkaianService` inti (ensure/attach/recompute/gabung), `distribute(data, auditContext?, tx?)` | P0 | 4,5 | Test migration-chain PGlite 0000–0047 hijau (termasuk fixture perihal NULL); CHECK menolak pembatalan/berakhir/selesai manual dengan alasan NULL; trigger 0021 tidak terpicu saat menautkan surat terarsip; trigger penutupan menolak insert anggota/relasi/disposisi; trigger menolak `digabung_ke_id` ke rangkaian `digabung`; paritas normalisasi TS/SQL; precheck 0046 RAISE pada data ganda; konvergensi grants lulus |
| **P2 Akses baca lintas unit** | `visibility-spec.ts` lengkap (`visibleSql`), `findActiveGrant`, `checkRead`, `checkMany`, pengawas via unit efektif, `scopeForAuthorizedRead`, detail/berkas (kedua cabang) + audit `via`, `GET /rangkaian/:id` & `/by-surat`, AlurSuratPanel read-only, penyamaran | P1 | 5 | Matriks keamanan unit × role × kelas × grant × jangkauan, termasuk `admin_sesditjen` dengan unit NULL (tetap pengawas) dan `admin_unit@sesditjen` (pengawas via `is_unit_pengawas`), `admin_unit@dir_bppt` (bukan pengawas), dan `staff@sesditjen` (role lama, tanpa jangkauan); property test paritas `checkRead` ↔ SQL; non-peserta tetap 404 (`surat-file-security.routes.test.ts` hijau); PUT/DELETE lintas unit tetap 404; disposisi ditolak mencabut jangkauan; judul/instruksi tersamar; hasil `check()` identik (snapshot test) |
| **P3 Alur tindak lanjut & inisiatif** | Backfill langkah 1 (disposisi eksplisit, tanpa gerbang); semua jalur `distribute()` lewat `ensureForSuratMasuk` (termasuk `POST /api/distributions`); **backend `/lacak` (3 mode), `lacakLimiter`, `escapeLike`, `normalizeNomor`**; ekstensi create masuk/keluar; disposisi multi-target + batas waktu + penanggung jawab; aturan surat terkendali §4.12; kotak disposisi bertopeng; terima eksplisit; penyelesaian (dengan `checkRead`); tutup disposisi pengawas; status turunan monoton + audit; selesai/berkaskan (dua langkah, unit dalam jangkauan)/tautan/gabung (pemindahan distribusi)/batal; guard update/delete surat masuk anggota; MULTILINE_FIELDS; TindakLanjutMenu; split button & route inisiatif; ND Penjelas; Kotak Disposisi; registrasi (unit, Nomor Referensi, cek duplikat); Ajukan Akses (`requestViaRangkaian`, flag) | P2 | 7,5 | `surat_distributions.rangkaian_id IS NULL` = 0 setelah backfill langkah 1; skenario a–e lulus di Postgres; disposisi lama sebelum deploy dapat dibuka penerimanya; test create berbasis Proxy mock diperbarui (hook di-mock per modul); matriks Ajukan Akses (pengajuan oleh peserta luar unit, persetujuan, baca via grant); gerbang rilis: sign-off keamanan untuk flag Ajukan Akses, kebijakan surat terkendali, dan role (D5 sudah diputuskan) |
| **P4 Lacak Surat (UI)** | Halaman LacakSurat, tab Berkas Rangkaian, hook GlobalSearch, penyempurnaan ranking | P3 (backend `/lacak`) | 2,5–3 | Fixture ranking (beberapa varian `B-12/PTPP.1/IX/2024`, SK berulang tiap tahun, `1/23` vs `12/3`); test probing bahwa perihal tersamar tidak pernah cocok; EXPLAIN pada 50 ribu baris sintetis; RTL debounce/abort |
| **P5 Data lama & pelengkap** | Skrip backfill langkah 2 (dry-run → sign-off → `--apply`), flag `RANGKAIAN_DISPOSISI_LAMA_READ`, tutup massal data lama, **Koreksi Berkas** (endpoint + UI maker-checker), migrasi pengerasan `surat_distributions.rangkaian_id SET NOT NULL`, notifikasi batas waktu, ekspor "Balasan Untuk" sebagai nomor + kolom "Asal Naskah", PANDUAN; opsional: pg_trgm, re-key generalLimiter | P3, P4 | 3–4 | Skrip idempoten (dijalankan dua kali, jumlah baris identik); CSV pemetaan disetujui; peserta data lama tidak memberi akses saat flag mati; koreksi berkas hanya berhasil dengan GUC + baris approved oleh super_admin berbeda |

**Total sekitar 24–29 hari kerja.** Urutan dependensi: P0 → P1 → P2 → P3 → P4 → P5. Pekerjaan UI P4 boleh dimulai paralel setelah kontrak `/lacak` P3 dibekukan. Setiap PR memperbarui `app-sidebar.groups.test.jsx` dan `SuratKeluarDetail.rules.test.jsx` (mock service baru) bila menyentuh area tersebut.

---

## 11. Strategi pengujian

- **Unit (Vitest, pola Proxy-mock):**
  - fungsi murni `deriveRangkaianStatus` dan `deriveSuratMasukStatus`, table-driven, termasuk kasus monoton (status impor tanpa relasi tidak turun) dan `data_lama` tidak memicu `sudah_dibalas`
  - matriks wewenang `attachTindakLanjut`, termasuk penolakan bila `checkRead` gagal
  - `normalizeNomor` dan `escapeLike`
  - paritas `normalizeSecurityClassification` ↔ `klasifikasiNormSql` atas semua `sifat_surat` prod
  - pembentukan placeholder tersamar
  - pemilihan pengawas dari unit efektif
  - transaksi batal bila `logActionOrThrow` gagal
- **Route:**
  - matriks keamanan §10-P2
  - 400 untuk `inisiatif` bersama induk
  - 403 untuk tulis via peserta
  - GET detail tidak mengubah status disposisi (staff/auditor/demo)
  - 409 disposisi surat terkendali saat flag mati
  - 422 unit pengolah di luar jangkauan
  - `aksiDiizinkan` sesuai role
  - allowlist mode demo
- **Integrasi Postgres (`vitest.postgres.config.ts`):**
  - skenario a–e end-to-end
  - disposisi pra-deploy yang dibackfill langkah 1 lalu dibuka penerima
  - tindak lanjut bersamaan dan race auto-selesai (urutan kunci: mutex `surat_templates` → baris surat → baris rangkaian dengan id menaik → distribusi)
  - penggabungan dengan `ON UPDATE CASCADE` dan pemindahan distribusi (target tidak bisa selesai selama sumber punya disposisi terbuka)
  - tautan induk 1-anggota diproses sebagai gabung
  - siklus gabung ditolak
  - trigger penutupan atas anggota/relasi/disposisi
  - guard update/delete surat masuk anggota berkas
  - anggota draft yang dihapus tidak memblokir selesai
  - koreksi berkas dengan dan tanpa GUC
  - Ajukan Akses via rangkaian
  - backfill langkah 2 pada fixture yang meniru agregat lama (ejaan label, label kosong, balasan lintas unit)
- **Properti:** kombinasi acak role/unit/sifat/grant/jangkauan menghasilkan hasil `checkRead` = hasil seed SQL.
- **Migrasi:** PGlite migration-chain; precheck 0046 yang gagal pada data ganda; CHECK alasan NULL ditolak.
- **Frontend (RTL):**
  - prefill mode TambahSuratKeluar (inisiatif, tindak lanjut, ND penjelas)
  - gating TindakLanjutMenu dari `aksiDiizinkan`
  - panel dengan node tersamar dan terpotong
  - konfirmasi dua langkah BerkaskanDialog
  - baris kotak disposisi tersamar
  - debounce/abort dan sinkronisasi URL di LacakSurat
- **Regresi:** kontrak `integration-contracts.test.js`, test distribusi dan notifikasi yang ada, test `tunjuk-silang.routes.test.ts`, dan test outbox SRIKANDI (payload tidak berubah).

---

## 12. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Akses baca lintas unit melebar | `check()` tidak berubah; `checkRead` read-only; pengawas = konstanta kode + unit efektif + role TU saja; satu spesifikasi visibilitas untuk TS dan SQL dengan property test; penyamaran di SQL; audit `view_via_rangkaian` dan stream berkas; gabung hanya oleh pengawas dengan alasan dan pratinjau unit yang mendapat akses; unit pengolah hanya dari jangkauan; sign-off pemilik keamanan |
| Drift predikat TS ↔ SQL (kebocoran atau surat tersembunyi) | `visibility-spec.ts` sebagai sumber tunggal; parity test atas `sifat_surat` prod; property test `checkRead` ↔ seed |
| Disposisi macet selamanya ('Sangat Segera' tidak tampil, surat Rahasia tak terlihat target) | Normalisasi SQL diperbaiki di P0; inbox selalu menampilkan baris target secara tersamar; Tutup Disposisi oleh pengawas |
| Backfill label lama membuka sekitar 1.421 surat | Langkah 2 dry-run dengan CSV, sign-off, dan flag baca mati secara default; langkah 1 hanya memproses baris `surat_distributions` eksplisit |
| Disposisi pra-deploy 404 bagi penerima | Backfill langkah 1 wajib di runbook P3 sebelum kode aktif; semua jalur `distribute()` lewat `ensureForSuratMasuk` |
| Baris unit di prod belum terverifikasi | Pre-flight P0; 0047 fail-closed pada `direktorat-*` |
| Tabel baru langsung mendapat DELETE sebelum converge | Runbook: converge segera setelah migrate; kode tidak pernah memakai DELETE |
| Hitungan dashboard berubah karena status turunan | Release notes; baris lama tidak ditulis ulang; recompute monoton untuk baris tanpa bukti rangkaian |
| Surat terkendali didisposisikan, direktorat tidak bisa membaca | Keputusan §4.12: diblokir saat flag mati, grant disposisi bertujuan dan terikat unit saat flag menyala; tindak lanjut/penyelesaian mewajibkan `checkRead` atas induk |
| Berkas tertutup berubah diam-diam (disposisi baru, surat induk dihapus/diubah) | Trigger penutupan atas `surat_distributions`; guard update/delete surat masuk anggota; filter `is_deleted` di semua recompute |
| Salah pilih unit/klasifikasi saat pemberkasan | Konfirmasi dua langkah; Koreksi Berkas maker-checker via GUC dan audit |
| Siklus atau sisa rangkaian setelah gabung/tautan | Kunci baris berurutan, pemindahan distribusi, tautan 1-anggota = gabung, trigger anti-siklus |
| Batas `generalLimiter` terbagi di belakang NAT | `lacakLimiter` per user, debounce; re-key sebagai tugas terpisah dengan sign-off |
| Rebase dengan PR #15 dan branch snapshot | Dimerge setelah PR #15; `getStats`, `arsip.service`, `ArchiveDialog`, `KlasifikasiPicker`, `dosir.service` tidak disentuh; hook diletakkan setelah insert |
| Churn test create berbasis mock | Hook hanya berjalan bila payload tindak lanjut/disposisi ada dan dimuat dari modul yang dapat di-mock; waktunya sudah dianggarkan di P3 |
| Instruksi multi-baris diratakan | `MULTILINE_FIELDS` |

---

## 13. Di luar cakupan (YAGNI) & pertanyaan terbuka

**Di luar cakupan v1:**
- sinkronisasi SRIKANDI dan event outbox baru
- inbox per pengguna dan Status Baca
- aksi Koordinasi/Arahan terpisah dan aturan arah hierarki
- disposisi ulang oleh direktorat
- cetak lembar disposisi atau kartu kendali
- penomoran per jenis naskah dan placeholder `{kodeKlasifikasi}`
- TTE atau status `signed`
- approval lintas unit
- pewarisan klasifikasi otomatis
- pembukaan kembali **status** berkas yang sudah diberkaskan (koreksi unit pengolah/klasifikasi lewat Koreksi Berkas **termasuk** cakupan)
- pembuatan dosir otomatis
- pembekuan `surat_distributions`
- pemicu retensi otomatis
- integrasi UI bukti penutupan di halaman arsip (menunggu merge branch snapshot)
- FTS/tsvector
- role baru apa pun (termasuk akses tulis untuk staff)

**Keputusan tambahan (2026-09-26):**
- **D5 Role minimal.** Tidak ada role baru; hanya `super_admin` dan `admin_unit`. Kewenangan TU/pengawas ditentukan oleh unit (`unit_kerja.is_unit_pengawas`), bukan role. Petugas TU = `admin_unit` di unit `sesditjen`.
- **D6 Bagian cukup label.** `bagian_kepegawaian/keuangan/umum` tidak menjadi target disposisi; label Kabag tetap chip label-saja tanpa routing.

**Pertanyaan terbuka** (yang tersisa setelah D1–D6):
1. **Sign-off keamanan**, untuk:
   - penandaan `ditjen`/`sesditjen` sebagai unit pengawas
   - flag `RANGKAIAN_AJUKAN_AKSES`
   - kebijakan disposisi surat terkendali (§4.12), termasuk apakah persetujuan grant disposisi boleh didelegasikan dari super_admin ke admin pengawas pemilik
   - flag `RANGKAIAN_DISPOSISI_LAMA_READ` berdasarkan CSV dry-run
2. **Data lama di prod.** Apakah 2.047 surat masuk dari DB lama memang ada di prod saat ini, sehingga backfill langkah 2 diperlukan? Jawabannya ditentukan pre-flight P0.
3. **pg_trgm.** Siapa yang berwenang menjalankan langkah privileged satu kali di Neon, dan apakah memang diperlukan setelah pengukuran P4?

---

## Lampiran: Catatan verifikasi

**Diterapkan** (semua terverifikasi di repo):
1. CHECK `rangkaian_relasi`/`rangkaian_peserta` meloloskan NULL. Sekarang memakai `coalesce(length(trim(x)),0) >= 10` sesuai 0012:22, dengan test PGlite untuk alasan NULL.
2. Ajukan Akses terblokir oleh `inspect()` (`record-access-grant.service.ts:99-106`, `record-access.service.ts:166-185`). Ditambahkan `requestViaRangkaian` dengan predikat yang sama saat pengajuan dan persetujuan. `findActiveGrant` dipanggil `checkRead` tanpa syarat `unitAllowed` (`check()` :208-212 tetap).
3. Signature menjadi `distribute(data, auditContext?, tx?)` dan entityType audit tetap `surat_distribution` (:31-39, :72-76).
4. Rujukan tokenizer non-ASCII dikoreksi ke `global-search.service.ts:470-476`.
5. Endpoint koreksi nama unit dikoreksi ke `PUT /api/settings/unit-kerja/:id` (super_admin, hanya name/description/canReceiveDistribution; settings.routes.ts:193-213).
6. Normalisasi SQL inbox berbeda dari TS ('Sangat Segera' terkecualikan, :15-25 vs :46-66). Perbaikan masuk P0, ditambah inbox bertopeng dan Tutup Disposisi oleh pengawas.
7. Surat terkendali tidak terbaca direktorat. Keputusan §4.12 ditulis (blokir saat flag mati, grant 'disposisi' saat flag menyala), dan `checkRead` diwajibkan pada tindak lanjut/penyelesaian.
8. Jangkauan kosong untuk disposisi pra-deploy. Backfill dipecah: langkah 1 (disposisi eksplisit) di P3 tanpa gerbang, langkah 2 (label bebas) di P5 bergerbang. Semua jalur `distribute()` lewat `ensureForSuratMasuk`.
9. Duplikasi predikat TS/SQL. Dibuat `visibility-spec.ts` sebagai sumber tunggal, ditambah parity test dan property test.
10. Pengawas berbasis `users.unit_kerja_id`. Sekarang memakai `resolveEffectiveUnitKerjaId` dengan role TU saja, ditambah baris matriks NULL-unit dan `admin_unit@sesditjen`.
11. `unit_pengolah_id` bisa diisi sembarang unit. Kini dibatasi pada jangkauan, dengan pratinjau dan audit delta akses.
12. Gabung/tautan tidak memindahkan distribusi dan bisa membentuk siklus. Kini ada kunci berurutan, UPDATE `rangkaian_id` distribusi, tautan 1-anggota = gabung, dan trigger anti-siklus.
13. Berkas tertutup masih bisa berubah. Trigger diperluas ke `surat_distributions`, ditambah guard update/delete surat masuk anggota (DELETE soft di surat-masuk.routes.ts:465-482 tidak punya guard) dan filter `is_deleted`. Penyesuaian: disposisi baru atas surat yang sudah diberkaskan ditolak (409), tidak dialihkan ke rangkaian lanjutan, karena rangkaian lanjutan tidak memuat surat itu sehingga penerima tetap tidak bisa membacanya.
14. P3 bergantung pada `/lacak`. Backend `/lacak` dipindah ke P3, dan P4 hanya UI.
15. Tandai `received` saat GET melanggar `canWriteMiddleware` (distribution.routes.ts:229). Kini hanya lewat aksi tulis eksplisit.
16. Status turunan tidak konsisten. Ditambah `selesai_manual`, `data_lama` dikecualikan, recompute monoton, dan satu himpunan status anggota (draft/pending/rejected hidup) untuk selesai maupun berkaskan.
17. Berkaskan tidak dapat dikoreksi. Ditambah Koreksi Berkas maker-checker via GUC, serta konfirmasi dua langkah.

**Ditolak:** tidak ada.