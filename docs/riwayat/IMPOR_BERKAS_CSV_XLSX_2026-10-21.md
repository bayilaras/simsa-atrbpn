# Impor berkas CSV/XLSX dengan pemetaan Google Sheets (2026-10-21)

> **Snapshot, tidak diperbarui.** Catatan ini merekam keadaan pada tanggal penulisannya. Kondisi produksi terkini ada di [README](../../README.md) dan runbook di `docs/`. Fitur ini dirilis sebagai C56/C53 ([laporan rilis](../rilis/HASIL_RILIS_C56_C53_2026-10-21.md)).

Catatan desain untuk branch `feat/impor-berkas-csv-xlsx`, dibangun di atas
`perf/import-cepat` (belum di-merge). Tujuan: register surat yang diunduh sebagai
`.xlsx` atau disimpan sebagai `.csv` dapat diimpor persis seperti tab Google Sheets
yang sama, termasuk judul "Hal" dan "Get link".

## Masalah

Impor CSV lama (`/api/migration/surat-*`) membaca header persis (`row['Perihal']`,
`row['Kepada']`), hanya `.csv`, dan tidak mengenal pemisah `;` yang dipakai Excel
berpengaturan Indonesia. Register sungguhan ("Hal", "Get link", judul di baris
pertama) gagal, padahal impor Google Sheets sudah mengenalnya. XLSX belum didukung.

## Keputusan

1. **Satu jalur impor.** Berkas hanya sumber baris lain. `import-file-reader.ts`
   mengubah CSV/XLSX menjadi `string[][]` berbentuk ekspor CSV Google Sheets (baris
   kosong dibuang, nilai di-trim), lalu `file-import.service.ts` memanggil
   `GoogleDriveImportService.previewRows` / `importRows`. Deteksi judul, pemetaan,
   sifat, identitas, cek duplikat satu kueri, bagian 25 detik dengan `prefixHash`,
   dan audit kanonik tidak diduplikasi. `previewRows` diekstrak dari pratinjau Sheets.
2. **Rute terpisah, kontrak lama utuh.** `POST /api/import/berkas/{lembar,preview,
   surat-masuk,surat-keluar}`. `/api/migration/*` tidak diubah sehingga klien lama
   tetap jalan dan impor arsip tetap sama. Frontend surat beralih ke dialog baru
   `ImportFileDialog`; Arsip tetap `ImportCsvDialog`. Endpoint CSV surat lama dapat
   dihapus setelah frontend baru dirilis (tindak lanjut terpisah).
3. **Langkah seperti Sheets.** Daftar lembar → pilih lembar → pratinjau → impor, dengan
   tiga batas laju yang sama (daftar, pratinjau, impor; masing-masing 3/menit).
   Lembar XLSX dipilih dari nama persis; tanpa nama hanya diterima bila berlembar
   tunggal (pelajaran dari bug gid: lembar tidak pernah ditebak).
4. **XLSX terbatas sebelum `exceljs`.** `exceljs.load` mengekstrak semua bagian
   ZIP ke memori, sehingga paket diperiksa dulu dari central directory. Pembacaan
   ini harus melihat bagian yang sama dengan JSZip: direktori harus berakhir tepat di
   rekaman akhir (JSZip menggeser semua offset bila ada celah) dan terbaca habis oleh
   jumlah yang dinyatakan; nama bagian harus ASCII baku tanpa `.`/`..`/segmen kosong
   dan tanpa field Unicode Path (JSZip menormalkan nama itu). Lalu: ≤ 1.000
   bagian, ≤ 100 lembar, ≤ 16 MiB total terekstrak, tiap bagian di-inflate dengan
   `maxOutputLength` = ukuran yang dinyatakan (bom ZIP berhenti lebih awal), tanpa
   enkripsi, tanpa makro/templat, dan harus berisi `xl/workbook.xml` bertipe buku
   kerja. Berkas OLE (XLSX berkata sandi atau `.xls`) ditolak dari byte awal.
   `dataValidations`, `conditionalFormatting`, dan `extLst` diabaikan karena
   `exceljs` memperluas rentang validasi sel demi sel (validasi satu kolom penuh
   tidak akan selesai). Batas baris/kolom/sel sama dengan Sheets (1.005 baris
   berisi termasuk judul, 64 kolom, 16 KiB).
5. **Nilai sel.** Tanggal → `YYYY-MM-DD` (tanggal UTC dari serial Excel, jam dibuang
   karena `parseDate` hanya menerima tanggal); rumus → hasil tersimpan; sel gabungan
   hanya pada sel pertama; galat → teksnya (`#N/A`), boolean → `TRUE`/`FALSE`.
6. **Tautan.** Sel bertautan dibaca sebagai teksnya, seperti CSV Google Sheets, karena
   Nomor Surat atau Hal sering ditautkan ke pindaian. Pembaca menyimpan alamat tautan
   terpisah; `file-import.service` memakai alamat itu hanya di bawah judul kolom tautan
   surat keluar (`linkColumns`). `HYPERLINK("https://…", …)` dihitung tautan hanya bila
   alamatnya literal utuh; `"…"&D5` jatuh ke hasil tersimpan. Bila dua kolom
   "Get link" sama-sama berisi URL, pemetaan bersama memilih kolom yang memuat setiap
   URL kolom lain pada baris yang sama; URL berbeda tetap ditolak ambigu (Sheets tidak
   berubah karena CSV Sheets berisi teks label).
7. **CSV.** UTF-8 (BOM opsional) atau Windows-1252 bila bukan UTF-8 sah; pemisah
   `,`/`;`/tab dideteksi dari 10 baris pertama di luar kutip. `parseBoundedSheetCsv`
   mendapat parameter pemisah (bawaan `,`). Parser bersama kini hanya menghitung baris
   dan sel berisi terhadap batas 1.005 baris/64 kolom: Excel mengisi CSV dengan `,,,,`
   sampai batas format. Padding tetap dibatasi 5 MiB; berlaku juga untuk Sheets.
8. **Ukuran 4 MiB** untuk kedua format: di bawah batas badan permintaan Vercel 4,5 MB
   (sama dengan unggahan PDF fallback). Register 1.000 baris jauh di bawahnya.

## Yang tidak dilakukan

- Tidak ada migrasi basis data. Berkas sumber tidak disimpan; tidak ada batch permanen.
- Tidak ada pratinjau duplikat (seperti Sheets, pratinjau hanya pemetaan dan contoh baris).
- Serial tanggal tanpa format tanggal (sel "General" berisi 46027) tetap angka,
  seperti yang ditampilkan Excel.
- `.xls`, `.xlsm`, `.ods`, dan Strict Open XML tidak didukung; simpan sebagai `.xlsx`.

## Rilis

Bergantung pada `perf/import-cepat` (impor per bagian, `importRows`). Urutan: backend
dulu (rute baru tidak memengaruhi klien lama), lalu frontend (dialog baru memanggil
`/api/import/berkas/*`; backend lama menjawab 404). Uji asap: unduh tab 2026 sebagai
XLSX → pratinjau memetakan "Get link" kolom 9 → impor → semua baris yang sudah diimpor
dari Sheets dikenali duplikat, tanpa surat atau audit baru.
