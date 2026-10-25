# Laporan Pre-flight P0 Integrasi Surat

Dibuat: 2026-10-03T01:36:52.522Z
Mode: transaksi READ ONLY, REPEATABLE READ, statement_timeout 15s, diakhiri ROLLBACK.

Ringkasan: 21 pemeriksaan, 0 gagal.

## status_migrasi — Rantai migrasi yang sudah diterapkan

Keputusan: Harus jumlah_migrasi = 46 (0000-0045) dan migrasi_terakhir_when = 1789397416667. Selain itu: HENTIKAN, samakan migrasi dulu.

| jumlah_migrasi | migrasi_terakhir_when |
| --- | --- |
| 46 | 1789397416667 |

## unit_kerja_semua — Seluruh baris unit_kerja

Keputusan: Arsipkan sebagai bukti. Cocokkan nama resmi; koreksi nama lewat PUT /api/settings/unit-kerja/:id (super_admin).

| id | name | parent_id | unit_type | can_receive_distribution |
| --- | --- | --- | --- | --- |
| ditjen | Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan | NULL | NULL | true |
| sesditjen | Sekretariat Direktorat Jenderal | NULL | NULL | true |

## unit_kerja_direktorat — Keberadaan unit ditjen, sesditjen, dan dir_*

Keputusan: Unit dengan ada=false akan dibuat oleh 0047 (P1). parent_id/unit_type yang sudah terisi tidak ditimpa.

| unit_id | ada | parent_id | unit_type | can_receive_distribution |
| --- | --- | --- | --- | --- |
| dir_bppt | false | NULL | NULL | NULL |
| dir_ktpp | false | NULL | NULL | NULL |
| dir_plp | false | NULL | NULL | NULL |
| dir_ptep | false | NULL | NULL | NULL |
| ditjen | true | NULL | NULL | true |
| sesditjen | true | NULL | NULL | true |

## unit_kerja_id_direktorat_dash — Unit ber-id direktorat-* (0047 fail-closed)

Keputusan: Harus 0 baris. Bila ada, 0047 akan RAISE: putuskan pemetaan bersama pemilik data sebelum P1 (tidak ada rename otomatis).

_(0 baris)_

## pengguna_per_role_unit — Jumlah pengguna per role dan unit

Keputusan: Identifikasi calon pengawas (admin_unit di sesditjen/ditjen, admin_dirjen, admin_sesditjen). staff/auditor tidak mendapat jangkauan lintas unit (D5).

| role | unit_kerja_id | jumlah |
| --- | --- | --- |
| admin_unit | ditjen | 2 |
| admin_unit | sesditjen | 2 |
| super_admin | (NULL) | 3 |
| user | (NULL) | 1 |

## distribusi_per_status — Jumlah surat_distributions per status

Keputusan: Arsipkan sebagai bukti baseline.

_(0 baris)_

## distribusi_status_tak_dikenal — Distribusi dengan status di luar sent/received/processed/rejected

Keputusan: Harus 0 baris; bila ada, precheck 0046 akan RAISE. Rekonsiliasi lewat aplikasi (terima/proses/tolak) sebelum P1.

_(0 baris)_

## distribusi_aktif_ganda — Distribusi non-rejected ganda per (surat_masuk_id, target_unit_id)

Keputusan: Harus 0 baris; bila ada, precheck 0046 dan index unik aktif akan gagal. Rekonsiliasi: target menolak baris yang lebih baru dengan alasan.

_(0 baris)_

## distribusi_target_sama_dengan_sumber — Distribusi dengan target = sumber

Keputusan: Catat jumlahnya. P3 menolak baris baru seperti ini; baris lama tetap ikut backfill langkah 1.

| jumlah |
| --- |
| 0 |

## index_dan_objek_bentrok — Objek yang akan dibuat 0046 (index, constraint, tabel, sequence, trigger)

Keputusan: idx_surat_keluar_balasan boleh true atau false (0046 memakai IF NOT EXISTS). Semua objek lain, termasuk kedua trigger, harus false; bila true, 0046 akan gagal (trigger dibuat tanpa IF NOT EXISTS/OR REPLACE).

| nama | jenis | sudah_ada |
| --- | --- | --- |
| surat_distributions_status_check | constraint | false |
| surat_keluar_asal_naskah_check | constraint | false |
| idx_surat_keluar_balasan | index | false |
| surat_distributions_active_target_uidx | index | false |
| surat_distributions_rangkaian_idx | index | false |
| surat_distributions_target_status_idx | index | false |
| surat_keluar_nomor_norm_idx | index | false |
| surat_masuk_nomor_norm_idx | index | false |
| disposisi_label_unit | relation | false |
| rangkaian_anggota | relation | false |
| rangkaian_koreksi_berkas | relation | false |
| rangkaian_peserta | relation | false |
| rangkaian_relasi | relation | false |
| rangkaian_surat | relation | false |
| rangkaian_surat_kode_seq | relation | false |
| surat_distributions_closed_guard | trigger | false |
| unit_kerja_default_pengawas | trigger | false |

