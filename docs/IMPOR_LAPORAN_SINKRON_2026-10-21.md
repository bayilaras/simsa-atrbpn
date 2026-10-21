# Tombol impor, laporan per baris, dan mode sinkron (2026-10-21)

Catatan desain untuk branch `feat/impor-ux-laporan-sinkron` (dari `main` 1f125b0,
rilis C56/C53). Tiga perbaikan UX impor surat masuk/keluar (Google Sheets dan
CSV/XLSX), berurutan per commit.

## 1. Tombol impor selalu tampil untuk admin

**Masalah.** "Impor dari Google Sheets" dan "Impor CSV/XLSX" hanya dirender bila
`isAdmin && resolvedUnitKerjaId`. Super Admin membuka daftar dengan pemilih unit
"Semua Unit Kerja", sehingga tombol tidak ada dan pengguna tidak menemukannya.

**Keputusan.** Halaman merender kedua tombol untuk setiap admin. Tanpa unit konkret
tombol (`ImportUnitRequiredButton`) tetap dapat difokus tetapi `aria-disabled="true"`,
tidak membuka dialog, dan menjelaskan "Pilih unit kerja terlebih dahulu": teks itu
adalah deskripsi aksesibel (`aria-describedby`) dan tampil sebagai tooltip saat
tombol disorot, difokus dengan keyboard, atau diketuk. `disabled` biasa tidak
dipakai karena tombol nonaktif keluar dari urutan Tab dan petunjuknya tidak terbaca.
Jaminan bahwa setiap impor menuju satu unit konkret tetap sama: dialog hanya dibuka
dengan unit konkret dan backend (`resolveImportUnit`) tetap memeriksa unit dan hak.

## 2. Laporan hasil per baris

**Masalah.** Hasil impor hanya hitungan plus paling banyak 20 pesan galat
("Row 12: …"), jadi baris mana yang duplikat atau ditolak tidak terlihat. Contoh
nyata: tab 2026 memuat 3 nomor yang muncul dua kali; tab 2024 memuat 12 baris tanpa
tanggal.

**Keputusan.**
- `importRows` mengembalikan `rows: ImportRowOutcome[]` untuk setiap baris data yang
  ditangani permintaan itu (pada impor per bagian: `startRow..nextRow-1`), sehingga
  klien menggabungkan semua bagian. Isi: `row` (nomor baris data dari 1, penomoran
  yang sama dengan pesan galat dan pemberitahuan progres), `no` (kolom "No" sumber
  bila dipetakan), `nomorSurat`, `tanggal` (seperti tertulis di sumber), `perihal`
  (dipotong 200 karakter), `status`, `reason`.
- Status: `imported`, `duplicate`, `invalid`, `empty` (nomor dan perihal kosong),
  ditambah `updated`/`locked` untuk sinkron.
- Duplikat menyebut sebabnya: bila identitas impor sama dengan baris sumber
  sebelumnya (termasuk dari bagian sebelumnya, karena identitas dihitung untuk semua
  baris, bukan hanya bagian berjalan) → "Nomor surat dan tahun sama dengan baris data
  ke-N pada sumber ini." (atau tanggal+perihal+pengirim/tujuan/tautan); selain itu
  "Sudah tercatat di SIMSA pada unit ini (termasuk surat yang dihapus)."
- Baris ditolak memakai pesan publik (`publicErrorResponse`); galat internal tetap
  "Terjadi kesalahan pada server." `errors` (maks. 20) dipertahankan untuk klien lama,
  dan log penolakan tetap dibatasi 20 baris per permintaan.
- Nomor baris adalah nomor baris data, bukan nomor baris spreadsheet: ekspor CSV
  Google (gviz) dapat menggabungkan baris judul ke header, sehingga nomor baris asli
  tidak dapat dipastikan. Karena itu laporan juga memuat kolom "No" sumber.
- Ukuran respons: ±150 B per baris, maksimal ±200 KB untuk 1.000 baris.
- Dialog (`ImportRowReport`): tabel "Rincian hasil impor per baris" dengan filter
  (bawaan "Perlu dicek" = duplikat, ditolak, tidak diperbarui) dan **Unduh laporan
  (CSV)**: UTF-8 dengan BOM, pemisah koma, sel yang diawali `= + @` tab/CR atau `-`
  diikuti karakter lain diberi awalan `'` agar tidak dijalankan sebagai rumus (nomor
  "-" untuk surat tanpa nomor tetap apa adanya). Server lama tanpa `rows` tetap
  menampilkan daftar galat lama.

## 3. Mode sinkron (opsional, mati secara bawaan)