## kolom_bentrok — Kolom yang akan ditambahkan 0046

Keputusan: Harus 0 baris.

_(0 baris)_

## index_manual_surat — Seluruh index pada tabel surat dan unit_kerja

Keputusan: Arsipkan. Index yang tidak berasal dari rantai migrasi (mis. dari add_soft_delete_and_indexes.sql) dicatat sebagai index manual.

| tablename | indexname | indexdef |
| --- | --- | --- |
| surat_distributions | surat_distributions_pkey | CREATE UNIQUE INDEX surat_distributions_pkey ON public.surat_distributions USING btree (id) |
| surat_keluar | surat_keluar_jra_item_idx | CREATE INDEX surat_keluar_jra_item_idx ON public.surat_keluar USING btree (jra_item_id) |
| surat_keluar | surat_keluar_klasifikasi_item_idx | CREATE INDEX surat_keluar_klasifikasi_item_idx ON public.surat_keluar USING btree (klasifikasi_item_id) |
| surat_keluar | surat_keluar_pkey | CREATE UNIQUE INDEX surat_keluar_pkey ON public.surat_keluar USING btree (id) |
| surat_keluar | surat_keluar_unit_year_sequence_uidx | CREATE UNIQUE INDEX surat_keluar_unit_year_sequence_uidx ON public.surat_keluar USING btree (unit_kerja_id, tahun, no_urut) |
| surat_masuk | surat_masuk_jra_item_idx | CREATE INDEX surat_masuk_jra_item_idx ON public.surat_masuk USING btree (jra_item_id) |
| surat_masuk | surat_masuk_klasifikasi_item_idx | CREATE INDEX surat_masuk_klasifikasi_item_idx ON public.surat_masuk USING btree (klasifikasi_item_id) |
| surat_masuk | surat_masuk_pkey | CREATE UNIQUE INDEX surat_masuk_pkey ON public.surat_masuk USING btree (id) |
| surat_masuk | surat_masuk_unit_year_sequence_uidx | CREATE UNIQUE INDEX surat_masuk_unit_year_sequence_uidx ON public.surat_masuk USING btree (unit_kerja_id, tahun, no_urut) |
| unit_kerja | unit_kerja_pkey | CREATE UNIQUE INDEX unit_kerja_pkey ON public.unit_kerja USING btree (id) |

## ekstensi — Ketersediaan dan instalasi pg_trgm / pgcrypto

Keputusan: pg_trgm tidak memblokir P0-P4. Bila installed_version NULL, fase opsional P5 memerlukan langkah privileged satu kali.

| name | default_version | installed_version |
| --- | --- | --- |
| pg_trgm | 1.6 | NULL |
| pgcrypto | 1.4 | 1.4 |

## data_lama_ringkasan — Ringkasan surat_masuk (indikasi data lama)

Keputusan: Menjawab pertanyaan terbuka #2: bila ada sekitar 2.047 surat lama (created_by NULL, berlabel disposisi), backfill langkah 2 (P5) diperlukan.

| total | hidup | tanpa_pembuat | berlabel_disposisi | perihal_kosong | tanggal_surat_min | tanggal_surat_max | dibuat_min | dibuat_max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 11 | 6 | 0 | 10 | 0 | 2026-08-25 | 2026-09-17 | 2026-09-12 02:54:23.950177 | 2026-09-17 00:48:38.554828 |

## data_lama_per_unit_tahun — surat_masuk per unit dan tahun

Keputusan: Arsipkan sebagai baseline volume untuk P4 (target p95 Lacak) dan P5.

| unit_kerja_id | tahun | jumlah | tanpa_pembuat |
| --- | --- | --- | --- |
| ditjen | 2026 | 10 | 0 |
| sesditjen | 2026 | 1 | 0 |

## label_disposisi — Label disposisi bebas (normalisasi langkah 2)

Keputusan: Masukan seed disposisi_label_unit (P5). Label kosong dicatat dan diabaikan.

| label_norm | jumlah |
| --- | --- |
| ditjen | 7 |
| sekditjen | 3 |

## balasan_lintas_unit — balasan_untuk same-unit vs lintas unit

Keputusan: Baris lintas unit tidak dimasukkan backfill langkah 2 dan ditinjau TU.

| balasan_same_unit | balasan_lintas_unit |
| --- | --- |
| 1 | 0 |

## sifat_surat_distinct — Nilai distinct surat_masuk.sifat_surat

Keputusan: Regenerasi backend/src/__tests__/fixtures/sifat-surat-produksi.json dengan --format=sifat-json lalu jalankan test paritas.

| nilai | literal | jumlah | jumlah_hidup |
| --- | --- | --- | --- |
| biasa | 'biasa' | 10 | 5 |
| segera | 'segera' | 1 | 1 |

## klasifikasi_keamanan_keluar_distinct — Nilai distinct surat_keluar.klasifikasi_keamanan

Keputusan: NULL diperlakukan terbatas (spec 4.4). Nilai di luar biasa/terbatas/rahasia/sangat_rahasia dicatat untuk reklasifikasi.

| nilai | literal | jumlah |
| --- | --- | --- |
| biasa | 'biasa' | 6 |

## sifat_surat_kelas — Kelas keamanan per nilai sifat_surat: SQL lama vs normalisasi P0

Keputusan: Baris dengan kelas_lama berbeda dari kelas_baru adalah surat yang tampil/berubah di kotak disposisi setelah P0.

| nilai | literal | kelas_lama | kelas_baru | jumlah |
| --- | --- | --- | --- | --- |
| biasa | 'biasa' | biasa | biasa | 10 |
| segera | 'segera' | biasa | biasa | 1 |

## distribusi_terbuka_per_kelas — Distribusi sent/received per kelas (lama vs P0)

Keputusan: Jumlah dengan kelas_lama berbeda dari kelas_baru = disposisi yang baru muncul di kotak disposisi setelah P0; umumkan ke direktorat. Kelas terkendali yang masih terbuka menjadi masukan kebijakan 4.12.

_(0 baris)_

## Tinjauan terhadap tabel keputusan

Ditinjau terhadap `docs/PREFLIGHT_INTEGRASI_SURAT_P0.md` (tabel keputusan).

| Pemeriksaan | Hasil | Status |
|---|---|---|
| `status_migrasi` | 46 migrasi, terakhir `1789397416667` (0045) | Lulus |
| `unit_kerja_direktorat` | hanya `ditjen` dan `sesditjen` ada; keempat `dir_*` akan dibuat 0047 | Informasi |
| `unit_kerja_id_direktorat_dash` | 0 baris | Lulus |
| `distribusi_status_tak_dikenal` | 0 baris | Lulus |
| `distribusi_aktif_ganda` | 0 baris | Lulus |
| `index_dan_objek_bentrok` | semua `false`, termasuk kedua trigger | Lulus |
| `kolom_bentrok` | 0 baris | Lulus |
| `ekstensi` | `pg_trgm` belum terpasang | Informasi: langkah privileged `grants/0003` wajib sebelum 0048/0049 (P5) |
| `data_lama_ringkasan` | 11 surat masuk, `tanpa_pembuat` = 0 | Informasi: tidak ada data lama tanpa pembuat; backfill langkah 2 (P5) praktis tidak mengubah apa pun (gerbang P5 e) |
| `label_disposisi`, `balasan_lintas_unit` | label `ditjen` (7), `sekditjen` (3); balasan lintas unit 0 | Informasi |
| `sifat_surat_distinct`, `sifat_surat_kelas` | `biasa`, `segera`; kelas lama = kelas baru | Lulus; test paritas PASS (6/6) |
| `distribusi_terbuka_per_kelas` | 0 baris (belum ada disposisi sama sekali) | Informasi: tidak ada disposisi terkendali terbuka (keputusan C-10 tidak diperlukan) |
| `pengguna_per_role_unit` | `admin_unit` ditjen 2, sesditjen 2; `super_admin` 3; `user` (tanpa unit) 1 | Informasi: calon pengawas = 4 `admin_unit` ditjen/sesditjen |

Catatan teknis:

- Dijalankan dengan role read-only `simsa_backup` (anggota `pg_read_all_data`, tanpa hak tulis; diverifikasi lewat SQL Editor sebelum dijalankan). Role ini tidak memuat `public` di `search_path`, sehingga koneksi pre-flight menambahkan opsi sesi `search_path=public`. Setelan role tidak diubah.
- Password `simsa_backup` dirotasi pada 2026-10-03 sebelum pre-flight, dan secret GitHub `NEON_BACKUP_DATABASE_URL` diperbarui.
- Fixture `sifat-surat-produksi.json` **tidak** diganti: nilai produksi (`biasa`, `segera`) sudah termasuk dalam fixture yang ter-commit (17 nilai, superset). Test paritas PASS dengan fixture produksi saja maupun dengan fixture yang ter-commit.
- Volume produksi sangat kecil (11 surat masuk, 0 disposisi), sehingga backfill langkah 1 dan pra-cek 0048 diperkirakan trivial.

## Pengesahan

- Dijalankan oleh (nama/jabatan):
- Basis data (host Neon, cabang) dan waktu: `ep-divine-waterfall-azd8ke8m` (endpoint direct, database `neondb`), 2026-10-03T01:36:52Z (08:36 WIB), dari checkout rilis C47 `7c18964`
- Ditinjau pemilik keamanan:
- Keputusan lanjut ke P1 (ya/tidak, alasan):