**Masalah.** Baris yang identitas impornya sudah tercatat selalu dilewati sebagai
duplikat, jadi perubahan di sheet sesudah impor diabaikan. Contoh nyata: perihal
40/UND-600.BP.01.01/VI/2026 diubah di sheet setelah diimpor.

**Analisis risiko** (mengapa ini tetap aman dilakukan):

| Risiko | Penanganan |
|---|---|
| Surat keluar yang sedang/telah disetujui | Hanya `draft`/`rejected` yang diubah: diperiksa dari hasil pencarian untuk alasan yang jelas, lalu ditegakkan lagi oleh `WHERE` di `suratKeluarService.update`. Surat hasil impor berstatus `draft`. |
| Surat diarsipkan atau dihapus | Tidak diubah (`isArchived`/`isDeleted`; `WHERE` di `update`). Surat dihapus tidak dipulihkan. |
| Klasifikasi keamanan / hak akses | `recordAccessService.check(pengimpor, …)` harus `mutable`, sama seperti rute PUT. Surat terbatas/rahasia butuh grant kelola; surat yang tidak boleh dibaca pengimpor tidak dibandingkan dan nilainya tidak dilaporkan. |
| Sifat surat masuk = klasifikasi keamanan | `sifat_surat` surat masuk adalah kelas akses (Biasa/Terbatas/Rahasia) di `record-access`. Impor **tidak pernah** mengubahnya; sinkron surat masuk hanya perihal, tanggal, jenis surat. |
| Rangkaian | Surat masuk dalam rangkaian: penjaga rangkaian meminta alasan untuk perubahan perihal; impor tidak memberi alasan otomatis, jadi baris dilaporkan "Tidak diperbarui" dan dikoreksi lewat alur biasa. Surat keluar: rangkaian dihitung ulang (`afterSuratKeluarChanged`) seperti PUT. |
| Validasi | Patch divalidasi dengan skema PUT (`updateSuratKeluarSchema`/`updateSuratMasukSchema`), misalnya perihal ≤ 2.000 karakter. |
| Unit lain | Identitas impor selalu menyertakan unit tujuan; surat unit lain dengan nomor sama tidak tersentuh. |
| Nomor ganda di sheet | Hanya baris pertama sebuah identitas yang menyinkronkan; baris berikutnya dilaporkan duplikat, sehingga surat tidak bolak-balik berubah. Bila baris bernomor dan baris tanpa nomor (identitas tautan/tujuan) cocok dengan surat yang sama dalam satu bagian, hanya yang pertama diterapkan. |
| Nomor sama, surat lain | Identitas surat bernomor hanya unit+tahun+nomor; nomor surat masuk berasal dari pengirim, jadi dua pengirim dapat memakai nomor yang sama. Bila sumber menyebut pengirim (surat masuk) atau tujuan (surat keluar) yang berbeda dari yang tercatat (abaikan huruf besar/spasi), surat tidak diubah dan kedua nilai disebut. |
| Identitas cocok dengan > 1 surat | Tidak diubah ("Tidak diperbarui: identitas ini cocok dengan lebih dari satu surat"), tanpa menyebut jumlah (dapat mencakup surat yang tidak boleh dibaca). |
| Teks sumber vs formulir | Nilai sumber disimpan dan dibandingkan dalam bentuk yang sama dengan sanitizer permintaan rute PUT (`sanitizeSatuBaris`: buang tag, rapatkan spasi), sehingga beda format saja tidak dianggap perubahan dan penjaga rangkaian melihat nilai yang sama. |
| Galat sementara | Kegagalan pemeriksaan akses atau update menjadi hasil baris itu ("Tidak diperbarui: …", galat internal tetap generik dan dicatat di log), bukan menggagalkan seluruh bagian. |
| Menghapus data lewat sel kosong | Sel kosong atau kolom yang tidak dipetakan tidak pernah mengubah/menghapus nilai. |
| Audit | Satu entri `update` per surat yang berubah, dari `update()` kanonik, dengan `changes.before` (nilai lama field yang berubah), `after`, `fields`, dan `sumber: 'impor_sinkron'`. |

**Keputusan.**
- Kotak centang "Sinkronkan surat yang sudah tercatat" pada pratinjau kedua dialog,
  mati secara bawaan. Dikirim sebagai `sinkron: true` (JSON Sheets) atau
  `sinkron=true` (multipart berkas) **hanya bila dicentang**, di setiap bagian, agar
  frontend baru tetap bekerja dengan backend lama selama sinkron tidak dipakai.
- Field yang dapat berubah: surat keluar `perihal`, `tanggalSurat`, `sifatSurat`,
  `linkDokumen`, `naskahDinas`; surat masuk `perihal`, `tanggalSurat`, `jenisSurat`.
  Nilai sumber dibaca seperti saat membuat rekod (tanggal di-parse, sifat
  dinormalisasi, tautan hanya `http(s)://`).
- Satu kueri (`matchSuratImportIdentities`) mengembalikan surat yang cocok beserta
  status dan nilai field per bagian, menggantikan cek keberadaan pada mode sinkron.
  Kueri ini dan `existingSuratImportIdentities` kini berbagi pembentuk probe
  (`identityProbes`) sehingga keduanya membandingkan kolom yang sama dengan
  `suratImportIdentityWhere`.
- Pemeriksaan akses dilakukan hanya untuk surat yang berubah (atau lebih dulu, untuk
  kelas terkendali), sehingga sinkron atas register yang tidak berubah tidak
  menambah kueri per baris.
- `update()` kedua layanan mendapat parameter opsional `auditDetails` yang digabung
  ke `changes` audit; pemanggil lain tidak berubah.
- Respons menambah `updatedRows`; baris yang tidak dapat diperbarui (`locked`)
  dihitung dalam `duplicateRows` dan dijelaskan per baris, termasuk perubahan yang
  akan diterapkan bila pengimpor boleh membaca surat itu.

**Batasan yang diketahui.**
- Perubahan pada field identitas tidak dapat disinkronkan: untuk baris tanpa nomor,
  tanggal dan perihal adalah bagian identitas, sehingga baris yang diubah dianggap
  surat baru (perilaku impor yang sudah ada). Untuk baris bernomor, tanggal yang
  pindah tahun juga mengubah identitas.
- `kepada`/`dari` (hanya dibandingkan), klasifikasi arsip, dan kolom lain tidak
  disinkronkan.
- "Satu baris per surat" berlaku per bagian; bila dua baris yang cocok dengan surat
  yang sama jatuh di bagian berbeda, keduanya dapat diterapkan berurutan (nilai
  `before` audit diambil dari pencarian awal bagian).
- Tidak ada uji coba tanpa menulis (dry run); laporan per baris menampilkan apa yang
  berubah. Dapat menjadi tindak lanjut bila diperlukan.
- Laporan CSV memakai pemisah koma (standar; Google Sheets mendeteksinya). Excel
  dengan pengaturan regional Indonesia (pemisah daftar `;`) dapat menampilkannya
  dalam satu kolom; buka lewat Data → From Text/CSV. Pemisah `;` adalah alternatif
  bila pengguna lebih sering membuka laporan di Excel.
- Pembuatan surat lewat impor (bukan sinkron) masih menyimpan teks sumber apa adanya
  tanpa sanitizer permintaan; perilaku lama ini tidak diubah di branch ini.

## Review

Review independen (subagen, baca saja) atas tiga commit fitur tidak menemukan temuan
tinggi; temuan sedang/rendah yang ditindaklanjuti: nomor sama dengan pengirim/tujuan
lain, teks tidak disanitasi, galat pemeriksaan menggagalkan bagian, judul hasil
"Semua data sudah ada" saat perubahan ditolak, dua identitas untuk satu surat, tabel
laporan di dalam live region, petunjuk unit hanya untuk pembaca layar/tetikus, dan
jumlah surat pada pesan identitas ganda. Pemisah CSV dibiarkan koma (lihat batasan).

## Kompatibilitas dan rilis

Tidak ada migrasi. Backend lebih dulu: backend lama menolak `sinkron` (skema
`strict`, 400) tetapi frontend baru hanya mengirimnya bila dicentang; tanpa `rows`
dialog baru menampilkan daftar galat lama. Frontend lama mengabaikan `rows` dan
`updatedRows`.

## Pengujian

- `import-row-report.test.ts`: laporan per baris (duplikat sumber vs tercatat, tanpa
  tanggal, kosong, galat internal, > 20 baris, perihal panjang, lintas bagian).
- `import-sinkron.integration.test.ts` (PGlite, migrasi penuh, layanan nyata): sinkron
  mati = perilaku lama; perihal+sifat berubah dengan satu audit `before/after`; sel
  tautan kosong tidak menghapus; disetujui/diarsipkan/dihapus/rahasia tidak berubah;
  nomor ganda; unit lain; idempoten; hanya kolom yang dipetakan; sifat surat masuk
  tidak berubah; surat masuk dalam rangkaian ditolak penjaga rangkaian.
- `import-sync.test.ts`: identitas ganda, skema PUT, status berubah di tengah, galat
  publik/internal, kelas yang tidak boleh dibaca.
- Uji rute untuk `sinkron` (JSON dan multipart); uji frontend untuk tombol tanpa unit,
  laporan, filter, unduhan CSV, dan kotak centang sinkron di kedua dialog.
